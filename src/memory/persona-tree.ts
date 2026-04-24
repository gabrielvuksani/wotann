/**
 * Persona abstraction tree — V9 Tier 14.2c.
 *
 * TiMem-inspired hierarchical persona over episodic memory. Rather
 * than surfacing raw memories directly, the persona tree groups them
 * into topic themes (level 1), consolidates themes into behavioral
 * traits (level 2), and collapses traits into a single persona
 * summary (level 3). Higher levels survive compaction; lower levels
 * ground the abstractions in concrete evidence.
 *
 * ── Level semantics ─────────────────────────────────────────────────
 *   Level 0 — raw memory entries (leaves)
 *   Level 1 — topic groups: memories that share a `topic` field OR
 *             the same `blockType` when topic is absent
 *   Level 2 — trait categories: themes rolled up by block family
 *             (user profile / feedback-style / project state /
 *             reference pointers / operational)
 *   Level 3 — persona root: single node summarizing the whole tree
 *
 * ── Why this beats "just query the DB" ─────────────────────────────
 * Raw recall over 1000+ entries costs tokens + latency. A tree
 * walker can answer "what kind of person is this user?" from the
 * level-3 summary alone, then drill down only when specificity is
 * needed. Compaction can keep the upper 2 levels and discard level-0
 * leaves until they're referenced.
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: empty input produces an EMPTY tree
 *    (no fabricated root summary).
 *  - QB #7 per-call state: pure function. No module-level state.
 *  - QB #11 sibling-site scan: `store.ts` owns MemoryEntry +
 *    MemoryBlockType; this module reads those shapes and builds a
 *    disjoint projection. Doesn't mutate the store.
 */

import type { MemoryBlockType, MemoryEntry } from "./store.js";

// ═══ Types ════════════════════════════════════════════════════════════════

export type PersonaLevel = 0 | 1 | 2 | 3;

/**
 * A node at any level of the tree. Leaves carry `memoryId`; non-leaf
 * nodes carry `children` and an aggregated `summary`.
 */
export interface PersonaNode {
  readonly id: string;
  readonly level: PersonaLevel;
  readonly label: string;
  readonly summary: string;
  /** Block type when level ≥ 1 and the node corresponds to a block family. */
  readonly blockType?: MemoryBlockType;
  /** Topic when level ≥ 1 and the node is a topic group. */
  readonly topic?: string;
  /** Count of leaves (level-0 memories) in this subtree. */
  readonly memoryCount: number;
  /** Average confidence across leaves in this subtree (0..1). */
  readonly confidence: number;
  /** Level-0 only. */
  readonly memoryId?: string;
  /** Empty at level 0. */
  readonly children: readonly PersonaNode[];
}

export interface PersonaTree {
  readonly root: PersonaNode;
  /** Nodes indexed by level for fast per-level traversal. */
  readonly byLevel: Readonly<Record<PersonaLevel, readonly PersonaNode[]>>;
  /** Total level-0 memories feeding this tree. */
  readonly totalMemories: number;
  /** Wall-clock time the tree was built (test-injectable). */
  readonly builtAt: string;
}

export interface BuildPersonaOptions {
  /**
   * Minimum number of memories in a topic group before it survives
   * as a distinct level-1 node. Smaller groups fold into a
   * `"uncategorized"` sibling so level 1 doesn't balloon into a
   * one-node-per-memory leaf tree.
   *
   * Default 2 — any theme that surfaces once is noise until it
   * repeats.
   */
  readonly minTopicGroupSize?: number;
  /**
   * Deterministic clock for tests. Defaults to `new Date()`
   * timestamp string.
   */
  readonly now?: () => string;
}

// ═══ Trait family mapping ════════════════════════════════════════════════

/**
 * Human-readable trait names for each MemoryBlockType family. Level 2
 * nodes get one entry per family that has at least one level-1 child.
 */
const TRAIT_LABEL_BY_BLOCK: Readonly<Record<MemoryBlockType, string>> = {
  user: "User Profile",
  feedback: "Behavioral Preferences",
  project: "Active Project State",
  reference: "External References",
  cases: "Debugged Cases",
  patterns: "Reusable Techniques",
  decisions: "Architectural Decisions",
  issues: "Known Issues",
};

// ═══ Helpers ═════════════════════════════════════════════════════════════

function resolveConfidence(entry: MemoryEntry): number {
  // Entries carry confidenceLevel on a 0..1 scale when populated.
  const raw = typeof entry.confidenceLevel === "number" ? entry.confidenceLevel : 0.5;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function avgConfidence(children: readonly PersonaNode[]): number {
  if (children.length === 0) return 0;
  let totalMemoryCount = 0;
  let weighted = 0;
  for (const child of children) {
    totalMemoryCount += child.memoryCount;
    weighted += child.confidence * child.memoryCount;
  }
  return totalMemoryCount === 0 ? 0 : weighted / totalMemoryCount;
}

function sumMemories(children: readonly PersonaNode[]): number {
  let total = 0;
  for (const child of children) total += child.memoryCount;
  return total;
}

function topicKeyFor(entry: MemoryEntry): string {
  if (typeof entry.topic === "string" && entry.topic.trim().length > 0) {
    return entry.topic.trim();
  }
  return `block:${entry.blockType}`;
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

// ═══ Level 0 builders ════════════════════════════════════════════════════

function leafNode(entry: MemoryEntry): PersonaNode {
  return {
    id: `leaf:${entry.id}`,
    level: 0,
    label: truncate(entry.key || entry.value, 60),
    summary: truncate(entry.value, 140),
    blockType: entry.blockType,
    topic: entry.topic,
    memoryCount: 1,
    confidence: resolveConfidence(entry),
    memoryId: entry.id,
    children: [],
  };
}

// ═══ Level 1 (topic groups) ══════════════════════════════════════════════

function buildLevel1(
  entries: readonly MemoryEntry[],
  minGroupSize: number,
): readonly PersonaNode[] {
  const byTopic = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    const key = topicKeyFor(entry);
    const bucket = byTopic.get(key) ?? [];
    bucket.push(entry);
    byTopic.set(key, bucket);
  }

  const groups: PersonaNode[] = [];
  const unfolded: MemoryEntry[] = [];
  for (const [key, bucket] of byTopic.entries()) {
    if (bucket.length < minGroupSize && !key.startsWith("block:")) {
      unfolded.push(...bucket);
      continue;
    }
    const leaves = bucket.map(leafNode);
    const head = bucket[0];
    if (!head) continue; // defensive — Map entries can't be empty but TS
    const blockType = head.blockType;
    groups.push({
      id: `topic:${key}`,
      level: 1,
      label: key.startsWith("block:") ? TRAIT_LABEL_BY_BLOCK[blockType] : key,
      summary: `${bucket.length} memories about "${key}"`,
      blockType,
      topic: key.startsWith("block:") ? undefined : key,
      memoryCount: leaves.length,
      confidence: avgConfidence(leaves),
      children: leaves,
    });
  }

  if (unfolded.length > 0) {
    const leaves = unfolded.map(leafNode);
    const blockType = unfolded[0]?.blockType ?? "reference";
    groups.push({
      id: "topic:uncategorized",
      level: 1,
      label: "Uncategorized",
      summary: `${unfolded.length} memories without a repeating topic`,
      blockType,
      memoryCount: leaves.length,
      confidence: avgConfidence(leaves),
      children: leaves,
    });
  }

  groups.sort((a, b) => b.memoryCount - a.memoryCount);
  return groups;
}

// ═══ Level 2 (trait categories) ═════════════════════════════════════════

function buildLevel2(level1: readonly PersonaNode[]): readonly PersonaNode[] {
  const byBlock = new Map<MemoryBlockType, PersonaNode[]>();
  for (const node of level1) {
    if (!node.blockType) continue;
    const bucket = byBlock.get(node.blockType) ?? [];
    bucket.push(node);
    byBlock.set(node.blockType, bucket);
  }

  const traits: PersonaNode[] = [];
  for (const [blockType, children] of byBlock.entries()) {
    const memoryCount = sumMemories(children);
    traits.push({
      id: `trait:${blockType}`,
      level: 2,
      label: TRAIT_LABEL_BY_BLOCK[blockType],
      summary: `${memoryCount} memories across ${children.length} theme${
        children.length === 1 ? "" : "s"
      }`,
      blockType,
      memoryCount,
      confidence: avgConfidence(children),
      children,
    });
  }
  traits.sort((a, b) => b.memoryCount - a.memoryCount);
  return traits;
}

// ═══ Level 3 (root persona) ═════════════════════════════════════════════

function buildRoot(level2: readonly PersonaNode[], nowStr: string): PersonaNode {
  const total = sumMemories(level2);
  if (total === 0) {
    return {
      id: "persona:root",
      level: 3,
      label: "Persona",
      summary: "No memories yet — persona tree is empty.",
      memoryCount: 0,
      confidence: 0,
      children: [],
    };
  }
  const topTraits = level2.slice(0, 3).map((t) => t.label);
  return {
    id: "persona:root",
    level: 3,
    label: "Persona",
    summary: `${total} memories, anchored in: ${topTraits.join(", ")} (built ${nowStr}).`,
    memoryCount: total,
    confidence: avgConfidence(level2),
    children: level2,
  };
}

// ═══ Public API ══════════════════════════════════════════════════════════

/**
 * Build a full persona tree from a flat array of MemoryEntry. The
 * result is a structural snapshot — mutations to the entries after
 * the call do NOT propagate.
 */
export function buildPersonaTree(
  entries: readonly MemoryEntry[],
  options: BuildPersonaOptions = {},
): PersonaTree {
  const minGroupSize = options.minTopicGroupSize ?? 2;
  const now = options.now ?? (() => new Date().toISOString());
  const nowStr = now();

  const level1 = buildLevel1(entries, minGroupSize);
  const level2 = buildLevel2(level1);
  const root = buildRoot(level2, nowStr);

  const level0: PersonaNode[] = [];
  for (const l1 of level1) {
    for (const leaf of l1.children) level0.push(leaf);
  }

  return {
    root,
    byLevel: {
      0: level0,
      1: level1,
      2: level2,
      3: [root],
    },
    totalMemories: level0.length,
    builtAt: nowStr,
  };
}

/**
 * Walk the tree depth-first, invoking `visit(node)` on every node.
 * Returns early when visit returns `false`. Useful for searching the
 * tree by predicate.
 */
export function walkPersonaTree(
  tree: PersonaTree,
  visit: (node: PersonaNode) => boolean | void,
): void {
  const stack: PersonaNode[] = [tree.root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    const keep = visit(node);
    if (keep === false) return;
    // Depth-first, children pushed in reverse so first child visited first.
    for (let i = node.children.length - 1; i >= 0; i--) {
      const child = node.children[i];
      if (child) stack.push(child);
    }
  }
}

/**
 * Convenience accessor — find the node for a specific memory id.
 * Returns null when the id isn't present in the tree.
 */
export function findLeafByMemoryId(tree: PersonaTree, memoryId: string): PersonaNode | null {
  for (const leaf of tree.byLevel[0]) {
    if (leaf.memoryId === memoryId) return leaf;
  }
  return null;
}
