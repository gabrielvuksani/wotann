import { describe, it, expect, beforeEach } from "vitest";
import { ConsensusRouter } from "../../src/orchestration/consensus-router.js";
import type { CouncilResult } from "../../src/orchestration/council.js";
import type { ProviderName } from "../../src/core/types.js";

// ── Test Helpers ──────────────────────────────────────

function makeCouncilResult(
  overrides: Partial<CouncilResult> & {
    members?: readonly { id: string; provider: ProviderName; model: string }[];
    winnerId?: string;
  } = {},
): CouncilResult {
  const defaultMembers = [
    { id: "m1", provider: "anthropic" as ProviderName, model: "claude-opus-4-6" },
    { id: "m2", provider: "openai" as ProviderName, model: "gpt-5.4" },
    { id: "m3", provider: "gemini" as ProviderName, model: "gemini-2.5-pro" },
  ];

  const members = (overrides.members ?? defaultMembers).map((m) => ({
    id: m.id,
    label: `Response ${m.id}`,
    provider: m.provider,
    model: m.model,
    response: "test response",
    tokensUsed: 100,
    durationMs: 500,
  }));

  const winnerId = overrides.winnerId ?? members[0]?.id ?? "m1";

  const aggregateRanking = members.map((m, i) => ({
    memberId: m.id,
    label: m.label,
    averageRank: m.id === winnerId ? 1 : i + 1.5,
    voteCount: members.length - 1,
  }));

  // Sort so winner is first
  aggregateRanking.sort((a, b) => a.averageRank - b.averageRank);

  return {
    query: overrides.query ?? "test query",
    members,
    rankings: [],
    aggregateRanking,
    synthesis: "synthesized answer",
    chairmanModel: "anthropic/claude-opus-4-6",
    totalTokens: 300,
    totalDurationMs: 1500,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

// ── Tests ─────────────────────────────────────────────

describe("ConsensusRouter", () => {
  let router: ConsensusRouter;

  beforeEach(() => {
    router = new ConsensusRouter();
  });

  describe("updateFromCouncil", () => {
    it("records council results and tracks participations", () => {
      const result = makeCouncilResult();
      router.updateFromCouncil(result, "code");

      const weights = router.exportWeights();
      expect(weights).toHaveLength(3);
      expect(weights.every((w) => w.totalParticipations === 1)).toBe(true);
    });

    it("accumulates wins for the winner", () => {
      const result = makeCouncilResult({ winnerId: "m1" });
      router.updateFromCouncil(result, "code");

      const weights = router.exportWeights();
      const anthropicWeight = weights.find((w) => w.provider === "anthropic");
      expect(anthropicWeight?.winRate).toBe(1);
    });

    it("tracks losses for non-winners", () => {
      const result = makeCouncilResult({ winnerId: "m1" });
      router.updateFromCouncil(result, "code");

      const weights = router.exportWeights();
      const openaiWeight = weights.find((w) => w.provider === "openai");
      expect(openaiWeight?.winRate).toBe(0);
    });

    it("accumulates across multiple council runs", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m2" }), "code");

      const weights = router.exportWeights();
      const anthropicWeight = weights.find((w) => w.provider === "anthropic");
      expect(anthropicWeight?.totalParticipations).toBe(2);
      expect(anthropicWeight?.winRate).toBe(0.5);
    });
  });

  describe("getRecommendedProvider", () => {
    it("returns null when no data exists", () => {
      expect(router.getRecommendedProvider("code")).toBeNull();
    });

    it("returns null when insufficient participations", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      // Only 1 participation, needs MIN_PARTICIPATIONS_FOR_RECOMMENDATION (2)
      expect(router.getRecommendedProvider("code")).toBeNull();
    });

    it("recommends the provider with the highest win rate", () => {
      // Anthropic wins both
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");

      const recommended = router.getRecommendedProvider("code");
      expect(recommended).not.toBeNull();
      expect(recommended?.provider).toBe("anthropic");
      expect(recommended?.winRate).toBe(1);
    });

    it("separates recommendations by task type", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m2" }), "review");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m2" }), "review");

      const codeRec = router.getRecommendedProvider("code");
      const reviewRec = router.getRecommendedProvider("review");

      expect(codeRec?.provider).toBe("anthropic");
      expect(reviewRec?.provider).toBe("openai");
    });
  });

  describe("exportWeights / importWeights", () => {
    it("exports empty array when no data", () => {
      expect(router.exportWeights()).toEqual([]);
    });

    it("round-trips weights through export/import", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");

      const exported = router.exportWeights();

      const newRouter = new ConsensusRouter();
      newRouter.importWeights(exported, "code");

      const reimported = newRouter.exportWeights();
      expect(reimported).toHaveLength(exported.length);

      for (const original of exported) {
        const restored = reimported.find(
          (r) => r.provider === original.provider && r.model === original.model,
        );
        expect(restored).toBeDefined();
        expect(restored?.totalParticipations).toBe(original.totalParticipations);
      }
    });

    it("merges imported weights with existing data", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");

      const extraWeights = [
        {
          provider: "anthropic",
          model: "claude-opus-4-6",
          winRate: 1,
          totalParticipations: 5,
          avgRank: 1.2,
          lastUpdated: new Date().toISOString(),
        },
      ];

      router.importWeights(extraWeights, "code");

      const weights = router.exportWeights();
      const anthropic = weights.find((w) => w.provider === "anthropic");
      expect(anthropic?.totalParticipations).toBe(6); // 1 + 5
    });
  });

  describe("getRoutingScore", () => {
    it("returns 0 for unknown providers", () => {
      expect(router.getRoutingScore("anthropic", "claude-opus-4-6")).toBe(0);
    });

    it("returns positive score for winning providers", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");

      const score = router.getRoutingScore("anthropic", "claude-opus-4-6", "code");
      expect(score).toBeGreaterThan(0);
    });

    it("gives higher score to providers with better win rates", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m2" }), "code");

      const anthropicScore = router.getRoutingScore("anthropic", "claude-opus-4-6", "code");
      const openaiScore = router.getRoutingScore("openai", "gpt-5.4", "code");

      expect(anthropicScore).toBeGreaterThan(openaiScore);
    });
  });

  describe("getAllRecommendations", () => {
    it("returns recommendations grouped by task type", () => {
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m1" }), "code");
      router.updateFromCouncil(makeCouncilResult({ winnerId: "m2" }), "review");

      const recommendations = router.getAllRecommendations();
      expect(recommendations).toHaveLength(2);

      const taskTypes = recommendations.map((r) => r.taskType);
      expect(taskTypes).toContain("code");
      expect(taskTypes).toContain("review");
    });
  });

  describe("clear", () => {
    it("removes all weights", () => {
      router.updateFromCouncil(makeCouncilResult(), "code");
      expect(router.exportWeights().length).toBeGreaterThan(0);

      router.clear();
      expect(router.exportWeights()).toEqual([]);
    });
  });

  describe("task type inference", () => {
    it("infers plan type from query", () => {
      const result = makeCouncilResult({ query: "plan the architecture for the new system" });
      router.updateFromCouncil(result);
      router.updateFromCouncil(result);

      expect(router.getRecommendedProvider("plan")).not.toBeNull();
    });

    it("infers code type from query", () => {
      const result = makeCouncilResult({ query: "implement the user login function" });
      router.updateFromCouncil(result);
      router.updateFromCouncil(result);

      expect(router.getRecommendedProvider("code")).not.toBeNull();
    });

    it("falls back to general for unrecognized queries", () => {
      const result = makeCouncilResult({ query: "what is the meaning of life" });
      router.updateFromCouncil(result);
      router.updateFromCouncil(result);

      expect(router.getRecommendedProvider("general")).not.toBeNull();
    });
  });
});
