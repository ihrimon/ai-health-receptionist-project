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

export const DEFAULT_ACCENT: AccentId = "emerald";
export const DEFAULT_CUSTOM = "#059669";
export const RADII: { id: RadiusId; label: string }[] = [
  { id: "sharp", label: "Sharp" },
  { id: "balanced", label: "Balanced" },
  { id: "rounded", label: "Rounded" },
];

/** Per-browser, like the light/dark choice. */
export const THEME_STORAGE_KEY = "bs-theme";

export interface ThemeSettings {
  accent: AccentId;
  /** Last custom color, kept even while a built-in accent is selected. */
  custom: string;
  radius: RadiusId;
}

const DEFAULTS: ThemeSettings = {
  accent: DEFAULT_ACCENT,
  custom: DEFAULT_CUSTOM,
  radius: "balanced",
};

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
      radius: RADII.some((r) => r.id === raw.radius) ? raw.radius : "balanced",
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
)})||"null");if(!s)return;var r=document.documentElement;if(/^#[0-9a-f]{6}$/i.test(s.brand||"")&&/^#[0-9a-f]{6}$/i.test(s.fg||"")){r.style.setProperty("--brand",s.brand);r.style.setProperty("--brand-foreground",s.fg)}if(s.radius==="sharp"||s.radius==="rounded")r.dataset.radius=s.radius}catch(e){}})();`;

interface ThemeSettingsValue {
  settings: ThemeSettings;
  brand: string;
  setAccent: (accent: AccentId) => void;
  setCustom: (hex: string) => void;
  setRadius: (radius: RadiusId) => void;
  reset: () => void;
}

const ThemeSettingsContext = createContext<ThemeSettingsValue | null>(null);

export function ThemeSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ThemeSettings>(DEFAULTS);

  useEffect(() => {
    // Read after mount so server and first client render match.
    Promise.resolve(read()).then(setSettings);
  }, []);

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
