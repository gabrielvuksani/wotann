import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    pool: "forks",
    // Cap concurrent forks. The previous config commented "capping at
    // 2" but never set anything — vitest defaulted to NUM_CPUS workers.
    // With 583 test files on the 4-core ubuntu-latest runner (7 GB
    // RAM), the test step was OOM-killed at ~44s with the GH Actions
    // marker "##[error]The operation was canceled" (which is what
    // hosted runners emit when a worker crashes from out-of-memory
    // rather than from an explicit job timeout). Vitest 4 collapsed
    // the pool-options surface to a top-level `maxWorkers` field.
    maxWorkers: 2,
  },
});
