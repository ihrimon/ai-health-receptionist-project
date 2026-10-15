import { LLM_KEY_PROVIDERS } from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import {
  canChat,
  maskedKey,
  PROVIDER_KEY_PAGES,
  PROVIDER_LABELS,
  SUGGESTED_MODELS,
} from "./llm-keys";

describe("llm keys", () => {
  it("shows only the last 4 characters", () => {
    expect(maskedKey({ keyLast4: "a1b2" })).toBe("…a1b2");
  });

  it("can chat only with a key switched on", () => {
    expect(canChat([])).toBe(false);
    expect(canChat([{ isActive: false }])).toBe(false);
    expect(canChat([{ isActive: false }, { isActive: true }])).toBe(true);
  });

  it("has a label, key page and model suggestions for every provider", () => {
    for (const p of LLM_KEY_PROVIDERS) {
      expect(PROVIDER_LABELS[p]).toBeTruthy();
      expect(PROVIDER_KEY_PAGES[p]).toMatch(/^https:\/\//);
      expect(SUGGESTED_MODELS[p].length).toBeGreaterThan(0);
    }
  });
});
