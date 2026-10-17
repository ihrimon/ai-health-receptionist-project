import { describe, expect, it } from "vitest";
import {
  conversationQueryString,
  isSafeLink,
  originLabel,
  sourceLabel,
  timeAgo,
  visitorLabel,
} from "./conversations";

describe("conversationQueryString", () => {
  it("leaves blanks out and keeps every filter", () => {
    expect(conversationQueryString({})).toBe("");
    expect(conversationQueryString({ q: "  ", from: "" })).toBe("");
    expect(
      conversationQueryString({
        q: " refund ",
        from: "2026-10-01",
        to: "2026-10-17",
        rating: "none",
        hasLead: "true",
        cursor: "abc",
        limit: 25,
      }),
    ).toBe("?q=refund&from=2026-10-01&to=2026-10-17&rating=none&hasLead=true&cursor=abc&limit=25");
  });
});

describe("labels", () => {
  it("names a visitor by the end of their random ID", () => {
    expect(visitorLabel("3f2c-9a1d-77c2-a91f")).toBe("Visitor #a91f");
    expect(visitorLabel("--")).toBe("Visitor #????");
  });

  it("shortens the origin URL", () => {
    expect(originLabel("https://www.acme.com/products/wallet?x=1")).toBe(
      "acme.com/products/wallet",
    );
    expect(originLabel("https://acme.com/")).toBe("acme.com");
    expect(originLabel("not a url")).toBe("not a url");
    expect(originLabel(null)).toBeNull();
  });

  it("links only http(s) pages", () => {
    expect(isSafeLink("https://acme.com/a")).toBe(true);
    expect(isSafeLink("javascript:alert(1)")).toBe(false);
    expect(isSafeLink("nope")).toBe(false);
    expect(isSafeLink(null)).toBe(false);
  });

  it("shows a source with its page and score", () => {
    expect(sourceLabel({ title: "Returns", page: 2, similarity: 0.8164 })).toBe(
      "Returns · p. 2 (0.82)",
    );
    expect(sourceLabel({ title: "FAQ", page: null, similarity: 1 })).toBe("FAQ (1.00)");
  });

  it("says how long ago, in rough units", () => {
    const now = Date.parse("2026-10-17T12:00:00Z");
    expect(timeAgo("2026-10-17T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-10-17T11:58:00Z", now)).toBe("2m ago");
    expect(timeAgo("2026-10-17T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-10-14T12:00:00Z", now)).toBe("3d ago");
    expect(timeAgo("2026-09-01T12:00:00Z", now)).not.toMatch(/ago/);
  });
});
