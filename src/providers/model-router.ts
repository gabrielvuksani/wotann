/**
 * 5-tier model router with health scoring and goal-based recommendation.
 * Routes tasks to the optimal model/provider based on category and health.
 *
 * Wave DH-1: task-routing tables derive their model ids from
 * `PROVIDER_DEFAULTS` (see model-defaults.ts) at construction time rather
 * than embedding the literal strings. When a provider ships a new flagship
 * model, only model-defaults.ts changes — every routing table reads through
 * the central table. The Copilot-proxied "claude-*-copilot" aliases stay as
 * literals here because they're a Copilot-internal routing convention (not
 * an Anthropic-facing model id) and aren't surfaced in PROVIDER_DEFAULTS.
 */

import type { ProviderName, RoutingDecision, TaskDescriptor, ModelTier } from "../core/types.js";
import type { ProviderHealthScore } from "./types.js";
import type { RepoModelOutcome, RepoModelPerformanceRecord } from "./model-performance.js";
import { PROVIDER_DEFAULTS } from "./model-defaults.js";
import { pickOllamaDefaultsByName } from "./ollama-adapter.js";
import {
  decideModel,
  buildTierMap,
  type ModelTierInfo,
  type DowngradeDecision,
} from "./budget-downgrader.js";

// ── Per-provider default lookups (single source: PROVIDER_DEFAULTS) ──────
// `oracleModel` is the heavyweight (e.g. Anthropic Opus, OpenAI gpt-5.4).
// `defaultModel` is the daily-driver (e.g. Anthropic Sonnet, OpenAI gpt-5).
// `workerModel` is the cheap-but-capable tier used inside oracle/worker
// loops. Reading these at module load means every routing table picks up
// the new id the moment PROVIDER_DEFAULTS changes — no separate const bumps.
const ANTHROPIC_DEFAULTS = PROVIDER_DEFAULTS["anthropic"]!;
const OPENAI_DEFAULTS = PROVIDER_DEFAULTS["openai"]!;
const GEMINI_DEFAULTS = PROVIDER_DEFAULTS["gemini"]!;
const VERTEX_DEFAULTS = PROVIDER_DEFAULTS["vertex"]!;
// Bug 3 (model-router tiers): openrouter + huggingface are 2 of the 8
// first-class providers (types.ts:27-35). Without entries in the routing
// tables, a user authenticated only with these falls through to
// firstAvailable with model="auto" — which produces an unusable adapter
// call. Pull the canonical defaults from PROVIDER_DEFAULTS so future
// model-id bumps stay in one place. ProviderName "openrouter" / "huggingface".
const OPENROUTER_DEFAULTS = PROVIDER_DEFAULTS["openrouter"]!;
const HUGGINGFACE_DEFAULTS = PROVIDER_DEFAULTS["huggingface"]!;

// Copilot-internal alias used as the canonical routing target when the
// router picks Copilot for an Anthropic-shaped task. Copilot exposes Claude
// Sonnet under this proxy id; it is NOT a real Anthropic model and so
// stays here rather than in PROVIDER_DEFAULTS (which tracks each provider's
// real catalogue).
const COPILOT_CLAUDE_SONNET_ALIAS = "claude-sonnet-4-copilot";
const COPILOT_GPT_ALIAS = "gpt-5-copilot";

// SB-NEW-2 fix: no qwen3-coder-next / qwen3.5 hardcodes. Ollama defaults
// are derived from the user's actual installed model list via
// pickOllamaDefaultsByName. The router refuses to suggest Ollama when the
// user has no installed models (the candidate is omitted from findBestAvailable).

interface RouterConfig {
  readonly availableProviders: ReadonlySet<ProviderName>;
  readonly ollamaModels: readonly string[];
}

interface ModelCandidate {
  readonly provider: ProviderName;
  readonly model: string;
  readonly tier: ModelTier;
}

export class ModelRouter {
  private readonly config: RouterConfig;
  private readonly healthScores: Map<string, ProviderHealthScore> = new Map();
  private readonly repoPerformance: Map<string, RepoModelPerformanceRecord> = new Map();
  private readonly downgradeAlternatives: Map<string, ModelTierInfo> = new Map();
  private totalCost = 0;
  private costBudget = Infinity;

  constructor(config: RouterConfig) {
    this.config = config;
  }

  /**
   * Register a known model so the budget downgrader can resolve a
   * cheaper alternative when spend crosses policy thresholds. Callers
   * register each (provider, model, tier, cost) they intend to dispatch
   * to; the router then has enough info to softly downgrade BEFORE
   * picking the final model.
   */
  registerDowngradeAlternative(info: ModelTierInfo): void {
    this.downgradeAlternatives.set(info.id, info);
  }

  registerDowngradeAlternatives(alternatives: readonly ModelTierInfo[]): void {
    for (const alt of alternatives) this.registerDowngradeAlternative(alt);
  }

  getDowngradeAlternatives(): readonly ModelTierInfo[] {
    return [...this.downgradeAlternatives.values()];
  }

  /**
   * Before picking a model, consult the budget downgrader. Returns the
   * (possibly downgraded) model to use alongside a reason for telemetry.
   * Pure projection — caller decides whether to act on the decision.
   */
  downgradeIfNeeded(ctx: {
    readonly preferred: ModelTierInfo;
    readonly spent?: number;
    readonly budget?: number;
  }): DowngradeDecision {
    const spent = ctx.spent ?? this.totalCost;
    const budget = ctx.budget ?? this.costBudget;
    const alternatives = this.getDowngradeAlternatives();
    const tierMap = buildTierMap(alternatives);
    return decideModel({ preferred: ctx.preferred, spent, budget, alternatives }, tierMap);
  }

  /**
   * Best-effort adjustment of a RoutingDecision before dispatch. If the
   * downgrader flags a cheaper tier, the returned decision uses that
   * alternative. If no registration exists for the preferred/alt pair,
   * the original decision passes through unchanged.
   */
  applyBudgetDowngrade(decision: RoutingDecision): RoutingDecision {
    const preferred = this.downgradeAlternatives.get(decision.model);
    if (!preferred) return decision;

    const result = this.downgradeIfNeeded({ preferred });
    if (result.downgradeSteps === 0 || result.model.id === decision.model) {
      return decision;
    }
    return {
      ...decision,
      model: result.model.id,
      cost: result.model.avgCostPer1kTokens,
    };
  }

  /**
   * Set a hard cost budget. When exceeded, routes to free providers only.
   */
  setCostBudget(budgetUsd: number): void {
    this.costBudget = budgetUsd;
  }

  /**
   * Record cost for budget enforcement.
   */
  recordCost(costUsd: number): void {
    this.totalCost += costUsd;
  }

  /**
   * Check if budget is exceeded.
   */
  isBudgetExceeded(): boolean {
    return this.totalCost >= this.costBudget;
  }

  getCostStatus(): { spent: number; budget: number; remaining: number; exceeded: boolean } {
    return {
      spent: this.totalCost,
      budget: this.costBudget,
      remaining: Math.max(0, this.costBudget - this.totalCost),
      exceeded: this.totalCost >= this.costBudget,
    };
  }

  /**
   * Auto-classify task intent from prompt text.
   * Saves 40-60% on API costs by routing utility tasks to cheap/free models.
   */
  classifyIntent(prompt: string): TaskDescriptor {
    const lower = prompt.toLowerCase();
    const estimatedTokens = Math.ceil(prompt.length / 4);

    // Utility tasks → free/local models (saves 40-60% on API costs)
    if (/^(format|convert|count|list|sort|parse|extract|base64|json|csv)\b/i.test(lower)) {
      return {
        category: "utility",
        priority: "latency",
        requiresVision: false,
        requiresComputerUse: false,
        estimatedTokens,
      };
    }

    // Classification tasks → fast/local
    if (/^(classify|categorize|label|tag|detect|which|is this)\b/i.test(lower)) {
      return {
        category: "classify",
        priority: "latency",
        requiresVision: false,
        requiresComputerUse: false,
        estimatedTokens,
      };
    }

    // Planning/architecture → deep frontier (Opus/GPT-5.4)
    if (/\b(plan|architect|design|strategy|refactor|migrate|redesign)\b/i.test(lower)) {
      return {
        category: "plan",
        priority: "quality",
        requiresVision: false,
        requiresComputerUse: false,
        estimatedTokens,
      };
    }

    // Code review → deep frontier
    if (/\b(review|audit|check|evaluate|assess|critique)\b/i.test(lower)) {
      return {
        category: "review",
        priority: "quality",
        requiresVision: false,
        requiresComputerUse: false,
        estimatedTokens,
      };
    }

    // Computer use
    if (/\b(screenshot|click|browser|screen|desktop|open app|calendar)\b/i.test(lower)) {
      return {
        category: "computer-use",
        priority: "balanced",
        requiresVision: true,
        requiresComputerUse: true,
        estimatedTokens,
      };
    }

    // Vision tasks
    if (/\b(image|photo|picture|looks like|visual)\b/i.test(lower)) {
      return {
        category: "code",
        priority: "balanced",
        requiresVision: true,
        requiresComputerUse: false,
        estimatedTokens,
      };
    }

    // Default: coding task
    return {
      category: "code",
      priority: "balanced",
      requiresVision: false,
      requiresComputerUse: false,
      estimatedTokens,
    };
  }

  route(task: TaskDescriptor): RoutingDecision {
    // Phase 13 Wave 3B: pass every route() decision through
    // applyBudgetDowngrade before returning. When spend crosses policy
    // thresholds (50/75/90% of budget) a cheaper-tier alternative is
    // swapped in — but only if the user has explicitly registered that
    // alternative. No registrations = pass-through unchanged.
    const decision = this.routeInner(task);
    return this.applyBudgetDowngrade(decision);
  }

  /**
   * Internal routing — the original 5-tier logic untouched. Wrapped by
   * `route()` so applyBudgetDowngrade fires on EVERY decision path
   * (including the budget-exceeded fast-path which returns a free-tier
   * candidate but still goes through the downgrader for consistency).
   */
  private routeInner(task: TaskDescriptor): RoutingDecision {
    // BUDGET ENFORCEMENT: if budget exceeded, force free providers only
    if (this.isBudgetExceeded()) {
      return this.findBestAvailable(
        this.withOllamaCandidate(
          [
            { provider: "gemini", model: GEMINI_DEFAULTS.workerModel, tier: 1 },
            // Free-tier escape hatch: route to OpenRouter's free model
            // family when budget is exhausted. Replaces the prior
            // `provider: "free"` umbrella that aliased to Groq/Cerebras.
            {
              provider: "openrouter",
              model: "meta-llama/llama-3.3-70b-instruct:free",
              tier: 1,
            },
          ],
          "coding",
        ),
      );
    }

    // Tier 0: WASM bypass (handled externally — router doesn't handle this)
    // Router starts at Tier 1+

    // Tier 1: Local model via Ollama (free, private)
    if (
      (task.category === "utility" || task.category === "classify") &&
      this.config.availableProviders.has("ollama") &&
      this.config.ollamaModels.length > 0
    ) {
      const model = this.selectOllamaModel(task);
      if (model) {
        return { tier: 1, provider: "ollama", model, cost: 0 };
      }
    }

    // Computer use → Anthropic default (Claude has the most-mature native CU
    // surface — `computer-use-preview` tools + `screenshot/click/type/scroll`
    // tool-use blocks). Gemini 3 supports vision-driven CU emulation through
    // the harness's perception engine (see src/computer-use/), which is
    // currently NOT first-class on this routing path; it would route through
    // the vision branch above. Copilot proxy as fallback (also routes Claude
    // under the hood). Bug 3: prior comment claimed "only Claude has native
    // CU" — that's true for first-party CU APIs today but Gemini-3 vision
    // emulation closes the gap when explicitly opted in.
    if (task.requiresComputerUse) {
      return this.findBestAvailable([
        { provider: "anthropic", model: ANTHROPIC_DEFAULTS.defaultModel, tier: 2 },
        { provider: "copilot", model: COPILOT_CLAUDE_SONNET_ALIAS, tier: 2 },
      ]);
    }

    // Vision → Gemini's default first (free tier, 1M context, native vision).
    // Fall through to paid Claude/GPT only when Gemini is unavailable or
    // health-degraded. Phase 4 Sprint B2 item 16: vision-model routing.
    if (task.requiresVision) {
      return this.findBestAvailable(
        this.withOllamaCandidate(
          [
            { provider: "gemini", model: GEMINI_DEFAULTS.defaultModel, tier: 1 },
            // vertex was dropped from the first-class set; gemini above
            // covers the same Google model family.
            { provider: "anthropic", model: ANTHROPIC_DEFAULTS.defaultModel, tier: 2 },
            { provider: "openai", model: OPENAI_DEFAULTS.oracleModel, tier: 2 },
          ],
          "vision",
        ),
      );
    }

    // Long-context (>128k est. tokens) → Gemini's default (1M context free).
    // Without this, a long-horizon task falls back to 200k-context models
    // and starts losing context mid-run. Phase 4 Sprint B2 item 16.
    if (task.estimatedTokens > 128_000) {
      return this.findBestAvailable([
        { provider: "gemini", model: GEMINI_DEFAULTS.defaultModel, tier: 1 },
        // vertex dropped from first-class set; gemini above covers the
        // same Google model family at the consumer free tier.
        { provider: "anthropic", model: ANTHROPIC_DEFAULTS.defaultModel, tier: 2 },
      ]);
    }

    // Tier 2: Fast frontier for coding/execution
    if (task.priority === "latency" || task.category === "code") {
      return this.findBestAvailable(
        this.withOllamaCandidate(
          [
            { provider: "anthropic", model: ANTHROPIC_DEFAULTS.defaultModel, tier: 2 },
            { provider: "copilot", model: COPILOT_CLAUDE_SONNET_ALIAS, tier: 2 },
            { provider: "openai", model: OPENAI_DEFAULTS.workerModel, tier: 2 },
            // Bug 3 (model-router tiers): openrouter free tier as last-tier
            // safety net for users with only OpenRouter authenticated.
            { provider: "openrouter", model: OPENROUTER_DEFAULTS.defaultModel, tier: 2 },
            // Bug 3: huggingface default for users with only HF authenticated.
            { provider: "huggingface", model: HUGGINGFACE_DEFAULTS.defaultModel, tier: 2 },
          ],
          "coding",
        ),
      );
    }

    // Tier 3: Deep frontier for planning/review
    if (task.category === "plan" || task.category === "review") {
      return this.findBestAvailable([
        { provider: "anthropic", model: ANTHROPIC_DEFAULTS.oracleModel, tier: 3 },
        { provider: "openai", model: OPENAI_DEFAULTS.oracleModel, tier: 3 },
        { provider: "copilot", model: COPILOT_GPT_ALIAS, tier: 3 },
        // Bug 3 (model-router tiers): OpenRouter sells the same Pro models
        // (Anthropic + OpenAI flagships) under the <vendor>/<model> slug
        // convention. The `anthropic/claude-sonnet-4-7` slug routes Sonnet
        // via OpenRouter so plan/review tasks aren't excluded for
        // OpenRouter-only users. Falls AFTER direct providers so Anthropic-
        // direct wins when both auths exist.
        { provider: "openrouter", model: "anthropic/claude-sonnet-4-7", tier: 3 },
      ]);
    }

    // Default: balanced selection
    return this.findBestAvailable(
      this.withOllamaCandidate(
        [
          { provider: "anthropic", model: ANTHROPIC_DEFAULTS.defaultModel, tier: 2 },
          { provider: "openai", model: OPENAI_DEFAULTS.workerModel, tier: 2 },
          { provider: "copilot", model: COPILOT_CLAUDE_SONNET_ALIAS, tier: 2 },
          { provider: "gemini", model: GEMINI_DEFAULTS.workerModel, tier: 2 },
          // Bug 3 (model-router tiers): OpenRouter + HF defaults so users
          // authenticated only with these providers don't fall through to
          // findBestAvailable's firstAvailable path with model="auto".
          { provider: "openrouter", model: OPENROUTER_DEFAULTS.defaultModel, tier: 2 },
          { provider: "huggingface", model: HUGGINGFACE_DEFAULTS.defaultModel, tier: 2 },
        ],
        "general",
      ),
    );
  }

  // ── Health Scoring ──────────────────────────────────────────

  recordResult(provider: string, success: boolean, durationMs: number): void {
    const existing = this.healthScores.get(provider) ?? {
      latencyMs: durationMs,
      avgLatencyMs: durationMs,
      healthy: true,
      errorRate: 0,
      requestCount: 0,
      errorCount: 0,
      costPer1kTokens: 0,
    };

    const newRequestCount = existing.requestCount + 1;
    const newErrorCount = existing.errorCount + (success ? 0 : 1);
    const newErrorRate = newErrorCount / newRequestCount;

    const updated: ProviderHealthScore = {
      ...existing,
      requestCount: newRequestCount,
      errorCount: newErrorCount,
      latencyMs: durationMs,
      avgLatencyMs: success
        ? 0.3 * durationMs + 0.7 * existing.avgLatencyMs
        : existing.avgLatencyMs,
      healthy: success ? true : newRequestCount >= 3 ? newErrorRate <= 0.7 : existing.healthy,
      errorRate: newErrorRate,
    };

    this.healthScores.set(provider, updated);
  }

  getHealthScore(provider: string): ProviderHealthScore | undefined {
    return this.healthScores.get(provider);
  }

  hydrateRepoPerformance(records: readonly RepoModelPerformanceRecord[]): void {
    this.repoPerformance.clear();
    for (const record of records) {
      this.repoPerformance.set(`${record.provider}:${record.model}`, record);
    }
  }

  recordRepoOutcome(outcome: RepoModelOutcome): void {
    const key = `${outcome.provider}:${outcome.model}`;
    const existing = this.repoPerformance.get(key);
    const previousRuns = (existing?.successes ?? 0) + (existing?.failures ?? 0);
    const nextRuns = previousRuns + 1;
    const successes = (existing?.successes ?? 0) + (outcome.success ? 1 : 0);
    const failures = (existing?.failures ?? 0) + (outcome.success ? 0 : 1);

    this.repoPerformance.set(key, {
      provider: outcome.provider,
      model: outcome.model,
      successes,
      failures,
      avgLatencyMs: rollingAverage(
        existing?.avgLatencyMs ?? outcome.durationMs,
        outcome.durationMs,
        nextRuns,
      ),
      avgCostUsd: rollingAverage(
        existing?.avgCostUsd ?? outcome.costUsd,
        outcome.costUsd,
        nextRuns,
      ),
      totalTokens: (existing?.totalTokens ?? 0) + outcome.tokensUsed,
      lastUsedAt: new Date().toISOString(),
    });
  }

  getRepoPerformance(
    provider: ProviderName,
    model: string,
  ): RepoModelPerformanceRecord | undefined {
    return this.repoPerformance.get(`${provider}:${model}`);
  }

  // ── Goal-Based Recommendation ─────────────────────────────

  recommendForGoal(goal: "latency" | "balanced" | "coding" | "cost"): RoutingDecision | null {
    const scored = [...this.healthScores.entries()]
      .filter(([_, s]) => s.healthy)
      .map(([provider, score]) => {
        const latencyScore = score.avgLatencyMs / 1000;
        const costScore = score.costPer1kTokens * 100;
        const errorPenalty = score.errorRate * 500;

        const totalScore =
          goal === "latency"
            ? latencyScore + errorPenalty
            : goal === "cost"
              ? costScore + errorPenalty
              : latencyScore * 0.5 + costScore * 0.5 + errorPenalty;

        return { provider: provider as ProviderName, score: totalScore };
      })
      .sort((a, b) => a.score - b.score);

    const best = scored[0];
    if (!best) return null;

    return { tier: 2, provider: best.provider, model: "auto", cost: 0 };
  }

  // ── Private Helpers ───────────────────────────────────────

  private findBestAvailable(candidates: readonly ModelCandidate[]): RoutingDecision {
    const viable = candidates
      .filter((candidate) => {
        if (!this.config.availableProviders.has(candidate.provider)) return false;
        const health = this.healthScores.get(candidate.provider);
        return !health || health.healthy;
      })
      .map((candidate, index) => ({
        candidate,
        score: this.scoreCandidate(candidate, index),
      }))
      .sort((a, b) => a.score - b.score);

    const best = viable[0]?.candidate;
    if (best) {
      return {
        tier: best.tier,
        provider: best.provider,
        model: best.model,
        cost: 0,
      };
    }

    // Fallback: first available provider with any model. Throws when
    // there are no available providers — prior code returned a fake
    // "ollama" route which masked the configuration error and caused
    // confusing 404s downstream when Ollama wasn't installed. Honest
    // fail-loud is safer than silent vendor pin.
    const firstAvailable = [...this.config.availableProviders][0];
    if (!firstAvailable) {
      throw new Error(
        "model-router: no providers available — configure at least one provider (ANTHROPIC_API_KEY / OPENAI_API_KEY / Ollama running / etc.)",
      );
    }
    return {
      tier: 2,
      provider: firstAvailable,
      model: "auto",
      cost: 0,
    };
  }

  private selectOllamaModel(task: TaskDescriptor): string | null {
    const models = this.config.ollamaModels;
    if (models.length === 0) return null;

    // Match by task category
    if (task.category === "code") {
      return models.find((m) => m.includes("coder") || m.includes("qwen")) ?? models[0] ?? null;
    }
    if (task.category === "classify" || task.category === "utility") {
      return models.find((m) => m.includes("nemotron") || m.includes("haiku")) ?? models[0] ?? null;
    }

    return models[0] ?? null;
  }

  /**
   * SB-NEW-2 fix: build a tier-1 Ollama candidate ONLY when the user has
   * installed models. Picks the best fit for the role from the installed
   * list (no qwen3-coder-next / qwen3.5 hardcodes). Returns null when no
   * Ollama models are installed so the candidate is omitted from the
   * findBestAvailable race rather than failing later with "model not found".
   */
  private ollamaCandidate(role: "coding" | "vision" | "general"): ModelCandidate | null {
    if (this.config.ollamaModels.length === 0) return null;
    const defaults = pickOllamaDefaultsByName(this.config.ollamaModels);
    const model =
      role === "coding"
        ? (defaults.coding ?? defaults.fallback)
        : role === "vision"
          ? (defaults.reasoning ?? defaults.fallback) // qwen3.5 family covers vision
          : defaults.fallback;
    if (!model) return null;
    return { provider: "ollama", model, tier: 1 };
  }

  private withOllamaCandidate(
    base: readonly ModelCandidate[],
    role: "coding" | "vision" | "general",
  ): ModelCandidate[] {
    const c = this.ollamaCandidate(role);
    return c ? [...base, c] : [...base];
  }

  private scoreCandidate(candidate: ModelCandidate, index: number): number {
    const health = this.healthScores.get(candidate.provider);
    const repoRecord = this.repoPerformance.get(`${candidate.provider}:${candidate.model}`);
    const requestPenalty = health ? health.errorRate * 25 + health.avgLatencyMs / 5000 : 0;

    if (!repoRecord) {
      return index * 4 + 5 + requestPenalty;
    }

    const runs = repoRecord.successes + repoRecord.failures;
    const successRate = runs > 0 ? repoRecord.successes / runs : 0;
    const repoPenalty =
      index * 4 +
      (1 - successRate) * 8 +
      repoRecord.avgLatencyMs / 5000 +
      repoRecord.avgCostUsd * 20 -
      successRate * 8 -
      Math.min(4, runs / 2);

    return requestPenalty + repoPenalty;
  }
}

function rollingAverage(previous: number, nextValue: number, runCount: number): number {
  if (runCount <= 1) return nextValue;
  return (previous * (runCount - 1) + nextValue) / runCount;
}

// ── Opus 4.7 xhigh effort — V9 T14.1a ───────────────────────────────────────
//
// Claude Code v2.1.111 introduced the `xhigh` reasoning-effort tier
// specifically for Opus 4.7 extended thinking. Other models (Sonnet,
// Haiku, GPT-4/5, Gemini) don't have a distinct xhigh level — they
// either don't support extended thinking at all, or their top tier
// maps to what WOTANN already calls `max`.
//
// Consumers that want to dial in extended thinking should gate on
// `supportsXhighEffort(model)` before passing xhigh down to the
// provider adapter. When the model doesn't support xhigh, the caller
// should clamp to `high` (not `max`) so the user's bill doesn't
// double unexpectedly — `max` opts into 4x reasoning budget, which is
// a separate deliberate choice.

/**
 * Canonical Opus 4.7 model IDs (current + versioned + bracket-shorthand).
 * Kept private to keep the check in one place; add new aliases here as
 * Anthropic publishes them.
 */
const OPUS_47_MODEL_IDS: ReadonlySet<string> = new Set([
  "claude-opus-4-7",
  "claude-opus-4-7[1m]",
  "opus-4-7",
  "opus4-7",
]);

/**
 * True when the given model supports the xhigh reasoning-effort tier.
 * Today this is Opus 4.7 only; expand when future Claude models ship
 * extended thinking under the same flag.
 */
export function supportsXhighEffort(model: string): boolean {
  if (OPUS_47_MODEL_IDS.has(model)) return true;
  // Allow pinned-revision variants like `claude-opus-4-7-2026-04-12`.
  return /^claude-opus-4-7([-[].*)?$/.test(model);
}

/**
 * Clamp an effort level to what the target model actually supports.
 * Models without xhigh support fall back to `high` (the safer default
 * that doesn't double the reasoning-budget multiplier).
 */
export function clampEffortForModel(
  effort: "low" | "medium" | "high" | "xhigh" | "max",
  model: string,
): "low" | "medium" | "high" | "xhigh" | "max" {
  if (effort === "xhigh" && !supportsXhighEffort(model)) return "high";
  return effort;
}
