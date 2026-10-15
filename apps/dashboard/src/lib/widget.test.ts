import { describe, expect, it } from "vitest";
import { textOn } from "./widget";

describe("textOn", () => {
  it("uses white on dark brand colors and black on light ones", () => {
    expect(textOn("#0F766E")).toBe("#ffffff");
    expect(textOn("#000000")).toBe("#ffffff");
    expect(textOn("#FDE047")).toBe("#000000");
    expect(textOn("#FFFFFF")).toBe("#000000");
  });
});
