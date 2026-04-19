/**
 * Small-vision CID adapter — builds a CID (content-ID) index over the
 * per-chunk prompt payload when the active provider's model tier is
 * `small-vision` (Gemma/Phi-class local vision models) or `text-only`.
 *
 * ## Why
 * Small models cannot reliably carry 64-char SHA hashes through chain-of-
 * thought; when a weak model has to reference a piece of content inside a
 * diff it frequently mis-copies digits and silently invalidates the safety
 * guarantee. `src/core/content-cid.ts` supplies the primitive (3-char
 * base36 prefix of SHA256); this module is the intelligence-layer wrapper
 * that decides WHEN to build the index based on the active provider.
 *
 * ## Usage
 * ```ts
 * import { maybeBuildCidIndexForProvider } from "./content-cid.js";
 *
 * const idx = maybeBuildCidIndexForProvider({
 *   modelId: "gemma-3-4b-vision",
 *   hasVision: true,
 *   chunks: [{ content: file1Slice, metadata: { path: "a.ts" } }],
 * });
 * if (idx) {
 *   // prompt can now reference `[cid:a1]` anchors
 *   systemPrompt += "\n\n" + idx.promptBlock;
 * }
 * ```
 *
 * Returns `null` for frontier-vision models (they handle full hashes
 * fine) — keeping the index off the wire saves tokens for strong models.
 */

import {
  buildCidIndex,
  renderCidBlock,
  type CidChunk,
  type CidIndexEntry,
} from "../core/content-cid.js";

import type { ModelCapabilityTier } from "../computer-use/perception-adapter.js";

export interface CidIntelligenceInput<T = unknown> {
  /** Model identifier used to infer the capability tier. */
  readonly modelId: string;
  /** Whether the model supports vision. */
  readonly hasVision: boolean;
  /** Chunks to index. */
  readonly chunks: readonly CidChunk<T>[];
  /** Force-build the index regardless of tier (for tests / explicit opt-in). */
  readonly force?: boolean;
}

export interface CidIntelligenceResult<T = unknown> {
  readonly tier: ModelCapabilityTier;
  readonly index: ReadonlyMap<string, CidIndexEntry<T>>;
  readonly cidLength: number;
  readonly promptBlock: string;
  readonly chunkCount: number;
}

/**
 * Frontier vision models do NOT need CID anchors — they handle full
 * SHA256 digests natively. Match prefixes on the common frontier names.
 */
const FRONTIER_VISION_PREFIXES: readonly string[] = [
  "claude-opus",
  "claude-sonnet",
  "gpt-5",
  "gpt-4",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3.1",
];

function classifyTierFromModelId(modelId: string, hasVision: boolean): ModelCapabilityTier {
  const id = modelId.toLowerCase();
  const isFrontier = FRONTIER_VISION_PREFIXES.some((prefix) => id.startsWith(prefix));
  if (hasVision && isFrontier) return "frontier-vision";
  if (hasVision) return "small-vision";
  return "text-only";
}

/**
 * Decide whether the active provider benefits from a CID index and, if
 * so, build it. Returns `null` when the active model is a frontier
 * vision model (which carries full hashes reliably).
 */
export function maybeBuildCidIndexForProvider<T = unknown>(
  input: CidIntelligenceInput<T>,
): CidIntelligenceResult<T> | null {
  const tier = classifyTierFromModelId(input.modelId, input.hasVision);

  // Only emit a CID index for weak models (small-vision + text-only).
  // Frontier models handle full SHAs fine; adding CIDs is wasted context.
  if (!input.force && tier === "frontier-vision") return null;
  if (input.chunks.length === 0) return null;

  const { entries, cidLength } = buildCidIndex(input.chunks);
  const promptBlock = renderCidBlock(entries);

  return {
    tier,
    index: entries,
    cidLength,
    promptBlock,
    chunkCount: input.chunks.length,
  };
}

/**
 * Produce a prompt-ready annotation that teaches a weak model the CID
 * vocabulary for the turn. Returns an empty string if the tier does
 * not benefit from CIDs (frontier vision models).
 */
export function renderCidAnnotation<T>(result: CidIntelligenceResult<T> | null): string {
  if (!result) return "";
  const header = `# Content anchors (CID, ${result.cidLength}-char base36)`;
  const note =
    "Reference content by [cid:xx] instead of long hashes. Anchors are " +
    "stable for this turn only; do not invent CIDs.";
  return `${header}\n${note}\n\n${result.promptBlock}`;
}
