import { MAX_ALLOWED_DOMAINS } from "@brainstack/shared";
import { describe, expect, it } from "vitest";
import { addDomain } from "./allowed-domains";

describe("addDomain", () => {
  it("adds a normalized domain at the end", () => {
    expect(addDomain(["a.example.com"], " https://Shop.Example.com/ ")).toEqual(
      { ok: true, domains: ["a.example.com", "shop.example.com"] },
    );
  });

  it("accepts wildcards and localhost for testing", () => {
    expect(addDomain([], "*.example.com").ok).toBe(true);
    expect(addDomain([], "localhost:3000").ok).toBe(true);
  });

  it("refuses blanks, duplicates and bad domains with a reason", () => {
    expect(addDomain([], "  ")).toEqual({
      ok: false,
      error: "Type a domain first.",
    });
    expect(addDomain(["shop.example.com"], "SHOP.example.com")).toEqual({
      ok: false,
      error: "shop.example.com is already on the list.",
    });
    const bad = addDomain([], "shop.example.com/checkout");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("no paths");
    expect(addDomain([], "example").ok).toBe(false);
  });

  it(`stops at ${MAX_ALLOWED_DOMAINS} domains`, () => {
    const full = Array.from(
      { length: MAX_ALLOWED_DOMAINS },
      (_, i) => `s${i}.example.com`,
    );
    expect(addDomain(full, "one-more.example.com").ok).toBe(false);
  });
});
