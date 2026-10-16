import { describe, expect, it } from "vitest";
import { brandFor, textOn } from "./theme";

describe("textOn", () => {
  it("puts white text on dark colors", () => {
    expect(textOn("#000000")).toBe("#ffffff");
    expect(textOn("#2563eb")).toBe("#ffffff");
  });

  it("puts black text on light colors", () => {
    expect(textOn("#ffffff")).toBe("#000000");
    expect(textOn("#facc15")).toBe("#000000");
  });
});

describe("brandFor", () => {
  it("pairs the color with readable text", () => {
    expect(brandFor("#111111")).toEqual({ background: "#111111", color: "#ffffff" });
  });
});
