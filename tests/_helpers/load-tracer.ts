/**
 * Test file load tracer — gated by WOTANN_TEST_TRACE_LOAD env var.
 *
 * When set, prints `[load] <file>` to stderr when each test file's
 * setup runs. Used to diagnose CI-only hangs where the next test file
 * loaded after a checkpoint never finishes (vitest's default reporter
 * only prints ✓ on COMPLETION, not on load, so a hung file is
 * invisible).
 *
 * Imported as a setupFile in vitest.config.ts only when the env var
 * is set — zero cost otherwise.
 */
import { beforeAll } from "vitest";

if (process.env["WOTANN_TEST_TRACE_LOAD"] === "1") {
  // expect.getState().testPath is the most reliable per-file identifier
  // available from the setup phase. Fall back to a stable timestamp if
  // the API isn't available (older vitest versions).
  beforeAll(() => {
    try {
      // @ts-expect-error — vitest's expect.getState is not in the global
      // type for TS but available at runtime when globals: true.
      const { testPath } = expect.getState();
      const rel = testPath ? testPath.replace(process.cwd() + "/", "") : "<unknown>";
      process.stderr.write(`[wotann-load] ${new Date().toISOString()} ${rel}\n`);
    } catch {
      process.stderr.write(`[wotann-load] ${new Date().toISOString()} <unknown>\n`);
    }
  });
}
