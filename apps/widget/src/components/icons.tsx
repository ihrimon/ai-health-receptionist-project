/* Inline SVG icons: an icon library would add more to the bundle than these few paths. */

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="16" height="16">
      <path d="M3.4 20.6 22 12 3.4 3.4 3 10l12 2-12 2z" />
    </svg>
  );
}

/** A hyphen: the window is minimized to the chat button, not destroyed. */
export function MinimizeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
      width="20"
      height="20"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

export function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      aria-hidden="true"
      width="28"
      height="28"
    >
      <path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z" />
    </svg>
  );
}
