import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // Limit pool size so 2-core GH runners don't get preempted mid-suite.
    // Locally vitest defaults to NUM_CPUS workers; capping at 2 keeps the
    // memory footprint reasonable on hosted runners.
    pool: "forks",
    maxConcurrency: 2,
    fileParallelism: false,
  },
});
