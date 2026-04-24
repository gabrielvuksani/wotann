/**
 * Provider gates — V9 FT.2.1 step 1.
 *
 * The first cohesive extraction from the runtime.ts god-file (6939 LOC).
 * Consolidates the `config.enableX ?? process.env.WOTANN_X === "1"` gate
 * pattern that's repeated 48 times across runtime.ts into a single
 * surface of named helpers.
 *
 * RATIONALE
 * ─────────
 * Each gate has a slightly different semantic (some default true, some
 * default false; some accept "0" as off, some accept "1" as on; some
 * are read once at construction, some at every call). Inlining the
 * pattern in runtime.ts has caused two prior bugs:
 *
 *   1. Default-on gates (e.g. T2.3 OMEGA, T2.3 TEMPR) used the wrong
 *      `||` semantic, causing `WOTANN_X=0` to NOT disable the feature.
 *      Pattern: `config.enableX || process.env["WOTANN_X"] === "1"`
 *      — this is "default-OFF unless either flag is on", not what we
 *      wanted. Fix landed via T2.3 manually; this module enforces the
 *      correct semantic everywhere.
 *
 *   2. Mixed semantic (e.g. `config.useHybridV2 ?? process.env["..."]`
 *      vs. `config.enableHooks !== false`) drifted across call sites
 *      so two gates with identical *intent* had different *behavior*
 *      depending on whether the user set the env var or the config
 *      key. This module gives every gate ONE canonical resolver.
 *
 * Each helper is a PURE FUNCTION — no `this`, no global state, no
 * stored cache. Callers (runtime.ts methods) thread the config object
 * + env reader explicitly.
 *
 * QUALITY BARS HONORED
 *   - QB #6 honest stubs: every gate returns `true | false` directly;
 *     never a tri-state. Callers that need "unknown" semantics get
 *     `defaultValue` from the gate signature.
 *   - QB #7 per-call state: zero module-global cache. Every call
 *     reads from arguments.
 *   - QB #13 env guard: `process.env` is read ONLY here, in a
 *     centralised location. Tests inject a fake env so the gates
 *     stay deterministic.
 *
 * NEXT EXTRACTION
 * ──────────────
 * Phase 2 of FT.2.1 will migrate the 48 call sites in runtime.ts to
 * use these helpers. Doing the helper file first (this file) lets us
 * land + test in isolation before touching the god-file. See V9
 * Section "FT.2.1 runtime.ts" for the full sub-extraction plan.
 */

// ── Env reader interface ─────────────────────────────────────

/**
 * Tests inject this. Production code passes `process.env`. Keeping
 * the env read off `globalThis.process` lets the gate functions stay
 * pure and snapshot-testable (no spies, no resets).
 */
export interface EnvReader {
  readonly [key: string]: string | undefined;
}

/** Default reader — delegates to process.env. */
export function defaultEnvReader(): EnvReader {
  return process.env as EnvReader;
}

// ── Boolean coercion ─────────────────────────────────────────

/**
 * Canonical truthy-string semantics: "1" / "true" / "yes" / "on" is
 * truthy; "0" / "false" / "no" / "off" / "" is falsy; absent string
 * yields `undefined` so the caller can fall through to its default.
 *
 * Comparison is case-insensitive after trim.
 */
export function parseEnvFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "") return undefined;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return undefined;
}

// ── Gate resolver patterns ───────────────────────────────────

/**
 * "Default-OFF" gate: enabled only when EITHER the config flag is
 * explicitly true OR the env var parses as truthy. Used by features
 * that should opt-in (Guardian, Steering, OnnxEmbeddings).
 */
export function gateDefaultOff(
  configValue: boolean | undefined,
  envValue: string | undefined,
): boolean {
  if (configValue === true) return true;
  if (configValue === false) return false;
  return parseEnvFlag(envValue) === true;
}

/**
 * "Default-ON" gate: enabled UNLESS the config flag is explicitly
 * false OR the env var parses as falsy. Used by features that
 * should be on by default (Hooks, Middleware, SemanticSearch,
 * TTSR, OMEGA after V9 T2.3, TEMPR after V9 T2.3).
 *
 * Critical for V9 T2.3: previous `|| env === "1"` semantic was
 * wrong — flipping defaults requires this `!== false && env !== "0"`
 * shape so `WOTANN_X=0` disables, but absence keeps it on.
 */
export function gateDefaultOn(
  configValue: boolean | undefined,
  envValue: string | undefined,
): boolean {
  if (configValue === false) return false;
  if (configValue === true) return true;
  return parseEnvFlag(envValue) !== false;
}

// ── Concrete gates (the 12 most-touched in runtime.ts) ───────

/**
 * Each helper is a 1-line wrapper around `gateDefaultOff` /
 * `gateDefaultOn` with the canonical config field name + env var
 * name baked in. This way a future audit can grep for
 * `isXEnabled(` and find every consumer instead of chasing config
 * field names through the codebase.
 */

export interface GateConfig {
  readonly enableGuardian?: boolean;
  readonly enableSteering?: boolean;
  readonly enableContextualAbstention?: boolean;
  readonly enableLspAgentTools?: boolean;
  readonly useHybridV2?: boolean;
  readonly enableOnnxEmbeddings?: boolean;
  readonly thinkInCode?: boolean;
  readonly enableAntiDistillation?: boolean;
  readonly autoPopulateKG?: boolean;
  readonly enableHooks?: boolean;
  readonly enableMiddleware?: boolean;
  readonly enableTTSR?: boolean;
  readonly enableSemanticSearch?: boolean;
  readonly enableMemory?: boolean;
  readonly enableWasmBypass?: boolean;
  readonly enableOmegaLayers?: boolean;
  readonly useTempr?: boolean;
  readonly enablePromptCacheWarmup?: boolean;
  readonly cove?: boolean;
}

/** Default-OFF (opt-in) gates. */

export function isGuardianEnabled(c: GateConfig, env: EnvReader = defaultEnvReader()): boolean {
  return gateDefaultOff(c.enableGuardian, env["WOTANN_GUARDIAN"]);
}

export function isSteeringEnabled(c: GateConfig, env: EnvReader = defaultEnvReader()): boolean {
  return gateDefaultOff(c.enableSteering, env["WOTANN_STEERING"]);
}

export function isLspAgentToolsEnabled(
  c: GateConfig,
  env: EnvReader = defaultEnvReader(),
): boolean {
  return gateDefaultOff(c.enableLspAgentTools, env["WOTANN_LSP_TOOLS"]);
}

export function isHybridV2Enabled(c: GateConfig, env: EnvReader = defaultEnvReader()): boolean {
  return gateDefaultOff(c.useHybridV2, env["WOTANN_HYBRID_V2"]);
}

export function isOnnxEmbeddingsEnabled(
  c: GateConfig,
  env: EnvReader = defaultEnvReader(),
): boolean {
  return gateDefaultOff(c.enableOnnxEmbeddings, env["WOTANN_ENABLE_ONNX_EMBEDDINGS"]);
}

export function isThinkInCodeEnabled(c: GateConfig, env: EnvReader = defaultEnvReader()): boolean {
  return gateDefaultOff(c.thinkInCode, env["WOTANN_THINK_IN_CODE"]);
}

export function isAntiDistillationEnabled(
  c: GateConfig,
  env: EnvReader = defaultEnvReader(),
): boolean {
  return gateDefaultOff(c.enableAntiDistillation, env["WOTANN_ANTI_DISTILLATION"]);
}

export function isAutoPopulateKGEnabled(
  c: GateConfig,
  env: EnvReader = defaultEnvReader(),
): boolean {
  return gateDefaultOff(c.autoPopulateKG, env["WOTANN_AUTO_POPULATE_KG"]);
}

export function isCoveEnabled(c: GateConfig, env: EnvReader = defaultEnvReader()): boolean {
  return gateDefaultOff(c.cove, env["WOTANN_COVE"]);
}

/** Default-ON gates (matches V9 T2.3 semantic). */

export function isContextualAbstentionEnabled(c: GateConfig): boolean {
  // No env override per V9 — config-only gate, defaults true.
  return c.enableContextualAbstention !== false;
}

export function isHooksEnabled(c: GateConfig): boolean {
  // Config-only; default true.
  return c.enableHooks !== false;
}

export function isMiddlewareEnabled(c: GateConfig): boolean {
  return c.enableMiddleware !== false;
}

export function isTTSREnabled(c: GateConfig): boolean {
  return c.enableTTSR !== false;
}

export function isSemanticSearchEnabled(c: GateConfig): boolean {
  return c.enableSemanticSearch !== false;
}

export function isMemoryEnabled(c: GateConfig): boolean {
  return c.enableMemory !== false;
}

export function isWasmBypassEnabled(c: GateConfig): boolean {
  return c.enableWasmBypass !== false;
}

export function isOmegaLayersEnabled(c: GateConfig, env: EnvReader = defaultEnvReader()): boolean {
  // V9 T2.3 default-on semantic: config=false OR env=0 turns it off;
  // otherwise on.
  return gateDefaultOn(c.enableOmegaLayers, env["WOTANN_OMEGA_LAYERS"]);
}

export function isTemprEnabled(c: GateConfig, env: EnvReader = defaultEnvReader()): boolean {
  // V9 T2.3 default-on — same semantic as OMEGA.
  return gateDefaultOn(c.useTempr, env["WOTANN_USE_TEMPR"]);
}

export function isPromptCacheWarmupEnabled(
  c: GateConfig,
  env: EnvReader = defaultEnvReader(),
): boolean {
  // Default-OFF: opt-in via either flag. T1.5 wires the warmup itself.
  return gateDefaultOff(c.enablePromptCacheWarmup, env["WOTANN_PROMPT_CACHE_WARMUP"]);
}

// ── Hook profile resolver (string-valued, not boolean) ───────

export type HookProfile = "minimal" | "standard" | "strict";

const HOOK_PROFILES: readonly HookProfile[] = ["minimal", "standard", "strict"];

/**
 * Hook profile is the only string-valued gate in runtime.ts. Resolved
 * via:
 *   1. explicit config.hookProfile (if the caller set it)
 *   2. WOTANN_HOOK_PROFILE env var (if it parses to a known profile)
 *   3. "standard" default
 *
 * The string-valued resolver pattern is generalisable: future
 * config knobs (e.g. log level, telemetry scope) follow the same
 * shape.
 */
export function resolveHookProfile(
  configValue: HookProfile | undefined,
  env: EnvReader = defaultEnvReader(),
): HookProfile {
  if (configValue !== undefined && HOOK_PROFILES.includes(configValue)) {
    return configValue;
  }
  const envValue = env["WOTANN_HOOK_PROFILE"];
  if (envValue !== undefined) {
    const v = envValue.trim().toLowerCase();
    if (HOOK_PROFILES.includes(v as HookProfile)) {
      return v as HookProfile;
    }
  }
  return "standard";
}
