/**
 * Rollback feature flag — V9 T3.6 Wave 5.
 *
 * `WOTANN_SUBSCRIPTION_SDK_ENABLED` controls whether the bridge spawns
 * the `claude` binary at all. When the flag is set to `0` / `false` /
 * `off`, callers fall back to the BYOK provider path
 * (`createAnthropicAdapter()` over the public Messages API).
 *
 * This flag is the V9 T3.6 "rollback" lever — if the bridge ships a
 * regression, users can revert with a single env var without rolling
 * back the whole binary.
 *
 * Quality bars
 *   - QB #13 env guard: callers pass `env` explicitly so unit tests
 *     don't leak global state.
 *   - QB #14: the flag's truthiness is verified by the integration
 *     test matrix in MASTER_PLAN_V9.md Tier 3.6.
 */

const ENV_KEY = "WOTANN_SUBSCRIPTION_SDK_ENABLED";

const FALSY = new Set(["0", "false", "off", "no", "disabled", ""]);
const TRUTHY = new Set(["1", "true", "on", "yes", "enabled"]);

export interface SubscriptionFlagDecision {
  readonly enabled: boolean;
  /** Why the flag returned this verdict — used by `wotann doctor`. */
  readonly reason: "env-truthy" | "env-falsy" | "env-unrecognized" | "env-missing" | "default-on";
}

/**
 * Decide whether the SDK-in-process bridge is enabled. Order:
 *   1. Explicit env value (1/true/on → true; 0/false/off → false).
 *   2. Unrecognized non-empty value → false (fail closed).
 *   3. Missing env → default true.
 */
export function decideSubscriptionFlag(
  env: NodeJS.ProcessEnv = process.env,
): SubscriptionFlagDecision {
  const raw = env[ENV_KEY];
  if (raw === undefined) {
    return { enabled: true, reason: "default-on" };
  }
  const norm = raw.trim().toLowerCase();
  if (norm === "") {
    return { enabled: false, reason: "env-falsy" };
  }
  if (TRUTHY.has(norm)) {
    return { enabled: true, reason: "env-truthy" };
  }
  if (FALSY.has(norm)) {
    return { enabled: false, reason: "env-falsy" };
  }
  return { enabled: false, reason: "env-unrecognized" };
}

/**
 * User-facing message explaining the flag's current state. Used by
 * `wotann doctor` and the bridge startup banner.
 */
export function describeSubscriptionFlag(decision: SubscriptionFlagDecision): string {
  switch (decision.reason) {
    case "default-on":
      return "Claude SDK bridge enabled (default).";
    case "env-truthy":
      return `Claude SDK bridge enabled via ${ENV_KEY}.`;
    case "env-falsy":
      return `Claude SDK bridge disabled via ${ENV_KEY}; falling back to BYOK.`;
    case "env-unrecognized":
      return `Unrecognized value for ${ENV_KEY}; SDK bridge disabled (fail-closed). Use 0 or 1.`;
    case "env-missing":
      // Defensive — `decideSubscriptionFlag` returns "default-on" for
      // missing env, but exhaustiveness keeps this branch alive.
      return "Claude SDK bridge enabled (env-missing fallback).";
    default: {
      const _exhaustive: never = decision.reason;
      void _exhaustive;
      return "Claude SDK bridge state unknown.";
    }
  }
}
