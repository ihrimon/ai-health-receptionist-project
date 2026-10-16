import { describe, expect, it, vi } from "vitest";
import { watchViewport } from "./viewport";

/** A window whose visual viewport the test can resize, like an opening keyboard. */
function fakeWindow() {
  const target = new EventTarget();
  const viewport = Object.assign(target, { height: 800, offsetTop: 0 });
  const scrollTo = vi.fn();
  const win = { visualViewport: viewport, document, scrollTo } as unknown as Window;
  const resize = (height: number, offsetTop = 0) => {
    Object.assign(viewport, { height, offsetTop });
    viewport.dispatchEvent(new Event("resize"));
  };
  return { win, resize, scrollTo };
}

const appHeight = () => document.documentElement.style.getPropertyValue("--app-height");

describe("watchViewport (M4-7)", () => {
  it("sizes the page to the visible screen and follows the on-screen keyboard", () => {
    const { win, resize, scrollTo } = fakeWindow();
    const stop = watchViewport(win);
    expect(appHeight()).toBe("800px");

    // The keyboard opens: iOS shrinks the visual viewport and scrolls the page.
    resize(431.6, 120);
    expect(appHeight()).toBe("432px");
    expect(scrollTo).toHaveBeenCalledWith(0, 0);

    stop();
    resize(800);
    expect(appHeight()).toBe("432px");
  });

  it("does nothing without visualViewport (the CSS falls back to 100dvh)", () => {
    document.documentElement.style.removeProperty("--app-height");
    const stop = watchViewport({ document } as unknown as Window);
    expect(appHeight()).toBe("");
    stop();
  });
});
