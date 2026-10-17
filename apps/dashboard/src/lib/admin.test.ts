import { describe, expect, it } from "vitest";
import { adminQueryString } from "./admin";

describe("adminQueryString", () => {
  it("is empty without filters", () => {
    expect(adminQueryString({})).toBe("");
    expect(adminQueryString({ q: "   " })).toBe("");
  });

  it("trims the search and keeps status, cursor and limit", () => {
    expect(
      adminQueryString({ q: " acme ", status: "SUSPENDED", cursor: "c1", limit: 25 }),
    ).toBe("?q=acme&status=SUSPENDED&cursor=c1&limit=25");
  });
});
