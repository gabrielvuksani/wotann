/**
 * Local vitest config for the MCP Apps client (V9 T4.2).
 *
 * The root `vitest.config.ts` scopes tests to `tests/**`, but the
 * T4.2 spec places the bridge unit tests alongside the source. This
 * scoped config picks up `mcp-bridge.test.ts` in this directory only;
 * invoke with:
 *
 *   npx vitest run -c desktop-app/src/components/mcp-apps/vitest.config.ts
 *
 * The config intentionally mirrors the root settings (globals, fork
 * pool, 10s timeout) so there's no test-runner behaviour drift.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Absolute paths, so the config works whether vitest is invoked
    // from repo root or from `desktop-app/`.
    include: [
      "desktop-app/src/components/mcp-apps/**/*.test.ts",
      "desktop-app/src/components/mcp-apps/**/*.test.tsx",
    ],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    pool: "forks",
  },
});
