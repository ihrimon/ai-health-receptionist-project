"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { applyFavicon } from "@/lib/favicon";

/** The six built-in accents (hex = the 600 shade of each Tailwind color). */
export const ACCENTS = [
  { id: "indigo", label: "Indigo", hex: "#4f46e5" },
  { id: "blue", label: "Blue", hex: "#2563eb" },
  { id: "emerald", label: "Emerald", hex: "#059669" },
  { id: "violet", label: "Violet", hex: "#7c3aed" },
  { id: "rose", label: "Rose", hex: "#e11d48" },
  { id: "orange", label: "Orange", hex: "#ea580c" },
] as const;

export type AccentId = (typeof ACCENTS)[number]["id"] | "custom";
export type RadiusId = "sharp" | "balanced" | "rounded";
export type FontId =
  | "inter"
  | "poppins"
  | "jakarta"
  | "dm-sans"
  | "manrope"
  | "lora"
  | "system";
export type TextSizeId = "small" | "medium" | "large";
export type DensityId = "compact" | "comfortable" | "relaxed";

export const DEFAULT_ACCENT: AccentId = "emerald";
export const DEFAULT_CUSTOM = "#059669";
export const RADII: { id: RadiusId; label: string }[] = [
  { id: "sharp", label: "Sharp" },
  { id: "balanced", label: "Balanced" },
  { id: "rounded", label: "Rounded" },
];
/** Loaded in the root layout; only the ones in use are downloaded. */
export const FONTS: { id: FontId; label: string }[] = [
  { id: "inter", label: "Inter" },
  { id: "poppins", label: "Poppins" },
  { id: "jakarta", label: "Plus Jakarta Sans" },
  { id: "dm-sans", label: "DM Sans" },
  { id: "manrope", label: "Manrope" },
  { id: "lora", label: "Lora (serif)" },
  { id: "system", label: "System default" },
];
export const TEXT_SIZES: { id: TextSizeId; label: string }[] = [
  { id: "small", label: "Small" },
  { id: "medium", label: "Medium" },
  { id: "large", label: "Large" },
];
export const DENSITIES: { id: DensityId; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
  { id: "relaxed", label: "Relaxed" },
];

/** Per-browser, like the light/dark choice. */
export const THEME_STORAGE_KEY = "bs-theme";

export interface ThemeSettings {
  accent: AccentId;
  /** Last custom color, kept even while a built-in accent is selected. */
  custom: string;
  radius: RadiusId;
  /** Body text font. */
  bodyFont: FontId;
  /** Headings font; null follows the body font. */
  headingFont: FontId | null;
  textSize: TextSizeId;
  density: DensityId;
}

const DEFAULTS: ThemeSettings = {
  accent: DEFAULT_ACCENT,
  custom: DEFAULT_CUSTOM,
  radius: "sharp",
  bodyFont: "inter",
  headingFont: null,
  textSize: "medium",
  density: "comfortable",
};

function pick<T extends string>(
  options: { id: T }[],
  value: unknown,
  fallback: T,
): T {
  return options.some((o) => o.id === value) ? (value as T) : fallback;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

/** Text color that stays readable on top of `hex`. */
export function textOn(hex: string): "#ffffff" | "#111111" {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111111" : "#ffffff";
}

export function brandOf(settings: ThemeSettings): string {
  if (settings.accent === "custom" && isHexColor(settings.custom)) {
    return settings.custom.toLowerCase();
  }
  return (
    ACCENTS.find((a) => a.id === settings.accent)?.hex ??
    ACCENTS.find((a) => a.id === DEFAULT_ACCENT)!.hex
  );
}

function read(): ThemeSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? "null");
    if (!raw || typeof raw !== "object") return DEFAULTS;
    const accent: AccentId =
      raw.accent === "custom" || ACCENTS.some((a) => a.id === raw.accent)
        ? raw.accent
        : DEFAULT_ACCENT;
    return {
      accent,
      custom: isHexColor(raw.custom ?? "") ? raw.custom : DEFAULT_CUSTOM,
      radius: pick(RADII, raw.radius, DEFAULTS.radius),
      bodyFont: pick(FONTS, raw.bodyFont, DEFAULTS.bodyFont),
      headingFont:
        raw.headingFont === null || raw.headingFont === undefined
          ? null
          : pick(FONTS, raw.headingFont, DEFAULTS.bodyFont),
      textSize: pick(TEXT_SIZES, raw.textSize, DEFAULTS.textSize),
      density: pick(DENSITIES, raw.density, DEFAULTS.density),
    };
  } catch {
    return DEFAULTS;
  }
}

function apply(settings: ThemeSettings) {
  const root = document.documentElement;
  const brand = brandOf(settings);
  root.style.setProperty("--brand", brand);
  root.style.setProperty("--brand-foreground", textOn(brand));
  root.dataset.radius = settings.radius;
  root.dataset.fontBody = settings.bodyFont;
  root.dataset.fontHeading = settings.headingFont ?? settings.bodyFont;
  root.dataset.textSize = settings.textSize;
  root.dataset.density = settings.density;
  try {
    // The resolved values are stored too, so the inline script in the root
    // layout can paint the right color before React loads (no flash).
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        ...settings,
        brand,
        fg: textOn(brand),
      }),
    );
  } catch {
    // Private mode: the theme still applies for this visit.
  }
}

/**
 * Runs in <head> before the page paints. Only reads the values `apply`
 * stored; the CSS falls back to the emerald default when nothing is stored.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})||"null");if(!s)return;var r=document.documentElement;if(/^#[0-9a-f]{6}$/i.test(s.brand||"")&&/^#[0-9a-f]{6}$/i.test(s.fg||"")){r.style.setProperty("--brand",s.brand);r.style.setProperty("--brand-foreground",s.fg)}var ids=/^[a-z-]+$/;var d=r.dataset;if(ids.test(s.radius||""))d.radius=s.radius;if(ids.test(s.bodyFont||"")){d.fontBody=s.bodyFont;d.fontHeading=ids.test(s.headingFont||"")?s.headingFont:s.bodyFont}if(ids.test(s.textSize||""))d.textSize=s.textSize;if(ids.test(s.density||""))d.density=s.density}catch(e){}})();`;

interface ThemeSettingsValue {
  settings: ThemeSettings;
  brand: string;
  setAccent: (accent: AccentId) => void;
  setCustom: (hex: string) => void;
  setRadius: (radius: RadiusId) => void;
  setBodyFont: (font: FontId) => void;
  setHeadingFont: (font: FontId | null) => void;
  setTextSize: (size: TextSizeId) => void;
  setDensity: (density: DensityId) => void;
  reset: () => void;
}

const ThemeSettingsContext = createContext<ThemeSettingsValue | null>(null);

export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(DEFAULTS);

  useEffect(() => {
    // Read after mount so server and first client render match.
    Promise.resolve(read()).then(setSettings);
  }, []);

  // The tab icon follows the accent, also on first load and after a reload.
  const brandColor = brandOf(settings);
  useEffect(() => {
    applyFavicon(brandColor, textOn(brandColor));
  }, [brandColor]);

  const update = useCallback((next: ThemeSettings) => {
    setSettings(next);
    apply(next);
  }, []);

  const value = useMemo<ThemeSettingsValue>(
    () => ({
      settings,
      brand: brandOf(settings),
      setAccent: (accent) => update({ ...settings, accent }),
      setCustom: (hex) => update({ ...settings, accent: "custom", custom: hex }),
      setRadius: (radius) => update({ ...settings, radius }),
      setBodyFont: (bodyFont) => update({ ...settings, bodyFont }),
      setHeadingFont: (headingFont) => update({ ...settings, headingFont }),
      setTextSize: (textSize) => update({ ...settings, textSize }),
      setDensity: (density) => update({ ...settings, density }),
      reset: () => update(DEFAULTS),
    }),
    [settings, update],
  );

  return (
    <ThemeSettingsContext.Provider value={value}>
      {children}
    </ThemeSettingsContext.Provider>
  );
}

export function useThemeSettings(): ThemeSettingsValue {
  const ctx = useContext(ThemeSettingsContext);
  if (!ctx) {
    throw new Error("useThemeSettings must be used inside ThemeSettingsProvider");
  }
  return ctx;
}
