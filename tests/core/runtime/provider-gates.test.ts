/**
 * Tests for V9 FT.2.1 step 1: provider-gates.ts.
 *
 * These tests pin the canonical semantics for every gate so the
 * runtime.ts call-site migration in step 2 can be verified
 * mechanically (each migrated site must produce the same boolean
 * result for the same inputs).
 */

import { describe, it, expect } from "vitest";

import {
  parseEnvFlag,
  gateDefaultOff,
  gateDefaultOn,
  isGuardianEnabled,
  isSteeringEnabled,
  isLspAgentToolsEnabled,
  isHybridV2Enabled,
  isOnnxEmbeddingsEnabled,
  isThinkInCodeEnabled,
  isAntiDistillationEnabled,
  isAutoPopulateKGEnabled,
  isCoveEnabled,
  isContextualAbstentionEnabled,
  isHooksEnabled,
  isMiddlewareEnabled,
  isTTSREnabled,
  isSemanticSearchEnabled,
  isMemoryEnabled,
  isWasmBypassEnabled,
  isOmegaLayersEnabled,
  isTemprEnabled,
  isPromptCacheWarmupEnabled,
  resolveHookProfile,
  type EnvReader,
  type GateConfig,
} from "../../../src/core/runtime/provider-gates.js";

// ── parseEnvFlag ──────────────────────────────────────────

describe("parseEnvFlag", () => {
  it("returns undefined for absent string", () => {
    expect(parseEnvFlag(undefined)).toBeUndefined();
  });

  it("returns undefined for empty / whitespace string", () => {
    expect(parseEnvFlag("")).toBeUndefined();
    expect(parseEnvFlag("   ")).toBeUndefined();
  });

  it("recognises truthy values", () => {
    for (const v of ["1", "true", "yes", "on", "TRUE", " On ", "YES"]) {
      expect(parseEnvFlag(v)).toBe(true);
    }
  });

  it("recognises falsy values", () => {
    for (const v of ["0", "false", "no", "off", "FALSE", " No ", "OFF"]) {
      expect(parseEnvFlag(v)).toBe(false);
    }
  });

  it("returns undefined for unknown values (so callers fall through)", () => {
    expect(parseEnvFlag("maybe")).toBeUndefined();
    expect(parseEnvFlag("2")).toBeUndefined();
  });
});

// ── gateDefaultOff ────────────────────────────────────────

describe("gateDefaultOff", () => {
  it("config=true wins", () => {
    expect(gateDefaultOff(true, "0")).toBe(true);
    expect(gateDefaultOff(true, undefined)).toBe(true);
  });

  it("config=false wins (env can't override)", () => {
    expect(gateDefaultOff(false, "1")).toBe(false);
    expect(gateDefaultOff(false, undefined)).toBe(false);
  });

  it("config=undefined falls through to env (truthy → on)", () => {
    expect(gateDefaultOff(undefined, "1")).toBe(true);
    expect(gateDefaultOff(undefined, "true")).toBe(true);
  });

  it("config=undefined falls through to env (falsy/absent → off)", () => {
    expect(gateDefaultOff(undefined, "0")).toBe(false);
    expect(gateDefaultOff(undefined, undefined)).toBe(false);
    expect(gateDefaultOff(undefined, "")).toBe(false);
  });
});

// ── gateDefaultOn ─────────────────────────────────────────

describe("gateDefaultOn (V9 T2.3 semantic)", () => {
  it("config=false wins (kills the feature)", () => {
    expect(gateDefaultOn(false, "1")).toBe(false);
    expect(gateDefaultOn(false, undefined)).toBe(false);
  });

  it("config=true wins (forces on)", () => {
    expect(gateDefaultOn(true, "0")).toBe(true);
    expect(gateDefaultOn(true, undefined)).toBe(true);
  });

  it("config=undefined + env=falsy → off", () => {
    expect(gateDefaultOn(undefined, "0")).toBe(false);
    expect(gateDefaultOn(undefined, "false")).toBe(false);
  });

  it("config=undefined + env=truthy → on", () => {
    expect(gateDefaultOn(undefined, "1")).toBe(true);
  });

  it("config=undefined + env=absent → on (DEFAULT-ON)", () => {
    expect(gateDefaultOn(undefined, undefined)).toBe(true);
  });

  it("config=undefined + env=garbage → on (default-on, fall through)", () => {
    expect(gateDefaultOn(undefined, "maybe")).toBe(true);
  });
});

// ── Concrete gates: default-off ────────────────────────────

describe("default-OFF gates", () => {
  const env: EnvReader = {};

  it("Guardian: respects env override", () => {
    expect(isGuardianEnabled({ enableGuardian: undefined } as GateConfig, env)).toBe(false);
    expect(isGuardianEnabled({} as GateConfig, { WOTANN_GUARDIAN: "1" })).toBe(true);
    expect(isGuardianEnabled({ enableGuardian: true }, { WOTANN_GUARDIAN: "0" })).toBe(true);
  });

  it("Steering: respects env override", () => {
    expect(isSteeringEnabled({} as GateConfig, env)).toBe(false);
    expect(isSteeringEnabled({}, { WOTANN_STEERING: "1" })).toBe(true);
  });

  it("LSP agent tools: env override", () => {
    expect(isLspAgentToolsEnabled({} as GateConfig, env)).toBe(false);
    expect(isLspAgentToolsEnabled({}, { WOTANN_LSP_TOOLS: "yes" })).toBe(true);
  });

  it("HybridV2", () => {
    expect(isHybridV2Enabled({}, env)).toBe(false);
    expect(isHybridV2Enabled({ useHybridV2: true }, env)).toBe(true);
  });

  it("OnnxEmbeddings", () => {
    expect(isOnnxEmbeddingsEnabled({}, env)).toBe(false);
    expect(isOnnxEmbeddingsEnabled({}, { WOTANN_ENABLE_ONNX_EMBEDDINGS: "1" })).toBe(true);
  });

  it("ThinkInCode", () => {
    expect(isThinkInCodeEnabled({}, env)).toBe(false);
    expect(isThinkInCodeEnabled({}, { WOTANN_THINK_IN_CODE: "1" })).toBe(true);
  });

  it("AntiDistillation", () => {
    expect(isAntiDistillationEnabled({}, env)).toBe(false);
    expect(isAntiDistillationEnabled({ enableAntiDistillation: true }, env)).toBe(true);
    expect(isAntiDistillationEnabled({}, { WOTANN_ANTI_DISTILLATION: "1" })).toBe(true);
  });

  it("AutoPopulateKG", () => {
    expect(isAutoPopulateKGEnabled({}, env)).toBe(false);
    expect(isAutoPopulateKGEnabled({}, { WOTANN_AUTO_POPULATE_KG: "1" })).toBe(true);
  });

  it("Cove", () => {
    expect(isCoveEnabled({}, env)).toBe(false);
    expect(isCoveEnabled({}, { WOTANN_COVE: "1" })).toBe(true);
  });

  it("PromptCacheWarmup", () => {
    expect(isPromptCacheWarmupEnabled({}, env)).toBe(false);
    expect(isPromptCacheWarmupEnabled({ enablePromptCacheWarmup: true }, env)).toBe(true);
    expect(isPromptCacheWarmupEnabled({}, { WOTANN_PROMPT_CACHE_WARMUP: "1" })).toBe(true);
  });
});

// ── Concrete gates: default-on ─────────────────────────────

describe("default-ON gates", () => {
  it("ContextualAbstention defaults true", () => {
    expect(isContextualAbstentionEnabled({} as GateConfig)).toBe(true);
    expect(isContextualAbstentionEnabled({ enableContextualAbstention: false })).toBe(false);
    expect(isContextualAbstentionEnabled({ enableContextualAbstention: true })).toBe(true);
  });

  it("Hooks defaults true; only false disables", () => {
    expect(isHooksEnabled({})).toBe(true);
    expect(isHooksEnabled({ enableHooks: false })).toBe(false);
  });

  it("Middleware / TTSR / SemanticSearch / Memory / WasmBypass — all default-true", () => {
    expect(isMiddlewareEnabled({})).toBe(true);
    expect(isMiddlewareEnabled({ enableMiddleware: false })).toBe(false);
    expect(isTTSREnabled({})).toBe(true);
    expect(isSemanticSearchEnabled({})).toBe(true);
    expect(isMemoryEnabled({})).toBe(true);
    expect(isWasmBypassEnabled({})).toBe(true);
  });

  it("OmegaLayers (T2.3): config=false kills, env=0 kills, otherwise on", () => {
    expect(isOmegaLayersEnabled({}, {})).toBe(true);
    expect(isOmegaLayersEnabled({ enableOmegaLayers: false }, {})).toBe(false);
    expect(isOmegaLayersEnabled({}, { WOTANN_OMEGA_LAYERS: "0" })).toBe(false);
    expect(isOmegaLayersEnabled({ enableOmegaLayers: true }, { WOTANN_OMEGA_LAYERS: "0" })).toBe(true);
  });

  it("Tempr (T2.3): same semantic as OMEGA", () => {
    expect(isTemprEnabled({}, {})).toBe(true);
    expect(isTemprEnabled({ useTempr: false }, {})).toBe(false);
    expect(isTemprEnabled({}, { WOTANN_USE_TEMPR: "0" })).toBe(false);
    expect(isTemprEnabled({ useTempr: true }, { WOTANN_USE_TEMPR: "0" })).toBe(true);
  });
});

// ── HookProfile resolver ───────────────────────────────────

describe("resolveHookProfile", () => {
  it("explicit config wins", () => {
    expect(resolveHookProfile("strict", {})).toBe("strict");
    expect(resolveHookProfile("minimal", { WOTANN_HOOK_PROFILE: "strict" })).toBe("minimal");
  });

  it("env fallback when config=undefined", () => {
    expect(resolveHookProfile(undefined, { WOTANN_HOOK_PROFILE: "minimal" })).toBe("minimal");
    expect(resolveHookProfile(undefined, { WOTANN_HOOK_PROFILE: "STRICT" })).toBe("strict");
  });

  it("invalid env value → standard default", () => {
    expect(resolveHookProfile(undefined, { WOTANN_HOOK_PROFILE: "extreme" })).toBe("standard");
  });

  it("absent everything → standard default", () => {
    expect(resolveHookProfile(undefined, {})).toBe("standard");
  });
});
