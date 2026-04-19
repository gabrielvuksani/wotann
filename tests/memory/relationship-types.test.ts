import { describe, it, expect } from "vitest";
import {
  MEMORY_RELATIONSHIP_KINDS,
  createHeuristicClassifier,
  createLlmClassifier,
  parseClassifierResponse,
  resolveLatest,
  partitionByKind,
  type MemoryRelationship,
} from "../../src/memory/relationship-types.js";

function makeRel(overrides: Partial<MemoryRelationship> & { id: string }): MemoryRelationship {
  return {
    fromId: "a",
    toId: "b",
    kind: "unknown",
    confidence: 0.5,
    createdAt: 1000,
    ...overrides,
  };
}

describe("MEMORY_RELATIONSHIP_KINDS", () => {
  it("exports the four canonical kinds", () => {
    expect(MEMORY_RELATIONSHIP_KINDS).toEqual(["updates", "extends", "derives", "unknown"]);
  });
});

describe("createHeuristicClassifier", () => {
  const classifier = createHeuristicClassifier();

  it("detects 'updates' from supersedes markers", async () => {
    const result = await classifier.classify(
      "Old policy: 30-day return window",
      "This supersedes the previous policy — effective 2026-01-01, return window is now 45 days.",
    );
    expect(result?.kind).toBe("updates");
  });

  it("detects 'extends' from additionally markers", async () => {
    const result = await classifier.classify(
      "Refunds: original payment method.",
      "Additionally, travel credit may be issued for flights cancelled due to mechanical failures.",
    );
    expect(result?.kind).toBe("extends");
  });

  it("detects 'derives' from 'based on' markers", async () => {
    const result = await classifier.classify(
      "Raw sales data: 10,000 units in Q1.",
      "Q1 revenue summary: derived from unit sales multiplied by price.",
    );
    expect(result?.kind).toBe("derives");
  });

  it("returns null when no markers match", async () => {
    const result = await classifier.classify("Random note 1", "Random note 2");
    expect(result).toBeNull();
  });

  it("confidence is 0-1 and caps at 0.9", async () => {
    const result = await classifier.classify(
      "Old",
      "This supersedes and replaces, effective 2026-01-01, rev 5, version 2",
    );
    expect(result?.confidence).toBeGreaterThan(0);
    expect(result?.confidence).toBeLessThanOrEqual(0.9);
  });
});

describe("parseClassifierResponse", () => {
  it("parses bare JSON", () => {
    const out = parseClassifierResponse('{"kind":"updates","confidence":0.9,"rationale":"r"}');
    expect(out?.kind).toBe("updates");
    expect(out?.confidence).toBe(0.9);
  });

  it("parses fenced ```json block", () => {
    const raw = '```json\n{"kind":"extends","confidence":0.7}\n```';
    const out = parseClassifierResponse(raw);
    expect(out?.kind).toBe("extends");
  });

  it("returns null for 'none' kind", () => {
    expect(parseClassifierResponse('{"kind":"none","confidence":0.1}')).toBeNull();
  });

  it("returns null for invalid kind", () => {
    expect(parseClassifierResponse('{"kind":"replaces","confidence":1}')).toBeNull();
  });

  it("clamps confidence to [0, 1]", () => {
    const out = parseClassifierResponse('{"kind":"updates","confidence":2.5}');
    expect(out?.confidence).toBe(1);
    const out2 = parseClassifierResponse('{"kind":"updates","confidence":-0.5}');
    expect(out2?.confidence).toBe(0);
  });

  it("defaults confidence to 0.5 when missing", () => {
    const out = parseClassifierResponse('{"kind":"updates"}');
    expect(out?.confidence).toBe(0.5);
  });

  it("returns null on garbage input", () => {
    expect(parseClassifierResponse("")).toBeNull();
    expect(parseClassifierResponse("I think they're updates")).toBeNull();
  });

  it("brace-balanced fallback on JSON.parse failure", () => {
    const raw = `The model said: {"kind":"updates","confidence":0.8} trailing junk`;
    const out = parseClassifierResponse(raw);
    expect(out?.kind).toBe("updates");
  });
});

describe("createLlmClassifier", () => {
  it("calls query and parses response", async () => {
    const mockQuery = async () => '{"kind":"updates","confidence":0.85,"rationale":"v2 supersedes v1"}';
    const classifier = createLlmClassifier(mockQuery);
    const result = await classifier.classify("v1 text", "v2 text");
    expect(result?.kind).toBe("updates");
    expect(result?.rationale).toContain("supersedes");
  });

  it("passes deterministic options (temperature=0)", async () => {
    let capturedOpts: { temperature?: number } = {};
    const classifier = createLlmClassifier(async (_p, opts) => {
      capturedOpts = opts as { temperature?: number };
      return '{"kind":"none"}';
    });
    await classifier.classify("a", "b");
    expect(capturedOpts.temperature).toBe(0);
  });
});

describe("resolveLatest", () => {
  it("returns rootId when no updates exist", () => {
    const rels: MemoryRelationship[] = [makeRel({ id: "r1", kind: "extends" })];
    expect(resolveLatest(rels, "a")).toBe("a");
  });

  it("walks a chain of updates to the latest", () => {
    const rels: MemoryRelationship[] = [
      makeRel({ id: "r1", fromId: "v1", toId: "v2", kind: "updates", createdAt: 100 }),
      makeRel({ id: "r2", fromId: "v2", toId: "v3", kind: "updates", createdAt: 200 }),
    ];
    expect(resolveLatest(rels, "v1")).toBe("v3");
  });

  it("prefers most recent edge when multiple updates exist from same source", () => {
    const rels: MemoryRelationship[] = [
      makeRel({ id: "r1", fromId: "v1", toId: "v2a", kind: "updates", createdAt: 100 }),
      makeRel({ id: "r2", fromId: "v1", toId: "v2b", kind: "updates", createdAt: 300 }),
    ];
    expect(resolveLatest(rels, "v1")).toBe("v2b");
  });

  it("breaks cycles (v1→v2→v1)", () => {
    const rels: MemoryRelationship[] = [
      makeRel({ id: "r1", fromId: "v1", toId: "v2", kind: "updates", createdAt: 100 }),
      makeRel({ id: "r2", fromId: "v2", toId: "v1", kind: "updates", createdAt: 200 }),
    ];
    const result = resolveLatest(rels, "v1");
    expect(["v1", "v2"]).toContain(result); // either is acceptable, just don't loop
  });

  it("ignores non-updates edges", () => {
    const rels: MemoryRelationship[] = [
      makeRel({ id: "r1", fromId: "v1", toId: "v2", kind: "extends" }),
    ];
    expect(resolveLatest(rels, "v1")).toBe("v1");
  });
});

describe("partitionByKind", () => {
  it("groups relationships by kind for a given node", () => {
    const rels: MemoryRelationship[] = [
      makeRel({ id: "r1", fromId: "n", toId: "x", kind: "updates" }),
      makeRel({ id: "r2", fromId: "y", toId: "n", kind: "extends" }),
      makeRel({ id: "r3", fromId: "n", toId: "z", kind: "derives" }),
      makeRel({ id: "r4", fromId: "p", toId: "q", kind: "updates" }), // different node
    ];
    const out = partitionByKind(rels, "n");
    expect(out.updates).toHaveLength(1);
    expect(out.extends).toHaveLength(1);
    expect(out.derives).toHaveLength(1);
    expect(out.unknown).toHaveLength(0);
  });

  it("finds both inbound AND outbound edges", () => {
    const rels: MemoryRelationship[] = [
      makeRel({ id: "r1", fromId: "n", toId: "x", kind: "updates" }),
      makeRel({ id: "r2", fromId: "y", toId: "n", kind: "updates" }),
    ];
    const out = partitionByKind(rels, "n");
    expect(out.updates).toHaveLength(2);
  });
});
