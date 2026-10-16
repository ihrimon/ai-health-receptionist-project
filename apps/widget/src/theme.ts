/**
 * The company's brand color on the header, the send button and the
 * visitor's bubbles, with a text color that stays readable on it.
 */
export interface Brand {
  background: string;
  color: string;
}

/** Black or white, whichever reads better on `hex` (`#rrggbb`). */
export function textOn(hex: string): "#000000" | "#ffffff" {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Perceived brightness (ITU-R BT.601).
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#000000" : "#ffffff";
}

export function brandFor(primaryColor: string): Brand {
  return { background: primaryColor, color: textOn(primaryColor) };
}

/** Used until the published config arrives (M4-4). */
export const DEFAULT_PRIMARY_COLOR = "#2563eb";
