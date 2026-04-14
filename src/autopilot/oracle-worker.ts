/**
 * Oracle/Worker pattern (D13).
 *
 * In autonomous mode the agent defaults to the cheap, fast "worker" model for
 * routine edits and tool calls. Whenever a strategic decision appears — a
 * failing sub-plan, a repeated error, an ambiguous checkpoint — the worker
 * pauses and asks the "oracle" (a stronger model) for one shot of guidance.
 *
 * This mirrors Sourcegraph Amp's escalation pattern: 90% cheap-model throughput
 * with 10% smart-model judgement, at a fraction of the cost of running the
 * smart model throughout.
 *
 * The OracleWorker class doesn't drive the loop itself — it's a stateless
 * escalation policy that the autonomous executor consults.
 */

export type EscalationReason =
  | "repeated-error" // Same error seen N consecutive iterations
  | "stuck-no-progress" // No state change in N iterations
  | "ambiguous-requirement" // User prompt is unclear / contradictory
  | "low-confidence" // Worker self-reports confidence < threshold
  | "critical-decision" // Task involves data loss, auth, secrets
  | "verification-failed"; // Completion oracle failed N times in a row

export interface OracleConsultation {
  readonly reason: EscalationReason;
  readonly question: string;
  readonly evidence: string;
  readonly workerAttempts: readonly string[];
}

export interface OracleResponse {
  readonly guidance: string;
  readonly suggestedModel?: string;
  readonly revisedPlan?: string;
  readonly confidenceBoost: number; // 0-1
  readonly costUsd: number;
}

export interface OracleWorkerConfig {
  readonly workerModel: string;
  readonly oracleModel: string;
  readonly escalationThresholds: {
    readonly repeatedErrorCount: number;
    readonly stuckIterations: number;
    readonly lowConfidenceThreshold: number;
    readonly verificationFailureCount: number;
  };
  readonly maxEscalationsPerTask: number;
}

export const DEFAULT_CONFIG: OracleWorkerConfig = {
  workerModel: "claude-haiku-4-5-20251001",
  oracleModel: "claude-opus-4-6",
  escalationThresholds: {
    repeatedErrorCount: 3,
    stuckIterations: 5,
    lowConfidenceThreshold: 0.4,
    verificationFailureCount: 2,
  },
  maxEscalationsPerTask: 5,
};

export class OracleWorkerPolicy {
  private readonly config: OracleWorkerConfig;
  private escalationCount = 0;
  private readonly errorHistory: string[] = [];
  private readonly iterationHistory: { ts: number; state: string }[] = [];
  private verificationFailures = 0;

  constructor(config: Partial<OracleWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record the outcome of a worker iteration so later calls to
   * `shouldEscalate` can decide based on trajectory rather than a single event.
   */
  recordIteration(params: {
    error?: string;
    stateSnapshot: string;
    verificationPassed?: boolean;
  }): void {
    if (params.error) {
      this.errorHistory.push(params.error);
      if (this.errorHistory.length > 20) this.errorHistory.shift();
    }
    this.iterationHistory.push({ ts: Date.now(), state: params.stateSnapshot });
    if (this.iterationHistory.length > 30) this.iterationHistory.shift();
    if (params.verificationPassed === false) {
      this.verificationFailures += 1;
    } else if (params.verificationPassed === true) {
      this.verificationFailures = 0;
    }
  }

  /**
   * Decide whether the next worker step should be preceded by an oracle call.
   * Returns `null` if the worker should continue unassisted.
   */
  shouldEscalate(params: {
    currentConfidence?: number;
    currentTask: string;
  }): EscalationReason | null {
    if (this.escalationCount >= this.config.maxEscalationsPerTask) {
      return null;
    }

    // Low confidence — the worker itself asks for help
    if (
      typeof params.currentConfidence === "number" &&
      params.currentConfidence < this.config.escalationThresholds.lowConfidenceThreshold
    ) {
      return "low-confidence";
    }

    // Repeated error: the same error string seen N times in a row
    const n = this.config.escalationThresholds.repeatedErrorCount;
    if (this.errorHistory.length >= n) {
      const last = this.errorHistory.slice(-n);
      const allSame = last.every((e) => e === last[0]);
      if (allSame) return "repeated-error";
    }

    // Stuck: same state snapshot repeated across N iterations
    const s = this.config.escalationThresholds.stuckIterations;
    if (this.iterationHistory.length >= s) {
      const last = this.iterationHistory.slice(-s);
      const allSame = last.every((i) => i.state === last[0]?.state);
      if (allSame) return "stuck-no-progress";
    }

    // Verification has been failing persistently
    if (this.verificationFailures >= this.config.escalationThresholds.verificationFailureCount) {
      return "verification-failed";
    }

    // Task mentions a critical keyword → escalate once
    const criticalKeywords = [
      "delete",
      "drop table",
      "rm -rf",
      "migration",
      "auth",
      "secret",
      "credential",
    ];
    if (criticalKeywords.some((k) => params.currentTask.toLowerCase().includes(k))) {
      if (this.escalationCount === 0) return "critical-decision";
    }

    return null;
  }

  /**
   * Build the oracle prompt from the accumulated evidence. Pass the returned
   * OracleConsultation to the router/runtime to actually call the oracle
   * model — this class stays transport-agnostic so it's easy to test.
   */
  prepareConsultation(reason: EscalationReason, currentTask: string): OracleConsultation {
    const workerAttempts = [...this.errorHistory].slice(-5);
    const stateSummary = this.iterationHistory
      .slice(-3)
      .map((i) => `T+${Math.round((Date.now() - i.ts) / 1000)}s: ${i.state.slice(0, 160)}`)
      .join("\n");

    const question = ((): string => {
      switch (reason) {
        case "repeated-error":
          return `The worker has failed with the same error ${this.config.escalationThresholds.repeatedErrorCount} times in a row. Should we change approach? If so, give one concrete next step.`;
        case "stuck-no-progress":
          return `The worker has produced no state change for ${this.config.escalationThresholds.stuckIterations} iterations. Is the plan itself wrong? What specifically is blocking progress?`;
        case "ambiguous-requirement":
          return `The user requirement is ambiguous. Pick the interpretation most likely to succeed and justify it in one sentence.`;
        case "low-confidence":
          return `The worker reports low confidence in the next step. Provide one concrete instruction that unblocks it.`;
        case "critical-decision":
          return `This task touches critical state (data loss, auth, secrets). Validate the plan and flag risks before execution continues.`;
        case "verification-failed":
          return `Completion verification has failed ${this.config.escalationThresholds.verificationFailureCount} times. Is the task actually done and the verifier wrong, or is something genuinely missing?`;
      }
    })();

    return {
      reason,
      question,
      evidence: `Recent state:\n${stateSummary}\n\nRecent errors:\n${workerAttempts.join("\n")}`,
      workerAttempts,
    };
  }

  /** Mark that the oracle was consulted. Clamps against maxEscalationsPerTask. */
  markConsulted(): void {
    this.escalationCount += 1;
    this.errorHistory.length = 0;
    this.verificationFailures = 0;
  }

  /** Introspection for tests and the autopilot UI. */
  getStats(): {
    readonly escalationCount: number;
    readonly errorHistorySize: number;
    readonly verificationFailures: number;
  } {
    return {
      escalationCount: this.escalationCount,
      errorHistorySize: this.errorHistory.length,
      verificationFailures: this.verificationFailures,
    };
  }

  /** Reset state for a new task. Old error/state traces are discarded. */
  reset(): void {
    this.escalationCount = 0;
    this.errorHistory.length = 0;
    this.iterationHistory.length = 0;
    this.verificationFailures = 0;
  }

  /** Worker/oracle model identifiers for logging and dispatch. */
  models(): { readonly worker: string; readonly oracle: string } {
    return { worker: this.config.workerModel, oracle: this.config.oracleModel };
  }
}

/**
 * Convenience factory — returns a policy configured with sensible defaults
 * for the given task type. Use when you don't want to hand-tune thresholds.
 */
export function makeOracleWorker(
  taskType: "code" | "ui" | "research" | "devops",
): OracleWorkerPolicy {
  switch (taskType) {
    case "code":
      return new OracleWorkerPolicy({
        escalationThresholds: {
          repeatedErrorCount: 3,
          stuckIterations: 5,
          lowConfidenceThreshold: 0.4,
          verificationFailureCount: 2,
        },
      });
    case "ui":
      return new OracleWorkerPolicy({
        escalationThresholds: {
          repeatedErrorCount: 4,
          stuckIterations: 6,
          lowConfidenceThreshold: 0.5,
          verificationFailureCount: 3,
        },
      });
    case "research":
      return new OracleWorkerPolicy({
        escalationThresholds: {
          repeatedErrorCount: 2,
          stuckIterations: 3,
          lowConfidenceThreshold: 0.6,
          verificationFailureCount: 1,
        },
      });
    case "devops":
      return new OracleWorkerPolicy({
        escalationThresholds: {
          repeatedErrorCount: 2,
          stuckIterations: 3,
          lowConfidenceThreshold: 0.5,
          verificationFailureCount: 1,
        },
        maxEscalationsPerTask: 10, // devops is risky — allow more oracle help
      });
  }
}
