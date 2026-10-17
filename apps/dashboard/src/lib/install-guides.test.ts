import { describe, expect, it } from "vitest";
import { INSTALL_GUIDES, splitInlineCode } from "./install-guides";

describe("INSTALL_GUIDES", () => {
  it("covers plain HTML, Shopify and WooCommerce/WordPress, once each", () => {
    expect(INSTALL_GUIDES.map((g) => g.id)).toEqual(["html", "shopify", "wordpress"]);
  });

  it("shows the snippet exactly once in every guide", () => {
    for (const g of INSTALL_GUIDES) {
      expect(g.steps.filter((s) => s.snippet), g.id).toHaveLength(1);
    }
  });

  it("names where the code goes on each platform", () => {
    const text = (id: string) =>
      INSTALL_GUIDES.find((g) => g.id === id)!.steps.map((s) => s.text).join(" ");
    expect(text("html")).toContain("`</body>`");
    expect(text("shopify")).toContain("`theme.liquid`");
    expect(text("wordpress")).toContain("Footer");
  });

  it("closes every backtick so no code mark leaks into the page", () => {
    for (const g of INSTALL_GUIDES) {
      for (const line of [g.intro, ...g.tips, ...g.steps.map((s) => s.text)]) {
        expect(line.split("`").length % 2, line).toBe(1);
      }
    }
  });
});

describe("splitInlineCode", () => {
  it("marks backticked parts as code", () => {
    expect(splitInlineCode("Paste above `</body>` and save")).toEqual([
      { text: "Paste above ", code: false },
      { text: "</body>", code: true },
      { text: " and save", code: false },
    ]);
  });

  it("returns plain text unchanged", () => {
    expect(splitInlineCode("Click Save")).toEqual([{ text: "Click Save", code: false }]);
  });
});
