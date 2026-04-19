/**
 * Arena Mode: blind model comparison.
 *
 * Runs the same prompt against 2-3 providers simultaneously with hidden
 * identities. User votes on which is best. Over time, builds a per-project
 * model leaderboard.
 *
 * USAGE: `wotann arena "refactor this auth module"`
 *
 * INSPIRED BY: Windsurf Arena Mode, but multi-provider (not just model switching).
 */

import type { ProviderName } from "../core/types.js";
import { randomBytes } from "node:crypto";
import { speculativeExecute, type SpeculativeResult } from "./speculative-execution.js";

// ── Types ──────────────────────────────────────────────────

export interface ArenaContestant {
  readonly id: string;
  readonly label: string; // Hidden identity: "Model A", "Model B"
  readonly provider: ProviderName;
  readonly model: string;
  readonly response: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
}

export interface ArenaResult {
  readonly prompt: string;
  readonly contestants: readonly ArenaContestant[];
  readonly winner?: string; // contestant ID
  readonly timestamp: string;
}

export interface ArenaLeaderboardEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly wins: number;
  readonly losses: number;
  readonly draws: number;
  readonly winRate: number;
  readonly avgDurationMs: number;
  readonly avgTokensUsed: number;
}

export interface ArenaQueryExecutorResult {
  readonly response: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly model?: string;
}

export type ArenaQueryExecutor = (
  provider: ProviderName,
  prompt: string,
) => Promise<ArenaQueryExecutorResult>;

// ── Arena Runner ───────────────────────────────────────────

/**
 * Run an arena contest with 2-3 providers in parallel.
 * Returns contestant results with hidden identities for blind voting.
 */
export async function runArenaContest(
  executor: ArenaQueryExecutor,
  prompt: string,
  providers: readonly ProviderName[],
): Promise<readonly ArenaContestant[]> {
  const labels = ["Model A", "Model B", "Model C"];

  // Shuffle providers so the order is random
  const shuffled = [...providers].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 3);

  // Run all providers in parallel
  const contestants = await Promise.all(
    selected.map(async (provider, index) => {
      try {
        const result = await executor(provider, prompt);
        return {
          id: randomBytes(4).toString("hex"),
          label: labels[index] ?? `Model ${index + 1}`,
          provider,
          model: result.model ?? "auto",
          response: result.response,
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
        };
      } catch (error) {
        return {
          id: randomBytes(4).toString("hex"),
          label: labels[index] ?? `Model ${index + 1}`,
          provider,
          model: "auto",
          response: `[Error: ${error instanceof Error ? error.message : "unknown"}]`,
          tokensUsed: 0,
          durationMs: 0,
        };
      }
    }),
  );

  return contestants;
}

// ── Speculative contest (SPECULATIVE=1 mode) ──────────────

/**
 * Opt-in speculative variant of the arena. Runs all providers in parallel,
 * scores each response with a caller-supplied `score` function, and returns
 * the best candidate + rankings. Gate behind `process.env.SPECULATIVE === "1"`
 * at the call-site — this function is a thin opt-in shell over
 * `speculativeExecute`.
 */
export async function runSpeculativeContest(
  executor: ArenaQueryExecutor,
  prompt: string,
  providers: readonly ProviderName[],
  score: (response: string) => Promise<number>,
): Promise<SpeculativeResult<ArenaContestant>> {
  const labels = ["Model A", "Model B", "Model C"];
  const selected = [...providers].sort(() => Math.random() - 0.5).slice(0, 3);
  return speculativeExecute<ArenaContestant>({
    n: selected.length,
    generate: async (index): Promise<ArenaContestant> => {
      const provider = selected[index]!;
      const result = await executor(provider, prompt);
      return {
        id: randomBytes(4).toString("hex"),
        label: labels[index] ?? `Model ${index + 1}`,
        provider,
        model: result.model ?? "auto",
        response: result.response,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
      };
    },
    score: async (cand) => score(cand.response),
  });
}

// ── Leaderboard ────────────────────────────────────────────

/**
 * Optional cap on the arena results buffer (S1-14).
 *
 * Default: UNBOUNDED — we keep every contest so the leaderboard has the
 * full historical picture. Each ArenaResult can be tens of KB (full model
 * responses), so power-users on memory-constrained hosts can opt in to a
 * FIFO cap via `WOTANN_ARENA_MAX` env var or the `maxResults` constructor
 * option. Setting null = unbounded (explicit).
 */
function resolveArenaMax(): number | null {
  const raw = process.env["WOTANN_ARENA_MAX"];
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

export class ArenaLeaderboard {
  private readonly results: ArenaResult[] = [];
  private readonly maxResults: number | null;

  constructor(options?: { maxResults?: number | null }) {
    this.maxResults = options?.maxResults !== undefined ? options.maxResults : resolveArenaMax();
  }

  recordResult(result: ArenaResult): void {
    this.results.push(result);
    if (this.maxResults !== null && this.results.length > this.maxResults) {
      this.results.shift();
    }
  }

  getLeaderboard(): readonly ArenaLeaderboardEntry[] {
    const stats = new Map<
      string,
      {
        provider: ProviderName;
        model: string;
        wins: number;
        losses: number;
        draws: number;
        totalDuration: number;
        totalTokens: number;
        count: number;
      }
    >();

    for (const result of this.results) {
      for (const contestant of result.contestants) {
        const key = `${contestant.provider}:${contestant.model}`;
        const existing = stats.get(key) ?? {
          provider: contestant.provider,
          model: contestant.model,
          wins: 0,
          losses: 0,
          draws: 0,
          totalDuration: 0,
          totalTokens: 0,
          count: 0,
        };

        existing.count++;
        existing.totalDuration += contestant.durationMs;
        existing.totalTokens += contestant.tokensUsed;

        if (!result.winner) {
          existing.draws++;
        } else if (result.winner === contestant.id) {
          existing.wins++;
        } else {
          existing.losses++;
        }

        stats.set(key, existing);
      }
    }

    return [...stats.values()]
      .map((s) => ({
        provider: s.provider,
        model: s.model,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        winRate: s.count > 0 ? s.wins / s.count : 0,
        avgDurationMs: s.count > 0 ? s.totalDuration / s.count : 0,
        avgTokensUsed: s.count > 0 ? s.totalTokens / s.count : 0,
      }))
      .sort((a, b) => b.winRate - a.winRate);
  }

  getTotalContests(): number {
    return this.results.length;
  }
}
