/**
 * /loop Command — recurring tasks on interval (Claude Code feature).
 * `wotann loop 5m "run tests"` → runs every 5 minutes via KAIROS cron.
 */

// ── Types ────────────────────────────────────────────────

export interface LoopConfig {
  readonly interval: string;     // "5m", "1h", "30s"
  readonly command: string;
  readonly maxIterations?: number;
  readonly stopOnFailure?: boolean;
}

export interface LoopState {
  readonly id: string;
  readonly config: LoopConfig;
  readonly iteration: number;
  readonly lastRunAt: number | null;
  readonly lastResult: "success" | "failure" | null;
  readonly running: boolean;
  readonly nextRunAt: number;
}

// ── Interval Parser ──────────────────────────────────────

export function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid interval: ${interval}. Use format like 5m, 1h, 30s.`);

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!;

  const multipliers: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return value * (multipliers[unit] ?? 60_000);
}

// ── Loop Manager ─────────────────────────────────────────

export class LoopManager {
  private readonly loops: Map<string, LoopState> = new Map();
  private readonly timers: Map<string, ReturnType<typeof setInterval>> = new Map();

  /**
   * Start a new loop.
   */
  start(
    config: LoopConfig,
    executor: (command: string) => Promise<boolean>,
  ): LoopState {
    const intervalMs = parseInterval(config.interval);
    const id = `loop-${Date.now()}`;

    const state: LoopState = {
      id,
      config,
      iteration: 0,
      lastRunAt: null,
      lastResult: null,
      running: true,
      nextRunAt: Date.now() + intervalMs,
    };

    this.loops.set(id, state);

    // Execute immediately, then on interval
    void this.executeIteration(id, executor);

    const timer = setInterval(() => {
      void this.executeIteration(id, executor);
    }, intervalMs);

    this.timers.set(id, timer);
    return state;
  }

  /**
   * Stop a loop.
   */
  stop(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
    const state = this.loops.get(id);
    if (state) {
      this.loops.set(id, { ...state, running: false });
      return true;
    }
    return false;
  }

  /**
   * Stop all loops.
   */
  stopAll(): void {
    for (const id of this.loops.keys()) {
      this.stop(id);
    }
  }

  /**
   * List active loops.
   */
  list(): readonly LoopState[] {
    return [...this.loops.values()];
  }

  /**
   * Get a specific loop state.
   */
  get(id: string): LoopState | null {
    return this.loops.get(id) ?? null;
  }

  // ── Private ────────────────────────────────────────────

  private async executeIteration(
    id: string,
    executor: (command: string) => Promise<boolean>,
  ): Promise<void> {
    const state = this.loops.get(id);
    if (!state || !state.running) return;

    // Check max iterations
    if (state.config.maxIterations && state.iteration >= state.config.maxIterations) {
      this.stop(id);
      return;
    }

    try {
      const success = await executor(state.config.command);
      const intervalMs = parseInterval(state.config.interval);

      this.loops.set(id, {
        ...state,
        iteration: state.iteration + 1,
        lastRunAt: Date.now(),
        lastResult: success ? "success" : "failure",
        nextRunAt: Date.now() + intervalMs,
      });

      // Stop on failure if configured
      if (!success && state.config.stopOnFailure) {
        this.stop(id);
      }
    } catch {
      this.loops.set(id, {
        ...state,
        iteration: state.iteration + 1,
        lastRunAt: Date.now(),
        lastResult: "failure",
        nextRunAt: Date.now() + parseInterval(state.config.interval),
      });

      if (state.config.stopOnFailure) {
        this.stop(id);
      }
    }
  }
}
