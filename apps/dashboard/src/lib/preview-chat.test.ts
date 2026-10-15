import { describe, expect, it } from "vitest";
import {
  handoffHref,
  handoffLabel,
  sourceLabel,
  uniqueSources,
} from "./preview-chat";

describe("sources", () => {
  it("shows the page when there is one", () => {
    expect(sourceLabel({ title: "Guide", page: 2, similarity: 0.7 })).toBe(
      "Guide (p. 2)",
    );
    expect(sourceLabel({ title: "FAQ", page: null, similarity: 0.7 })).toBe(
      "FAQ",
    );
  });

  it("lists each source once, in ranked order", () => {
    expect(
      uniqueSources([
        { title: "B", page: null, similarity: 0.9 },
        { title: "A", page: 1, similarity: 0.8 },
        { title: "B", page: null, similarity: 0.7 },
      ]),
    ).toEqual(["B", "A (p. 1)"]);
  });
});

describe("handoff", () => {
  it("links to mail, phone, WhatsApp or the web page", () => {
    const base = { label: null };
    expect(handoffHref({ ...base, kind: "email", value: "hi@shop.com" })).toBe(
      "mailto:hi@shop.com",
    );
    expect(
      handoffHref({ ...base, kind: "phone", value: "+880 1700-000000" }),
    ).toBe("tel:+8801700000000");
    expect(
      handoffHref({ ...base, kind: "whatsapp", value: "+880 1700-000000" }),
    ).toBe("https://wa.me/8801700000000");
    expect(
      handoffHref({ ...base, kind: "url", value: "https://shop.com/help" }),
    ).toBe("https://shop.com/help");
  });

  it("uses the company's label, or a default for the kind", () => {
    expect(
      handoffLabel({ kind: "email", value: "a@b.c", label: "Write to sales" }),
    ).toBe("Write to sales");
    expect(handoffLabel({ kind: "whatsapp", value: "1", label: null })).toBe(
      "Chat on WhatsApp",
    );
  });
});
