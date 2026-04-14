/**
 * Retrieval Quality Scorer — tracks and optimizes memory search quality.
 *
 * Records every memory retrieval with feedback (was the result useful?),
 * then uses this data to auto-tune the hybrid search weights over time.
 * Part of the self-improvement loop: memory gets better at retrieval
 * with every interaction.
 */

// ── Types ──────────────────────────────────────────────────

export interface RetrievalEvent {
  readonly id: string;
  readonly query: string;
  readonly resultCount: number;
  readonly topResultId: string | null;
  readonly topResultScore: number;
  readonly method: "fts5" | "vector" | "hybrid" | "partitioned";
  readonly domain?: string;
  readonly topic?: string;
  readonly durationMs: number;
  readonly timestamp: number;
}

export interface RetrievalFeedback {
  readonly eventId: string;
  readonly useful: boolean;
  readonly relevantResultIds: readonly string[];
  readonly irrelevantResultIds: readonly string[];
  readonly timestamp: number;
}

export interface QualityMetrics {
  readonly totalRetrievals: number;
  readonly feedbackCount: number;
  readonly usefulRate: number;
  readonly avgResultCount: number;
  readonly avgDurationMs: number;
  readonly methodBreakdown: Readonly<Record<string, { count: number; usefulRate: number }>>;
  readonly domainBreakdown: Readonly<Record<string, { count: number; usefulRate: number }>>;
  readonly recommendedWeights: RecommendedWeights;
}

export interface RecommendedWeights {
  readonly fts5: number;
  readonly vector: number;
  readonly temporal: number;
  readonly frequency: number;
}

// ── Quality Scorer ─────────────────────────────────────────

export class RetrievalQualityScorer {
  private readonly events: RetrievalEvent[] = [];
  private readonly feedback: Map<string, RetrievalFeedback> = new Map();
  private readonly maxHistory: number;

  constructor(maxHistory: number = 1000) {
    this.maxHistory = maxHistory;
  }

  /** Record a retrieval event. */
  recordRetrieval(event: RetrievalEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxHistory) {
      this.events.splice(0, this.events.length - this.maxHistory);
    }
  }

  /** Record feedback for a retrieval event. */
  recordFeedback(fb: RetrievalFeedback): void {
    this.feedback.set(fb.eventId, fb);
  }

  /** Compute quality metrics from recorded events and feedback. */
  computeMetrics(): QualityMetrics {
    const totalRetrievals = this.events.length;
    const feedbackCount = this.feedback.size;

    if (totalRetrievals === 0) {
      return {
        totalRetrievals: 0, feedbackCount: 0, usefulRate: 0,
        avgResultCount: 0, avgDurationMs: 0,
        methodBreakdown: {}, domainBreakdown: {},
        recommendedWeights: { fts5: 0.4, vector: 0.3, temporal: 0.2, frequency: 0.1 },
      };
    }

    let usefulCount = 0;
    for (const fb of this.feedback.values()) {
      if (fb.useful) usefulCount++;
    }
    const usefulRate = feedbackCount > 0 ? usefulCount / feedbackCount : 0;
    const avgResultCount = this.events.reduce((s, e) => s + e.resultCount, 0) / totalRetrievals;
    const avgDurationMs = this.events.reduce((s, e) => s + e.durationMs, 0) / totalRetrievals;

    // Method breakdown
    const methodMap = new Map<string, { count: number; useful: number }>();
    for (const event of this.events) {
      const entry = methodMap.get(event.method) ?? { count: 0, useful: 0 };
      entry.count++;
      const fb = this.feedback.get(event.id);
      if (fb?.useful) entry.useful++;
      methodMap.set(event.method, entry);
    }
    const methodBreakdown: Record<string, { count: number; usefulRate: number }> = {};
    for (const [method, data] of methodMap) {
      methodBreakdown[method] = { count: data.count, usefulRate: data.count > 0 ? data.useful / data.count : 0 };
    }

    // Domain breakdown
    const domainMap = new Map<string, { count: number; useful: number }>();
    for (const event of this.events) {
      const domain = event.domain ?? "unpartitioned";
      const entry = domainMap.get(domain) ?? { count: 0, useful: 0 };
      entry.count++;
      const fb = this.feedback.get(event.id);
      if (fb?.useful) entry.useful++;
      domainMap.set(domain, entry);
    }
    const domainBreakdown: Record<string, { count: number; usefulRate: number }> = {};
    for (const [domain, data] of domainMap) {
      domainBreakdown[domain] = { count: data.count, usefulRate: data.count > 0 ? data.useful / data.count : 0 };
    }

    return {
      totalRetrievals, feedbackCount, usefulRate, avgResultCount, avgDurationMs,
      methodBreakdown, domainBreakdown,
      recommendedWeights: this.computeRecommendedWeights(methodBreakdown),
    };
  }

  getEventCount(): number { return this.events.length; }
  getFeedbackCount(): number { return this.feedback.size; }

  exportData(): { events: readonly RetrievalEvent[]; feedback: readonly RetrievalFeedback[] } {
    return { events: [...this.events], feedback: [...this.feedback.values()] };
  }

  importData(data: { events: readonly RetrievalEvent[]; feedback: readonly RetrievalFeedback[] }): void {
    this.events.length = 0;
    this.events.push(...data.events);
    this.feedback.clear();
    for (const fb of data.feedback) this.feedback.set(fb.eventId, fb);
  }

  private computeRecommendedWeights(
    methodBreakdown: Record<string, { count: number; usefulRate: number }>,
  ): RecommendedWeights {
    const defaults: RecommendedWeights = { fts5: 0.4, vector: 0.3, temporal: 0.2, frequency: 0.1 };
    const totalSamples = Object.values(methodBreakdown).reduce((s, d) => s + d.count, 0);
    if (totalSamples < 10) return defaults;

    const fts5Score = (methodBreakdown["fts5"]?.usefulRate ?? 0.4) +
      (methodBreakdown["hybrid"]?.usefulRate ?? 0) * 0.5;
    const vectorScore = (methodBreakdown["vector"]?.usefulRate ?? 0.3) +
      (methodBreakdown["hybrid"]?.usefulRate ?? 0) * 0.3;
    const temporalScore = 0.2;
    const frequencyScore = 0.1;

    const total = fts5Score + vectorScore + temporalScore + frequencyScore;
    if (total === 0) return defaults;

    return {
      fts5: Math.round((fts5Score / total) * 100) / 100,
      vector: Math.round((vectorScore / total) * 100) / 100,
      temporal: Math.round((temporalScore / total) * 100) / 100,
      frequency: Math.round((frequencyScore / total) * 100) / 100,
    };
  }
}
