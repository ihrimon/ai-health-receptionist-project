import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  firstSocial,
  TIME_ZONES,
  withSaved,
} from "./select-options";

describe("CURRENCIES", () => {
  it("starts with USD and every code is a real, unique ISO currency", () => {
    expect(CURRENCIES[0].value).toBe("USD");
    expect(new Set(CURRENCIES.map((c) => c.value)).size).toBe(CURRENCIES.length);
    const known = Intl.supportedValuesOf("currency");
    for (const c of CURRENCIES) expect(known).toContain(c.value);
  });
});

describe("TIME_ZONES", () => {
  it("starts with UTC and every name is a real, unique time zone", () => {
    expect(TIME_ZONES[0].value).toBe("UTC");
    expect(new Set(TIME_ZONES.map((z) => z.value)).size).toBe(TIME_ZONES.length);
    for (const z of TIME_ZONES) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: z.value })).not.toThrow();
      expect(z.description).toBeTruthy();
    }
  });
});

describe("withSaved", () => {
  it("keeps the list when the saved value is in it, or empty", () => {
    expect(withSaved(CURRENCIES, "BDT")).toBe(CURRENCIES);
    expect(withSaved(CURRENCIES, null)).toBe(CURRENCIES);
  });

  it("adds a saved value that is not in the list, without changing the list", () => {
    const list = withSaved(TIME_ZONES, "Europe/Rome");
    expect(list.at(-1)).toMatchObject({ value: "Europe/Rome" });
    expect(list).toHaveLength(TIME_ZONES.length + 1);
  });
});

describe("firstSocial", () => {
  it("is WhatsApp by default or when it has a number", () => {
    expect(firstSocial({})).toBe("whatsapp");
    expect(firstSocial({ whatsapp: "+1 555", facebook: "https://f" })).toBe("whatsapp");
  });

  it("is the first one with a value otherwise", () => {
    expect(firstSocial({ linkedin: "https://l", instagram: "https://i" })).toBe("linkedin");
  });
});
