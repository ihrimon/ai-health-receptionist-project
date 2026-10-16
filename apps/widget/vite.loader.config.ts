import { defineConfig } from "vite";
import { sizeBudget } from "./scripts/size-budget.ts";

/** M4-8: the loader's gzipped size limit; the build fails above it. */
const LOADER_BUDGET_BYTES = 10 * 1024;

/**
 * Builds the embed loader `chatbot.js` (M4-8): one self-running script with
 * no dependencies, next to the widget's own files in `dist/`, so the widget
 * host (or a CDN) serves both. `VITE_WIDGET_URL` (build env) is where it
 * opens the chat window; unset, the script's own origin.
 *
 * `--mode dashboard` builds the fallback copy the dashboard serves until
 * M4-19 (decisions.md): into the dashboard's `public/`, always pointing at
 * the dashboard's own `/w/:publicId` page.
 */
export default defineConfig(({ mode }) => ({
  publicDir: false,
  define: mode === "dashboard" ? { "import.meta.env.VITE_WIDGET_URL": "undefined" } : {},
  plugins: [sizeBudget(LOADER_BUDGET_BYTES)],
  build: {
    outDir: mode === "dashboard" ? "../dashboard/public" : "dist",
    // The widget's own build has just filled dist/; the dashboard's public/ has other files.
    emptyOutDir: false,
    // Runs on every company's site, so older browsers than the widget's.
    target: "es2018",
    lib: {
      entry: "src/loader/index.ts",
      formats: ["iife"],
      name: "BrainStackLoader",
      fileName: () => "chatbot.js",
    },
  },
}));
