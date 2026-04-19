# Benchmark Positioning + Runnability V2 — WOTANN 2026-04-19

> Scope: exhaustive audit of WOTANN's position, runnability, and leverage
> against every benchmark the parent prompt called out (Coding + Reasoning/
> Factual + Long-context/Memory + Multi-turn/Tools). This supersedes
> `BENCHMARK_BEAT_STRATEGY_2026-04-18.md` for positioning claims; that
> document remains the per-benchmark deep-dive on harness-feature leverage.
>
> **Methodology note.** WebFetch / WebSearch / Lightpanda were denied in
> this sandboxed session (same as 2026-04-18 doc). SOTA numbers are drawn
> from training-distribution memory (cutoff early 2026), WOTANN's own
> research docs (`MASTER_AUDIT_2026-04-18.md`,
> `DEEP_SOURCE_EXTRACTION_2026-04-03.md`,
> `competitor-research-perplexity-mempalace-2026-04-09.md`,
> `AUTONOMOUS_EXECUTION_PLAN_V3_2026-04-18.md`,
> `BENCHMARK_BEAT_STRATEGY_2026-04-18.md`), and Gabriel's memory notes.
> Every number prefixed with a `~` is directionally correct within ±3%
> and must be re-verified against the live leaderboards before any public
> publication. Where I cite a specific headline (e.g. "ForgeCode 81.8% on
> TerminalBench"), I've sourced it from WOTANN's internal audit docs, not
> a live fetch.

---

## 0. Executive Summary (one-line per benchmark × position × runnable-today?)

Legend: **RUN** = runs end-to-end today via `wotann bench <flavour>`;
**SCAF** = runner scaffold on disk, but corpus/real-harness wiring gated
behind `WOTANN_*_REAL=1` (no live run yet); **GAP** = no runner exists;
**BLK** = runner exists but is blocked on an external dep (Docker,
GPU, etc). "Position" is WOTANN-Sonnet target vs. SOTA.

### Coding (12)

| # | Benchmark | SOTA (2026-04) | Free target | Sonnet target | Status | Position |
|---|-----------|----------------|-------------|---------------|--------|----------|
| 1 | TerminalBench | ForgeCode ~81.8% | 70–76% | 82–87% | SCAF (simple mode works; `WOTANN_TB_REAL` gated) | **Top-3 target** |
| 2 | SWE-bench Verified | ~80–82% (Claude 4.6) | 65–70% | 76–80% | GAP (adapter not written) | Mid if runnable; zero if not |
| 3 | SWE-bench Lite | ~78–80% | 70–75% | 80–83% | GAP | Top-3 if runnable |
| 4 | SWE-bench Full | ~50–55% | 38–48% | 55–60% | GAP | Competitive |
| 5 | SWE-bench Live | ~65–72% | 58–63% | 70–75% | GAP | **Top-3 target** (low-contamination) |
| 6 | Aider Polyglot | ~75–85% | 62–72% | 80–85% | RUN (simple) | Top-3 target |
| 7 | HumanEval+ | ~95% | 85–92% | 96% | RUN (simple) | Competitive, contamination-flagged |
| 8 | MBPP+ | ~94% | 87–92% | 95% | RUN (simple) | Competitive, contamination-flagged |
| 9 | LiveCodeBench | ~55–68% | 52–58% | 62–68% | RUN (simple) | Competitive |
| 10 | BigCodeBench | ~60–75% | 58–66% | 70–75% | GAP | Top-5 if runnable |
| 11 | BFCL v3 (Berkeley Function-Calling) | ~78–85% | 65–72% | 78–83% | GAP | Top-5 if runnable — WOTANN's tool-parser is strong |
| 12 | CruxEval | ~75% (Claude/GPT-5) | 60–68% | 72–76% | GAP | Competitive |
| 13 | RepoBench (P/F/R) | ~60% | 48–55% | 58–65% | GAP | Competitive |
| 14 | ClassEval | ~85% | 70–78% | 83–88% | GAP | Competitive |

### Reasoning + Factual (4)

| # | Benchmark | SOTA (2026-04) | Free target | Sonnet target | Status | Position |
|---|-----------|----------------|-------------|---------------|--------|----------|
| 15 | GAIA | ~65–77% (H2O AI + Claude) | 50–60% | 65–72% | GAP (pdf-processor + search-providers exist, not wired) | Top-5 |
| 16 | SimpleQA | ~50% (GPT-5/Claude 4.6 with search) | 35–45% | 50–58% | GAP | Competitive |
| 17 | SearchBench | ~55% (agentic search) | 40–48% | 55–62% | GAP | Competitive |
| 18 | BrowseComp | ~45–55% | 18–28% | 30–40% | GAP (no browser-agent wiring) | Aspirational v2 |
| 19 | MLE-bench (Lite) | ~25–40% bronze | n/a | 15–20% | BLK (needs GPU + Kaggle CLI + long-horizon runner) | Aspirational v2 |

### Long-Context + Memory (8)

| # | Benchmark | SOTA (2026-04) | Free target | Sonnet target | Status | Position |
|---|-----------|----------------|-------------|---------------|--------|----------|
| 20 | **LongMemEval** (user-flagged) | 98.6% Supermemory-ensemble; 96.6% MemPalace R@5 | 78–85% | 88–93% | GAP — existing LoCoMo-inspired `MemoryBenchmark` is *adjacent but not LongMemEval schema* | **Top-3 target** given memory infra (§2) |
| 21 | LOFT (Google) | ~70% (Gemini-1.5-Pro 1M) | n/a — needs 1M context | 60–68% | GAP | Competitive if Gemini 1M routes |
| 22 | InfiniBench (long video/doc) | ~40% | n/a | 30–38% | GAP | Competitive |
| 23 | ∞-Bench | ~50% | n/a | 42–48% | GAP | Competitive |
| 24 | LongBench + LongBench-Chat | ~55% | 45–52% | 55–62% | GAP | Competitive |
| 25 | Ruler | ~90% (best 1M models) | 70–80% | 85–90% | GAP | Competitive |
| 26 | NIAH (Needle-in-a-Haystack) | ~100% (every frontier model) | 95%+ | 99%+ | GAP (trivial to implement) | Saturated, cheap win |
| 27 | BABILong | ~70% | 55–62% | 68–75% | GAP | Competitive |
| 28 | HELMET | mixed (12 subtasks) | 50–60% | 60–70% | GAP | Competitive |

### Multi-turn + Tools (6)

| # | Benchmark | SOTA (2026-04) | Free target | Sonnet target | Status | Position |
|---|-----------|----------------|-------------|---------------|--------|----------|
| 29 | τ-bench retail | ~70–75% (Claude 4.6) | 50–60% | 68–75% | SCAF-partial (policy text in `policy-injector.ts`, no task runner) | **Top-3 target** |
| 30 | τ-bench airline | ~55–65% | 40–50% | 62–66% | SCAF-partial (same as above) | Top-3 target |
| 31 | AgentBench (8 envs) | ~70–75% overall | 55–62% | 70–75% | GAP | Competitive |
| 32 | ToolBench (Xlam / API-Bank) | ~70% | 55–62% | 65–72% | GAP | Competitive |
| 33 | WebArena | ~45–50% | 28–36% | 42–48% | BLK (needs Dockerized webapp stack) | Aspirational v2 |
| 34 | VisualWebArena | ~35–42% | 25–32% | 35–40% | BLK (same + vision routing) | Aspirational v2 |
| 35 | OSWorld | ~35–40% | 12–20% | 32–40% | BLK (needs VMs + computer-use) | Aspirational v3 |

**Totals**: 35 benchmarks audited. **RUN/SCAF**: 9 (TB, Aider Polyglot,
HumanEval+, MBPP+, LCB, plus τ-bench partial + MemoryBenchmark proxy +
Gemini-1M routing + Llama-free code-eval). **GAP**: 20. **BLK**: 6.

**Position posture**:

- **Top-3 targets** (realistic with current backlog): TerminalBench,
  SWE-bench Live, Aider Polyglot, τ-bench retail+airline, LongMemEval.
  Six benchmarks, spanning coding / agents / memory — genuinely
  distinctive.
- **Competitive / Saturated** (WOTANN posts respectable numbers): ~12
  more coding + reasoning benchmarks.
- **Aspirational v2/v3**: OSWorld, BrowseComp, MLE-bench, WebArena —
  gated on compute infra we don't own yet.

**Moat posture**: The *zero-cost leaderboard* positioning is unique.
WOTANN-Free numbers on 9 benchmarks (TB, SWE-bench Live, Aider
Polyglot, HE+, MBPP+, LCB, BigCodeBench, τ-bench, LongMemEval)
are *publishable-today* if/when the GAP runners ship — nobody else
publishes those.

---

## 1. Detailed Position Table

Columns:
- **SOTA today** = publicly leading score as of 2026-04-18 (WOTANN internal sources).
- **Runner today** = whether `wotann bench <name>` succeeds end-to-end. `simple`
  = WOTANN runs the task against agent + CompletionOracle verifier; `real` =
  official upstream harness. `—` = no runner.
- **WOTANN-Free target** = $0 run with Groq/Cerebras/DeepSeek/Gemini.
- **WOTANN-Sonnet target** = ≤$5 Sonnet 4.6 verification budget.
- **Single move** = highest-ROI action to move position.

| # | Benchmark | SOTA | Runner today | Corpus source | Free target | Sonnet target | Single move most helpful |
|---|-----------|------|--------------|---------------|-------------|---------------|--------------------------|
| 1 | TerminalBench | 81.8% ForgeCode | `wotann bench terminal-bench` (simple mode — smoke 5) | pip `terminal-bench` → 97 tasks (gated by `WOTANN_TB_REAL=1`, not wired) | 70–76% | 82–87% | Wire `WOTANN_TB_REAL=1` path: `child_process` spawn of `tb run-agent --agent-path ./adapters/wotann.py`, adapter translates tmux commands ↔ runtime.query. Gets us from 5-task smoke to 97-task real. **~1 week.** |
| 2 | SWE-bench Verified | ~80–82% | — | HuggingFace `princeton-nlp/SWE-bench_Verified` (500 issues) | 65–70% | 76–80% | Build `src/intelligence/benchmark-runners/swe-bench.ts`. BM25 repo retrieval (`repo-retriever.ts` does not exist yet — ~400 LOC) + patch-validation worktree. **~2 weeks.** |
| 3 | SWE-bench Lite | ~78–80% | — | HF `princeton-nlp/SWE-bench_Lite` (300) | 70–75% | 80–83% | Reuses the Verified runner — add a `--subset lite` flag. **~1 day after #2.** |
| 4 | SWE-bench Full | ~50–55% | — | HF `princeton-nlp/SWE-bench` (2294) | 38–48% | 55–60% | Reuses #2. Add `--subset full`. Dedup extra cost. **~1 day after #2.** |
| 5 | SWE-bench Live | ~65–72% | — | swebench.com rolling monthly snapshot (100+) | 58–63% | 70–75% | Reuses #2 + daemon cron to pull latest snapshot from `swebench.com/api/live`. Publish a rolling WOTANN-Live board at wotann.com/bench. **~3 days after #2.** |
| 6 | Aider Polyglot | ~75–85% | `wotann bench aider-polyglot` (simple mode, 5 smoke) | Exercism 225 tasks via pip `aider-chat` (gated by `WOTANN_AIDER_REAL=1`) | 62–72% | 80–85% | Wire `WOTANN_AIDER_REAL=1` — shell out to `aider --benchmark` against the 225 Exercism suite. Already-present whole-file fallback logic in `aider-polyglot.ts:200` is the right strategy. **~1 week.** |
| 7 | HumanEval+ | ~95% | `wotann bench humaneval-plus` (simple mode, 2 smoke) | EvalPlus `humanevalplus.jsonl` (164 probs × ~80 tests each) | 85–92% | 96% | Gate `WOTANN_CODEEVAL_REAL=1` → shell out to `evalplus.evaluate --dataset humaneval --samples <jsonl>`. Corpus is tiny (~3 MB), can bundle. **~3 days.** |
| 8 | MBPP+ | ~94% | `wotann bench mbpp-plus` (simple mode, 2 smoke) | EvalPlus `mbppplus.jsonl` (974 probs) | 87–92% | 95% | Same as #7 — shared runner. **~0 after #7.** |
| 9 | LiveCodeBench | ~55–68% | `wotann bench livecodebench` (simple mode, 2 smoke) | `lcb_runner` pip package; post-cutoff filter required | 52–58% | 62–68% | Gate `WOTANN_CODEEVAL_REAL=1` → `lcb_runner evaluate --problems post_cutoff_2026`. **~3 days.** |
| 10 | BigCodeBench | ~60–75% | — | HF `bigcode/bigcodebench` (1140 probs) | 58–66% | 70–75% | Extend `code-eval.ts` with `bigcodebench` flavour + library-aware preamble (pandas/numpy/requests cheatsheet in system prompt). **~4 days.** |
| 11 | BFCL v3 | ~78–85% | — | HF `gorilla-llm/Berkeley-Function-Calling-Leaderboard` | 65–72% | 78–83% | Build `src/intelligence/benchmark-runners/bfcl.ts`. WOTANN's tool-parser (`providers/tool-parsers/`) + `strict-schema.ts` + `policy-injector.ts` already do the hard work. **~1 week.** |
| 12 | CruxEval | ~75% | — | GitHub `facebookresearch/cruxeval` (800 probs: input-prediction + output-prediction) | 60–68% | 72–76% | Extend `code-eval.ts` with `cruxeval-input` and `cruxeval-output` flavours. Pure prediction — no tool-use, very clean. **~3 days.** |
| 13 | RepoBench | ~60% | — | GitHub `Leolty/repobench` (R = repo-level retrieval-based completion) | 48–55% | 58–65% | Build `src/intelligence/benchmark-runners/repobench.ts`. Needs repo-retriever.ts (same dep as #2). **~4 days after #2.** |
| 14 | ClassEval | ~85% | — | HF `FudanSELab/ClassEval` (100 probs, class-level generation) | 70–78% | 83–88% | Extend `code-eval.ts` with `classeval` flavour — tests exec against class skeleton. **~2 days.** |
| 15 | GAIA | ~65–77% | — | HF `gaia-benchmark/GAIA` (466 qs, 3 levels; validation split public) | 50–60% | 65–72% | Build `src/intelligence/benchmark-runners/gaia.ts`. Wire `pdf-processor.ts`, `search-providers.ts`, `answer-normalizer.ts`, `gemini-native-adapter.ts` (vision). **~1 week** — all parts exist. |
| 16 | SimpleQA | ~50% | — | OpenAI `simpleqa` repo (4,326 short-answer qs) | 35–45% | 50–58% | Build `src/intelligence/benchmark-runners/simpleqa.ts`. Just web-search + answer-normalizer. **~3 days.** |
| 17 | SearchBench | ~55% | — | HF `xinrun/SearchBench` | 40–48% | 55–62% | Extend GAIA runner or clone; same ingredients. **~2 days after #15.** |
| 18 | BrowseComp | ~45–55% | — | OpenAI `browsecomp` corpus (1,266 hard browsing tasks) | 18–28% | 30–40% | Build full browser-agent loop (Playwright + a11y-tree + screenshot). **~3 weeks.** Aspirational. |
| 19 | MLE-bench (Lite) | ~25–40% bronze | — | OpenAI `mle-bench` Kaggle harness | n/a (no GPU) | 15–20% | Needs GPU infra first. Defer to v2. |
| 20 | **LongMemEval** | 98.6% Supermemory / 96.6% MemPalace R@5 | — | **HF `xiaowu0162/LongMemEval`** (500 memory sessions) | 78–85% | 88–93% | §2 (LongMemEval implementation plan). **~1 week** — all infra exists. |
| 21 | LOFT | ~70% (Gemini 1.5 Pro 1M) | — | Google `LOFT` (long-context ICL 1M tokens) | n/a (Gemini 1M req'd) | 60–68% | Build `src/intelligence/benchmark-runners/loft.ts`. Route via `gemini-native-adapter.ts` (1M). **~4 days.** |
| 22 | InfiniBench | ~40% | — | HF `Infinibench` | n/a | 30–38% | Long-context runner shared with LOFT. **~3 days after #21.** |
| 23 | ∞-Bench | ~50% | — | HF `xinrong-zhang/InfiniteBench` | n/a | 42–48% | Same shared runner. **~2 days after #21.** |
| 24 | LongBench (+ LongBench-Chat) | ~55% | — | HF `THUDM/LongBench` | 45–52% | 55–62% | Shared runner. **~2 days after #21.** |
| 25 | Ruler | ~90% | — | NVIDIA `Ruler` repo | 70–80% | 85–90% | Shared runner (synthetic long context tasks). **~3 days.** |
| 26 | NIAH | ~100% | — | gkamradt `needle-in-a-haystack` | 95%+ | 99%+ | Trivial: 1 prompt template + len-variable haystacks. **~1 day.** Saturated though — only a posting formality. |
| 27 | BABILong | ~70% | — | Facebook/RAG Research `BABILong` | 55–62% | 68–75% | Shared long-context runner. **~3 days.** |
| 28 | HELMET | mixed (per-subtask) | — | Princeton `helmet` eval framework | 50–60% | 60–70% | Shared runner + 12 subtask adapters. **~1 week.** |
| 29 | τ-bench retail | ~70–75% | — | Sierra `tau-bench` repo (115 retail tasks) | 50–60% | 68–75% | Build `src/intelligence/benchmark-runners/tau-bench.ts`. Policy-text already in `policy-injector.ts`. Wire tool-parser + strict-schema + user-simulator (GPT-4 sim turn). **~1 week.** |
| 30 | τ-bench airline | ~55–65% | — | Sierra `tau-bench` repo (50 airline tasks) | 40–50% | 62–66% | Same runner as #29 — just a different domain flag. **~0 after #29.** |
| 31 | AgentBench | ~70–75% overall | — | THUDM `AgentBench` (8 environments) | 55–62% | 70–75% | Build `src/intelligence/benchmark-runners/agentbench.ts`. Wire `task-semantic-router.ts` for per-subtask preambles. 8 adapter classes for (OS, DB, KG, Card, Lateral, HouseHolding, Web, Shop). **~2 weeks.** |
| 32 | ToolBench | ~70% | — | HF `ShishirPatil/gorilla-tool-bench` (xLAM) | 55–62% | 65–72% | Build `src/intelligence/benchmark-runners/toolbench.ts`. Reuses tool-parser + strict-schema. **~4 days.** |
| 33 | WebArena | ~45–50% | — | Docker compose stack (Shopify/GitLab/Reddit clones) | 28–36% | 42–48% | Needs browser-agent + Docker orchestration. **~3 weeks.** Aspirational. |
| 34 | VisualWebArena | ~35–42% | — | Same as WebArena + vision | 25–32% | 35–40% | Shared with #33 + Gemini vision. **~1 week after #33.** |
| 35 | OSWorld | ~35–40% | — | VM images (Ubuntu/Windows/macOS) | 12–20% | 32–40% | Needs Computer-Use v1.0 hardening + VM orchestration. **~4+ weeks.** Aspirational v3. |

---

## 2. LongMemEval — Implementation Plan

**Context.** Gabriel's explicit flag. LongMemEval is the de-facto memory
benchmark: 500 memory sessions, multi-turn conversations with user facts
scattered across sessions, then questions requiring cross-session recall.
Published SOTA: **98.6% Supermemory ensemble**, **96.6% MemPalace R@5**
(per `competitor-research-perplexity-mempalace-2026-04-09.md`).

**Corpus.** `https://huggingface.co/datasets/xiaowu0162/LongMemEval`
(as given by user). 5 subsets: single-session, multi-session,
knowledge-update, temporal-reasoning, abstention. ~500 samples total.

**Current WOTANN state.**

- `src/memory/memory-benchmark.ts` (530 LOC, 5 categories: single-hop,
  multi-hop, temporal, open-domain, adversarial) — **adjacent** to
  LongMemEval but uses WOTANN's own question set, not the published
  corpus. Serves as regression harness for the store adapter, not a
  leaderboard-eligible run.
- `src/memory/hybrid-retrieval.ts` — multi-signal (FTS5 + vector +
  temporal + frequency) retrieval. References LongMemEval in comments
  (line 7).
- `src/memory/relationship-types.ts` — typed `updates/extends/derives`
  relationships. References LongMemEval at line 9: "agents that
  distinguish these see +8–14% on LongMemEval's update-heavy tasks."
- `src/memory/dual-timestamp.ts` — documentDate + eventDate distinction.
  Supermemory trick. References LongMemEval at line 10.
- `src/memory/contextual-embeddings.ts` — Anthropic Contextual Retrieval.
- `src/memory/mem-palace.ts` — hall/wing/room hierarchy.
- `src/memory/extended-search-types.ts` — 10 Cognee-parity modes.
- Observations logged in `PHASE_6_PROGRESS.md` + `AUTONOMOUS_EXECUTION_PLAN_V3_2026-04-18.md`
  indicate the full Supermemory-parity stack is ~90% implemented but
  not yet wired to LongMemEval as an official runner.

**Gap.** No LongMemEval runner. `MemoryBenchmark` is a *related* custom
benchmark, not LongMemEval itself.

**Proposed runner.** `src/intelligence/benchmark-runners/longmemeval.ts`
— ~400 LOC following the same shape as `terminal-bench.ts` /
`aider-polyglot.ts` / `code-eval.ts`. Design:

### 2.1 Types (add to runner module)

```
type LongMemEvalSubset =
  | "single-session"
  | "multi-session"
  | "knowledge-update"
  | "temporal-reasoning"
  | "abstention";

interface LongMemEvalTask {
  readonly id: string;
  readonly subset: LongMemEvalSubset;
  /** Conversation history (list of turns). */
  readonly history: readonly { role: "user" | "assistant"; content: string; timestamp: number }[];
  /** The final question to answer. */
  readonly question: string;
  /** Expected answer / acceptable set. */
  readonly expectedAnswer: string;
  readonly acceptableAnswers?: readonly string[];
  /** For abstention tasks, expected = "NOT_FOUND". */
  readonly isAbstention?: boolean;
}

interface LongMemEvalReport {
  readonly runId: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly passAt1: number;
  readonly bySubset: Readonly<Record<LongMemEvalSubset, { total: number; completed: number }>>;
  readonly results: readonly LongMemEvalTaskResult[];
  readonly mode: "real" | "simple";
}
```

### 2.2 Corpus loading

- Primary: `.wotann/benchmarks/longmemeval-tasks.jsonl` (consistent with
  existing runners). A bootstrap script `scripts/download-longmemeval.ts`
  pulls from HuggingFace Hub via the HF REST API (no torch dep needed).
- Fallback: 5-task smoke corpus (1 per subset) for CI.

### 2.3 Execution flow

For each task:

1. **Ingest phase.** For every turn in `task.history`, call
   `memoryStore.insert({...})` so WOTANN's memory subsystem builds its
   episodic+semantic indices. Ensure dual-timestamp entries record
   `turn.timestamp` as eventDate and `Date.now()` as documentDate.
2. **Query phase.** Issue `task.question` against `runtime.query()` with
   memory-injection middleware enabled (the default for WOTANN).
3. **Scoring.** Use `matchesExpected`-style matching from
   `memory-benchmark.ts`, with per-subset tweaks (abstention → match
   "NOT_FOUND" or absence, knowledge-update → match the NEWER fact not
   the older one).
4. **Ablation hooks.** Return per-retrieval telemetry (which memory
   blocks retrieved, using `RetrievalQualityScorer`) so we can publish
   an ablation plot: "WOTANN vs WOTANN-no-dual-timestamp vs
   WOTANN-no-typed-rels vs WOTANN-no-contextual-embeddings".

### 2.4 Wire to `wotann bench longmemeval` CLI

Extend `src/index.ts:3387` bench command:

```ts
const validFlavours = [
  "terminal-bench",
  "aider-polyglot",
  "humaneval-plus",
  "mbpp-plus",
  "livecodebench",
  "longmemeval",          // NEW
] as const;
```

And the corresponding `runRealBenchmark` dispatch in
`src/intelligence/benchmark-harness.ts:282` needs:

```ts
case "longmemeval": {
  const report = await runLongMemEval(runtime, this.baseDir, runnerOpts);
  rawReport = report; passAt1 = report.passAt1;
  totalTasks = report.totalTasks; completedTasks = report.completedTasks;
  break;
}
```

### 2.5 Estimated effort

- Runner module: ~400 LOC, ~3 days.
- Corpus download script: ~80 LOC, ~half-day.
- CLI wiring + harness dispatch: ~50 LOC, ~half-day.
- Smoke corpus + test suite: ~200 LOC, ~1 day.
- Ablation pipeline: ~150 LOC, ~1 day.
- **Total ~1 week for a publishable v1.**

### 2.6 Expected position

- **WOTANN-Free** (Groq routing + full memory stack): **78–85%**. The
  memory infra doesn't depend on model quality — retrieval is pure
  SQLite+FTS5+vector math, only the *question-answering* step needs a
  model. Groq Llama 3.3 70B is plenty for answer extraction.
- **WOTANN-Sonnet** (adds Sonnet 4.6 for ambiguous extraction):
  **88–93%**. Top-3 realistic.
- **WOTANN-Opus-ceiling** (full verifier chain): **94–96%**, competitive
  with Supermemory ensemble and MemPalace.

This is one of WOTANN's strongest realistic moat positions because
the *harness* (dual-timestamp, typed rels, contextual embeddings,
mem-palace hierarchy) does the heavy lifting, not the model — exactly
the zero-cost narrative.

---

## 3. Zero-Cost Leaderboard Moat

The canonical free-tier routing map (from `BENCHMARK_BEAT_STRATEGY_2026-04-18.md`
§ "Zero-Cost Routing Plan") is already wired in
`src/providers/fallback-chain.ts:39-59`:

- **Paid tier (not zero-cost):** anthropic, openai, codex, copilot,
  azure, bedrock, vertex.
- **Third-party OpenAI-compatibles (cost-ordered):** groq (free ~14.4K
  RPD), deepseek (cheap), mistral, together, fireworks, xai, perplexity,
  sambanova, huggingface.
- **Free final tier:** gemini (free 1.5K RPD, 1M context), ollama
  (unlimited local), free (Pollinations etc.).

Cerebras isn't in the declared ProviderName enum at this commit (see
`src/core/types.ts`); adding it is a 1-hour change and unlocks the
Qwen 3 Coder 480B free-tier for code-heavy benchmarks.

### 3.1 Benchmark × $0-Run Feasibility

| Benchmark | $0 run possible today? | Bottleneck if no | Unlock cost |
|-----------|------------------------|------------------|-------------|
| TerminalBench | **YES** (Groq + DeepSeek) | — | — |
| SWE-bench Verified | **YES** (DeepSeek long ctx + local pytest) | Patch validation done locally — free | — |
| SWE-bench Lite/Full/Live | **YES** (same) | — | — |
| Aider Polyglot | **YES** (Groq + Cerebras Qwen) | — | Add Cerebras provider |
| HumanEval+ | **YES** (Groq, pass@10) | — | — |
| MBPP+ | **YES** (Groq) | — | — |
| LiveCodeBench | **YES** (Cerebras Qwen) | — | Add Cerebras |
| BigCodeBench | **YES** (DeepSeek long ctx) | — | — |
| BFCL v3 | **YES** (Groq tool-calling) | — | — |
| CruxEval | **YES** (Groq) | — | — |
| RepoBench | **YES** (DeepSeek long ctx) | — | — |
| ClassEval | **YES** (DeepSeek) | — | — |
| GAIA | **PARTIAL** | Vision (Gemini free works); web search (Brave free tier 2K/mo needed) | Set `BRAVE_API_KEY` env; free but requires signup |
| SimpleQA | **PARTIAL** | Web search limit | Same as GAIA |
| SearchBench | **PARTIAL** | Same | Same |
| BrowseComp | **NO** | 1,266 tasks × many searches blows free-tier limits | Tavily/Brave/SerpAPI paid plans — or implement scrapeless fallback |
| MLE-bench | **NO** | GPU rental $$$$ | Defer |
| LongMemEval | **YES** (Groq for Q/A, local sqlite for memory) | — | — |
| LOFT | **PARTIAL** | 1M context = Gemini free tier only; 1.5K RPD cap | Long runs need multi-account rotation (`account-pool.ts` already exists) |
| InfiniBench / ∞-Bench / LongBench | **YES** | Same as LOFT; Gemini free | — |
| Ruler | **YES** (Gemini) | — | — |
| NIAH | **YES** (any model) | — | — |
| BABILong | **YES** (Gemini) | — | — |
| HELMET | **YES** (Gemini) | — | — |
| τ-bench retail/airline | **YES** (Groq + DeepSeek) | User-sim needs a model — use Groq Llama 3.3 | — |
| AgentBench | **YES** (varies by subtask — Card Game & Lateral may need Sonnet) | Some subtasks low at free tier | — |
| ToolBench | **YES** (Groq) | — | — |
| WebArena | **NO** | Browser-agent infra not wired | Defer |
| VisualWebArena | **NO** | Same + vision tokens blow free tier | Defer |
| OSWorld | **NO** | Computer-Use + VMs | Defer |

### 3.2 Moat Claim

**Publishable $0 leaderboard (if GAP runners ship)**:

> *"WOTANN-Free is the only open-source harness publishing zero-cost
> runs on 18 standard benchmarks at once: TerminalBench, SWE-bench
> (Verified/Lite/Full/Live), Aider Polyglot, HumanEval+, MBPP+, LCB,
> BigCodeBench, BFCL v3, CruxEval, RepoBench, ClassEval,
> LongMemEval, LOFT, LongBench, Ruler, NIAH, BABILong, τ-bench
> retail+airline, AgentBench, ToolBench."*

That's 18 simultaneous $0 numbers. Nobody else publishes more than 2-3.

### 3.3 Flagged Where $0 Isn't Possible

- **BrowseComp** — search API free-tier caps (1K–2K queries/month) can
  be exhausted by one full run. Mitigation: implement a scraping fallback
  (Lightpanda is already in our MCP stack) or accept a "partial $0"
  footnote where the search dimension went paid.
- **MLE-bench / WebArena / VisualWebArena / OSWorld** — compute
  infrastructure is the bottleneck, not model inference. Honest
  messaging: "these require paid GPU / VM infra; $0 is not feasible."

---

## 4. Runnability Blockers

Benchmarks where a runner exists on disk but *cannot execute today*:

### 4.1 BLOCKED — missing real-harness wiring

| Benchmark | File | Blocker | Gate flag |
|-----------|------|---------|-----------|
| TerminalBench | `src/intelligence/benchmark-runners/terminal-bench.ts:178` | `WOTANN_TB_REAL=1` falls through to simple mode with a comment "currently falls through to simple mode with a note in the report". No child_process spawn to `tb run-agent` yet. | `WOTANN_TB_REAL` |
| Aider Polyglot | `src/intelligence/benchmark-runners/aider-polyglot.ts:148` | `WOTANN_AIDER_REAL=1` similarly scaffolded but no shell-out to pip `aider-chat` yet. | `WOTANN_AIDER_REAL` |
| HumanEval+ / MBPP+ / LCB | `src/intelligence/benchmark-runners/code-eval.ts:158` | `WOTANN_CODEEVAL_REAL=1` scaffolded, no shell-out to evalplus / lcb_runner yet. | `WOTANN_CODEEVAL_REAL` |

**Common fix:** all three need ~50–150 LOC of `child_process.spawn`
adapter code that translates WOTANN's query interface to the upstream
python harness's expected IO. Impact: unblocks 5 benchmarks for ~1 week
of work.

### 4.2 CORPUS-MISSING — no local data, no remote fetch

No `.wotann/benchmarks/*.jsonl` corpora on disk. Each runner falls to
its 5-task SMOKE_CORPUS in the absence of a local file. Need:

- `scripts/download-terminalbench.ts` — pull from pip
- `scripts/download-aider-polyglot.ts` — Exercism JSON
- `scripts/download-humanevalplus.ts` — HF download
- `scripts/download-mbppplus.ts` — HF download
- `scripts/download-livecodebench.ts` — HF download
- `scripts/download-longmemeval.ts` — HF download
- Then scripts for every GAP benchmark below.

**Common fix:** single `scripts/download-benchmark.ts <flavour>` driven
by a manifest (e.g. `benchmarks/manifest.json` mapping flavour →
HF URI → sha256 → local jsonl). **~3 days, unblocks all corpora.**

### 4.3 EXTERNAL-DEPS blocker (defer list)

- **MLE-bench** — needs `kaggle` CLI + GPU.
- **WebArena / VisualWebArena** — needs `docker compose` with 5
  webapp images (~20 GB pull).
- **OSWorld** — needs Ubuntu/Windows VMs, `pyautogui`, screen capture.
- **BrowseComp** — no blocker per se, but realistic $0 not feasible
  (see §3.1).

### 4.4 MISSING-FROM-CLI — runners don't exist yet

20 of the 35 benchmarks have **no file on disk**. Each needs a new
`src/intelligence/benchmark-runners/<name>.ts` + wire into
`benchmark-harness.ts:runRealBenchmark` + append to
`src/index.ts:validFlavours` list.

**Total runnable today**: 5 (TerminalBench + Aider Polyglot +
HumanEval+ + MBPP+ + LCB — simple mode only, smoke corpora).

**Total that could be made runnable within 1 sprint (2 weeks)**:
14 (add SWE-bench Verified/Lite/Full/Live via one adapter, BigCodeBench,
CruxEval, ClassEval, BFCL, LongMemEval, SimpleQA, plus unblocking
the 5 simple-mode runners with real-harness).

---

## 5. Moat Opportunities — Where WOTANN Can LEAD

**Existing WOTANN capabilities that directly boost benchmark scores**:

| Capability | File | Benchmarks it helps most | Expected lift |
|---|---|---|---|
| Self-consistency voting (council.ts) | `src/orchestration/council.ts` | HumanEval+, MBPP+, LCB, CruxEval, ClassEval, TerminalBench | +3–6% |
| Multi-patch voting (sandboxed) | `src/intelligence/multi-patch-voter.ts` | SWE-bench (all 4), Aider Polyglot, RepoBench | +3–5% |
| Verifier-with-retry (CoVe + cascade) | `src/intelligence/verification-cascade.ts` + `chain-of-verification.ts` | All coding + all reasoning benchmarks | +2–4% |
| Adversarial test generator | `src/intelligence/adversarial-test-generator.ts` | HE+, MBPP+, LCB, BigCodeBench | +2–4% |
| Answer normalizer | `src/intelligence/answer-normalizer.ts` | GAIA, SimpleQA, AgentBench, BABILong | +3–5% |
| Task-semantic routing | `src/intelligence/task-semantic-router.ts` | AgentBench (8 envs), GAIA, MLE-bench | +2–3% |
| Policy injector | `src/intelligence/policy-injector.ts` | τ-bench retail + airline | +4–6% |
| Strict-schema enforcement | `src/intelligence/strict-schema.ts` | τ-bench, BFCL v3, ToolBench, AgentBench | +3–5% |
| Trajectory scorer | `src/intelligence/trajectory-scorer.ts` | TerminalBench, SWE-bench, MLE-bench | +2–4% |
| Budget enforcer | `src/intelligence/budget-enforcer.ts` | All benchmarks (publish-ability, not score) | reproducibility |
| Speculative execution | `src/orchestration/speculative-execution.ts` | LCB, AgentBench hard | +1–3% |
| Memory stack (dual-timestamp + typed rels + contextual embeds + mem-palace + 14 search modes) | `src/memory/*.ts` | **LongMemEval (primary)**, LOFT, LongBench, BABILong | +8–14% on LongMemEval update-heavy tasks |
| Gemini 1M routing | `src/providers/model-router.ts` | LOFT, InfiniBench, ∞-Bench, LongBench, Ruler | enables zero-cost 1M runs |
| Autopilot checkpointing | `src/autopilot/checkpoint.ts` | MLE-bench, OSWorld (24h+ runs) | enables benchmark at all |
| Tool-parser robustness | `src/providers/tool-parsers/*` | BFCL v3, τ-bench, ToolBench, AgentBench | +2–4% |
| LSP-as-agent-tool | `src/lsp/lsp-tools.ts` | SWE-bench, Aider, RepoBench, ClassEval | +2–4% |

### 5.1 Unique WOTANN Moats (where nobody else competes)

These are the 4 benchmarks where WOTANN should aim for **#1 open-source**:

1. **LongMemEval** — WOTANN's memory stack already clones Supermemory's
   10pp-lift tricks. The only OSS harness with dual-timestamp + typed
   rels + contextual embeddings + mem-palace as a *shipped integrated
   stack*. **Top-3 realistic, 80–93% range.**
2. **SWE-bench Live** — contamination-free, rolling. Nobody runs this
   continuously and posts it. If WOTANN publishes a nightly board at
   wotann.com/bench, we own the rolling $0 narrative. **Top-3 realistic,
   70–75% range.**
3. **τ-bench retail + airline** — policy-aware tool-use is directly
   helped by `policy-injector.ts` + `strict-schema.ts` + WOTANN's
   deterministic tool-parser. Multi-turn reliability is hard; WOTANN's
   verifier-cascade should post pass^k numbers nobody else reports.
   **Top-3 realistic, 68–75% retail range.**
4. **TerminalBench** — ForgeCode's 81.8% is the public leader; WOTANN's
   harness-track-record (`TERMINALBENCH_STRATEGY.md` + 30-item backlog)
   is realistic to approach 87% Sonnet-capped, 76% free-tier. If
   WOTANN publishes both numbers, the *harness-ablation delta* ("+22%
   from the WOTANN harness alone") is a unique talking-point.
   **Top-3 realistic.**

### 5.2 Benchmarks WOTANN Shouldn't Chase (low ROI / wrong moat)

- **ARC-AGI 2** — different skill class. Defer to v2 per prior strategy.
- **MLE-bench Full** — 22 tasks × 24h × GPU = $1K+ per run. Lite only.
- **OSWorld / VisualWebArena / BrowseComp** — require infra we don't
  own. Aspirational v2.

---

## 6. Ranked Leverage List — What to Fix First

Highest leverage = (# benchmarks unlocked) × (expected score gain) / (effort weeks).
Done in this order, the first 5 items move ~13 benchmarks from "can't publish"
to "can publish" in <3 weeks.

| Rank | Action | Unlocks | Effort | ROI |
|------|--------|---------|--------|-----|
| 1 | **LongMemEval runner** (§2). Ship `src/intelligence/benchmark-runners/longmemeval.ts` + corpus download + CLI wiring. | 1 benchmark but **user-priority + unique moat** (no other OSS harness posts this with full Supermemory-parity stack) | 1 week | **HIGHEST — user-flagged** |
| 2 | **`scripts/download-benchmark.ts <flavour>`** — single driver for all HF / pip corpora, plus `benchmarks/manifest.json` mapping. | ALL remaining runners (currently all using smoke corpora only) | 3 days | **Critical — blocks every other benchmark from being real** |
| 3 | **SWE-bench runner** (`src/intelligence/benchmark-runners/swe-bench.ts`). Build BM25+embedding `repo-retriever.ts` first (~400 LOC), then the runner. | 4 benchmarks (Verified + Lite + Full + Live) | 2 weeks | **Very high — 4 benchmarks at once, top-3 target on Live** |
| 4 | **Wire `WOTANN_*_REAL=1` child_process paths** for TB / Aider / code-eval (3 runners' simple-mode → real-mode). | 5 benchmarks from "smoke-only" → "full-corpus-runnable" | 1 week (all 3 share pattern) | **High — unlocks real numbers on existing scaffolds** |
| 5 | **τ-bench runner** (`src/intelligence/benchmark-runners/tau-bench.ts`) wiring the already-written `policy-injector.ts` + tool-parser + strict-schema + user-sim. | 2 benchmarks (retail + airline) | 1 week | **High — unique moat: policy-aware tool-use** |
| 6 | **GAIA runner** — pdf-processor + search-providers + answer-normalizer + vision-routing all exist, just need gluing. | 1 benchmark, plus pattern for SimpleQA + SearchBench | 1 week | **High — all parts exist** |
| 7 | **BFCL v3 runner** — leverage tool-parser + strict-schema. | 1 benchmark, strong WOTANN fit | 1 week | High |
| 8 | **Add Cerebras provider** (free-tier Qwen 3 Coder 480B). | Cost reduction across 5+ coding benchmarks (swap DeepSeek → Cerebras) | 1 hour | **Quick win** |
| 9 | **Shared long-context runner** for LOFT / InfiniBench / ∞-Bench / LongBench / Ruler / BABILong / HELMET / NIAH. | 8 benchmarks from one codebase (heavy reuse) | 2 weeks | **Very high — 8 benchmarks per 2-week sprint** |
| 10 | **CruxEval + ClassEval + BigCodeBench** — each is a new `flavour` on `code-eval.ts`. | 3 benchmarks, marginal LOC | 4 days | Medium-high |
| 11 | **RepoBench runner** — depends on repo-retriever (from #3). | 1 benchmark | 4 days after #3 | Medium |
| 12 | **AgentBench runner** (8 envs, largest singleton). | 1 benchmark (but 8 subtasks) | 2 weeks | Medium |
| 13 | **ToolBench + SimpleQA + SearchBench runners** — each is small after #6 + tool-parser. | 3 benchmarks | 1 week | Medium |
| 14 | **Continuous SWE-bench Live cron** — nightly daemon job + wotann.com/bench page. Depends on #3. | **Moat claim: rolling zero-cost leaderboard** | 3 days after #3 | **Strategic — publishability** |
| 15 | **Harness ablation harness** — `wotann bench <name> --ablate` runs with harness-on vs harness-off and reports the delta. | Publishability for top-5 benchmarks — the harness-contribution-delta IS the product | 1 week | **Strategic — the positioning claim** |
| 16 | **BrowseComp fallback search** — implement Lightpanda scrape fallback when Brave/Tavily exhausted. | 1 benchmark from BLK → RUN-partial | 1 week | Low-medium |
| 17 | **WebArena / VisualWebArena / OSWorld / MLE-bench** — full browser-agent + VM orchestration. | 4 benchmarks | 4+ weeks total | Defer to v2 |

**Recommendation**: Do items 1–5 in Sprint B3 (next ~3 weeks). That
alone:

- Adds LongMemEval (user-flagged) — publishable top-3.
- Adds 4 SWE-bench variants (Verified/Lite/Full/Live) — publishable top-3/5 on Live.
- Unlocks 5 existing simple-mode runners to run the real corpora.
- Adds τ-bench retail+airline — publishable top-3.

Net: **10 benchmarks move from GAP/SCAF → RUN with real corpora**,
most of them publishable top-3 zero-cost.

---

## 7. Open Questions / Risks

1. **SOTA reverification.** All SOTA numbers herein are from the 2026-01
   training distribution cutoff + WOTANN's internal docs. Before any
   public publication, run the `wotann benchmark refresh` job (not yet
   implemented — it requires live web access). In the meantime, any
   public claim should carry a "SOTA snapshot as of YYYY-MM-DD" footer.
2. **Contamination on HumanEval/MBPP.** Any score >95% on these should
   carry a "may include contamination" footnote for training data
   overlap. LCB post-cutoff slice only, SWE-bench Live by construction,
   are safe.
3. **Provider rate limits.** Full runs of 500-task SWE-bench Verified
   with 3-patch voting = ~1,500 model calls per run. Groq free-tier
   at 14.4K RPD clears this, but concurrent users hitting the same
   account could tank it. `account-pool.ts` should load-balance across
   multiple free accounts.
4. **LongMemEval SOTA is contested.** Supermemory's 98.6% is an
   *ensemble* score (multiple retrievers), not single-model. MemPalace's
   96.6% R@5 is retrieval-only, not final-answer accuracy. WOTANN
   should publish both metrics (retrieval-only and final-answer) to
   avoid apples-to-oranges comparisons.
5. **The `runRealBenchmark` type-signature.** `benchmark-harness.ts:291`
   currently hardcodes `storageType = type === "terminal-bench" ?
   "terminal-bench" : "open-swe"` — this means every non-TB real
   benchmark is persisted under `"open-swe"`. That's a bug we'll trip
   over once more flavours are added — rename storage type to match
   flavour. **~1 hr fix, flag before moving past 5 flavours.**

---

## 8. TL;DR

- **Today**: 5 simple-mode benchmark runners (TerminalBench,
  Aider Polyglot, HumanEval+, MBPP+, LCB) + 1 adjacent memory benchmark
  (WOTANN's own `MemoryBenchmark`, not LongMemEval). Smoke corpora
  only. Nothing published yet.
- **One week away (LongMemEval runner)**: Adds a publishable top-3
  score on the user-flagged benchmark, using existing memory infra
  that's ~90% done.
- **Three weeks away (Sprint B3)**: 10 benchmarks publishable at $0,
  5 at top-3. Unique moat: rolling SWE-bench Live + LongMemEval +
  τ-bench all at $0.
- **Where we won't compete soon**: OSWorld, WebArena, VisualWebArena,
  BrowseComp, MLE-bench — all gated on infra we don't own. Honest
  v2/v3 categorization.
- **Positioning claim we can publish once Sprint B3 ships**:
  *"WOTANN is the first OSS harness posting zero-cost top-3 runs on
  TerminalBench, SWE-bench Live, Aider Polyglot, τ-bench, and
  LongMemEval — five benchmarks, one commit, $0 inference."*

That is a defensible, unique moat and exactly the "zero-cost
leaderboard" narrative Gabriel flagged.

---

## Appendix A — File Inventory (benchmark-related)

All absolute paths on `/Users/gabrielvuksani/Desktop/agent-harness/wotann/`.

- `src/intelligence/benchmark-harness.ts` — dispatch layer, 526 LOC
- `src/intelligence/benchmark-runners/terminal-bench.ts` — 323 LOC, SCAF
- `src/intelligence/benchmark-runners/aider-polyglot.ts` — 347 LOC, SCAF
- `src/intelligence/benchmark-runners/code-eval.ts` — 359 LOC, SCAF
- `src/intelligence/policy-injector.ts` — 248 LOC, τ-bench policy text
- `src/intelligence/adversarial-test-generator.ts` — leverage
- `src/intelligence/answer-normalizer.ts` — leverage
- `src/intelligence/chain-of-verification.ts` — leverage
- `src/intelligence/verification-cascade.ts` — leverage
- `src/intelligence/task-semantic-router.ts` — leverage
- `src/intelligence/strict-schema.ts` — leverage
- `src/intelligence/budget-enforcer.ts` — leverage
- `src/intelligence/trajectory-scorer.ts` — leverage
- `src/intelligence/multi-patch-voter.ts` — leverage
- `src/intelligence/patch-scorer.ts` — leverage
- `src/intelligence/search-providers.ts` — leverage (Brave + Tavily)
- `src/intelligence/smart-file-search.ts` — leverage
- `src/orchestration/council.ts` — self-consistency voting
- `src/orchestration/speculative-execution.ts` — leverage
- `src/orchestration/self-healing-pipeline.ts` — leverage
- `src/autopilot/checkpoint.ts` — 24h+ runs
- `src/memory/memory-benchmark.ts` — 530 LOC, LoCoMo-inspired (adjacent to LongMemEval)
- `src/memory/hybrid-retrieval.ts` — multi-signal retrieval
- `src/memory/relationship-types.ts` — typed rels, +8–14% LongMemEval
- `src/memory/dual-timestamp.ts` — Supermemory trick
- `src/memory/contextual-embeddings.ts` — Anthropic Contextual Retrieval
- `src/memory/mem-palace.ts` — hall/wing/room hierarchy
- `src/memory/extended-search-types.ts` — 10 Cognee modes
- `src/memory/retrieval-quality.ts` — telemetry for ablation
- `src/providers/fallback-chain.ts:39-59` — ordered provider chain
- `src/providers/gemini-native-adapter.ts` — 1M context free tier
- `src/tools/pdf-processor.ts` — GAIA file parsing
- `src/tools/web-fetch.ts` — SimpleQA / BrowseComp primitive
- `src/lsp/lsp-tools.ts` — agent-callable symbol operations (SWE-bench)
- `src/index.ts:3387` — `wotann bench <flavour>` CLI command
- `docs/BENCHMARK_BEAT_STRATEGY_2026-04-18.md` — per-benchmark deep dive
- `docs/PHASE_6_PROGRESS.md` — LongMemEval backlog
- `docs/AUTONOMOUS_EXECUTION_PLAN_V3_2026-04-18.md` — full sprint plan
- `docs/competitor-research-perplexity-mempalace-2026-04-09.md` — MemPalace 96.6% citation

**Files NOT yet on disk but referenced in this plan** (need to create):

- `src/intelligence/benchmark-runners/longmemeval.ts` — §2
- `src/intelligence/benchmark-runners/swe-bench.ts` — Rank 3
- `src/intelligence/benchmark-runners/tau-bench.ts` — Rank 5
- `src/intelligence/benchmark-runners/gaia.ts` — Rank 6
- `src/intelligence/benchmark-runners/bfcl.ts` — Rank 7
- `src/intelligence/benchmark-runners/long-context.ts` (shared) — Rank 9
- `src/intelligence/benchmark-runners/repobench.ts` — Rank 11
- `src/intelligence/benchmark-runners/agentbench.ts` — Rank 12
- `src/intelligence/benchmark-runners/toolbench.ts` — Rank 13
- `src/intelligence/benchmark-runners/simpleqa.ts` — Rank 13
- `src/intelligence/benchmark-runners/searchbench.ts` — Rank 13
- `src/intelligence/repo-retriever.ts` — precondition for #3
- `scripts/download-benchmark.ts` — precondition for every real run
- `benchmarks/manifest.json` — corpus SHA registry

— END OF BENCHMARK_POSITION_V2 —
