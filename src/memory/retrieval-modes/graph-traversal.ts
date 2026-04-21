/**
 * graph-traversal — N-hop BFS from seed entries matching the query.
 *
 * Find entries whose content matches the query (seed set), then follow
 * RetrievalContext.edges outward up to `maxHops`. Closer neighbors
 * score higher via 1/(hops+1) decay. If no edges are wired, we fall
 * back to returning the seeds themselves (isHeuristic=true).
 *
 * Leverages:
 *   - P1-M7 typed-entity graph (knowledge_edges) when edges are
 *     injected from store.queryValidAt() / direct DB read.
 *   - Pure in-memory edge lists in unit tests.
 */
import type { RetrievalContext, RetrievalMode, RetrievalHit } from "./types.js";
import { ftsToSearchable } from "./types.js";

export const graphTraversal: RetrievalMode = {
  name: "graph-traversal",
  description: "BFS outward from query-matched seeds, up to maxHops edges away.",
  search: async (ctx, query, opts) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const maxHops = Math.max(1, (opts?.params?.["maxHops"] as number | undefined) ?? 2);

    // 1. Seed set — from injected entries (tokenized substring match)
    //    or from store FTS when available.
    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(10, limit))) : []);

    const q = query.trim().toLowerCase();
    const seedIds = new Set<string>();
    for (const e of entries) {
      if (!q || e.content.toLowerCase().includes(q)) seedIds.add(e.id);
    }
    if (seedIds.size === 0) {
      return {
        mode: "graph-traversal",
        results: [],
        scoring: { method: "bfs-hop-decay", notes: "no seed matches" },
      };
    }

    const edges = ctx.edges ?? [];
    if (edges.length === 0) {
      const hits: RetrievalHit[] = [];
      for (const e of entries) {
        if (!seedIds.has(e.id)) continue;
        hits.push({ id: e.id, content: e.content, score: 1, reason: "seed (no edges wired)" });
        if (hits.length >= limit) break;
      }
      return {
        mode: "graph-traversal",
        results: hits,
        scoring: {
          method: "bfs-hop-decay",
          isHeuristic: true,
          notes: "ctx.edges empty; returning seed-only results",
        },
      };
    }

    // 2. BFS outward.
    const hopLevel = new Map<string, number>();
    for (const id of seedIds) hopLevel.set(id, 0);
    let frontier: string[] = [...seedIds];
    for (let hop = 1; hop <= maxHops; hop++) {
      const next: string[] = [];
      for (const node of frontier) {
        for (const edge of edges) {
          const neighbor =
            edge.fromId === node ? edge.toId : edge.toId === node ? edge.fromId : null;
          if (!neighbor || hopLevel.has(neighbor)) continue;
          hopLevel.set(neighbor, hop);
          next.push(neighbor);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }

    // 3. Map back to entries; score = 1/(hops+1).
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const hits: RetrievalHit[] = [];
    for (const [id, hops] of hopLevel) {
      const entry = entryById.get(id);
      if (!entry) continue;
      hits.push({
        id,
        content: entry.content,
        score: 1 / (hops + 1),
        reason: `${hops} hop${hops === 1 ? "" : "s"} from seed`,
        metadata: { hops, seed: hops === 0 },
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return {
      mode: "graph-traversal",
      results: hits.slice(0, limit),
      scoring: { method: "bfs-hop-decay", weights: { hopPenalty: 1 / (maxHops + 1) } },
    };
  },
};
