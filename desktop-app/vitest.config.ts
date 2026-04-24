/**
 * Vitest config — WOTANN Desktop.
 *
 * Owned by V9 T1.2 so the desktop-app's in-tree `*.test.ts` files
 * (currently just `src/daemon/sse-consumer.test.ts`) can be run
 * without inheriting the parent monorepo's `tests/**` include
 * filter. The parent `vitest.config.ts` at the repo root intentionally
 * scopes to `tests/**` — desktop-app has its own package boundary
 * and deserves its own test runner config.
 *
 * Invoke from the desktop-app/ directory with:
 *   npx vitest run
 *
 * Or from the monorepo root:
 *   npx vitest run --config=desktop-app/vitest.config.ts
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // Use the default threaded pool — the monorepo root config uses
    // forks (for 2-core CI memory limits) but desktop-app has no
    // nested `node_modules/vitest` worker binary, so forks time out
    // resolving the worker script from the sub-package.
    environment: "node",
  },
});
