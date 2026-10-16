import { describe, expect, it, vi } from "vitest";
import { connectHost, type HostWindow } from "./host";
import { fakeHostWindow, hostMessage } from "./test-host";

const HOST = "https://shop.example";

describe("connectHost (M4-10)", () => {
  it("returns null when the page is not in a frame", () => {
    const win: Record<string, unknown> = { addEventListener: vi.fn(), location: {} };
    win.parent = win;
    expect(connectHost(win as unknown as HostWindow, vi.fn())).toBeNull();
  });

  it("posts an empty ready to any origin, then only to the origin that sent init", () => {
    const { win, deliver, posted } = fakeHostWindow();
    const link = connectHost(win, vi.fn())!;
    expect(posted()).toEqual([{ data: { ns: "brainstack", v: 1, type: "ready" }, target: "*" }]);

    link.post({ type: "close" });
    expect(posted()).toHaveLength(1); // held back until init
    deliver(hostMessage("init", false), HOST);
    expect(posted()[1]).toEqual({ data: { ns: "brainstack", v: 1, type: "close" }, target: HOST });
    link.post({ type: "unread", count: 1 });
    expect(posted()[2].target).toBe(HOST);
  });

  it("passes the loader's messages on, but only from the parent on the host's origin", () => {
    const { win, deliver } = fakeHostWindow();
    const onMessage = vi.fn();
    connectHost(win, onMessage);
    deliver(hostMessage("state", true), HOST); // before init
    deliver(hostMessage("init", false), HOST, {}); // not the parent window
    expect(onMessage).not.toHaveBeenCalled();

    deliver(hostMessage("init", false), HOST);
    deliver(hostMessage("state", true), "https://evil.example");
    deliver({ type: "state", open: true }, HOST); // no envelope
    deliver(hostMessage("state", true), HOST);
    expect(onMessage.mock.calls).toEqual([[{ type: "init", open: false }], [{ type: "state", open: true }]]);
  });

  it("can't be moved to another origin by a second init", () => {
    const { win, deliver, posted } = fakeHostWindow();
    const link = connectHost(win, vi.fn())!;
    deliver(hostMessage("init", false), HOST);
    deliver(hostMessage("init", false), "https://evil.example");
    link.post({ type: "close" });
    expect(posted().at(-1)!.target).toBe(HOST);
  });

  it("rejects an init from an opaque origin or one that isn't the browser-reported parent", () => {
    const { win, deliver } = fakeHostWindow([HOST]);
    const onMessage = vi.fn();
    connectHost(win, onMessage);
    deliver(hostMessage("init", false), "null");
    deliver(hostMessage("init", false), "https://evil.example");
    expect(onMessage).not.toHaveBeenCalled();
    deliver(hostMessage("init", true), HOST);
    expect(onMessage).toHaveBeenCalledWith({ type: "init", open: true });
  });

  it("stops listening on disconnect", () => {
    const { win, listeners } = fakeHostWindow();
    connectHost(win, vi.fn())!.disconnect();
    expect(listeners.size).toBe(0);
  });
});
