import { describe, expect, it } from "vitest";
import { attachmentName, leadQueryString, leadTitle } from "./leads";

describe("leadQueryString", () => {
  it("leaves blanks out and keeps every filter", () => {
    expect(leadQueryString({})).toBe("");
    expect(leadQueryString({ q: "  ", from: "" })).toBe("");
    expect(
      leadQueryString({ q: " ana ", from: "2026-10-01", to: "2026-10-17", cursor: "abc", limit: 25 }),
    ).toBe("?q=ana&from=2026-10-01&to=2026-10-17&cursor=abc&limit=25");
  });
});

describe("leadTitle", () => {
  it("prefers the name, then email, then phone", () => {
    expect(leadTitle({ name: "Ana", email: "a@x.co", phone: null })).toBe("Ana");
    expect(leadTitle({ name: null, email: "a@x.co", phone: "+880" })).toBe("a@x.co");
    expect(leadTitle({ name: null, email: null, phone: "+880" })).toBe("+880");
    expect(leadTitle({ name: null, email: null, phone: null })).toBe("Unnamed lead");
  });
});

describe("attachmentName", () => {
  it("reads the API's file name, else uses today's date", () => {
    expect(attachmentName('attachment; filename="leads-2026-10-17.csv"')).toBe(
      "leads-2026-10-17.csv",
    );
    expect(attachmentName(null, new Date("2026-10-18T05:00:00Z"))).toBe("leads-2026-10-18.csv");
  });
});
