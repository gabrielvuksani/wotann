import { describe, it, expect, beforeEach } from "vitest";
import { SmartRetryEngine } from "../../src/intelligence/smart-retry.js";
import type { Attempt } from "../../src/intelligence/smart-retry.js";

describe("SmartRetryEngine", () => {
  let engine: SmartRetryEngine;

  beforeEach(() => {
    engine = new SmartRetryEngine();
  });

  describe("analyzeFailure", () => {
    it("suggests switch-model for rate limit errors", () => {
      const strategy = engine.analyzeFailure("429 Too Many Requests", "", []);
      expect(strategy.type).toBe("switch-model");
      expect(strategy.reason).toContain("rate-limit");
      expect(strategy.confidence).toBeGreaterThan(0);
    });

    it("suggests decompose-task for timeout errors", () => {
      const strategy = engine.analyzeFailure("Request timed out after 30s", "", []);
      expect(strategy.type).toBe("decompose-task");
    });

    it("suggests decompose-task for context overflow", () => {
      const strategy = engine.analyzeFailure("Context length exceeded maximum tokens", "", []);
      expect(strategy.type).toBe("decompose-task");
    });

    it("suggests modify-prompt for invalid response", () => {
      const strategy = engine.analyzeFailure("Invalid JSON response format", "", []);
      expect(strategy.type).toBe("modify-prompt");
    });

    it("suggests modify-prompt for model refusal", () => {
      const strategy = engine.analyzeFailure("I cannot help with that request due to policy", "", []);
      expect(strategy.type).toBe("modify-prompt");
    });

    it("avoids repeating previously used strategies", () => {
      const previous: Attempt[] = [
        { strategy: "modify-prompt", error: "err", context: "", attemptNumber: 1, timestamp: Date.now() },
      ];

      const strategy = engine.analyzeFailure("I cannot assist with this", "", previous);
      expect(strategy.type).not.toBe("modify-prompt");
    });

    it("falls back through all strategies when main ones exhausted", () => {
      const previous: Attempt[] = [
        { strategy: "modify-prompt", error: "e1", context: "", attemptNumber: 1, timestamp: Date.now() },
        { strategy: "change-approach", error: "e2", context: "", attemptNumber: 2, timestamp: Date.now() },
      ];

      const strategy = engine.analyzeFailure("Cannot help", "", previous);
      // Should pick something not yet tried
      expect(["switch-model", "decompose-task", "add-context"]).toContain(strategy.type);
    });

    it("decreases confidence with more attempts", () => {
      const s1 = engine.analyzeFailure("error", "", []);
      const s2 = engine.analyzeFailure("error", "", [
        { strategy: "modify-prompt", error: "e", context: "", attemptNumber: 1, timestamp: Date.now() },
        { strategy: "switch-model", error: "e", context: "", attemptNumber: 2, timestamp: Date.now() },
      ]);

      expect(s2.confidence).toBeLessThan(s1.confidence);
    });

    it("handles unknown error types gracefully", () => {
      const strategy = engine.analyzeFailure("Something completely unexpected happened", "", []);
      expect(strategy.type).toBeDefined();
      expect(strategy.reason).toContain("unknown");
    });
  });

  describe("classifyError", () => {
    it("classifies rate limit errors", () => {
      const result = engine.classifyError("429 rate limit exceeded");
      expect(result.category).toBe("rate-limit");
      expect(result.shouldRetry).toBe(true);
    });

    it("classifies auth errors as non-retriable", () => {
      const result = engine.classifyError("401 Unauthorized");
      expect(result.category).toBe("auth-error");
      expect(result.shouldRetry).toBe(false);
    });

    it("classifies timeout errors", () => {
      const result = engine.classifyError("ETIMEDOUT connecting to api");
      expect(result.category).toBe("timeout");
    });

    it("classifies context overflow", () => {
      const result = engine.classifyError("token limit exceeded, context too long");
      expect(result.category).toBe("context-overflow");
    });

    it("returns unknown for unrecognized errors", () => {
      const result = engine.classifyError("XYZZY happened");
      expect(result.category).toBe("unknown");
      expect(result.shouldRetry).toBe(true);
    });
  });

  describe("executeWithRetry", () => {
    it("succeeds on first attempt when function works", async () => {
      const result = await engine.executeWithRetry(async () => 42, 3);
      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
      expect(result.totalAttempts).toBe(1);
      expect(result.attempts).toHaveLength(0);
    });

    it("retries and succeeds on later attempt", async () => {
      let callCount = 0;
      const result = await engine.executeWithRetry(async () => {
        callCount++;
        if (callCount < 3) throw new Error("timeout: try again");
        return "success";
      }, 5);

      expect(result.success).toBe(true);
      expect(result.value).toBe("success");
      expect(result.totalAttempts).toBe(3);
      expect(result.attempts).toHaveLength(2);
    });

    it("fails after exhausting max attempts", async () => {
      const result = await engine.executeWithRetry(async () => {
        throw new Error("always fails with timeout");
      }, 3);

      expect(result.success).toBe(false);
      expect(result.value).toBeNull();
      expect(result.totalAttempts).toBe(3);
      expect(result.attempts).toHaveLength(3);
    });

    it("stops early for non-retriable errors (auth)", async () => {
      const result = await engine.executeWithRetry(async () => {
        throw new Error("401 Unauthorized");
      }, 5);

      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(1); // Stopped after first attempt
    });

    it("records attempt details", async () => {
      const result = await engine.executeWithRetry(async () => {
        throw new Error("rate limit hit 429");
      }, 2);

      expect(result.attempts).toHaveLength(2);
      expect(result.attempts[0]?.error).toContain("429");
      expect(result.attempts[0]?.strategy).toBeDefined();
      expect(result.attempts[0]?.timestamp).toBeGreaterThan(0);
    });

    it("tracks total duration", async () => {
      const result = await engine.executeWithRetry(async () => 1, 1);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("getAvailableStrategies", () => {
    it("returns all strategy types", () => {
      const strategies = engine.getAvailableStrategies();
      expect(strategies).toContain("modify-prompt");
      expect(strategies).toContain("switch-model");
      expect(strategies).toContain("decompose-task");
      expect(strategies).toContain("add-context");
      expect(strategies).toContain("change-approach");
      expect(strategies).toHaveLength(5);
    });
  });
});
