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
  it("adds /v1 to the build's API origin, local API by default", () => {
    expect(apiBaseFrom("https://api.example.com/")).toBe("https://api.example.com/v1");
    expect(apiBaseFrom(undefined)).toBe("http://localhost:3001/v1");
    expect(apiBaseFrom("")).toBe("http://localhost:3001/v1");
  });
});
