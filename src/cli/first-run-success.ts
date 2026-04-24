/**
 * First-run success screen — V9 Tier 6 T6.6.
 *
 * After the onboarding wizard (T6.2) finishes configuring a provider,
 * the user sees a success screen that does ONE thing and then gets
 * out of the way: kick off a real roundtrip against the new provider
 * so they see a streaming response within seconds. This is the
 * load-bearing "time-to-first-token" moment V9 T6 exit criterion
 * targets (<90s p50 from `wotann init` to streamed output).
 *
 * This module is HEADLESS — it's the logic layer that the TUI calls
 * into. It:
 *   1. Formats the success banner (lines of text + the provider
 *      summary).
 *   2. Runs a best-effort 1-shot query to prove the wire works
 *      end-to-end.
 *   3. Returns structured events the TUI renders (success message
 *      with duration + token count, or a clear "couldn't reach
 *      provider" error the wizard can route through).
 *
 * The actual Ink/React rendering lives elsewhere (T6.2 scope). By
 * splitting the logic into a pure module, the first-run flow can
 * also be exercised by integration tests without spinning up a
 * terminal.
 *
 * WOTANN quality bars:
 *  - QB #6 honest failures: every outcome is a concrete event type
 *    ("success" with metrics OR "roundtrip-failed" with reason) —
 *    never a silent best-effort.
 *  - QB #7 per-call state: no module-level caches; takes the query
 *    runner as a dependency so the caller chooses which runtime /
 *    provider / model to use.
 *  - QB #13 env guard: accepts all inputs as params. No `process.*`
 *    reads.
 */

import type { ProviderRung } from "../providers/provider-ladder.js";

// ── Event types ───────────────────────────────────────────────────────────

/**
 * Progressive events the TUI renders. `banner` fires first (so the
 * success screen paints immediately); `roundtrip-started` →
 * `roundtrip-chunk` → `roundtrip-done` streams the real response;
 * `roundtrip-failed` is the error branch.
 */
export type FirstRunEvent =
  | {
      readonly type: "banner";
      readonly lines: readonly string[];
    }
  | {
      readonly type: "roundtrip-started";
      readonly provider: string;
      readonly model: string;
      readonly prompt: string;
    }
  | {
      readonly type: "roundtrip-chunk";
      readonly text: string;
    }
  | {
      readonly type: "roundtrip-done";
      readonly durationMs: number;
      readonly tokensUsed: number;
      readonly fullText: string;
    }
  | {
      readonly type: "roundtrip-failed";
      readonly reason: string;
      readonly durationMs: number;
    };

/**
 * Streaming chunk the query runner produces. The TUI reads an async
 * iterable; this module wraps each chunk in a `roundtrip-chunk`
 * event + aggregates total text + tokens for the final
 * `roundtrip-done` event.
 */
export interface QueryStreamChunk {
  readonly text?: string;
  readonly tokensUsed?: number;
}

/**
 * Query runner — injected by the caller. The first-run flow uses
 * whatever runner the wizard just configured (runtime.query /
 * bridge.query / etc.) without caring which.
 */
export type FirstRunQueryRunner = (prompt: string) => AsyncIterable<QueryStreamChunk>;

// ── Banner ────────────────────────────────────────────────────────────────

/**
 * Format the success banner lines. Separated from the streaming
 * logic so the TUI can render the header immediately — no "blank
 * screen while we warm up" dead time.
 */
export function buildBanner(args: {
  readonly selectedRung: ProviderRung;
  readonly modelLabel: string;
}): readonly string[] {
  return [
    "╔══════════════════════════════════════════════════════════╗",
    "║                   WOTANN is ready.                       ║",
    "╚══════════════════════════════════════════════════════════╝",
    "",
    `Provider:  ${args.selectedRung.label}`,
    `Cost:      ${args.selectedRung.costNote}`,
    `Model:     ${args.modelLabel}`,
    "",
    "Sending a test prompt to confirm the wire works...",
  ];
}

// ── First prompt ──────────────────────────────────────────────────────────

/**
 * Default prompt for the first-run roundtrip. Chosen to be short
 * (fast first-token), unambiguous (deterministic enough that an
 * empty/malformed response is clearly a bug), and warm (sets the
 * user's expectation that WOTANN is a conversational agent, not a
 * one-shot tool).
 */
export const DEFAULT_FIRST_PROMPT =
  "In one sentence, tell me you're ready to help with coding tasks.";

// ── Roundtrip driver ──────────────────────────────────────────────────────

/**
 * Async generator that drives the first-run success flow. Yields
 * events in order so the TUI renders them with standard `for await`.
 * Callers own the query runner (see `FirstRunQueryRunner`) — the
 * generator is transport-agnostic.
 *
 * Invariants:
 *  - Banner event ALWAYS fires first (even when the query runner
 *    throws immediately — the user sees the success screen).
 *  - On success: banner → roundtrip-started → N×chunks → done.
 *  - On failure: banner → roundtrip-started → failed.
 *  - Total text + token count are aggregated lazily per chunk so a
 *    runner that emits `tokensUsed` on only the final chunk still
 *    produces a meaningful summary.
 */
export async function* runFirstRunSuccess(args: {
  readonly selectedRung: ProviderRung;
  readonly modelLabel: string;
  readonly runner: FirstRunQueryRunner;
  readonly prompt?: string;
  /**
   * Optional clock injection for deterministic tests. Defaults to
   * `Date.now` when omitted.
   */
  readonly now?: () => number;
}): AsyncGenerator<FirstRunEvent, void, undefined> {
  const prompt = args.prompt ?? DEFAULT_FIRST_PROMPT;
  const now = args.now ?? Date.now;

  yield {
    type: "banner",
    lines: buildBanner({
      selectedRung: args.selectedRung,
      modelLabel: args.modelLabel,
    }),
  };

  yield {
    type: "roundtrip-started",
    provider: args.selectedRung.label,
    model: args.modelLabel,
    prompt,
  };

  const start = now();
  let fullText = "";
  let tokensUsed = 0;
  try {
    for await (const chunk of args.runner(prompt)) {
      if (typeof chunk.text === "string" && chunk.text.length > 0) {
        fullText += chunk.text;
        yield { type: "roundtrip-chunk", text: chunk.text };
      }
      if (typeof chunk.tokensUsed === "number" && chunk.tokensUsed > 0) {
        tokensUsed = chunk.tokensUsed; // providers often emit cumulative count on the final chunk
      }
    }
    yield {
      type: "roundtrip-done",
      durationMs: now() - start,
      tokensUsed,
      fullText,
    };
  } catch (err) {
    yield {
      type: "roundtrip-failed",
      reason: err instanceof Error ? err.message : String(err),
      durationMs: now() - start,
    };
  }
}
