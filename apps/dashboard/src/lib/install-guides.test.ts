import { describe, expect, it } from "vitest";
import { INSTALL_GUIDES, splitInlineCode } from "./install-guides";

describe("INSTALL_GUIDES", () => {
  it("covers HTML, React, Next.js, Shopify and WooCommerce/WordPress, once each", () => {
    expect(INSTALL_GUIDES.map((g) => g.id)).toEqual([
      "html",
      "react",
      "nextjs",
      "shopify",
      "wordpress",
    ]);
  });

  it("shows the company's code in every guide: the snippet, or ready-made framework code", () => {
    for (const g of INSTALL_GUIDES) {
      const shown = g.steps.filter((s) => s.snippet || s.code);
      expect(shown.length, g.id).toBeGreaterThan(0);
    }
    for (const id of ["html", "shopify", "wordpress"]) {
      const g = INSTALL_GUIDES.find((x) => x.id === id)!;
      expect(g.steps.filter((s) => s.snippet), id).toHaveLength(1);
    }
  });

  it("gives Next.js both routers and React a component", () => {
    const codes = (id: string) =>
      INSTALL_GUIDES.find((g) => g.id === id)!.steps.flatMap((s) =>
        s.code ? [s.code] : [],
      );
    expect(codes("nextjs")).toEqual(["next-layout", "next-pages"]);
    expect(codes("react")).toEqual(["react-component"]);
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
