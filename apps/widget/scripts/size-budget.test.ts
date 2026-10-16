import type { Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import { gzipSize, sizeBudget } from "./size-budget";

type Hook = (this: unknown, options: unknown, bundle: unknown) => void;

/** Runs the plugin's hook on a fake bundle with one JS file. */
function run(maxBytes: number, code: string) {
  const ctx = {
    error: vi.fn((msg: string) => {
      throw new Error(msg);
    }),
    info: vi.fn(),
  };
  const bundle = { "chatbot.js": { type: "chunk", fileName: "chatbot.js", code } };
  const plugin: Plugin = sizeBudget(maxBytes);
  (plugin.generateBundle as Hook).call(ctx, {}, bundle);
  return ctx;
}

// Text that barely compresses, so its gzip size stays near its length.
const noise = (n: number) => Array.from({ length: n }, (_, i) => ((i * 7919) % 9973).toString(36)).join("");

describe("sizeBudget (M4-8)", () => {
  it("measures gzip size", () => {
    expect(gzipSize("a".repeat(10_000))).toBeLessThan(100);
  });

  it("passes a file under the budget and reports its size", () => {
    const ctx = run(10 * 1024, "console.log(1)");
    expect(ctx.error).not.toHaveBeenCalled();
    expect(ctx.info).toHaveBeenCalledWith(expect.stringContaining("chatbot.js"));
  });

  it("fails the build for a file over the budget", () => {
    const code = noise(20_000);
    expect(gzipSize(code)).toBeGreaterThan(1024);
    expect(() => run(1024, code)).toThrow(/over the 1024-byte budget/);
  });
});
