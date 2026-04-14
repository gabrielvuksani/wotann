import { describe, it, expect, beforeEach } from "vitest";
import { SessionAnalytics } from "../../src/telemetry/session-analytics.js";

describe("Session Analytics", () => {
  let analytics: SessionAnalytics;

  beforeEach(() => {
    analytics = new SessionAnalytics("test-session-123");
  });

  describe("request tracking", () => {
    it("records requests", () => {
      analytics.recordRequest({
        provider: "anthropic",
        model: "claude-opus-4-6",
        tokensIn: 1000,
        tokensOut: 500,
        tokensCached: 200,
        costUsd: 0.015,
        latencyMs: 2000,
        timeToFirstTokenMs: 500,
        success: true,
      });
      expect(analytics.getRequestCount()).toBe(1);
    });

    it("aggregates provider metrics", () => {
      analytics.recordRequest({
        provider: "anthropic",
        model: "opus",
        tokensIn: 1000,
        tokensOut: 500,
        tokensCached: 200,
        costUsd: 0.01,
        latencyMs: 2000,
        timeToFirstTokenMs: 500,
        success: true,
      });
      analytics.recordRequest({
        provider: "anthropic",
        model: "opus",
        tokensIn: 2000,
        tokensOut: 800,
        tokensCached: 300,
        costUsd: 0.02,
        latencyMs: 3000,
        timeToFirstTokenMs: 600,
        success: true,
      });

      const metrics = analytics.getMetrics();
      const anthropic = metrics.providerBreakdown.get("anthropic");
      expect(anthropic).toBeDefined();
      expect(anthropic!.requests).toBe(2);
      expect(anthropic!.tokensIn).toBe(3000);
      expect(anthropic!.costUsd).toBeCloseTo(0.03);
    });

    it("tracks multiple providers", () => {
      analytics.recordRequest({
        provider: "anthropic", model: "opus",
        tokensIn: 1000, tokensOut: 500, tokensCached: 0,
        costUsd: 0.01, latencyMs: 2000, timeToFirstTokenMs: 500, success: true,
      });
      analytics.recordRequest({
        provider: "openai", model: "gpt-5",
        tokensIn: 800, tokensOut: 400, tokensCached: 0,
        costUsd: 0.008, latencyMs: 1500, timeToFirstTokenMs: 300, success: true,
      });

      const metrics = analytics.getMetrics();
      expect(metrics.providerBreakdown.size).toBe(2);
      expect(metrics.totalRequests).toBe(2);
    });
  });

  describe("tool call tracking", () => {
    it("records tool calls", () => {
      analytics.recordToolCall("Read", 50, true, 100);
      analytics.recordToolCall("Write", 30, true, 50);
      analytics.recordToolCall("Read", 40, false, 0);
      expect(analytics.getToolCallCount()).toBe(3);
    });

    it("aggregates tool metrics", () => {
      analytics.recordToolCall("Read", 50, true, 100);
      analytics.recordToolCall("Read", 60, true, 120);
      analytics.recordToolCall("Read", 70, false, 0);

      const metrics = analytics.getMetrics();
      const readMetrics = metrics.toolBreakdown.get("Read");
      expect(readMetrics).toBeDefined();
      expect(readMetrics!.calls).toBe(3);
      expect(readMetrics!.successes).toBe(2);
      expect(readMetrics!.failures).toBe(1);
      expect(readMetrics!.totalTokensConsumed).toBe(220);
    });
  });

  describe("compaction tracking", () => {
    it("records compaction events", () => {
      analytics.recordCompaction();
      analytics.recordCompaction();
      const metrics = analytics.getMetrics();
      expect(metrics.compactionCount).toBe(2);
    });
  });

  describe("context usage tracking", () => {
    it("tracks peak context usage", () => {
      analytics.updateContextUsage(0.3);
      analytics.updateContextUsage(0.7);
      analytics.updateContextUsage(0.5);
      const metrics = analytics.getMetrics();
      expect(metrics.peakContextUsage).toBe(0.7);
    });
  });

  describe("metrics computation", () => {
    it("computes total tokens", () => {
      analytics.recordRequest({
        provider: "anthropic", model: "opus",
        tokensIn: 1000, tokensOut: 500, tokensCached: 200,
        costUsd: 0.01, latencyMs: 2000, timeToFirstTokenMs: 500, success: true,
      });
      const metrics = analytics.getMetrics();
      expect(metrics.totalTokensIn).toBe(1000);
      expect(metrics.totalTokensOut).toBe(500);
      expect(metrics.totalTokensCached).toBe(200);
    });

    it("computes average latency", () => {
      analytics.recordRequest({
        provider: "anthropic", model: "opus",
        tokensIn: 1000, tokensOut: 500, tokensCached: 0,
        costUsd: 0.01, latencyMs: 2000, timeToFirstTokenMs: 500, success: true,
      });
      analytics.recordRequest({
        provider: "anthropic", model: "opus",
        tokensIn: 1000, tokensOut: 500, tokensCached: 0,
        costUsd: 0.01, latencyMs: 4000, timeToFirstTokenMs: 1000, success: true,
      });
      const metrics = analytics.getMetrics();
      expect(metrics.averageLatencyMs).toBe(3000);
      expect(metrics.averageTimeToFirstTokenMs).toBe(750);
    });

    it("handles empty metrics", () => {
      const metrics = analytics.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.averageLatencyMs).toBe(0);
      expect(metrics.totalCostUsd).toBe(0);
    });
  });

  describe("summary", () => {
    it("generates human-readable summary", () => {
      analytics.recordRequest({
        provider: "anthropic", model: "opus",
        tokensIn: 1000, tokensOut: 500, tokensCached: 200,
        costUsd: 0.015, latencyMs: 2000, timeToFirstTokenMs: 500, success: true,
      });
      analytics.recordToolCall("Read", 50, true);
      analytics.recordCompaction();

      const summary = analytics.getSummary();
      expect(summary).toContain("test-ses");
      expect(summary).toContain("Requests: 1");
      expect(summary).toContain("$0.0150");
      expect(summary).toContain("Compactions: 1");
    });
  });
});
