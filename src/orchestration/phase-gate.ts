/**
 * Phase Gate — entry + exit criteria + max-iter guard.
 *
 * PART OF: long-horizon orchestrator (autonovel-style, Phase H+D).
 *
 * A `Phase` is one stage of a multi-stage autonomous task (e.g. "outline",
 * "draft chapter 1", "draft chapter 2", "revision pass"). Each phase has:
 *
 *   - Entry criteria: whether we're allowed to start (prev score >= threshold)
 *   - Exit criteria:  whether we're allowed to finish (score + artifact + review)
 *   - Max iterations: hard cap so a stuck phase doesn't burn budget forever
 *
 * This file is a PURE policy module — no I/O, no LLM calls. The orchestrator
 * owns the loop; this file just answers three questions:
 *
 *   canEnter(phase, prevResult) → { allowed, reason }
 *   canExit(phase, attempt) → { allowed, reason }
 *   isExhausted(phase, iteration) → boolean
 *
 * Keeping policy pure makes it trivial to unit-test and swap out scoring
 * schemes later (Phase H2 may add model-specific rubrics).
 */

// ── Types ──────────────────────────────────────────────

export interface PhaseExitCriterion {
  /** Minimum score (0-1) the artifact must reach before the phase can exit. */
  readonly minScore: number;
  /** Dual-persona reviewer must return a pass verdict before exit. */
  readonly requireReviewPass: boolean;
  /** Iterations without plateau — exit early if this many clean iters seen. */
  readonly minCleanIterations?: number;
}

export interface PhaseEntryCriterion {
  /** Previous phase must have achieved at least this score. */
  readonly prevMinScore: number;
  /** Previous phase must have an artifact (non-empty string). */
  readonly prevRequiresArtifact: boolean;
}

export interface Phase {
  readonly id: string;
  /** Human-readable name — shown in progress events. */
  readonly name: string;
  /** What the worker is trying to produce in this phase. */
  readonly goal: string;
  readonly entry: PhaseEntryCriterion;
  readonly exit: PhaseExitCriterion;
  /** Hard cap on iterations. If hit, phase is marked exhausted (bail). */
  readonly maxIterations: number;
}

/** Result of a single iteration inside a phase. */
export interface IterationResult {
  readonly iteration: number;
  readonly artifact: string;
  readonly score: number;
  readonly reviewPassed: boolean | null; // null = not reviewed this iter
  readonly timestamp: number;
}

/** Snapshot of a phase's running state. */
export interface PhaseState {
  readonly phase: Phase;
  readonly iterations: readonly IterationResult[];
  readonly status: "pending" | "running" | "exited" | "exhausted" | "plateaued";
  readonly bestIteration: IterationResult | null;
  readonly startedAt?: number;
  readonly endedAt?: number;
}

export interface GateDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

// ── Factory ────────────────────────────────────────────

/**
 * Build an initial phase state. Immutable — orchestrator returns new state
 * objects as the phase progresses.
 */
export function initPhaseState(phase: Phase): PhaseState {
  return {
    phase,
    iterations: [],
    status: "pending",
    bestIteration: null,
  };
}

// ── Entry gate ─────────────────────────────────────────

/**
 * Check whether the next phase can enter given the previous phase's state.
 *
 * The first phase (prev = null) passes only the artifact requirement if the
 * entry explicitly requires one, otherwise it enters unconditionally.
 */
export function canEnter(phase: Phase, prevState: PhaseState | null): GateDecision {
  // First phase: enter unconditionally unless it requires a prior artifact.
  if (prevState === null) {
    if (phase.entry.prevRequiresArtifact) {
      return {
        allowed: false,
        reason: `phase ${phase.id} requires a prior artifact but no previous phase exists`,
      };
    }
    return { allowed: true, reason: "first phase, no entry gate" };
  }

  const prevBest = prevState.bestIteration;

  if (phase.entry.prevRequiresArtifact) {
    if (!prevBest || prevBest.artifact.length === 0) {
      return {
        allowed: false,
        reason: `previous phase ${prevState.phase.id} produced no artifact`,
      };
    }
  }

  if (prevBest && prevBest.score < phase.entry.prevMinScore) {
    return {
      allowed: false,
      reason: `previous phase score ${prevBest.score.toFixed(2)} < required ${phase.entry.prevMinScore.toFixed(2)}`,
    };
  }

  // Previous phase must have exited cleanly (not exhausted/plateaued).
  if (prevState.status !== "exited") {
    return {
      allowed: false,
      reason: `previous phase status is ${prevState.status}, need "exited"`,
    };
  }

  return { allowed: true, reason: "prev phase cleared entry gate" };
}

// ── Exit gate ──────────────────────────────────────────

/**
 * Check whether the current phase can exit given its latest iteration.
 */
export function canExit(phase: Phase, latest: IterationResult): GateDecision {
  if (latest.score < phase.exit.minScore) {
    return {
      allowed: false,
      reason: `score ${latest.score.toFixed(2)} < required ${phase.exit.minScore.toFixed(2)}`,
    };
  }

  if (phase.exit.requireReviewPass) {
    if (latest.reviewPassed === null) {
      return {
        allowed: false,
        reason: "review required but no review verdict recorded",
      };
    }
    if (latest.reviewPassed === false) {
      return {
        allowed: false,
        reason: "dual-persona reviewer rejected the artifact",
      };
    }
  }

  if (latest.artifact.length === 0) {
    return {
      allowed: false,
      reason: "artifact is empty",
    };
  }

  return { allowed: true, reason: "all exit criteria met" };
}

// ── Exhaustion guard ───────────────────────────────────

/**
 * Return true when the phase has used up its iteration budget. Orchestrator
 * should stop the phase loop and either bail out or escalate (tier bump).
 */
export function isExhausted(phase: Phase, iteration: number): boolean {
  return iteration >= phase.maxIterations;
}

// ── State transitions ──────────────────────────────────

/**
 * Append an iteration result to a phase state, updating `bestIteration` if
 * the new iteration improves the score. Returns a new state — callers never
 * mutate the old one (immutability contract per project coding-style rules).
 */
export function recordIteration(state: PhaseState, result: IterationResult): PhaseState {
  const iterations = [...state.iterations, result];
  const best =
    state.bestIteration === null || result.score > state.bestIteration.score
      ? result
      : state.bestIteration;
  return {
    ...state,
    iterations,
    status: state.status === "pending" ? "running" : state.status,
    startedAt: state.startedAt ?? Date.now(),
    bestIteration: best,
  };
}

/** Mark a phase's terminal status. */
export function markPhaseStatus(
  state: PhaseState,
  status: "exited" | "exhausted" | "plateaued",
): PhaseState {
  return {
    ...state,
    status,
    endedAt: Date.now(),
  };
}
