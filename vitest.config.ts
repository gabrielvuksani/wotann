import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // Default vitest pool/maxWorkers settings — let it use NUM_CPUS
    // workers in parallel. CI ubuntu-latest has 4 cores; each gets
    // its own fork. This was the original config before the OOM
    // hunting; reverting because all the constraint experiments
    // (maxWorkers: 1, threads, sharding, heap bumps, timeout bumps)
    // hit the same 88-second cancellation cliff in CI even when
    // local runs were fine. The shard step in CI starts a fresh
    // process anyway, so worker isolation isn't the bottleneck.
  },
});
