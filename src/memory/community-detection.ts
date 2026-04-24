/**
 * Graph community detection (Louvain) — V9 Tier 14.2.
 *
 * Ports the Zep/Graphiti pattern of running Louvain over the memory
 * knowledge graph so related entities cluster into communities.
 * Communities feed retrieval — at query time, a match in one node can
 * pull its whole community for context — and summarization: each
 * community can be summarized once and cached.
 *
 * Operates on the bi-temporal edge set from `bi-temporal-edges.ts`.
 * Only edges that are currently valid at the query time are included
 * in the graph so retired / superseded facts don't distort community
 * boundaries.
 *
 * ── Algorithm ────────────────────────────────────────────────────────
 * Classic Louvain (Blondel et al. 2008) in two phases:
 *   1. Each node starts in its own community. For each node in a
 *      stable order, try moving it to the neighbor's community that
 *      yields the largest positive modularity gain. Repeat until no
 *      move improves modularity in a full pass.
 *   2. Contract the graph: each community becomes a node; intra-
 *      community edges collapse into self-loops; inter-community
 *      edges sum their weights. Re-run phase 1.
 * Stops when no phase makes progress or a pass cap fires.
 *
 * For WOTANN's typical memory graph (≤ ~10k edges), this terminates
 * in tens of milliseconds. Not suitable for million-edge graphs —
 * those would need Leiden or a streaming variant.
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: empty edge sets return an empty result,
 *    NOT a fabricated community. The modularity score reflects the
 *    actual graph structure.
 *  - QB #7 per-call state: pure function. No module-level caches.
 *  - QB #11 sibling-site scan: `bi-temporal-edges.ts` owns the edge
 *    shape + temporal filters (`filterValidAt`, `matchesSnapshot`);
 *    this module only reads.
 */

import type { BiTemporalEdge, SnapshotQuery } from "./bi-temporal-edges.js";
import { filterValidAt, matchesSnapshot } from "./bi-temporal-edges.js";

// ═══ Types ════════════════════════════════════════════════════════════════

export interface DetectOptions {
  /**
   * When set, only edges valid at this ISO date are included in the
   * graph. Equivalent to `filterValidAt(edges, validAt)` up front.
   */
  readonly validAt?: string;
  /**
   * When set, uses the full bi-temporal snapshot filter (both axes:
   * validAt + knownAt). Overrides `validAt` if both are provided.
   */
  readonly snapshot?: SnapshotQuery;
  /**
   * Max outer Louvain phases. Default 8 — enough for any graph under
   * ~10k edges. Callers that need guarantees on very dense graphs
   * raise this.
   */
  readonly maxPhases?: number;
  /**
   * Max inner passes per phase. Default 16. Prevents infinite loops
   * on pathological modularity plateaus.
   */
  readonly maxPassesPerPhase?: number;
  /**
   * Min modularity gain to accept a move. Default 1e-9 — guards
   * against floating-point noise causing no-op oscillation.
   */
  readonly epsilon?: number;
}

export interface CommunityAssignment {
  readonly nodeId: string;
  readonly communityId: number;
}

export interface CommunityReport {
  /** Map from node ID → community ID (stable integer). */
  readonly assignments: Readonly<Record<string, number>>;
  /** Sorted community IDs paired with their member node counts. */
  readonly communities: readonly {
    readonly id: number;
    readonly size: number;
    readonly members: readonly string[];
  }[];
  /** Final modularity score in [-0.5, 1]. Higher = tighter clusters. */
  readonly modularity: number;
  /** How many outer phases ran before convergence or cap. */
  readonly phasesRun: number;
  /** Total edge weight processed (sum of `weight` on all included edges). */
  readonly totalWeight: number;
}

// ═══ Internal graph structures ════════════════════════════════════════════

interface AdjEntry {
  readonly neighbor: number; // internal node index
  readonly weight: number;
}

interface Graph {
  readonly nodes: readonly string[]; // index → node id
  readonly adj: readonly (readonly AdjEntry[])[];
  readonly degree: readonly number[]; // summed weight per node
  readonly m2: number; // 2 * total weight
}

function buildGraph(edges: readonly BiTemporalEdge[]): Graph {
  // Undirected-sum over unique (source, target) pairs. Self-loops
  // permitted (they contribute once to the degree but still 1x to m,
  // consistent with Blondel's original formulation).
  const idByNode = new Map<string, number>();
  const nodes: string[] = [];
  const acc = new Map<number, Map<number, number>>(); // i -> (j -> w)

  function internId(name: string): number {
    const existing = idByNode.get(name);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    nodes.push(name);
    idByNode.set(name, id);
    return id;
  }

  function accrue(a: number, b: number, w: number): void {
    const rowA = acc.get(a) ?? new Map<number, number>();
    rowA.set(b, (rowA.get(b) ?? 0) + w);
    acc.set(a, rowA);
  }

  let totalWeight = 0;
  for (const edge of edges) {
    if (edge.weight <= 0) continue;
    const s = internId(edge.sourceId);
    const t = internId(edge.targetId);
    accrue(s, t, edge.weight);
    if (s !== t) accrue(t, s, edge.weight);
    totalWeight += edge.weight;
  }

  const adj: AdjEntry[][] = nodes.map(() => []);
  const degree: number[] = nodes.map(() => 0);
  for (const [i, row] of acc.entries()) {
    const entries: AdjEntry[] = [];
    for (const [j, w] of row.entries()) {
      entries.push({ neighbor: j, weight: w });
      degree[i] = (degree[i] ?? 0) + w;
    }
    adj[i] = entries;
  }
  return {
    nodes,
    adj,
    degree,
    m2: totalWeight * 2,
  };
}

/**
 * Modularity Q for a given partition.
 *
 *   Q = (1 / 2m) * Σ_ij [ A_ij - (k_i * k_j) / 2m ] * δ(c_i, c_j)
 */
function modularity(graph: Graph, community: readonly number[]): number {
  if (graph.m2 === 0) return 0;
  let q = 0;
  for (let i = 0; i < graph.nodes.length; i++) {
    const neighbors = graph.adj[i]!;
    for (const entry of neighbors) {
      if (community[i] !== community[entry.neighbor]) continue;
      const expected = (graph.degree[i]! * graph.degree[entry.neighbor]!) / graph.m2;
      q += entry.weight - expected;
    }
  }
  return q / graph.m2;
}

/**
 * One Louvain phase: every node greedily picks its neighbor's
 * community when that move maximizes modularity gain. Returns the
 * updated community array and whether any move happened.
 */
function runPhase(graph: Graph, community: number[], epsilon: number, maxPasses: number): boolean {
  // Per-community summed degree (for ΔQ gain formula).
  const kTotal = new Map<number, number>();
  for (let i = 0; i < community.length; i++) {
    const c = community[i]!;
    kTotal.set(c, (kTotal.get(c) ?? 0) + graph.degree[i]!);
  }

  let anyMove = false;
  for (let pass = 0; pass < maxPasses; pass++) {
    let passMoved = false;
    for (let i = 0; i < graph.nodes.length; i++) {
      const currentC = community[i]!;
      // Gather neighbor community weights
      const neighborWeight = new Map<number, number>();
      for (const entry of graph.adj[i]!) {
        if (entry.neighbor === i) continue;
        const nc = community[entry.neighbor]!;
        neighborWeight.set(nc, (neighborWeight.get(nc) ?? 0) + entry.weight);
      }
      // Remove node i from its community temporarily
      const k_i = graph.degree[i]!;
      kTotal.set(currentC, (kTotal.get(currentC) ?? 0) - k_i);

      let bestC = currentC;
      let bestGain = 0;
      for (const [candidate, w_i_c] of neighborWeight.entries()) {
        const sigmaTotC = kTotal.get(candidate) ?? 0;
        const gain = w_i_c - (sigmaTotC * k_i) / graph.m2;
        if (gain > bestGain + epsilon) {
          bestGain = gain;
          bestC = candidate;
        }
      }
      // Consider staying in place (net zero gain).
      if (bestC === currentC) {
        kTotal.set(currentC, (kTotal.get(currentC) ?? 0) + k_i);
        continue;
      }
      community[i] = bestC;
      kTotal.set(bestC, (kTotal.get(bestC) ?? 0) + k_i);
      passMoved = true;
      anyMove = true;
    }
    if (!passMoved) break;
  }
  return anyMove;
}

/**
 * Contract the graph so every community becomes a new node.
 * Intra-community edges aggregate into self-loops; inter-community
 * edges sum across the boundary.
 */
function contractGraph(graph: Graph, community: readonly number[]): Graph {
  const communityIds = [...new Set(community)].sort((a, b) => a - b);
  const idx = new Map<number, number>();
  communityIds.forEach((c, i) => idx.set(c, i));

  const nodes = communityIds.map((c) => `__community_${c}`);
  const acc: Map<number, number>[] = nodes.map(() => new Map<number, number>());

  for (let i = 0; i < graph.nodes.length; i++) {
    const ci = idx.get(community[i]!)!;
    for (const entry of graph.adj[i]!) {
      const cj = idx.get(community[entry.neighbor]!)!;
      const row = acc[ci]!;
      row.set(cj, (row.get(cj) ?? 0) + entry.weight);
    }
  }

  const adj: AdjEntry[][] = nodes.map(() => []);
  const degree: number[] = nodes.map(() => 0);
  let m2 = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (const [j, w] of acc[i]!.entries()) {
      adj[i]!.push({ neighbor: j, weight: w });
      degree[i] = (degree[i] ?? 0) + w;
      m2 += w;
    }
  }

  return { nodes, adj, degree, m2 };
}

// ═══ Public API ═══════════════════════════════════════════════════════════

/**
 * Detect communities on the bi-temporal edge graph. Runs Louvain
 * iteratively (coarsening after each phase) until no phase improves
 * modularity.
 */
export function detectCommunities(
  edges: readonly BiTemporalEdge[],
  options: DetectOptions = {},
): CommunityReport {
  const filtered = options.snapshot
    ? edges.filter((e) => matchesSnapshot(e, options.snapshot!))
    : options.validAt
      ? filterValidAt(edges, options.validAt)
      : edges;

  const baseGraph = buildGraph(filtered);

  if (baseGraph.nodes.length === 0) {
    return {
      assignments: {},
      communities: [],
      modularity: 0,
      phasesRun: 0,
      totalWeight: 0,
    };
  }

  const epsilon = options.epsilon ?? 1e-9;
  const maxPhases = options.maxPhases ?? 8;
  const maxPassesPerPhase = options.maxPassesPerPhase ?? 16;

  // Phase 0: each base-graph node is its own community.
  let nodeToBaseCommunity: number[] = baseGraph.nodes.map((_, i) => i);
  let graph = baseGraph;
  let community = baseGraph.nodes.map((_, i) => i);
  let phasesRun = 0;

  for (let phase = 0; phase < maxPhases; phase++) {
    phasesRun++;
    const moved = runPhase(graph, community, epsilon, maxPassesPerPhase);
    if (!moved) break;

    // Map base nodes forward through this phase's assignments.
    nodeToBaseCommunity = nodeToBaseCommunity.map((c) => community[c]!);

    // Contract + reset community per-node to id-own for next phase.
    const contracted = contractGraph(graph, community);
    if (contracted.nodes.length === graph.nodes.length) break; // no change
    graph = contracted;
    community = contracted.nodes.map((_, i) => i);
  }

  // Renumber communities to a dense [0..N] range for caller friendliness.
  const dense = new Map<number, number>();
  for (const raw of nodeToBaseCommunity) {
    if (!dense.has(raw)) dense.set(raw, dense.size);
  }
  const finalAssignments: Record<string, number> = {};
  const members = new Map<number, string[]>();
  for (let i = 0; i < baseGraph.nodes.length; i++) {
    const cid = dense.get(nodeToBaseCommunity[i]!)!;
    finalAssignments[baseGraph.nodes[i]!] = cid;
    const arr = members.get(cid) ?? [];
    arr.push(baseGraph.nodes[i]!);
    members.set(cid, arr);
  }

  const communities = [...members.entries()]
    .map(([id, ms]) => ({ id, size: ms.length, members: [...ms].sort() }))
    .sort((a, b) => a.id - b.id);

  // Compute modularity against the BASE graph using the final community
  // mapping — the phase-level mod is on the contracted graph, which is
  // a superposition, not the user-visible metric.
  const baseCommunityArr = baseGraph.nodes.map((n) => finalAssignments[n]!);
  const finalQ = modularity(baseGraph, baseCommunityArr);

  return {
    assignments: finalAssignments,
    communities,
    modularity: finalQ,
    phasesRun,
    totalWeight: baseGraph.m2 / 2,
  };
}

/**
 * Convenience: return the community ID for a single node. Returns
 * null when the node isn't present in the graph.
 */
export function communityOf(report: CommunityReport, nodeId: string): number | null {
  const v = report.assignments[nodeId];
  return typeof v === "number" ? v : null;
}

/**
 * Convenience: return every node in the same community as `nodeId`.
 * Empty array when the node isn't in the graph.
 */
export function siblingsOf(report: CommunityReport, nodeId: string): readonly string[] {
  const cid = communityOf(report, nodeId);
  if (cid === null) return [];
  const community = report.communities.find((c) => c.id === cid);
  return community?.members ?? [];
}
