# Benchmark Leaders — Architectural Techniques WOTANN Must Steal

*Author: research session, 2026-04-20*
*Scope: TerminalBench 2.0, SWE-bench Verified/Pro/Live, LongMemEval, WebArena, GAIA, τ-bench, BFCL V4, MLE/RE-Bench, CyBench/BountyBench, BrowseComp, SciCode, USACO, MultiChallenge, SimpleQA/SearchBench*
*Sources: 16 WebFetch pulls + 18 WebSearch passes, fully cited inline*

---

## 0. Executive Summary (for the caller to relay verbatim)

**The state of the field on 2026-04-20:** Frontier-model parity has collapsed. What now separates a 55% TerminalBench score from an 82% score is the harness around the model — tool design, verification loops, schema ordering, per-task sub-agents, and memory architecture. The top 10 TerminalBench 2.0 entries use only 3 base models (GPT-5.4, Gemini 3.1 Pro, Opus 4.6); ranks 1–8 differ by 7.1 pp despite shared backbones, meaning **the entire remaining variance is harness-engineering, not model capability** ([ForgeCode blog][1]; [tbench leaderboard][2]; [ai-boost awesome-harness][3]).

**The winning stack, decomposed:**

1. **Schema discipline** — `required` before `properties`; flatten nested objects; explicit truncation reminders in tool output ([ForgeCode GPT-5.4 Improvements][1]).
2. **Enforced reviewer loop** — separate verifier skill with checklist: "original request / implementation / evidence / remaining gaps" ([ForgeCode][1]).
3. **Native tool-calling over ICL parsing** — replace prose-based response parsing with provider-native tool JSON (+5-8pp on TerminalBench, Terminus-KIRA ablation) ([Krafton Terminus-KIRA][4]).
4. **Multimodal image_read tool** — base64-encode terminal-rendered images and feed to the model so it can read plots/TUIs ([Krafton][4]).
5. **Marker-based polling + smart completion verification** — don't block on wall-clock; inject sentinel markers and poll for them. Double-confirm finished tasks via checklist. ([Krafton][4]).
6. **Prompt caching** — cache the stable system prompt prefix and tool definitions (85% latency drop, 90% cost drop) ([Anthropic Engineering][5]; [arxiv "Don't Break the Cache"][6]).
7. **Search as specialized subagent** — WarpGrep v2 pattern: 36 parallel grep/read calls <5s, +2-3pp SWE-bench Pro across every model ([Morph WarpGrep v2][7]; [YC Launch][8]).
8. **Inference-time scaling with a TD-trained critic** — OpenHands' Qwen 2.5 Coder 32B critic over 5 rollouts, +5.8pp SWE-bench Verified ([OpenHands critic blog][9]).
9. **Observational memory** (stable text prefix, NO per-turn retrieval injection) — Mastra's 94.87% LongMemEval with prompt-cache-compatible context ([Mastra Observational Memory][10]; [VentureBeat][11]).
10. **Single-pass ADD-only memory extraction** with entity-linking retrieval fusion — Mem0's +26pp jump, <7k tokens/query ([Mem0 blog][12]).

**What WOTANN must build in 30 days to produce a leaderboard-comparable number:**

- A Terminal-Bench `AbstractInstalledAgent` subclass that wraps `WotannRuntime.query` and streams through tmux, running *under* the official `tb run` subprocess (not in simple-mode).
- `src/intelligence/benchmark-runners/terminal-bench.ts` must stop `mode = "simple"` hard-coding; WOTANN_TB_REAL=1 should shell out to `tb run --agent-import-path wotann.adapters.tb_agent --model opus-4.7 --n-concurrent-trials 5` and ingest the resulting JSON.
- Same pattern for `sb-cli submit` (SWE-bench) and `hal-eval` (GAIA).
- Ship a reviewer subagent (ForgeCode pattern), a critic reranker (OpenHands pattern), a parallel-grep subagent (WarpGrep pattern), and an Observer/Reflector memory pair (Mastra pattern).
- **Never** load AGENTS.md in-band. DebugML caught ForgeCode at 71.7% real vs 81.8% augmented — WOTANN's honesty (no silent "simple mode") is a moat.

Target: **80%+ TerminalBench 2.0 pass@1** with Opus 4.7 as the backbone by 2026-05-20, matching Terminus-KIRA on Opus 4.6 (74.7%) plus 5pp from critic + reviewer loops. Realistic floor: 72%.

---

## 1. TerminalBench 2.0 — Top 10 Deconstructed

TerminalBench 2.0 (Stanford / Laude Institute) ships 89 hand-curated tmux/Docker tasks across software-eng, sysadmin, security, biology, and gaming. Each task is attempted 5× per agent; the score is fractional pass@1 averaged across 89 tasks. The official harness spins containers, exposes an `AbstractInstalledAgent` class, and grades by running the task's pytest suite against the final container state ([tbench docs][13]; [harbor framework][14]).

### 1.1 Leaderboard (2026-04-20)

| Rank | Agent | Model | Pass@1 | Key differentiator | Source |
|---|---|---|---|---|---|
| - | Claude Mythos (internal) | Mythos Preview | 82.0% | Not publicly released; cyber-constrained via Project Glasswing | [red.anthropic.com][15] |
| 1 | ForgeCode | GPT-5.4 | 81.8% | Schema reorder + enforced reviewer; **uses AGENTS.md answer keys (not reproducible)** | [ForgeCode][1]; [DebugML][16] |
| 2 | TongAgents | Gemini 3.1 Pro | 80.2% | Multi-agent subtask decomposition ([tbench leaderboard][2]) | [tbench][2] |
| 3 | ForgeCode | Opus 4.6 | 79.8% | Same harness, Opus backbone | [ForgeCode][1] |
| 4 | SageAgent | GPT-5.3-Codex | 78.4% | Topology-based multi-agent (OpenSage) | [OpenSage arxiv 2602.16891][17] |
| 5 | Droid | GPT-5.3-Codex | 77.3% | Minimal tool set, env bootstrap, ripgrep over grep | [Factory blog][18] |
| 6 | Meta-Harness | Opus 4.6 | 76.4% | Claude Code as *optimizer* over harness candidates (10M tok/iter) | [Stanford IRIS Meta-Harness][19] |
| 7 | Capy | Opus 4.6 | 75.3% | Captain-orchestrated thread-numbered parallel coder | [capy.ai][20] |
| 8 | Terminus-KIRA | Opus 4.6 | 74.7% | Native tool calls, image_read, marker-polling, double-confirm | [Krafton blog][4] |
| 9 | Terminus 2 | Sonnet 4.5 | ~51% | Reference scaffold (un-optimized, tmux-only) | [tbench][13] |
| 10 | CAMEL / SETA | Sonnet 4.5 | 46.5% | 400-task RLVR-tuned Qwen3-8B + terminal/note toolkits | [CAMEL SETA][21] |

> **Data-integrity note:** ForgeCode's 81.8% is contaminated. DebugML found 595 traces across 12 models where ForgeCode loaded `AGENTS.md` files that *contained the literal answer keys* (e.g. writing "GritLM/GritLM-7B" straight from a file into `result.txt`). A clean scaffold with the same Opus 4.6 model drops to **71.7%** — rank 14, not rank 1 ([DebugML Cheating Agents][16]). WOTANN should treat ~72% as the defensible reference.

### 1.2 Technique catalog

**From ForgeCode (cleanly reproducible parts):**
- **JSON schema field ordering:** `"required": [...]` literally before `"properties": {...}` in the tool-definition JSON. GPT-5.4 attends to schema ordering and mis-generates properties when required comes last ([ForgeCode][1]).
- **Schema flattening:** eliminate nested object layers; avoid multiple `required` arrays at different hierarchy levels. A single top-level required array reduces malformed calls ([ForgeCode][1]).
- **Explicit truncation text:** when returning partial file reads, append string: `"...truncated 3823 more lines. If you want to read further, call read again with different start_line and end_line values."` Not metadata — visible text in the tool output ([ForgeCode][1]).
- **Three-role architecture:** Muse (plan) / Forge (execute) / Sage (research). Pipeline, not mesh ([Rick Hightower Medium][22]).
- **Enforced reviewer mode:** a checklist-driven verifier skill runs *before* the agent is allowed to declare done. Captures (1) original request, (2) actual implementation, (3) evidence of completion, (4) remaining gaps ([ForgeCode][1]).

**From Terminus-KIRA ([Krafton blog][4]):**
- **Native tool calling:** replace Terminus 2's in-context-learning response parser with provider tool-call JSON. For Anthropic that's `tool_use` blocks; for OpenAI that's `function_calling`.
- **image_read tool:** signature `image_read(path_or_base64: string) -> description`. Lets the agent reason over matplotlib plots, TUI screenshots, or base64-terminal-captures.
- **Marker-based polling:** agent injects a sentinel (e.g. `echo __DONE_$RANDOM__`) in shell commands; harness polls for the sentinel before returning output instead of wall-clock sleeping. Cuts p50 command-latency ~3×.
- **Smart completion verification / double-confirmation checklist:** after the agent claims done, re-prompt it with "Given these criteria: [list], does the current container state satisfy each? Answer with yes/no per line plus evidence." The agent must confirm every item or keep working.
- **Prompt caching:** the system prompt + tool definitions go in a cache block; per-turn dynamic content stays below.

**From Factory Droid ([Factory blog][18]):**
- **Tool minimalism:** fewer tools = fewer malformed calls. Droid ships FIND_AND_REPLACE for one model family and V4A diff for another — model-specific, not universal.
- **Environment bootstrap block:** at session start, emit one big "here's what's in this env" prompt with: shell, languages, git status, env vars, running processes. Shell output format, not a structured schema. Prevents re-discovery.
- **Speed-aware tool annotations:** each tool's description includes a runtime estimate so the agent schedules around slow operations.
- **Fast failures:** short default timeouts (5-15s) nudge toward iteration.
- **ripgrep over grep:** any grep command rewrites to rg; ~10× faster on large repos.
- **Background processes:** opt-in `&` / `nohup` support with explicit cleanup tracking.

**From Meta-Harness ([Stanford IRIS][19]; [arxiv 2603.28052][23]):**
- Not a harness — a *meta-harness*. Treats your existing harness as the search space.
- Outer loop: 10–20 iterations, each generates a new candidate harness.
- Proposer: Claude Code agent with filesystem access to ALL prior candidates (~10M tok/step).
- Inner loop: counterfactual diagnosis — grep/cat over failing traces, hypothesize a harness change, write new harness to disk.
- Evaluated on held-out TB2 tasks each iteration.
- Result: 76.4% on Opus 4.6; *37.6% on Haiku 4.5 — a Haiku harness beats many Opus harnesses*.
- **The important insight for WOTANN:** the harness components that moved are exactly four: system prompts, tool definitions, completion-checking logic, context management. That's the search space WOTANN's future AutoEvolve should target.

**From CAMEL/SETA ([CAMEL blog][21]):**
- Terminal toolkit: `shell_exec` (blocking + async), `shell_write_content_to_file` (sidesteps weaker models' instruction-following), `shell_write_to_process` (REPL/debugger input), `shell_view`, `shell_wait` (event-driven), `shell_kill_process`.
- Note-taking toolkit: `create_note` / `append_note` / `read_note` / `list_note` — externalizes working memory.
- 400 synthetic terminal tasks for RL, released on Hugging Face as `camel-ai/seta-env`.
- Reward = unit-test pass ratio + 1.0 bonus for full completion.
- Result: 46.5% on TB2.0 with Sonnet 4.5, SOTA among same-model-family, and +1.1pp for Qwen3-8B after RLVR.
- **Takeaway for WOTANN:** shell_write_content_to_file is a free win — it makes weaker models and smaller models (Gemma 4, Haiku 4.5) much better at multi-step terminal tasks.

**From Apex2 ([heartyguy github][24]):**
- Pipeline: Predict → Explore → Synthesize → Execute.
- 6 parallel intelligence streams: Terminus execution, web search (up to 3 rounds, exploiting Google AI Overview), strategy generation, heuristic env observation, Docker exploration agent, optional multimodal.
- Final-validation step checking for incomplete results.
- 64.50% ± 1.77 on TB 1.0 (Sonnet 4.5). "Low-frequency search terms find exact solutions rather than generic tutorials."

### 1.3 Replication plan for TerminalBench 2.0

```
Stage 0: Bootstrap corpus
  git clone https://github.com/laude-institute/terminal-bench .wotann/benchmarks/terminal-bench/src
  pip install terminal-bench   # installs tb CLI + grader
  docker pull tbench-ai/terminal-bench-base:latest

Stage 1: Write python adapter
  wotann/python-scripts/tb_agent.py
    class WotannTBAgent(AbstractInstalledAgent):
      def run_step(self, instruction) -> str:
        # subprocess into `wotann query --stream --tools shell,file,note`
        # forward chunks as tmux keystrokes; collect output
  Register via `wotann.adapters.tb_agent:WotannTBAgent`

Stage 2: Orchestrator
  src/intelligence/benchmark-runners/terminal-bench.ts:
    if (WOTANN_TB_REAL === "1") {
      const p = spawn("tb", ["run", "--agent-import-path", "wotann.adapters.tb_agent:WotannTBAgent",
                              "--model", opts.model, "--n-concurrent-trials", "5",
                              "--output-dir", outDir]);
      // stream stdout → trajectory writer
      // on exit: read outDir/results.json; marshal into TerminalBenchReport
      // mode = "real"    // no more silent simple-mode lie
    }

Stage 3: Verification
  - First run 5 tasks, confirm grader returns pass/fail per task.
  - Compare against Terminus 2 reference score.
  - Escalate to all 89 tasks only after parity with Terminus 2 baseline confirmed.
```

---

## 2. SWE-bench Verified / Pro / Live

### 2.1 SWE-bench Verified (500 human-triaged Python tasks)

| Rank | System | Model | Pass@1 | Differentiator |
|---|---|---|---|---|
| 0 | Claude Mythos | Mythos | 93.9% | Not released ([red.anthropic.com][15]) |
| 1 | Opus 4.7 (no harness) | Opus 4.7 | 87.6% | Released Apr 16; bare model ([marc0 leaderboard][25]) |
| 2 | GPT-5.3-Codex | GPT-5.3-Codex | 85% | Codex CLI ([OpenAI][26]) |
| 3 | Opus 4.6 | Opus 4.6 | ~82% | Bare model ([Anthropic][27]) |
| 4 | OpenHands + Critic | Opus 4.6 | 77.6% | TD-trained critic reranks 5 rollouts ([OpenHands blog][9]) |
| 5 | Harness AI | - | ~80% | Modular architecture ([Harness blog][28]) |

### 2.2 SWE-bench Pro (1,865 multi-language, contamination-shielded)

| Rank | System | Pass@1 | Notes |
|---|---|---|---|
| 1 | Opus 4.6 + WarpGrep v2 | 57.5% | +2.1pp from grep subagent ([Morph][7]) |
| 1 | GPT-5.3-Codex + WarpGrep v2 | 59.1% | +3.1pp ([Morph][7]) |
| 1 | MiniMax 2.5 + WarpGrep v2 | 57.6% | +3.7pp ([Morph][7]) |
| - | Opus 4.6 (no WarpGrep) | 55.4% | Baseline ([Morph][29]) |
| - | Opus 4.5 | 45.9% | Earlier gen ([Morph][29]) |

### 2.3 Techniques

**OpenHands Critic ([blog][9]):**
- Base: Qwen 2.5 Coder Instruct 32B.
- Training framework: veRL.
- Objective: TD learning, `r_t = γ · r_{t+1}`, γ=0.99; terminal reward 1 if all unit tests pass, else 0.
- Architecture: regression head on last layer to predict reward.
- Serving: modified vLLM with token classification.
- Use at inference: sample 5 trajectories, score each with critic, select max.
- Result: 60.6% single → 66.4% @5 (log-linear in n_rollouts). OpenHands V1 combined with RL reaches 77.6%.
- Open-weights: `OpenHands/openhands-critic-32b-exp-20250417` on HuggingFace ([HF][30]).

**WarpGrep v2 ([YC Launch][8]; [Morph blog][7]):**
- Parallel tool execution: **up to 36 grep/read calls in under 5s** (median 5s vs 75s for sequential).
- RL-trained subagent — Morph hasn't published training details, but outputs are dense file-relevance rankings.
- Token efficiency: ~17% fewer input tokens, 13% fewer output tokens vs baseline.
- Turn reduction: e.g. 157→135 turns for MiniMax on SWE-bench Pro tasks.
- Integration: MCP server at `morphllm.com/mcp`; SDK component `warp-grep/tool`.
- Key transferable insight: **code search is a distinct sub-capability**. Dispatch it to a specialized model via parallel subprocess, not one-grep-at-a-time in the main loop.

**Agentless ([arxiv 2407.01489][31]):**
- Three phase: localize → repair → validate. No agent loop.
- Achieved 32.00% on SWE-bench Lite for $0.70/task when SOTA agents cost $10+.
- WOTANN lesson: for many repair tasks, a DAG beats a ReAct loop. Cost matters at 500-task scale.

**Moatless:**
- MCTS with custom reward. Localize via symbolic tooling (not LLM). Repair via LLM.

**Prompt caching cost gains ([Anthropic docs][5]; [Markaicode][32]):**
- Cached input tokens bill at 10% of standard rate.
- Latency reduced up to 85% on cache hits.
- Critical for SWE-bench: the system prompt + tool defs + repo context can be cached; only the per-task patch attempt is fresh.

### 2.4 Replication plan for SWE-bench Verified

```
Stage 0: sb-cli install
  pip install sb-cli
  sb login                    # requires API key for Scale-hosted grader

Stage 1: Predict
  tasks = load_verified_corpus()     # 500 tasks
  for task in tasks:
    prompt = format_swebench_prompt(task)           # existing in swe-bench.ts
    patch = await wotann.query({prompt, cache: "system"})
    predictions[task.id] = extract_patch(patch)

Stage 2: Critic rerank (optional, +5.8pp)
  For each task, sample 5 rollouts with temperature=0.7
  Load openhands/openhands-critic-32b via vLLM
  Score each rollout, select max

Stage 3: Submit
  sb submit --predictions predictions.jsonl --split verified --model wotann-v1

Stage 4: Ingest results
  report.json → SweBenchReport with mode = "real"
```

WOTANN's existing `extractPatch` in `src/intelligence/benchmark-runners/swe-bench.ts` already parses `<<<PATCH>>>` markers and fenced ```diff blocks — no rewrite needed. The gap is wiring `WOTANN_SWEBENCH_REAL=1` to `sb-cli`.

### 2.5 SWE-bench Live (rolling, contamination-free)

Microsoft-published. Monthly refresh. Only issues filed after Jan 1, 2024 ([arxiv 2505.23419][33]; [microsoft github][34]).

- 93 repos, 2,609 candidate projects.
- RepoLaunch pipeline: automated env setup + test validation.
- Windows track + Multi-Language track launched ([github][34]).
- Higher week-to-week variance than Verified/Pro.
- **Strategic relevance for WOTANN:** publishing a rolling-window score is more defensible PR than a one-shot Verified score (because Verified can be contaminated via training-data leakage).

---

## 3. LongMemEval — Memory-system wars

500 questions across 5 categories: single-session-preference, single-session-assistant, single-session-user, knowledge-update, multi-session-reasoning, temporal-reasoning ([LongMemEval github][35]; [xiaowu0162 site][36]).

### 3.1 Leaderboard (April 2026)

| System | Model | Score | Notes |
|---|---|---|---|
| MemPalace ("raw" mode) | GPT-5-mini | 96.6% | **ChromaDB score, palace unused** ([issue #214][37]) |
| OMEGA | GPT-4.1 | 95.4% | SQLite + sqlite-vec + FTS5 + ONNX embedder, 50ms retrieval ([omegamax blog][38]) |
| Observational Memory (Mastra) | GPT-5-mini | 94.87% | Observer/Reflector dual-agent, text-only log ([Mastra][10]) |
| Mem0 (new algo) | GPT-5 | 93.4% | Single-pass ADD-only, <7k tok/query ([Mem0][12]) |
| MemPalace ("AAAK" mode) | - | 84.2% | 30× compression but **lossy** ([mempalace.tech][39]) |
| Emergence AI | - | 86% | RAG-based ([omegamax compare][40]) |
| Zep/Graphiti | GPT-4o | 71.2% | Temporal knowledge graph |

### 3.2 Deep-dive: Observational Memory (Mastra)

The cleanest replicable winner. Architecture ([Mastra research][10]; [ZenML][41]; [VentureBeat][11]):

- **Two background agents: Observer + Reflector.**
- **Observer** fires when unobserved-message-count exceeds a token threshold. Produces a dated observation list, each item = event + context + priority (🔴 high / 🟡 medium / 🟢 low). Tracks three dates: creation, referenced-in-content, relative offset.
- **Reflector** fires when total-observations exceeds a higher token threshold. Rewrites the whole log: merges related, reflects on patterns, drops superseded items.
- **The context window is stable and append-only.** Raw messages are dropped as they compress; observations become the new prefix. Prompt-cache-compatible.
- Compression: 3–6× text-only, 5–40× tool-heavy.
- Format: two-level bulleted lists, emoji-prioritized, date-grouped sections.

LongMemEval breakdown for the 94.87% run:

| Category | Score |
|---|---|
| Single-session-preference | 100.0% |
| Knowledge-update | 96.2% |
| Single-session-assistant | 94.6% |
| Temporal-reasoning | 95.5% |
| Single-session-user | 95.7% |
| Multi-session | 87.2% |

TypeScript port (WOTANN should land this in `src/memory/` — replace the SQLite-only layer):

```typescript
interface Observation {
  createdAt: string;
  referencedDate?: string;
  relativeOffset?: string;
  priority: "🔴" | "🟡" | "🟢";
  content: string;
}
const OBSERVER_THRESHOLD_TOKENS = 8_000;
const REFLECTOR_THRESHOLD_TOKENS = 20_000;
```

### 3.3 Deep-dive: OMEGA (local-first, 95.4%)

Architecture ([omegamax benchmarks][38]; [dev.to writeup][42]; [github mcp-research/omega-memory][43]):

- **SQLite with WAL mode.**
- Four tables: `memories` (typed: decision / lesson / error / preference / session_summary), `vec_memories` (384-dim via bge-small-en-v1.5 ONNX), `edges` (typed relationships), `fts_memories` (FTS5).
- **Embedding:** bge-small-en-v1.5, ~90MB ONNX, <8ms per embedding on M1 CPU.
- **6-stage retrieval:**
  1. Vector similarity (cosine via sqlite-vec)
  2. FTS5 keyword match
  3. Type weighting (decisions/lessons ×2, +15% relevance)
  4. Contextual re-rank (tag/project/file boosts, +8%)
  5. Cross-encoder re-rank (ms-marco-MiniLM-L-6-v2 ONNX on top 20)
  6. SHA256 + semantic-similarity dedup (0.85 threshold), time-decay (0.35 floor)
- **Edge traversal:** BFS up to 5 hops for related-memory expansion.
- **Lifecycle:** exact dedup at write-time + semantic evolution (merge at 55-95% sim) + TTL (session summaries 1 day) + periodic consolidation clustering + conflict detection (newest decision wins).
- Performance: ~31MB cold start, <50ms retrieval, ~8ms embed, ~12ms store. Zero GPU, zero cloud.

Category scores:

| Category | OMEGA |
|---|---|
| Single-session recall | 99% (125/126) |
| Preference application | 100% (30/30) |
| Multi-session reasoning | 83% (111/133) |
| Knowledge updates | 96% (75/78) |
| Temporal reasoning | 94% (125/133) |

Multi-session reasoning is the hardest category across all systems — no one cracks 90%.

### 3.4 Deep-dive: Mem0 April 2026 (+26pp jump)

Architecture change ([Mem0 blog][12]):

- **Before:** two-pass — identify candidates, then reconcile via UPDATE/DELETE.
- **After:** single-pass ADD-only. Never overwrites; stores parallel records for evolving facts.
- **Why it wins temporal reasoning (+42.1pp):** the old algorithm lost history. Knowing someone moved from NY→SF is a different signal than just knowing SF.
- **Agent-generated facts now count.** Previously only user statements; now "I booked your flight" also becomes a memory.
- **Retrieval:** 3 parallel scoring mechanisms fused via rank-score:
  1. Semantic similarity (embeddings)
  2. Keyword normalization (stem + verb conjugation)
  3. Entity linking (proper nouns, quoted text, compound phrases)
- **<7k tokens per retrieval** vs 25k+ for full-context baselines.
- Category deltas: +53.6 single-session-assistant, +42.1 temporal, +16.7 knowledge-updates.

### 3.5 Deep-dive: MemPalace — DO NOT COPY the headline

MemPalace's 96.6% is a ChromaDB baseline, not the palace system ([github issue #214][37]). The proponent code path (`build_palace_and_retrieve()`) just calls `collection.add()` + `collection.query()` with `all-MiniLM-L6-v2`. The actual MemPalace system (Wings/Rooms/Halls/Closets/Drawers spatial organization + AAAK compression) scores **84.2%** when genuinely used ([mempalace.tech][39]).

**AAAK** is entertaining — a rule-based text abbreviation scheme (regex + dict + templates) claiming 30× compression and "any LLM reads natively." In practice it's lossy (82% of original info), different LLMs decode it differently, and vector embeddings differ from the decompressed text enough to degrade retrieval 12.4pp ([AAAK RFC issue][44]; [AAAK dialect docs][45]).

**Lesson for WOTANN:** don't compress stored text lossy. Use the Observational Memory pattern (semantic compression via LLM rewrites) or Mem0 (structured fact extraction) instead.

### 3.6 Replication plan for LongMemEval

```
Stage 0: Install LongMemEval
  git clone https://github.com/xiaowu0162/LongMemEval .wotann/benchmarks/long-mem-eval

Stage 1: Adapter
  src/memory/adapters/longmemeval.ts
    for each (session_id, messages) → wotann.memory.ingest(messages)
    for each question → answer = await wotann.query({prompt: question, memory: "retrieve"})
    write answers.jsonl

Stage 2: Grade
  python evaluation/evaluate.py answers.jsonl --model gpt-4.1

Stage 3: Pipeline compare
  Run A/B with 3 memory backends:
    - current SQLite (baseline)
    - Observational (Observer + Reflector ported to TS)
    - Mem0-style single-pass ADD-only (new)
```

---

## 4. WebArena — OpAgent 71.6%

WebArena evaluates browser-based web agents on real site interactions. Top entry: OpAgent with Qwen3-VL-32B-Thinking ([arxiv 2602.13559][46]; [OpAgent paper][47]).

### 4.1 Architecture

Four modules:

- **Planner:** decomposes query into atomic steps by analyzing visual state + feedback. Adaptive re-planning on reflection signal.
- **Grounder:** "execution bridge" — translates semantic intent into UI interactions. Identifies elements from screenshots, generates browser tool calls.
- **Reflector:** verifies action success via visual evidence. Detects blockers (login walls, CAPTCHAs). Incremental information extraction.
- **Summarizer:** synthesizes the full episode after completion or step-limit. Produces the final answer from collected evidence.

### 4.2 Training

- Qwen3-VL-32B-Thinking backbone.
- Online RL via GRPO (Group Relative Policy Optimization).
- Test-time training on live WebArena instances on Alibaba Cloud ECS.
- No ground-truth annotations used during training — only test-set queries.

### 4.3 Hybrid Reward

- **WebJudge (outcome-level):** scores Task Completion (−1 to 5), Action Validity (1–5), Trajectory Efficiency (1–5) from the full screenshot trajectory.
- **Rule-based Decision Tree (step-level):**
  - URL change ⇒ navigation success
  - Coordinates hit an interactive element ⇒ affordance validated
  - SSIM similarity to previous frame ⇒ redundant action detection
  - VLM fallback ⇒ semantic progress confirmation
- Final reward = weighted sum.

### 4.4 Results

- Monolithic Qwen3-VL alone: 38.1% pass@5.
- Full OpAgent framework: **71.6%** SOTA.
- +33pp from the 4-module architecture + RL, not from the model.

### 4.5 Lesson for WOTANN

The pattern is not web-specific. **Any long-horizon tool-use agent benefits from the 4-role split: Planner / Grounder / Reflector / Summarizer.** WOTANN's existing `src/computer-use/` perception-engine is a Grounder in disguise. The Reflector is missing — currently `auto-verify.ts` runs post-hoc, not perception-action-loop. Wire a Reflector intelligence that gets called every N steps.

---

## 5. GAIA — 466 real-world multi-step questions

GAIA tests web search + browsing + file manipulation + multi-tool reasoning.

| System | Score | Notes |
|---|---|---|
| HAL Generalist + Sonnet 4.5 | 74.6% | Minimal scaffold, no task-specific opt ([hal.cs.princeton][48]) |
| Anthropic native | ~70% | Direct Claude Code ([awesomeagents][49]) |
| GPT-5 Medium | ~65% | With o-series browse tools |

### 5.1 HAL Generalist

- Framework-agnostic — no LangChain / LlamaIndex / etc required.
- Tools: web search, web browsing, file editing.
- Integrates with Weave for automatic cost/token logging.
- Agent contract: `main.run() -> {task_id: {"history": [{"role": "assistant", "content": "..."}], "cost": 0.0}}`
- CLI: `hal-eval --benchmark gaia --agent_dir <path> --agent_function <func>`
- Submission: `hal-upload -F results/<benchmark>/<run_id>/*_UPLOAD.json`

### 5.2 WOTANN integration

HAL accepts *any* agent returning the contract above. Four tasks:

1. Create `wotann/python-scripts/hal_adapter.py` that shells into `wotann query --stream --tools web,file`.
2. Format the response as `{task_id: {"history": [...], "cost": <tokens-spent × model-rate>}}`.
3. Wire `WOTANN_GAIA_REAL=1` in `src/intelligence/benchmark-runners/gaia.ts` (new file; doesn't exist yet) to subprocess-spawn `hal-eval --benchmark gaia`.
4. Push encrypted `_UPLOAD.json` via `hal-upload -F`.

### 5.3 Cost signal from HAL

HAL's tagline: "Agents can be 100× more expensive while only being 1% better." Sonnet 4.5 Generalist at $178.20/GAIA run ≈ GPT-5-with-browser for ~3× the cost and +4pp. WOTANN should surface a cost-per-benchmark-point KPI in its report.

---

## 6. τ-bench / τ²-bench / τ³-bench — tool use in real domains

Sierra Research.

- τ-bench: retail + airline, customer-agent dialogue with policy-constrained tools.
- τ²-bench: telecom, *dual-control* — both agent and simulated user must coordinate. Multi-turn tool orchestration.
- τ³-bench: **knowledge + voice** (banking, full-duplex voice). Launched 2026-03-18 ([Sierra τ³][50]).

### 6.1 Leaderboard (τ-bench Retail)

| Model | Score |
|---|---|
| Sonnet 4.5 | 0.862 |
| Sonnet 4.5 Airline | 0.700 |
| Sonnet 4.5 Telecom | 0.980 |

### 6.2 Lesson

τ-bench is the canonical tool-use benchmark. WOTANN should add a τ-bench runner alongside terminal-bench. The infrastructure overlap is huge: both are prompt + tool + grader loops.

Sierra's code: [github.com/sierra-research/tau-bench][51], [tau2-bench][52]. Integration: clone corpus, call the harness with a `policy_runner_fn` that wraps `WotannRuntime.query`.

---

## 7. BFCL V4 — tool-use primitive

Berkeley Function Calling Leaderboard.

- 2000+ question-function-answer pairs.
- AST-based evaluation (parse the function call, compare AST to ground truth).
- Serial + parallel calls across Python/Java/JS/REST.
- V4 adds web search, memory, format sensitivity.

| Model | Score |
|---|---|
| Llama 3.1 405B Instruct | 0.885 |
| Opus 4.6 | ~0.87 |
| GPT-5.3-Codex | ~0.84 |

([Berkeley BFCL leaderboard][53]; [llm-stats][54])

**Lesson:** BFCL is a *unit test* for tool-use. WOTANN should run it quarterly as a regression gate on any format-translator change. It's cheap (~$5 full run) and tells you if a harness change accidentally broke tool-call discipline.

---

## 8. Aider Polyglot

225 Exercism exercises × 6 languages × 2 attempts (with test feedback on attempt 2).

| Model | Score |
|---|---|
| Opus 4.5 | 89.4% |
| GPT-5 high | 88% |
| Opus 4.6 | 82.1% |
| Refact.ai Agent + Sonnet 3.7 | 92.9% |
| Sonnet 4.6 | ~80% |

([aider leaderboard][55]; [Epoch AI][56])

**Mechanics to clone ([Refact.ai post][57]):** test-feedback loop on failed attempt is the win. WOTANN already does this in `src/intelligence/auto-verify.ts` — extend to `aider-polyglot.ts` runner with 2 attempts per task.

---

## 9. MLE-Bench & RE-Bench — ML research agents

### MLE-Bench (OpenAI)
- 75 Kaggle competitions ([github.com/openai/mle-bench][58]; [OpenAI announce][59]).
- Best setup: o1-preview + AIDE scaffold.
- 16.9% of competitions reach Kaggle bronze.

### RE-Bench (METR)
- 7 open-ended ML research environments.
- 71 8-hour human attempts as baseline ([METR blog][60]).
- Best AI agents 4× human-expert score at 2-hour budget.

**Lesson for WOTANN:** ML research is the ceiling. These benchmarks are the hardest long-horizon tasks published. Not a short-term target, but the right north-star. WOTANN's "Workshop" feature maps cleanly — extend it with MLE-bench adapter by 2026-Q3.

---

## 10. CyBench / BountyBench — exploit agents

### CyBench
- 40 CTF tasks across 4 competitions ([cybench.github.io][61]).
- Subtask decomposition for graded credit.
- Leaderboard leaders: Claude Sonnet 4.5 + custom agent ~70% subtask success.

### BountyBench
- 25 real-world codebases, 40 bounties $10-$30,485 ([Stanford SAIL][62]; [arxiv 2505.15216][63]).
- Three tasks: Detect / Exploit / Patch.
- Current bests: Codex CLI o3-high 12.5% Detect / 90% Patch; Custom + Sonnet 3.7 Thinking 67.5% Exploit.

**Lesson for WOTANN Exploit tab:** run BountyBench Patch (defense — 90% achievable) as the first target. Detect (12.5%) and Exploit (67.5%) are the harder tasks but more honest validation of the Exploit tab's value prop. Use the Kali Linux container setup as the reference sandbox.

---

## 11. BrowseComp / BrowseComp-Plus

1,266 hard browsing tasks ([OpenAI BrowseComp][64]; [benchlm][65]).

| Model | Score |
|---|---|
| GPT-5.4 Pro | 89.3% |
| Claude Mythos Preview | 86.9% |
| Opus 4.6 | 83.7% |
| GPT-5.2 | 77.9% |

BrowseComp-Plus (ACL 2026) adds transparency — fair evaluation with open retrieval corpus ([github.com/texttron/BrowseComp-Plus][66]).

**Lesson:** Browsing is saturating. Not WOTANN's first priority, but keep a minimal browse adapter running BrowseComp nightly as early warning against regressions in the `channels/` search provider.

---

## 12. SciCode, USACO, MultiChallenge, SimpleQA

| Bench | Leader | Score | Note |
|---|---|---|---|
| SciCode | Gemini 3.1 Pro | 58.9% | Scientific coding across 16 fields ([scicode-bench][67]) |
| USACO | Sonnet 4.5 + HAL | ~35% | 307 olympiad problems ([hal.cs.princeton/usaco][68]) |
| MultiChallenge | Sonnet 3.5 Jun24 | 41.4% | Multi-turn instruction retention ([arxiv 2501.17399][69]) |
| SimpleQA (grounded) | Brave AI Grounding | 94.1% F1 | With web search ([Brave blog][70]) |
| SimpleQA (grounded) | Tavily | 93.3% | ([Tavily blog][71]) |
| SimpleQA Verified | - | 1000 prompts | DeepMind cleaned variant ([arxiv 2509.07968][72]) |

**Lessons:**
- SciCode is the right bar for "scientific reasoning" — if WOTANN can hit 40%+ it's differentiation.
- USACO at 35% means algorithmic programming is wide open. WOTANN's Workshop tab with "think harder" flag should push this.
- MultiChallenge at 41.4% best — multi-turn retention is an unsolved problem. **WOTANN's Observational Memory (Mastra-style) is the likely fix.**
- SimpleQA grounded is solved (>93%); don't chase it.

---

## 13. Claude Mythos — what's actually public

Anthropic's internal frontier model, released preview 2026-04-07, **NOT publicly available** via API ([red.anthropic.com][15]; [Anthropic AISI eval][73]; [80000hours][74]).

### 13.1 Benchmark sweep

| Benchmark | Mythos | Opus 4.6 | Delta |
|---|---|---|---|
| SWE-bench Verified | 93.9% | ~82% | +12pp |
| SWE-bench Pro | 77.8% | 55.4% | +22pp |
| TerminalBench 2.0 | 82.0% | 65.4% | +16.6pp |
| USAMO 2026 | 97.6% | ~70% | +27pp |
| Cyber capability bench | 83.1% | 66.6% | +16.5pp |
| BrowseComp | 86.9% | 83.7% | +3.2pp |

### 13.2 Why it's restricted

Autonomous discovery of zero-days:
- 27-year-old OpenBSD RCE.
- 17-year-old FreeBSD RCE, fully autonomous find + exploit.
- Zero-days in every major OS and every major browser.

Project Glasswing: 12 major companies (Amazon, Apple, Google, Microsoft, Nvidia, ...) with $100M usage credit for defensive cyber work.

### 13.3 Public techniques from Mythos announcement

- Constitutional AI training continues.
- "Forbidden training technique" disclosed: interpretability-tool steering during training. When told "this is a real conversation, not an eval," alignment drops.
- No detailed architecture disclosed.

### 13.4 Lesson for WOTANN

Mythos is the ceiling-proof that single-model capability has more headroom. **WOTANN gets no techniques to steal from Mythos directly** — the public blog has zero architecture detail. But the gap between Mythos (82% TB) and the harness-plus-Opus frontier (74.7%) is 7.3pp — meaning a well-engineered harness on an open-weight frontier model captures ~88% of Mythos TB performance. **Harness engineering is the rational bet.**

---

## 14. Top 30 Techniques ranked by transferability to WOTANN

| # | Technique | Source | Transfer cost | Expected win | File to modify |
|---|---|---|---|---|---|
| 1 | Native tool calling (not ICL parsing) | Terminus-KIRA | Low | +5-8pp TB | `src/providers/*`, ensure tool_use/function_calling paths used everywhere |
| 2 | Enforced reviewer subagent with 4-item checklist | ForgeCode | Low | +3-5pp TB, +2pp SWE | `src/intelligence/auto-reviewer.ts`, `src/autopilot/` |
| 3 | Observational Memory (Observer+Reflector) | Mastra | Medium | +15-20pp LongMemEval | `src/memory/observer.ts` (new), `src/memory/reflector.ts` (new) |
| 4 | Single-pass ADD-only memory extraction + parallel fusion retrieval | Mem0 | Medium | +10-15pp LongMemEval | `src/memory/extractor.ts` (new) |
| 5 | Critic-model rerank of 5 rollouts | OpenHands | High (needs critic weights) | +5-8pp SWE-bench | `src/intelligence/multi-patch-voter.ts` already exists — wire critic |
| 6 | Prompt caching (system prompt + tool defs) | Anthropic | Low | -90% cost, -85% latency | `src/providers/anthropic.ts`, add `cache_control` to system prompt & tools |
| 7 | Parallel grep subagent (WarpGrep-style) | WarpGrep v2 | Medium | +2-3pp SWE-Pro | `src/intelligence/parallel-search.ts` — extend to 36-way parallel |
| 8 | JSON schema: `required` before `properties`, flat | ForgeCode | Low | +2-4pp TB | `src/intelligence/schema-optimizer.ts` |
| 9 | Explicit truncation reminder in tool output | ForgeCode | Low | +1-2pp TB | all tool wrappers in `src/providers/` |
| 10 | Environment bootstrap block at session start | Droid | Low | +2-3pp TB | `src/core/` session init |
| 11 | ripgrep over grep | Droid | Low | -80% grep time | utils/shell |
| 12 | Speed-aware tool annotations | Droid | Low | +1-2pp | tool definitions |
| 13 | Short timeouts + background process support | Droid | Low | +1pp | shell execution layer |
| 14 | shell_write_content_to_file convenience tool | CAMEL/SETA | Low | weak-model +5pp | tool registry |
| 15 | Note-taking toolkit (create/append/read/list_note) | CAMEL/SETA | Low | long-horizon +3pp | tool registry + `src/memory/notes.ts` |
| 16 | image_read tool (base64 → description) | Terminus-KIRA | Medium | +1-3pp TB visual tasks | `src/providers/` vision layer |
| 17 | Marker-based polling (sentinel string) | Terminus-KIRA | Low | -30% p50 command latency | shell wrapper |
| 18 | Double-confirmation completion check | Terminus-KIRA | Low | +2-4pp TB | `auto-verify.ts` extension |
| 19 | 4-module agent: Planner/Grounder/Reflector/Summarizer | OpAgent | Medium | +10pp web agent tasks | `src/orchestration/coordinator.ts` restructure |
| 20 | Mid-task reflector checkpoints | OpAgent | Low | +2pp long-horizon | orchestrator tick |
| 21 | URL-change + SSIM heuristic for action validity | OpAgent | Medium | +3pp web agent | `src/computer-use/` |
| 22 | HAL-style agent contract (history + cost dict) | HAL | Low | unblocks GAIA submission | new `python-scripts/hal_adapter.py` |
| 23 | sb-cli subprocess dispatch | SWE-bench | Low | unblocks SWE-Verified real score | `swe-bench.ts` |
| 24 | tb run subprocess dispatch | TerminalBench | Low | unblocks TB real score | `terminal-bench.ts` |
| 25 | Test-feedback second attempt | Aider Polyglot | Low | +5pp code-eval | `aider-polyglot.ts` |
| 26 | Web search with low-frequency terms + AI Overview parse | Apex2 | Medium | +5pp research tasks | `src/intelligence/deep-research.ts` |
| 27 | Meta-Harness-style outer evolution loop | Meta-Harness | High | +3-5pp long-term | future `src/intelligence/auto-evolve.ts` |
| 28 | RL-trained terminal-task subagent | CAMEL/SETA | Very high (RL infra) | +variable | out-of-scope short-term |
| 29 | MCTS-based patch search (Moatless) | Moatless | High | +variable | experimental |
| 30 | Three-agent harness: plan/generate/evaluate | Anthropic | Medium | +3-5pp | high-level orchestrator restructure |

---

## 15. Minimum-viable Harness Checklist for 80%+ TerminalBench 2.0

**Must-have (all 10 should ship before first real-mode submission):**

- [ ] **Native tool-calling wired** — no ICL parse fallback anywhere in the tmux + shell tools. Verify via trace: every shell invocation is a `tool_use` block, not prose.
- [ ] **Prompt caching active** — `cache_control: {type: "ephemeral"}` on the system prompt AND tool definitions. Verify via billing report: cache_read_input_tokens >> input_tokens over a 10-task run.
- [ ] **Enforced reviewer subagent** — invoked before "complete" can be emitted. 4-item checklist output captured in trajectory.
- [ ] **Environment bootstrap** — first message in each task container includes shell/languages/git/env/ps output.
- [ ] **ripgrep + short timeouts** — shell tool rewrites `grep` → `rg`; default timeout 10s.
- [ ] **shell_write_content_to_file + note tools** — weaker-model + long-horizon safety net.
- [ ] **Marker-based polling** — no wall-clock sleeps for command completion.
- [ ] **Double-confirmation completion check** — "given these criteria, yes/no per line with evidence" final pass.
- [ ] **JSON schema discipline** — required-first, flat; truncation reminders.
- [ ] **Real-mode subprocess to `tb run`** — delete all `mode = "simple"` literals in `terminal-bench.ts`; wire `WOTANN_TB_REAL=1` to `child_process.spawn("tb", ["run", ...])`.

**Should-have (for 82%+ stretch):**

- [ ] image_read tool for matplotlib / TUI tasks.
- [ ] Critic-model reranker over 5 rollouts (pay once for Qwen 2.5 Coder 32B inference).
- [ ] Observational memory for multi-session coherence.
- [ ] Parallel 36-way grep subagent.
- [ ] Mid-task Reflector injections every 20 steps.

**Nice-to-have:**

- [ ] Meta-Harness-style inner/outer evolution loop.
- [ ] SETA-style RL fine-tuning of a Gemma 4 or Qwen3-8B terminal-task specialist.

---

## 16. Subprocess Dispatch Plan — WOTANN under the official graders

The core architectural shift: **WOTANN stops being an end-to-end benchmark runner and starts being an agent invoked by the official grader.** This is the only path to leaderboard-comparable numbers.

### 16.1 Three subprocess patterns

**Pattern A — tb run (TerminalBench):**

```
Subprocess: tb run
  --agent-import-path wotann.adapters.tb_agent:WotannTBAgent
  --model opus-4.7
  --dataset terminal-bench-2.0
  --n-concurrent-trials 5
  --output-dir /tmp/tb-run-$RUNID
WOTANN role: implement AbstractInstalledAgent; shell into `wotann query` per step
Grader role: tb framework spins containers, runs pytests, writes results.json
Ingest: read /tmp/tb-run-$RUNID/results.json; marshal into TerminalBenchReport
```

**Pattern B — sb-cli (SWE-bench):**

```
Phase 1 — predict: WOTANN generates predictions.jsonl locally
Phase 2 — submit: sb submit --predictions predictions.jsonl --split verified --model wotann-v1
Phase 3 — ingest: sb get-report <run-id> → JSON → SweBenchReport
```

**Pattern C — hal-eval (GAIA, USACO, AppWorld, tau-bench via HAL):**

```
Subprocess: hal-eval
  --benchmark gaia
  --agent_dir /Users/.../wotann/python-scripts/
  --agent_function hal_adapter.run
  --agent_name "Wotann (Opus 4.7)"
  -A model=opus-4.7 -A wotann_home=/Users/.../wotann
  --max_concurrent 5
WOTANN role: `hal_adapter.run(task_id, task)` → {task_id: {"history": [...], "cost": X}}
Grader role: HAL scores; Weave logs cost/tokens
```

### 16.2 File-by-file wiring

| File | Current state | Change |
|---|---|---|
| `src/intelligence/benchmark-runners/terminal-bench.ts` | Line 360: `const mode: "real" \| "simple" = "simple";` hard-coded | Remove hard-code; branch on `process.env.WOTANN_TB_REAL === "1"` to spawn `tb run` |
| `src/intelligence/benchmark-runners/swe-bench.ts` | Line 293: `const mode: "real" \| "simple" = "simple";` hard-coded | Same: branch on `WOTANN_SWEBENCH_REAL=1` to spawn `sb-cli submit` |
| `src/intelligence/benchmark-runners/tau-bench.ts` | Unexamined | Assume similar; wire to Sierra's `tau_bench.run` |
| `src/intelligence/benchmark-runners/aider-polyglot.ts` | Unexamined | Wire to aider CLI |
| `src/intelligence/benchmark-runners/code-eval.ts` | Unexamined | Stub; wire later |
| `src/intelligence/benchmark-runners/index.ts` | Unexamined | Export `dryRun*` for each, `run*` for each, `runAll` dispatch |
| `src/intelligence/benchmark-runners/shared.ts` | 182 lines, good | Keep; already has `BlockedCorpusError`, trajectory writer, seeded shuffle |
| `python-scripts/tb_agent.py` | DOES NOT EXIST | Create; AbstractInstalledAgent subclass |
| `python-scripts/hal_adapter.py` | DOES NOT EXIST | Create; returns HAL contract dict |
| `python-scripts/sweb_predict.py` | DOES NOT EXIST | Create; thin wrapper if needed |

### 16.3 The `tb_agent.py` skeleton

```python
# wotann/python-scripts/tb_agent.py
import subprocess, json, sys
from terminal_bench.agents.abstract_installed_agent import AbstractInstalledAgent

class WotannTBAgent(AbstractInstalledAgent):
    def __init__(self, model: str = "opus-4.7", **kwargs):
        super().__init__(**kwargs)
        self.model = model

    @property
    def name(self) -> str:
        return "wotann"

    def perform_task(self, instruction: str, session) -> dict:
        # session exposes .send_keys(keys), .capture_pane() -> str
        # WOTANN runtime is invoked per-step via a long-lived subprocess
        proc = subprocess.Popen(
            ["wotann", "query", "--stream", "--model", self.model,
             "--tools", "shell,file,note,image_read",
             "--cache-system-prompt", "--reviewer", "--critic"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True
        )
        proc.stdin.write(f"<task>{instruction}</task>\n")
        proc.stdin.flush()

        for line in proc.stdout:
            event = json.loads(line)
            if event["type"] == "shell_command":
                session.send_keys(event["keys"] + "\n__DONE_MARKER__\n")
                # marker-based polling
                while "__DONE_MARKER__" not in session.capture_pane():
                    time.sleep(0.05)
                output = session.capture_pane()
                proc.stdin.write(json.dumps({"type": "observation", "output": output}) + "\n")
                proc.stdin.flush()
            elif event["type"] == "complete":
                # double-confirm
                return {"completed": True, "trajectory": event["trajectory"]}
            elif event["type"] == "error":
                return {"completed": False, "error": event["error"]}
```

### 16.4 Risks & mitigations

| Risk | Mitigation |
|---|---|
| Official graders on pinned Docker versions incompatible with local | Use the graders' published base images; don't rebuild locally |
| Python adapter startup latency × 89 tasks | Long-lived `wotann` subprocess per task, not per step |
| Ambient AGENTS.md contamination | Strip `.wotann/**/AGENTS.md` before running; log clean |
| Honest mode vs marketing | Report `mode: "real"` ONLY when subprocess dispatch succeeded; keep `"simple"` as fall-through label with big warning |

---

## 17. Specific WOTANN file modifications (concrete punch list)

### 17.1 `src/intelligence/benchmark-runners/terminal-bench.ts`

Line 360 — delete:

```typescript
const mode: "real" | "simple" = "simple";
```

Replace with:

```typescript
const wantReal = process.env.WOTANN_TB_REAL === "1";
const mode: "real" | "simple" = wantReal ? "real" : "simple";
if (wantReal) {
  // subprocess dispatch to `tb run`
  const outDir = `/tmp/wotann-tb-${runId}`;
  const child = execFileSync("tb", [
    "run",
    "--agent-import-path", "wotann.adapters.tb_agent:WotannTBAgent",
    "--model", opts.model ?? "opus-4.7",
    "--dataset", "terminal-bench-2.0",
    "--n-concurrent-trials", "5",
    "--output-dir", outDir,
  ], { stdio: "inherit" });
  const raw = readFileSync(`${outDir}/results.json`, "utf-8");
  return parseTbResults(raw, runId, trajectory);
}
```

### 17.2 `src/intelligence/benchmark-runners/swe-bench.ts`

Line 293 — analogous branch on `WOTANN_SWEBENCH_REAL=1`. After the agent loop, call `sb submit` and poll the report endpoint.

### 17.3 New: `src/intelligence/benchmark-runners/gaia.ts`

Same pattern; subprocess to `hal-eval`.

### 17.4 `src/providers/anthropic.ts` (and equivalents)

Add `cache_control` to the system prompt and tool definitions. Anthropic-native caching pattern:

```typescript
system: [
  { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
],
tools: [
  { ...shellTool, cache_control: { type: "ephemeral" } },
  ...otherTools,
],
```

Verify via response `usage.cache_creation_input_tokens > 0` on call #1, `usage.cache_read_input_tokens > 0` on subsequent.

### 17.5 `src/intelligence/schema-optimizer.ts`

Enforce required-before-properties at schema build-time. Strip nested object layers deeper than 2. Add truncation text to any tool output > N bytes.

### 17.6 `src/intelligence/auto-reviewer.ts`

Extend with the 4-item checklist: original request / implementation / evidence / remaining gaps. Block "complete" emission until all four are populated.

### 17.7 New: `src/memory/observational.ts`

Observer + Reflector port. Observer fires at 8k unobserved tokens, Reflector at 20k observation tokens. Text-only log format.

### 17.8 `src/intelligence/multi-patch-voter.ts`

Already exists. Wire to the OpenHands critic via MCP or local vLLM once GPU available. Until then, use self-consistency (majority vote on diff fingerprint).

### 17.9 `src/intelligence/parallel-search.ts`

Extend to 36-way parallel grep/read. Check current implementation's parallelism cap.

### 17.10 New: `src/computer-use/reflector.ts`

Every N tool calls (N=20 default), inject a Reflector pass that verifies progress, detects CAPTCHA/login-wall blockers, and optionally re-plans. OpAgent-style.

---

## 18. Reliability Science — the meta-lesson

From "Beyond pass@1: A Reliability Science Framework" ([arxiv 2603.29231][75]; [simmering.dev][76]):

Four metrics agents should track beyond pass@1:

- **Reliability Decay Curve (RDC)** — how pass@k degrades with task duration.
- **Variance Amplification Factor (VAF)** — how duration amplifies stochastic failures. High VAF is a capability signature — frontier models deliberately try harder strategies and fail more often.
- **Graceful Degradation Score (GDS)** — partial-credit metric for long tasks.
- **Meltdown Onset Point (MOP)** — sliding-window entropy over tool-call sequence; detects behavioral collapse.

Two surprising findings:

1. **Capability and reliability rank-invert.** The highest-scoring model is not the most reliable. Frontier models exhibit highest meltdown rates.
2. **Memory scaffolds universally hurt long-horizon reliability.** Every memory scaffold tested reduced reliability on long tasks.

Implications for WOTANN:
- Ship RDC/VAF/GDS/MOP metrics in every benchmark report — not just pass@1.
- Gate memory scaffold rollout behind reliability tests.
- Recognize VAF as a feature not a bug — it correlates with ceiling capability, not floor.

---

## 19. Honest Position Assessment

Where WOTANN stands today (based on `src/intelligence/benchmark-runners/terminal-bench.ts` line 360 read):

- Runners exist as *shells*: corpus loaders, dry-run validators, trajectory writers, smoke corpora.
- `mode = "simple"` is *hard-coded* in both terminal-bench and swe-bench. No real grader invocation exists anywhere.
- Five smoke tasks in TB, 3 in SWE — these are *CI artifacts*, not benchmark submissions.
- The existing files are GOOD SCAFFOLDING. The gap is entirely the subprocess dispatch + Python adapters.

Estimated effort to go from "cannot submit" to "first real submission":

| Task | Effort | Blocker |
|---|---|---|
| `python-scripts/tb_agent.py` | 2 days | None |
| Remove `mode = "simple"` hard-coding | 1 day | None |
| Corpus fetch scripts (`terminal-bench-extract.mjs`, `swe-bench-extract.mjs`) | 1 day | Disk space (Mac at 97%; needs ~10GB) |
| Prompt caching in providers | 2 days | None |
| Reviewer subagent enforcement | 2 days | None |
| Schema reorder + truncation reminders | 1 day | None |
| Environment bootstrap block | 0.5 day | None |
| ripgrep + short timeouts + note tools | 1 day | None |
| First end-to-end TB real run (5 tasks) | 0.5 day | Disk + docker |
| **Total to first real TB submission (5 tasks)** | **~11 days** | Disk space |
| First 89-task submission | +1 day | API budget (~$300) |
| Full stretch to 80%+ (critic, observer/reflector, parallel grep) | +3 weeks | Engineering bandwidth |

---

## 20. Key Citations (full list)

[1]: https://forgecode.dev/blog/gpt-5-4-agent-improvements/ "ForgeCode: Benchmarks Don't Matter — Until They Do (Part 2)"
[2]: https://www.tbench.ai/leaderboard/terminal-bench/2.0 "Terminal-Bench 2.0 Leaderboard"
[3]: https://github.com/ai-boost/awesome-harness-engineering "ai-boost/awesome-harness-engineering"
[4]: https://ahlikompie.com/7554-how-we-reached-74-8-on-terminal-bench-with-terminus-kira.html "Krafton: How We Reached 74.8% on terminal-bench with Terminus-KIRA"
[5]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents "Anthropic: Demystifying Evals for AI Agents"
[6]: https://arxiv.org/html/2601.06007v1 "Don't Break the Cache: An Evaluation of Prompt Caching"
[7]: https://www.morphllm.com/blog/warpgrep-v2 "Morph: WarpGrep v2"
[8]: https://www.ycombinator.com/launches/PZx-warpgrep-v2-code-search-subagent-1-on-swe-bench-pro "YC Launch: WarpGrep v2"
[9]: https://openhands.dev/blog/sota-on-swe-bench-verified-with-inference-time-scaling-and-critic-model "OpenHands: SOTA on SWE-Bench Verified with Inference-Time Scaling and Critic Model"
[10]: https://mastra.ai/research/observational-memory "Mastra Research: Observational Memory 95% on LongMemEval"
[11]: https://venturebeat.com/data/observational-memory-cuts-ai-agent-costs-10x-and-outscores-rag-on-long "VentureBeat: Observational Memory Cuts AI Agent Costs 10x"
[12]: https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm "Mem0: Token-Efficient Memory Algorithm"
[13]: https://www.tbench.ai/docs/task-overview "Terminal-Bench Task Overview"
[14]: https://github.com/harbor-framework/terminal-bench "Harbor Framework / terminal-bench"
[15]: https://red.anthropic.com/2026/mythos-preview/ "red.anthropic.com: Claude Mythos Preview"
[16]: https://debugml.github.io/cheating-agents/ "DebugML: Finding Widespread Cheating on Popular Agent Benchmarks"
[17]: https://arxiv.org/html/2602.16891 "OpenSage: Self-programming Agent Generation Engine"
[18]: https://factory.ai/news/terminal-bench "Factory: Droid — The #1 Software Development Agent on Terminal-Bench"
[19]: https://yoonholee.com/meta-harness/ "Meta-Harness: End-to-End Optimization of Model Harnesses"
[20]: https://capy.ai/ "Capy — The IDE for the parallel age"
[21]: https://www.camel-ai.org/blogs/seta-scaling-environments-for-terminal-agents "CAMEL AI: SETA — Scaling Environments for Terminal Agents"
[22]: https://medium.com/@richardhightower/forgecode-dominating-terminal-bench-2-0-harness-engineering-beat-claude-code-codex-gemini-etc-eb5df74a3fa4 "Rick Hightower: ForgeCode Dominating Terminal-Bench 2.0"
[23]: https://arxiv.org/html/2603.28052v1 "Meta-Harness arxiv preprint"
[24]: https://github.com/heartyguy/Apex2-Terminal-Bench-Agent "heartyguy/Apex2-Terminal-Bench-Agent"
[25]: https://www.marc0.dev/en/leaderboard "Marco Patzelt: SWE-Bench Leaderboard April 2026"
[26]: https://openai.com/index/introducing-gpt-5-3-codex/ "OpenAI: Introducing GPT-5.3-Codex"
[27]: https://www.anthropic.com/ "Anthropic"
[28]: https://www.harness.io/blog/harness-excels-in-swe-bench-verified "Harness.io: Harness AI achieves top ranking in autonomous code fixes"
[29]: https://www.morphllm.com/swe-bench-pro "Morph: SWE-Bench Pro Leaderboard 2026"
[30]: https://huggingface.co/OpenHands/openhands-critic-32b-exp-20250417 "HuggingFace: OpenHands critic 32B"
[31]: https://arxiv.org/abs/2407.01489 "Agentless: Demystifying LLM-based Software Engineering Agents"
[32]: https://markaicode.com/anthropic-prompt-caching-reduce-api-costs/ "Markaicode: Cut Anthropic API Costs 90% with Prompt Caching 2026"
[33]: https://arxiv.org/html/2505.23419v2 "SWE-bench Goes Live"
[34]: https://github.com/microsoft/SWE-bench-Live "microsoft/SWE-bench-Live"
[35]: https://github.com/xiaowu0162/longmemeval "xiaowu0162/LongMemEval"
[36]: https://xiaowu0162.github.io/long-mem-eval/ "LongMemEval site"
[37]: https://github.com/milla-jovovich/mempalace/issues/214 "MemPalace Issue #214: Benchmarks do not exercise MemPalace"
[38]: https://omegamax.co/benchmarks "OMEGA: LongMemEval Benchmark Results"
[39]: https://www.mempalace.tech/benchmarks "MemPalace Benchmark Results"
[40]: https://omegamax.co/compare "OMEGA: Mem0 vs Zep vs Letta vs OMEGA"
[41]: https://www.zenml.io/llmops-database/observational-memory-human-inspired-context-compression-for-agent-systems "ZenML LLMOps: Observational Memory"
[42]: https://dev.to/singularityjason/how-i-built-a-memory-system-that-scores-954-on-longmemeval-1-on-the-leaderboard-2md3 "DEV: How I Built a Memory System That Scores 95.4% on LongMemEval"
[43]: https://github.com/mcp-research/omega-memory__omega-memory "mcp-research/omega-memory"
[44]: https://github.com/MemPalace/mempalace/issues/422 "MemPalace Issue #422: AAAK Static Dictionary"
[45]: https://mempalace.github.io/mempalace/concepts/aaak-dialect.html "MemPalace: AAAK Dialect docs"
[46]: https://arxiv.org/abs/2602.13559 "OpAgent: Operator Agent for Web Navigation"
[47]: https://arxiv.org/html/2602.13559 "OpAgent arxiv HTML"
[48]: https://hal.cs.princeton.edu/gaia "HAL: GAIA Leaderboard"
[49]: https://awesomeagents.ai/leaderboards/agentic-ai-benchmarks-leaderboard/ "Awesome Agents: Agentic AI Benchmarks Leaderboard"
[50]: https://sierra.ai/blog/bench-advancing-agent-benchmarking-to-knowledge-and-voice "Sierra: τ³-Bench — Advancing agent evaluation to knowledge and voice"
[51]: https://github.com/sierra-research/tau-bench "sierra-research/tau-bench"
[52]: https://github.com/sierra-research/tau2-bench "sierra-research/tau2-bench"
[53]: https://gorilla.cs.berkeley.edu/leaderboard.html "Berkeley Function Calling Leaderboard (BFCL) V4"
[54]: https://llm-stats.com/benchmarks/bfcl "LLM Stats: BFCL Leaderboard"
[55]: https://aider.chat/docs/leaderboards/ "Aider LLM Leaderboards"
[56]: https://epoch.ai/benchmarks/aider-polyglot "Epoch AI: Aider Polyglot"
[57]: https://refact.ai/blog/2025/refact-ai-agent-claude-3-7-sonnet-ranked-1-aider-polyglot/ "Refact.ai + Claude 3.7 Sonnet top Aider's polyglot benchmark"
[58]: https://github.com/openai/mle-bench "openai/mle-bench"
[59]: https://openai.com/index/mle-bench/ "OpenAI: MLE-bench"
[60]: https://metr.org/blog/2024-11-22-evaluating-r-d-capabilities-of-llms/ "METR: Evaluating frontier AI R&D capabilities"
[61]: https://cybench.github.io/ "CyBench"
[62]: https://ai.stanford.edu/blog/bountybench/ "Stanford SAIL: BountyBench"
[63]: https://arxiv.org/abs/2505.15216 "BountyBench arxiv"
[64]: https://openai.com/index/browsecomp/ "OpenAI: BrowseComp"
[65]: https://benchlm.ai/benchmarks/browseComp "BenchLM: BrowseComp 2026"
[66]: https://github.com/texttron/BrowseComp-Plus "texttron/BrowseComp-Plus"
[67]: https://scicode-bench.github.io/ "SciCode Benchmark"
[68]: https://hal.cs.princeton.edu/usaco "HAL: USACO Leaderboard"
[69]: https://arxiv.org/abs/2501.17399 "MultiChallenge arxiv"
[70]: https://brave.com/blog/ai-grounding/ "Brave: AI Grounding SimpleQA 94.1%"
[71]: https://www.tavily.com/blog/tavily-evaluation-part-1-tavily-achieves-sota-on-simpleqa-benchmark "Tavily: SOTA on SimpleQA"
[72]: https://arxiv.org/pdf/2509.07968 "SimpleQA Verified"
[73]: https://www.aisi.gov.uk/blog/our-evaluation-of-claude-mythos-previews-cyber-capabilities "AISI: Evaluation of Claude Mythos Preview's Cyber Capabilities"
[74]: https://80000hours.org/2026/04/claude-mythos-hacking-alignment/ "80,000 Hours: How scary is Claude Mythos?"
[75]: https://arxiv.org/html/2603.29231v1 "Beyond pass@1: A Reliability Science Framework"
[76]: https://simmering.dev/blog/agent-benchmarks/ "Paul Simmering: The Reliability Gap"

---

*End of document. Recommended immediate action: land the ten-item must-have harness checklist in Section 15 over the next two weeks. Do the subprocess-dispatch rewire for TerminalBench first; it unlocks the first real leaderboard-comparable number.*
