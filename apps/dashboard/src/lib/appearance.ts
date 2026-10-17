import { type LauncherIcon, defaultChatbotConfig } from "@brainstack/shared";
import { textOn } from "./widget";

/*
 * Plain logic behind the Appearance tab and its live preview (M4-12,
 * FR-3.6), kept free of React so it can be unit-tested.
 */

const DEFAULT_COLOR = defaultChatbotConfig("").widget.primaryColor;
const HEX6 = /^#[0-9A-F]{6}$/;

/** A few brand colors to start from; any #RRGGBB works. */
export const COLOR_PRESETS = [
  "#0F766E",
  "#2563EB",
  "#7C3AED",
  "#DB2777",
  "#DC2626",
  "#EA580C",
  "#CA8A04",
  "#16A34A",
  "#18181B",
] as const;

/** The icons offered; a custom upload waits for image uploads (D-4). */
export const LAUNCHER_ICON_OPTIONS: { value: LauncherIcon; label: string }[] = [
  { value: "chat", label: "Chat" },
  { value: "sparkle", label: "Sparkle" },
  { value: "help", label: "Help" },
];

export const POSITION_OPTIONS = [
  { value: "right", label: "Bottom right" },
  { value: "left", label: "Bottom left" },
] as const;

/**
 * Tidies a typed color into `#RRGGBB`: adds a missing `#`, expands
 * `#abc`, upper-cases. Anything else comes back trimmed, unchanged, so the
 * schema can show its error next to the field.
 */
export function normalizeHex(input: string): string {
  const raw = input.trim();
  const hex = raw.startsWith("#") ? raw.slice(1) : raw;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${[...hex].map((c) => c + c).join("").toUpperCase()}`;
  }
  return raw;
}

export interface PreviewBrand {
  background: string;
  color: "#000000" | "#ffffff";
}

/**
 * The colors the preview paints with: the brand color and a readable text
 * color on it, exactly as the widget picks them. While the typed color is
 * still invalid, the preview keeps the default instead of breaking.
 */
export function previewBrand(primaryColor: string): PreviewBrand {
  const hex = normalizeHex(primaryColor);
  const background = HEX6.test(hex) ? hex : DEFAULT_COLOR;
  return { background, color: textOn(background) };
}

/** What the visitor sees as the chat's title: the header title, else the bot's name. */
export function previewTitle(headerTitle: string, botName: string): string {
  return headerTitle.trim() || botName.trim() || "Assistant";
}

/** The launcher icon the widget will draw: a custom one shows the default until uploads exist. */
export function previewIcon(icon: LauncherIcon | "custom"): LauncherIcon {
  return icon === "custom" ? "chat" : icon;
}
