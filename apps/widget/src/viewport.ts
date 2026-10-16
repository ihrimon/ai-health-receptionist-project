/**
 * Keeps `--app-height` on <html> equal to the visible part of the screen
 * (M4-7). On phones the on-screen keyboard shrinks the visual viewport but
 * not the layout (iOS Safari), so a full-height chat would put its message
 * box under the keyboard; sizing the page to the visual viewport keeps the
 * box just above it. Returns the cleanup; does nothing without
 * `visualViewport` (old browsers fall back to 100dvh in index.css).
 */
export function watchViewport(win: Window = window): () => void {
  const viewport = win.visualViewport;
  if (!viewport) return () => {};
  const root = win.document.documentElement;
  const update = () => {
    root.style.setProperty("--app-height", `${Math.round(viewport.height)}px`);
    // iOS scrolls the page up to show the focused box; the page already fits.
    if (viewport.offsetTop > 0) win.scrollTo(0, 0);
  };
  update();
  viewport.addEventListener("resize", update);
  viewport.addEventListener("scroll", update);
  return () => {
    viewport.removeEventListener("resize", update);
    viewport.removeEventListener("scroll", update);
  };
}
