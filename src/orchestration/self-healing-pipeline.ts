/**
 * Self-Healing Pipeline — pattern-aware error recovery.
 *
 * Extends SelfHealingExecutor with:
 * - Error pattern recognition across attempts (not just retry-with-new-prompt)
 * - Auto-fix suggestions based on known error → fix mappings
 * - Error history for cross-session learning
 * - Provider-specific error classification
 * - Graduated recovery strategies (prompt-fix → code-rollback → strategy-change → human-escalation)
 */

import type { ProviderName } from "../core/types.js";
import { ShadowGit } from "../utils/shadow-git.js";

// ── Error Classification ────────────────────────────────

export type ErrorCategory =
  | "type-error"
  | "import-error"
  | "runtime-error"
  | "test-failure"
  | "timeout"
  | "rate-limit"
  | "context-overflow"
  | "permission-denied"
  | "tool-failure"
  | "syntax-error"
  | "circular-dependency"
  | "provider-error"
  | "unknown";

export interface ClassifiedError {
  readonly category: ErrorCategory;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly confidence: number;
  readonly suggestedFix?: string;
  readonly relatedPatterns: readonly string[];
}

export interface ErrorPattern {
  readonly id: string;
  readonly regex: RegExp;
  readonly category: ErrorCategory;
  readonly fixTemplate: string;
  readonly priority: number;
}

export interface RecoveryStrategy {
  readonly name: string;
  readonly description: string;
  readonly execute: (error: ClassifiedError, context: PipelineContext) => Promise<RecoveryResult>;
}

export interface RecoveryResult {
  readonly success: boolean;
  readonly strategy: string;
  readonly output: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
}

export interface PipelineContext {
  readonly taskId: string;
  readonly taskDescription: string;
  readonly workingDir: string;
  readonly provider: ProviderName;
  readonly model: string;
  readonly attempt: number;
  readonly priorErrors: readonly ClassifiedError[];
  readonly maxAttempts: number;
}

export interface PipelineResult {
  readonly success: boolean;
  readonly attempts: number;
  readonly errors: readonly ClassifiedError[];
  readonly recoveries: readonly RecoveryResult[];
  readonly totalTokensUsed: number;
  readonly totalDurationMs: number;
  readonly finalStrategy: string;
}

// ── Known Error Patterns ────────────────────────────────

const KNOWN_PATTERNS: readonly ErrorPattern[] = [
  {
    id: "ts-type-mismatch",
    regex: /Type '(.+?)' is not assignable to type '(.+?)'/,
    category: "type-error",
    fixTemplate: "Fix type mismatch: expected $2 but got $1. Check the variable declaration and ensure the types align.",
    priority: 1,
  },
  {
    id: "ts-missing-property",
    regex: /Property '(.+?)' does not exist on type '(.+?)'/,
    category: "type-error",
    fixTemplate: "Add missing property '$1' to type '$2', or check if you meant a different property name.",
    priority: 2,
  },
  {
    id: "ts-cannot-find-module",
    regex: /Cannot find module '(.+?)'/,
    category: "import-error",
    fixTemplate: "Module '$1' not found. Check: 1) file exists at path, 2) exports are correct, 3) tsconfig paths are configured.",
    priority: 1,
  },
  {
    id: "ts-import-not-exported",
    regex: /Module '(.+?)' has no exported member '(.+?)'/,
    category: "import-error",
    fixTemplate: "Symbol '$2' is not exported from '$1'. Check the module's exports or use a different import.",
    priority: 2,
  },
  {
    id: "test-assertion-fail",
    regex: /expected (.+?) to (equal|be|match|contain) (.+)/i,
    category: "test-failure",
    fixTemplate: "Test assertion failed: expected $1 to $2 $3. Review the implementation logic, not the test.",
    priority: 3,
  },
  {
    id: "test-timeout",
    regex: /Timeout of (\d+)ms exceeded/,
    category: "timeout",
    fixTemplate: "Test timed out after $1ms. Check for: infinite loops, unresolved promises, missing async/await.",
    priority: 2,
  },
  {
    id: "rate-limit-429",
    regex: /429|rate.?limit|too many requests/i,
    category: "rate-limit",
    fixTemplate: "Rate limited. Wait and retry with exponential backoff, or switch to a different provider.",
    priority: 1,
  },
  {
    id: "context-overflow",
    regex: /context.?(window|length|limit)|maximum.?tokens|too.?long/i,
    category: "context-overflow",
    fixTemplate: "Context window exceeded. Compact conversation, remove old tool results, or split the task.",
    priority: 1,
  },
  {
    id: "permission-denied",
    regex: /EACCES|permission denied|not authorized/i,
    category: "permission-denied",
    fixTemplate: "Permission denied. Check file permissions, sandboxing settings, or auth tokens.",
    priority: 1,
  },
  {
    id: "syntax-error",
    regex: /SyntaxError|Unexpected token|Parse error/i,
    category: "syntax-error",
    fixTemplate: "Syntax error in the generated code. Review brackets, semicolons, and template literals.",
    priority: 1,
  },
  {
    id: "circular-dep",
    regex: /circular dependency|cannot access .+ before initialization/i,
    category: "circular-dependency",
    fixTemplate: "Circular dependency detected. Break the cycle by extracting shared types into a separate file.",
    priority: 2,
  },
  {
    id: "provider-error",
    regex: /500 Internal|502 Bad Gateway|503 Service|connection refused/i,
    category: "provider-error",
    fixTemplate: "Provider error. Try a different provider in the fallback chain.",
    priority: 1,
  },
];

// ── Error Classifier ────────────────────────────────────

export function classifyError(errorText: string): ClassifiedError {
  for (const pattern of KNOWN_PATTERNS) {
    const match = errorText.match(pattern.regex);
    if (match) {
      let fixSuggestion = pattern.fixTemplate;
      match.slice(1).forEach((capture, i) => {
        fixSuggestion = fixSuggestion.replaceAll(`$${i + 1}`, capture ?? "");
      });

      // Extract file:line if present
      const fileLineMatch = errorText.match(/(?:at\s+)?(\S+\.[jt]sx?):(\d+)/);

      return {
        category: pattern.category,
        message: errorText.slice(0, 500),
        file: fileLineMatch?.[1],
        line: fileLineMatch?.[2] ? parseInt(fileLineMatch[2], 10) : undefined,
        confidence: 0.9,
        suggestedFix: fixSuggestion,
        relatedPatterns: [pattern.id],
      };
    }
  }

  return {
    category: "unknown",
    message: errorText.slice(0, 500),
    confidence: 0.3,
    relatedPatterns: [],
  };
}

/**
 * Detect error repetition — same error across N attempts signals a stuck loop.
 */
export function detectErrorRepetition(errors: readonly ClassifiedError[]): {
  isRepeating: boolean;
  repeatedCategory?: ErrorCategory;
  repeatCount: number;
} {
  if (errors.length < 2) return { isRepeating: false, repeatCount: 0 };

  const categoryCounts = new Map<ErrorCategory, number>();
  for (const err of errors) {
    categoryCounts.set(err.category, (categoryCounts.get(err.category) ?? 0) + 1);
  }

  for (const [category, count] of categoryCounts) {
    if (count >= 3) {
      return { isRepeating: true, repeatedCategory: category, repeatCount: count };
    }
  }

  return { isRepeating: false, repeatCount: 0 };
}

// ── Recovery Strategies ─────────────────────────────────

const RECOVERY_STRATEGIES: readonly RecoveryStrategy[] = [
  {
    name: "prompt-fix",
    description: "Inject error context and fix suggestion into next prompt",
    execute: async (error, context) => {
      const fixPrompt = error.suggestedFix
        ? `Previous attempt failed:\n${error.message}\n\nSuggested fix: ${error.suggestedFix}\n\nOriginal task: ${context.taskDescription}`
        : `Previous attempt failed:\n${error.message}\n\nOriginal task: ${context.taskDescription}\n\nAnalyze the error and try a different approach.`;

      return {
        success: true,
        strategy: "prompt-fix",
        output: fixPrompt,
        tokensUsed: 0,
        durationMs: 0,
      };
    },
  },
  {
    name: "code-rollback",
    description: "Revert changes via shadow git and retry with fresh codebase",
    execute: async (error, context) => {
      const start = Date.now();
      const shadowGit = new ShadowGit(context.workingDir);
      const initialized = await shadowGit.initialize();
      if (!initialized) {
        return { success: false, strategy: "code-rollback", output: "Could not init shadow git", tokensUsed: 0, durationMs: Date.now() - start };
      }

      const checkpoints = await shadowGit.listCheckpoints();
      if (checkpoints.length === 0) {
        return { success: false, strategy: "code-rollback", output: "No checkpoints to restore", tokensUsed: 0, durationMs: Date.now() - start };
      }

      const checkpoint = checkpoints[0]!;
      const restored = await shadowGit.restore(checkpoint);
      return {
        success: restored,
        strategy: "code-rollback",
        output: restored ? `Rolled back to checkpoint ${checkpoint.slice(0, 8)}` : "Rollback failed",
        tokensUsed: 0,
        durationMs: Date.now() - start,
      };
    },
  },
  {
    name: "strategy-change",
    description: "Switch to a completely different approach",
    execute: async (error, context) => {
      const alternatePrompt = [
        `After ${context.attempt} failed attempts (last error: ${error.category}), take a completely different approach.`,
        "",
        `DO NOT repeat these patterns: ${context.priorErrors.map((e) => e.category).join(", ")}`,
        "",
        `Original task: ${context.taskDescription}`,
        "",
        "Consider: different algorithm, different file structure, different library, or simplifying the approach.",
      ].join("\n");

      return {
        success: true,
        strategy: "strategy-change",
        output: alternatePrompt,
        tokensUsed: 0,
        durationMs: 0,
      };
    },
  },
  {
    name: "human-escalation",
    description: "Generate a detailed error report for human review",
    execute: async (error, context) => {
      const report = [
        "# Self-Healing Escalation Report",
        "",
        `**Task:** ${context.taskDescription}`,
        `**Attempts:** ${context.attempt}/${context.maxAttempts}`,
        `**Provider:** ${context.provider} / ${context.model}`,
        "",
        "## Error History",
        ...context.priorErrors.map((e, i) =>
          `${i + 1}. [${e.category}] ${e.message.slice(0, 100)}${e.file ? ` (${e.file}:${e.line ?? "?"})` : ""}`
        ),
        "",
        "## Last Error",
        `- Category: ${error.category}`,
        `- Confidence: ${error.confidence}`,
        error.suggestedFix ? `- Suggested Fix: ${error.suggestedFix}` : "",
        "",
        "## Recommended Action",
        detectErrorRepetition(context.priorErrors).isRepeating
          ? "The same error type is repeating — the approach needs fundamental rethinking."
          : "Multiple different errors suggest the task is complex. Break it into smaller steps.",
      ].filter(Boolean).join("\n");

      return {
        success: false,
        strategy: "human-escalation",
        output: report,
        tokensUsed: 0,
        durationMs: 0,
      };
    },
  },
];

// ── Pipeline Executor ───────────────────────────────────

export class SelfHealingPipeline {
  private readonly maxAttempts: number;
  private readonly errorHistory: ClassifiedError[] = [];
  private readonly recoveryHistory: RecoveryResult[] = [];
  private totalTokensUsed = 0;
  private readonly startTime = Date.now();

  constructor(maxAttempts: number = 5) {
    this.maxAttempts = maxAttempts;
  }

  /**
   * Select the best recovery strategy based on error history.
   */
  selectRecoveryStrategy(error: ClassifiedError): RecoveryStrategy {
    const repetition = detectErrorRepetition(this.errorHistory);

    // If errors are repeating, escalate to rollback or strategy change
    if (repetition.isRepeating) {
      if (repetition.repeatCount >= this.maxAttempts) {
        return RECOVERY_STRATEGIES[3]!; // human-escalation
      }
      return RECOVERY_STRATEGIES[2]!; // strategy-change
    }

    // Rate limits and provider errors → not a code problem
    if (error.category === "rate-limit" || error.category === "provider-error") {
      return RECOVERY_STRATEGIES[0]!; // prompt-fix (will be handled by provider fallback)
    }

    // After 2+ attempts, try rollback
    if (this.errorHistory.length >= 2) {
      return RECOVERY_STRATEGIES[1]!; // code-rollback
    }

    // Default: prompt-fix with error context
    return RECOVERY_STRATEGIES[0]!;
  }

  /**
   * Execute one recovery cycle.
   */
  async executeRecovery(
    errorText: string,
    context: Omit<PipelineContext, "attempt" | "priorErrors" | "maxAttempts">,
  ): Promise<RecoveryResult> {
    const error = classifyError(errorText);
    this.errorHistory.push(error);

    const strategy = this.selectRecoveryStrategy(error);

    const fullContext: PipelineContext = {
      ...context,
      attempt: this.errorHistory.length,
      priorErrors: [...this.errorHistory],
      maxAttempts: this.maxAttempts,
    };

    const result = await strategy.execute(error, fullContext);
    this.recoveryHistory.push(result);
    this.totalTokensUsed += result.tokensUsed;

    return result;
  }

  /**
   * Full pipeline: run task with automatic error recovery.
   */
  async run(
    runner: (prompt: string) => Promise<{ success: boolean; output: string; tokensUsed: number }>,
    initialPrompt: string,
    context: Omit<PipelineContext, "attempt" | "priorErrors" | "maxAttempts" | "taskDescription">,
  ): Promise<PipelineResult> {
    let currentPrompt = initialPrompt;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const result = await runner(currentPrompt);
      this.totalTokensUsed += result.tokensUsed;

      if (result.success) {
        return {
          success: true,
          attempts: attempt + 1,
          errors: [...this.errorHistory],
          recoveries: [...this.recoveryHistory],
          totalTokensUsed: this.totalTokensUsed,
          totalDurationMs: Date.now() - this.startTime,
          finalStrategy: attempt === 0 ? "direct" : this.recoveryHistory.at(-1)?.strategy ?? "unknown",
        };
      }

      // Classify and attempt recovery
      const recovery = await this.executeRecovery(result.output, {
        ...context,
        taskDescription: initialPrompt,
      });

      if (!recovery.success && recovery.strategy === "human-escalation") {
        return {
          success: false,
          attempts: attempt + 1,
          errors: [...this.errorHistory],
          recoveries: [...this.recoveryHistory],
          totalTokensUsed: this.totalTokensUsed,
          totalDurationMs: Date.now() - this.startTime,
          finalStrategy: "human-escalation",
        };
      }

      // Use recovery output as next prompt
      currentPrompt = recovery.output;
    }

    return {
      success: false,
      attempts: this.maxAttempts,
      errors: [...this.errorHistory],
      recoveries: [...this.recoveryHistory],
      totalTokensUsed: this.totalTokensUsed,
      totalDurationMs: Date.now() - this.startTime,
      finalStrategy: "exhausted",
    };
  }

  getErrorHistory(): readonly ClassifiedError[] {
    return [...this.errorHistory];
  }

  getRecoveryHistory(): readonly RecoveryResult[] {
    return [...this.recoveryHistory];
  }

  reset(): void {
    this.errorHistory.length = 0;
    this.recoveryHistory.length = 0;
    this.totalTokensUsed = 0;
  }
}
