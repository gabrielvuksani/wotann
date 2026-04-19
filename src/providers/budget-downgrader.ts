/**
 * Budget-aware model downgrade.
 *
 * When USD spend approaches a cap, continuing with premium models
 * (Opus, GPT-5.4) blows past the budget. This module ships a
 * downgrade policy that auto-swaps to progressively cheaper tiers as
 * spend-fraction climbs:
 *
 *   <50% budget: use preferred model (no downgrade)
 *   50-75%     : downgrade one tier (Sonnet → Haiku, Opus → Sonnet)
 *   75-90%     : downgrade two tiers
 *   >90%       : lock to the cheapest available (free tier)
 *
 * Callers use the downgrader by passing {preferred, spent, budget},
 * receiving the actual model to use. No I/O, no LLM calls — a pure
 * policy function.
 *
 * Pairs with BudgetEnforcer (src/intelligence/budget-enforcer.ts):
 * that module HARD-stops on exhaustion; this one soft-DOWN-grades as
 * spend approaches the cap.
 */

// ── Types ──────────────────────────────────────────────

export type ModelTierLevel = "frontier" | "fast" | "small" | "free";

export interface ModelTierInfo {
  readonly id: string;
  readonly tier: ModelTierLevel;
  readonly avgCostPer1kTokens: number;
}

export interface DowngradeContext {
  /** Preferred model the caller wants to use. */
  readonly preferred: ModelTierInfo;
  /** USD spent so far. */
  readonly spent: number;
  /** USD budget cap. */
  readonly budget: number;
  /** Optional override ordering of alternatives for this request. */
  readonly alternatives?: readonly ModelTierInfo[];
}

export interface DowngradeDecision {
  readonly model: ModelTierInfo;
  readonly downgradeSteps: number;
  readonly reason: string;
}

// ── Tier ordering ──────────────────────────────────────

const TIER_ORDER: readonly ModelTierLevel[] = ["frontier", "fast", "small", "free"];

function tierIndex(tier: ModelTierLevel): number {
  return TIER_ORDER.indexOf(tier);
}

// ── Policy ─────────────────────────────────────────────

/**
 * Given spend + budget + preferred model, decide whether to downgrade
 * and to which tier. Returns the actual model to use.
 *
 * Thresholds:
 *   <50%  : no downgrade
 *   50-75%: 1 tier down
 *   75-90%: 2 tiers down
 *   >=90% : lock to "free"
 */
export function decideModel(
  ctx: DowngradeContext,
  alternativesByTier?: ReadonlyMap<ModelTierLevel, ModelTierInfo>,
): DowngradeDecision {
  if (ctx.budget <= 0 || !Number.isFinite(ctx.budget)) {
    return {
      model: ctx.preferred,
      downgradeSteps: 0,
      reason: "no budget set — no downgrade",
    };
  }

  const fraction = Math.max(0, Math.min(1, ctx.spent / ctx.budget));
  let desiredDowngradeSteps = 0;

  if (fraction >= 0.9) {
    desiredDowngradeSteps = Infinity; // lock to free
  } else if (fraction >= 0.75) {
    desiredDowngradeSteps = 2;
  } else if (fraction >= 0.5) {
    desiredDowngradeSteps = 1;
  }

  if (desiredDowngradeSteps === 0) {
    return {
      model: ctx.preferred,
      downgradeSteps: 0,
      reason: `spend ${(fraction * 100).toFixed(1)}% of budget — no downgrade needed`,
    };
  }

  const currentTierIdx = tierIndex(ctx.preferred.tier);
  const targetTierIdx = Math.min(
    TIER_ORDER.length - 1,
    currentTierIdx +
      (desiredDowngradeSteps === Infinity ? TIER_ORDER.length : desiredDowngradeSteps),
  );
  const targetTier = TIER_ORDER[targetTierIdx] ?? "free";

  // Resolve the actual model from alternatives map / list
  const fromMap = alternativesByTier?.get(targetTier);
  const fromList = ctx.alternatives?.find((alt) => alt.tier === targetTier);
  const resolved = fromMap ?? fromList;

  if (!resolved) {
    return {
      model: ctx.preferred,
      downgradeSteps: 0,
      reason: `spend ${(fraction * 100).toFixed(1)}% but no ${targetTier}-tier alternative registered`,
    };
  }

  return {
    model: resolved,
    downgradeSteps: desiredDowngradeSteps === Infinity ? TIER_ORDER.length : desiredDowngradeSteps,
    reason: `spend ${(fraction * 100).toFixed(1)}% of budget — downgraded to ${resolved.id}`,
  };
}

/**
 * Build a tier→model map from a flat list of alternatives. Handy for
 * callers that keep an "available models" list and want to query by
 * tier.
 */
export function buildTierMap(
  alternatives: readonly ModelTierInfo[],
): ReadonlyMap<ModelTierLevel, ModelTierInfo> {
  const map = new Map<ModelTierLevel, ModelTierInfo>();
  // Prefer the CHEAPEST model per tier (so downgrade actually saves money)
  const sorted = [...alternatives].sort((a, b) => a.avgCostPer1kTokens - b.avgCostPer1kTokens);
  for (const alt of sorted) {
    if (!map.has(alt.tier)) {
      map.set(alt.tier, alt);
    }
  }
  return map;
}

/**
 * Simulate a sequence of requests + spend to project which model gets
 * used at each spend level. Useful for pre-flight dashboards.
 */
export function projectUsage(
  preferred: ModelTierInfo,
  alternatives: readonly ModelTierInfo[],
  budget: number,
  spendSteps: readonly number[],
): readonly DowngradeDecision[] {
  const tierMap = buildTierMap(alternatives);
  return spendSteps.map((spent) =>
    decideModel({ preferred, spent, budget, alternatives }, tierMap),
  );
}
