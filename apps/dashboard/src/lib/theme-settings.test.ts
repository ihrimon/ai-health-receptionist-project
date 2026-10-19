import { describe, expect, it } from "vitest";
import {
  brandOf,
  isHexColor,
  textOn,
  THEME_INIT_SCRIPT,
  type ThemeSettings,
} from "./theme-settings";

const base: ThemeSettings = {
  accent: "emerald",
  custom: "#123456",
  radius: "sharp",
  bodyFont: "inter",
  headingFont: null,
  textSize: "medium",
  density: "comfortable",
};

describe("theme settings", () => {
  it("accepts only #RRGGBB colors", () => {
    expect(isHexColor("#059669")).toBe(true);
    expect(isHexColor("059669")).toBe(false);
    expect(isHexColor("#05966")).toBe(false);
    expect(isHexColor("red;background:url(x)")).toBe(false);
  });

  it("uses the chosen accent, or the custom color when selected", () => {
    expect(brandOf(base)).toBe("#059669");
    expect(brandOf({ ...base, accent: "rose" })).toBe("#e11d48");
    expect(brandOf({ ...base, accent: "custom" })).toBe("#123456");
    expect(brandOf({ ...base, accent: "custom", custom: "nope" })).toBe("#059669");
  });

  it("picks readable text for light and dark colors", () => {
    expect(textOn("#059669")).toBe("#ffffff");
    expect(textOn("#facc15")).toBe("#111111");
    expect(textOn("#000000")).toBe("#ffffff");
    expect(textOn("#ffffff")).toBe("#111111");
  });

  it("keeps the saved values out of the page script's reach to run code", () => {
    expect(THEME_INIT_SCRIPT).toContain("bs-theme");
    expect(THEME_INIT_SCRIPT).toContain("/^[a-z-]+$/");
  });
});
