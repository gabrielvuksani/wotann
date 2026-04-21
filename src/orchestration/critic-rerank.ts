/**
 * Critic-model rerank over N parallel rollouts — OpenHands port (P1-B10).
 *
 * Pattern:
 *   1. Dispatch N generator calls in parallel (each a fresh rollout with
 *      potentially different temperature / seed / prompt-variant).
 *   2. For each successful rollout, a critic model scores the candidate
 *      on a 0..100 rubric (correctness, quality, security, tests).
 *   3. Pick the highest-scored candidate. Tie-break: shortest output.
 *
 * Opt-in per task via `rerank: true` in the task spec — this module
 * never fires on its own; the caller decides which tasks are hard
 * enough to justify the N× cost.
 *
 * Design notes (WOTANN quality bars):
 * - QB #6 honest failures: generator and critic errors are captured in
 *   `errors[]` with stage + reason, never silently dropped. If ALL
 *   generators fail, throws `AllRolloutsFailed` with every reason.
 * - QB #7 per-session state: each `rerank()` invocation owns its own
 *   events, rollouts, errors — no class-level mutable state leaks
 *   between concurrent invocations on the same instance.
 * - Observability: events emitted via `onEvent` callback in order.
 * - Injection pattern matches B4 verifier: critic is a `CriticJudge`
 *   which can be built from any `LlmQuery` via `llmQueryCritic()`.
 */

import type {
  CriticCandidate,
  CriticJudge,
  CriticScore,
  CriticTask,
} from "../intelligence/critic-model.js";

// ── Public types ───────────────────────────────────────

/**
 * Result of one generator call. Metadata is provider-specific
 * (temperature, seed, prompt-variant, cost, etc.) — passed through
 * unmodified to the critic and to the final pick rationale.
 */
export interface Rollout {
  readonly output: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type RollouGenerator = (task: CriticTask, index: number) => Promise<Rollout>;

export interface ScoredRollout {
  readonly index: number;
  readonly output: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly score: number;
  readonly reasoning: string;
}

export interface RerankError {
  readonly index: number;
  readonly stage: "generator" | "critic";
  readonly reason: string;
}

export type RerankEvent =
  | { readonly kind: "rollout.started"; readonly index: number }
  | { readonly kind: "rollout.finished"; readonly index: number; readonly output: string }
  | { readonly kind: "rollout.failed"; readonly index: number; readonly reason: string }
  | { readonly kind: "critic.scored"; readonly index: number; readonly score: number }
  | { readonly kind: "critic.failed"; readonly index: number; readonly reason: string }
  | { readonly kind: "rerank.picked"; readonly winnerIndex: number; readonly score: number };

export interface RerankConfig {
  readonly generator: RollouGenerator;
  readonly critic: CriticJudge;
  /** Number of candidate rollouts to generate. Default 5. */
  readonly N?: number;
  /** Per-rollout generation timeout in ms. Default 120_000. */
  readonly perRolloutTimeoutMs?: number;
  /** Event sink for observability. Optional. */
  readonly onEvent?: (event: RerankEvent) => void;
}

export interface RerankResult {
  /** The chosen candidate, or null only if no rollouts survived. */
  readonly winner: ScoredRollout | null;
  /** All scored rollouts (includes winner). */
  readonly rollouts: readonly ScoredRollout[];
  /** All generator + critic failures, indexed by original rollout index. */
  readonly errors: readonly RerankError[];
  /** Human-readable rationale for the pick. */
  readonly rationale: string;
}

// ── Error types ────────────────────────────────────────

export class AllRolloutsFailed extends Error {
  readonly reasons: readonly string[];
  constructor(reasons: readonly string[]) {
    super(
      `all rollouts failed (N=${reasons.length}): ${reasons.slice(0, 3).join("; ")}${reasons.length > 3 ? "…" : ""}`,
    );
    this.name = "AllRolloutsFailed";
    this.reasons = reasons;
  }
}

// ── Core class ─────────────────────────────────────────

export class CriticRerank {
  private readonly generator: RollouGenerator;
  private readonly critic: CriticJudge;
  private readonly N: number;
  private readonly perRolloutTimeoutMs: number;
  private readonly onEvent: (event: RerankEvent) => void;

  constructor(config: RerankConfig) {
    const N = config.N ?? 5;
    if (!Number.isInteger(N) || N < 1) {
      throw new Error(`N must be a positive integer, got ${N}`);
    }
    this.generator = config.generator;
    this.critic = config.critic;
    this.N = N;
    this.perRolloutTimeoutMs = config.perRolloutTimeoutMs ?? 120_000;
    this.onEvent = config.onEvent ?? (() => {});
  }

  /**
   * Run N parallel rollouts, score each, pick the winner.
   * Throws `AllRolloutsFailed` if every generator fails.
   */
  async rerank(task: CriticTask): Promise<RerankResult> {
    // Per-invocation local state — no cross-contamination between
    // concurrent rerank() calls on the same instance. (QB #7)
    const errors: RerankError[] = [];
    const generated: (Rollout & { readonly index: number })[] = [];
    const generatorErrorReasons: (string | null)[] = new Array(this.N).fill(null);

    // 1. Dispatch N generators in parallel.
    const genPromises = Array.from({ length: this.N }, (_, idx) => this.runGenerator(task, idx));
    const genResults = await Promise.all(genPromises);
    for (let i = 0; i < genResults.length; i++) {
      const r = genResults[i];
      if (!r) continue;
      if (r.ok) {
        generated.push({ index: i, ...r.rollout });
      } else {
        generatorErrorReasons[i] = r.reason;
        errors.push({ index: i, stage: "generator", reason: r.reason });
      }
    }

    // If every single generator failed, surface the union of reasons.
    if (generated.length === 0) {
      const reasons: string[] = [];
      for (let i = 0; i < this.N; i++) {
        reasons.push(generatorErrorReasons[i] ?? "unknown generator failure");
      }
      throw new AllRolloutsFailed(reasons);
    }

    // 2. Score each surviving candidate via the critic.
    const scored: ScoredRollout[] = [];
    for (const g of generated) {
      const candidate: CriticCandidate = {
        output: g.output,
        metadata: g.metadata,
      };
      const scoreResult = await this.runCritic(task, candidate, g.index);
      if (scoreResult.ok) {
        scored.push({
          index: g.index,
          output: g.output,
          metadata: g.metadata,
          score: scoreResult.score.score,
          reasoning: scoreResult.score.reasoning,
        });
      } else {
        errors.push({
          index: g.index,
          stage: "critic",
          reason: scoreResult.reason,
        });
      }
    }

    // 3. Pick the winner.
    if (scored.length === 0) {
      return {
        winner: null,
        rollouts: [],
        errors,
        rationale: "no rollout received a critic score",
      };
    }

    const winner = pickWinner(scored);
    this.onEvent({
      kind: "rerank.picked",
      winnerIndex: winner.index,
      score: winner.score,
    });

    return {
      winner,
      rollouts: scored,
      errors,
      rationale: buildRationale(winner, scored, errors),
    };
  }

  // ── Internals ────────────────────────────────────────

  private async runGenerator(
    task: CriticTask,
    index: number,
  ): Promise<
    | { readonly ok: true; readonly rollout: Rollout }
    | { readonly ok: false; readonly reason: string }
  > {
    this.onEvent({ kind: "rollout.started", index });
    try {
      const rollout = await withTimeout(
        this.generator(task, index),
        this.perRolloutTimeoutMs,
        `rollout ${index} timeout after ${this.perRolloutTimeoutMs}ms`,
      );
      this.onEvent({
        kind: "rollout.finished",
        index,
        output: rollout.output,
      });
      return { ok: true, rollout };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.onEvent({ kind: "rollout.failed", index, reason });
      return { ok: false, reason };
    }
  }

  private async runCritic(
    task: CriticTask,
    candidate: CriticCandidate,
    index: number,
  ): Promise<
    | { readonly ok: true; readonly score: CriticScore }
    | { readonly ok: false; readonly reason: string }
  > {
    try {
      const score = await this.critic(task, candidate);
      this.onEvent({ kind: "critic.scored", index, score: score.score });
      return { ok: true, score };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.onEvent({ kind: "critic.failed", index, reason });
      return { ok: false, reason };
    }
  }
}

// ── Helpers ────────────────────────────────────────────

/**
 * Pick by highest score; tie-break by shortest output; final tie-break
 * by lowest original index (stable, reproducible).
 */
export function pickWinner(scored: readonly ScoredRollout[]): ScoredRollout {
  const sorted = [...scored].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.output.length !== b.output.length) return a.output.length - b.output.length;
    return a.index - b.index;
  });
  const first = sorted[0];
  if (!first) {
    // Unreachable given caller checks length > 0 — defensive only.
    throw new Error("pickWinner called with empty input");
  }
  return first;
}

function buildRationale(
  winner: ScoredRollout,
  scored: readonly ScoredRollout[],
  errors: readonly RerankError[],
): string {
  const scoreList = scored
    .map((s) => `#${s.index}=${s.score}`)
    .sort()
    .join(", ");
  const tail =
    errors.length > 0 ? `; errors: ${errors.map((e) => `#${e.index}/${e.stage}`).join(", ")}` : "";
  return `winner=#${winner.index} score=${winner.score} (scored: ${scoreList})${tail}`;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// ── Re-exports for ergonomic consumer imports ──────────

export type {
  CriticCandidate,
  CriticJudge,
  CriticScore,
  CriticTask,
} from "../intelligence/critic-model.js";
export { llmQueryCritic } from "../intelligence/critic-model.js";
