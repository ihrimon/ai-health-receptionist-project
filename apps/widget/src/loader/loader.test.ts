import { afterEach, describe, expect, it, vi } from "vitest";
import { bottomFrom, type Loader, mountLoader, widgetBaseFrom } from "./loader";

const WIDGET = "https://widget.example";

function tag(attrs: Record<string, string>, src = `${WIDGET}/chatbot.js`) {
  const script = document.createElement("script");
  script.src = src;
  for (const [key, value] of Object.entries(attrs)) script.setAttribute(key, value);
  return script;
}

function mount(attrs: Record<string, string> = { "data-chatbot-id": "cb_123" }, configured?: string) {
  return mountLoader(tag(attrs), window, configured)!;
}

/** A message from `source` (the loader's own iframe by default) on `origin`. */
function fromWidget(loader: Loader, fields: Record<string, unknown>, origin = WIDGET, source: unknown = loader.frame.contentWindow) {
  window.dispatchEvent(
    new MessageEvent("message", { data: { ns: "brainstack", v: 1, ...fields }, origin, source: source as Window }),
  );
}

const wrapOf = (loader: Loader) => loader.root.querySelector<HTMLElement>(".w")!;
const badgeOf = (loader: Loader) => loader.root.querySelector<HTMLElement>(".n")!;

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as Record<string, unknown>).__brainstackWidgetLoaded;
  vi.restoreAllMocks();
});

describe("widgetBaseFrom / bottomFrom", () => {
  it("uses the configured widget URL, else the script's own origin", () => {
    expect(widgetBaseFrom(`${WIDGET}/static/chatbot.js`)).toEqual({ base: WIDGET, origin: WIDGET });
    expect(widgetBaseFrom(`${WIDGET}/chatbot.js`, "https://api.example/widget/")).toEqual({
      base: "https://api.example/widget",
      origin: "https://api.example",
    });
    expect(widgetBaseFrom("not a url")).toBeNull();
  });

  it("accepts a bottom offset of 0–400 px and falls back to 20", () => {
    expect(bottomFrom("96")).toBe(96);
    expect(bottomFrom("0")).toBe(0);
    expect(bottomFrom("401")).toBe(20);
    expect(bottomFrom("-5")).toBe(20);
    expect(bottomFrom("abc")).toBe(20);
    expect(bottomFrom(null)).toBe(20);
  });
});

describe("mountLoader (M4-9)", () => {
  it("adds a launcher and a hidden chat iframe for the chatbot, on the widget's origin", () => {
    const loader = mount();
    expect(loader.frame.src).toBe(`${WIDGET}/w/cb_123`);
    expect(loader.frame.title).toBe("Chat");
    expect(loader.button.getAttribute("aria-label")).toBe("Open chat");
    expect(loader.button.getAttribute("aria-expanded")).toBe("false");
    expect(wrapOf(loader).classList.contains("open")).toBe(false);
    expect(loader.widgetOrigin).toBe(WIDGET);
  });

  it("opens the chat on a configured widget URL", () => {
    const loader = mount({ "data-chatbot-id": "cb 1" }, "https://api.example");
    expect(loader.frame.src).toBe("https://api.example/w/cb%201");
    expect(loader.widgetOrigin).toBe("https://api.example");
  });

  it("does nothing without a chatbot id, without a script, or when loaded twice (M4-11)", () => {
    expect(mountLoader(tag({}), window)).toBeNull();
    expect(mountLoader(null, window)).toBeNull();
    expect(mount()).not.toBeNull();
    expect(mount()).toBeNull();
    expect(document.querySelectorAll("[data-brainstack-widget]")).toHaveLength(1);
  });

  it("keeps everything in a shadow root: nothing leaks into the page, and the page's CSS can't reach in", () => {
    const style = document.createElement("style");
    style.textContent = "button, iframe, div { display: none !important; background: red !important; }";
    document.head.append(style);
    const loader = mount();
    const host = document.querySelector<HTMLElement>("[data-brainstack-widget]")!;

    // Closed root: the page's scripts and selectors can't see inside.
    expect(host.shadowRoot).toBeNull();
    expect(loader.root).not.toBe(host);
    expect(document.querySelectorAll("button, iframe")).toHaveLength(0);
    // Its own styles live only in the root.
    expect(loader.root.querySelector("style")!.textContent).toContain(":host{all:initial}");
    expect(document.head.querySelectorAll("style")).toHaveLength(1);
    // The root element resets itself inline with !important, beating page rules.
    expect(host.style.getPropertyValue("all")).toBe("initial");
    expect(host.style.getPropertyPriority("position")).toBe("important");
    expect(host.style.getPropertyValue("display")).toBe("block");
    style.remove();
  });

  it("sets the bottom offset from data-bottom", () => {
    const loader = mount({ "data-chatbot-id": "cb_123", "data-bottom": "96" });
    expect(wrapOf(loader).style.getPropertyValue("--b")).toBe("96px");
  });

  it("opens and closes from the launcher, moving focus into the chat and back", () => {
    const loader = mount();
    const focusFrame = vi.spyOn(loader.frame, "focus");
    loader.button.click();
    expect(loader.isOpen()).toBe(true);
    expect(wrapOf(loader).classList.contains("open")).toBe(true);
    expect(loader.button.getAttribute("aria-label")).toBe("Close chat");
    expect(loader.button.getAttribute("aria-expanded")).toBe("true");
    expect(focusFrame).toHaveBeenCalled();

    const focusButton = vi.spyOn(loader.button, "focus");
    loader.button.click();
    expect(loader.isOpen()).toBe(false);
    expect(focusButton).toHaveBeenCalled();
  });

  it("waits for the document body before mounting", () => {
    const body = document.body;
    const doc = document as { body: HTMLElement | null };
    Object.defineProperty(document, "body", { configurable: true, get: () => null });
    const loader = mount();
    expect(loader).not.toBeNull();
    Object.defineProperty(document, "body", { configurable: true, get: () => body });
    expect(doc.body!.querySelector("[data-brainstack-widget]")).toBeNull();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(doc.body!.querySelector("[data-brainstack-widget]")).not.toBeNull();
    Reflect.deleteProperty(document, "body");
  });
});

describe("loader ↔ chat window messages (M4-10)", () => {
  it("answers ready with init, posted only to the widget's origin", () => {
    const loader = mount();
    const post = vi.spyOn(loader.frame.contentWindow!, "postMessage");
    fromWidget(loader, { type: "ready" });
    expect(post).toHaveBeenCalledWith({ ns: "brainstack", v: 1, type: "init", open: false }, WIDGET);
  });

  it("tells the chat window when it opens and closes", () => {
    const loader = mount();
    const post = vi.spyOn(loader.frame.contentWindow!, "postMessage");
    loader.setOpen(true);
    expect(post).toHaveBeenLastCalledWith({ ns: "brainstack", v: 1, type: "state", open: true }, WIDGET);
    loader.setOpen(false);
    expect(post).toHaveBeenLastCalledWith({ ns: "brainstack", v: 1, type: "state", open: false }, WIDGET);
  });

  it("colors and places the launcher from config", () => {
    const loader = mount();
    fromWidget(loader, { type: "config", primaryColor: "#FDE047", textColor: "#000000", position: "left" });
    const wrap = wrapOf(loader);
    expect(wrap.style.getPropertyValue("--bg")).toBe("#FDE047");
    expect(wrap.style.getPropertyValue("--fg")).toBe("#000000");
    expect(wrap.classList.contains("left")).toBe(true);
  });

  it("draws the chosen launcher icon, the default one without it, and the close icon while open", () => {
    const loader = mount();
    const icon = () => loader.button.querySelector("[data-icon]")!.getAttribute("data-icon");
    expect(icon()).toBe("chat");
    fromWidget(loader, { type: "config", primaryColor: "#0F766E", textColor: "#ffffff", position: "right", launcherIcon: "sparkle" });
    expect(icon()).toBe("sparkle");
    expect(loader.button.querySelector("svg")).not.toBeNull();
    loader.setOpen(true);
    expect(icon()).toBe("close");
    loader.setOpen(false);
    expect(icon()).toBe("sparkle");
    // An older chat window sends no icon: back to the default.
    fromWidget(loader, { type: "config", primaryColor: "#0F766E", textColor: "#ffffff", position: "right" });
    expect(icon()).toBe("chat");
  });

  it("closes on the chat window's close (its button or Escape) and opens on open", () => {
    const loader = mount();
    fromWidget(loader, { type: "open" });
    expect(loader.isOpen()).toBe(true);
    const focusButton = vi.spyOn(loader.button, "focus");
    fromWidget(loader, { type: "close" });
    expect(loader.isOpen()).toBe(false);
    expect(focusButton).toHaveBeenCalled();
  });

  it("clamps a resize wish to the allowed panel size", () => {
    const loader = mount();
    fromWidget(loader, { type: "resize", width: 5000, height: 10 });
    expect(wrapOf(loader).style.getPropertyValue("--pw")).toBe("600px");
    expect(wrapOf(loader).style.getPropertyValue("--ph")).toBe("400px");
    fromWidget(loader, { type: "resize", width: 420.4, height: 640 });
    expect(wrapOf(loader).style.getPropertyValue("--pw")).toBe("420px");
  });

  it("shows unread answers on the launcher while closed, and clears them on open", () => {
    const loader = mount();
    fromWidget(loader, { type: "unread", count: 2 });
    expect(badgeOf(loader).hidden).toBe(false);
    expect(badgeOf(loader).textContent).toBe("2");
    expect(loader.button.getAttribute("aria-label")).toBe("Open chat (2 new messages)");
    fromWidget(loader, { type: "unread", count: 12 });
    expect(badgeOf(loader).textContent).toBe("9+");

    loader.setOpen(true);
    expect(badgeOf(loader).hidden).toBe(true);
    loader.setOpen(false);
    expect(badgeOf(loader).hidden).toBe(true);
  });

  it("ignores messages from another origin, another window, another version or with bad fields", () => {
    const loader = mount();
    const post = vi.spyOn(loader.frame.contentWindow!, "postMessage");
    fromWidget(loader, { type: "open" }, "https://evil.example");
    fromWidget(loader, { type: "open" }, WIDGET, window);
    fromWidget(loader, { type: "open", v: 2 });
    window.dispatchEvent(new MessageEvent("message", { data: { type: "open" }, origin: WIDGET, source: loader.frame.contentWindow }));
    fromWidget(loader, { type: "ready" }, "https://evil.example");
    fromWidget(loader, { type: "config", primaryColor: "red", textColor: "#000000", position: "left" });
    expect(loader.isOpen()).toBe(false);
    expect(post).not.toHaveBeenCalled();
    expect(wrapOf(loader).style.getPropertyValue("--bg")).toBe("");
  });
});
