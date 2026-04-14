import { describe, it, expect } from "vitest";
import { ArenaLeaderboard } from "../../src/orchestration/arena.js";
import { selectModelPair } from "../../src/orchestration/architect-editor.js";

describe("Arena Mode", () => {
  describe("ArenaLeaderboard", () => {
    it("starts with zero contests", () => {
      const board = new ArenaLeaderboard();
      expect(board.getTotalContests()).toBe(0);
      expect(board.getLeaderboard()).toHaveLength(0);
    });

    it("records and tracks wins/losses", () => {
      const board = new ArenaLeaderboard();

      board.recordResult({
        prompt: "test",
        timestamp: new Date().toISOString(),
        contestants: [
          { id: "a", label: "A", provider: "anthropic", model: "claude", response: "hi", tokensUsed: 100, durationMs: 500 },
          { id: "b", label: "B", provider: "openai", model: "gpt", response: "hello", tokensUsed: 80, durationMs: 300 },
        ],
        winner: "a",
      });

      const leaderboard = board.getLeaderboard();
      expect(leaderboard).toHaveLength(2);

      const anthropicEntry = leaderboard.find((e) => e.provider === "anthropic");
      expect(anthropicEntry?.wins).toBe(1);
      expect(anthropicEntry?.winRate).toBe(1);

      const openaiEntry = leaderboard.find((e) => e.provider === "openai");
      expect(openaiEntry?.losses).toBe(1);
      expect(openaiEntry?.winRate).toBe(0);
    });

    it("tracks draws when no winner", () => {
      const board = new ArenaLeaderboard();

      board.recordResult({
        prompt: "test",
        timestamp: new Date().toISOString(),
        contestants: [
          { id: "a", label: "A", provider: "anthropic", model: "claude", response: "", tokensUsed: 0, durationMs: 0 },
          { id: "b", label: "B", provider: "ollama", model: "qwen", response: "", tokensUsed: 0, durationMs: 0 },
        ],
        // No winner — it's a draw
      });

      const leaderboard = board.getLeaderboard();
      expect(leaderboard.every((e) => e.draws === 1)).toBe(true);
    });

    it("sorts by win rate", () => {
      const board = new ArenaLeaderboard();

      // Provider A wins 2/2
      board.recordResult({
        prompt: "t1", timestamp: "", winner: "a1",
        contestants: [
          { id: "a1", label: "A", provider: "anthropic", model: "m", response: "", tokensUsed: 0, durationMs: 0 },
          { id: "b1", label: "B", provider: "openai", model: "m", response: "", tokensUsed: 0, durationMs: 0 },
        ],
      });
      board.recordResult({
        prompt: "t2", timestamp: "", winner: "a2",
        contestants: [
          { id: "a2", label: "A", provider: "anthropic", model: "m", response: "", tokensUsed: 0, durationMs: 0 },
          { id: "b2", label: "B", provider: "openai", model: "m", response: "", tokensUsed: 0, durationMs: 0 },
        ],
      });

      const leaderboard = board.getLeaderboard();
      expect(leaderboard[0]?.provider).toBe("anthropic");
      expect(leaderboard[0]?.winRate).toBe(1);
    });
  });
});

describe("Architect/Editor Pipeline", () => {
  describe("selectModelPair", () => {
    it("selects Claude pair when anthropic available", () => {
      const pair = selectModelPair(new Set(["anthropic", "openai"]) as ReadonlySet<any>);
      expect(pair).not.toBeNull();
      expect(pair?.architect.provider).toBe("anthropic");
    });

    it("falls back to alternative pairs", () => {
      const pair = selectModelPair(new Set(["openai"]) as ReadonlySet<any>);
      expect(pair).not.toBeNull();
      expect(pair?.architect.provider).toBe("openai");
    });

    it("returns null when no compatible pair found", () => {
      const pair = selectModelPair(new Set(["free"]) as ReadonlySet<any>);
      expect(pair).toBeNull();
    });

    it("selects hybrid pair when copilot and ollama available", () => {
      const pair = selectModelPair(new Set(["copilot", "ollama"]) as ReadonlySet<any>);
      expect(pair).not.toBeNull();
      expect(pair?.architect.provider).toBe("copilot");
      expect(pair?.editor.provider).toBe("ollama");
    });
  });
});
