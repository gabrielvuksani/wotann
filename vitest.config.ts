import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // pool: "forks" — required because tests use `process.chdir()` and
    // `process.exit()` which throw "not supported in workers" under
    // pool: "threads". The CI flake (vitest-dev/vitest#8861) is then
    // mitigated at the WORKFLOW level via matrix-parallel shards in
    // .github/workflows/ci.yml — each shard gets its own runner with
    // its own clean V8 heap.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
