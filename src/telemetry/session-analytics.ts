/**
 * Session Analytics — comprehensive tracking of cost, tokens, time, and patterns.
 *
 * Tracks every interaction to provide insights:
 * - Cost per provider/model/session
 * - Token usage efficiency (input vs output vs cached)
 * - Time-to-first-token and response latency
 * - Tool call patterns (most used, most failed)
 * - Compaction events and context pressure history
 * - Autonomous mode cycle analysis
 */

export interface SessionMetrics {
  readonly sessionId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly totalTokensIn: number;
  readonly totalTokensOut: number;
  readonly totalTokensCached: number;
  readonly totalCostUsd: number;
  readonly totalRequests: number;
  readonly averageLatencyMs: number;
  readonly averageTimeToFirstTokenMs: number;
  readonly providerBreakdown: ReadonlyMap<string, ProviderMetrics>;
  readonly toolBreakdown: ReadonlyMap<string, ToolMetrics>;
  readonly compactionCount: number;
  readonly peakContextUsage: number;
}

export interface ProviderMetrics {
  readonly provider: string;
  readonly requests: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly costUsd: number;
  readonly averageLatencyMs: number;
  readonly rateLimitHits: number;
  readonly errors: number;
}

export interface ToolMetrics {
  readonly toolName: string;
  readonly calls: number;
  readonly successes: number;
  readonly failures: number;
  readonly averageDurationMs: number;
  readonly totalTokensConsumed: number;
}

interface RequestRecord {
  readonly timestamp: number;
  readonly provider: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly tokensCached: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly timeToFirstTokenMs: number;
  readonly success: boolean;
}

interface ToolCallRecord {
  readonly timestamp: number;
  readonly toolName: string;
  readonly durationMs: number;
  readonly success: boolean;
  readonly tokensConsumed: number;
}

export class SessionAnalytics {
  private readonly sessionId: string;
  private readonly startedAt: number;
  private requests: RequestRecord[] = [];
  private toolCalls: ToolCallRecord[] = [];
  private compactionEvents: number[] = [];
  private peakContextUsage = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.startedAt = Date.now();
  }

  /**
   * Record a provider request.
   */
  recordRequest(record: Omit<RequestRecord, "timestamp">): void {
    this.requests.push({ ...record, timestamp: Date.now() });
  }

  /**
   * Record a tool call.
   */
  recordToolCall(toolName: string, durationMs: number, success: boolean, tokensConsumed: number = 0): void {
    this.toolCalls.push({ timestamp: Date.now(), toolName, durationMs, success, tokensConsumed });
  }

  /**
   * Record a compaction event.
   */
  recordCompaction(): void {
    this.compactionEvents.push(Date.now());
  }

  /**
   * Update peak context usage.
   */
  updateContextUsage(usage: number): void {
    if (usage > this.peakContextUsage) {
      this.peakContextUsage = usage;
    }
  }

  /**
   * Get comprehensive session metrics.
   */
  getMetrics(): SessionMetrics {
    const providerMap = new Map<string, ProviderMetrics>();
    const toolMap = new Map<string, ToolMetrics>();

    // Aggregate provider metrics
    for (const req of this.requests) {
      const existing = providerMap.get(req.provider);
      if (existing) {
        providerMap.set(req.provider, {
          ...existing,
          requests: existing.requests + 1,
          tokensIn: existing.tokensIn + req.tokensIn,
          tokensOut: existing.tokensOut + req.tokensOut,
          costUsd: existing.costUsd + req.costUsd,
          averageLatencyMs: (existing.averageLatencyMs * existing.requests + req.latencyMs) / (existing.requests + 1),
          rateLimitHits: existing.rateLimitHits + (req.success ? 0 : 1),
          errors: existing.errors + (req.success ? 0 : 1),
        });
      } else {
        providerMap.set(req.provider, {
          provider: req.provider,
          requests: 1,
          tokensIn: req.tokensIn,
          tokensOut: req.tokensOut,
          costUsd: req.costUsd,
          averageLatencyMs: req.latencyMs,
          rateLimitHits: req.success ? 0 : 1,
          errors: req.success ? 0 : 1,
        });
      }
    }

    // Aggregate tool metrics
    for (const tc of this.toolCalls) {
      const existing = toolMap.get(tc.toolName);
      if (existing) {
        toolMap.set(tc.toolName, {
          ...existing,
          calls: existing.calls + 1,
          successes: existing.successes + (tc.success ? 1 : 0),
          failures: existing.failures + (tc.success ? 0 : 1),
          averageDurationMs: (existing.averageDurationMs * existing.calls + tc.durationMs) / (existing.calls + 1),
          totalTokensConsumed: existing.totalTokensConsumed + tc.tokensConsumed,
        });
      } else {
        toolMap.set(tc.toolName, {
          toolName: tc.toolName,
          calls: 1,
          successes: tc.success ? 1 : 0,
          failures: tc.success ? 0 : 1,
          averageDurationMs: tc.durationMs,
          totalTokensConsumed: tc.tokensConsumed,
        });
      }
    }

    const totalTokensIn = this.requests.reduce((sum, r) => sum + r.tokensIn, 0);
    const totalTokensOut = this.requests.reduce((sum, r) => sum + r.tokensOut, 0);
    const totalTokensCached = this.requests.reduce((sum, r) => sum + r.tokensCached, 0);
    const totalCost = this.requests.reduce((sum, r) => sum + r.costUsd, 0);
    const avgLatency = this.requests.length > 0
      ? this.requests.reduce((sum, r) => sum + r.latencyMs, 0) / this.requests.length
      : 0;
    const avgTTFT = this.requests.length > 0
      ? this.requests.reduce((sum, r) => sum + r.timeToFirstTokenMs, 0) / this.requests.length
      : 0;

    return {
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: null,
      totalTokensIn,
      totalTokensOut,
      totalTokensCached,
      totalCostUsd: totalCost,
      totalRequests: this.requests.length,
      averageLatencyMs: avgLatency,
      averageTimeToFirstTokenMs: avgTTFT,
      providerBreakdown: providerMap,
      toolBreakdown: toolMap,
      compactionCount: this.compactionEvents.length,
      peakContextUsage: this.peakContextUsage,
    };
  }

  /**
   * Get a human-readable summary.
   */
  getSummary(): string {
    const m = this.getMetrics();
    const duration = ((Date.now() - this.startedAt) / 1000 / 60).toFixed(1);

    const lines = [
      `Session ${this.sessionId.slice(0, 8)} (${duration} min)`,
      `  Requests: ${m.totalRequests} | Tokens: ${m.totalTokensIn + m.totalTokensOut} (${m.totalTokensCached} cached)`,
      `  Cost: $${m.totalCostUsd.toFixed(4)} | Avg latency: ${m.averageLatencyMs.toFixed(0)}ms`,
      `  Tools: ${m.toolBreakdown.size} unique | Compactions: ${m.compactionCount}`,
      `  Peak context: ${(m.peakContextUsage * 100).toFixed(1)}%`,
    ];

    return lines.join("\n");
  }

  getRequestCount(): number { return this.requests.length; }
  getToolCallCount(): number { return this.toolCalls.length; }
}
