import type { HostToWidgetMessage } from "@brainstack/shared";
import { envelope, readWidgetMessage } from "../protocol";
import { LOADER_STRINGS } from "../strings";

/*
 * The embed loader, `chatbot.js` (M4-8, M4-9, M4-10). A company adds one tag:
 *   <script src="https://<host>/chatbot.js" data-chatbot-id="cb_…" async></script>
 * and the loader draws a launcher button in the corner that opens the chat
 * window (`/w/<publicId>` on the widget's origin) in an iframe.
 *
 * - Plain DOM code, no dependencies; the build checks it stays under 10KB gzip.
 * - Isolation both ways: everything lives in a closed shadow root, whose
 *   styles can't leak out and the page's styles can't reach in; the root
 *   element itself has `all: initial` with !important inline, so even a
 *   page rule on `div` can't move or hide it.
 * - Talks to the chat window with the versioned postMessage protocol in
 *   ../protocol.ts, only with its own iframe on the widget's origin.
 */

/** Set on `window` by the first loader, so a second copy of the tag does nothing (M4-11). */
const LOADED_FLAG = "__brainstackWidgetLoaded";
const DEFAULT_BOTTOM = 20;

/** The panel size a chat window may ask for on a desktop (`resize`). */
const WIDTH = { min: 300, max: 600 };
const HEIGHT = { min: 400, max: 800 };

const CHAT_ICON =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
const CLOSE_ICON =
  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/**
 * Inside the shadow root, so these short class names can't clash with the
 * page's. A phone (up to 640px wide) gets the chat full screen, sized to
 * the visible part of the screen (`--vh`, `--vt`), so the chat window's own
 * safe-area and keyboard handling (M4-7) apply; its header has the close
 * button, so the launcher hides meanwhile.
 */
const CSS = `:host{all:initial}
.w{--b:20px;--bg:#0F766E;--fg:#fff;font:400 14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.l{position:fixed;bottom:var(--b);right:20px;left:auto;width:56px;height:56px;box-sizing:border-box;border-radius:50%;border:0;padding:0;margin:0;cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:2147483646}
.l:focus-visible{outline:2px solid #18181b;outline-offset:2px;box-shadow:0 0 0 2px #fff}
.n{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;box-sizing:border-box;border-radius:10px;background:#dc2626;color:#fff;font:600 11px/20px system-ui,sans-serif;text-align:center}
.n[hidden]{display:none}
.p{position:fixed;bottom:calc(var(--b) + 68px);right:20px;left:auto;width:var(--pw,370px);height:var(--ph,560px);max-width:calc(100vw - 40px);max-height:calc(100vh - var(--b) - 90px);border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.25);background:#fff;display:none;z-index:2147483647}
.left .l,.left .p{left:20px;right:auto}
.open .p{display:block}
.p iframe{width:100%;height:100%;border:0;margin:0;padding:0;display:block;background:#fff}
@media (max-width:640px){.open .p{top:var(--vt,0px);left:0;right:0;bottom:auto;width:100%;height:var(--vh,100%);max-width:none;max-height:none;border-radius:0;box-shadow:none}.open .l{display:none}}`;

export interface Loader {
  root: ShadowRoot | HTMLElement;
  button: HTMLButtonElement;
  frame: HTMLIFrameElement;
  /** Where the chat window lives; the only origin the loader talks to. */
  widgetOrigin: string;
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

/**
 * The chat window's base URL: the build's `VITE_WIDGET_URL` when set
 * (e.g. the page is served by the API while this file comes from a CDN,
 * M4-19), otherwise the origin this script was loaded from (the dashboard
 * today, which serves its own `/w/:publicId` page). Null if neither parses.
 */
export function widgetBaseFrom(scriptSrc: string, configured?: string): { base: string; origin: string } | null {
  try {
    if (configured) {
      const url = new URL(configured);
      return { base: url.href.replace(/\/+$/, ""), origin: url.origin };
    }
    const { origin } = new URL(scriptSrc);
    return { base: origin, origin };
  } catch {
    return null;
  }
}

/** `data-bottom` in px (0–400), for sites whose own bars sit in the corner. */
export function bottomFrom(value: string | null): number {
  const bottom = Number.parseInt(value ?? "", 10);
  return bottom >= 0 && bottom <= 400 ? bottom : DEFAULT_BOTTOM;
}

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.round(Math.min(max, Math.max(min, n)));

/** Puts the launcher and the (hidden) chat on the page, or does nothing on a bad or second tag. */
export function mountLoader(
  script: HTMLScriptElement | null,
  win: Window = window,
  configuredUrl?: string,
): Loader | null {
  const flags = win as unknown as Record<string, unknown>;
  const chatbotId = script?.getAttribute("data-chatbot-id");
  if (!script || !chatbotId || flags[LOADED_FLAG]) return null;
  const widget = widgetBaseFrom(script.src, configuredUrl);
  if (!widget) return null;
  flags[LOADED_FLAG] = true;

  const doc = win.document;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  const host = el("div");
  host.setAttribute("data-brainstack-widget", "");
  for (const [key, value] of Object.entries({
    all: "initial",
    position: "fixed",
    top: "0",
    left: "0",
    width: "0",
    height: "0",
    display: "block",
    "z-index": "2147483647",
  })) {
    host.style.setProperty(key, value, "important");
  }
  const root: ShadowRoot | HTMLElement = host.attachShadow ? host.attachShadow({ mode: "closed" }) : host;

  const style = el("style");
  style.textContent = CSS;
  const wrap = el("div", "w");
  wrap.style.setProperty("--b", `${bottomFrom(script.getAttribute("data-bottom"))}px`);

  const button = el("button", "l");
  button.type = "button";
  button.setAttribute("aria-controls", "bs-panel");
  const icon = el("span");
  icon.style.display = "contents";
  const badge = el("span", "n");
  badge.hidden = true;
  badge.setAttribute("aria-hidden", "true");
  button.append(icon, badge);

  const panel = el("div", "p");
  panel.id = "bs-panel";
  // Loaded right away (hidden), so the launcher gets the company's color
  // and side before the visitor clicks.
  const frame = el("iframe");
  frame.src = `${widget.base}/w/${encodeURIComponent(chatbotId)}`;
  frame.title = LOADER_STRINGS.frameTitle;
  panel.append(frame);
  wrap.append(panel, button);
  root.append(style, wrap);

  let open = false;
  let unread = 0;

  const post = (message: HostToWidgetMessage) =>
    frame.contentWindow?.postMessage(envelope(message), widget.origin);

  function render() {
    wrap.classList.toggle("open", open);
    icon.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
    const showBadge = !open && unread > 0;
    badge.hidden = !showBadge;
    badge.textContent = showBadge ? (unread > 9 ? "9+" : String(unread)) : "";
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute(
      "aria-label",
      open
        ? LOADER_STRINGS.closeChat
        : showBadge
          ? `${LOADER_STRINGS.openChat} (${LOADER_STRINGS.unread(unread)})`
          : LOADER_STRINGS.openChat,
    );
  }

  /**
   * On a phone the panel follows the visible part of the screen, so the
   * on-screen keyboard (iOS shrinks only the visual viewport) never covers
   * the chat's message box.
   */
  const viewport = win.visualViewport;
  function fitViewport() {
    if (!viewport) return;
    wrap.style.setProperty("--vh", `${Math.round(viewport.height)}px`);
    wrap.style.setProperty("--vt", `${Math.round(viewport.offsetTop)}px`);
  }

  function setOpen(next: boolean) {
    if (next === open) return;
    open = next;
    if (open) unread = 0;
    render();
    if (viewport) {
      const method = open ? "addEventListener" : "removeEventListener";
      viewport[method]("resize", fitViewport);
      viewport[method]("scroll", fitViewport);
      fitViewport();
    }
    post({ type: "state", open });
    // Into the chat on open (the window then focuses its message box);
    // back to the launcher on close, so a keyboard visitor isn't lost.
    if (open) frame.focus();
    else button.focus();
  }

  button.addEventListener("click", () => setOpen(!open));

  win.addEventListener("message", (event: MessageEvent) => {
    // Only our own iframe, on the widget's origin.
    if (event.source !== frame.contentWindow || event.origin !== widget.origin) return;
    const message = readWidgetMessage(event.data);
    if (!message) return;
    switch (message.type) {
      case "ready":
        post({ type: "init", open });
        break;
      case "config":
        wrap.style.setProperty("--bg", message.primaryColor);
        wrap.style.setProperty("--fg", message.textColor);
        wrap.classList.toggle("left", message.position === "left");
        break;
      case "open":
        setOpen(true);
        break;
      case "close":
        setOpen(false);
        break;
      case "resize":
        wrap.style.setProperty("--pw", `${clamp(message.width, WIDTH)}px`);
        wrap.style.setProperty("--ph", `${clamp(message.height, HEIGHT)}px`);
        break;
      case "unread":
        unread = open ? 0 : message.count;
        render();
        break;
    }
  });

  render();
  const mount = () => doc.body.append(host);
  if (doc.body) mount();
  else doc.addEventListener("DOMContentLoaded", mount);

  return { root, button, frame, widgetOrigin: widget.origin, isOpen: () => open, setOpen };
}
