/**
 * Reasoning Sandwich Middleware — asymmetric reasoning budget allocation.
 *
 * FROM TERMINALBENCH RESEARCH (ForgeCode + LangChain deepagents):
 * "Running at max reasoning throughout scored only 53.9%; the balanced
 *  'sandwich' allocation achieved 63.6%."
 *
 * The insight: reasoning compute should NOT be uniform across all phases.
 * It should be:
 *   HIGH for planning → LOW for execution → HIGH for verification
 *
 * This middleware dynamically adjusts the thinking/reasoning budget based
 * on which phase of work the agent is in. It works with:
 * - Claude's extended thinking (budget_tokens)
 * - OpenAI's o-series reasoning (reasoning_effort)
 * - Any model (via system prompt injection)
 *
 * PHASE DETECTION:
 * - Planning: first message, "plan", "design", "architect"
 * - Execution: "write", "edit", "implement", "fix", "run"
 * - Verification: "verify", "test", "check", "review", after code changes
 *
 * UPGRADES (Sprint 2):
 * - Multi-phase detection within a single turn (mixed intent)
 * - Per-model budget calibration (different models have different sweet spots)
 * - Middleware pipeline integration via toMiddleware()
 * - Phase transition tracking with history
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

export type ReasoningPhase = "planning" | "execution" | "verification" | "unknown";

export interface ReasoningSandwichConfig {
  /** Reasoning budget for planning phase (0-1, where 1 = max) */
  readonly planningBudget: number;
  /** Reasoning budget for execution phase */
  readonly executionBudget: number;
  /** Reasoning budget for verification phase */
  readonly verificationBudget: number;
  /** Default budget for unknown phase */
  readonly defaultBudget: number;
}

/**
 * Per-model budget calibration overrides.
 * Different models have different reasoning sweet spots.
 */
export interface ModelBudgetCalibration {
  readonly modelPattern: string;
  readonly planningMultiplier: number;
  readonly executionMultiplier: number;
  readonly verificationMultiplier: number;
}

/**
 * Result of multi-phase detection within a single turn.
 */
export interface MultiPhaseResult {
  readonly primaryPhase: ReasoningPhase;
  readonly detectedPhases: readonly ReasoningPhase[];
  readonly confidence: number;
}

export interface ReasoningAdjustment {
  readonly phase: ReasoningPhase;
  readonly budgetMultiplier: number;
  readonly thinkingTokens: number;
  /** For o-series models: "low" | "medium" | "high" */
  readonly reasoningEffort: string;
  /** System prompt addition for non-thinking models */
  readonly promptInjection: string;
}

const DEFAULT_CONFIG: ReasoningSandwichConfig = {
  planningBudget: 0.9, // HIGH — plan thoroughly
  executionBudget: 0.3, // LOW — execute efficiently, don't overthink
  verificationBudget: 0.85, // HIGH — verify carefully
  defaultBudget: 0.5,
};

/**
 * Known model calibrations — adjust budgets per model family.
 * Some models respond better to higher reasoning budgets during execution,
 * while others degrade with too much reasoning overhead.
 *
 * Bug 7 (reasoning-sandwich calibrations): the prior table covered only
 * 6 patterns (claude / o1 / o3 / gpt-4 / gpt-3.5 / gemini) — the 8 first-
 * class providers (types.ts:27-35) span more model families than that.
 * Without explicit entries the codex/copilot proxies, ollama local models,
 * openrouter slugs, and HF community llamas all silently fell through to
 * the DEFAULT_CONFIG (planningBudget=0.9, executionBudget=0.3,
 * verificationBudget=0.85) — losing the per-family tuning that ForgeCode's
 * 53.9%->63.6% TerminalBench delta proves matters. Patterns are matched
 * via String.includes() so order of entries within each family is
 * irrelevant; the first match wins.
 */
const MODEL_CALIBRATIONS: readonly ModelBudgetCalibration[] = [
  // Claude models: benefit from high planning, very low execution
  {
    modelPattern: "claude",
    planningMultiplier: 1.0,
    executionMultiplier: 0.8,
    verificationMultiplier: 1.0,
  },
  // OpenAI o-series: already have internal reasoning, reduce external overhead
  {
    modelPattern: "o1",
    planningMultiplier: 0.7,
    executionMultiplier: 0.6,
    verificationMultiplier: 0.8,
  },
  {
    modelPattern: "o3",
    planningMultiplier: 0.7,
    executionMultiplier: 0.6,
    verificationMultiplier: 0.8,
  },
  // Bug 7: o4 is the next-gen reasoning model — same internal-reasoning
  // pattern as o1/o3 so reduce external overhead identically.
  {
    modelPattern: "o4",
    planningMultiplier: 0.7,
    executionMultiplier: 0.6,
    verificationMultiplier: 0.8,
  },
  // GPT-4 models: benefit from moderate reasoning across all phases
  {
    modelPattern: "gpt-4",
    planningMultiplier: 0.9,
    executionMultiplier: 1.0,
    verificationMultiplier: 0.9,
  },
  // Bug 7: gpt-5 is the current flagship; treat similarly to gpt-4 family
  // but slightly more verification-heavy because gpt-5 reasoning is
  // cheaper-per-token than o-series internal reasoning.
  {
    modelPattern: "gpt-5",
    planningMultiplier: 1.0,
    executionMultiplier: 1.0,
    verificationMultiplier: 1.0,
  },
  // Small/fast models: boost planning and verification, keep execution lean
  {
    modelPattern: "gpt-3.5",
    planningMultiplier: 1.1,
    executionMultiplier: 0.7,
    verificationMultiplier: 1.1,
  },
  // Gemini models: similar to GPT-4
  {
    modelPattern: "gemini",
    planningMultiplier: 0.9,
    executionMultiplier: 1.0,
    verificationMultiplier: 0.9,
  },
  // Bug 7 (reasoning-sandwich calibrations): explicit entries for the
  // remaining 4 first-class providers' canonical model families. Even
  // when the calibration matches an existing tuning, an explicit entry
  // beats silent default fall-through (QB#5: honest stub > silent
  // success).
  // Codex slugs (codexplan / codexspark / codexmini) wrap gpt-5.x — same
  // tuning as the gpt-5 family; explicit entry so the includes() test
  // catches "codexplan" before any future prefix collision.
  {
    modelPattern: "codex",
    planningMultiplier: 1.0,
    executionMultiplier: 1.0,
    verificationMultiplier: 1.0,
  },
  // Copilot exposes models under "*-copilot" suffix aliases (e.g.
  // "claude-sonnet-4-copilot", "gpt-5-copilot"). The "claude" / "gpt-"
  // patterns above already match these (includes() is unanchored), so
  // this entry exists primarily as documentation: copilot-specific
  // tuning lives via the underlying model family.
  {
    modelPattern: "copilot",
    planningMultiplier: 0.95,
    executionMultiplier: 0.9,
    verificationMultiplier: 0.95,
  },
  // Ollama qwen / llama / gemma local models — generally smaller, so
  // boost planning + verification (better quality on important phases)
  // and keep execution lean (avoid overthinking on local hardware).
  {
    modelPattern: "qwen",
    planningMultiplier: 1.1,
    executionMultiplier: 0.7,
    verificationMultiplier: 1.1,
  },
  {
    modelPattern: "llama",
    planningMultiplier: 1.1,
    executionMultiplier: 0.7,
    verificationMultiplier: 1.1,
  },
  {
    modelPattern: "gemma",
    planningMultiplier: 1.1,
    executionMultiplier: 0.7,
    verificationMultiplier: 1.1,
  },
  // Mistral / DeepSeek / Grok via OpenRouter or direct: moderate
  // reasoning across the board; deepseek-r1 has internal reasoning so
  // matches "deepseek" pattern with reduced external overhead.
  {
    modelPattern: "mistral",
    planningMultiplier: 0.9,
    executionMultiplier: 0.9,
    verificationMultiplier: 0.9,
  },
  {
    modelPattern: "deepseek",
    planningMultiplier: 0.8,
    executionMultiplier: 0.7,
    verificationMultiplier: 0.85,
  },
  {
    modelPattern: "grok",
    planningMultiplier: 0.9,
    executionMultiplier: 1.0,
    verificationMultiplier: 0.9,
  },
  // OpenRouter slug variants — when the slug carries a vendor prefix
  // (anthropic/, openai/, google/), the "claude" / "gpt" / "gemini"
  // patterns above already match because includes() is unanchored. The
  // "free" suffix slug is documented here so callers know free-tier
  // models route through the underlying-family tuning.
  // HuggingFace open-model hosting — varies by model; default to the
  // matching family pattern (llama / qwen / gemma already covered above).
];

/** Pattern weights for phase detection scoring. */
const PLANNING_PATTERNS: readonly string[] = [
  "plan",
  "design",
  "architect",
  "strategy",
  "approach",
  "how should",
  "what approach",
  "think about",
  "consider",
  "break down",
  "decompose",
  "outline",
];

const EXECUTION_PATTERNS: readonly string[] = [
  "write",
  "edit",
  "implement",
  "fix",
  "create",
  "add",
  "update",
  "change",
  "modify",
  "run",
  "build",
  "generate",
  "refactor",
  "move",
  "rename",
  "delete",
  "remove",
];

const VERIFICATION_PATTERNS: readonly string[] = [
  "verify",
  "test",
  "check",
  "review",
  "validate",
  "confirm",
  "ensure",
  "assert",
  "compare",
  "diff",
  "correct",
  "accurate",
  "inspect",
];

export class ReasoningSandwich {
  private readonly config: ReasoningSandwichConfig;
  private currentPhase: ReasoningPhase = "unknown";
  private turnCount = 0;
  private hasWrittenCode = false;
  private phaseHistory: Array<{ phase: ReasoningPhase; turn: number }> = [];
  private activeModel: string | null = null;

  constructor(config?: Partial<ReasoningSandwichConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set the active model for per-model budget calibration.
   */
  setModel(model: string): void {
    this.activeModel = model;
  }

  /**
   * Detect the current reasoning phase from the prompt content.
   * Uses weighted pattern matching for more accurate detection.
   */
  detectPhase(prompt: string, isFirstTurn: boolean): ReasoningPhase {
    this.turnCount++;

    // First turn is always planning
    if (isFirstTurn || this.turnCount === 1) {
      this.setPhase("planning");
      return "planning";
    }

    // After code changes, next turn is often verification
    if (this.hasWrittenCode) {
      this.hasWrittenCode = false;
      this.setPhase("verification");
      return "verification";
    }

    // Score-based detection
    const multiResult = this.detectMultiPhase(prompt);
    this.setPhase(multiResult.primaryPhase);
    return multiResult.primaryPhase;
  }

  /**
   * Multi-phase detection within a single turn.
   * A prompt like "implement the fix and then verify it works" has both
   * execution and verification intent. This returns all detected phases
   * ranked by confidence, with the highest-scoring as primary.
   */
  detectMultiPhase(prompt: string): MultiPhaseResult {
    const lower = prompt.toLowerCase();

    const planningScore = countPatternMatches(lower, PLANNING_PATTERNS);
    const executionScore = countPatternMatches(lower, EXECUTION_PATTERNS);
    const verificationScore = countPatternMatches(lower, VERIFICATION_PATTERNS);

    const totalScore = planningScore + executionScore + verificationScore;

    // No patterns matched — stick with current phase
    if (totalScore === 0) {
      return {
        primaryPhase: this.currentPhase !== "unknown" ? this.currentPhase : "execution",
        detectedPhases: [],
        confidence: 0,
      };
    }

    // Collect detected phases in score order
    const allScored: Array<{ phase: ReasoningPhase; score: number }> = [
      { phase: "planning" as const, score: planningScore },
      { phase: "execution" as const, score: executionScore },
      { phase: "verification" as const, score: verificationScore },
    ];
    const scored = allScored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);

    const primaryPhase = scored[0]?.phase ?? "execution";
    const topScore = scored[0]?.score ?? 0;
    const confidence = totalScore > 0 ? topScore / totalScore : 0;

    return {
      primaryPhase,
      detectedPhases: scored.map((s) => s.phase),
      confidence,
    };
  }

  /**
   * Record that code was written (triggers verification on next turn).
   */
  recordCodeWrite(): void {
    this.hasWrittenCode = true;
  }

  /**
   * Get the reasoning adjustment for the current phase.
   * Applies per-model calibration if a model is set.
   */
  getAdjustment(
    prompt: string,
    isFirstTurn: boolean,
    maxThinkingTokens: number = 10_000,
  ): ReasoningAdjustment {
    const phase = this.detectPhase(prompt, isFirstTurn);
    const baseBudget = this.getBudget(phase);
    const calibrated = this.applyModelCalibration(baseBudget, phase);

    const thinkingTokens = Math.round(maxThinkingTokens * calibrated);

    // Map budget to o-series reasoning_effort
    const reasoningEffort = calibrated > 0.7 ? "high" : calibrated > 0.4 ? "medium" : "low";

    // For models without native thinking, inject a prompt that scales reasoning
    const promptInjection = this.buildPromptInjection(phase, calibrated);

    return {
      phase,
      budgetMultiplier: calibrated,
      thinkingTokens,
      reasoningEffort,
      promptInjection,
    };
  }

  /**
   * Get current phase (for status display).
   */
  getCurrentPhase(): ReasoningPhase {
    return this.currentPhase;
  }

  /**
   * Get the phase transition history for diagnostics.
   */
  getPhaseHistory(): readonly { phase: ReasoningPhase; turn: number }[] {
    return [...this.phaseHistory];
  }

  /**
   * Reset state for a new task.
   */
  reset(): void {
    this.currentPhase = "unknown";
    this.turnCount = 0;
    this.hasWrittenCode = false;
    this.phaseHistory = [];
    this.activeModel = null;
  }

  /**
   * Convert this reasoning sandwich into a Middleware layer
   * that can be inserted into the MiddlewarePipeline.
   */
  toMiddleware(order: number = 6): Middleware {
    return {
      name: "reasoning-sandwich",
      order,
      before: (ctx: MiddlewareContext): MiddlewareContext => {
        const isFirstTurn = !ctx.resolvedIntent;
        const adjustment = this.getAdjustment(ctx.userMessage, isFirstTurn);

        // Record code writes from the task type
        if (ctx.taskType === "code" || ctx.taskType === "edit") {
          this.recordCodeWrite();
        }

        return {
          ...ctx,
          behavioralMode: `reasoning:${adjustment.phase}`,
        };
      },
      after: (_ctx: MiddlewareContext, result: AgentResult): AgentResult => {
        // After a tool call that writes files, record it for next-turn verification
        if (result.toolName && isWriteTool(result.toolName)) {
          this.recordCodeWrite();
        }
        return result;
      },
    };
  }

  // ── Private ────────────────────────────────────────────

  private setPhase(phase: ReasoningPhase): void {
    if (phase !== this.currentPhase) {
      this.phaseHistory = [...this.phaseHistory, { phase, turn: this.turnCount }];
    }
    this.currentPhase = phase;
  }

  private getBudget(phase: ReasoningPhase): number {
    switch (phase) {
      case "planning":
        return this.config.planningBudget;
      case "execution":
        return this.config.executionBudget;
      case "verification":
        return this.config.verificationBudget;
      default:
        return this.config.defaultBudget;
    }
  }

  /**
   * Apply per-model calibration to a budget value.
   * If the active model matches a known calibration, multiply the budget
   * by the model-specific multiplier for the current phase.
   */
  private applyModelCalibration(budget: number, phase: ReasoningPhase): number {
    if (!this.activeModel) return budget;

    const lower = this.activeModel.toLowerCase();
    const calibration = MODEL_CALIBRATIONS.find((c) => lower.includes(c.modelPattern));
    if (!calibration) return budget;

    let multiplier: number;
    switch (phase) {
      case "planning":
        multiplier = calibration.planningMultiplier;
        break;
      case "execution":
        multiplier = calibration.executionMultiplier;
        break;
      case "verification":
        multiplier = calibration.verificationMultiplier;
        break;
      default:
        multiplier = 1.0;
    }

    // Clamp between 0 and 1
    return Math.max(0, Math.min(1, budget * multiplier));
  }

  private buildPromptInjection(phase: ReasoningPhase, _budget: number): string {
    switch (phase) {
      case "planning":
        return "Think carefully about the approach. Consider edge cases, dependencies, and potential issues before acting.";
      case "execution":
        return "Execute efficiently. The plan is set — focus on correct implementation.";
      case "verification":
        return "Verify thoroughly. Check every detail against the requirements. Don't assume — prove.";
      default:
        return "";
    }
  }
}

// ── Pure Utility Functions ────────────────────────────────

/**
 * Count how many patterns from a list appear in the text.
 */
function countPatternMatches(text: string, patterns: readonly string[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (text.includes(pattern)) count++;
  }
  return count;
}

/**
 * Check if a tool name corresponds to a file-writing operation.
 */
function isWriteTool(toolName: string): boolean {
  const writeTools: ReadonlySet<string> = new Set([
    "write",
    "edit",
    "create_file",
    "write_file",
    "patch",
    "insert",
    "replace",
    "Write",
    "Edit",
  ]);
  return writeTools.has(toolName);
}
