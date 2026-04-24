/**
 * V9 T14.2c — persona-tree tests.
 *
 * Covers the 4-level aggregation contract, topic grouping, trait
 * family mapping, and walker / finder helpers.
 */

import { describe, expect, it } from "vitest";
import type { MemoryEntry } from "../../src/memory/store.js";
import {
  buildPersonaTree,
  findLeafByMemoryId,
  walkPersonaTree,
  type PersonaNode,
} from "../../src/memory/persona-tree.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function entry(
  id: string,
  blockType: MemoryEntry["blockType"],
  overrides?: Partial<MemoryEntry>,
): MemoryEntry {
  return {
    id,
    layer: "session",
    blockType,
    key: `key-${id}`,
    value: `value-${id}`,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    verified: false,
    freshnessScore: 1,
    confidenceLevel: 0.5,
    verificationStatus: "unverified",
    ...(overrides ?? {}),
  } as MemoryEntry;
}

function fixedNow(): string {
  return "2026-04-23T22:00:00.000Z";
}

// ── Empty input ───────────────────────────────────────────────────────────

describe("buildPersonaTree — empty input", () => {
  it("returns an empty tree with zero memoryCount", () => {
    const tree = buildPersonaTree([], { now: fixedNow });
    expect(tree.totalMemories).toBe(0);
    expect(tree.root.memoryCount).toBe(0);
    expect(tree.root.children).toHaveLength(0);
    expect(tree.byLevel[0]).toHaveLength(0);
    expect(tree.byLevel[1]).toHaveLength(0);
    expect(tree.byLevel[2]).toHaveLength(0);
    expect(tree.byLevel[3]).toHaveLength(1);
    expect(tree.root.summary).toMatch(/empty/i);
  });
});

// ── Core tree construction ───────────────────────────────────────────────

describe("buildPersonaTree — levels", () => {
  const entries: MemoryEntry[] = [
    entry("e1", "feedback", { topic: "testing", value: "always TDD" }),
    entry("e2", "feedback", { topic: "testing", value: "write test first" }),
    entry("e3", "feedback", { topic: "security", value: "never hardcode secrets" }),
    entry("e4", "feedback", { topic: "security", value: "rotate keys" }),
    entry("e5", "project", { topic: "wotann", value: "V9 execution" }),
    entry("e6", "project", { topic: "wotann", value: "ship Tier 8" }),
    entry("e7", "user", { value: "senior engineer" }),
    entry("e8", "user", { value: "prefers TypeScript" }),
  ];

  it("level 0 contains every entry as a leaf", () => {
    const tree = buildPersonaTree(entries, { now: fixedNow });
    expect(tree.byLevel[0]).toHaveLength(8);
    const ids = tree.byLevel[0].map((n: PersonaNode) => n.memoryId).sort();
    expect(ids).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8"]);
  });

  it("level 1 groups memories with same topic under one node", () => {
    const tree = buildPersonaTree(entries, { now: fixedNow });
    const testing = tree.byLevel[1].find((n: PersonaNode) => n.topic === "testing");
    expect(testing?.memoryCount).toBe(2);
    expect(testing?.children).toHaveLength(2);
  });

  it("level 1 folds single-member topics into 'Uncategorized' when minGroupSize=2", () => {
    const loneEntries = [
      ...entries,
      entry("lone", "reference", { topic: "random-one-off" }),
    ];
    const tree = buildPersonaTree(loneEntries, { now: fixedNow });
    const uncategorized = tree.byLevel[1].find(
      (n: PersonaNode) => n.id === "topic:uncategorized",
    );
    expect(uncategorized?.memoryCount).toBe(1);
  });

  it("level 1 preserves single-member block-key topics (block:user etc)", () => {
    const tree = buildPersonaTree(entries, { now: fixedNow });
    // `user` entries have NO topic; they fold into block:user — level 1
    // keeps block-key groups even when small.
    const userGroup = tree.byLevel[1].find((n: PersonaNode) => n.id === "topic:block:user");
    expect(userGroup?.memoryCount).toBe(2);
  });

  it("level 2 bundles level-1 nodes into block-family traits", () => {
    const tree = buildPersonaTree(entries, { now: fixedNow });
    const feedbackTrait = tree.byLevel[2].find((n: PersonaNode) => n.blockType === "feedback");
    expect(feedbackTrait?.memoryCount).toBe(4); // testing(2) + security(2)
    expect(feedbackTrait?.label).toBe("Behavioral Preferences");
  });

  it("level 2 labels match the trait family mapping", () => {
    const tree = buildPersonaTree(entries, { now: fixedNow });
    const labels = tree.byLevel[2].map((n: PersonaNode) => n.label).sort();
    expect(labels).toContain("Behavioral Preferences"); // feedback
    expect(labels).toContain("Active Project State"); // project
    expect(labels).toContain("User Profile"); // user
  });

  it("level 3 root summary names the top-N trait labels", () => {
    const tree = buildPersonaTree(entries, { now: fixedNow });
    expect(tree.root.summary).toMatch(/Behavioral Preferences|Active Project State|User Profile/);
    expect(tree.root.summary).toContain("8 memories");
    expect(tree.root.summary).toContain("2026-04-23T22:00:00.000Z");
  });

  it("root memoryCount equals sum of leaves", () => {
    const tree = buildPersonaTree(entries, { now: fixedNow });
    expect(tree.root.memoryCount).toBe(entries.length);
    expect(tree.totalMemories).toBe(entries.length);
  });
});

// ── Confidence aggregation ───────────────────────────────────────────────

describe("buildPersonaTree — confidence", () => {
  it("parent confidence is memory-count-weighted average of children", () => {
    const entries: MemoryEntry[] = [
      entry("a", "feedback", { topic: "t", confidenceLevel: 0.2 }),
      entry("b", "feedback", { topic: "t", confidenceLevel: 0.8 }),
    ];
    const tree = buildPersonaTree(entries, { now: fixedNow });
    const topicNode = tree.byLevel[1].find((n: PersonaNode) => n.topic === "t");
    expect(topicNode?.confidence).toBeCloseTo(0.5, 4);
  });

  it("clamps out-of-range confidenceLevel to [0, 1]", () => {
    const entries: MemoryEntry[] = [
      entry("a", "feedback", { topic: "t", confidenceLevel: -2 }),
      entry("b", "feedback", { topic: "t", confidenceLevel: 5 }),
    ];
    const tree = buildPersonaTree(entries, { now: fixedNow });
    for (const leaf of tree.byLevel[0]) {
      expect(leaf.confidence).toBeGreaterThanOrEqual(0);
      expect(leaf.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ── Walker ───────────────────────────────────────────────────────────────

describe("walkPersonaTree", () => {
  it("visits every node depth-first", () => {
    const entries = [
      entry("a", "feedback", { topic: "t1" }),
      entry("b", "feedback", { topic: "t1" }),
    ];
    const tree = buildPersonaTree(entries, { now: fixedNow });
    const visited: string[] = [];
    walkPersonaTree(tree, (node) => {
      visited.push(node.id);
    });
    // Expect root first, then traits, then topics, then leaves.
    expect(visited[0]).toBe("persona:root");
    expect(visited).toContain("trait:feedback");
    expect(visited).toContain("topic:t1");
    expect(visited.filter((id) => id.startsWith("leaf:"))).toHaveLength(2);
  });

  it("stops iteration when visit returns false", () => {
    const entries = [
      entry("a", "feedback", { topic: "t1" }),
      entry("b", "feedback", { topic: "t1" }),
    ];
    const tree = buildPersonaTree(entries, { now: fixedNow });
    const visited: string[] = [];
    walkPersonaTree(tree, (node) => {
      visited.push(node.id);
      if (node.id === "trait:feedback") return false;
    });
    expect(visited).toEqual(["persona:root", "trait:feedback"]);
  });
});

// ── findLeafByMemoryId ───────────────────────────────────────────────────

describe("findLeafByMemoryId", () => {
  it("returns the leaf for a known memory id", () => {
    const entries = [entry("target", "feedback", { topic: "t" }), entry("other", "feedback", { topic: "t" })];
    const tree = buildPersonaTree(entries, { now: fixedNow });
    const leaf = findLeafByMemoryId(tree, "target");
    expect(leaf?.memoryId).toBe("target");
    expect(leaf?.level).toBe(0);
  });

  it("returns null for an unknown id", () => {
    const tree = buildPersonaTree([entry("a", "feedback", { topic: "t" })], { now: fixedNow });
    expect(findLeafByMemoryId(tree, "ghost")).toBeNull();
  });
});

// ── Determinism ──────────────────────────────────────────────────────────

describe("buildPersonaTree — determinism", () => {
  it("two builds with the same input + clock produce equal structure", () => {
    const entries = [
      entry("a", "feedback", { topic: "t" }),
      entry("b", "feedback", { topic: "t" }),
      entry("c", "project", { topic: "p" }),
      entry("d", "project", { topic: "p" }),
    ];
    const a = buildPersonaTree(entries, { now: fixedNow });
    const b = buildPersonaTree(entries, { now: fixedNow });
    expect(a.root.memoryCount).toBe(b.root.memoryCount);
    expect(a.byLevel[1].map((n: PersonaNode) => n.id).sort()).toEqual(
      b.byLevel[1].map((n: PersonaNode) => n.id).sort(),
    );
  });
});
