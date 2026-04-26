/**
 * Test helper — tier-based model resolution for provider-agnostic tests.
 *
 * Wave DH-3 (test-dehardcode): tests that exercise generic code paths
 * (e.g. "tracker.record some-anthropic-model", "createSession with any provider")
 * should NOT hardcode "claude-opus-4-7" — that locks the test to Anthropic and
 * means a model rename forces 50 file edits. Use {@link getTierModel} instead:
 *
 *   const { provider, model } = getTierModel("strong");
 *   const session = createSession(provider, model);
 *
 * The helper reads from the live PROVIDER_DEFAULTS table (single source of
 * truth — same table the runtime uses), so a model rename in source
 * automatically flows into every test.
 *
 * QB#6 (no over-mocking): real PROVIDER_DEFAULTS, no fakes.
 * QB#7 (no shared mutable state): pure function — same input, same output.
 *
 * Behavioral tests that specifically check a model's behavior (e.g.
 * "supportsXhighEffort('claude-opus-4-7') === true") MUST keep their literal
 * IDs — they are exercising specific source-side capability tables.
 *
 * Billing/cost-table tests (e.g. cost-tracker, cost-threshold) MUST keep
 * literal IDs because they exercise specific COST_TABLE rates.
 */

import {
  PROVIDER_DEFAULTS,
  getProviderDefaults,
} from "../../src/providers/model-defaults.js";

/** Capability tier — same vocabulary as src/orchestration/agent-registry.ts. */
export type Tier = "strong" | "balanced" | "fast" | "local";

/**
 * Resolve a tier to a concrete provider+model pair using PROVIDER_DEFAULTS.
 *
 * Resolution order:
 *   1. `WOTANN_TEST_PROVIDER` env (lets CI pin to a specific provider)
 *   2. "anthropic" (canonical default — always present in the table)
 *
 * The mapping from tier → field on ProviderDefault matches agent-registry's
 * resolveAgentModel():
 *   strong   → oracleModel
 *   balanced → defaultModel
 *   fast     → workerModel
 *   local    → defaultModel (Ollama provider — local always means local)
 */
export function getTierModel(
  tier: Tier,
  options?: { readonly env?: NodeJS.ProcessEnv },
): { readonly provider: string; readonly model: string } {
  const env = options?.env ?? process.env;

  // Local tier is always Ollama — overriding to a hosted provider would
  // defeat the point of the tier name.
  if (tier === "local") {
    const ollama = PROVIDER_DEFAULTS["ollama"]!;
    return { provider: "ollama", model: ollama.defaultModel };
  }

  const providerName = env["WOTANN_TEST_PROVIDER"] ?? "anthropic";
  const defaults = getProviderDefaults(providerName);

  const model =
    tier === "strong"
      ? defaults.oracleModel
      : tier === "fast"
        ? defaults.workerModel
        : defaults.defaultModel; // balanced

  return { provider: providerName, model };
}

/**
 * Convenience: just the model id for the tier (when the test doesn't
 * care about the provider string).
 */
export function getTierModelId(
  tier: Tier,
  options?: { readonly env?: NodeJS.ProcessEnv },
): string {
  return getTierModel(tier, options).model;
}
