import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    pool: "forks",
    // Cap concurrent forks AND set fileParallelism so each fork executes
    // test FILES sequentially. With 583 files and the 4-core
    // ubuntu-latest runner (7 GB RAM):
    //   - Default vitest spawns NUM_CPUS workers, each defaulting to
    //     Node's ~4 GB max-old-space — instant OOM on the runner.
    //   - With maxWorkers: 2 alone, two workers still each consume up
    //     to 4 GB AND one of them leaks across files — we still hit
    //     OOM at ~73 s in CI.
    //   - The combination here (maxWorkers: 1 + fileParallelism: false)
    //     forces a single sequential pool. ~3 minutes locally, well
    //     under the 15-minute job timeout, with a hard memory ceiling.
    //   - For per-fork heap headroom, set NODE_OPTIONS in the test
    //     script invocation (CI sets `NODE_OPTIONS=--max-old-space-size=4096`).
    maxWorkers: 1,
    fileParallelism: false,
  },
});
