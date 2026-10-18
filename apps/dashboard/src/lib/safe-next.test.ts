import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/app/leads?x=1")).toBe("/app/leads?x=1");
  });

  it.each([
    null,
    "",
    "app",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "javascript:alert(1)",
  ])("falls back to /app for %j", (value) => {
    expect(safeNext(value)).toBe("/app");
  });
});
