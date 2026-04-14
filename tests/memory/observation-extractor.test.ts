import { describe, it, expect, beforeEach } from "vitest";
import type { AutoCaptureEntry } from "../../src/memory/store.js";
import {
  ObservationExtractor,
  ObservationStore,
  extractDecisions,
  extractPreferences,
  extractMilestones,
  extractProblems,
  extractDiscoveries,
} from "../../src/memory/observation-extractor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCapture(overrides: Partial<AutoCaptureEntry> & { id: number }): AutoCaptureEntry {
  return {
    eventType: "tool_call",
    content: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractDecisions
// ---------------------------------------------------------------------------

describe("extractDecisions", () => {
  it("extracts when content contains 'chose'", () => {
    const captures = [
      makeCapture({ id: 1, content: "User chose Postgres over MySQL because of JSONB support" }),
    ];
    const results = extractDecisions(captures);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("decision");
    expect(results[0]!.assertion).toContain("Decision made");
    expect(results[0]!.assertion).toContain("Postgres");
    expect(results[0]!.sourceIds).toEqual([1]);
  });

  it("extracts when content contains 'switched to'", () => {
    const captures = [
      makeCapture({ id: 2, content: "switched to vitest from jest for speed" }),
    ];
    const results = extractDecisions(captures);
    expect(results).toHaveLength(1);
    expect(results[0]!.assertion).toContain("vitest");
  });

  it("extracts when content contains 'instead of'", () => {
    const captures = [
      makeCapture({ id: 3, content: "Used pnpm instead of npm for workspace support" }),
    ];
    const results = extractDecisions(captures);
    expect(results).toHaveLength(1);
  });

  it("returns empty for non-decision content", () => {
    const captures = [
      makeCapture({ id: 4, content: "Reading file src/index.ts" }),
    ];
    expect(extractDecisions(captures)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractPreferences
// ---------------------------------------------------------------------------

describe("extractPreferences", () => {
  it("detects preference when tool is used 3+ times", () => {
    const captures = [
      makeCapture({ id: 1, toolName: "grep", content: "search 1" }),
      makeCapture({ id: 2, toolName: "grep", content: "search 2" }),
      makeCapture({ id: 3, toolName: "grep", content: "search 3" }),
    ];
    const results = extractPreferences(captures);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("preference");
    expect(results[0]!.assertion).toContain("grep");
    expect(results[0]!.assertion).toContain("3 times");
    expect(results[0]!.sourceIds).toEqual([1, 2, 3]);
  });

  it("ignores tools used fewer than 3 times", () => {
    const captures = [
      makeCapture({ id: 1, toolName: "read", content: "a" }),
      makeCapture({ id: 2, toolName: "read", content: "b" }),
    ];
    expect(extractPreferences(captures)).toHaveLength(0);
  });

  it("skips captures without toolName", () => {
    const captures = [
      makeCapture({ id: 1, content: "no tool" }),
      makeCapture({ id: 2, content: "no tool" }),
      makeCapture({ id: 3, content: "no tool" }),
    ];
    expect(extractPreferences(captures)).toHaveLength(0);
  });

  it("confidence scales with count but caps at 0.95", () => {
    const captures = Array.from({ length: 10 }, (_, i) =>
      makeCapture({ id: i + 1, toolName: "bash", content: `cmd ${i}` }),
    );
    const results = extractPreferences(captures);
    expect(results).toHaveLength(1);
    expect(results[0]!.confidence).toBeLessThanOrEqual(0.95);
  });
});

// ---------------------------------------------------------------------------
// extractMilestones
// ---------------------------------------------------------------------------

describe("extractMilestones", () => {
  it("detects 'build succeeded' milestone", () => {
    const captures = [
      makeCapture({ id: 1, content: "build succeeded in 3.2s" }),
    ];
    const results = extractMilestones(captures);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("milestone");
    expect(results[0]!.assertion).toContain("Milestone");
  });

  it("detects 'all tests passed' milestone", () => {
    const captures = [
      makeCapture({ id: 2, content: "all tests passed (42 specs)" }),
    ];
    const results = extractMilestones(captures);
    expect(results).toHaveLength(1);
  });

  it("detects 'deployed' milestone", () => {
    const captures = [
      makeCapture({ id: 3, content: "Successfully deployed to production v2.1.0" }),
    ];
    const results = extractMilestones(captures);
    expect(results).toHaveLength(1);
  });

  it("returns empty for non-milestone content", () => {
    const captures = [
      makeCapture({ id: 4, content: "Reading configuration file" }),
    ];
    expect(extractMilestones(captures)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractProblems
// ---------------------------------------------------------------------------

describe("extractProblems", () => {
  it("detects error keyword", () => {
    const captures = [
      makeCapture({ id: 1, content: "TypeError: Cannot read property 'foo' of undefined" }),
    ];
    const results = extractProblems(captures);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("problem");
    expect(results[0]!.assertion).toContain("Problem encountered");
  });

  it("detects ENOENT error code", () => {
    const captures = [
      makeCapture({ id: 2, content: "ENOENT: no such file or directory, open '/tmp/missing.ts'" }),
    ];
    const results = extractProblems(captures);
    expect(results).toHaveLength(1);
  });

  it("detects crash keyword", () => {
    const captures = [
      makeCapture({ id: 3, content: "Process crashed with exit code 139" }),
    ];
    const results = extractProblems(captures);
    expect(results).toHaveLength(1);
  });

  it("detects stack trace mentions", () => {
    const captures = [
      makeCapture({ id: 4, content: "Unhandled rejection in promise chain" }),
    ];
    const results = extractProblems(captures);
    expect(results).toHaveLength(1);
  });

  it("returns empty for clean content", () => {
    const captures = [
      makeCapture({ id: 5, content: "File saved successfully to disk" }),
    ];
    expect(extractProblems(captures)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractDiscoveries
// ---------------------------------------------------------------------------

describe("extractDiscoveries", () => {
  it("detects error -> fix sequence in same session", () => {
    const session = "sess-123";
    const captures = [
      makeCapture({
        id: 1,
        sessionId: session,
        eventType: "error",
        content: "EPIPE from pre-compact hook",
      }),
      makeCapture({
        id: 2,
        sessionId: session,
        eventType: "fix",
        content: "Added stdin drain before process.exit",
      }),
    ];
    const results = extractDiscoveries(captures);
    expect(results).toHaveLength(1);
    expect(results[0]!.type).toBe("discovery");
    expect(results[0]!.assertion).toContain("EPIPE");
    expect(results[0]!.assertion).toContain("stdin drain");
    expect(results[0]!.sourceIds).toContain(1);
    expect(results[0]!.sourceIds).toContain(2);
  });

  it("detects error content -> success content in same session", () => {
    const session = "sess-456";
    const captures = [
      makeCapture({
        id: 10,
        sessionId: session,
        eventType: "tool_call",
        content: "Build failed with exit code 1",
      }),
      makeCapture({
        id: 11,
        sessionId: session,
        eventType: "tool_call",
        content: "Build succeeded after fixing import",
      }),
    ];
    const results = extractDiscoveries(captures);
    expect(results).toHaveLength(1);
  });

  it("ignores captures without sessionId", () => {
    const captures = [
      makeCapture({ id: 1, eventType: "error", content: "some error" }),
      makeCapture({ id: 2, eventType: "fix", content: "some fix" }),
    ];
    expect(extractDiscoveries(captures)).toHaveLength(0);
  });

  it("ignores sessions with only errors (no fix)", () => {
    const session = "sess-err-only";
    const captures = [
      makeCapture({ id: 1, sessionId: session, eventType: "error", content: "crash" }),
      makeCapture({ id: 2, sessionId: session, eventType: "error", content: "another crash" }),
    ];
    expect(extractDiscoveries(captures)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ObservationExtractor (integration)
// ---------------------------------------------------------------------------

describe("ObservationExtractor", () => {
  it("extracts multiple observation types from mixed captures", () => {
    const extractor = new ObservationExtractor();
    const captures = [
      makeCapture({ id: 1, content: "User chose Redis over Memcached" }),
      makeCapture({ id: 2, content: "Build failed with ENOMEM" }),
      makeCapture({ id: 3, content: "All tests passed" }),
      makeCapture({ id: 4, toolName: "bash", content: "cmd1" }),
      makeCapture({ id: 5, toolName: "bash", content: "cmd2" }),
      makeCapture({ id: 6, toolName: "bash", content: "cmd3" }),
    ];

    const observations = extractor.extractFromCaptures(captures);
    const types = new Set(observations.map((o) => o.type));
    expect(types.has("decision")).toBe(true);
    expect(types.has("problem")).toBe(true);
    expect(types.has("milestone")).toBe(true);
    expect(types.has("preference")).toBe(true);
  });

  it("returns empty for empty input", () => {
    const extractor = new ObservationExtractor();
    expect(extractor.extractFromCaptures([])).toEqual([]);
  });

  it("all observations have required fields", () => {
    const extractor = new ObservationExtractor();
    const captures = [
      makeCapture({ id: 1, content: "decided to use TypeScript strict mode" }),
    ];
    const observations = extractor.extractFromCaptures(captures);
    for (const obs of observations) {
      expect(obs.id).toBeTruthy();
      expect(obs.type).toBeTruthy();
      expect(obs.assertion).toBeTruthy();
      expect(obs.confidence).toBeGreaterThan(0);
      expect(obs.confidence).toBeLessThanOrEqual(1);
      expect(obs.sourceIds.length).toBeGreaterThan(0);
      expect(obs.extractedAt).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Domain / topic inference
// ---------------------------------------------------------------------------

describe("domain and topic inference", () => {
  it("infers domain from file path in content", () => {
    const extractor = new ObservationExtractor();
    const captures = [
      makeCapture({ id: 1, content: "Error in src/memory/store.ts: failed to open DB" }),
    ];
    const observations = extractor.extractFromCaptures(captures);
    const problem = observations.find((o) => o.type === "problem");
    expect(problem?.domain).toBe("memory");
  });

  it("infers domain from keywords", () => {
    const extractor = new ObservationExtractor();
    const captures = [
      makeCapture({ id: 1, content: "Chose sqlite over postgres because no server needed" }),
    ];
    const observations = extractor.extractFromCaptures(captures);
    const decision = observations.find((o) => o.type === "decision");
    expect(decision?.domain).toBe("memory");
  });

  it("infers topic from content keywords", () => {
    const extractor = new ObservationExtractor();
    const captures = [
      makeCapture({ id: 1, content: "Database schema update failed with column mismatch" }),
    ];
    const observations = extractor.extractFromCaptures(captures);
    const problem = observations.find((o) => o.type === "problem");
    expect(problem?.topic).toBe("schema");
  });
});

// ---------------------------------------------------------------------------
// ObservationStore
// ---------------------------------------------------------------------------

describe("ObservationStore", () => {
  let store: ObservationStore;

  beforeEach(() => {
    store = new ObservationStore();
  });

  it("adds and retrieves observations", () => {
    const obs: import("../../src/memory/observation-extractor.js").Observation = {
      id: "obs-1",
      type: "decision",
      assertion: "Chose Postgres for large datasets",
      confidence: 0.8,
      sourceIds: [1],
      extractedAt: Date.now(),
      domain: "memory",
      topic: "schema",
    };
    expect(store.add(obs)).toBe(true);
    expect(store.size).toBe(1);
    expect(store.getById("obs-1")).toEqual(obs);
  });

  it("deduplicates by assertion text", () => {
    const base = {
      type: "decision" as const,
      assertion: "Same assertion text",
      confidence: 0.8,
      sourceIds: [1] as readonly number[],
      extractedAt: Date.now(),
    };
    store.add({ ...base, id: "obs-1" });
    const added = store.add({ ...base, id: "obs-2" });
    expect(added).toBe(false);
    expect(store.size).toBe(1);
  });

  it("addAll returns count of newly added", () => {
    const observations: import("../../src/memory/observation-extractor.js").Observation[] = [
      {
        id: "a",
        type: "milestone",
        assertion: "First",
        confidence: 0.9,
        sourceIds: [1],
        extractedAt: Date.now(),
      },
      {
        id: "b",
        type: "milestone",
        assertion: "Second",
        confidence: 0.9,
        sourceIds: [2],
        extractedAt: Date.now(),
      },
      {
        id: "c",
        type: "milestone",
        assertion: "First",
        confidence: 0.9,
        sourceIds: [3],
        extractedAt: Date.now(),
      },
    ];
    expect(store.addAll(observations)).toBe(2);
    expect(store.size).toBe(2);
  });

  it("search matches substring case-insensitively", () => {
    store.add({
      id: "obs-1",
      type: "preference",
      assertion: "Prefers POSTGRES for large projects",
      confidence: 0.7,
      sourceIds: [1],
      extractedAt: Date.now(),
    });
    store.add({
      id: "obs-2",
      type: "decision",
      assertion: "Chose Redis for caching layer",
      confidence: 0.8,
      sourceIds: [2],
      extractedAt: Date.now(),
    });

    expect(store.search("postgres")).toHaveLength(1);
    expect(store.search("REDIS")).toHaveLength(1);
    expect(store.search("mongodb")).toHaveLength(0);
  });

  it("getByDomain filters correctly", () => {
    store.add({
      id: "obs-1",
      type: "problem",
      assertion: "DB error",
      confidence: 0.9,
      sourceIds: [1],
      extractedAt: Date.now(),
      domain: "memory",
    });
    store.add({
      id: "obs-2",
      type: "problem",
      assertion: "Route error",
      confidence: 0.9,
      sourceIds: [2],
      extractedAt: Date.now(),
      domain: "hooks",
    });

    expect(store.getByDomain("memory")).toHaveLength(1);
    expect(store.getByDomain("hooks")).toHaveLength(1);
    expect(store.getByDomain("security")).toHaveLength(0);
  });

  it("getByType filters correctly", () => {
    store.add({
      id: "obs-1",
      type: "decision",
      assertion: "A decision",
      confidence: 0.7,
      sourceIds: [1],
      extractedAt: Date.now(),
    });
    store.add({
      id: "obs-2",
      type: "milestone",
      assertion: "A milestone",
      confidence: 0.8,
      sourceIds: [2],
      extractedAt: Date.now(),
    });

    expect(store.getByType("decision")).toHaveLength(1);
    expect(store.getByType("milestone")).toHaveLength(1);
    expect(store.getByType("discovery")).toHaveLength(0);
  });

  it("getRecent returns newest first, limited", () => {
    const now = Date.now();
    store.add({
      id: "old",
      type: "problem",
      assertion: "Old problem",
      confidence: 0.5,
      sourceIds: [1],
      extractedAt: now - 10000,
    });
    store.add({
      id: "mid",
      type: "problem",
      assertion: "Mid problem",
      confidence: 0.5,
      sourceIds: [2],
      extractedAt: now - 5000,
    });
    store.add({
      id: "new",
      type: "problem",
      assertion: "New problem",
      confidence: 0.5,
      sourceIds: [3],
      extractedAt: now,
    });

    const recent = store.getRecent(2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.id).toBe("new");
    expect(recent[1]!.id).toBe("mid");
  });
});
