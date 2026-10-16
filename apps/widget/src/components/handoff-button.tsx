import { safeHref } from "../markdown";
import { STRINGS } from "../strings";
import type { Brand } from "../theme";
import type { Handoff } from "../types";

/** Where the handoff goes; null when the value can't make a safe link. */
export function handoffHref({ kind, value }: Handoff): string | null {
  const digits = value.replace(/\D/g, "");
  switch (kind) {
    case "email":
      return /^[^\s@/?#]+@[^\s@/?#]+$/.test(value) ? safeHref(`mailto:${value}`) : null;
    case "phone":
      return digits ? safeHref(`tel:${value.trim().startsWith("+") ? "+" : ""}${digits}`) : null;
    case "whatsapp":
      return digits ? `https://wa.me/${digits}` : null;
    case "url":
      return safeHref(value);
    default:
      return null;
  }
}

/**
 * The "contact us" button after a fallback answer (FR-2.11): the way the
 * company set in `behavior.handoff`, opened in a new tab (or the mail or
 * phone app) so the chat stays open.
 */
export function HandoffButton({ handoff, brand }: { handoff: Handoff; brand: Brand }) {
  const href = handoffHref(handoff);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      class="inline-block rounded-full px-4 py-2 text-sm font-medium"
      style={{ ...brand }}
    >
      {handoff.label ?? STRINGS.handoff[handoff.kind]}
    </a>
  );
}
