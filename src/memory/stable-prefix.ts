/**
 * Stable-prefix emission for provider prompt caching.
 *
 * Mastra's Observational Memory pattern wins on cost-per-turn because
 * its system prompt + consolidated observations DO NOT change between
 * turns. That invariant lets Anthropic's `cache_control: {type:
 * "ephemeral"}` and OpenAI's 512-token prefix-cache kick in, yielding
 * 4-10× prompt-cache savings across multi-turn sessions. See
 * `docs/internal/RESEARCH_LONGMEMEVAL_SYSTEMS_DEEP.md` section 1.3.
 *
 * This module provides the `buildStablePrefix(ctx)` API that consumers
 * call at prompt assembly time. It returns a byte-identical string
 * for the same input context, so a hash test proves cache-key stability.
 *
 * Split contract (Mastra's "stable prefix / dynamic suffix"):
 *   - STABLE PREFIX = system prompt + workspace context + MEMORY
 *     core_blocks. Rarely changes within a session.
 *   - DYNAMIC SUFFIX = user turn + latest retrievals. Changes every
 *     turn.
 *
 * The split is mechanical: callers pass only fields known to be
 * stable into `buildStablePrefix`. Fields that change per-turn
 * (current prompt, recall results, time-sensitive context) MUST
 * be passed via a separate dynamic channel (see
 * `src/prompt/engine.ts` which already separates cachedPrefix /
 * dynamicSuffix).
 *
 * Why this module exists (and does not duplicate `prompt/engine.ts`):
 *   - `prompt/engine.ts` assembles AGENT-level prompts (AGENTS.md,
 *     modes, runtime modules). This module assembles the MEMORY
 *     portion of the stable prefix — core_blocks entries fetched
 *     from the MemoryStore. Two different responsibilities.
 *   - The Observer → Reflector → core_blocks pipeline (P1-M1)
 *     produces the memory block this module renders. Without it
 *     the stable prefix is empty. Without this module the
 *     promotion pipeline has no downstream consumer.
 *
 * Quality bars applied (CLAUDE.md feedback_wotann_quality_bars*):
 *   - Bar #6 honest failure: store read errors → empty prefix, not
 *     crash. Callers see zero entries, not an exception.
 *   - Bar #11 sibling-site scan: re-uses MemoryStore.getByLayer
 *     instead of re-implementing a retrieval path. One source of
 *     truth for core_blocks.
 *   - Bar #13 grep-verifiable: the prefix begins with a deterministic
 *     header line so consumers can detect it in the assembled
 *     prompt.
 */

import { createHash } from "node:crypto";
import type { MemoryStore, MemoryBlockType, MemoryEntry } from "./store.js";

// ── Types ──────────────────────────────────────────────

/** Context required to render the stable prefix. */
export interface StablePrefixContext {
  /** Session id — used only for scoping, not part of the cache key. */
  readonly sessionId?: string;
  /**
   * Blocks to render, in order. Empty arrays render an empty prefix.
   * Default: ["user", "feedback", "decisions", "project"].
   * Per-block entry count is capped internally.
   */
  readonly blocks?: readonly MemoryBlockType[];
  /**
   * Max entries per block. Default: 10 (matches MEMORY.md limit in
   * global taxonomy). Caller can raise for richer context at the
   * cost of prefix size.
   */
  readonly maxEntriesPerBlock?: number;
  /**
   * When true, include the Mastra-style emoji priority markers
   * (🔴🟡🟢) based on confidence tiers. Default: false — emojis are
   * not universally rendered well across all providers.
   */
  readonly useEmojiPriority?: boolean;
  /** Clock injection for deterministic tests. Default: () => 0. */
  readonly now?: () => number;
}

/** Segments that callers can surface to provider APIs separately. */
export interface StablePrefixSegments {
  /**
   * The rendered stable-prefix text. Empty string when no core_blocks
   * entries exist. Byte-identical across repeated calls with the
   * same inputs.
   */
  readonly stablePrefix: string;
  /**
   * SHA-256 hash of the rendered stable prefix. Consumers who need
   * to prove cache-key stability emit this for logging / diffing.
   */
  readonly stablePrefixHash: string;
  /** Number of entries included across all blocks. */
  readonly entryCount: number;
}

// ── Constants ──────────────────────────────────────────

/** Default blocks rendered, in order, when caller does not override. */
const DEFAULT_BLOCKS: readonly MemoryBlockType[] = ["user", "feedback", "decisions", "project"];

/** Deterministic header so consumers can detect / strip the block. */
const STABLE_PREFIX_HEADER = "## Stable Memory (core_blocks — cache-stable)";

/** Emoji priority tiers. Mastra: 🔴 critical, 🟡 medium, 🟢 informational. */
const EMOJI_CRITICAL = "🔴";
const EMOJI_MEDIUM = "🟡";
const EMOJI_INFO = "🟢";

// ── Public API ─────────────────────────────────────────

/**
 * Build the stable-prefix string for provider prompt caching.
 *
 * BYTE-IDENTICAL across calls with the same inputs — proved by the
 * returned `stablePrefixHash`. That invariant is what makes the
 * Anthropic / OpenAI prompt-cache hit; any time-sensitive value
 * would break the cache key.
 *
 * NEVER reads the current session's `working` layer — by construction
 * those entries are still candidates awaiting Reflector promotion.
 * Only `core_blocks` contributes to the stable prefix.
 */
export function buildStablePrefix(
  store: MemoryStore | null,
  ctx: StablePrefixContext = {},
): StablePrefixSegments {
  const blocks = ctx.blocks ?? DEFAULT_BLOCKS;
  const cap = Math.max(1, ctx.maxEntriesPerBlock ?? 10);
  const useEmoji = ctx.useEmojiPriority ?? false;

  if (!store) {
    return emptySegments();
  }

  // Read all core_blocks once, then group per block type in memory.
  // `getByLayer` is a synchronous DB call; we cap the result in-range
  // so a cold-start session doesn't blow up latency.
  let coreEntries: readonly MemoryEntry[];
  try {
    coreEntries = store.getByLayer("core_blocks");
  } catch {
    // Honest fallback: no crash, empty prefix. The caller's cache
    // key is still stable — it's just empty-stable.
    return emptySegments();
  }

  if (coreEntries.length === 0) return emptySegments();

  // Group by block type, sort deterministically within block.
  const grouped = new Map<MemoryBlockType, MemoryEntry[]>();
  for (const entry of coreEntries) {
    const list = grouped.get(entry.blockType) ?? [];
    list.push(entry);
    grouped.set(entry.blockType, list);
  }

  // Sort entries within a block by (-confidence, id) so repeated
  // reads produce byte-identical output. `MemoryEntry.confidence` is
  // the column `insert()` populates; `confidenceLevel` is a separate
  // DB column that verify-pipelines write — we read both and prefer
  // the richer `confidence` when present (honest data preference).
  const confidenceOf = (entry: MemoryEntry): number =>
    typeof entry.confidence === "number" ? entry.confidence : entry.confidenceLevel;
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      const ca = confidenceOf(a);
      const cb = confidenceOf(b);
      if (ca !== cb) return cb - ca;
      return a.id.localeCompare(b.id);
    });
  }

  // Render.
  const sections: string[] = [];
  let entryCount = 0;
  for (const block of blocks) {
    const list = grouped.get(block);
    if (!list || list.length === 0) continue;
    const capped = list.slice(0, cap);
    const bullets: string[] = [];
    for (const entry of capped) {
      const marker = useEmoji ? emojiForConfidence(confidenceOf(entry)) : "";
      const prefix = marker.length > 0 ? `${marker} ` : "";
      // Assertion body — values can contain newlines; collapse to one
      // line so the bullet rendering stays a two-level list (Mastra).
      const body = (entry.value ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
      bullets.push(`  - ${prefix}${body}`);
      entryCount += 1;
    }
    sections.push(`- ${titleFor(block)}\n${bullets.join("\n")}`);
  }

  if (sections.length === 0) return emptySegments();

  const body = sections.join("\n\n");
  const stablePrefix = `${STABLE_PREFIX_HEADER}\n\n${body}`;
  const stablePrefixHash = sha256(stablePrefix);
  return { stablePrefix, stablePrefixHash, entryCount };
}

/**
 * Produce an object ready for Anthropic's `system` array: one text
 * block with `cache_control: {type: "ephemeral"}`. When the prefix
 * is empty, returns an empty array so callers can concat directly
 * into the system array without a conditional.
 */
export function toAnthropicCachedBlocks(stablePrefix: string): ReadonlyArray<{
  readonly type: "text";
  readonly text: string;
  readonly cache_control: { readonly type: "ephemeral" };
}> {
  if (stablePrefix.length === 0) return [];
  return [
    {
      type: "text" as const,
      text: stablePrefix,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

/**
 * Return the minimum-size threshold for OpenAI prompt caching. Below
 * this, caching is a no-op (OpenAI's 512-token floor). The caller
 * should skip emission when the stable prefix is below this size —
 * including the header just wastes tokens without a cache hit.
 */
export function openaiMinimumStablePrefixChars(): number {
  // ~512 tokens at 4 chars/token average = 2048 chars.
  return 2048;
}

// ── Internals ──────────────────────────────────────────

function emptySegments(): StablePrefixSegments {
  return {
    stablePrefix: "",
    stablePrefixHash: sha256(""),
    entryCount: 0,
  };
}

function titleFor(block: MemoryBlockType): string {
  switch (block) {
    case "user":
      return "User facts";
    case "feedback":
      return "Preferences & feedback";
    case "decisions":
      return "Decisions";
    case "project":
      return "Project context";
    case "reference":
      return "References";
    case "cases":
      return "Known cases";
    case "patterns":
      return "Patterns";
    case "issues":
      return "Known issues";
  }
}

function emojiForConfidence(confidence: number): string {
  if (confidence >= 0.8) return EMOJI_CRITICAL;
  if (confidence >= 0.5) return EMOJI_MEDIUM;
  return EMOJI_INFO;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
