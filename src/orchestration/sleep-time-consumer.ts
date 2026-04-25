/**
 * Sleep-time consumer — V9 Tier 11 T11.2 wire (audit fix 2026-04-24).
 *
 * Bridges the existing `src/learning/sleep-time-agent.ts` (orphan per
 * audit: zero non-test consumers in src/) to the runtime's session-
 * idle clock. When a session has been idle for ≥ N seconds, the
 * consumer fires the agent's `runIdleSession()` to drain the pending
 * task queue against a budget cap.
 *
 * Wire model
 * ──────────
 *   runtime.idleSignal  ── opportunity ──>  consumer.maybeRun()
 *                                              │
 *                                              └── agent.runIdleSession()
 *
 * The consumer is intentionally THIN — it doesn't decide WHAT idle
 * means. The runtime emits an `IdleSignal` (defined by the agent
 * module) that the consumer forwards as-is. This keeps the policy
 * boundary clean: timing lives in the runtime; budget lives in the
 * agent; this consumer is just the wire.
 *
 * Quality bars
 *   - QB #6 honest stubs: when the agent throws or no opportunity
 *     is supplied, the consumer returns `null` rather than fake
 *     a SleepSessionReport.
 *   - QB #7 per-call state: factory closure; no module-level cache.
 *   - QB #11 sibling-site scan: this is the SOLE non-test consumer
 *     of the agent.
 */

import type {
  SleepTimeAgent,
  SleepTimeOpportunity,
  SleepTimeTask,
  SleepSessionReport,
} from "../learning/sleep-time-agent.js";

// ── Public surface ──────────────────────────────────────────

export interface SleepTimeConsumerOptions {
  readonly agent: SleepTimeAgent;
  /**
   * Optional logger for observability. When omitted no logs are
   * emitted — the consumer stays silent in production by default.
   */
  readonly log?: (msg: string) => void;
}

export interface SleepTimeConsumerDiagnostics {
  readonly opportunitiesAttempted: number;
  readonly sessionsCompleted: number;
  readonly tasksProcessed: number;
  readonly lastError: string | null;
  readonly lastReportAt: string | null;
}

export interface SleepTimeConsumer {
  /**
   * Submit a task to the underlying agent's queue. Tasks accumulate
   * until the next idle opportunity drains them.
   */
  readonly submitTask: (task: SleepTimeTask) => void;
  /**
   * Forward an idle opportunity to the agent. Returns the resulting
   * report when the agent ran, or null when the agent threw / had
   * nothing to do.
   */
  readonly maybeRun: (opportunity: SleepTimeOpportunity) => Promise<SleepSessionReport | null>;
  readonly queueLength: () => number;
  readonly getDiagnostics: () => SleepTimeConsumerDiagnostics;
  readonly resetDiagnostics: () => void;
}

// ── Implementation ──────────────────────────────────────────

export function createSleepTimeConsumer(opts: SleepTimeConsumerOptions): SleepTimeConsumer {
  if (!opts || typeof opts !== "object") {
    throw new TypeError("createSleepTimeConsumer: options object required");
  }
  if (!opts.agent || typeof opts.agent.runIdleSession !== "function") {
    throw new TypeError("createSleepTimeConsumer: options.agent with .runIdleSession() required");
  }

  let opportunitiesAttempted = 0;
  let sessionsCompleted = 0;
  let tasksProcessed = 0;
  let lastError: string | null = null;
  let lastReportAt: string | null = null;

  async function maybeRun(opportunity: SleepTimeOpportunity): Promise<SleepSessionReport | null> {
    if (!opportunity || typeof opportunity !== "object") {
      lastError = "maybeRun: opportunity object required";
      return null;
    }
    opportunitiesAttempted += 1;

    try {
      const report = await opts.agent.runIdleSession(opportunity);
      sessionsCompleted += 1;
      tasksProcessed += report.results?.length ?? 0;
      lastReportAt = new Date().toISOString();
      lastError = null;
      const costSum = (report.results ?? []).reduce(
        (acc: number, r: { costUsd?: number }) => acc + (r.costUsd ?? 0),
        0,
      );
      opts.log?.(
        `[sleep-time] session done: ${report.results?.length ?? 0} tasks, ` +
          `cost=${costSum.toFixed(4)}`,
      );
      return report;
    } catch (err) {
      lastError = `runIdleSession threw: ${err instanceof Error ? err.message : String(err)}`;
      opts.log?.(lastError);
      return null;
    }
  }

  return {
    submitTask: (task) => opts.agent.submit(task),
    maybeRun,
    queueLength: () => opts.agent.queueLength(),
    getDiagnostics: () => ({
      opportunitiesAttempted,
      sessionsCompleted,
      tasksProcessed,
      lastError,
      lastReportAt,
    }),
    resetDiagnostics: () => {
      opportunitiesAttempted = 0;
      sessionsCompleted = 0;
      tasksProcessed = 0;
      lastError = null;
      lastReportAt = null;
    },
  };
}
