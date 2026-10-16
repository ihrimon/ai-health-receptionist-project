import type { HostToWidgetMessage, WidgetToHostMessage } from "@brainstack/shared";
import { envelope, readHostMessage } from "./protocol";

/** The chat window's line to the loader on the company's page (M4-10). */
export interface HostConnection {
  /** Sends to the host page; held back until the host has said who it is (`init`). */
  post(message: WidgetToHostMessage): void;
  disconnect(): void;
}

/** The part of `window` the connection uses, so tests can pass a fake. */
export type HostWindow = Pick<Window, "parent" | "addEventListener" | "removeEventListener"> & {
  location: { ancestorOrigins?: { length: number; [index: number]: string } };
};

/**
 * Connects to the loader, or returns null when the page is not in a frame
 * (opened on its own, e.g. for a test).
 *
 * The window can't know the host's origin in advance (it's any company's
 * site), so it posts an empty `ready` to `*` and waits for `init`. Only
 * the parent window may send it (`event.source`), and where the browser
 * tells the frame its parent's origin (`location.ancestorOrigins`), the two
 * must match. From then on messages go only to that origin and only that
 * origin's messages are read. Which sites may frame the page at all is the
 * job of the `frame-ancestors` header (M4-19).
 */
export function connectHost(
  win: HostWindow,
  onMessage: (message: HostToWidgetMessage) => void,
): HostConnection | null {
  if (!win.parent || win.parent === (win as unknown)) return null;
  let hostOrigin: string | null = null;
  const queue: WidgetToHostMessage[] = [];
  const send = (message: WidgetToHostMessage) => win.parent.postMessage(envelope(message), hostOrigin!);

  const listener = (event: MessageEvent) => {
    if (event.source !== win.parent) return;
    const message = readHostMessage(event.data);
    if (!message) return;
    if (hostOrigin === null) {
      if (message.type !== "init" || !trustedParent(win, event.origin)) return;
      hostOrigin = event.origin;
      queue.splice(0).forEach(send);
    } else if (event.origin !== hostOrigin) {
      return;
    }
    onMessage(message);
  };

  win.addEventListener("message", listener);
  // Nothing in it but "I'm listening", so any origin may see it.
  win.parent.postMessage(envelope({ type: "ready" }), "*");

  return {
    post: (message) => (hostOrigin ? send(message) : queue.push(message)),
    disconnect: () => win.removeEventListener("message", listener),
  };
}

function trustedParent(win: HostWindow, origin: string): boolean {
  // A sandboxed host has the opaque origin "null", which can't be posted to.
  if (!/^https?:\/\//.test(origin)) return false;
  const ancestors = win.location.ancestorOrigins;
  return !ancestors || ancestors.length === 0 || ancestors[0] === origin;
}
