/**
 * Vite config — WOTANN Desktop.
 *
 * Wave-4D bundle optimization:
 * - `manualChunks` splits vendor code (React, Tauri, Monaco binding, misc
 *   small utilities) into dedicated chunks so they cache independently and
 *   don't bloat the main entry bundle.
 * - Lazy-loaded views (via `React.lazy`) get their own chunks automatically
 *   via Rollup's dynamic-import heuristic; the `manualChunks` below never
 *   names them, so Rollup stays in control of which view goes where.
 * - Monaco's worker scripts are registered via `?worker` imports in
 *   `main.tsx` and Vite emits them as separate top-level chunks
 *   automatically.
 * - `chunkSizeWarningLimit` is tightened to 500 kB to keep us honest.
 * - `sourcemap: true` emits external `.map` files next to each bundle so
 *   crash reports, stack traces, and the DevTools debugger stay legible
 *   without inflating the shipped JS.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    // External `.map` files — Tauri's webview loads them on demand when
    // DevTools is open, so the shipped JS bundles stay tight. Inline
    // sourcemaps would triple the JS size (base64 data URIs embed the
    // entire map into the .js file) which defeats the purpose of
    // splitting chunks to keep the main bundle small.
    sourcemap: true,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Vendor splits — keyed on node_modules paths so Rollup can
          // hoist common deps without Vite re-discovering them per view.
          if (id.includes("node_modules")) {
            // React runtime (~140 kB min) — heaviest single vendor in
            // the eager graph; split so it caches across releases that
            // don't bump React.
            if (
              id.includes("/node_modules/react/") ||
              id.includes("/node_modules/react-dom/") ||
              id.includes("/node_modules/scheduler/")
            ) {
              return "vendor-react";
            }
            // Tauri bridge + plugins — every view touches `invoke`, so
            // splitting prevents N copies from N dynamic-import sites
            // (Vite's reporter flags this with the "also statically
            // imported" warning spam when it lives in main).
            if (id.includes("/node_modules/@tauri-apps/")) {
              return "vendor-tauri";
            }
            // @monaco-editor/react binding (not the full Monaco — Monaco
            // proper is tree-shaken by the lazy MonacoEditor chunk and
            // the language workers ship as separate files via
            // `?worker` imports in main.tsx).
            if (
              id.includes("/node_modules/@monaco-editor/") ||
              id.includes("/node_modules/monaco-editor/")
            ) {
              return "vendor-monaco";
            }
            // qrcode.react — only used by Settings/Companion; they're
            // lazy, so Rollup WILL split this on its own, but naming
            // it ensures a stable filename across releases.
            if (id.includes("/node_modules/qrcode.react/")) {
              return "vendor-qrcode";
            }
            // Small shared utilities — zustand store + virtualization.
            // Grouping here avoids a chunk-per-tiny-dep that balloons
            // the chunk count without saving bytes.
            if (
              id.includes("/node_modules/zustand/") ||
              id.includes("/node_modules/@tanstack/")
            ) {
              return "vendor-misc";
            }
            // Any other node_module stays in the default chunk the
            // caller requested — usually whichever dynamic-import site
            // pulled it in. Returning undefined = "let Rollup decide".
            return undefined;
          }
          return undefined;
        },
      },
    },
  },
  css: {
    devSourcemap: false,
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
