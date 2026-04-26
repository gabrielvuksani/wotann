import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // pool: "threads" was tried but broke local runs (some test
    // files mutate process-globals on import that don't tolerate
    // shared V8 contexts). Back to forks. CI uses --shard splitting
    // to avoid the OOM cliff that single-fork hit at ~146 s — see
    // .github/workflows/ci.yml `Test` step.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
