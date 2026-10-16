import { describe, expect, it, vi } from "vitest";
import { connectLoader, type LoaderWindow, textOn } from "./widget";

describe("textOn", () => {
  it("uses white on dark brand colors and black on light ones", () => {
    expect(textOn("#0F766E")).toBe("#ffffff");
    expect(textOn("#000000")).toBe("#ffffff");
    expect(textOn("#FDE047")).toBe("#000000");
    expect(textOn("#FFFFFF")).toBe("#000000");
  });
});

/** A framed page: its parent records what is posted, `deliver` plays a message to the page. */
function framed(ancestorOrigins?: string[]) {
  const parent = { postMessage: vi.fn() };
  let listener: ((event: MessageEvent) => void) | undefined;
  const win = {
    parent,
    addEventListener: (_: string, fn: (event: MessageEvent) => void) => (listener = fn),
    removeEventListener: () => (listener = undefined),
    location: { ancestorOrigins },
  } as unknown as LoaderWindow;
  const deliver = (data: unknown, origin: string, source: unknown = parent) =>
    listener?.({ data, origin, source } as MessageEvent);
  return { win, parent, deliver };
}

const init = { ns: "brainstack", v: 1, type: "init", open: false };
const close = { type: "close" } as const;

describe("connectLoader (protocol v1, M4-10)", () => {
  it("does nothing outside a frame", () => {
    const win = { parent: null } as unknown as LoaderWindow;
    (win as { parent: unknown }).parent = win;
    expect(connectLoader(win)).toBeNull();
  });

  it("says ready to any origin, then posts only to the origin that sent init", () => {
    const { win, parent, deliver } = framed();
    const link = connectLoader(win)!;
    expect(parent.postMessage).toHaveBeenCalledWith({ ns: "brainstack", v: 1, type: "ready" }, "*");

    link.post(close);
    expect(parent.postMessage).toHaveBeenCalledTimes(1); // held until init
    deliver(init, "https://shop.example");
    expect(parent.postMessage).toHaveBeenLastCalledWith({ ns: "brainstack", v: 1, type: "close" }, "https://shop.example");

    // A second init can't move the link to another origin.
    deliver(init, "https://evil.example");
    link.post(close);
    expect(parent.postMessage).toHaveBeenLastCalledWith(expect.anything(), "https://shop.example");
  });

  it("ignores init from another window, an opaque origin, a wrong version or a mismatched ancestor", () => {
    const { win, parent, deliver } = framed(["https://shop.example"]);
    const link = connectLoader(win)!;
    link.post(close);
    deliver(init, "https://shop.example", {});
    deliver(init, "null");
    deliver({ ...init, v: 2 }, "https://shop.example");
    deliver(init, "https://evil.example");
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    deliver(init, "https://shop.example");
    expect(parent.postMessage).toHaveBeenCalledTimes(2);
  });
});
