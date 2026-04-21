/**
 * System-prompt cache-stability utilities.
 *
 * MASTER_PLAN_V8 §5 P1-B8 — KV-cache-stable timestamps.
 *
 * Providers (Anthropic ephemeral prefix cache + OpenAI's 512-token
 * prefix cache) only hit when the leading portion of the prompt is
 * byte-identical across turns. If the stable prefix contains a
 * wall-clock timestamp like `2026-04-20T15:32:45.812Z`, every turn
 * invalidates the cache — even when nothing else changed.
 *
 * THE FIX: any timestamp that lands in the stable prefix is rendered
 * at DATE-ONLY granularity (`YYYY-MM-DD`). The full ISO timestamp is
 * still allowed in the DYNAMIC suffix — that portion of the prompt
 * is not cached anyway.
 *
 * Target: 40–90% provider-side prompt-cache hit rate across turns
 * within a single session, measured by `input_tokens_cache_read` on
 * Anthropic / `cached_tokens` on OpenAI.
 *
 * See `docs/internal/RESEARCH_TERMINALBENCH_HARNESSES_DEEP.md` §5
 * ("KV-Cache Stability — The Hidden Cost Lever") for the source
 * research: "Remove second-precision timestamps from system prompts;
 * use date-level only. 10x cost differential."
 *
 * Quality bars applied:
 *   - QB #6 (honest failure): invalid Date input → UTC epoch date,
 *     never throws. A broken clock must not crash the prompt path.
 *   - QB #11 (one source of truth): this module owns the cache-safe
 *     date format. Callers never hand-roll `YYYY-MM-DD` slicing —
 *     that's how drift creeps back in.
 *   - QB #13 (grep-verifiable): the ISO-timestamp regex below
 *     matches the exact pattern `toISOString()` emits, so
 *     `stripIsoTimestampsFromPrompt` is provably exhaustive for
 *     Node Date output.
 *   - QB #14 (verify existing): this module does NOT touch
 *     bootstrap-snapshot's raw capture — `BootstrapSnapshot.capturedAt`
 *     stays a full Date because the snapshot is also persisted to
 *     the WAL / log where full precision matters. Only the PROMPT
 *     rendering is date-sliced.
 */

// ── Regex / Constants ──────────────────────────────────────

/**
 * Matches a full ISO-8601 timestamp as emitted by `Date.prototype.toISOString()`:
 *   `2026-04-20T15:32:45.812Z`
 *
 * Strict form: YYYY-MM-DDTHH:MM:SS(.ms)?Z — the `T`, the time, the
 * optional millisecond fraction, and the literal `Z` for UTC.
 *
 * Not anchored to line boundaries — the replacer lets us substitute
 * inline within any prompt fragment.
 */
export const ISO_TIMESTAMP_REGEX = /\b(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z\b/g;

/**
 * Fallback used when a caller hands us an invalid Date. Using the UTC
 * epoch day keeps the prefix deterministic (important for the cache
 * key) even when the source clock is busted.
 */
const EPOCH_FALLBACK = "1970-01-01";

// ── Public API ─────────────────────────────────────────────

/**
 * Render a Date at cache-safe granularity (`YYYY-MM-DD`, UTC).
 *
 * Use this for any timestamp that lands in the STABLE PREFIX of the
 * system prompt. Providers cache byte-identical prefixes; date-only
 * granularity keeps the cache warm across turns within the same day.
 *
 * DESIGN NOTES:
 *   - UTC is non-negotiable. A local-time format would invalidate the
 *     cache whenever the agent runs in a different timezone (e.g. CI
 *     vs laptop). Two adjacent runs producing different cache keys
 *     defeats the whole point.
 *   - Honest failure: `new Date("not-a-date")` yields an Invalid Date
 *     whose `toISOString()` throws. We catch that and return the epoch
 *     day — the caller still gets a deterministic string.
 *
 * @param now — defaults to `new Date()` at call time. Tests inject a
 *   fixed Date for determinism.
 * @returns `YYYY-MM-DD` string (10 chars exact), always.
 */
export function formatCacheSafeDate(now: Date = new Date()): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return EPOCH_FALLBACK;
  }
  try {
    // toISOString always emits `YYYY-MM-DDTHH:MM:SS.sssZ` in UTC.
    // Slice to the first 10 chars = `YYYY-MM-DD`.
    return now.toISOString().slice(0, 10);
  } catch {
    return EPOCH_FALLBACK;
  }
}

/**
 * Sweep an assembled prompt fragment and replace every full ISO
 * timestamp with its date-only prefix. Use this as a final safety net
 * when post-processing emitted prompt sections that may have been
 * rendered by third-party formatters (e.g. `formatSnapshotForPrompt`
 * which lives in src/core/ and pre-dates this utility).
 *
 * This is a REGRESSION-LOCK primitive: even if a future caller
 * forgets to route a timestamp through `formatCacheSafeDate`, the
 * final prompt assembly can run this sweep and the cache key stays
 * stable.
 *
 * Does NOT mutate the input; returns a new string.
 *
 * @param prompt — assembled prompt fragment (may span multiple lines).
 * @returns fragment with every `YYYY-MM-DDTHH:MM:SS.sssZ` collapsed
 *   to `YYYY-MM-DD`.
 */
export function stripIsoTimestampsFromPrompt(prompt: string): string {
  if (prompt.length === 0) return prompt;
  return prompt.replace(ISO_TIMESTAMP_REGEX, (_match, dateOnly: string) => dateOnly);
}

/**
 * Assert a prompt fragment contains no full ISO timestamps. For use
 * in tests that pin cache stability — if this returns a non-empty
 * array, a drift surface has been reintroduced.
 *
 * @returns the list of ISO timestamps found (empty when clean).
 */
export function findIsoTimestampsInPrompt(prompt: string): readonly string[] {
  if (prompt.length === 0) return [];
  return prompt.match(ISO_TIMESTAMP_REGEX) ?? [];
}
