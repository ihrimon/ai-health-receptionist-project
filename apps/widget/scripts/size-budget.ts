import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

/** Bytes after gzip at the highest level (what a CDN serves at most). */
export function gzipSize(code: string | Uint8Array): number {
  return gzipSync(code, { level: 9 }).length;
}

/**
 * Fails the build when an emitted JS file is over `maxBytes` gzipped
 * (M4-8: the loader runs on every company's page, so it must stay tiny).
 * `pnpm build` runs it, so CI fails a pull request that breaks the budget.
 */
export function sizeBudget(maxBytes: number): Plugin {
  return {
    name: "brainstack-size-budget",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "chunk") continue;
        const size = gzipSize(file.code);
        if (size > maxBytes) {
          this.error(`${file.fileName} is ${size} bytes gzipped, over the ${maxBytes}-byte budget`);
        }
        this.info(`${file.fileName}: ${(size / 1024).toFixed(2)} KB gzipped (budget ${(maxBytes / 1024).toFixed(0)} KB)`);
      }
    },
  };
}
