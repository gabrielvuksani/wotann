/**
 * Memory prompt module — injects relevant memories, corrections, and learned patterns.
 *
 * Tiered loading (OpenViking pattern):
 *  L0 — 100-token summaries for top-10 relevant memories (default).
 *  L1 — 2K-token structural summaries (on-demand upgrade).
 *  L2 — full memory body (on explicit reference or expansion request).
 *
 * The module accepts an already-materialised `ctx.memoryContext` string for
 * backwards compatibility, but when the caller populates `ctx.memoryEntries`
 * with raw entries AND `ctx.memoryTierHints` to mark IDs that deserve an
 * upgrade, the TieredContextLoader re-allocates the entries into L0/L1/L2
 * tiers within a token budget before rendering.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";
import { TieredContextLoader, type FileInput } from "../../context/tiered-loader.js";

/** Default token budget for the memory block. Stays well under full ctx. */
const MEMORY_BLOCK_BUDGET = 4_000;
/** L0 token target for a single memory summary. */
const L0_PER_MEMORY_TARGET = 100;

export const memoryPromptModule: PromptModuleEntry = {
  name: "memory",
  priority: 70,
  build(ctx: PromptContext): readonly string[] {
    // Tiered path: when the caller supplies raw memory entries we re-allocate
    // them by relevance with the TieredContextLoader. IDs listed in
    // `memoryTierHints` are upgraded to L1/L2 so the model can see the full
    // content on demand.
    const extendedCtx = ctx as PromptContext & {
      readonly memoryEntries?: ReadonlyArray<{
        readonly id: string;
        readonly key: string;
        readonly value: string;
        readonly relevance?: number;
      }>;
      readonly memoryTierHints?: Readonly<Record<string, 0 | 1 | 2>>;
    };

    if (extendedCtx.memoryEntries && extendedCtx.memoryEntries.length > 0) {
      const tiered = renderTieredMemories(
        extendedCtx.memoryEntries,
        extendedCtx.memoryTierHints ?? {},
      );
      if (tiered.length > 0) {
        return [
          "## Relevant Memories",
          "These memories were retrieved from your persistent knowledge base.",
          "By default only 100-token summaries (L0) are shown. Reference a",
          "memory by its ID to request the full body (L1 or L2).",
          "",
          tiered,
        ];
      }
    }

    if (!ctx.memoryContext) return [];

    return [
      "## Relevant Memories",
      "These memories were retrieved from your persistent knowledge base. They may contain:",
      "- Past corrections (mistakes to avoid repeating)",
      "- Learned patterns (approaches that worked well)",
      "- Project decisions (architectural choices and their rationale)",
      "- User preferences (communication style, coding conventions)",
      "",
      "Apply these memories to inform your current response. If a memory conflicts with the current context, trust the current context — memories may be outdated.",
      "",
      ctx.memoryContext,
    ];
  },
};

/**
 * Render memory entries through the TieredContextLoader. Top-10 by relevance
 * are presented at L0 (summary) by default; entries whose IDs appear in
 * `tierHints` are upgraded to the requested tier.
 */
function renderTieredMemories(
  entries: ReadonlyArray<{
    readonly id: string;
    readonly key: string;
    readonly value: string;
    readonly relevance?: number;
  }>,
  tierHints: Readonly<Record<string, 0 | 1 | 2>>,
): string {
  const loader = new TieredContextLoader();
  const sorted = [...entries].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0)).slice(0, 10);

  const fileInputs: FileInput[] = sorted.map((e) => ({
    path: `memory://${e.id}`,
    // Fake a minimal TS-like file so the loader can extract a signature.
    // Falls through to the value verbatim when the loader returns nothing.
    content: `// ${e.key}\n${e.value}`,
    relevance: e.relevance ?? 0.5,
  }));

  const tierOverrides = new Map<string, 0 | 1 | 2>();
  for (const e of sorted) {
    const hint = tierHints[e.id];
    if (hint !== undefined) tierOverrides.set(e.id, hint);
  }

  const pieces: string[] = [];
  let tokensUsed = 0;

  for (let i = 0; i < fileInputs.length; i++) {
    const entry = sorted[i];
    if (!entry) continue;
    const input = fileInputs[i];
    if (!input) continue;
    const tier = tierOverrides.get(entry.id) ?? 0;

    let body: string;
    if (tier === 2) {
      body = loader.extractL2(input.content);
    } else if (tier === 1) {
      body = loader.extractL1(input.content, "typescript");
    } else {
      // L0 — a short summary. We prefer the entry key + a terse preview so
      // the model can tell what's there without loading the full body.
      const preview = entry.value.replace(/\s+/g, " ").slice(0, L0_PER_MEMORY_TARGET * 4);
      body = `[L0 id=${entry.id}] ${entry.key} — ${preview}${entry.value.length > preview.length ? "…" : ""}`;
    }

    const approxTokens = Math.ceil(body.length / 4);
    if (tokensUsed + approxTokens > MEMORY_BLOCK_BUDGET) break;
    tokensUsed += approxTokens;
    pieces.push(body);
  }

  return pieces.join("\n\n");
}
