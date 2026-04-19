/**
 * Prompt cache warmup — Anthropic prompt-caching.
 *
 * Anthropic's prompt-caching API stores a cached prefix for ~5 minutes
 * after first use, giving +90% cost reduction + ~2x latency improvement
 * on reused prefixes. BUT: the cache is empty at session-start. First
 * query to a fresh prefix pays full cost + latency before benefits
 * kick in.
 *
 * This module ships:
 *   - annotatePromptForCaching(systemPrompt, strategy) — adds
 *     cache_control blocks at the right anchor points
 *   - planWarmup(prefixes) — identifies which prefixes are worth pre-warming
 *     (above a token threshold, used N+ times per session)
 *   - warmupCache(prefixes, sendFn) — fires warmup requests in parallel
 *   - cacheHitTracker — lightweight counter for telemetry
 *
 * No direct HTTP — caller supplies the sendFn. Pure annotation + pacing.
 */

// ── Types ──────────────────────────────────────────────

export interface CachePrefix {
  /** Stable identifier (used for dedup + telemetry). */
  readonly id: string;
  /** The prefix content to cache (typically system prompt prefix). */
  readonly content: string;
  /** Optional expected usage count this session — higher = higher warmup priority. */
  readonly expectedUses?: number;
}

export interface AnnotatedPrompt {
  readonly content: string;
  /** Blocks with cache_control markers, ready for provider API. */
  readonly blocks: ReadonlyArray<{
    readonly type: "text";
    readonly text: string;
    readonly cache_control?: { readonly type: "ephemeral" };
  }>;
}

export type CacheStrategy =
  | "auto" // split by heuristic: cache the stable part, don't cache the per-request tail
  | "whole" // cache the entire prompt (good for fixed system prompts)
  | "no-cache"; // don't cache (baseline)

export interface WarmupOptions {
  /** Min tokens for a prefix to be worth caching. Default 1024 (Anthropic's min). */
  readonly minTokens?: number;
  /** Max prefixes to warm in a single call. Default 4 (Anthropic's max cache_control breakpoints). */
  readonly maxPrefixes?: number;
  /** Max concurrent warmup requests. Default 3. */
  readonly concurrency?: number;
  /** Called per warmup completion for telemetry. */
  readonly onWarmup?: (id: string, durationMs: number, success: boolean) => void;
}

export interface WarmupResult {
  readonly warmed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly totalMs: number;
  readonly details: ReadonlyArray<{
    readonly id: string;
    readonly status: "warmed" | "failed" | "skipped-too-small";
    readonly durationMs: number;
  }>;
}

// ── Token estimation ─────────────────────────────────

/**
 * Rough token count — 1 token ≈ 4 chars (Anthropic's public heuristic).
 * Good enough for pre-flight minTokens check; not a replacement for
 * server-side tiktoken.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Annotation ────────────────────────────────────────

/**
 * Annotate a prompt for Anthropic caching. Returns blocks that can be
 * sent as system[].text + cache_control markers per block.
 */
export function annotatePromptForCaching(
  systemPrompt: string,
  strategy: CacheStrategy = "auto",
): AnnotatedPrompt {
  if (strategy === "no-cache") {
    return {
      content: systemPrompt,
      blocks: [{ type: "text", text: systemPrompt }],
    };
  }

  if (strategy === "whole") {
    return {
      content: systemPrompt,
      blocks: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
    };
  }

  // "auto" — split into stable prefix + volatile suffix if possible
  // Heuristic: if the prompt contains a "---" or "\n\n## " delimiter
  // that follows the bulk of the content, treat the pre-delim part as
  // cacheable and the post-delim as per-request.
  const splitRe = /\n\n(?:---|## \w)/;
  const splitMatch = systemPrompt.match(splitRe);
  if (splitMatch && splitMatch.index !== undefined) {
    const splitAt = splitMatch.index;
    // Only split when the PREFIX is majority of the prompt (>60%)
    if (splitAt / systemPrompt.length > 0.6) {
      const stable = systemPrompt.slice(0, splitAt);
      const volatile = systemPrompt.slice(splitAt);
      return {
        content: systemPrompt,
        blocks: [
          {
            type: "text",
            text: stable,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: volatile },
        ],
      };
    }
  }

  // No good split point — cache the whole thing
  return {
    content: systemPrompt,
    blocks: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
  };
}

// ── Warmup planner ───────────────────────────────────

/**
 * Pick the subset of prefixes worth warming. Criteria:
 *   1. tokens >= minTokens (below this, caching overhead > benefit)
 *   2. Sorted by expectedUses desc, then tokens desc (heavier = more benefit)
 *   3. Capped at maxPrefixes
 */
export function planWarmup(
  prefixes: readonly CachePrefix[],
  options: WarmupOptions = {},
): {
  readonly toWarm: readonly CachePrefix[];
  readonly skipped: ReadonlyArray<{ readonly prefix: CachePrefix; readonly reason: string }>;
} {
  const minTokens = options.minTokens ?? 1024;
  const maxPrefixes = options.maxPrefixes ?? 4;

  const candidates: CachePrefix[] = [];
  const skipped: Array<{ prefix: CachePrefix; reason: string }> = [];

  for (const prefix of prefixes) {
    const tokens = estimateTokens(prefix.content);
    if (tokens < minTokens) {
      skipped.push({ prefix, reason: `~${tokens} tokens < minTokens ${minTokens}` });
      continue;
    }
    candidates.push(prefix);
  }

  candidates.sort((a, b) => {
    const usesA = a.expectedUses ?? 1;
    const usesB = b.expectedUses ?? 1;
    if (usesA !== usesB) return usesB - usesA;
    return estimateTokens(b.content) - estimateTokens(a.content);
  });

  if (candidates.length > maxPrefixes) {
    for (const over of candidates.slice(maxPrefixes)) {
      skipped.push({ prefix: over, reason: `over maxPrefixes=${maxPrefixes} cap` });
    }
  }

  return {
    toWarm: candidates.slice(0, maxPrefixes),
    skipped,
  };
}

// ── Runner ─────────────────────────────────────────────

export interface CacheWarmupSendFn {
  /**
   * Send a warmup query. Return a Promise that resolves when the
   * cache write completes. Caller owns the actual HTTP call; this
   * module just manages batching + concurrency.
   */
  (prefix: CachePrefix): Promise<void>;
}

export async function warmupCache(
  prefixes: readonly CachePrefix[],
  sendFn: CacheWarmupSendFn,
  options: WarmupOptions = {},
): Promise<WarmupResult> {
  const startedAt = Date.now();
  const concurrency = options.concurrency ?? 3;

  const plan = planWarmup(prefixes, options);
  const details: Array<{
    id: string;
    status: "warmed" | "failed" | "skipped-too-small";
    durationMs: number;
  }> = [];

  // Record skipped upfront
  for (const sk of plan.skipped) {
    details.push({ id: sk.prefix.id, status: "skipped-too-small", durationMs: 0 });
  }

  // Bounded-concurrency warmup
  let nextIdx = 0;
  async function worker() {
    while (true) {
      const idx = nextIdx++;
      if (idx >= plan.toWarm.length) return;
      const prefix = plan.toWarm[idx]!;
      const wStart = Date.now();
      try {
        await sendFn(prefix);
        const duration = Date.now() - wStart;
        details.push({ id: prefix.id, status: "warmed", durationMs: duration });
        options.onWarmup?.(prefix.id, duration, true);
      } catch {
        const duration = Date.now() - wStart;
        details.push({ id: prefix.id, status: "failed", durationMs: duration });
        options.onWarmup?.(prefix.id, duration, false);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, plan.toWarm.length) }, () => worker()),
  );

  const warmed = details.filter((d) => d.status === "warmed").length;
  const failed = details.filter((d) => d.status === "failed").length;
  const skipped = details.filter((d) => d.status === "skipped-too-small").length;

  return {
    warmed,
    failed,
    skipped,
    totalMs: Date.now() - startedAt,
    details,
  };
}

// ── Hit tracker ───────────────────────────────────────

/**
 * Track cache hits/misses for telemetry. Callers increment when they
 * see cache_read_input_tokens vs cache_creation_input_tokens in the
 * response.
 */
export class CacheHitTracker {
  private hits = 0;
  private misses = 0;
  private readCount = 0;
  private writeCount = 0;

  recordHit(tokensRead: number = 0): void {
    this.hits++;
    this.readCount += tokensRead;
  }

  recordMiss(tokensWritten: number = 0): void {
    this.misses++;
    this.writeCount += tokensWritten;
  }

  stats(): {
    readonly hits: number;
    readonly misses: number;
    readonly hitRate: number;
    readonly tokensRead: number;
    readonly tokensWritten: number;
    readonly savedTokens: number;
  } {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      tokensRead: this.readCount,
      tokensWritten: this.writeCount,
      savedTokens: this.readCount, // cached reads are ~90% cheaper → near-total savings
    };
  }

  reset(): void {
    this.hits = 0;
    this.misses = 0;
    this.readCount = 0;
    this.writeCount = 0;
  }
}
