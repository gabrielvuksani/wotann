/**
 * Council Mode — multi-LLM deliberation for high-stakes decisions.
 *
 * From karpathy/llm-council: 3-stage pipeline where multiple models
 * answer independently, anonymously peer-review each other, and a
 * chairman synthesizes the final answer.
 *
 * Better than arena (blind competition) because it includes structured
 * peer feedback and synthesis, not just vote counting.
 *
 * USAGE: /council <question>
 *
 * Stages:
 * 1. Individual: Send query to N models in parallel, collect responses
 * 2. Peer Review: Each model ranks others' responses (anonymized as A, B, C)
 * 3. Synthesis: Chairman model compiles best answer from all inputs + rankings
 */

import { randomUUID } from "node:crypto";
import type { ProviderName } from "../core/types.js";

// ── Types ──────────────────────────────────────────────

export interface CouncilMember {
  readonly id: string;
  readonly label: string; // "Response A", "Response B", etc.
  readonly provider: ProviderName;
  readonly model: string;
  readonly response: string;
  readonly tokensUsed: number;
  readonly durationMs: number;
}

export interface PeerRanking {
  readonly reviewerId: string;
  readonly rankings: readonly { memberId: string; rank: number; reasoning: string }[];
}

export interface CouncilResult {
  readonly query: string;
  readonly members: readonly CouncilMember[];
  readonly rankings: readonly PeerRanking[];
  readonly aggregateRanking: readonly {
    memberId: string;
    label: string;
    averageRank: number;
    voteCount: number;
  }[];
  readonly synthesis: string;
  readonly chairmanModel: string;
  readonly totalTokens: number;
  readonly totalDurationMs: number;
  readonly timestamp: string;
}

export interface CouncilConfig {
  readonly maxMembers: number;
  readonly enablePeerReview: boolean;
  readonly chairmanProvider?: ProviderName;
  readonly chairmanModel?: string;
  readonly timeoutMs: number;
}

const DEFAULT_CONFIG: CouncilConfig = {
  maxMembers: 3,
  enablePeerReview: true,
  timeoutMs: 120_000,
};

export type CouncilQueryExecutor = (
  provider: ProviderName,
  model: string,
  prompt: string,
  systemPrompt?: string,
) => Promise<{ response: string; tokensUsed: number; durationMs: number }>;

// ── Council Runner ─────────────────────────────────────

/**
 * Run a council deliberation with N providers.
 *
 * Stage 1: Parallel individual responses
 * Stage 2: Anonymized peer ranking
 * Stage 3: Chairman synthesis
 */
export async function runCouncil(
  executor: CouncilQueryExecutor,
  query: string,
  providers: readonly { provider: ProviderName; model: string }[],
  config: Partial<CouncilConfig> = {},
): Promise<CouncilResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const labels = ["Response A", "Response B", "Response C", "Response D", "Response E"];
  const selected = providers.slice(0, cfg.maxMembers);
  const startTime = Date.now();

  // ── Stage 1: Individual Responses (parallel) ──
  const members = await Promise.all(
    selected.map(async ({ provider, model }, index) => {
      try {
        const result = await executor(provider, model, query);
        return {
          id: randomUUID().slice(0, 8),
          label: labels[index] ?? `Response ${index + 1}`,
          provider,
          model,
          response: result.response,
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
        };
      } catch {
        return {
          id: randomUUID().slice(0, 8),
          label: labels[index] ?? `Response ${index + 1}`,
          provider,
          model,
          response: "[Model failed to respond]",
          tokensUsed: 0,
          durationMs: 0,
        };
      }
    }),
  );

  const activeMemberCount = members.filter((m) => !m.response.startsWith("[")).length;

  // ── Stage 2: Peer Review (if enabled and >1 active member) ──
  const rankings: PeerRanking[] = [];

  if (cfg.enablePeerReview && activeMemberCount > 1) {
    const anonymizedResponses = members
      .map((m) => `### ${m.label}\n${m.response}`)
      .join("\n\n---\n\n");

    const rankingPrompt = [
      "You are reviewing multiple AI responses to the same question.",
      "Each response is labeled (Response A, B, C, etc.) with hidden identities.",
      "",
      `Original question: ${query}`,
      "",
      "Here are the responses:",
      "",
      anonymizedResponses,
      "",
      "Rank ALL responses from best to worst based on accuracy, completeness, and helpfulness.",
      "For each, provide a brief reasoning.",
      "",
      "Format your response EXACTLY as:",
      "FINAL RANKING:",
      "1. Response X — [brief reasoning]",
      "2. Response Y — [brief reasoning]",
      "...",
    ].join("\n");

    // Each member reviews others
    const reviewPromises = members
      .filter((m) => !m.response.startsWith("["))
      .map(async (reviewer) => {
        try {
          const result = await executor(
            reviewer.provider,
            reviewer.model,
            rankingPrompt,
            "You are a fair and thorough evaluator. Rank responses objectively.",
          );

          const parsed = parseRankings(result.response, members);
          return { reviewerId: reviewer.id, rankings: parsed };
        } catch {
          return { reviewerId: reviewer.id, rankings: [] };
        }
      });

    const reviewResults = await Promise.all(reviewPromises);
    rankings.push(...reviewResults.filter((r) => r.rankings.length > 0));
  }

  // ── Aggregate Rankings ──
  const aggregateRanking = computeAggregateRanking(members, rankings);

  // ── Stage 3: Chairman Synthesis ──
  const chairman = cfg.chairmanProvider
    ? { provider: cfg.chairmanProvider, model: cfg.chairmanModel ?? "auto" }
    : (selected[0] ?? { provider: "ollama" as ProviderName, model: "auto" });

  const rankingSummary = aggregateRanking
    .map(
      (r, i) =>
        `${i + 1}. ${r.label} (avg rank: ${r.averageRank.toFixed(1)}, votes: ${r.voteCount})`,
    )
    .join("\n");

  const synthesisPrompt = [
    "You are the chairman of an AI council. Multiple models answered a question and peer-reviewed each other.",
    "",
    `Original question: ${query}`,
    "",
    "Individual responses:",
    ...members.map((m) => `### ${m.label}\n${m.response}`),
    "",
    rankings.length > 0 ? `Aggregate ranking:\n${rankingSummary}` : "",
    "",
    "Synthesize the BEST possible answer by combining the strongest elements from all responses.",
    "Correct any errors found during review. Your synthesis should be better than any individual response.",
  ]
    .filter(Boolean)
    .join("\n");

  let synthesis: string;
  let synthesisTokens = 0;
  try {
    const result = await executor(
      chairman.provider,
      chairman.model,
      synthesisPrompt,
      "You are an expert synthesizer. Combine the best insights from multiple sources into one authoritative answer.",
    );
    synthesis = result.response;
    synthesisTokens = result.tokensUsed;
  } catch {
    // Fallback: use the top-ranked response
    const topMember = aggregateRanking[0];
    const best = members.find((m) => m.id === topMember?.memberId);
    synthesis = best?.response ?? members[0]?.response ?? "[Synthesis failed]";
  }

  const totalTokens = members.reduce((sum, m) => sum + m.tokensUsed, synthesisTokens);

  return {
    query,
    members,
    rankings,
    aggregateRanking,
    synthesis,
    chairmanModel: `${chairman.provider}/${chairman.model}`,
    totalTokens,
    totalDurationMs: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  };
}

// ── Ranking Parser ─────────────────────────────────────

function parseRankings(
  text: string,
  members: readonly CouncilMember[],
): { memberId: string; rank: number; reasoning: string }[] {
  const results: { memberId: string; rank: number; reasoning: string }[] = [];

  // Find the FINAL RANKING section
  const rankingSection = text.split(/FINAL RANKING[:\s]*/i)[1] ?? text;
  const lines = rankingSection.split("\n").filter((l) => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Match "1. Response A — reasoning" or "1. Response A: reasoning"
    const match = line.match(/\d+\.\s*Response\s+([A-E])\s*[—:-]\s*(.*)/i);
    if (match) {
      const label = `Response ${match[1]!.toUpperCase()}`;
      const member = members.find((m) => m.label === label);
      if (member) {
        results.push({
          memberId: member.id,
          rank: i + 1,
          reasoning: match[2]?.trim() ?? "",
        });
      }
    }
  }

  // Fallback: try regex for any "Response X" mentions in order
  if (results.length === 0) {
    const matches = [...text.matchAll(/Response\s+([A-E])/gi)];
    const seen = new Set<string>();
    let rank = 1;
    for (const m of matches) {
      const label = `Response ${m[1]!.toUpperCase()}`;
      if (!seen.has(label)) {
        seen.add(label);
        const member = members.find((mem) => mem.label === label);
        if (member) {
          results.push({ memberId: member.id, rank: rank++, reasoning: "" });
        }
      }
    }
  }

  return results;
}

// ── Aggregate Ranking ──────────────────────────────────

function computeAggregateRanking(
  members: readonly CouncilMember[],
  rankings: readonly PeerRanking[],
): readonly { memberId: string; label: string; averageRank: number; voteCount: number }[] {
  if (rankings.length === 0) {
    // No peer review — rank by response length as a rough proxy
    return members
      .map((m) => ({
        memberId: m.id,
        label: m.label,
        averageRank: 1,
        voteCount: 0,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  const rankSums = new Map<string, { total: number; count: number }>();

  for (const review of rankings) {
    for (const r of review.rankings) {
      const existing = rankSums.get(r.memberId) ?? { total: 0, count: 0 };
      existing.total += r.rank;
      existing.count += 1;
      rankSums.set(r.memberId, existing);
    }
  }

  return members
    .map((m) => {
      const stats = rankSums.get(m.id) ?? { total: members.length, count: 1 };
      return {
        memberId: m.id,
        label: m.label,
        averageRank: stats.total / stats.count,
        voteCount: stats.count,
      };
    })
    .sort((a, b) => a.averageRank - b.averageRank);
}

// ── Council Leaderboard ────────────────────────────────

export interface LeaderboardEntry {
  readonly provider: ProviderName;
  readonly model: string;
  readonly councilWins: number;
  readonly councilParticipations: number;
  readonly averageRank: number;
  readonly totalTokens: number;
}

export class CouncilLeaderboard {
  private entries: Map<string, LeaderboardEntry> = new Map();

  recordResult(result: CouncilResult): void {
    for (const member of result.members) {
      const key = `${member.provider}:${member.model}`;
      const existing = this.entries.get(key) ?? {
        provider: member.provider,
        model: member.model,
        councilWins: 0,
        councilParticipations: 0,
        averageRank: 0,
        totalTokens: 0,
      };

      const ranking = result.aggregateRanking.find((r) => r.memberId === member.id);
      const isWinner = ranking === result.aggregateRanking[0];

      const newParticipations = existing.councilParticipations + 1;
      const newAvgRank = ranking
        ? (existing.averageRank * existing.councilParticipations + ranking.averageRank) /
          newParticipations
        : existing.averageRank;

      this.entries.set(key, {
        ...existing,
        councilWins: existing.councilWins + (isWinner ? 1 : 0),
        councilParticipations: newParticipations,
        averageRank: newAvgRank,
        totalTokens: existing.totalTokens + member.tokensUsed,
      });
    }
  }

  getLeaderboard(): readonly LeaderboardEntry[] {
    return [...this.entries.values()].sort((a, b) => {
      const winRateA = a.councilWins / Math.max(1, a.councilParticipations);
      const winRateB = b.councilWins / Math.max(1, b.councilParticipations);
      return winRateB - winRateA;
    });
  }

  getEntry(provider: ProviderName, model: string): LeaderboardEntry | undefined {
    return this.entries.get(`${provider}:${model}`);
  }
}
