# Competitor Deep Extraction — Lane 6: Self-Evolution, Long-Horizon Autopilot, and Socratic Teaching

*Agent 6 of 8, deep-extraction sweep for WOTANN. Sources: 4 competitor repos (evolver/EvoMap, multica-ai, autonovel, deeptutor/HKUDS) plus 8 core self-evolution papers (Reflexion, Voyager, STaR, MIPROv2, GEPA, DGM, Agent-R, AI Scientist v2). Analysis date 2026-04-19.*

---

## 0. Executive Summary

WOTANN ships a **15-file, ~5,100 LOC learning subsystem** (`src/learning/*.ts`) that is, per the Apr-13 / Apr-14 audits, **mostly inert**. The capabilities exist as well-designed, side-effect-free classes (GEPA optimizer, Darwinian evolver, MIPROv2, DreamPipeline, InstinctSystem, SkillForge, PatternCrystallizer, CrossSessionLearner, DecisionLedger, NightlyConsolidator, FeedbackCollector, ReflectionBuffer, SelfEvolutionEngine), and **some sites are wired** (`runtime.ts:1229` calls `instinctSystem.observe`, `runtime.ts:1306,2573` calls `crossSessionLearner.recordAction`, `runtime.ts:4524` calls `runDreamConsolidation`, `runtime.ts:4458` calls `skillForge.analyzeSession`), but **the feedback, reflection, and pattern crystallizer producers are not plumbed into the pipeline — no source calls `feedbackCollector.recordFeedback`, no source calls `patternCrystallizer.recordPattern` with actual tool runs, no source calls `reflectionBuffer.add`, and the `SelfEvolutionEngine` is instantiated in `kairos.ts:159` with no producer of evolution actions**. The library is near-complete; the harness that feeds it is not.

The four competitor repos and eight research papers collectively demonstrate that **the missing piece is the execution-trace → reflection → consolidation pipeline**, not the algorithms. WOTANN already has more sophisticated primitives (GEPA, DGM-style evolver) than any of the four repos; what it lacks is the equivalent of:

- **Evolver's** "memory dir → extract signals → select Gene → emit GEP prompt → append EvolutionEvent" loop (where the loop actually runs every cycle, wired via `node index.js --loop`)
- **Voyager's** "execution result → self-verify → skill library" closed loop where every completed task produces a new `.ts` skill
- **Autonovel's** "artifact → evaluate.py → keep-if-improved, git-reset-if-not" per-iteration decision
- **DeepTutor TutorBot's** heartbeat that fires every 30 min to check HEARTBEAT.md and run proactive work
- **Reflexion's** three-step (actor → evaluator → self-reflection) with reflection written to episodic memory before next trial
- **DGM's** archive-of-agents where every self-modification is validated on SWE-bench before commit

A **wire-up plan in §8** turns the existing 5,100 LOC from library to live learning system with an estimated 400-500 LOC of integration code plus 3 new event hooks.

---

## 1. Repository-by-Repository Extraction

### 1.1 Evolver (EvoMap) — protocol-bound self-evolution engine

**Repo**: `/Users/gabrielvuksani/Desktop/agent-harness/research/evolver`. Node.js, obfuscated core (source distributed in scrambled form to protect IP), but the public README and GEP asset files (`assets/gep/genes.json`, `capsules.json`, `events.jsonl`) fully document the architecture.

**Core mechanism** (from README):
```
memory/ (runtime logs, errors)
  downscan for signals (errors, patterns)
selector.js: pick best-matching Gene by signals_match
  down
prompt.js: emit protocol-bound GEP prompt
  down (host runtime executes or human applies)
solidify.js: run Gene.validation[] commands -> keep/rollback
  down
append EvolutionEvent to events.jsonl (audit trail)
```

**Gene structure** (from `assets/gep/genes.json`):
```json
{
  "id": "gene_gep_repair_from_errors",
  "category": "repair",
  "signals_match": ["error", "exception", "failed", "unstable"],
  "preconditions": ["signals contains error-related indicators"],
  "strategy": [6-step repair procedure],
  "constraints": {"max_files": 20, "forbidden_paths": [".git", "node_modules"]},
  "validation": ["node scripts/validate-modules.js ..."]
}
```

**Key insight**: Evolver treats **every evolution step as a structured, auditable event**. Each Gene has explicit `preconditions`, a fixed `strategy` list, hard `constraints` (max files, forbidden paths), and **machine-checkable `validation` commands**. The selector scores candidate Genes by signal match, emits a strict prompt, then `solidify.js` enforces validation before committing. Failed validations roll back.

**Strategy presets** (`EVOLVE_STRATEGY=balanced|innovate|harden|repair-only`) control the intent balance — 80% innovate in stable systems, 80% repair in emergency, etc. This is a **meta-control** over the evolution intent.

**What WOTANN has vs. what's missing**:

| Evolver primitive | WOTANN equivalent | Status |
|---|---|---|
| `memory/` scan for signals | `MemoryStore.getAutoCaptureEntries()` -> `autodream.phaseRecall` | WIRED (session-close) |
| Gene selection by signals_match | `NightlyConsolidator.extractErrorRules` by pattern count | PARTIAL — no explicit Gene library |
| Strategy presets (balanced/harden) | None | MISSING |
| Machine-checkable validation commands | None in learning — uses `patch-scorer` indirectly via `DarwinianEvolver.evaluate` | MISSING at learning layer |
| EvolutionEvent append to audit log | `SelfEvolutionEngine.logAction` -> `evolution-log.jsonl` | WIRED but no producer |
| Worker-Pool via heartbeat | `KairosDaemon` has heartbeat tick (15s) | PARTIAL — no work queue |
| Self-repair wake trigger (`src/ops/trigger.js`) | None | MISSING |

### 1.2 multica-ai — AI-native task management with agents as first-class citizens

**Repo**: `/Users/gabrielvuksani/Desktop/agent-harness/research/multica`. Go backend + Next.js/Electron frontend. Agents are **polymorphic assignees** (like members) — they can be assigned issues, comment, change status.

**Core mechanism** (from `CLAUDE.md`):

- **Polymorphic assignees** (`assignee_type` + `assignee_id`) — agents and humans share the assignee slot. An agent can own an issue just like a human.
- **Local daemon + cloud runtimes** for agent execution. Each workspace has its own DB (multi-tenant via `workspace_id` filter on every query).
- **Strict state split**: TanStack Query for server state (WS invalidates cache), Zustand for client state. Critically: "WS events invalidate queries — they never write to stores directly." This is a **single source of truth** rule that prevents drift.
- **Mutations are optimistic by default**: apply locally, send request, roll back on failure, invalidate on settle. User doesn't wait for server.

**Key insight for self-evolution**: Multica treats agents **on equal footing with humans for accountability**. An agent that fails its issue is visible in the workspace UI — a human can see, reassign, override. This is **accountability plumbing** that WOTANN's autonomous mode currently lacks.

**What WOTANN should adopt from multica**:

1. **Agent-as-assignee pattern for autopilot**: when WOTANN autopilot works on a task, the task object should have `assignee_type = "agent"` and `assignee_id = agent_id` in the task store. This makes it trivially inspectable.
2. **Single source of truth rule**: currently WOTANN duplicates state between session, sessionStore, autoDream outputs, DecisionLedger, MemoryStore. Adopt multica's "DB is truth, invalidate on event" rule.
3. **Optimistic UI pattern for learning writes**: when the learning stack emits a skill, show it in the UI immediately (optimistic), rollback if the write fails. This hides consolidation latency.

### 1.3 Autonovel — long-horizon self-writing pipeline (inspired by karpathy/autoresearch)

**Repo**: `/Users/gabrielvuksani/Desktop/agent-harness/research/autonovel`. 27 Python scripts, produced *The Second Son of the House of Bells* (19 chapters, 79,456 words, 6 automated revision cycles + 6 Opus review rounds). The canonical example of a **long-horizon autonomous agent loop** that runs for 15-30 hours of API time.

**Pipeline** (from `PIPELINE.md`):

```
Phase 0: Setup (branch, .env, seed)
Phase 1: Foundation loop
  WHILE foundation_score < 7.5:
    generate weakest layer (world / chars / outline / voice / canon)
    evaluate_foundation()
    IF improved: git commit
    ELSE: git reset --hard HEAD~1

Phase 2: First Draft
  FOR each chapter:
    FOR attempt 1..5:
      draft_chapter()
      evaluate_chapter()
      IF score > 6.0: commit, break
      ELSE: reset
    mechanical_slop_pass()

Phase 3a: Revision cycles
  WHILE improvement > 0.5:
    adversarial_edit() -> tag cuts (OVER-EXPLAIN, REDUNDANT)
    reader_panel() -> 4-persona consensus
    FOR consensus item:
      generate_brief() -> gen_revision() -> evaluate
    full_eval()

Phase 3b: Opus review loop (dual-persona: literary critic + professor)
  WHILE major_unqualified_items > 2:
    review.py -> extract items
    fix top items via gen_brief + gen_revision

Phase 4: Export (LaTeX, ePub, audiobook, landing page)
```

**Three crucial patterns**:

1. **Keep-if-improved, reset-if-not**: every autonomous change is gated by an evaluator. If the new version scores worse, `git reset --hard HEAD~1`. This prevents drift. **WOTANN has this primitive in `DarwinianEvolver.evaluate -> compare baseline`, but it's not applied to the learning artifacts themselves** — dream outputs, instincts, skills are all merged in without a "does this make the system better" check.
2. **Plateau detection**: "Stop if |delta-score| < 0.5 across 2 consecutive cycles." This is a deterministic stopping rule. **WOTANN has early-stop patience in GEPA but doesn't apply it to the end-to-end autopilot loop**.
3. **Dual-persona final review**: after automated cycles, Opus reviews as both critic AND professor, with explicit stopping conditions ("<=2 items", ">=50% qualified hedges"). **WOTANN has multi-model review (`wotann review`) but lacks the qualified-hedge stopping criterion**.

**Two immune systems** (from `evaluate.py`):
- **Mechanical** (regex, no LLM): scans for banned words, fiction clichés, show-don't-tell, sentence uniformity. Fast, free.
- **LLM judge** (separate model): scores prose quality, voice adherence, beat coverage.

**Most adoptable for WOTANN**: the **orchestrator pattern** (`run_pipeline.py`) that loops per-phase with score-gated commits. WOTANN's autopilot (`src/orchestration/ralph.ts` and similar) has tools but no `keep-if-improved` gate.

### 1.4 DeepTutor (HKUDS) — persistent tutoring agents with Socratic teaching

**Repo**: `/Users/gabrielvuksani/Desktop/agent-harness/research/deeptutor`. 200k LOC, agent-native architecture. Two agent tiers: **capability agents** (Chat / Deep Solve / Quiz / Deep Research / Math Animator in `deeptutor/agents/*`) and **TutorBot instances** (persistent multi-agent in `deeptutor/tutorbot/*`).

**Key patterns for WOTANN**:

**A. Heartbeat service** (`tutorbot/heartbeat/service.py:40-150`). Runs every 30 min (configurable), reads `HEARTBEAT.md`, asks LLM via a **virtual tool call** (`heartbeat(action: "skip" | "run", tasks: string)`) whether there are active tasks. If `run`, executes via `on_execute` callback. This is a **proactive agent wake-up** — no user input required.

**B. Two-phase decision**: Phase 1 (decide via virtual tool) avoids brittle free-text parsing. Phase 2 (execute) only triggers on `run`. The virtual tool call gives a structured, validated decision. **WOTANN has heartbeat ticks but no equivalent of the virtual decision tool**.

**C. TutorBot architecture** (`tutorbot/agent/loop.py:36-200`):
```
MessageBus -> AgentLoop._process_message
  -> ContextBuilder (history + memory + skills)
  -> MemoryConsolidator
  -> LLMProvider.chat
  -> ToolRegistry.execute (SpawnTool, TeamTool, CronTool, MessageTool)
  -> SubagentManager (isolated subagents with own bus)
  -> TeamManager (parallel workers, up to 5)
```

The `AgentLoop` runs **max_iterations=40** by default, **context_window_tokens=65,536**. `SubagentManager` spawns isolated subagents, `TeamManager` parallelizes up to 5 workers. **WOTANN has wave/subagent patterns in `src/orchestration/` but lacks the MessageBus decoupling** — WOTANN's runtime is more monolithic.

**D. Socratic teaching pattern** (`agents/guide/guide_manager.py`):
- `GuidedSession` holds: `knowledge_points`, `current_index`, `chat_history`, `status`, `html_pages`
- Flow: `DesignAgent` -> learning plan (3-5 knowledge points) -> `InteractiveAgent` per point (with contextual Q&A) -> `SummaryAgent` at end
- Each knowledge point becomes a rich visual HTML page with explanations, diagrams, examples

**E. Unified chat workspace with 5 modes sharing one context** (`agents/chat`, `solve`, `research`, `question`, `math_animator`). Not mode-locked — user can chat, escalate to Deep Solve, generate quizzes, Deep Research, all in one thread. **WOTANN has 4 tabs (Chat/Editor/Workshop/Exploit) — adopting the shared-context model would be a UX win**.

**F. SKILL.md for agent-native CLI** (from `deeptutor/SKILL.md`). Every CLI command documented for AI agents to autonomously operate DeepTutor. Hand the file to any tool-using agent -> it can configure DT from scratch. **WOTANN has skills but no equivalent external-agent-onboarding SKILL.md**.

**G. Persistent memory: Summary + Profile** (from README). Summary = learning progress digest. Profile = learner identity (preferences, knowledge level, goals, communication style). Shared across all features and TutorBots. **WOTANN has MEMORY.md + USER.md + IDENTITY.md + SOUL.md — more granular, but also more fragmentary**. DeepTutor's simpler 2-block model is more maintainable.

**Most adoptable**: 
1. **Heartbeat-with-virtual-tool pattern** for WOTANN's KAIROS daemon — turn the current "heartbeat tick" into "ask LLM via virtual tool: should I wake up?"
2. **Guide agent -> Socratic teaching** for WOTANN's explanatory mode (when user asks "teach me X" or "walk me through Y")
3. **Unified workspace with shared context** for the 4 WOTANN tabs
4. **Profile + Summary memory model** to replace the 4-file `MEMORY.md/USER.md/IDENTITY.md/SOUL.md` sprawl with a 2-block model

---

## 2. Paper-by-Paper Extraction

### 2.1 Reflexion (Shinn et al., NeurIPS 2023, arXiv:2303.11366)

**Core mechanism**: three-step verbal reinforcement learning without weight updates.
1. **Actor**: current policy generates action/trajectory
2. **Evaluator**: binary or scalar reward (external test / internal simulation)
3. **Self-Reflection**: on failure, actor generates verbal reflection about *why* it failed
4. Reflection is **stored in episodic memory** and prepended to next trial's prompt

**Key insight**: the reflection string itself IS the learning signal. No gradient updates needed.

**WOTANN alignment**:
- `ReflectionBuffer` (src/learning/reflection-buffer.ts, 200 LOC) is a direct implementation of Reflexion's episodic memory
- Stores tuples `{context, mistake, correction, tags}` with hit-count boost for retrieval relevance
- `formatForPrompt()` renders entries as a system-prompt-injectable block

**Gap**: `ReflectionBuffer` has **zero callers in `src/`** (confirmed via grep). It's a library waiting for a producer. The producer should be:
- After a failed test/build, extract `{mistake, correction}` from the stderr and the fix diff, call `reflectionBuffer.add()`
- Before each new session or at context-relevance time, call `reflectionBuffer.retrieve({tags: [current_domain]})` and inject via `formatForPrompt()` into the system prompt

**Wire-up effort**: ~50 LOC in `runtime.ts` (2 hook points: post-failure capture + pre-prompt inject).

### 2.2 Voyager (Wang et al., 2023, arXiv:2305.16291)

**Core mechanism**: open-ended lifelong agent with 3 components:
1. **Automatic curriculum**: GPT-4 proposes next task to maximize exploration ("what's an interesting next goal?")
2. **Ever-growing skill library**: executable `.js` code for Minecraft actions, indexed by description embedding, retrieved by task similarity
3. **Iterative prompting**: environment feedback + execution errors + self-verification -> refine code until it works

**Results**: 3.3x more unique items, 15.3x faster tech-tree milestones than prior SOTA.

**Key insight**: skills compose — `collectWood()` is used inside `craftPickaxe()`, which is used inside `mineStone()`, etc. The library **compounds** over time.

**WOTANN alignment**:
- `SkillForge` (src/learning/skill-forge.ts, 673 LOC) is Voyager's skill library — it takes `SessionAction[]`, detects repeating patterns, generates `SkillDefinition` with `trigger` and `steps`, writes `SKILL.md`
- `PatternCrystallizer` (src/learning/pattern-crystallizer.ts, 303 LOC) is a specialized variant for tool-sequence patterns (MIN_USES=5, MIN_SUCCESS_RATE=0.70 — matching Voyager's threshold)

**Gaps**:
1. **No curriculum producer**: WOTANN has no equivalent of "what's an interesting next goal?" — currently the user always initiates. For autopilot beyond a single task, WOTANN needs a curriculum module.
2. **No skill retrieval by embedding**: `SkillForge.getRelevantLearnings` uses keyword matching, not semantic embedding. For the library to compound past ~100 skills, needs vector retrieval.
3. **No compositional skill execution**: when WOTANN writes a skill, nothing verifies it can be called from another skill. Voyager verifies every skill before adding to library.
4. **`PatternCrystallizer` has no live producer**: `recordPattern()` is only called in tests. Needs to be called after every tool-sequence completion.

**Wire-up**: ~200 LOC. Biggest item is embedding-based skill retrieval (can reuse `memory/store.ts` FTS5 or add sqlite-vss vector search).

### 2.3 STaR — Self-Taught Reasoner (Zelikman et al., NeurIPS 2022, arXiv:2203.14465)

**Core mechanism**: bootstrap reasoning from few examples.
```
Loop:
  Generate rationale + answer for each training example (few-shot prompt)
  For each problem answered wrong:
    RATIONALIZE: generate rationale given correct answer (backward reasoning)
  Fine-tune on (rationale, correct answer) pairs
  Repeat
```

**Key innovation**: **rationalization** — on failure, show the model the correct answer and ask "generate a reasoning that leads to this answer." This produces training data for hard problems without expensive human labeling.

**WOTANN alignment**: none directly — WOTANN doesn't fine-tune. But the **pattern is applicable to prompt bootstrapping**:
- `MIPROv2Optimizer` (src/learning/miprov2-optimizer.ts, 183 LOC) does the bootstrap step: run current prompt, keep successful input/output pairs as demos
- Could extend with STaR-style rationalization: on failed training examples, ask LLM "given the expected output, generate the reasoning that would lead to it" -> add that reasoning as a demo

**Gap**: `MiproV2Optimizer.bootstrapFewShot` only keeps **already-correct** demos. Adding rationalization (produce a rationale from the known-correct answer on failed cases) could meaningfully improve hard problems.

**Wire-up**: ~30 LOC extension to `miprov2-optimizer.ts`.

### 2.4 DSPy MIPROv2 (Opsahl-Ong et al., 2024, arXiv:2406.11695)

**Core mechanism**: jointly optimize instructions AND few-shot demos per predictor in a multi-stage program.
1. **Proposal Phase**: program-aware and data-aware instruction proposals generated upfront
2. **Optimization Phase**: Bayesian Optimization searches for the best (instruction, demo-set) combination
3. Stochastic mini-batch evaluation (surrogate model) to cut eval cost
4. Meta-optimization refines how LMs construct proposals over time

**Results**: up to 13% accuracy gain on 5 of 7 benchmarks using Llama-3-8B.

**WOTANN alignment**:
- `miprov2-optimizer.ts` implements step 1's **bootstrap** (simpler than the full MIPROv2 paper — no Bayesian Opt, no meta-optimization)
- The file comment is explicit: "*This is simpler than GEPA — no full evolutionary loop needed — and often gets you 70% of the improvement in 30% of the LLM calls.*"

**Gap vs. full MIPROv2**:
1. **No Bayesian Optimization over (instruction, demo-set) pairs** — WOTANN's version does a single-pass bootstrap
2. **No program-aware instruction proposals** — WOTANN doesn't inspect the DSPy program structure (because WOTANN isn't a DSPy program)
3. **No surrogate model for cheap mini-batch eval** — every eval runs the full agent

**For WOTANN to reach full parity** would require ~300 LOC and adding a Bayesian Opt library. Current gap is acceptable for an agent harness (vs. a DSPy program optimizer). **The 70% @ 30% claim is the right tradeoff**.

### 2.5 GEPA (Agrawal et al., ICLR 2026 Oral, arXiv:2507.19457)

**Core mechanism**: **reflective prompt evolution** with Pareto selection.
1. Sample trajectories (reasoning + tool calls + outputs)
2. **Reflect in natural language**: diagnose problems, propose prompt updates, combine lessons
3. **Pareto frontier**: maintain the set of candidates each best on >=1 eval instance — not just the global best
4. Mutate by sampling from the frontier each iteration
5. Text feedback from users guides optimization

**Results**: beats GRPO (RL baseline) by 10% average, 19% on specific tasks, with **35x fewer rollouts**. Surpasses MIPROv2 by +13% aggregate.

**Key insight**: **Pareto frontier sampling** "illuminates the entire mountain range" instead of greedily climbing one peak. Keeps diverse strategies alive.

**WOTANN alignment**:
- `gepa-optimizer.ts` (278 LOC) implements the genetic optimizer: mutate + evaluate + elitism + tournament + memoization + early-stop
- Supports arbitrary `T` (string, object, AST) — callers plug in mutate + evaluate
- `onGeneration` callback for telemetry

**Gaps vs. paper**:
1. **No Pareto frontier tracking** — WOTANN's `gepa-optimizer.ts` tracks **single global best** (`globalBest` at line 240). Paper specifically calls out this as the key improvement over greedy.
2. **No reflective step** — WOTANN's `mutate` is caller-provided. The paper's core innovation is that `mutate` is itself a **natural-language reflection** over trajectories ("here's what went wrong, here's a better prompt"). WOTANN's callers would have to re-implement this.
3. **No natural-language feedback injection** — GEPA lets users type feedback to guide optimization.

**Wire-up**: Adding Pareto frontier is ~80 LOC (replace `globalBest` with a `paretoSet`, sample from it each gen). Adding a built-in reflective mutator for skill prompts is ~60 LOC.

### 2.6 DGM — Darwin Gödel Machine (Zhang et al., 2025, arXiv:2505.22954, Sakana AI)

**Core mechanism**: self-improving coding agent that rewrites its own code.
1. Start with one agent
2. **Archive of agents** (tree structure)
3. Each iteration: sample from archive -> self-modify -> empirically validate on SWE-bench + Polyglot -> keep if valid
4. Open-ended: grows archive of diverse high-quality agents over time
5. Validation is **empirical** (benchmark pass rate), not formal proof (unlike the theoretical Gödel Machine)

**Results**: SWE-bench 20% -> 50% (2.5x), Polyglot 14.2% -> 30.7% (2.2x).

**Key innovations DGM discovered through self-modification**:
- Better code editing tools
- Long-context window management
- Peer-review mechanisms (agent reviews its own proposed change)

**WOTANN alignment**:
- `darwinian-evolver.ts` (197 LOC) is directly a DGM-pattern module: `evolveCode({initialCode, syntaxCheck, evaluate, mutate})` -> returns best code after N generations
- Validation is cheap (syntax) + expensive (tests), mirroring DGM's empirical validation
- Wraps `gepa-optimizer.ts` (composition — Darwinian is a specialization of GEPA)

**Gaps vs. DGM**:
1. **No archive of past agents** — WOTANN's evolver tracks `history` per-run (within one optimize call), but doesn't persist an archive across runs. DGM's archive is the whole point.
2. **No self-rewrite of WOTANN itself** — `darwinian-evolver.ts` only operates on caller-supplied code, not on WOTANN's own source. For WOTANN to DGM-style self-improve, it would need a meta-loop: extract a function body, evolve it, write it back, run tests, keep.
3. **No peer-review mechanism** — DGM's agent reviews its proposed change before committing. WOTANN has `code-reviewer` agent but doesn't wire it into the evolver.

**Wire-up (full DGM parity)**: ~600 LOC for archive persistence + self-rewrite driver + peer-review integration. This is the **highest-value, highest-effort** item in the deck.

### 2.7 Agent-R (ByteDance, 2025, arXiv:2501.11425)

**Core mechanism**: **iterative self-training with MCTS-based error correction**.
1. Actor generates trajectory (possibly wrong)
2. **MCTS** explores alternative trajectories from each node
3. Model-guided critique: actor identifies **first error step** in failed trajectory
4. Splice: replace the failed sub-tree with the **adjacent correct path** sharing the same parent
5. Train on the spliced (corrected) trajectories
6. Iterate

**Results**: +5.59% over baselines on 3 interactive environments. Recovers from errors without loops.

**Key insight**: **first-error identification + same-parent correct-path splicing** produces clean training data without needing full re-rollouts.

**WOTANN alignment**:
- `CrossSessionLearner.extractErrorPatterns` (cross-session.ts:228) implements a simplified version: find failed action, look at next 5 actions for a successful retry with the same tool, record the pair as `error_pattern`
- `CrossSessionLearner.extractPreferencePatterns` (cross-session.ts:435) does similar for user corrections

**Gap vs. Agent-R**:
1. **No MCTS tree structure** — WOTANN's cross-session learner is linear (walk trace forward). Agent-R's tree lets it splice correct paths from siblings.
2. **No iterative self-training** — WOTANN extracts learnings once, stores them in `MemoryStore`. Agent-R uses them to fine-tune the model (WOTANN doesn't fine-tune).
3. **No first-error identification** — WOTANN records the first *failed* step, but doesn't use model-guided critique to find the first *logically-wrong* step (which might be several steps before the observable failure).

**Wire-up**: Partial Agent-R parity (first-error identification + tree structure, no fine-tuning) is ~150 LOC. Would improve `error_pattern` extraction quality.

### 2.8 AI Scientist v2 (Sakana AI, ICLR 2025 workshop, arXiv:2504.08066)

**Core mechanism**: **end-to-end autonomous research** with agentic tree search.
1. Generate hypothesis (no human template, unlike v1)
2. **Experiment Manager agent** guides the research agenda
3. **Progressive agentic tree search** explores experiments + ablations
4. VLM feedback loop refines figures
5. Write manuscript, submit to peer review

**Results**: first AI-generated paper to pass peer review (score 6.33, above human acceptance threshold, above 55% of human papers).

**Key insight**: **Experiment Manager** as a meta-agent that decides *which experiments to run next* based on current results — this is the long-horizon autonomous research loop, closed.

**WOTANN alignment**: none directly. WOTANN's orchestration (`src/orchestration/`) has waves, Ralph, and PWR patterns, but **no dedicated Experiment Manager meta-agent**. For long-horizon autopilot (the key differentiator), WOTANN needs something like this.

**Most relevant pattern for WOTANN autopilot**:
```
ExperimentManager {
  plan()           -> list of experiments to try
  runExperiment(h) -> result
  rankResults(rs)  -> pick winner or propose ablation
  decide()         -> continue, refine, or stop
}
```

This maps onto WOTANN's proposed long-horizon autopilot: given a user goal ("fix the flaky auth flow"), the Experiment Manager would plan 3-5 approaches, try each, rank by `tests_pass + lines_changed + regression_tests_green`, keep the winner.

**Wire-up (new component)**: ~400 LOC new `src/orchestration/experiment-manager.ts`. High-value for "autopilot beyond single-task" goal.

---

## 3. The Specific "Inert Learning Stack" Finding — Verified

The Apr-13 deep audit (`/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/DEEP_AUDIT_2026-04-13.md:511`) states:

> its learning stack is entirely inert

The V4 autonomous execution plan (`docs/AUTONOMOUS_EXECUTION_PLAN_V4_2026-04-18.md:126`) adds:

> Phase 3 added (learning stack resurrection) — needed because conversations don't auto-persist, making Dream/Instinct/Skill-Forge/Self-Evolution all inert

**Grep evidence (run just now)**:

| Learning producer | Call sites in `src/` | Status |
|---|---|---|
| `feedbackCollector.recordFeedback` | 1 (kairos-rpc.ts:3691 — RPC handler) | PARTIAL — wired to RPC, not to natural user interactions |
| `patternCrystallizer.recordPattern` | 0 | DEAD |
| `reflectionBuffer.add` | 0 | DEAD |
| `selfEvolutionEngine.*` (proposeIdentityUpdate, updateUserProfile, etc.) | 0 in src/ outside the class itself | DEAD |
| `instinctSystem.observe` | 1 (runtime.ts:1229 — wired to query) | LIVE |
| `crossSessionLearner.recordAction` | 2 (runtime.ts:1306, 2573) | LIVE |
| `skillForge.analyzeSession` | 1 (runtime.ts:4458 — session close) | LIVE |
| `decisionLedger.recordDecision` | 3 (index.ts:3559 CLI, kairos-rpc.ts:4490 RPC, runtime.ts:3799 API) | LIVE via explicit API |
| `runDreamConsolidation` | 1 (runtime.ts:4524 — session close) | LIVE but conditional on gates |
| `nightlyConsolidator.consolidate` | 1 (runtime.ts:4615 inside runDreamConsolidation) | LIVE but downstream of dream gates |
| `dreamPipeline.runPipelineSync` | 2 (kairos.ts:1340 daemon nightly, dream-runner.ts:113 force-run) | LIVE but only 2-4AM window |

**Interpretation**: about **4 of 15 modules are live** and **5 of 15 are fully dead**. The remaining 6 are partially wired — they have producers in RPC handlers (meaning they only fire when CLI commands invoke them) but no autonomous producers from inside the agent's ordinary workflow.

The symptom: **after 100 user interactions, the `ReflectionBuffer` is still empty, the `PatternCrystallizer` has zero patterns, and the `SelfEvolutionEngine.actionLog` is empty**. Evolution is gated on CLI invocations, not natural telemetry.

---

## 4. Architectural Diagnosis

The 15-module learning stack has the **right shape** but wrong **triggers**. Every module exposes a public `record*` / `observe` / `analyze` method expecting structured input, but **there is no universal event bus that naturally produces these inputs as the agent works**.

**Compare to Evolver**: Evolver has ONE loop (`node index.js --loop`) that reads `memory/` every cycle and produces signals. Every run produces an `EvolutionEvent`.

**Compare to Voyager**: Voyager has ONE loop (task proposal -> execution -> verification -> skill library add). Every task produces a skill.

**Compare to autonovel**: autonovel has explicit phases that always produce artifacts (`evaluate.py` writes `eval_logs/*.json`, `adversarial_edit.py` writes `edit_logs/*.json`, etc.) — the whole pipeline is artifact-producing.

**WOTANN's equivalent** would be a single **Learning Event Bus** that:
1. Fires on every significant agent action (tool call, LLM call, test run, git commit, user input)
2. Each event is a `{type, payload, sessionId, timestamp, outcome}` tuple
3. Learning modules subscribe and react

Today, WOTANN has this bus **structurally** (`crossSessionLearner.recordAction`) but it's called from only 2 sites. Expand it to all tool executions, all LLM completions, all test results, all git operations, and most modules come alive for free.

---

## 5. Long-Horizon Self-Writing (from Autonovel) — What WOTANN Needs for Autopilot

Autonovel's pipeline generates a 75k-word novel in 15-30 hours. This is **the prototype for WOTANN's "long autopilot runs"** (per the CLAUDE.md / WOTANN plan v3: "Autopilot — agent runs until task is complete").

**What autonovel has that WOTANN needs**:

1. **Phase-gated orchestrator** (`run_pipeline.py`): a single entry that runs each phase until exit criteria, with deterministic progression.
   - WOTANN equivalent needed: a `WotannPipeline` class in `src/orchestration/` that runs `analyze -> plan -> implement -> verify -> integrate` with explicit phase-done gates.

2. **Score-gated commits**: every change is evaluated; keep if improved, reset if not.
   - WOTANN needs: wrap every tool-call-group in a `git stash` / run-tests / `git commit-or-reset` gate.

3. **Plateau detection**: "stop if |delta| < 0.5 across 2 cycles."
   - WOTANN needs: a deterministic stopping rule for autopilot. Currently autopilot stops on "I think I'm done" (model decision). Should stop on "last 2 verification runs both showed 0 new progress."

4. **State file survives crashes** (`state.json`): phase, iteration, debts.
   - WOTANN has this partially in `src/core/session.ts` but not for long-horizon multi-session work.

5. **Dual-persona final review** (literary critic + professor) with qualified-hedge stopping.
   - WOTANN has `wotann review` (multi-model) but not the stopping criterion.

6. **Two immune systems** (mechanical regex + LLM judge).
   - WOTANN has `HookGuards` (mechanical) and `code-reviewer` agent (LLM judge) — the primitives exist. Wire them together as a post-action immune gate.

7. **Debts tracked in state** (propagation debts: lore change -> needs outline update -> needs chapter rewrite).
   - WOTANN needs: a `DebtTracker` that queues follow-up work created by partial changes.

**Wire-up estimate**: `WotannPipeline` + score-gated commits + plateau + debt tracker = ~700 LOC new. Biggest value-add for autopilot reliability.

---

## 6. Socratic Teaching (from DeepTutor Guide) — WOTANN's Explanatory Mode

DeepTutor's **Guided Learning** (`agents/guide/guide_manager.py`) turns any topic into a 3-5 step interactive learning journey:

```
Topic + KB -> DesignAgent -> knowledge plan (3-5 points)
Per point:
  InteractiveAgent -> rich HTML page + chat alongside
End:
  SummaryAgent -> learning summary
```

**For WOTANN's explanatory mode** (when user says "explain X", "how does Y work", "teach me Z"):

1. **DesignAgent** equivalent: plan 3-5 knowledge points from the user's question
2. **InteractiveAgent per point**: Socratic probe ("what do you already know?") -> explain -> verify understanding ("does this make sense?" or "apply it to a small example") -> next point
3. **SummaryAgent**: recap what was covered

**TutorBot's Soul templates** (Socratic / encouraging / rigorous) are essentially **prompt personas**. WOTANN already has `src/identity/` and `SOUL.md` — the pattern maps directly.

**Wire-up estimate**: ~300 LOC new `src/intelligence/socratic-mode.ts` that triggers on "teach me" / "explain" / "walk me through" intents, invokes a 3-agent (Design -> Interactive xN -> Summary) pipeline.

---

## 7. Cross-Module Summary Table

| Competitor/Paper | Core mechanism | WOTANN equivalent | Gap | Effort to close |
|---|---|---|---|---|
| **Evolver** | Gene library + selector + validation + audit trail | `autodream` + `nightlyConsolidator` | No explicit Gene library; no machine-validated strategies | ~200 LOC |
| **multica** | Agents as polymorphic assignees | None in autopilot | No accountability plumbing | ~150 LOC |
| **autonovel** | Phase-gated orchestrator with score-gated commits + plateau | `src/orchestration/` (waves, Ralph) | No long-horizon autopilot with keep/reset gate | ~700 LOC |
| **DeepTutor** | Heartbeat + TutorBot loop + Socratic Guide | `kairos.ts` heartbeat + `src/intelligence/` | No proactive heartbeat with virtual tool; no Socratic mode | ~500 LOC |
| **Reflexion** | Actor -> Evaluator -> Self-reflect -> Episodic memory | `reflection-buffer.ts` (LIVE but DEAD) | No producers | ~50 LOC wire-up |
| **Voyager** | Curriculum + growing skill lib + iterative refine | `skillForge` + `patternCrystallizer` | No curriculum; no semantic retrieval; no compositional verify | ~200 LOC |
| **STaR** | Bootstrap via rationalization | `miprov2-optimizer.ts` bootstrap | No backward rationalization on failed cases | ~30 LOC |
| **MIPROv2** | Instruction + demo joint Bayesian Opt | `miprov2-optimizer.ts` bootstrap | No Bayesian Opt, no meta-optimization | ~300 LOC (if pursuing full parity) |
| **GEPA** | Reflective mutate + Pareto frontier | `gepa-optimizer.ts` | No Pareto frontier; no built-in reflective mutator | ~140 LOC |
| **DGM** | Archive-of-agents + empirical self-rewrite | `darwinian-evolver.ts` | No persistent archive; no self-rewrite meta-loop | ~600 LOC |
| **Agent-R** | MCTS + first-error splicing | `crossSession.extractErrorPatterns` (linear) | No tree structure; no model-guided first-error ID | ~150 LOC |
| **AI Scientist v2** | Experiment Manager + agentic tree search | None | No meta-agent for experiment planning | ~400 LOC new |

**Total gap closure**: ~3,400 LOC. **Priority for WOTANN's §78 sprint goals** (per MEMORY.md — 59 commits, Phase-1 closed, 10 audit gaps addressed): Reflexion (50 LOC, highest leverage/effort ratio) -> Pareto GEPA (80 LOC) -> PatternCrystallizer wire-up (30 LOC) -> autonovel-style orchestrator (700 LOC, biggest autopilot win).

---

## 8. WIRE-UP PLAN: Activating WOTANN's Inert Learning Stack

### 8.1 Core principle: one Learning Event Bus, many subscribers

Create a **single event bus** in `src/learning/learning-bus.ts` (~120 LOC). All learning modules subscribe to events; runtime.ts + hooks + middleware fire events.

```ts
// src/learning/learning-bus.ts
export type LearningEvent =
  | { type: "tool_called"; tool: string; input: unknown; output: unknown; success: boolean; durationMs: number; sessionId: string; timestamp: number }
  | { type: "llm_completed"; provider: string; model: string; prompt: string; response: string; tokens: { input: number; output: number }; sessionId: string; timestamp: number }
  | { type: "test_ran"; command: string; passed: boolean; output: string; sessionId: string; timestamp: number }
  | { type: "user_feedback"; feedback: "positive" | "negative" | "neutral"; message?: string; sessionId: string; timestamp: number }
  | { type: "user_correction"; before: string; after: string; reason?: string; sessionId: string; timestamp: number }
  | { type: "git_committed"; message: string; files: string[]; sessionId: string; timestamp: number }
  | { type: "task_completed"; title: string; steps: string[]; filesModified: string[]; verificationPassed: boolean; sessionId: string; timestamp: number }
  | { type: "error_recovered"; mistake: string; correction: string; context: string; sessionId: string; timestamp: number };

export class LearningBus {
  private subscribers = new Map<string, Array<(e: LearningEvent) => void>>();
  subscribe(type: string, handler: (e: LearningEvent) => void): () => void { ... }
  emit(event: LearningEvent): void { ... }
}
```

### 8.2 Wire-up of each dead/partial module

**Phase A — dead module resurrection (~200 LOC)**:

1. **ReflectionBuffer.add** producer: subscribe to `error_recovered` events. Every time a test fails and the next attempt passes, emit `error_recovered` -> `reflectionBuffer.add({context, mistake: failed_output, correction: passed_diff, tags: [tool, domain]})`. Fire on failed->success tool sequences in `runtime.ts:executeTool`.
   - Wire-up: 30 LOC hook in runtime, 20 LOC in learning-bus.
   - Consumer: in `context-relevance.ts`, before building the next LLM prompt, call `reflectionBuffer.retrieve({tags: [currentDomain]})` and inject via `formatForPrompt()`.

2. **PatternCrystallizer.recordPattern** producer: subscribe to `task_completed` events. For each completed task, extract tool sequence from `crossSessionLearner.getSessionTrace()` -> `patternCrystallizer.recordPattern(toolSequence, triggerKeywords, success)`.
   - Wire-up: 40 LOC in runtime `onTaskComplete`.
   - Consumer: Crystallized patterns auto-write to `~/.wotann/skills/<name>.md` (already implemented, just needs the producer firing).

3. **FeedbackCollector.recordFeedback** producer: the RPC handler in kairos-rpc.ts is already wired. Add implicit feedback: subscribe to `user_correction` events (when user says "no, actually...") -> emit `user_feedback: negative`. Subscribe to `git_committed` — if the commit sticks and wasn't reverted in 1h, emit `user_feedback: positive` for the preceding LLM completion.
   - Wire-up: 50 LOC in runtime (implicit feedback detection) + 20 LOC in hooks for user-correction detection.

4. **SelfEvolutionEngine.proposeIdentityUpdate** producer: subscribe to `user_correction` events. When a correction recurs 3+ times with similar theme, call `selfEvolutionEngine.proposeIdentityUpdate("identity", "user repeatedly corrects X", proposed_content)`. Queue for approval.
   - Wire-up: 60 LOC in `runtime.ts` + thresholding in `selfEvolutionEngine`.
   - Consumer: TUI `wotann evolution pending` lists them, `wotann evolution approve <id>` applies.

**Phase B — partial module completion (~200 LOC)**:

5. **InstinctSystem.reinforce** producer: currently `observe` fires on every query, but `reinforce` never fires. Subscribe to `user_feedback` events. Map feedback -> instinct reinforcement:
   - `positive` user feedback + matching instinct -> `reinforce(id, true)`
   - `negative` user feedback + matching instinct -> `reinforce(id, false)`
   - Wire-up: 40 LOC in runtime.

6. **CrossSessionLearner.recordAction** expansion: currently fires 2 sites. Expand to every tool call, every LLM completion, every test run, every git commit (subscribe to all 6 event types).
   - Wire-up: replace 2 call sites with subscription to all tool_called / llm_completed / test_ran / git_committed events. ~40 LOC.

7. **DecisionLedger.recordDecision** implicit producer: currently only explicit CLI/RPC. Add: when the agent makes a significant architectural decision (detected via keywords "I'll use X because", "decision: Y", "going with Z over A"), auto-extract -> `recordDecision`.
   - Wire-up: 80 LOC in LLM completion hook with keyword detection + LLM-assisted extraction.

**Phase C — new capabilities from papers (~1,100 LOC)**:

8. **GEPA Pareto frontier** (80 LOC): replace `globalBest` in `gepa-optimizer.ts` with `paretoSet: Map<evalInstanceId, Candidate<T>>`. Each generation, sample next candidate from Pareto set (not just top-1). Add `evaluatePerInstance(candidate, instances[]) -> scores[]` callback.

9. **Reflective mutator for skill prompts** (60 LOC): built-in mutator that takes `(prompt, failure_trajectory) -> reflected_prompt`. Wraps an LLM call with a fixed "here's what went wrong, propose a better prompt" template. Plug into `gepa-optimizer.optimize` when caller doesn't provide one.

10. **STaR rationalization for MIPROv2** (30 LOC): extend `miprov2-optimizer.ts` with `rationalizeFailed(failedCase, expectedOutput) -> rationale`. On failed training examples, generate a rationale from the expected output. Add to demo set.

11. **Voyager-style curriculum** (150 LOC): new `src/learning/curriculum.ts` that given a goal + recent skills, proposes next sub-goals to explore. Called by autopilot when no user input is present.

12. **Experiment Manager** (400 LOC): new `src/orchestration/experiment-manager.ts` implementing AI Scientist v2 pattern. Given a user goal, plan 3-5 approaches, execute each via wave, rank by objective fn, keep winner, propose ablation.

13. **autonovel-style orchestrator** (700 LOC): new `src/orchestration/pipeline.ts` with phase-gated execution, score-gated commits (`git stash` / tests / `commit-or-reset`), plateau detection. Wraps existing `src/orchestration/ralph.ts` with deterministic progression.

14. **DGM archive of agents** (300 LOC): new `src/learning/agent-archive.ts` persisting self-modifications with SWE-bench-like validation. `darwinian-evolver.ts` writes to archive; archive grows tree.

### 8.3 Sequencing (priority order by value/effort)

**Week 1 (high leverage, low effort)**:
1. Learning Event Bus scaffolding (120 LOC)
2. ReflectionBuffer producer (50 LOC) — makes Reflexion live
3. PatternCrystallizer wire-up (40 LOC) — makes Voyager skill library live
4. FeedbackCollector implicit producer (70 LOC) — makes binary feedback live
5. InstinctSystem reinforce wire-up (40 LOC) — closes the observe+reinforce loop
**Week 1 total**: 320 LOC. Makes 5 dead modules live.

**Week 2 (medium effort, high value)**:
6. CrossSessionLearner expansion (40 LOC)
7. DecisionLedger implicit producer (80 LOC)
8. SelfEvolutionEngine wire-up (60 LOC)
9. GEPA Pareto frontier (80 LOC)
10. Reflective mutator (60 LOC)
**Week 2 total**: 320 LOC. Brings learning quality up.

**Week 3 (big-ticket long-horizon features)**:
11. Voyager-style curriculum (150 LOC)
12. autonovel-style orchestrator (700 LOC) — PRIORITY for autopilot
**Week 3 total**: 850 LOC. Closes autopilot gap.

**Week 4 (research-grade features)**:
13. Experiment Manager (400 LOC)
14. DGM archive (300 LOC)
15. STaR rationalization (30 LOC)
**Week 4 total**: 730 LOC. Ships self-evolution.

**Grand total**: ~2,220 LOC over 4 weeks to take WOTANN from "library of primitives" to "live self-evolving agent harness" — matching or exceeding every competitor in this lane.

### 8.4 Verification plan

Each wire-up needs a verification that proves the module is now live:

| Module | Verification |
|---|---|
| ReflectionBuffer | After 10 sessions, `reflectionBuffer.size() > 0`. Log shows >3 retrievals injected into prompts. |
| PatternCrystallizer | After 20 sessions with repeating tasks, `patternCrystallizer.getCrystallizedCount() >= 1`. A `~/.wotann/skills/*.md` file exists. |
| FeedbackCollector | After 50 interactions with commits, `feedbackCollector.getStats().total > 0`. `preferences.jsonl` grows. |
| InstinctSystem reinforce | After user correction, log shows `instinctSystem.reinforce(id, false)` call with matching instinct ID. |
| Pareto GEPA | Run a synthetic multi-instance benchmark; show `paretoSet.size > 1` and diverse candidates. |
| autonovel orchestrator | Run a canned long-horizon task ("add feature X, verify tests pass"); show phase log with keep/reset decisions. |

---

## 9. Takeaways for WOTANN's Next Sprint

1. **The library is already world-class**. WOTANN's 15-module learning stack has more primitives than any of the 4 repos and covers most of the 8 papers. The code quality (immutability, TypeScript strict, readable) exceeds competitor averages.

2. **The ONE missing piece is the event bus**. All 4 repos and all 8 papers share a common pattern: **a continuous telemetry stream produces learning events**. WOTANN has isolated call sites that never fire. ~120 LOC of bus scaffolding unlocks ~800 LOC of dead library.

3. **Autopilot is the biggest user-visible gap**. Without an autonovel-style orchestrator, WOTANN autopilot will keep stalling on "I think I'm done" hallucinations. The orchestrator is 700 LOC and closes the gap to Claude Code, AI Scientist v2, DGM, and autonovel simultaneously.

4. **Socratic mode is a free win for positioning**. DeepTutor's explanatory pattern is ~300 LOC of orchestration reusing WOTANN's existing agents. Marketing angle: "WOTANN doesn't just code — it teaches." Low effort, high narrative lift.

5. **Pareto GEPA is the cheapest research-grade upgrade**. 80 LOC turns WOTANN's prompt optimizer from "MIPROv2-era" to "ICLR 2026 Oral-era." Cite it in the README.

6. **Don't build full MIPROv2 — the 70%-of-value simpler version is in place and documented**. Effort better spent on Pareto + autopilot.

7. **DGM-style self-rewrite is the moonshot**. 600 LOC. If WOTANN can demonstrate measurable self-improvement on TerminalBench across versions, it lands as "the first open-source DGM for agent harnesses." This is a flagship differentiator for the launch narrative.

---

## Appendix A — Key file paths for reference

**WOTANN learning stack** (all in `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/learning/`):
- `autodream.ts` (441 LOC) — 4-phase dream pipeline, runs on session close
- `cross-session.ts` (499 LOC) — session-trace-based learning extraction, WIRED
- `darwinian-evolver.ts` (197 LOC) — code-tier optimization, wraps GEPA
- `decision-ledger.ts` (286 LOC) — architectural decisions, WIRED via API
- `dream-pipeline.ts` (541 LOC) — 3-phase Light/REM/Deep pipeline
- `dream-runner.ts` (295 LOC) — workspace-level dream runner with lock
- `feedback-collector.ts` (233 LOC) — binary feedback for KTO/DPO, PARTIAL
- `gepa-optimizer.ts` (278 LOC) — generic evolutionary optimizer
- `instinct-system.ts` (353 LOC) — observation->reinforcement with decay, PARTIAL
- `miprov2-optimizer.ts` (183 LOC) — bootstrap-fewshot optimizer
- `nightly-consolidator.ts` (264 LOC) — rules + skills + archivals, WIRED inside dream
- `pattern-crystallizer.ts` (303 LOC) — tool-sequence -> skill auto-generation, DEAD
- `reflection-buffer.ts` (200 LOC) — Reflexion pattern, DEAD
- `self-evolution.ts` (284 LOC) — proposes updates to identity/soul/user, DEAD
- `skill-forge.ts` (673 LOC) — Voyager skill library, PARTIAL
- `types.ts` (81 LOC) — shared types

**Key integration points in runtime**:
- `src/core/runtime.ts:1229` — `instinctSystem.observe()` (LIVE)
- `src/core/runtime.ts:1306, 2573` — `crossSessionLearner.recordAction()` (LIVE)
- `src/core/runtime.ts:4458` — `skillForge.analyzeSession()` (LIVE)
- `src/core/runtime.ts:4524` — `runDreamConsolidation()` (LIVE on session close)
- `src/daemon/kairos.ts:1217` — nightly dream (2-4 AM window)
- `src/daemon/kairos-rpc.ts:3691` — `feedbackCollector.recordFeedback` via RPC

**Audit documents**:
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/DEEP_AUDIT_2026-04-13.md:511` — "learning stack is entirely inert"
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUTONOMOUS_EXECUTION_PLAN_V4_2026-04-18.md:126` — "Phase 3 added (learning stack resurrection)"

## Appendix B — Paper references

1. [Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) — Shinn et al., NeurIPS 2023, 443 citations
2. [Voyager: An Open-Ended Embodied Agent with Large Language Models](https://arxiv.org/abs/2305.16291) — Wang et al., 2023
3. [STaR: Bootstrapping Reasoning With Reasoning](https://arxiv.org/abs/2203.14465) — Zelikman et al., NeurIPS 2022
4. [Optimizing Instructions and Demonstrations for Multi-Stage Language Model Programs](https://arxiv.org/abs/2406.11695) — Opsahl-Ong et al., EMNLP 2024 (MIPROv2)
5. [GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457) — Agrawal et al., ICLR 2026 Oral
6. [Darwin Godel Machine: Open-Ended Evolution of Self-Improving Agents](https://arxiv.org/abs/2505.22954) — Sakana AI, 2025
7. [Agent-R: Training Language Model Agents to Reflect via Iterative Self-Training](https://arxiv.org/abs/2501.11425) — ByteDance Seed, 2025
8. [The AI Scientist-v2: Workshop-Level Automated Scientific Discovery via Agentic Tree Search](https://arxiv.org/abs/2504.08066) — Sakana AI, ICLR 2025 workshop

---

*End of Lane 6 extraction. 2,200 LOC wire-up plan in §8. Estimated 4 weeks to full activation.*
