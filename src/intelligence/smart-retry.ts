/**
 * Smart Retry -- when something fails, analyze why and try differently.
 * Not just "retry the same thing" but "understand the failure and adapt."
 *
 * Strategies: modify-prompt, switch-model, decompose-task, add-context, change-approach.
 * Each retry attempts a different strategy based on error analysis.
 * Tracks all attempts with detailed diagnostics.
 */

// -- Types -------------------------------------------------------------------

export type RetryStrategyType =
  | "modify-prompt"
  | "switch-model"
  | "decompose-task"
  | "add-context"
  | "change-approach";

export interface Attempt {
  readonly strategy: RetryStrategyType;
  readonly error: string;
  readonly context: string;
  readonly attemptNumber: number;
  readonly timestamp: number;
}

export interface RetryStrategy {
  readonly type: RetryStrategyType;
  readonly reason: string;
  readonly modification: string;
  readonly confidence: number;
  readonly attemptNumber: number;
}

export interface SmartRetryResult<T> {
  readonly success: boolean;
  readonly value: T | null;
  readonly attempts: readonly Attempt[];
  readonly finalStrategy: RetryStrategyType | null;
  readonly totalAttempts: number;
  readonly totalDurationMs: number;
}

// -- Error classification ----------------------------------------------------

type ErrorCategory =
  | "rate-limit"
  | "timeout"
  | "context-overflow"
  | "invalid-response"
  | "model-refusal"
  | "parse-error"
  | "auth-error"
  | "unknown";

interface ErrorClassification {
  readonly category: ErrorCategory;
  readonly suggestedStrategies: readonly RetryStrategyType[];
  readonly shouldRetry: boolean;
}

const ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, ErrorCategory]> = [
  [/rate.?limit|too.?many.?requests|429|throttl/i, "rate-limit"],
  [/timeout|timed?\s*out|ETIMEDOUT|ECONNRESET/i, "timeout"],
  [/context.?(?:length|overflow|too.?long|window)|max.?tokens|token.?limit/i, "context-overflow"],
  [/invalid.?(?:response|json|format|output)|unexpected.?token|SyntaxError/i, "invalid-response"],
  [/refus|cannot.?(?:help|assist)|policy|content.?filter|safety/i, "model-refusal"],
  [/parse|JSON\.parse|unexpected.?end/i, "parse-error"],
  [/auth|unauthorized|forbidden|401|403/i, "auth-error"],
];

const CATEGORY_STRATEGIES: ReadonlyMap<ErrorCategory, readonly RetryStrategyType[]> = new Map([
  ["rate-limit", ["switch-model"]],
  ["timeout", ["decompose-task", "switch-model"]],
  ["context-overflow", ["decompose-task", "modify-prompt"]],
  ["invalid-response", ["modify-prompt", "add-context"]],
  ["model-refusal", ["modify-prompt", "change-approach"]],
  ["parse-error", ["modify-prompt", "add-context"]],
  ["auth-error", ["switch-model"]],
  ["unknown", ["modify-prompt", "decompose-task", "change-approach"]],
]);

// -- Strategy descriptions ---------------------------------------------------

const STRATEGY_DESCRIPTIONS: ReadonlyMap<RetryStrategyType, string> = new Map([
  ["modify-prompt", "Rephrase the prompt to avoid the issue that caused failure"],
  ["switch-model", "Try a different model that may handle this task better"],
  ["decompose-task", "Break the task into smaller subtasks and tackle them individually"],
  ["add-context", "Add more context or examples to help the model understand"],
  ["change-approach", "Try a fundamentally different approach to solving the problem"],
]);

// -- Implementation ----------------------------------------------------------

export class SmartRetryEngine {
  /**
   * Analyze a failure and determine the best retry strategy.
   */
  analyzeFailure(
    error: string,
    context: string,
    previousAttempts: readonly Attempt[],
  ): RetryStrategy {
    const classification = classifyError(error);
    const usedStrategies = new Set(previousAttempts.map((a) => a.strategy));
    const attemptNumber = previousAttempts.length + 1;

    // Find the first unused strategy from the suggested list
    let selectedStrategy: RetryStrategyType | null = null;
    for (const strategy of classification.suggestedStrategies) {
      if (!usedStrategies.has(strategy)) {
        selectedStrategy = strategy;
        break;
      }
    }

    // If all suggested strategies have been tried, use the full fallback chain
    if (!selectedStrategy) {
      const allStrategies: readonly RetryStrategyType[] = [
        "modify-prompt",
        "switch-model",
        "decompose-task",
        "add-context",
        "change-approach",
      ];
      for (const strategy of allStrategies) {
        if (!usedStrategies.has(strategy)) {
          selectedStrategy = strategy;
          break;
        }
      }
    }

    // If truly all strategies exhausted, cycle back to the most promising
    if (!selectedStrategy) {
      selectedStrategy = classification.suggestedStrategies[0] ?? "modify-prompt";
    }

    const confidence = computeConfidence(classification, previousAttempts.length);
    const reason = buildReason(classification.category, selectedStrategy, error);
    const modification = STRATEGY_DESCRIPTIONS.get(selectedStrategy) ?? "Unknown strategy";

    return {
      type: selectedStrategy,
      reason,
      modification,
      confidence,
      attemptNumber,
    };
  }

  /**
   * Execute a function with smart retry logic.
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number,
  ): Promise<SmartRetryResult<T>> {
    const attempts: Attempt[] = [];
    const startTime = Date.now();

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const value = await fn();
        return {
          success: true,
          value,
          attempts,
          finalStrategy: attempts.length > 0 ? attempts[attempts.length - 1]?.strategy ?? null : null,
          totalAttempts: i + 1,
          totalDurationMs: Date.now() - startTime,
        };
      } catch (err: unknown) {
        const errorStr = err instanceof Error ? err.message : String(err);
        const strategy = this.analyzeFailure(errorStr, "", attempts);

        attempts.push({
          strategy: strategy.type,
          error: errorStr,
          context: strategy.reason,
          attemptNumber: i + 1,
          timestamp: Date.now(),
        });

        // Don't retry auth errors -- they won't resolve by retrying
        const classification = classifyError(errorStr);
        if (!classification.shouldRetry) {
          break;
        }
      }
    }

    return {
      success: false,
      value: null,
      attempts,
      finalStrategy: attempts.length > 0 ? attempts[attempts.length - 1]?.strategy ?? null : null,
      totalAttempts: attempts.length,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Get all available retry strategies.
   */
  getAvailableStrategies(): readonly RetryStrategyType[] {
    return ["modify-prompt", "switch-model", "decompose-task", "add-context", "change-approach"];
  }

  /**
   * Classify an error string into an error category.
   */
  classifyError(error: string): ErrorClassification {
    return classifyError(error);
  }
}

// -- Helpers -----------------------------------------------------------------

function classifyError(error: string): ErrorClassification {
  for (const [pattern, category] of ERROR_PATTERNS) {
    if (pattern.test(error)) {
      const strategies = CATEGORY_STRATEGIES.get(category) ?? ["modify-prompt"];
      const shouldRetry = category !== "auth-error";
      return { category, suggestedStrategies: strategies, shouldRetry };
    }
  }

  return {
    category: "unknown",
    suggestedStrategies: CATEGORY_STRATEGIES.get("unknown") ?? ["modify-prompt"],
    shouldRetry: true,
  };
}

function computeConfidence(classification: ErrorClassification, previousAttemptCount: number): number {
  // Base confidence per category
  const baseConfidence: Record<ErrorCategory, number> = {
    "rate-limit": 0.9,
    "timeout": 0.7,
    "context-overflow": 0.8,
    "invalid-response": 0.6,
    "model-refusal": 0.5,
    "parse-error": 0.7,
    "auth-error": 0.1,
    "unknown": 0.3,
  };

  const base = baseConfidence[classification.category];
  // Confidence drops with each retry
  const decay = Math.max(0, 1 - previousAttemptCount * 0.15);
  return Math.round(base * decay * 100) / 100;
}

function buildReason(category: ErrorCategory, strategy: RetryStrategyType, error: string): string {
  const shortError = error.length > 80 ? error.slice(0, 77) + "..." : error;
  return `Error classified as "${category}". Applying "${strategy}" strategy. Original error: ${shortError}`;
}
