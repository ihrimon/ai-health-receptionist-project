/// <reference types="vitest/config" />
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * The chat window that the loader (`chatbot.js`) opens in an iframe on a
 * company's site (decision T8: Vite + Preact + Tailwind, kept tiny). The
 * build is static files in `dist/`; the server-served page with the
 * `frame-ancestors` header (M4-19) will load them.
 */
export default defineConfig({
  plugins: [preact(), tailwindcss()],
  // Relative asset URLs, so the files work from any CDN path.
  base: "./",
  server: { port: 3002, strictPort: true },
  preview: { port: 3002, strictPort: true },
  build: { target: "es2020" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
