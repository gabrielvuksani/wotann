/**
 * WOTANN home directory resolution.
 *
 * Centralizes the rule: the user's WOTANN data directory is
 * `process.env.WOTANN_HOME` when set, else `~/.wotann`.
 *
 * Background: prior to SB-10, only `src/session/creations.ts` honored
 * `WOTANN_HOME` — every other site silently used `homedir() + ".wotann"`,
 * so `wotann doctor` would inspect one directory while the daemon wrote to
 * another. This helper makes the env override actually work everywhere.
 *
 * Quality bars:
 *   - QB#7: pure function, env is read on every call (NOT cached at
 *     module load). Long-running tests can mutate process.env between
 *     calls and the next caller will see the new value.
 *   - QB#6: we never validate the path or touch the filesystem here.
 *     If the user points WOTANN_HOME at a non-existent directory, the
 *     downstream code (mkdirSync, readFileSync, etc.) will surface
 *     ENOENT in its natural shape — not crash inside this resolver.
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Canonical name of the override env var. Use this constant rather than
 * the raw string so renames and grep-audits stay typesafe.
 */
export const WOTANN_HOME_ENV_VAR = "WOTANN_HOME";

/**
 * Returns the WOTANN home directory: `process.env.WOTANN_HOME` if
 * set to a non-empty string, else `${homedir()}/.wotann`.
 *
 * Pure: re-reads `process.env` every call, no caching.
 */
export function resolveWotannHome(): string {
  const override = process.env[WOTANN_HOME_ENV_VAR];
  if (typeof override === "string" && override.length > 0) {
    return override;
  }
  return join(homedir(), ".wotann");
}

/**
 * Convenience helper for `${resolveWotannHome()}/<name>` — saves
 * callers from importing `join` separately and keeps the
 * env-override logic in one place.
 */
export function resolveWotannHomeSubdir(...segments: readonly string[]): string {
  return join(resolveWotannHome(), ...segments);
}
