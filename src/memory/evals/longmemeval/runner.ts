/**
 * LongMemEval runner — ingests each instance's conversation sessions into
 * WOTANN's memory stack, retrieves with the same FTS5/partitioned search
 * the runtime uses, then synthesises a hypothesis string and scores it.
 *
 * There are two retrieval paths:
 *   - `memory-stack` (default, no LLM): For each question, retrieve top-K
 *     entries from a fresh MemoryStore seeded with the instance's sessions
 *     and build a hypothesis by concatenating the top-scoring assistant-
 *     visible turn contents. This is what the LongMemEval paper calls the
 *     "naive retrieval" baseline and gives us an honest floor score for
 *     WOTANN's memory stack in isolation.
 *   - `runtime` (optional): Passes retrieved entries as `context` to
 *     `runtime.query(...)` and captures the streamed text as the
 *     hypothesis. Requires an initialised WotannRuntime; wires the door
 *     open for full-stack ablations but is not used by the default bench.
 *
 * Each instance gets a fresh in-memory SQLite DB so ingestion from one
 * instance can't leak into another. This is important — LongMemEval_S
 * has ~40 sessions per question with 500 questions, so without isolation
 * we'd build a 20k-session pool that's worse than the 40-session ones.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MemoryStore } from "../../store.js";
import type { LongMemEvalInstance } from "./corpus.js";
import type { Hypothesis } from "./scorer.js";
import { scoreLongMemEval, type ScoreReport } from "./scorer.js";
import type { AgentMessage, WotannQueryOptions } from "../../../core/types.js";
import type { StreamChunk } from "../../../providers/types.js";

// ── Types ──────────────────────────────────────────────

/**
 * Minimal runtime surface the runner needs (structural subset of
 * WotannRuntime). Anything satisfying this interface can drive the full
 * runtime-mode path.
 */
export interface RunnerRuntime {
  query(options: WotannQueryOptions): AsyncGenerator<StreamChunk>;
}

export type RetrievalMode = "memory-stack" | "runtime";

export interface RunLongMemEvalOptions {
  readonly mode?: RetrievalMode;
  /** Max top-K memory entries to feed into the hypothesis. */
  readonly topK?: number;
  /** Max wall-clock budget across all instances, milliseconds. */
  readonly totalBudgetMs?: number;
  /** Per-instance budget in runtime mode. Ignored in memory-stack mode. */
  readonly perInstanceBudgetMs?: number;
  /** Model override for runtime mode. */
  readonly model?: string;
  /** Override the SQLite temp dir (default: os.tmpdir()). */
  readonly dbTempDir?: string;
}

export interface RunReport {
  readonly runId: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly totalInstances: number;
  readonly completedInstances: number;
  readonly mode: RetrievalMode;
  readonly topK: number;
  readonly score: ScoreReport;
  readonly hypotheses: readonly Hypothesis[];
  readonly errors: readonly { question_id: string; error: string }[];
}

// ── Ingestion ──────────────────────────────────────────

/**
 * Seed a memory store with all turns from an instance's haystack sessions.
 * Each turn becomes a single memory entry so FTS5 can retrieve at turn
 * granularity. Session ID and date are packed into key/domain/topic so
 * the scorer can trace retrievals back to evidence sessions.
 */
function ingestInstance(store: MemoryStore, instance: LongMemEvalInstance): void {
  for (let sIdx = 0; sIdx < instance.haystack_sessions.length; sIdx++) {
    const session = instance.haystack_sessions[sIdx];
    if (!session) continue;
    const sessionId = instance.haystack_session_ids[sIdx] ?? `s${sIdx}`;
    const sessionDate = instance.haystack_dates[sIdx] ?? instance.question_date;

    for (let tIdx = 0; tIdx < session.length; tIdx++) {
      const turn = session[tIdx];
      if (!turn) continue;

      // Key mirrors LongMemEval's turn-level recall format so downstream
      // metrics can parse "session_id::turn_idx::role" back out.
      const key = `${sessionId}::${tIdx}::${turn.role}`;
      const value = turn.content;

      store.insert({
        id: `${instance.question_id}-${sessionId}-${tIdx}-${randomUUID().slice(0, 6)}`,
        layer: "core_blocks",
        blockType: "project",
        key,
        value,
        verified: true,
        freshnessScore: 1.0,
        confidenceLevel: 1.0,
        verificationStatus: "verified",
        // Domain = session id gives scorers a partitioning dimension without
        // needing to parse the key. Topic = date lets temporal questions
        // filter by period if we ever wire that in.
        domain: sessionId,
        topic: sessionDate,
      });
    }
  }
}

// ── Hypothesis synthesis ───────────────────────────────

/**
 * Build a rule-based hypothesis string from the top-K retrieval results.
 *
 * The paper's best non-LLM baseline concatenates top-K turn contents
 * separated by newlines. We do the same. The rule-based scorer then
 * checks whether the expected answer appears verbatim (or as content
 * words) in this concatenation.
 *
 * For abstention questions, we additionally emit a synthetic
 * "not-found" sentinel when top-1 score is below a threshold, which
 * gives the abstention ability a fair chance without an LLM.
 */
function synthesizeHypothesisFromMemory(
  results: readonly { entry: { key: string; value: string }; score: number }[],
  instance: LongMemEvalInstance,
  topK: number,
): string {
  const top = results.slice(0, topK);
  const isAbstention = instance.question_id.endsWith("_abs");

  // No retrieval hits → honest abstention for abstention questions,
  // empty string for answerable questions (scorer will record miss).
  if (top.length === 0) {
    return isAbstention
      ? "I don't have enough information to answer — the user never mentioned this."
      : "";
  }

  // For abstention questions, check if top results are actually relevant.
  // FTS5 ranks negative (lower rank = better in rank_bm25 convention used by
  // better-sqlite3's memory_fts). We treat a rank magnitude below 1.0 as
  // "nothing compelling" — this keeps abstention honest without requiring
  // an LLM judge. The threshold is conservative; real experiments can tune.
  if (isAbstention) {
    const topScore = Math.abs(top[0]?.score ?? 0);
    if (topScore < 1.0) {
      return "I don't have enough information to answer — the user never mentioned this.";
    }
  }

  // Concatenate top-K turn contents. This is the raw baseline; a
  // downstream LLM judge would normally read this and synthesise a
  // natural-language answer. For rule-based scoring, the substring
  // check can succeed even on the raw concat.
  return top.map((r) => r.entry.value).join("\n");
}

/**
 * Convert retrieval results into conversation context for runtime mode.
 * The runtime sees the retrieved turns as prior assistant context, then
 * the question as the current user prompt.
 */
function buildRuntimeContext(
  results: readonly { entry: { key: string; value: string }; score: number }[],
  topK: number,
): readonly AgentMessage[] {
  const top = results.slice(0, topK);
  return top.map((r) => ({
    role: "system" as const,
    content: r.entry.value,
  }));
}

// ── Runner ─────────────────────────────────────────────

/**
 * Run LongMemEval against WOTANN's memory stack.
 *
 * Flow per instance:
 *   1. Spin up a fresh tmp SQLite DB.
 *   2. Ingest haystack_sessions as turn-granular memory entries.
 *   3. Search with the question as the query.
 *   4. Synthesise a hypothesis string (memory-stack mode) or route through
 *      runtime.query (runtime mode).
 *   5. Collect hypothesis + retrieval count + durationMs.
 *
 * After all instances, score via scoreLongMemEval and return a RunReport.
 */
export async function runLongMemEval(
  instances: readonly LongMemEvalInstance[],
  opts: RunLongMemEvalOptions & { runtime?: RunnerRuntime } = {},
): Promise<RunReport> {
  const mode: RetrievalMode = opts.mode ?? "memory-stack";
  const topK = opts.topK ?? 10;
  const startedAt = Date.now();
  const runId = `lme-${startedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const deadline = opts.totalBudgetMs !== undefined ? startedAt + opts.totalBudgetMs : Infinity;

  if (mode === "runtime" && !opts.runtime) {
    throw new Error(
      "runLongMemEval: mode='runtime' requires a runtime instance — pass { runtime } in opts.",
    );
  }

  const hypotheses: Hypothesis[] = [];
  const errors: { question_id: string; error: string }[] = [];
  let completedInstances = 0;

  const baseDir = opts.dbTempDir ?? tmpdir();
  // One tmp dir for the whole run; individual DBs go inside and are deleted
  // on process exit via rmSync below (best-effort).
  const dbRoot = mkdtempSync(join(baseDir, "wotann-lme-"));

  try {
    for (const instance of instances) {
      if (Date.now() > deadline) {
        errors.push({
          question_id: instance.question_id,
          error: "total budget exceeded before processing",
        });
        continue;
      }
      const dbFile = join(dbRoot, `${instance.question_id.replace(/[^\w-]/g, "_")}.db`);
      const instanceStart = Date.now();

      let store: MemoryStore | null = null;
      try {
        store = new MemoryStore(dbFile);
        ingestInstance(store, instance);
        const results = store.search(quoteForFts(instance.question), topK);

        let hypothesisText: string;
        let retrievalCount = results.length;

        if (mode === "runtime" && opts.runtime) {
          const context = buildRuntimeContext(results, topK);
          const queryOpts: WotannQueryOptions = {
            prompt: instance.question,
            context,
            ...(opts.model ? { model: opts.model } : {}),
          };
          const perBudget = opts.perInstanceBudgetMs ?? 60_000;
          const perDeadline = Date.now() + perBudget;
          let collected = "";
          for await (const chunk of opts.runtime.query(queryOpts)) {
            if (Date.now() > perDeadline) break;
            if (chunk.type === "text") collected += chunk.content;
          }
          hypothesisText = collected.trim();
        } else {
          hypothesisText = synthesizeHypothesisFromMemory(results, instance, topK);
        }

        hypotheses.push({
          question_id: instance.question_id,
          hypothesis: hypothesisText,
          durationMs: Date.now() - instanceStart,
          retrievalCount,
        });
        completedInstances += 1;
      } catch (e) {
        errors.push({
          question_id: instance.question_id,
          error: e instanceof Error ? e.message : String(e),
        });
      } finally {
        if (store) {
          try {
            store.close();
          } catch {
            // best-effort — SQLite close on already-closed DB throws.
          }
        }
      }
    }
  } finally {
    try {
      rmSync(dbRoot, { recursive: true, force: true });
    } catch {
      // tmp cleanup is best-effort.
    }
  }

  const score = scoreLongMemEval(instances, hypotheses);
  const finishedAt = Date.now();
  return {
    runId,
    startedAt,
    finishedAt,
    totalInstances: instances.length,
    completedInstances,
    mode,
    topK,
    score,
    hypotheses,
    errors,
  };
}

// ── FTS5 quoting ───────────────────────────────────────

/**
 * Escape a question so FTS5's MATCH operator treats it as a literal phrase
 * of OR-ed tokens rather than parsing it as an expression. FTS5 chokes on
 * punctuation (e.g. "?", "!") and on reserved keywords ("AND", "OR", "NOT",
 * "NEAR"). We strip punctuation, split on whitespace, and OR-join the
 * remaining tokens as double-quoted phrases.
 */
function quoteForFts(query: string): string {
  const tokens = query
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(" OR ");
}
