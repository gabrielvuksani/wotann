/**
 * execFile promise that resolves with stdout/stderr/exitCode instead of
 * throwing — callers decide whether a non-zero exit is fatal.
 *
 * Canonical safe-exec used across WOTANN: spawns via `execFile`, so all
 * arguments are passed as argv (never interpolated into a shell string),
 * which structurally prevents command injection regardless of input
 * content.
 *
 * Extracted from `src/index.ts` so subprocess-backend modules (e.g.
 * `src/providers/claude-cli-backend.ts`) can share the same contract
 * without pulling the entire CLI entrypoint.
 */
export async function execFileNoThrow(
  file: string,
  args: readonly string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { execFile } = await import("node:child_process");
  return await new Promise((resolve) => {
    execFile(file, args as string[], (error, stdout, stderr) => {
      const exitCode =
        error && typeof (error as NodeJS.ErrnoException).code === "number"
          ? Number((error as NodeJS.ErrnoException).code)
          : error
            ? 1
            : 0;
      resolve({
        exitCode,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? (error instanceof Error ? error.message : ""),
      });
    });
  });
}
