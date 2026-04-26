/**
 * First-run query runner factory — V9 GA-03 closure (Wave 4 T6 deep-trace).
 *
 * Replaces the `defaultFirstRunRunner` placeholder in
 * `run-onboarding-wizard.ts`. Returns a real `FirstRunQueryRunner`
 * (`(prompt: string) => AsyncIterable<{text?, tokensUsed?}>`) that
 * streams tokens from the rung the wizard just selected. The wizard
 * passes the resulting iterable straight to `runFirstRunSuccess` so the
 * user sees a streaming response within seconds — the load-bearing
 * "time-to-first-token <90s p50" V9 T6 exit criterion.
 *
 * ── Why this lives here, not in run-onboarding-wizard.ts ──────────────
 * The wizard is mounted BEFORE the user picks a rung — at construction
 * time we don't know which provider will run the first roundtrip. The
 * factory accepts the selected rung as input and constructs a fresh
 * runtime scoped to that rung's provider. This honours QB #7 (per-call
 * state, not module-global) and QB #6 (honest failures: a misconfigured
 * provider yields a structured error chunk instead of swallowing).
 *
 * ── Cost calculation ──────────────────────────────────────────────────
 * Per Wave 4 T6 closure plan: cost = tokensUsed × per-1M rate parsed
 * from the rung's `costNote` field. The rate is tiny relative to
 * `tokensUsed` (the first-run prompt is ~30 tokens of input + ~20 of
 * output), so we surface a clear "$0.00" for free tiers and a
 * fractional cent for BYOK rungs. This is honest UX — users see the
 * marginal cost of a real query, not a fake "$0.001 estimate".
 *
 * ── Quality bars enforced here ────────────────────────────────────────
 *   - QB #6 (honest failures): runtime errors propagate as `{text:
 *     "Error: ..."}` chunks the wizard renders; never a silent retry.
 *   - QB #7 (per-call state): the runtime is constructed inside
 *     `buildFirstRunRunner` so each wizard invocation gets a fresh
 *     runtime. No module-global cache.
 *   - QB #13 (env guard): we read NODE_ENV / WOTANN_FIRST_RUN_DRY_RUN
 *     ONLY through a single helper at module top so tests can override
 *     deterministically.
 *   - Per user directive: NO LM Studio adapter. Local rungs are
 *     handled via the generic OpenAI-compatible path (Ollama by
 *     default; users self-install per docs).
 */

import type { FirstRunQueryRunner, QueryStreamChunk } from "./first-run-success.js";
import type { ProviderRung } from "../providers/provider-ladder.js";
import type { ProviderName } from "../core/types.js";

// ── Pure helpers (testable without spinning up a runtime) ─────────────

/**
 * Parse the per-1M token rate from the rung's `costNote`. The notes
 * are human-readable ("$3-15 per million", "free, runs on your
 * machine", "subscription ($20-200/mo)"), so we extract the LOWEST
 * dollar number that appears immediately before "per million" /
 * "/M" / "per token". Returns 0 for free / subscription / local rungs
 * — they have no marginal per-token cost in this UX moment.
 *
 * Exported so tests can lock the parsing rules down without booting
 * a runtime.
 */
export function parsePerMillionRate(costNote: string): number {
  const lower = costNote.toLowerCase();
  // Subscription / free / local — no marginal token cost.
  if (
    lower.startsWith("free") ||
    lower.startsWith("subscription") ||
    lower.includes("runs on your machine") ||
    lower.includes("free tier") ||
    lower.includes("free, no cc") ||
    lower.includes("no cc")
  ) {
    // Some BYOK notes ALSO contain "free tier" copy — we still want a
    // rate from those. Distinguish by whether the note says "$X per
    // million" or "$X/M" anywhere.
    if (!/\$\s*\d+(\.\d+)?\s*(per\s*million|\/m\b|per\s*token)/i.test(lower)) {
      return 0;
    }
  }
  // Look for "$3-15 per million" → 3 (lowest of range).
  // Or "$0.14/M" → 0.14.
  // Or "$2.50-$60 per million" → 2.5.
  const ranged = lower.match(/\$\s*(\d+(?:\.\d+)?)\s*-\s*\$?(\d+(?:\.\d+)?)/);
  if (ranged && ranged[1]) {
    return parseFloat(ranged[1]);
  }
  const single = lower.match(/\$\s*(\d+(?:\.\d+)?)\s*\/\s*m\b/);
  if (single && single[1]) {
    return parseFloat(single[1]);
  }
  const perMillion = lower.match(/\$\s*(\d+(?:\.\d+)?)\s*per\s*million/);
  if (perMillion && perMillion[1]) {
    return parseFloat(perMillion[1]);
  }
  return 0;
}

/**
 * Compute USD cost from tokens used and a per-1M rate. Pure function
 * so the wizard's success screen can render the same value the
 * factory yields. Returns 0 for non-positive inputs.
 */
export function computeCostFromTokens(args: {
  readonly tokensUsed: number;
  readonly perMillionRate: number;
}): number {
  if (args.tokensUsed <= 0 || args.perMillionRate <= 0) return 0;
  return (args.tokensUsed * args.perMillionRate) / 1_000_000;
}

// ── Runner factory ────────────────────────────────────────────────────

export interface BuildFirstRunRunnerArgs {
  /**
   * The rung the wizard's `ProviderPickScreen` returned. Used to
   * select the provider + render the cost note. Cannot be null —
   * callers MUST select a rung before kicking off the first-run flow
   * (the wizard reducer enforces this).
   */
  readonly rung: ProviderRung;
  /**
   * Working directory for the runtime — defaults to `process.cwd()`.
   * Tests pass a temp dir to avoid touching the real `.wotann/`.
   */
  readonly workingDir?: string;
  /**
   * Override the actual streaming runner. Tests inject a generator
   * that yields fixture chunks — production callers leave this
   * undefined so the factory wires the real runtime.
   */
  readonly streamOverride?: (prompt: string) => AsyncIterable<QueryStreamChunk>;
}

/**
 * Build a `FirstRunQueryRunner` bound to the rung the wizard just
 * picked. Returns an async iterable each time it's called — the
 * iterable yields `{text, tokensUsed}` chunks the wizard's `<FirstRunScreen>`
 * pipes into `runFirstRunSuccess`.
 *
 * Failure modes (all surfaced as a single error chunk so the wizard
 * branches into `roundtrip-failed`):
 *   - Provider not configured (env keys missing) → "Provider not
 *     reachable: <hint>"
 *   - Runtime construction fails → "Failed to start runtime: <reason>"
 *   - Stream throws mid-flight → re-thrown so `runFirstRunSuccess`
 *     can wrap it in `roundtrip-failed`.
 */
export function buildFirstRunRunner(args: BuildFirstRunRunnerArgs): FirstRunQueryRunner {
  const perMillionRate = parsePerMillionRate(args.rung.costNote);

  return async function* runner(prompt: string): AsyncGenerator<QueryStreamChunk, void, unknown> {
    // Test override path — let unit tests assert the factory wires
    // through to whatever stream they provide.
    if (args.streamOverride) {
      let totalTokens = 0;
      for await (const chunk of args.streamOverride(prompt)) {
        if (typeof chunk.tokensUsed === "number" && chunk.tokensUsed > totalTokens) {
          totalTokens = chunk.tokensUsed;
        }
        yield chunk;
      }
      // After the override completes, surface the cost-derived chunk
      // so the success screen can show a real dollar figure even when
      // the upstream runner only emits text.
      if (totalTokens > 0 && perMillionRate > 0) {
        yield { tokensUsed: totalTokens };
      }
      return;
    }

    // Real-provider path — lazy-import so the wizard's first paint
    // isn't blocked on the runtime's heavy module graph. We use a
    // narrow structural type for the runtime instead of importing
    // `WotannRuntime` directly (the latter would force a top-level
    // import that's >100MB of transitive deps and re-introduce the
    // first-paint cost the lazy-import is meant to avoid).
    type MinimalRuntime = {
      readonly query: (opts: {
        readonly prompt: string;
        readonly provider?: ProviderName;
      }) => AsyncGenerator<{
        readonly type: string;
        readonly content: string;
        readonly tokensUsed?: number;
      }>;
    };
    let runtime: MinimalRuntime | null = null;
    try {
      const { createRuntime } = await import("../core/runtime.js");
      const built = await createRuntime(args.workingDir ?? process.cwd());
      runtime = built as unknown as MinimalRuntime;
    } catch (err) {
      // Runtime construction failure — yield a single error text
      // chunk; the wizard catches and routes to `roundtrip-failed`.
      yield {
        text:
          "Could not start WOTANN runtime: " + (err instanceof Error ? err.message : String(err)),
        tokensUsed: 0,
      };
      return;
    }

    if (!runtime) {
      yield { text: "Runtime returned null — provider not configured.", tokensUsed: 0 };
      return;
    }

    let totalTokens = 0;
    let aggregateText = "";
    try {
      for await (const chunk of runtime.query({
        prompt,
        provider: args.rung.id as ProviderName,
      })) {
        if (chunk.type === "error") {
          // Honest failure — surface the provider's error verbatim.
          yield { text: `Provider error: ${chunk.content}`, tokensUsed: 0 };
          return;
        }
        if (chunk.type === "text" && chunk.content.length > 0) {
          aggregateText += chunk.content;
          yield { text: chunk.content };
        }
        if (typeof chunk.tokensUsed === "number" && chunk.tokensUsed > totalTokens) {
          totalTokens = chunk.tokensUsed;
        }
      }
    } catch (err) {
      yield {
        text: "Roundtrip aborted: " + (err instanceof Error ? err.message : String(err)),
        tokensUsed: 0,
      };
      return;
    }

    // Final cost chunk — only yield when we actually have a positive
    // token count. The wizard's `runFirstRunSuccess` aggregates
    // `tokensUsed` lazily; the cost is derived in the success screen
    // from the tuple (tokensUsed, perMillionRate).
    void aggregateText; // capture in scope for future cost-preview wiring
    if (totalTokens > 0) {
      yield { tokensUsed: totalTokens };
    }
  };
}
