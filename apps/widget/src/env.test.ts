import { describe, expect, it } from "vitest";
import { apiBaseFrom, publicIdFrom } from "./env";

describe("publicIdFrom", () => {
  it("reads the chatbot from /w/<publicId>, under any prefix", () => {
    expect(publicIdFrom("/w/abc123")).toBe("abc123");
    expect(publicIdFrom("/w/abc123/")).toBe("abc123");
    expect(publicIdFrom("/widget/w/abc%20x")).toBe("abc x");
  });

  it("has no chatbot on any other path", () => {
    expect(publicIdFrom("/")).toBeNull();
    expect(publicIdFrom("/w/")).toBeNull();
    expect(publicIdFrom("/w/abc/extra")).toBeNull();
    expect(publicIdFrom("/w/%E0%A4%A")).toBeNull();
  });
});

describe("apiBaseFrom", () => {
  it("adds /v1 to the build's API origin, or to the fallback when unset", () => {
    expect(apiBaseFrom("https://api.example.com/", "https://x.test")).toBe("https://api.example.com/v1");
    expect(apiBaseFrom(undefined, "https://page.example.com")).toBe("https://page.example.com/v1");
    expect(apiBaseFrom("", "http://localhost:3001")).toBe("http://localhost:3001/v1");
  });
});
