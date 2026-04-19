/**
 * Token-budget estimator.
 *
 * Predicts the token count + USD cost of a prompt BEFORE the call.
 * Useful for:
 *   - Pre-flight budget checks (refuse if too expensive)
 *   - Routing: pick cheaper model when estimate exceeds threshold
 *   - UI display: show user the projected cost before running
 *
 * Not exact — uses a char-based approximation that's within ±10% of
 * actual tiktoken for English, ±20% for code-heavy content. Good
 * enough for budget decisions; not for billing reconciliation.
 */

// ── Types ──────────────────────────────────────────────

export interface ModelPricing {
  /** Cost per 1k input tokens (USD). */
  readonly inputPer1k: number;
  /** Cost per 1k output tokens (USD). */
  readonly outputPer1k: number;
  /** Optional cache read price per 1k tokens. */
  readonly cacheReadPer1k?: number;
  /** Optional cache write price per 1k tokens. */
  readonly cacheWritePer1k?: number;
}

export interface EstimateInput {
  /** System + user prompt (will be tokenized). */
  readonly prompt: string;
  /** Tokens already in cache (saves input cost at cacheReadPer1k). */
  readonly cachedInputTokens?: number;
  /** Expected output tokens. */
  readonly expectedOutputTokens: number;
  /** Model pricing. */
  readonly pricing: ModelPricing;
}

export interface CostEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly inputCostUsd: number;
  readonly outputCostUsd: number;
  readonly cacheCostUsd: number;
  readonly totalCostUsd: number;
}

// ── Token estimation ─────────────────────────────────

/**
 * Char-based token approximation. English prose ~4 chars/token;
 * code ~3 chars/token; JSON/symbols ~2.5 chars/token.
 */
export function estimatePromptTokens(prompt: string): number {
  if (!prompt) return 0;
  const len = prompt.length;

  // Rough content-type detection
  const codeLikeChars = (prompt.match(/[{}[\]()<>=;]/g) ?? []).length;
  const codeRatio = codeLikeChars / Math.max(1, len);

  let charsPerToken: number;
  if (codeRatio > 0.05) {
    charsPerToken = 3; // code-heavy
  } else if (codeRatio > 0.02) {
    charsPerToken = 3.5; // mixed
  } else {
    charsPerToken = 4; // prose
  }

  return Math.ceil(len / charsPerToken);
}

// ── Cost estimation ──────────────────────────────────

export function estimateCost(input: EstimateInput): CostEstimate {
  const totalInput = estimatePromptTokens(input.prompt);
  const cachedInput = Math.min(totalInput, input.cachedInputTokens ?? 0);
  const freshInput = Math.max(0, totalInput - cachedInput);

  const inputCostUsd = (freshInput / 1000) * input.pricing.inputPer1k;
  const outputCostUsd = (input.expectedOutputTokens / 1000) * input.pricing.outputPer1k;
  const cacheCostUsd = (cachedInput / 1000) * (input.pricing.cacheReadPer1k ?? 0);

  return {
    inputTokens: totalInput,
    outputTokens: input.expectedOutputTokens,
    cachedInputTokens: cachedInput,
    inputCostUsd,
    outputCostUsd,
    cacheCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd + cacheCostUsd,
  };
}

// ── Comparison across models ─────────────────────────

export interface ModelOption {
  readonly id: string;
  readonly pricing: ModelPricing;
  readonly qualityTier?: "frontier" | "fast" | "small" | "free";
}

export interface ModelComparison {
  readonly model: ModelOption;
  readonly estimate: CostEstimate;
}

/**
 * Compare cost across multiple model options for the same prompt.
 * Returns models sorted by total cost ascending.
 */
export function compareModelCosts(
  prompt: string,
  expectedOutputTokens: number,
  models: readonly ModelOption[],
  cachedInputTokens: number = 0,
): readonly ModelComparison[] {
  const comparisons = models.map((model) => ({
    model,
    estimate: estimateCost({
      prompt,
      cachedInputTokens,
      expectedOutputTokens,
      pricing: model.pricing,
    }),
  }));
  comparisons.sort((a, b) => a.estimate.totalCostUsd - b.estimate.totalCostUsd);
  return comparisons;
}

// ── Budget check ─────────────────────────────────────

export interface BudgetCheck {
  readonly withinBudget: boolean;
  readonly estimate: CostEstimate;
  readonly budget: number;
  readonly reason: string;
}

export function checkBudget(
  estimate: CostEstimate,
  budget: number,
  options: { readonly safetyMargin?: number } = {},
): BudgetCheck {
  const margin = options.safetyMargin ?? 0.1;
  const ceiling = budget * (1 - margin);
  const within = estimate.totalCostUsd <= ceiling;
  return {
    withinBudget: within,
    estimate,
    budget,
    reason: within
      ? `estimated $${estimate.totalCostUsd.toFixed(4)} ≤ budget ceiling $${ceiling.toFixed(4)}`
      : `estimated $${estimate.totalCostUsd.toFixed(4)} > budget ceiling $${ceiling.toFixed(4)} (${(margin * 100).toFixed(0)}% safety margin on $${budget.toFixed(2)})`,
  };
}
