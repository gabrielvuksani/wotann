/**
 * Telemetry opt-out gate (A10).
 *
 * Honours the standard `DO_NOT_TRACK=1` env var, the WOTANN-specific
 * `WOTANN_NO_TELEMETRY=1`, and a `~/.wotann/no-telemetry` sentinel file.
 * Every telemetry sink must call `isTelemetryEnabled()` before emitting —
 * this is the single source of truth so users have exactly one lever to
 * pull for full privacy mode.
 */

import { existsSync } from "node:fs";
import { resolveWotannHomeSubdir } from "../utils/wotann-home.js";

const SENTINEL_PATH = resolveWotannHomeSubdir("no-telemetry");

let cachedValue: boolean | null = null;

/**
 * Returns true if telemetry should be emitted, false if the user opted out.
 *
 * Opt-out triggers:
 *  - `DO_NOT_TRACK=1` or `DO_NOT_TRACK=true` (industry standard)
 *  - `WOTANN_NO_TELEMETRY=1` or `=true`
 *  - File `~/.wotann/no-telemetry` exists (survives env wipes, works in CI)
 *
 * Default: telemetry enabled. Result is cached after first call for
 * hot-path performance; call `resetTelemetryCache()` in tests.
 */
export function isTelemetryEnabled(): boolean {
  if (cachedValue !== null) return cachedValue;

  const doNotTrack = process.env["DO_NOT_TRACK"];
  if (doNotTrack === "1" || doNotTrack?.toLowerCase() === "true") {
    cachedValue = false;
    return false;
  }

  const wotannOptOut = process.env["WOTANN_NO_TELEMETRY"];
  if (wotannOptOut === "1" || wotannOptOut?.toLowerCase() === "true") {
    cachedValue = false;
    return false;
  }

  if (existsSync(SENTINEL_PATH)) {
    cachedValue = false;
    return false;
  }

  cachedValue = true;
  return true;
}

/**
 * Invert of isTelemetryEnabled — convenience predicate for "opted out" checks.
 */
export function isTelemetryOptedOut(): boolean {
  return !isTelemetryEnabled();
}

/**
 * Clear the cached opt-out decision. Primarily for tests; production code
 * should not toggle telemetry mid-session.
 */
export function resetTelemetryCache(): void {
  cachedValue = null;
}
