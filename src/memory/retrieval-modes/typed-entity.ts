/**
 * typed-entity — FTS results filtered by M7 entity-type tag.
 *
 * Leverages the entity taxonomy from src/memory/entity-types.ts
 * (person / project / file / concept / event / goal / skill / tool).
 * Callers pass `entityType: "person"` in opts.params to get back only
 * entries whose metadata has that tag.
 *
 * When no explicit entityType is supplied, the mode inspects the
 * query for entity keywords ("who", "where", "when", "file ", etc.)
 * and guesses. Guessing is heuristic → isHeuristic=true.
 */
import type {
  RetrievalContext,
  RetrievalMode,
  RetrievalHit,
  RetrievalModeOptions,
} from "./types.js";
import { ftsToSearchable } from "./types.js";

const ENTITY_TYPES = [
  "person",
  "project",
  "file",
  "concept",
  "event",
  "goal",
  "skill",
  "tool",
] as const;

function guessEntityType(query: string): { type: string; isHeuristic: boolean } | null {
  const q = query.toLowerCase();
  if (/\bwho\b/.test(q)) return { type: "person", isHeuristic: true };
  if (/\bfile\b|\.ts\b|\.js\b|\.py\b/.test(q)) return { type: "file", isHeuristic: true };
  if (/\bwhen\b|\bdate\b/.test(q)) return { type: "event", isHeuristic: true };
  if (/\btool\b|\buse\s/.test(q)) return { type: "tool", isHeuristic: true };
  return null;
}

function entityTypeOf(
  opts: RetrievalModeOptions | undefined,
  query: string,
): { type: string; isHeuristic: boolean } | null {
  const explicit = opts?.params?.["entityType"];
  if (typeof explicit === "string" && ENTITY_TYPES.some((t) => t === explicit)) {
    return { type: explicit, isHeuristic: false };
  }
  return guessEntityType(query);
}

export const typedEntity: RetrievalMode = {
  name: "typed-entity",
  description:
    "Filter FTS candidates by entity-type tag (person/project/file/concept/event/goal/skill/tool).",
  search: async (ctx, query, opts) => {
    const limit = Math.max(1, opts?.limit ?? 20);
    const picked = entityTypeOf(opts, query);
    const entries =
      ctx.entries ??
      (ctx.store ? ftsToSearchable(ctx.store.search(query, Math.max(50, limit * 3))) : []);

    if (!picked) {
      return {
        mode: "typed-entity",
        results: [],
        scoring: {
          method: "entity-type-filter",
          isHeuristic: true,
          notes: "no entityType supplied and no heuristic match",
        },
      };
    }

    const hits: RetrievalHit[] = [];
    for (const e of entries) {
      const tagged = e.metadata?.["entityType"];
      if (tagged === picked.type) {
        hits.push({
          id: e.id,
          content: e.content,
          score: 1,
          reason: `entityType=${picked.type}`,
          metadata: { entityType: picked.type },
        });
      }
    }

    return {
      mode: "typed-entity",
      results: hits.slice(0, limit),
      scoring: {
        method: "entity-type-filter",
        ...(picked.isHeuristic
          ? { isHeuristic: true, notes: "entityType guessed from query" }
          : {}),
      },
    };
  },
};
