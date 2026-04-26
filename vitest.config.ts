import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // CI ubuntu-latest has 4 cores; default vitest spawns NUM_CPUS
    // workers in parallel and each gets its own V8 instance. With
    // 583 test files the parallel workers eat 4-8 GB combined and
    // get OOM-killed almost immediately (10s into shard 1/6).
    //
    // maxWorkers: 1 forces serial execution within each shard; the
    // shard split itself (6 sharded vitest invocations) gives the
    // cross-process isolation that prevents one fork accumulating
    // heap fragmentation across the full 583-file suite.
    //
    // Confirmed locally: shard 1/6 = 65s, shard 6/6 = 20s, all 6
    // shards together = ~3 min wall time, all 9552 tests pass.
    pool: "forks",
    maxWorkers: 1,
  },
});
