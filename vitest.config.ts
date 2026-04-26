import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // After exhausting forks (vitest 4 IPC stall in CI), threads
    // (process.chdir/exit incompat), and vmThreads (env pollution
    // from tests that mutate process.env without cleanup): forks
    // remains the only pool that runs all 583 files cleanly LOCALLY.
    // The CI flake on ubuntu-22.04 is mitigated at the WORKFLOW
    // level via matrix-parallel shards in .github/workflows/ci.yml —
    // each shard gets its own runner, capping per-process memory.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    // setupFiles run before each test file. The load-tracer is gated
    // by WOTANN_TEST_TRACE_LOAD=1 — when set, each file's setup logs
    // `[wotann-load] <iso-ts> <file>` to stderr so a hung CI run can
    // be diagnosed by reading the LAST line before the cancel marker.
    setupFiles: ["./tests/_helpers/load-tracer.ts"],
  },
});
