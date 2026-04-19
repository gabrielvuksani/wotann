import { describe, it, expect } from "vitest";
import {
  scoreTurn,
  compactByImportance,
  summarizeDropped,
  type Turn,
} from "../../src/context/importance-compactor.js";

function turn(
  id: string,
  content: string,
  role: Turn["role"] = "user",
  ts: number = Date.now(),
): Turn {
  return { id, content, role, timestamp: ts };
}

describe("scoreTurn", () => {
  it("longer turns score higher on length", () => {
    const shortS = scoreTurn(turn("a", "x"), 0, 10).signals.length;
    const longS = scoreTurn(turn("b", "x".repeat(2000)), 0, 10).signals.length;
    expect(longS).toBeGreaterThan(shortS);
  });

  it("first turn gets isFirstOrLast=1", () => {
    expect(scoreTurn(turn("a", "x"), 0, 10).signals.isFirstOrLast).toBe(1);
  });

  it("last turn gets isFirstOrLast=1", () => {
    expect(scoreTurn(turn("a", "x"), 9, 10).signals.isFirstOrLast).toBe(1);
  });

  it("middle turn gets isFirstOrLast=0", () => {
    expect(scoreTurn(turn("a", "x"), 5, 10).signals.isFirstOrLast).toBe(0);
  });

  it("question detection", () => {
    expect(scoreTurn(turn("a", "What is X?"), 5, 10).signals.hasQuestion).toBe(1);
    expect(scoreTurn(turn("b", "X is Y"), 5, 10).signals.hasQuestion).toBe(0);
  });

  it("decision marker detection", () => {
    expect(
      scoreTurn(turn("a", "we decided to use WOTANN"), 5, 10).signals.hasDecisionMarker,
    ).toBe(1);
    expect(scoreTurn(turn("b", "no verb here"), 5, 10).signals.hasDecisionMarker).toBe(0);
  });

  it("score bounded [0, 1]", () => {
    const s = scoreTurn(turn("a", "decided to pick X?"), 0, 10);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(1);
  });
});

describe("compactByImportance", () => {
  it("returns all turns unchanged when below maxTurns", () => {
    const turns = [turn("a", "x"), turn("b", "y")];
    const r = compactByImportance(turns, { maxTurns: 10 });
    expect(r.kept).toEqual(turns);
    expect(r.dropped).toEqual([]);
  });

  it("keeps head + tail mandatorily", () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn(`t${i}`, "x"));
    const r = compactByImportance(turns, { maxTurns: 5, keepHead: 1, keepTail: 1 });
    expect(r.kept).toContain(turns[0]);
    expect(r.kept).toContain(turns[19]);
  });

  it("drops middle turns when over budget", () => {
    const turns = Array.from({ length: 20 }, (_, i) => turn(`t${i}`, "x"));
    const r = compactByImportance(turns, { maxTurns: 5 });
    expect(r.kept.length).toBe(5);
    expect(r.dropped.length).toBe(15);
  });

  it("preserves highest-scoring middle turns", () => {
    const turns = [
      turn("head", "start"),
      turn("boring1", "x"),
      turn("boring2", "y"),
      turn("important", "decided to use the production system. What breaks?"),
      turn("boring3", "z"),
      turn("tail", "end"),
    ];
    const r = compactByImportance(turns, { maxTurns: 3, keepHead: 1, keepTail: 1 });
    const ids = r.kept.map((t) => t.id);
    expect(ids).toContain("head");
    expect(ids).toContain("tail");
    expect(ids).toContain("important");
  });

  it("original order is preserved in kept[]", () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(`t${i}`, "x"));
    const r = compactByImportance(turns, { maxTurns: 5 });
    const keptIds = r.kept.map((t) => t.id);
    for (let i = 1; i < keptIds.length; i++) {
      const prev = parseInt(keptIds[i - 1]!.slice(1), 10);
      const curr = parseInt(keptIds[i]!.slice(1), 10);
      expect(curr).toBeGreaterThan(prev);
    }
  });

  it("respects custom weights", () => {
    const turns = [
      turn("short-q", "what?"), // has question
      turn("long", "x".repeat(2000)), // long
    ];
    // With heavy question weight + zero length weight, short-q wins
    const rQ = compactByImportance(
      [turn("head", "h"), ...turns, turn("tail", "t")],
      {
        maxTurns: 3,
        keepHead: 1,
        keepTail: 1,
        weights: { length: 0, hasQuestion: 1 },
      },
    );
    expect(rQ.kept.map((t) => t.id)).toContain("short-q");
  });
});

describe("summarizeDropped", () => {
  it("empty summary when nothing dropped", () => {
    expect(summarizeDropped({ kept: [], dropped: [], scoresByTurnId: new Map() })).toBe("");
  });

  it("includes count + first/last ids", () => {
    const r = {
      kept: [],
      dropped: [turn("a", "x"), turn("b", "y"), turn("c", "z")],
      scoresByTurnId: new Map(),
    };
    const summary = summarizeDropped(r);
    expect(summary).toContain("3 turns");
    expect(summary).toContain("a");
    expect(summary).toContain("c");
  });
});
