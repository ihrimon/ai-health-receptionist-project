import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce, isWidgetPath } from "./csp";

const base = { nonce: "abc123", apiOrigin: "https://api.example.com" };

function directive(csp: string, name: string) {
  return csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
}

describe("buildCsp", () => {
  it("production: nonce scripts, no unsafe-inline or unsafe-eval", () => {
    const script = directive(buildCsp({ ...base, isDev: false }), "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("dev: allows unsafe-eval and websockets, still no unsafe-inline for scripts", () => {
    const csp = buildCsp({ ...base, isDev: true });
    const script = directive(csp, "script-src");
    expect(script).toContain("'unsafe-eval'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(directive(csp, "connect-src")).toContain("ws: wss:");
  });

  it("keeps the other protections", () => {
    const csp = buildCsp({ ...base, isDev: false });
    expect(directive(csp, "connect-src")).toBe(
      "connect-src 'self' https://api.example.com",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});

describe("generateNonce", () => {
  it("is unique and header-safe", () => {
    const a = generateNonce();
    expect(a).not.toBe(generateNonce());
    expect(a).toMatch(/^[A-Za-z0-9+/=]+$/);
  });
});

describe("isWidgetPath", () => {
  it.each(["/w/pub_123", "/w"])("true for %s", (p) => {
    expect(isWidgetPath(p)).toBe(true);
  });
  it.each(["/", "/app", "/wx", "/help/w/x"])("false for %s", (p) => {
    expect(isWidgetPath(p)).toBe(false);
  });
});
