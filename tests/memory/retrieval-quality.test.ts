/**
 * Tests for Retrieval Quality Scorer — auto-tunes search weights.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RetrievalQualityScorer, type RetrievalEvent } from "../../src/memory/retrieval-quality.js";

function makeEvent(overrides: Partial<RetrievalEvent> = {}): RetrievalEvent {
  return {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    query: "test query",
    resultCount: 5,
    topResultId: "result-1",
    topResultScore: 0.85,
    method: "hybrid",
    durationMs: 12,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("RetrievalQualityScorer", () => {
  let scorer: RetrievalQualityScorer;

  beforeEach(() => {
    scorer = new RetrievalQualityScorer();
  });

  it("should record retrieval events", () => {
    scorer.recordRetrieval(makeEvent());
    scorer.recordRetrieval(makeEvent());
    expect(scorer.getEventCount()).toBe(2);
  });

  it("should record feedback", () => {
    scorer.recordRetrieval(makeEvent({ id: "evt-1" }));
    scorer.recordFeedback({ eventId: "evt-1", useful: true, relevantResultIds: ["r1"], irrelevantResultIds: [], timestamp: Date.now() });
    expect(scorer.getFeedbackCount()).toBe(1);
  });

  it("should compute useful rate from feedback", () => {
    scorer.recordRetrieval(makeEvent({ id: "e1" }));
    scorer.recordRetrieval(makeEvent({ id: "e2" }));
    scorer.recordRetrieval(makeEvent({ id: "e3" }));

    scorer.recordFeedback({ eventId: "e1", useful: true, relevantResultIds: [], irrelevantResultIds: [], timestamp: Date.now() });
    scorer.recordFeedback({ eventId: "e2", useful: false, relevantResultIds: [], irrelevantResultIds: [], timestamp: Date.now() });
    scorer.recordFeedback({ eventId: "e3", useful: true, relevantResultIds: [], irrelevantResultIds: [], timestamp: Date.now() });

    const metrics = scorer.computeMetrics();
    expect(metrics.usefulRate).toBeCloseTo(0.667, 2);
  });

  it("should compute method breakdown", () => {
    scorer.recordRetrieval(makeEvent({ id: "e1", method: "fts5" }));
    scorer.recordRetrieval(makeEvent({ id: "e2", method: "vector" }));
    scorer.recordRetrieval(makeEvent({ id: "e3", method: "fts5" }));

    const metrics = scorer.computeMetrics();
    expect(metrics.methodBreakdown["fts5"]?.count).toBe(2);
    expect(metrics.methodBreakdown["vector"]?.count).toBe(1);
  });

  it("should compute domain breakdown", () => {
    scorer.recordRetrieval(makeEvent({ id: "e1", domain: "auth" }));
    scorer.recordRetrieval(makeEvent({ id: "e2", domain: "auth" }));
    scorer.recordRetrieval(makeEvent({ id: "e3", domain: "memory" }));

    const metrics = scorer.computeMetrics();
    expect(metrics.domainBreakdown["auth"]?.count).toBe(2);
    expect(metrics.domainBreakdown["memory"]?.count).toBe(1);
  });

  it("should return default weights with insufficient data", () => {
    scorer.recordRetrieval(makeEvent());
    const metrics = scorer.computeMetrics();
    expect(metrics.recommendedWeights.fts5).toBe(0.4);
    expect(metrics.recommendedWeights.vector).toBe(0.3);
  });

  it("should respect max history limit", () => {
    const smallScorer = new RetrievalQualityScorer(5);
    for (let i = 0; i < 10; i++) {
      smallScorer.recordRetrieval(makeEvent({ id: `e${i}` }));
    }
    expect(smallScorer.getEventCount()).toBe(5);
  });

  it("should export and import data", () => {
    scorer.recordRetrieval(makeEvent({ id: "e1" }));
    scorer.recordFeedback({ eventId: "e1", useful: true, relevantResultIds: [], irrelevantResultIds: [], timestamp: Date.now() });

    const exported = scorer.exportData();
    expect(exported.events.length).toBe(1);
    expect(exported.feedback.length).toBe(1);

    const newScorer = new RetrievalQualityScorer();
    newScorer.importData(exported);
    expect(newScorer.getEventCount()).toBe(1);
    expect(newScorer.getFeedbackCount()).toBe(1);
  });

  it("should return zero metrics for empty scorer", () => {
    const metrics = scorer.computeMetrics();
    expect(metrics.totalRetrievals).toBe(0);
    expect(metrics.usefulRate).toBe(0);
  });
});
