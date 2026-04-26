import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist"],
    testTimeout: 10_000,
    // pool: "forks" hits vitest 4 known issue (#8861) of IPC stalls in
    // CI that look like SIGKILL. pool: "threads" doesn't work because
    // tests use process.chdir/exit (not supported in true workers).
    // pool: "vmThreads" is the third option — uses Node vm contexts
    // inside threads, gets thread-like perf without thread isolation
    // restrictions, supports process.chdir/exit.
    pool: "vmThreads",
    maxWorkers: 1,
    fileParallelism: false,
  },
});
