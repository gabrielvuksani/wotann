import { describe, it, expect } from "vitest";
import { runCouncil, CouncilLeaderboard, type CouncilQueryExecutor } from "../../src/orchestration/council.js";
import type { ProviderName } from "../../src/core/types.js";

describe("Council Mode", () => {
  const mockExecutor: CouncilQueryExecutor = async (provider, model, prompt, _systemPrompt) => {
    const responses: Record<string, string> = {
      anthropic: "Claude's answer: The earth revolves around the sun in 365.25 days.",
      openai: "GPT's answer: Earth's orbital period is approximately 365.256 days.",
      gemini: "Gemini's answer: It takes about 365 days for Earth to orbit the Sun.",
    };
    return {
      response: responses[provider] ?? `${provider}/${model}: ${prompt.slice(0, 50)}`,
      tokensUsed: 100,
      durationMs: 500,
    };
  };

  const providers: readonly { provider: ProviderName; model: string }[] = [
    { provider: "anthropic", model: "claude-opus-4-7" },
    { provider: "openai", model: "gpt-5.4" },
    { provider: "gemini", model: "gemini-3.1-pro-preview" },
  ];

  describe("runCouncil", () => {
    it("collects individual responses from all members", async () => {
      const result = await runCouncil(mockExecutor, "How long does Earth orbit the Sun?", providers, {
        enablePeerReview: false,
      });

      expect(result.members).toHaveLength(3);
      expect(result.members[0]!.label).toBe("Response A");
      expect(result.members[1]!.label).toBe("Response B");
      expect(result.members[2]!.label).toBe("Response C");
      expect(result.members[0]!.response).toContain("Claude");
      expect(result.members[1]!.response).toContain("GPT");
    });

    it("produces a synthesis from the chairman", async () => {
      const result = await runCouncil(mockExecutor, "How long does Earth orbit?", providers, {
        enablePeerReview: false,
      });

      expect(result.synthesis).toBeTruthy();
      expect(result.synthesis.length).toBeGreaterThan(0);
    });

    it("records total tokens across all stages", async () => {
      const result = await runCouncil(mockExecutor, "Test query", providers, {
        enablePeerReview: false,
      });

      // 3 members × 100 tokens + synthesis
      expect(result.totalTokens).toBeGreaterThanOrEqual(300);
    });

    it("handles member failures gracefully", async () => {
      const failingExecutor: CouncilQueryExecutor = async (provider, _model, _prompt) => {
        if (provider === "openai") throw new Error("Rate limited");
        return { response: `${provider} response`, tokensUsed: 50, durationMs: 200 };
      };

      const result = await runCouncil(failingExecutor, "Test", providers, {
        enablePeerReview: false,
      });

      expect(result.members).toHaveLength(3);
      const failedMember = result.members.find((m) => m.provider === "openai");
      expect(failedMember!.response).toContain("failed");
    });

    it("respects maxMembers config", async () => {
      const result = await runCouncil(mockExecutor, "Test", providers, {
        maxMembers: 2,
        enablePeerReview: false,
      });

      expect(result.members).toHaveLength(2);
    });

    it("includes timestamp", async () => {
      const result = await runCouncil(mockExecutor, "Test", providers, {
        enablePeerReview: false,
      });

      expect(result.timestamp).toBeTruthy();
      expect(new Date(result.timestamp).getTime()).toBeGreaterThan(0);
    });
  });

  describe("CouncilLeaderboard", () => {
    it("records council results", async () => {
      const leaderboard = new CouncilLeaderboard();
      const result = await runCouncil(mockExecutor, "Test", providers, {
        enablePeerReview: false,
      });

      leaderboard.recordResult(result);
      const entries = leaderboard.getLeaderboard();
      expect(entries).toHaveLength(3);
    });

    it("tracks wins and participations", async () => {
      const leaderboard = new CouncilLeaderboard();

      for (let i = 0; i < 3; i++) {
        const result = await runCouncil(mockExecutor, `Query ${i}`, providers, {
          enablePeerReview: false,
        });
        leaderboard.recordResult(result);
      }

      const entries = leaderboard.getLeaderboard();
      for (const entry of entries) {
        expect(entry.councilParticipations).toBe(3);
      }
    });

    it("returns entry by provider and model", async () => {
      const leaderboard = new CouncilLeaderboard();
      const result = await runCouncil(mockExecutor, "Test", providers, {
        enablePeerReview: false,
      });
      leaderboard.recordResult(result);

      const entry = leaderboard.getEntry("anthropic", "claude-opus-4-7");
      expect(entry).toBeDefined();
      expect(entry!.provider).toBe("anthropic");
    });
  });
});
