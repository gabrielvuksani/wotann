/**
 * path-based — shortest path between two entity nodes (A*).
 *
 * Caller supplies `fromId` and `toId` in opts.params. We run A* over
 * RetrievalContext.edges with a uniform edge weight (unless the edge
 * carries one) and return the entries on the resulting path in order.
 * The score decays by position so earlier hops on the path rank above
 * later ones — useful when the caller only wants the top-K path
 * nodes.
 *
 * When the graph is empty or the two nodes aren't connected, the
 * mode returns an empty result with scoring.notes explaining why.
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import { ftsToSearchable } from "./types.js";

interface PathParams {
  readonly fromId?: string;
  readonly toId?: string;
}
function paramsOf(opts?: RetrievalModeOptions): PathParams {
  const p = opts?.params ?? {};
  return {
    ...(typeof p["fromId"] === "string" ? { fromId: p["fromId"] as string } : {}),
    ...(typeof p["toId"] === "string" ? { toId: p["toId"] as string } : {}),
  };
}

function neighborsOf(
  node: string,
  edges: readonly { fromId: string; toId: string; weight?: number }[],
): readonly { id: string; weight: number }[] {
  const out: { id: string; weight: number }[] = [];
  for (const e of edges) {
    if (e.fromId === node) out.push({ id: e.toId, weight: e.weight ?? 1 });
    else if (e.toId === node) out.push({ id: e.fromId, weight: e.weight ?? 1 });
  }
  return out;
}

function shortestPath(
  fromId: string,
  toId: string,
  edges: readonly { fromId: string; toId: string; weight?: number }[],
): readonly string[] | null {
  // Uniform-cost Dijkstra (A* with zero heuristic since we lack
  // coordinates for nodes). Still O((V+E) log V) on small graphs.
  const dist = new Map<string, number>([[fromId, 0]]);
  const prev = new Map<string, string>();
  const pq: { id: string; d: number }[] = [{ id: fromId, d: 0 }];

  while (pq.length > 0) {
    pq.sort((a, b) => a.d - b.d);
    const cur = pq.shift()!;
    if (cur.id === toId) break;
    if (cur.d > (dist.get(cur.id) ?? Infinity)) continue;
    for (const n of neighborsOf(cur.id, edges)) {
      const alt = cur.d + n.weight;
      if (alt < (dist.get(n.id) ?? Infinity)) {
        dist.set(n.id, alt);
        prev.set(n.id, cur.id);
        pq.push({ id: n.id, d: alt });
      }
    }
  }

  if (!dist.has(toId)) return null;
  const path: string[] = [];
  let at: string | undefined = toId;
  while (at !== undefined) {
    path.unshift(at);
    if (at === fromId) return path;
    at = prev.get(at);
  }
  return null;
}

export const pathBased: RetrievalMode = {
  name: "path-based",
  description: "Return entries on the shortest path between fromId and toId (A*/Dijkstra).",
  search: async (ctx, query, opts) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const { fromId, toId } = paramsOf(opts);
    if (!fromId || !toId) {
      return {
        mode: "path-based",
        results: [],
        scoring: {
          method: "dijkstra",
          isHeuristic: true,
          notes: "missing fromId/toId",
        },
      };
    }
    const edges = ctx.edges ?? [];
    if (edges.length === 0) {
      return {
        mode: "path-based",
        results: [],
        scoring: { method: "dijkstra", isHeuristic: true, notes: "no edges wired" },
      };
    }
    const path = shortestPath(fromId, toId, edges);
    if (!path) {
      return {
        mode: "path-based",
        results: [],
        scoring: { method: "dijkstra", notes: `no path ${fromId} → ${toId}` },
      };
    }
    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query || "*", Math.max(50, limit * 3))) : []);
    const byId = new Map(entries.map((e) => [e.id, e]));

    const hits: RetrievalHit[] = [];
    for (let i = 0; i < path.length && i < limit; i++) {
      const id = path[i]!;
      const entry = byId.get(id);
      if (!entry) continue;
      hits.push({
        id,
        content: entry.content,
        score: 1 / (i + 1),
        reason: `path position ${i + 1}/${path.length}`,
        metadata: { pathIndex: i, pathLength: path.length },
      });
    }
    return {
      mode: "path-based",
      results: hits,
      scoring: { method: "dijkstra", weights: { pathLength: path.length } },
    };
  },
};
