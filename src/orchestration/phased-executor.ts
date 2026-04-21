/**
 * PhasedExecutor — generic phase-walking base class (P2 orchestrator unification).
 *
 * WOTANN audit (MASTER_PLAN_V8 §6) surfaced 7 orchestrators with similar phase
 * machinery written bespoke each time: autonomous.ts, coordinator.ts,
 * spec-to-ship.ts, long-horizon-orchestrator.ts, self-healing-pipeline.ts,
 * pwr-cycle.ts, wave-executor.ts. Each rebuilds phase ordering, transition
 * validation, event emission, and observable state in a different way.
 *
 * PhasedExecutor is the canonical primitive all of those can compose with.
 * It does ONE thing: walk a fixed list of phases in order, invoke the
 * caller-supplied handler per phase, thread an immutable context through
 * the chain, emit transition events, and fail honestly with structured
 * error types when something goes wrong.
 *
 * DESIGN:
 *   - `PhasedExecutor<Phase extends string, Context>` — fully generic.
 *   - Handlers return the *new* (immutable) context after their phase runs.
 *   - transition() validates the transition is legal (contiguous phases),
 *     throws ErrorInvalidTransition otherwise.
 *   - Any handler throw becomes ErrorPhaseFailed with { phase, reason,
 *     contextSnapshot } — the snapshot is the last good context (pre-failure).
 *   - Instance-per-run: each run() starts from a clean observable state.
 *   - Event hook (`onTransition`) fires before+after the walk as null→first
 *     and last→null, plus between every phase pair. Consumers get a single
 *     stream they can subscribe to without stitching together semantics.
 *
 * NOT IN SCOPE:
 *   - Concurrency / parallel phases (orchestrators that need that compose
 *     this executor per parallel branch).
 *   - Retry logic (callers handle it — they own their retry budget).
 *   - Budget enforcement (orchestrators layer on top, see wall-clock-budget).
 *
 * MIGRATION PATTERN:
 *   Existing orchestrator keeps its public API unchanged. Internally it
 *   delegates phase ordering + transition events to an instance of
 *   PhasedExecutor. Tests for the existing orchestrator stay green.
 */

// ── Types ──────────────────────────────────────────────

/** Handler for a single phase. Returns the updated context. */
export type PhaseHandler<Phase extends string, Context> = (
  context: Context,
  phase: Phase,
) => Promise<Context> | Context;

/** Transition event emitted at each boundary. `null` = before first / after last. */
export interface TransitionEvent<Phase extends string> {
  readonly from: Phase | null;
  readonly to: Phase | null;
  readonly timestamp: number;
}

/** Observable state — read-only snapshot of where the executor is. */
export interface PhasedExecutorState<Phase extends string> {
  readonly phases: readonly Phase[];
  readonly currentPhase: Phase | null;
  readonly completedPhases: readonly Phase[];
  readonly status: "idle" | "running" | "completed" | "failed";
}

/** Configuration for a PhasedExecutor instance. */
export interface PhasedExecutorConfig<Phase extends string, Context> {
  /** Ordered list of phases. Must be non-empty; order is authoritative. */
  readonly phases: readonly Phase[];
  /** Handler per phase. All phases in `phases` MUST have a handler. */
  readonly handlers: Record<Phase, PhaseHandler<Phase, Context>>;
  /** Optional callback fired on every transition (null→first, pairs, last→null). */
  readonly onTransition?: (event: TransitionEvent<Phase>) => void;
}

// ── Errors ─────────────────────────────────────────────

/** Raised when transition() is invoked with unknown phases or a non-contiguous pair. */
export class ErrorInvalidTransition extends Error {
  override readonly name = "ErrorInvalidTransition";
  readonly from: string | null;
  readonly to: string | null;

  constructor(from: string | null, to: string | null, detail: string) {
    super(`Invalid transition ${String(from)} → ${String(to)}: ${detail}`);
    this.from = from;
    this.to = to;
  }
}

/** Raised when a phase handler throws. Preserves the last-known-good context. */
export class ErrorPhaseFailed<Phase extends string, Context> extends Error {
  override readonly name = "ErrorPhaseFailed";
  readonly phase: Phase;
  readonly reason: string;
  readonly contextSnapshot: Context;
  readonly cause: unknown;

  constructor(phase: Phase, reason: string, contextSnapshot: Context, cause: unknown) {
    super(`Phase ${phase} failed: ${reason}`);
    this.phase = phase;
    this.reason = reason;
    this.contextSnapshot = contextSnapshot;
    this.cause = cause;
  }
}

// ── Executor ───────────────────────────────────────────

/**
 * Generic phase walker. Instance-per-run: don't share across concurrent runs.
 *
 * @example
 * const exec = new PhasedExecutor<"a" | "b", { count: number }>({
 *   phases: ["a", "b"] as const,
 *   handlers: {
 *     a: async (ctx) => ({ count: ctx.count + 1 }),
 *     b: async (ctx) => ({ count: ctx.count * 2 }),
 *   },
 * });
 * const out = await exec.run({ count: 0 }); // { count: 2 }
 */
export class PhasedExecutor<Phase extends string, Context> {
  private readonly phases: readonly Phase[];
  private readonly handlers: Record<Phase, PhaseHandler<Phase, Context>>;
  private readonly onTransition: ((event: TransitionEvent<Phase>) => void) | undefined;

  // Per-run state — reset on every run()
  private currentPhase: Phase | null = null;
  private completedPhases: Phase[] = [];
  private status: "idle" | "running" | "completed" | "failed" = "idle";

  constructor(config: PhasedExecutorConfig<Phase, Context>) {
    if (config.phases.length === 0) {
      throw new Error("PhasedExecutor requires at least one phase");
    }
    // Validate every phase has a handler (fail fast at construction, not mid-run).
    for (const p of config.phases) {
      if (typeof config.handlers[p] !== "function") {
        throw new Error(`PhasedExecutor: missing handler for phase "${String(p)}"`);
      }
    }
    // Phase names must be unique.
    const seen = new Set<Phase>();
    for (const p of config.phases) {
      if (seen.has(p)) {
        throw new Error(`PhasedExecutor: duplicate phase "${String(p)}"`);
      }
      seen.add(p);
    }
    this.phases = [...config.phases];
    this.handlers = { ...config.handlers };
    this.onTransition = config.onTransition;
  }

  // ── Observable state ─────────────────────────────────

  observableState(): PhasedExecutorState<Phase> {
    return {
      phases: this.phases,
      currentPhase: this.currentPhase,
      completedPhases: [...this.completedPhases],
      status: this.status,
    };
  }

  getPhases(): readonly Phase[] {
    return this.phases;
  }

  // ── Transition validation ───────────────────────────

  /**
   * Validate a single transition from→to. Raises ErrorInvalidTransition when
   * from or to is unknown, or when the pair is not contiguous in the declared
   * phase order. Pure validator — does not invoke any handler or mutate state.
   *
   * Returns the pair for fluent use; the return value is informational.
   */
  transition(from: Phase, to: Phase, _context: Context): { from: Phase; to: Phase } {
    const fromIdx = this.phases.indexOf(from);
    const toIdx = this.phases.indexOf(to);
    if (fromIdx < 0) {
      throw new ErrorInvalidTransition(from, to, `unknown "from" phase`);
    }
    if (toIdx < 0) {
      throw new ErrorInvalidTransition(from, to, `unknown "to" phase`);
    }
    if (toIdx !== fromIdx + 1) {
      throw new ErrorInvalidTransition(
        from,
        to,
        `expected contiguous phases (${from} → ${this.phases[fromIdx + 1] ?? "<end>"})`,
      );
    }
    // Valid — emit event if a listener is attached.
    this.onTransition?.({ from, to, timestamp: Date.now() });
    return { from, to };
  }

  // ── Main run ─────────────────────────────────────────

  /**
   * Walk phases in declared order, threading context through each handler.
   *
   * Fails with ErrorPhaseFailed (captures the last good context) if any
   * handler throws. Otherwise returns the final context.
   */
  async run(initialContext: Context): Promise<Context> {
    // Reset per-run state
    this.currentPhase = null;
    this.completedPhases = [];
    this.status = "running";

    let context = initialContext;
    let prevPhase: Phase | null = null;

    for (let i = 0; i < this.phases.length; i++) {
      const phase = this.phases[i]!;
      this.currentPhase = phase;

      // Emit transition event (null → first, pairwise otherwise).
      this.onTransition?.({ from: prevPhase, to: phase, timestamp: Date.now() });

      const handler = this.handlers[phase];
      try {
        const result = await Promise.resolve(handler(context, phase));
        context = result;
      } catch (err) {
        this.status = "failed";
        const reason = err instanceof Error ? err.message : String(err);
        // contextSnapshot is the last known-good context — BEFORE this phase
        // ran. That matches the caller's mental model: "where were you when
        // it broke?" is the previous successful phase's output.
        throw new ErrorPhaseFailed<Phase, Context>(phase, reason, context, err);
      }
      this.completedPhases.push(phase);
      prevPhase = phase;
    }

    // Final transition: last phase → null (run complete).
    this.onTransition?.({ from: prevPhase, to: null, timestamp: Date.now() });
    this.currentPhase = null;
    this.status = "completed";
    return context;
  }
}
