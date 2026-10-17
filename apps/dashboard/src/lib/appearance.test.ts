import { chatbotConfigSchema, defaultChatbotConfig } from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import {
  COLOR_PRESETS,
  normalizeHex,
  previewBrand,
  previewIcon,
  previewTitle,
} from "./appearance";

describe("normalizeHex", () => {
  it("tidies a typed color into #RRGGBB", () => {
    expect(normalizeHex("#0f766e")).toBe("#0F766E");
    expect(normalizeHex(" 0f766e ")).toBe("#0F766E");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("fff")).toBe("#FFFFFF");
  });

  it("leaves anything else as typed, for the schema to reject", () => {
    expect(normalizeHex("teal")).toBe("teal");
    expect(normalizeHex("#12345")).toBe("#12345");
    expect(normalizeHex("")).toBe("");
  });
});

describe("previewBrand", () => {
  it("paints with the brand color and readable text on it", () => {
    expect(previewBrand("#18181B")).toEqual({ background: "#18181B", color: "#ffffff" });
    expect(previewBrand("#FDE047")).toEqual({ background: "#FDE047", color: "#000000" });
  });

  it("keeps the default color while the typed one is invalid", () => {
    const fallback = defaultChatbotConfig("x").widget.primaryColor;
    expect(previewBrand("#12").background).toBe(fallback);
    expect(previewBrand("red;background:url(x)").background).toBe(fallback);
  });
});

describe("previewTitle and previewIcon", () => {
  it("falls back to the bot's name when the header title is blank", () => {
    expect(previewTitle("Acme Support", "Ava")).toBe("Acme Support");
    expect(previewTitle("  ", "Ava")).toBe("Ava");
    expect(previewTitle("", "")).toBe("Assistant");
  });

  it("shows the default icon for a custom one, like the widget", () => {
    expect(previewIcon("sparkle")).toBe("sparkle");
    expect(previewIcon("custom")).toBe("chat");
  });
});

describe("COLOR_PRESETS", () => {
  it("are all valid for the config schema", () => {
    for (const primaryColor of COLOR_PRESETS) {
      const config = defaultChatbotConfig("Acme");
      config.widget.primaryColor = primaryColor;
      expect(chatbotConfigSchema.safeParse(config).success).toBe(true);
    }
  });
});
