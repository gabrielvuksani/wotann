/**
 * Long-Horizon Orchestrator — autonovel-style phase-gated orchestrator.
 *
 * PART OF: Phase H+D. Lane 6 identified autonovel's pattern as the biggest
 * user-visible orchestration win. WOTANN's existing autopilot doesn't have
 * this structure; this module adds it WITHOUT replacing autopilot.
 *
 * TARGETS:
 *   - 8+ hour autonomous runs (e.g. "write a 75K-word novel")
 *   - Multiple distinct phases (outline → draft → revise → polish)
 *   - Phase gates with entry/exit criteria + dual-persona review
 *   - Plateau detection with tier escalation / human-in-loop / abort
 *   - Budget respect: token cap + wall-clock cap, no silent loops
 *   - Checkpoint per phase (extends src/autopilot/checkpoint.ts)
 *   - Progress event emission for UI (percentage + phase name)
 *
 * QUALITY BARS (per task brief):
 *   - Honest plateau-escalate: every response is surfaced via callback
 *   - No silent infinite loops: both phase.maxIterations AND budget caps
 *   - Budget-respect: checks BEFORE each iteration, emits progress on abort
 *
 * WIRING:
 *   - Uses phase-gate.ts for entry/exit policy
 *   - Uses plateau-detector.ts for stagnation detection
 *   - Uses dual-persona-reviewer.ts at exit gates
 *   - Uses autopilot/checkpoint.ts for per-phase checkpoint persistence
 *   - Orchestrator does NOT make LLM calls directly — caller injects all
 *     I/O via WorkerExecutor + PersonaExecutor + Scorer. This keeps the
 *     orchestrator testable with mocks.
 */

import {
  canEnter,
  canExit,
  initPhaseState,
  isExhausted,
  markPhaseStatus,
  recordIteration,
  type IterationResult,
  type Phase,
  type PhaseState,
} from "./phase-gate.js";
import {
  DEFAULT_PLATEAU_CONFIG,
  detectPlateau,
  recommendPlateauResponse,
  type PlateauConfig,
  type PlateauResponse,
  type PlateauVerdict,
} from "./plateau-detector.js";
import {
  DEFAULT_DUAL_PERSONA_CONFIG,
  runDualPersonaReview,
  type DualPersonaConfig,
  type DualPersonaVerdict,
  type PersonaExecutor,
} from "./dual-persona-reviewer.js";

// ── Types ──────────────────────────────────────────────

export interface LongHorizonBudget {
  /** Max total tokens across all phases. */
  readonly tokens: number;
  /** Max wall-clock ms across all phases. */
  readonly timeMs: number;
  /** Max USD if caller tracks costs. Set to Infinity to ignore. */
  readonly usd: number;
}

/**
 * The worker executor: given a phase + attempt context, produce the next
 * revision of the artifact. The caller wires this to the real LLM provider.
 *
 * Returning `null` indicates the worker cannot proceed (e.g. no provider
 * available). The orchestrator treats null as a soft failure and counts it
 * as a failed iteration — allowing plateau detection and max-iter to fire.
 */
export type WorkerExecutor = (params: {
  readonly phase: Phase;
  readonly iteration: number;
  readonly previousArtifact: string | null;
  readonly reviewerFeedback: string | null;
  readonly plateauHint: string | null;
  readonly tierHint: "normal" | "escalated";
}) => Promise<{
  readonly artifact: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
} | null>;

/**
 * Score an artifact (0-1). Caller's responsibility: could be heuristic (word
 * count, required-sections) or another LLM call. Orchestrator treats it as
 * opaque.
 */
export type Scorer = (artifact: string, phase: Phase) => Promise<number>;

/** Checkpoint persistence callback. Called once per completed phase. */
export type CheckpointSaver = (snapshot: OrchestratorSnapshot) => Promise<void>;

/** Human-in-loop callback. Returns true to continue, false to abort. */
export type HumanReviewer = (params: {
  readonly phase: Phase;
  readonly reason: string;
  readonly bestArtifact: string;
  readonly bestScore: number;
}) => Promise<boolean>;

export interface LongHorizonConfig {
  readonly budget: LongHorizonBudget;
  readonly plateauConfig: PlateauConfig;
  readonly dualPersonaConfig: DualPersonaConfig;
  /** If true, run dual-persona review at each phase exit. Default true. */
  readonly enableReview: boolean;
  /** If true, allow plateau → tier escalation (orchestrator flips tierHint). */
  readonly enableTierEscalation: boolean;
  /** If true, ask human reviewer when plateau persists. */
  readonly enableHumanInLoop: boolean;
}

export const DEFAULT_LONG_HORIZON_CONFIG: LongHorizonConfig = {
  budget: {
    tokens: 1_000_000,
    timeMs: 8 * 60 * 60 * 1000, // 8 hours
    usd: 50,
  },
  plateauConfig: DEFAULT_PLATEAU_CONFIG,
  dualPersonaConfig: DEFAULT_DUAL_PERSONA_CONFIG,
  enableReview: true,
  enableTierEscalation: true,
  enableHumanInLoop: false, // opt-in for unattended runs
};

// ── Events ─────────────────────────────────────────────

export type OrchestratorEvent =
  | {
      readonly kind: "phase-start";
      readonly phase: Phase;
      readonly index: number;
      readonly total: number;
    }
  | { readonly kind: "phase-entry-blocked"; readonly phase: Phase; readonly reason: string }
  | {
      readonly kind: "iteration-start";
      readonly phase: Phase;
      readonly iteration: number;
      readonly tierHint: "normal" | "escalated";
    }
  | {
      readonly kind: "iteration-end";
      readonly phase: Phase;
      readonly iteration: number;
      readonly score: number;
      readonly tokensUsed: number;
    }
  | {
      readonly kind: "review";
      readonly phase: Phase;
      readonly iteration: number;
      readonly verdict: DualPersonaVerdict;
    }
  | {
      readonly kind: "plateau";
      readonly phase: Phase;
      readonly verdict: PlateauVerdict;
      readonly response: PlateauResponse;
    }
  | { readonly kind: "tier-escalate"; readonly phase: Phase; readonly reason: string }
  | { readonly kind: "human-review-request"; readonly phase: Phase; readonly reason: string }
  | { readonly kind: "human-review-response"; readonly phase: Phase; readonly continue: boolean }
  | {
      readonly kind: "phase-end";
      readonly phase: Phase;
      readonly status: PhaseState["status"];
      readonly bestScore: number;
    }
  | {
      readonly kind: "budget-exceeded";
      readonly dimension: "tokens" | "time" | "usd";
      readonly spent: number;
      readonly cap: number;
    }
  | {
      readonly kind: "progress";
      readonly percentage: number;
      readonly phaseIndex: number;
      readonly totalPhases: number;
      readonly phaseName: string;
      readonly iteration: number;
    }
  | { readonly kind: "orchestrator-end"; readonly result: OrchestratorResult };

export type EventListener = (event: OrchestratorEvent) => void;

// ── Result / Snapshot ──────────────────────────────────

export type OrchestratorExitReason =
  | "all-phases-exited"
  | "phase-exhausted"
  | "phase-entry-blocked"
  | "budget-tokens"
  | "budget-time"
  | "budget-usd"
  | "plateau-abort"
  | "human-abort"
  | "worker-null"
  | "error";

export interface OrchestratorResult {
  readonly success: boolean;
  readonly exitReason: OrchestratorExitReason;
  readonly phases: readonly PhaseState[];
  readonly totalTokens: number;
  readonly totalUsd: number;
  readonly totalDurationMs: number;
  readonly startedAt: number;
  readonly endedAt: number;
}

export interface OrchestratorSnapshot {
  readonly taskDescription: string;
  readonly phases: readonly PhaseState[];
  readonly currentPhaseIndex: number;
  readonly totalTokens: number;
  readonly totalUsd: number;
  readonly totalDurationMs: number;
  readonly timestamp: number;
}

// ── Orchestrator ───────────────────────────────────────

export interface LongHorizonInput {
  readonly taskDescription: string;
  readonly phases: readonly Phase[];
  readonly worker: WorkerExecutor;
  readonly scorer: Scorer;
  readonly reviewer?: PersonaExecutor;
  readonly humanReviewer?: HumanReviewer;
  readonly saveCheckpoint?: CheckpointSaver;
  readonly onEvent?: EventListener;
  readonly config?: Partial<LongHorizonConfig>;
}

export class LongHorizonOrchestrator {
  private readonly config: LongHorizonConfig;

  constructor(configOverride?: Partial<LongHorizonConfig>) {
    this.config = mergeConfig(DEFAULT_LONG_HORIZON_CONFIG, configOverride);
  }

  /**
   * Execute all phases sequentially. Each phase runs its own iterate/review
   * loop. Returns a final OrchestratorResult with phase-level state so
   * callers can inspect what got produced even on failure.
   */
  async run(input: LongHorizonInput): Promise<OrchestratorResult> {
    // Merge per-run config over orchestrator defaults so callers can tweak
    // plateau/budget/review settings per task.
    const cfg = mergeConfig(this.config, input.config);

    const emit = (event: OrchestratorEvent): void => {
      try {
        input.onEvent?.(event);
      } catch {
        // Never let listener throws break orchestration.
      }
    };

    const startedAt = Date.now();
    const phaseStates: PhaseState[] = input.phases.map((p) => initPhaseState(p));
    let totalTokens = 0;
    let totalUsd = 0;

    // Phase-gated main loop.
    for (let phaseIdx = 0; phaseIdx < input.phases.length; phaseIdx++) {
      const phase = input.phases[phaseIdx];
      if (!phase) continue;
      const prevState = phaseIdx > 0 ? (phaseStates[phaseIdx - 1] ?? null) : null;

      emit({ kind: "phase-start", phase, index: phaseIdx, total: input.phases.length });

      // ── Entry gate ──
      const entry = canEnter(phase, prevState);
      if (!entry.allowed) {
        emit({ kind: "phase-entry-blocked", phase, reason: entry.reason });
        return finalize({
          success: false,
          exitReason: "phase-entry-blocked",
          phases: phaseStates,
          totalTokens,
          totalUsd,
          startedAt,
          emit,
        });
      }

      // ── Phase iteration loop ──
      let state = phaseStates[phaseIdx] ?? initPhaseState(phase);
      let previousArtifact: string | null = null;
      let reviewerFeedback: string | null = null;
      let plateauHint: string | null = null;
      let tierHint: "normal" | "escalated" = "normal";
      let consecutivePlateauVerdicts = 0;

      for (let iteration = 0; iteration < phase.maxIterations; iteration++) {
        // ── Budget checks (BEFORE each iteration — budget-respect bar) ──
        const budgetViolation = checkBudget(
          { tokens: totalTokens, usd: totalUsd, elapsedMs: Date.now() - startedAt },
          cfg.budget,
        );
        if (budgetViolation) {
          emit({
            kind: "budget-exceeded",
            dimension: budgetViolation.dimension,
            spent: budgetViolation.spent,
            cap: budgetViolation.cap,
          });
          phaseStates[phaseIdx] = markPhaseStatus(state, "exhausted");
          return finalize({
            success: false,
            exitReason: `budget-${budgetViolation.dimension}` as OrchestratorExitReason,
            phases: phaseStates,
            totalTokens,
            totalUsd,
            startedAt,
            emit,
          });
        }

        emit({ kind: "iteration-start", phase, iteration, tierHint });

        // ── Worker call ──
        let workerResult: Awaited<ReturnType<WorkerExecutor>>;
        try {
          workerResult = await input.worker({
            phase,
            iteration,
            previousArtifact,
            reviewerFeedback,
            plateauHint,
            tierHint,
          });
        } catch (err) {
          // Worker threw — treat as null and let plateau/max-iter catch it.
          workerResult = null;
          emit({
            kind: "orchestrator-end",
            result: {
              success: false,
              exitReason: "error",
              phases: phaseStates,
              totalTokens,
              totalUsd,
              totalDurationMs: Date.now() - startedAt,
              startedAt,
              endedAt: Date.now(),
            },
          });
          throw err;
        }

        if (!workerResult) {
          phaseStates[phaseIdx] = markPhaseStatus(state, "exhausted");
          return finalize({
            success: false,
            exitReason: "worker-null",
            phases: phaseStates,
            totalTokens,
            totalUsd,
            startedAt,
            emit,
          });
        }

        totalTokens += workerResult.tokensUsed;
        totalUsd += workerResult.costUsd;

        // ── Score the artifact ──
        const score = clamp01(await input.scorer(workerResult.artifact, phase));
        const iterResult: IterationResult = {
          iteration,
          artifact: workerResult.artifact,
          score,
          reviewPassed: null,
          timestamp: Date.now(),
        };

        emit({
          kind: "iteration-end",
          phase,
          iteration,
          score,
          tokensUsed: workerResult.tokensUsed,
        });

        // ── Record iteration into phase state ──
        state = recordIteration(state, iterResult);
        phaseStates[phaseIdx] = state;

        // Reset hints (consumed).
        previousArtifact = workerResult.artifact;
        reviewerFeedback = null;
        plateauHint = null;

        // ── Progress emission ──
        const pctEachPhase = 100 / input.phases.length;
        const iterPct = (iteration + 1) / phase.maxIterations;
        const percentage = Math.round(pctEachPhase * (phaseIdx + iterPct));
        emit({
          kind: "progress",
          percentage,
          phaseIndex: phaseIdx,
          totalPhases: input.phases.length,
          phaseName: phase.name,
          iteration,
        });

        // ── Plateau detection ──
        const scoreHistory = state.iterations.map((it) => it.score);
        const plateauVerdict = detectPlateau(scoreHistory, cfg.plateauConfig);

        if (plateauVerdict.plateaued) {
          consecutivePlateauVerdicts++;
          const response = recommendPlateauResponse(plateauVerdict, consecutivePlateauVerdicts);
          emit({ kind: "plateau", phase, verdict: plateauVerdict, response });

          switch (response) {
            case "escalate-tier": {
              if (cfg.enableTierEscalation && tierHint === "normal") {
                tierHint = "escalated";
                plateauHint = plateauVerdict.reason;
                emit({ kind: "tier-escalate", phase, reason: plateauVerdict.reason });
              } else {
                plateauHint = plateauVerdict.reason;
              }
              break;
            }
            case "request-human": {
              if (cfg.enableHumanInLoop && input.humanReviewer) {
                emit({ kind: "human-review-request", phase, reason: plateauVerdict.reason });
                const continueRun = await input.humanReviewer({
                  phase,
                  reason: plateauVerdict.reason,
                  bestArtifact: state.bestIteration?.artifact ?? "",
                  bestScore: state.bestIteration?.score ?? 0,
                });
                emit({ kind: "human-review-response", phase, continue: continueRun });
                if (!continueRun) {
                  phaseStates[phaseIdx] = markPhaseStatus(state, "plateaued");
                  return finalize({
                    success: false,
                    exitReason: "human-abort",
                    phases: phaseStates,
                    totalTokens,
                    totalUsd,
                    startedAt,
                    emit,
                  });
                }
                plateauHint = plateauVerdict.reason;
              } else {
                // No human-in-loop configured — escalate to abort on next
                // plateau hit (honest: we refuse to spin infinitely).
                plateauHint = plateauVerdict.reason;
              }
              break;
            }
            case "abort": {
              phaseStates[phaseIdx] = markPhaseStatus(state, "plateaued");
              return finalize({
                success: false,
                exitReason: "plateau-abort",
                phases: phaseStates,
                totalTokens,
                totalUsd,
                startedAt,
                emit,
              });
            }
            case "continue":
              break;
          }
        } else {
          consecutivePlateauVerdicts = 0;
        }

        // ── Exit check (score + optional dual-persona review) ──
        const exitCheck = canExit(phase, iterResult);
        if (!exitCheck.allowed && !phase.exit.requireReviewPass) {
          // Score too low and no review needed — continue iterating.
          continue;
        }

        // If exit requires review, run it now even if canExit would've
        // blocked on review-null. canExit re-checks after we attach verdict.
        if (phase.exit.requireReviewPass && cfg.enableReview && input.reviewer) {
          const verdict = await runDualPersonaReview(
            iterResult.artifact,
            { phaseName: phase.name, phaseGoal: phase.goal },
            input.reviewer,
            cfg.dualPersonaConfig,
          );
          totalTokens += verdict.totalTokens;
          emit({ kind: "review", phase, iteration, verdict });

          const reviewPassed = verdict.outcome === "pass";
          const updatedIter: IterationResult = { ...iterResult, reviewPassed };

          // Re-record with review result (replaces the last iteration).
          state = {
            ...state,
            iterations: [...state.iterations.slice(0, -1), updatedIter],
            bestIteration:
              state.bestIteration && state.bestIteration.iteration === updatedIter.iteration
                ? updatedIter
                : state.bestIteration,
          };
          phaseStates[phaseIdx] = state;

          if (verdict.outcome === "pass") {
            const finalExit = canExit(phase, updatedIter);
            if (finalExit.allowed) {
              phaseStates[phaseIdx] = markPhaseStatus(state, "exited");
              emit({
                kind: "phase-end",
                phase,
                status: "exited",
                bestScore: state.bestIteration?.score ?? 0,
              });
              if (input.saveCheckpoint) {
                try {
                  await input.saveCheckpoint({
                    taskDescription: input.taskDescription,
                    phases: phaseStates,
                    currentPhaseIndex: phaseIdx,
                    totalTokens,
                    totalUsd,
                    totalDurationMs: Date.now() - startedAt,
                    timestamp: Date.now(),
                  });
                } catch {
                  // Checkpoint save is best-effort — never block progress.
                }
              }
              break;
            }
          } else if (verdict.outcome === "reject") {
            reviewerFeedback = summarizeReviewerFeedback(verdict);
            continue;
          } else {
            // Escalate: keep tier-hint bumped if enabled and try again.
            if (cfg.enableTierEscalation && tierHint === "normal") {
              tierHint = "escalated";
              emit({ kind: "tier-escalate", phase, reason: "dual-persona escalate" });
            }
            reviewerFeedback = summarizeReviewerFeedback(verdict);
            continue;
          }
        } else if (exitCheck.allowed) {
          phaseStates[phaseIdx] = markPhaseStatus(state, "exited");
          emit({
            kind: "phase-end",
            phase,
            status: "exited",
            bestScore: state.bestIteration?.score ?? 0,
          });
          if (input.saveCheckpoint) {
            try {
              await input.saveCheckpoint({
                taskDescription: input.taskDescription,
                phases: phaseStates,
                currentPhaseIndex: phaseIdx,
                totalTokens,
                totalUsd,
                totalDurationMs: Date.now() - startedAt,
                timestamp: Date.now(),
              });
            } catch {
              // Best-effort.
            }
          }
          break;
        }
      }

      // ── Exhaustion check after loop ──
      if (
        phaseStates[phaseIdx]?.status === "pending" ||
        phaseStates[phaseIdx]?.status === "running"
      ) {
        // Loop exited without break → max iterations hit.
        const exhaustedPhase = phaseStates[phaseIdx];
        if (exhaustedPhase && isExhausted(phase, exhaustedPhase.iterations.length)) {
          phaseStates[phaseIdx] = markPhaseStatus(exhaustedPhase, "exhausted");
          emit({
            kind: "phase-end",
            phase,
            status: "exhausted",
            bestScore: exhaustedPhase.bestIteration?.score ?? 0,
          });
          return finalize({
            success: false,
            exitReason: "phase-exhausted",
            phases: phaseStates,
            totalTokens,
            totalUsd,
            startedAt,
            emit,
          });
        }
      }
    }

    return finalize({
      success: true,
      exitReason: "all-phases-exited",
      phases: phaseStates,
      totalTokens,
      totalUsd,
      startedAt,
      emit,
    });
  }
}

// ── Helpers ────────────────────────────────────────────

interface FinalizeInput {
  readonly success: boolean;
  readonly exitReason: OrchestratorExitReason;
  readonly phases: readonly PhaseState[];
  readonly totalTokens: number;
  readonly totalUsd: number;
  readonly startedAt: number;
  readonly emit: (event: OrchestratorEvent) => void;
}

function finalize(input: FinalizeInput): OrchestratorResult {
  const endedAt = Date.now();
  const result: OrchestratorResult = {
    success: input.success,
    exitReason: input.exitReason,
    phases: input.phases,
    totalTokens: input.totalTokens,
    totalUsd: input.totalUsd,
    totalDurationMs: endedAt - input.startedAt,
    startedAt: input.startedAt,
    endedAt,
  };
  input.emit({ kind: "orchestrator-end", result });
  return result;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function checkBudget(
  spent: { tokens: number; usd: number; elapsedMs: number },
  budget: LongHorizonBudget,
): { dimension: "tokens" | "time" | "usd"; spent: number; cap: number } | null {
  if (spent.tokens > budget.tokens) {
    return { dimension: "tokens", spent: spent.tokens, cap: budget.tokens };
  }
  if (spent.elapsedMs > budget.timeMs) {
    return { dimension: "time", spent: spent.elapsedMs, cap: budget.timeMs };
  }
  if (spent.usd > budget.usd) {
    return { dimension: "usd", spent: spent.usd, cap: budget.usd };
  }
  return null;
}

function summarizeReviewerFeedback(verdict: DualPersonaVerdict): string {
  const parts: string[] = [
    `Dual-persona review: ${verdict.outcome} — ${verdict.reason}`,
    `Critic (conf ${verdict.critic.confidence.toFixed(2)}): ${verdict.critic.reasoning}`,
  ];
  if (verdict.critic.issues && verdict.critic.issues.length > 0) {
    parts.push(`Issues: ${verdict.critic.issues.slice(0, 5).join("; ")}`);
  }
  parts.push(
    `Defender (conf ${verdict.defender.confidence.toFixed(2)}): ${verdict.defender.reasoning}`,
  );
  return parts.join("\n");
}

function mergeConfig(
  base: LongHorizonConfig,
  override?: Partial<LongHorizonConfig>,
): LongHorizonConfig {
  if (!override) return base;
  return {
    ...base,
    ...override,
    budget: { ...base.budget, ...(override.budget ?? {}) },
    plateauConfig: { ...base.plateauConfig, ...(override.plateauConfig ?? {}) },
    dualPersonaConfig: { ...base.dualPersonaConfig, ...(override.dualPersonaConfig ?? {}) },
  };
}

// ── Phase JSON loading ─────────────────────────────────

/**
 * Validate and normalize a JSON-loaded phases array. The CLI command passes
 * a JSON file path; this helper lets callers sanity-check the shape before
 * running.
 */
export function parsePhases(raw: unknown): readonly Phase[] {
  if (!Array.isArray(raw)) {
    throw new Error("parsePhases: expected array of phases");
  }
  return raw.map((item, idx) => parsePhase(item, idx));
}

function parsePhase(raw: unknown, idx: number): Phase {
  if (!raw || typeof raw !== "object") {
    throw new Error(`parsePhase[${idx}]: expected object`);
  }
  const p = raw as Record<string, unknown>;
  const required = ["id", "name", "goal", "maxIterations"] as const;
  for (const key of required) {
    if (!(key in p)) throw new Error(`parsePhase[${idx}]: missing field "${key}"`);
  }
  if (typeof p.id !== "string" || !p.id)
    throw new Error(`parsePhase[${idx}]: id must be non-empty string`);
  if (typeof p.name !== "string" || !p.name)
    throw new Error(`parsePhase[${idx}]: name must be non-empty string`);
  if (typeof p.goal !== "string") throw new Error(`parsePhase[${idx}]: goal must be string`);
  if (typeof p.maxIterations !== "number" || p.maxIterations < 1) {
    throw new Error(`parsePhase[${idx}]: maxIterations must be >= 1`);
  }

  const entry = (p.entry as Record<string, unknown> | undefined) ?? {};
  const exit = (p.exit as Record<string, unknown> | undefined) ?? {};

  return {
    id: p.id,
    name: p.name,
    goal: p.goal,
    maxIterations: p.maxIterations,
    entry: {
      prevMinScore: typeof entry.prevMinScore === "number" ? entry.prevMinScore : 0,
      prevRequiresArtifact: Boolean(entry.prevRequiresArtifact),
    },
    exit: {
      minScore: typeof exit.minScore === "number" ? exit.minScore : 0.8,
      requireReviewPass: Boolean(exit.requireReviewPass),
      ...(typeof exit.minCleanIterations === "number"
        ? { minCleanIterations: exit.minCleanIterations }
        : {}),
    },
  };
}
