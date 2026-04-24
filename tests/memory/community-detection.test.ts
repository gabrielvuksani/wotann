/**
 * V9 T14.2 — community-detection (Louvain) tests.
 *
 * Verifies the algorithm on small graphs with known ground-truth
 * community structure, plus the temporal-snapshot filters and the
 * convenience helpers.
 */

import { describe, expect, it } from "vitest";
import type { BiTemporalEdge } from "../../src/memory/bi-temporal-edges.js";
import {
  communityOf,
  detectCommunities,
  siblingsOf,
} from "../../src/memory/community-detection.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function edge(
  source: string,
  target: string,
  weight = 1,
  overrides?: Partial<BiTemporalEdge>,
): BiTemporalEdge {
  return {
    id: `${source}-${target}`,
    sourceId: source,
    targetId: target,
    relation: "related",
    weight,
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: null,
    recordedFrom: "2026-01-01T00:00:00.000Z",
    recordedTo: null,
    ...(overrides ?? {}),
  };
}

/** A graph with two obvious cliques joined by one weak edge. */
function twoClique(): readonly BiTemporalEdge[] {
  return [
    // Left clique {a, b, c} — fully connected
    edge("a", "b"),
    edge("b", "c"),
    edge("a", "c"),
    // Right clique {x, y, z} — fully connected
    edge("x", "y"),
    edge("y", "z"),
    edge("x", "z"),
    // Bridge edge between c and x (weakest link)
    edge("c", "x", 0.1),
  ];
}

// ── Empty input ───────────────────────────────────────────────────────────

describe("detectCommunities — empty input", () => {
  it("returns an empty report (no fabricated communities)", () => {
    const report = detectCommunities([]);
    expect(report.assignments).toEqual({});
    expect(report.communities).toHaveLength(0);
    expect(report.modularity).toBe(0);
    expect(report.phasesRun).toBe(0);
    expect(report.totalWeight).toBe(0);
  });
});

// ── Two-clique core case ─────────────────────────────────────────────────

describe("detectCommunities — two obvious cliques", () => {
  it("places each clique in its own community", () => {
    const report = detectCommunities(twoClique());
    const a = report.assignments["a"];
    const b = report.assignments["b"];
    const c = report.assignments["c"];
    const x = report.assignments["x"];
    const y = report.assignments["y"];
    const z = report.assignments["z"];
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(x).toBeDefined();
    expect(x).toBe(y);
    expect(y).toBe(z);
    expect(a).not.toBe(x);
  });

  it("modularity is positive and non-trivial", () => {
    const report = detectCommunities(twoClique());
    expect(report.modularity).toBeGreaterThan(0.1);
  });

  it("communities list is ordered and contains member names", () => {
    const report = detectCommunities(twoClique());
    expect(report.communities).toHaveLength(2);
    expect(report.communities[0]?.id).toBe(0);
    expect(report.communities[1]?.id).toBe(1);
    const allMembers = new Set(report.communities.flatMap((c) => c.members));
    expect(allMembers).toEqual(new Set(["a", "b", "c", "x", "y", "z"]));
  });

  it("totalWeight matches the sum of edge weights", () => {
    const report = detectCommunities(twoClique());
    // 3 + 3 + 1 edges × 1 weight each + 1 × 0.1 = 6.1
    expect(report.totalWeight).toBeCloseTo(6.1, 4);
  });
});

// ── Single node / isolated nodes ─────────────────────────────────────────

describe("detectCommunities — isolated structure", () => {
  it("a single edge produces one community of two nodes", () => {
    const report = detectCommunities([edge("only-a", "only-b")]);
    expect(report.communities).toHaveLength(1);
    expect(report.communities[0]?.size).toBe(2);
  });

  it("two disconnected components produce two communities", () => {
    const report = detectCommunities([edge("a", "b"), edge("x", "y")]);
    expect(report.communities).toHaveLength(2);
  });
});

// ── Temporal filters ─────────────────────────────────────────────────────

describe("detectCommunities — validAt filter", () => {
  it("excludes edges whose validTo predates validAt", () => {
    const retired = edge("a", "b", 1, {
      validFrom: "2025-01-01T00:00:00.000Z",
      validTo: "2025-06-01T00:00:00.000Z",
    });
    const current = edge("a", "b", 1, {
      id: "current-ab",
      validFrom: "2026-01-01T00:00:00.000Z",
    });
    const extra = edge("x", "y");
    const report = detectCommunities([retired, current, extra], {
      validAt: "2026-03-01T00:00:00.000Z",
    });
    // Retired edge excluded, so "current" + "extra" remain. The graph is
    // {a-b} + {x-y} → 2 communities.
    expect(report.communities).toHaveLength(2);
  });

  it("snapshot filter considers both validAt + knownAt axes", () => {
    const e = edge("a", "b", 1, {
      validFrom: "2026-01-01T00:00:00.000Z",
      recordedFrom: "2026-04-01T00:00:00.000Z",
    });
    const excluded = detectCommunities([e], {
      snapshot: {
        validAt: "2026-03-01T00:00:00.000Z",
        knownAt: "2026-02-01T00:00:00.000Z",
      },
    });
    expect(excluded.communities).toHaveLength(0);
    const included = detectCommunities([e], {
      snapshot: {
        validAt: "2026-05-01T00:00:00.000Z",
        knownAt: "2026-05-01T00:00:00.000Z",
      },
    });
    expect(included.communities).toHaveLength(1);
  });
});

// ── Edge-case weights ─────────────────────────────────────────────────────

describe("detectCommunities — weight handling", () => {
  it("drops zero-weight edges", () => {
    const report = detectCommunities([edge("a", "b", 0)]);
    expect(report.communities).toHaveLength(0);
  });

  it("higher-weighted edges pull nodes into the stronger community", () => {
    const report = detectCommunities([
      edge("center", "heavy", 10),
      edge("center", "light", 0.1),
    ]);
    // center + heavy should cluster together — a zero-weight partition
    // where heavy is separate would have less modularity.
    const centerC = report.assignments["center"];
    const heavyC = report.assignments["heavy"];
    expect(centerC).toBe(heavyC);
  });
});

// ── communityOf / siblingsOf helpers ─────────────────────────────────────

describe("helper accessors", () => {
  it("communityOf returns the community for a known node", () => {
    const report = detectCommunities(twoClique());
    const c = communityOf(report, "a");
    expect(typeof c).toBe("number");
  });

  it("communityOf returns null for unknown node", () => {
    const report = detectCommunities(twoClique());
    expect(communityOf(report, "ghost")).toBeNull();
  });

  it("siblingsOf returns co-community members", () => {
    const report = detectCommunities(twoClique());
    const siblings = siblingsOf(report, "a");
    expect(siblings).toContain("a");
    expect(siblings).toContain("b");
    expect(siblings).toContain("c");
    expect(siblings).not.toContain("x");
  });

  it("siblingsOf returns [] for unknown node", () => {
    const report = detectCommunities(twoClique());
    expect(siblingsOf(report, "ghost")).toEqual([]);
  });
});

// ── Determinism ──────────────────────────────────────────────────────────

describe("detectCommunities — determinism", () => {
  it("two runs over the same edges produce the same partition", () => {
    const a = detectCommunities(twoClique());
    const b = detectCommunities(twoClique());
    expect(a.assignments).toEqual(b.assignments);
    expect(a.modularity).toBeCloseTo(b.modularity, 10);
  });
});
