# AUDIT LANE 5 — Benchmarks + Memory Evals

**Auditor**: Opus 4.7 max-effort, Lane 5 of 5
**Date**: 2026-04-20
**Scope**: `src/intelligence/benchmark-runners/`, `src/intelligence/benchmark-harness.ts`, `src/memory/evals/longmemeval/`, `tests/intelligence/benchmark-runners/`, `TERMINALBENCH_STRATEGY.md`
**Verdict**: **Honest shells, no real numbers**. The runners are carefully-written plumbing but every published pass@1 would be `runtime.query() + runtime.verifyCompletion()` — not the official task grader. Mode is hard-coded to `"simple"` in every runner. Corpus directory is empty. **WOTANN cannot today produce a leaderboard-comparable score on any of the 5 major benchmarks it claims to support.**

---

## 1. Benchmark Runner Inventory (step-by-step, with evidence)

### 1.1 TerminalBench — `src/intelligence/benchmark-runners/terminal-bench.ts`

What the runner does:
1. Load `.wotann/benchmarks/terminal-bench/terminal-bench-tasks.jsonl` if present. If absent: fallback to **5-task embedded smoke corpus** (lines 477-521) or throw `BlockedCorpusError` if `requireCorpus=true` (line 195-201).
2. For each task, call `runtime.query({prompt})` — collect streamed text (lines 390-401).
3. Call `runtime.verifyCompletion(task.prompt, {criteria, threshold})` (line 411). **This is NOT the upstream TerminalBench grader** — it's WOTANN's own CompletionOracle (`src/autopilot/completion-oracle.ts`) running `npx vitest run`, `npx tsc --noEmit`, `npx biome check`, `curl -s`, and optional LLM-judge.
4. Append `TaskScoreEnvelope` to `~/.wotann/bench-runs/<runId>.jsonl` (lines 426-435).

**Dataset fetch?** No. Runner only reads from local disk. Fetch command is documented (lines 133-137) but not executed by the runner.
**Real model call?** Yes — via `runtime.query`, whichever provider is configured.
**Official grader?** **No.** The "pass" verdict comes from WOTANN's own CompletionOracle running local tooling — not the tmux/Docker automated grader shipped with each TerminalBench task.
**Mode=real?** Hard-coded to `"simple"` at line 360 — `WOTANN_TB_REAL=1` is documented (line 24-28) but explicitly not implemented: `// even when WOTANN_TB_REAL=1 — no silent lies about capability`. `mode: "real"` is a type the codebase intentionally never produces.

**Corpus fetch URL is BROKEN.** Line 135: `git clone --depth 1 https://github.com/tbench-ai/terminal-bench`. Verified with `curl -I`: **404 Not Found**. Real repo: `https://github.com/laude-institute/terminal-bench` (confirmed via GitHub and the official leaderboard at `tbench.ai`).

### 1.2 SWE-bench Verified — `src/intelligence/benchmark-runners/swe-bench.ts`

What the runner does:
1. Load `.wotann/benchmarks/swe-bench/swe-bench-verified-tasks.jsonl` or fall back to 3 synthetic smoke tasks.
2. Build prompt from task (lines 323, 423-466) asking agent to emit a unified diff inside `<<<PATCH>>>...<<<END>>>` markers.
3. Stream `runtime.query()` (lines 329-335).
4. Extract patch bytes via regex (line 340, `extractPatch()` at 473-479).
5. Call `runtime.verifyCompletion(task.problemStatement, {taskType: "code"})` (line 349).
6. **The patch is never applied. Tests are never run against the buggy commit.** There is no Docker spin-up, no `pytest`, no `FAIL_TO_PASS`/`PASS_TO_PASS` comparison. The verdict is purely "does the agent's textual response look like a reasonable diff" per CompletionOracle's local `vitest`/`tsc` checks on the WOTANN project itself — which has nothing to do with `django/django`.

**Mode=real?** Hard-coded to `"simple"` at line 293. SWE-bench Verified real mode is documented as "deferred" (line 21-22, 280-284).

### 1.3 τ-bench — `src/intelligence/benchmark-runners/tau-bench.ts`

What the runner does:
1. Load retail + airline task JSONLs or fall back to smoke corpus (8 tasks/domain).
2. Look up domain policy via `intelligence/policy-injector.ts`, inject as system-prompt preamble (lines 359-374).
3. Concatenate `userMessage + followUps` into a single prompt (line 365). **This is not multi-turn** — real τ-bench sends follow-ups adaptively based on agent replies, simulating a user.
4. Stream `runtime.query()`.
5. Call `runtime.verifyCompletion(task.userMessage, verifyOpts)` (line 394). Real τ-bench scores by comparing tool-call trajectories against a reference agent's trajectory — WOTANN's CompletionOracle has no concept of this.

### 1.4 Aider Polyglot — `src/intelligence/benchmark-runners/aider-polyglot.ts`

What the runner does:
1. Load `.wotann/benchmarks/aider-polyglot/aider-polyglot-tasks.jsonl` or smoke fallback.
2. For each task: run diff-edit attempt loop (default 1) + whole-file fallback (lines 348-399), streaming `runtime.query()`.
3. Between attempts, call `runtime.verifyCompletion(task.prompt, {criteria})`.
4. **The diff is never applied. The language's test command (`pytest -x`, `cargo test`, etc.) is never run.** A passing task depends on WOTANN's verifyCompletion returning `completed: true` — which, without task-specific criteria, means `npx tsc` and `npx vitest` on the WOTANN codebase.

**Mode=real?** Hard-coded `"simple"` at line 300.

### 1.5 Code-Eval (HumanEval+ / MBPP+ / LiveCodeBench) — `src/intelligence/benchmark-runners/code-eval.ts`

What the runner does:
1. Multi-sample loop (`k` samples, default 1) with deadline — streams `runtime.query()` for each sample (lines 378-400).
2. Per sample, call `runtime.verifyCompletion(task.prompt)`.
3. **No actual HumanEval+ test execution.** Official HumanEval+ runs each sample against 80x-expanded `evalplus` tests via pip package. This runner does not import `evalplus` or its equivalent. Task loader reads `task.testCommand` as metadata but never executes it.

**Mode=real?** Hard-coded `"simple"` at line 327. `WOTANN_CODEEVAL_REAL=1` is documented as aspirational (line 26).

### 1.6 Unwired Benchmark Types in `benchmark-harness.ts`

Lines 101-219 define four placeholder suites (`ACCURACY_TESTS`, `TERMINAL_BENCH_TESTS`, `OPEN_SWE_TESTS`, `MEMORY_EVAL_TESTS`) that go through `runBenchmark()` which at line 261 calls `simulateTestExecution()`. That function at lines 653-661 **ALWAYS returns** `{passed: false, actual: "placeholder-not-executed", score: 0}`. Any "accuracy" or "memory-eval" score produced by this path is zero by construction.

The `memory-eval` suite (line 214-219) is 20 hard-coded empty prompts "Memory recall question N" — not connected to LongMemEval or the SQLite memory store at all.

---

## 2. Honest Signal Table

| Benchmark | Dataset fetch? | Real scoring? | Real grader? | CI-integrated? | Can produce official score? |
|---|---|---|---|---|---|
| TerminalBench 2.0 | No (broken URL) | No — uses WOTANN's CompletionOracle, not the tmux+Docker grader | No | Yes — runner unit tests pass, but only with fake runtime | **No** |
| SWE-bench Verified | No (corpus empty) | No — diff never applied, tests never run on the buggy commit | No | Yes (unit tests) | **No** |
| τ-bench retail/airline | No | No — single-turn, no user simulator, no trajectory scoring | No | Yes (unit tests) | **No** |
| Aider Polyglot | No | No — diff never applied, `pytest/cargo test` never run | No | Yes (unit tests) | **No** |
| HumanEval+ | No | No — `evalplus` tests never executed | No | Yes (unit tests) | **No** |
| MBPP+ | No | No — tests never executed | No | Yes (unit tests) | **No** |
| LiveCodeBench | No | No — no judge, no sandbox | No | Yes (unit tests) | **No** |
| LongMemEval | No (corpus empty) | Partial — real FTS5 memory retrieval runs; scoring is rule-based not LLM-judge | Non-official (rule-based scorer) | Yes (test file exists) | **Partial** — see §3 |
| BFCL | Not implemented | — | — | — | — |
| WebArena | Not implemented | — | — | — | — |
| GAIA | Not implemented | — | — | — | — |
| BrowseComp | Not implemented | — | — | — | — |
| RE-Bench / MLE-Bench | Not implemented | — | — | — | — |
| SWE-bench Pro | Not implemented (mentioned in comments only) | — | — | — | — |

**Current `.wotann/benchmarks/` directory**: empty. No official corpus is on disk for any benchmark. Every "real" run right now executes against the 3–8 embedded smoke tasks.

---

## 3. LongMemEval Audit — deeper look

**Files**: `src/memory/evals/longmemeval/{corpus,runner,scorer}.ts`. Test file exists: `tests/memory/evals/longmemeval.test.ts` (15KB, 250+ lines of real tests).

### 3.1 What is real

- **Ingestion** (`runner.ts` lines 83-117): real SQLite-backed `MemoryStore`, each haystack turn inserted as a separate entry with session_id/date as domain/topic. Per-instance isolation via fresh tmp DB (lines 219-292) — crucial for correctness and actually implemented.
- **Retrieval** (line 240): `store.search(quoteForFts(question), topK)` — real FTS5 MATCH with BM25-like ranking against WOTANN's production memory store.
- **FTS5 query sanitisation** (`quoteForFts`, lines 319-327): handles punctuation + keyword collisions. Correct.
- **Ability classification** (`corpus.ts` lines 95-109): maps question_type → 5-ability taxonomy. Matches the paper.
- **Scoring rubric** (`scorer.ts`): rule-based substring + content-word overlap + temporal off-by-one + abstention-phrase detection.

### 3.2 What is NOT official

- **Corpus is not present.** `corpus.ts` line 146-170 falls back to a **10-instance synthetic smoke corpus** hand-written for CI (lines 235-453). Real LongMemEval is 500 instances per variant (S/M/Oracle). Any number produced today is on 10 toy questions, not 500.
- **Scorer is rule-based, not GPT-4o judge.** The paper's official scorer uses GPT-4o with ability-specific prompts (`scorer.ts` lines 1-26 explicitly acknowledges this). Rule-based scoring will **systematically underestimate** real model performance: the scorer returns false on any semantically-correct paraphrase. The `strictAccuracy` and `lenientAccuracy` fields honestly report the spread.
- **Hypothesis synthesis is concatenation, not LLM generation.** `synthesizeHypothesisFromMemory` (lines 133-166) just joins top-K turn contents with `\n`. The paper calls this the naive retrieval baseline. The `runtime` mode exists (lines 245-259) but is not the default and not what `index.ts` exports for benchmark runs.
- **Hardcoded abstention heuristic.** Line 156 thresholds on FTS5 rank magnitude < 1.0 as "nothing compelling". Magic number, not paper-derived.

### 3.3 Confidence

- If a user runs `memory-stack` mode on the 500-instance corpus, the output number is **a real signal for BM25+FTS5 retrieval quality** — low-variance, reproducible, directly comparable to the paper's `naive retrieval (no LLM)` baseline which scores ~25% on LongMemEval-S. That is a defensible comparison point.
- It is **NOT** directly comparable to frontier systems on the leaderboard: OMEGA 95.4%, Mastra Observational Memory (GPT-5-mini) 94.9%, EverMemOS 83.0%, Supermemory, RetainDB 79%. Those systems use LLM-judge scoring + LLM synthesis + structured memory beyond FTS5. WOTANN's rule-based pipeline will score in the 30-50% band on lenient rule-based scoring — fine as a "harness-on-vs-off" ablation, misleading as a "WOTANN vs SOTA" claim.

**Gaps to close for a publishable number**:
1. Ship an `openai-judge` scorer path so the lenient score aligns with the paper's ~60-85% band.
2. Actually download the 500-instance corpus in CI (the HuggingFace URL in `corpus.ts` line 167 is live; verified via `curl`).
3. Use `runtime` mode with a real model so synthesis is LLM-generated, not concatenation.
4. Report all 5 abilities + overall + strict/lenient split on the README.

---

## 4. Conspicuously Absent External Benchmarks

| Benchmark | What it measures | Why absence is a leadership gap |
|---|---|---|
| BFCL v4 (Gorilla/Berkeley) | Function calling, web search agentic, memory agentic, format sensitivity | Last updated 2026-04-12. Standard tool-use score. Every frontier model publishes BFCL. Zero mention in WOTANN. |
| GAIA (Princeton HAL) | General-assistant tasks across 3 levels | Claude Sonnet 4.5 leads at 74.6% in HAL Generalist Agent. Only available WOTANN signal: a grep hit in `answer-normalizer.ts` saying "scoring drops 3-5% on GAIA alone". No runner, no corpus. |
| WebArena | Autonomous multi-step browser agent | Claude Mythos Preview tracked at 68.7%. WOTANN's desktop/computer-use stack could run it. No runner. |
| BrowseComp (OpenAI) | Autonomous browsing correctness | Not implemented. |
| SWE-bench Pro | Professional-grade issue resolution (100+ repos) | Mentioned in `context-relevance.ts`/`accuracy-boost.ts`/`response-validator.ts` comments ("SWE-bench Pro: Search subagents (28% time reduction)") but no runner. Top models score 46% here vs. 80%+ on Verified — more discriminating benchmark. |
| SWE-bench Live | Contamination-free rolling benchmark | Harness-agnostic is the whole point. No runner. Grep hit only in `search-providers.ts`. |
| RE-Bench / MLE-Bench | ML research agent performance | Not implemented. |
| CyBench | Cybersecurity agent | Not implemented — relevant given WOTANN's "exploit" tab. |
| SciCode / USACO / HumanRankBench | Deeper code reasoning | Not implemented. |
| τ²-bench (the new fixed version) | Same domains, 50+ task fixes | Not implemented. WOTANN points at `sierra-research/tau-bench`, not `tau2-bench`. |
| MultiChallenge | Multi-turn instruction following | Not implemented. |
| SimpleQA / SearchBench | Browse/search accuracy | Grep hit in `search-providers.ts`. No runner. |

Table stakes for "harness leadership": BFCL + GAIA + WebArena + a real SWE-bench-Verified runner + real Aider Polyglot runner. WOTANN has zero of these in a runnable state today.

---

## 5. Current Leaderboard Snapshot (April 2026)

### TerminalBench 2.0 (89 tasks, [tbench.ai leaderboard](https://www.tbench.ai/leaderboard/terminal-bench/2.0))

| Rank | Model | Harness | Pass@1 |
|---|---|---|---|
| 1 | Claude Mythos Preview | claude-code-style | 82.0% |
| 2 | ForgeCode + Opus 4.6 | ForgeCode | 81.8% |
| 3 | TongAgents + Gemini 3.1 Pro | TongAgents | 80.2% |
| 4 | ForgeCode + Gemini 3.1 Pro | ForgeCode | 78.4% |
| 5 | GPT-5.3 Codex | codex-cli | 77.3% |
| 6 | GPT-5.4 | (scaffold-agnostic) | 75.1% |
| 7 | Opus 4.6 (Terminus-KIRA) | Terminus | 74.7% |

Scaffold delta: +2-6 points across identical weights.

### SWE-bench Verified ([swebench.com](http://www.swebench.com/))

| Rank | Model | Harness | % Resolved |
|---|---|---|---|
| 1 | Claude Opus 4.7 (1M, released Apr 16 2026) | (official) | 87.6% |
| 2 | GPT-5.3 Codex | codex-agent | 85.0% |
| 3 | Claude Opus 4.6 | claude-code | ~82.0% |
| 4 | Harness AI code agent | Harness AI | ~80% |
| n/a | mini-swe-agent baseline | bash-only | 63-68% |

### Aider Polyglot pass@2 — 225 Exercism hardest problems

| Rank | Model | Pass@2 |
|---|---|---|
| 1 | Claude Opus 4.5 | 89.4% |
| 2 | GPT-5 (high) | 88.0% |
| 3 | Grok 4 | 79.6% |
| 4 | DeepSeek V3.2-Exp | 74.2% |

(Refact.ai 92.9% is WOTANN's coded parity target, `AIDER_POLYGLOT_PARITY_PASS_AT_2 = 0.929`; it's older than the April numbers and likely eclipsed.)

### LongMemEval

| Rank | System | Score |
|---|---|---|
| 1 | OMEGA | 95.4% |
| 2 | Mastra Observational Memory (GPT-5-mini) | 94.9% |
| 3 | EverMemOS | 83.0% |
| 4 | RetainDB | 79% overall, 88% preference recall |
| 5 | Supermemory | 71% multi-session, 77% temporal |
| — | Paper's naive retrieval baseline (no LLM) | ~25% |

### τ-bench ([taubench.com](https://taubench.com/) / [llm-stats.com](https://llm-stats.com/benchmarks/tau-bench))

| Rank | Model | Overall |
|---|---|---|
| 1 | Claude Mythos Preview | 89.2% |
| 2 | Claude Sonnet 4.6 | 87.5% |
| 3 | Claude Sonnet 4.5 (retail 0.862) | 86.2% |

### HumanEval+ / MBPP+ ([EvalPlus](https://evalplus.github.io/leaderboard.html))

| Rank | Model | Pass@1 |
|---|---|---|
| 1 | Claude Sonnet 4.5 (HumanEval non-plus) | 97.6% |
| 2 | R1 | 97.4% |
| 3 | Grok 4 | 97.0% |
| — | Kimi K2 Base (third-party tracker) | 80.3% |

### GAIA / WebArena

| Rank | System | Score |
|---|---|---|
| GAIA #1 | Claude Sonnet 4.5 + HAL Generalist | 74.6% |
| WebArena #1 | Claude Mythos Preview | 68.7% |

---

## 6. What Is The Harness Doing That Accounts For +X

Based on the TERMINALBENCH_STRATEGY.md claims + source inspection:

| Technique | File | Measured lift (literature) | Is WOTANN code real? |
|---|---|---|---|
| Reasoning sandwich (xhigh-high-xhigh thinking budget) | `src/middleware/reasoning-sandwich.ts` | +5-8% | Real file exists (not inspected in this lane) |
| Pre-completion checklist | `src/hooks/benchmark-engineering.ts` | +5-8% (LangChain) | Real file exists |
| DoomLoop detection | `src/hooks/doom-loop-detector.ts` | +3-5% | Real file exists |
| Mandatory planning enforcement | `src/intelligence/amplifier.ts` | +15-30% (complex tasks) | Real file exists |
| Environment bootstrap | `src/middleware/local-context.ts` | +1-2% | Real file exists |
| Tool call correction | `src/hooks/benchmark-engineering.ts` | +1-2% | Real file exists |
| System reminders | `src/context/window-intelligence.ts` | +1-3% | Real file exists |

The top-ranked harnesses (Claude Mythos, ForgeCode, Terminus) achieve their ~2-6% scaffold delta through: (a) tight Docker sandbox loop with heartbeats, (b) aggressive tool-call auto-correction, (c) verifier sub-agents with fresh context, (d) reasoning sandwiches, (e) strategy escalation on repeated failures. WOTANN has the code for most of these — **but none of it is actually being measured** because there is no real benchmark runner wired to them.

---

## 7. WOTANN's Best-Case Realistic Score Today

Caveat: "today" means "if you git-clone `wotann`, set API keys, download corpora that exist, and invoke `runRealBenchmark()`". Scoring through WOTANN's CompletionOracle is not the same as the official grader, so what's below is a **model score on a proxy scoring path**, not a leaderboard-comparable number.

| Benchmark | Realistic WOTANN score today | What would lift it |
|---|---|---|
| TerminalBench 2.0 | **Cannot score officially.** On smoke corpus with Sonnet 4.5: ~3/5 tasks pass per CompletionOracle. On proxy-scored full corpus with Opus 4.7: 60-72% is a reasonable guess — below leader 82% because no Docker grader, no tmux, no real terminal state. | Wire `WOTANN_TB_REAL=1` to actual `terminal_bench` Python harness via `subprocess`. Download the 89-task corpus. Fix the broken `tbench-ai` URL (→ `laude-institute`). |
| SWE-bench Verified | **Cannot score officially.** CompletionOracle running `vitest + tsc` on WOTANN's own repo doesn't validate a django/sympy patch. The score is meaningless. | Wire `WOTANN_SWEBENCH_REAL=1` to `sb-cli` with Docker; apply the patch, run the pinned tests, score on FAIL_TO_PASS transition. |
| Aider Polyglot | **Cannot score officially.** Without per-language test-harness execution (`pytest -x`, `cargo test`, `go test`), pass@2 is a proxy. | Execute `task.testCommand` in a sandbox per task. Download 225-task corpus. |
| HumanEval+ / MBPP+ | **Cannot score officially.** EvalPlus tests are not running. | `pip install evalplus`, pipe model output to `evalplus.evaluate`. |
| LiveCodeBench | **Cannot score officially.** No judge. Contamination flag is recorded but doesn't affect scoring. | Integrate `lcb_runner` Python package. |
| τ-bench | **Cannot score officially.** Single-turn prompts are not τ-bench. Need a user simulator + trajectory scorer. | Wire sierra-research/tau2-bench (the fixed version) or port the trajectory scorer. |
| LongMemEval | **Partial.** Rule-based on 500-instance corpus with memory-stack mode: estimated **30-45% lenient, 20-30% strict**. With runtime mode (LLM synthesis) + OpenAI-judge scoring: estimated **55-75% band**. Not leader-class but publishable as a baseline. | Download the 500-instance corpus (URL is live). Add LLM-judge scorer. Use runtime mode. |

---

## 8. Top 5 Findings for Master Synthesis

1. **Every benchmark runner is a "honest shell" — no runner can produce a leaderboard-comparable number today.** All 5 runners hard-code `mode: "simple"` (terminal-bench.ts:360, swe-bench.ts:293, tau-bench.ts implicit, aider-polyglot.ts:300, code-eval.ts:327). None delegate to the official graders. Patches are extracted from transcripts but never applied; tests pinned to buggy commits are never run; Docker containers are never spun up. The "score" is WOTANN's own `CompletionOracle` running `vitest + tsc + biome` against the local WOTANN repo — which has nothing to do with the task. This is **not dishonest** (the runners honestly label `mode: "simple"` and document the gap) but it means any "WOTANN scores X%" claim today is ill-defined.

2. **`.wotann/benchmarks/` is empty. All runs today execute against 3-8 embedded smoke tasks.** TerminalBench smoke: 5 tasks (terminal-bench.ts:477). SWE-bench smoke: 3 synthetic. τ-bench smoke: 8/domain. Aider smoke: small. LongMemEval smoke: 10. None are leaderboard-valid, none are statistically meaningful.

3. **TerminalBench fetch URL is BROKEN.** `terminal-bench.ts:135` references `https://github.com/tbench-ai/terminal-bench` → HTTP 404. Real repo: `https://github.com/laude-institute/terminal-bench`. Users who run the documented `BlockedCorpusError` command will hit a clone failure. Also: `scripts/terminal-bench-extract.mjs` does not exist. Same concern for the `tau-bench`, `aider-polyglot`, `longmemeval` fetch commands — none of the extract scripts appear to be present.

4. **LongMemEval is the ONE benchmark with defensible plumbing, but the score will be substantially below leaders.** The FTS5 retrieval, per-instance isolation, and 5-ability scorer are real and well-written. However: (a) corpus is not downloaded — only the 10-instance smoke is used; (b) scorer is rule-based, not the paper's GPT-4o judge — systematically underestimates performance; (c) default mode is concatenation, not LLM-synthesized answer. Competitors on the leaderboard (OMEGA 95%, Mastra 95%, EverMemOS 83%, Supermemory, RetainDB 79%) all use LLM-generated synthesis + LLM-judge scoring — WOTANN's current ceiling with the rule-based path is probably in the 30-50% band for lenient scoring.

5. **Conspicuously absent: BFCL, GAIA, WebArena, BrowseComp, SWE-bench Pro, SWE-bench Live, RE-Bench.** WOTANN does not implement tool-calling evaluation (BFCL), general-assistant benchmarks (GAIA), autonomous browsing (WebArena), nor the contamination-free rolling SWE-bench Live. These are table-stakes for claiming harness leadership in April 2026. GAIA/WebArena leaders (Claude Sonnet 4.5 / Claude Mythos) all run inside third-party harnesses (HAL Generalist Agent) — WOTANN has the computer-use stack but doesn't integrate with the benchmarks that would measure it. Additionally: `BenchmarkHarness.runBenchmark()` (built-in) calls `simulateTestExecution()` which hard-codes `{passed: false, score: 0, actual: "placeholder-not-executed"}` at `benchmark-harness.ts:653-661` — any accuracy/memory-eval/open-swe number from that path is literally zero by construction.

---

## 9. Minimal Path to a Real, Publishable TerminalBench Score

If Gabriel wanted one credible benchmark number in a week:

1. Fix the fetch URL (`laude-institute/terminal-bench`, 1 LOC).
2. Write `scripts/terminal-bench-extract.mjs` to convert the Python task structure into JSONL (half a day).
3. Implement `WOTANN_TB_REAL=1` as a `child_process.spawn` to the `terminal-bench` Python CLI with the `--model` and `--agent` flags, where `--agent` points at a WOTANN-CLI wrapper that reads task from stdin and emits trajectory on stdout (2-3 days). This path already has the docker check + execFileSync imports staged.
4. Run 1 task end-to-end with Opus 4.7 via WOTANN; post trajectory + JSONL + per-task pass/fail to the internal docs. If it passes, run 10 tasks. Only then run 89.
5. Only after a real number on full corpus should the TerminalBench parity number in the report be updated; until then, reports should say `mode: simple, proxy score` prominently in the title — not tucked into metadata.

This plan requires zero new libraries; all pieces (docker, child_process, JSONL writer, trajectory sink) are already in place. The gap is solely the subprocess dispatch to the upstream harness.

---

## 10. Sources

- [TerminalBench 2.0 leaderboard (tbench.ai)](https://www.tbench.ai/leaderboard/terminal-bench/2.0)
- [Morph LLM — Terminal-Bench 2.0 analysis](https://www.morphllm.com/terminal-bench-2)
- [SWE-bench leaderboards](http://www.swebench.com/)
- [Marco Patzelt — SWE-Bench Verified March 2026](https://www.marc0.dev/en/leaderboard)
- [Aider LLM Leaderboards](https://aider.chat/docs/leaderboards/)
- [Epoch AI — Aider Polyglot](https://epoch.ai/benchmarks/aider-polyglot)
- [LongMemEval paper (arXiv 2410.10813)](https://arxiv.org/abs/2410.10813)
- [LongMemEval GitHub](https://github.com/xiaowu0162/longmemeval)
- [OMEGA benchmarks page](https://omegamax.co/benchmarks)
- [Mastra Observational Memory](https://mastra.ai/research/observational-memory)
- [Supermemory research](https://supermemory.ai/research/)
- [τ-bench leaderboard (taubench.com)](https://taubench.com/)
- [τ²-bench (sierra-research/tau2-bench)](https://github.com/sierra-research/tau2-bench)
- [BFCL V4 leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)
- [EvalPlus leaderboard](https://evalplus.github.io/leaderboard.html)
- [HAL GAIA leaderboard (Princeton)](https://hal.cs.princeton.edu/gaia)
- [WebArena](https://webarena.dev/)
- [SWE-bench Pro analysis](https://www.morphllm.com/swe-bench-pro)
- [SWE-bench Live](https://swe-bench-live.github.io/)
