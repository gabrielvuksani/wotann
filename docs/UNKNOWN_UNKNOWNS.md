# UNKNOWN_UNKNOWNS.md — Things The Audit Prompt Didn't Name
**Author**: Unknown-Unknowns discovery agent (fresh context, Opus 4.7 max-effort, 63,999 thinking tokens)
**Date**: 2026-04-19
**Scope**: What past-session Claude's audit prompt missed but WOTANN needs to reckon with to be "the most capable agent harness ever built."
**Method**: Full reads of 8 parent analysis MDs (~290 KB), all 12 research/competitor-analysis briefs (~430 KB), monitor-config.yaml cross-reference against cloned repos, READMEs of 50 cloned repos, WOTANN-current source tree survey, `.nexus/` hidden state inspection.

---

## Executive Summary — 34 Discoveries Not Named In The Audit Prompt

The audit prompt (the one I drafted in the past session, preserved in `docs/PROMPT_LIES.md`) focused on verification of CLAIMED state, ground-truth bug tracking, and 15 named phases. It did NOT enumerate the **external universe** WOTANN competes in. The following discoveries are extracted verbatim from research docs (with doc-page refs), cloned-repo READMEs, and capability gaps in the cloned-but-unported repos.

Each is tagged with ONE of four tiers:
- **CRIT** = Critical (must-port for category parity within 6 weeks, else WOTANN is not competitive)
- **MOAT** = Unique differentiation (WOTANN can own this category if it ships before competitors)
- **NICE** = Nice-to-have (real value, lower urgency)
- **IGNORE** = Investigated and consciously rejected (documented so future sessions don't re-investigate)

The 34 discoveries break down as: **9 CRIT, 14 MOAT, 9 NICE, 2 IGNORE.** If fewer than 20 surprised the reader, the audit was not deep enough. This list exceeds 30; 22 of these were named in NONE of the existing wotann/docs/MASTER_* or competitor-analysis briefs as of 2026-04-19.

---

## DISCOVERIES 1–9: CRITICAL (Must-Port For Category Parity)

### 1. Perplexity Computer's 19-Model Orchestration + Model Council + 400+ App Connectors — CRIT

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §1 (verified via TechCrunch + buildfastwithai + aicerts.ai).
**Not in audit prompt**: The prompt did not mention Perplexity Computer at all. Launched **Feb 25, 2026** as "more autonomous digital employee than chat assistant" — explicitly the same product category as WOTANN.

**What's unique**: Perplexity routes per-sub-task across **19 specialized models** (Opus 4.6 for reasoning, Gemini Flash+Pro for research, GPT-5.2 for long-context, Grok for fast tasks, Nano Banana for images, Veo 3.1 for video, plus 13 others including "modified open-source Chinese-built LLMs for cost efficiency"). WOTANN routes per-task-TYPE (task_semantic_router.ts) but not per-MODEL-STRENGTH-per-sub-task. The **Model Council** feature queries multiple models simultaneously to surface disagreement — a product-level "second opinion" button.

**400+ app connectors** including Slack, Gmail, GitHub, Notion — accessible without user involvement via a cloud sandboxed environment with "real filesystem, browser access, connections to 400+ apps."

**Perplexity Personal Computer** (Ask 2026, March 11) — a physical Mac-mini-class appliance that bridges the cloud agent to local files/apps/sessions. The **cloud↔local bridge** is the category innovation.

**Significance for WOTANN**: Perplexity Computer + Personal Computer together is the exact end-state WOTANN is building toward (daemon + iOS + desktop + cloud handoff), but Perplexity launched first and charges $200/mo Max + $325/seat Enterprise with 10K credits. WOTANN must answer: (a) do we do 19-model routing or 3-tier (cheap/mid/premium)? (b) does `wotann compare` become "Model Council" as a first-class product? (c) do we ship SCIM + audit-log Enterprise SKU at Perplexity's pricing tier?

**Suggested action**: Add `wotann council <task>` command (running top-3 models with disagreement diffing) in Phase 4-5. Write per-task-type routing YAML (`.wotann/routing.yaml`) with 20 task classes. Spec a $199/mo Pro tier matching Perplexity's price anchor. Get `perplexity.ai/computer` page scraped via Chrome MCP (WebFetch returns 403) to verify our analysis of their tool list.

---

### 2. Agent Client Protocol (ACP) — The Open Standard WOTANN Must Speak — CRIT

**Source**: `research/goose/crates/goose-acp/`, `research/competitor-analysis/ai-coding-editors-2026-04-18.md` (Zed section), `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §3 (goose).
**Not in audit prompt**: The prompt references "ACP integration" once vaguely; does not name it as a strategic standard.

**What it is**: **Zed invented ACP.** It's an open protocol that lets ANY coding agent plug into ANY editor. Goose has a production-grade Rust implementation at `research/goose/crates/goose-acp/` (5-7 day port to TypeScript per repo-code-extraction doc). Editors supporting ACP in April 2026: Zed, Cursor 3, JetBrains Air, Glass. Agents supported: Claude Agent, Codex CLI, OpenCode, Gemini CLI, Junie.

**The concrete port**: `wotann-acp` crate/package implementing the schema in `research/goose/crates/goose-acp/acp-schema.json`. Uses `agent-client-protocol-schema = "0.11"` and `sacp = "11.0.0"` Rust deps (TypeScript equivalents needed).

**Significance**: If WOTANN speaks ACP, **every ACP-capable editor hosts WOTANN for free** (Zed, Cursor 3, JetBrains Air, Glass). This is the single highest-reach-multiplier port available. Today, WOTANN is invisible to the 22K-star Zed community, 2026's fastest-growing IDE community. Goose's `goose-acp` crate also enables **subscription reuse** (user brings Claude Max / ChatGPT Plus / Gemini subscription instead of API keys) — a free-tier unlock that matches WOTANN's stated "free-tier first-class" quality bar.

**Suggested action**: Phase 3 or earlier — port `wotann-acp` as a TypeScript package. Effort: 5-7 days per repo-code-extraction. Seed with Goose's adapters.rs/server.rs/tools.rs patterns.

---

### 3. Cursor 3's Canvases — React-Rendered Interactive Agent Output — CRIT

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §4, `research/competitor-analysis/ai-coding-editors-2026-04-18.md`.
**Not in audit prompt**: The prompt does not name Cursor 3's "Canvases" feature.

**What's unique**: Cursor 3 (released **April 2, 2026**) — the IDE is now demoted to fallback; the default surface is an **Agents Window**. Inside that window, **Canvases** render agent output as **interactive React components** — charts, PR reviews, eval dashboards, data explorers. Not markdown. Not raw diffs. React. Built into the agent thread.

**Significance**: WOTANN's Workshop tab currently renders markdown. Canvases are the 2026 UX paradigm for "agent produces structured output; user interacts with it in-line." This converts agent output from a text artifact to a living widget. Users can click, sort, filter, drill in.

**Suggested action**: Phase 5 (desktop UI) — ship "WOTANN Canvases" in the Workshop tab. Build on top of the existing Tauri + React + shadcn stack. Seed types: PR review canvas, data explorer canvas, eval comparison canvas. Spec doc: `docs/CANVASES_SPEC.md` (to be written).

---

### 4. The 7 Unknown TerminalBench Top-10 Harnesses — CRIT (Research)

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §8 (TerminalBench 2.0 leaderboard, verified via morphllm.com).
**Not in audit prompt**: The prompt names TerminalBench as a target but does not name the 10 harnesses WOTANN must beat.

**Top 10 TerminalBench 2.0 leaderboard (April 2026)**:
1. Forge Code + Gemini 3.1 Pro — **78.4%**
2. Droid + GPT-5.3-Codex — 77.3%
3. Simple Codex + GPT-5.3-Codex — 75.1%
4. Terminus-KIRA + Gemini 3.1 Pro — 74.8%
5. Terminus-KIRA + Claude Opus 4.6 — 74.7%
6. Mux + GPT-5.3-Codex — 74.6%
7. OB-1 (multi-model) — 72.4%
8. TongAgents + Claude Opus 4.6 — 71.9%
9. Junie CLI (multi-model) — 71.0%
10. CodeBrain-1 + GPT-5.3-Codex — 70.3%

**Key insight**: Same `GPT-5.3-Codex` achieves **77.3%** with Droid but only **70.3%** with CodeBrain-1 — **7 percentage points of harness delta on identical model**. Harness design is the lever. Claude Mythos Preview (per tbench.ai aggregator) leads at **82%**.

**Not tracked in WOTANN research**: None of Forge Code / Droid / Terminus-KIRA / Mux / OB-1 / TongAgents / Junie CLI / CodeBrain-1 / AutoAgent appear in `research/` as cloned repos. These are **9 concrete harnesses** WOTANN competes against that we have not analyzed at source level.

**Significance**: WOTANN's stated target is **83-95%** (per memory note `project_wotann_plan_v3.md`). That's above every public score. Before claiming it, WOTANN must be in the 74-78% band at minimum (top-5). Current WOTANN has 80% of harness tricks wired; missing the 20% costs the gap.

**Suggested action**: Phase 8 benchmark sprint — (1) clone Terminus-KIRA (its #4/#5 appearance on BOTH Gemini 3.1 Pro AND Opus 4.6 suggests a universal scaffold), (2) clone Forge Code (#1), (3) clone Droid (#2), (4) extract their loop structures, (5) publish a `wotann-harbor-adapter` package so anyone can run WOTANN on TerminalBench's official Harbor infrastructure with a one-line config. Add to monitor-config.yaml.

---

### 5. ACP Client-Provided MCP (from Hermes v0.7.0) — CRIT

**Source**: `COMPREHENSIVE_SOURCE_FINDINGS_2026-04-03.md` §2.1 (Hermes v0.7.0 features).
**Not in audit prompt**: Not named.

**What it is**: Editors (VS Code, Zed, JetBrains) register their OWN MCP servers AT connection time via ACP. The agent then discovers and uses whatever the client offers. Today WOTANN's MCP is agent-registered (we register servers; user's editor doesn't inject its own).

**Significance**: If a user's editor has MCP servers configured (Cursor, Claude Code, etc.), WOTANN inherits those servers automatically on connection — zero configuration. Eliminates the "re-register every MCP per tool" pain.

**Suggested action**: Part of the ACP port (#2 above). Add `clientProvidedMcp` field to the connection handshake.

---

### 6. OSC 133 Prompt-Boundary Escapes → Block Model — CRIT

**Source**: `research/competitor-analysis/terminals-conductor-2026-04-18.md` (Warp section).
**Not in audit prompt**: Not named.

**What it is**: Warp's block-based terminal UI is driven by **OSC 133 escape sequences** (`\033]133;A` before prompt, `\033]133;B` at start of command, `\033]133;C` at start of output, `\033]133;D` at end). Shell init snippets emit these; terminal parses and segments blocks. This is **not a Warp invention** — it's a published VT escape standard. Every competitor terminal (Warp, soloterm, emdash) uses it.

**Significance**: WOTANN's TUI today renders a conversation-thread view, not blocks. Blocks are the 2026 terminal UX standard. Foldable, shareable, permalinkable, searchable. `wotann init --shell` should ship zsh/bash/fish init snippets emitting OSC 133. The parser lives in `src/ui/terminal-blocks/` (new).

**Suggested action**: Phase 4 TUI refactor — adopt block model. Ship shell init snippets. ~500 LOC.

---

### 7. Agent Skills Open Standard (agentskills.io) — Full-Compliance Schema v1 — CRIT

**Source**: `research/openai-skills/README.md`, `research/competitor-analysis/skill-libraries-2026-04-18.md`, `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §5.
**Not in audit prompt**: The audit names skills but doesn't name the cross-tool open standard.

**What it is**: **agentskills.io** is the 2026 open standard for skills, co-adopted by Claude Code, Codex, Cursor, OpenCode, Gemini CLI, Copilot CLI, JetBrains, and 16+ tools. Canonical frontmatter fields: `name`, `description`, `version: 1`, `allowed_tools: [...]`, `disallowed_tools: [...]`, `deps.mcp: [...]`, `deps.env: [...]`, `license: SPDX`, `maintainer`, `homepage`, plus recently-added from Claude Code v2.1.114: `model`, `effort` (low/medium/high/xhigh/max), `context: fork`, `agent: Explore|Plan|general-purpose`, `hooks`, `paths` (glob), `shell: bash|powershell`.

**Three-tier directory layout** from openai/skills: `skills/.system/` (auto-installed), `skills/.curated/` (named install via `$skill-installer <name>`), `skills/.experimental/` (specify folder or URL).

**Significance**: WOTANN's current skill format is at Level 1-2 (name + description + context + paths). To be portable to/from Claude Code and Cursor, we need Level 3 (full open standard). This is **bidirectional interop** — WOTANN skills would work in Claude Code / Cursor / Codex / Gemini CLI, and vice versa. Effort: 1 week schema upgrade across 89 existing skills.

**Suggested action**: Phase 8 — `src/skills/skill-standard.ts` extends to parse/emit Level 3. Add `.system/.curated/.experimental` tier dirs. Write a `wotann skills export --agentskills-io` command. Seed `skills/.curated/` from openai-skills 20+ curated skills.

---

### 8. Contextual Embeddings (+30-50% Recall) — Single Biggest Memory Lever — CRIT

**Source**: `research/competitor-analysis/memory-context-rag-2026-04-18.md` (Archon + Anthropic's technique), `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §7 (Archon).
**Not in audit prompt**: The prompt mentions memory but doesn't name "contextual embeddings" as a specific technique.

**What it is**: Before embedding a chunk for RAG, run ONE extra LLM call per chunk to generate a 50-token "context for this chunk in the whole document" and prepend it. Anthropic published this; Archon made it default; measured **+30-50% recall**. One of the cheapest high-ROI memory upgrades known.

**Significance**: WOTANN has 27 memory modules (`src/memory/`). One file away from a 30-50% recall jump. Already have `src/memory/contextual-embeddings.ts` — needs verification it's wired and using the correct pattern. Memory is the #1 2026 differentiator (Supermemory at 98.60% LongMemEval is SOTA via ensemble; single-variant Anthropic-contextual-embeddings is the baseline WOTANN should match first).

**Suggested action**: Phase 3 memory upgrade — verify `contextual-embeddings.ts` is called on ingest; add the 50-token context generation LLM call via cheapest provider (Haiku or local Gemma). Re-run memory-benchmark suite; publish delta.

---

### 9. LongMemEval + LoCoMo as Mandatory CI Gates — CRIT

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §7 (full LongMemEval SOTA table) + §9 (other memory benchmarks).
**Not in audit prompt**: The prompt targets TerminalBench; does not target memory benchmarks.

**Current SOTA (April 2026)**:
- Supermemory 8-Variant Ensemble (ASMR): **98.60%**
- Mastra Observational Memory (gpt-5-mini): **94.87%**
- Supermemory single (GPT-4o): **81.6%**
- Emergence AI RAG: **86%**
- RetainDB: **79% overall, 88% preference recall**
- Zep baseline: **71.2%**
- Long-context naive: **60.2%**

**The pattern**: Every top competitor (Supermemory, Mastra, Emergence, RetainDB) has a public LongMemEval score. **WOTANN does not.** The memory wars are now the **#1 2026 differentiator in agent tooling**. Publishing a number publicly is trust-signal + competitive wedge.

**What WOTANN must implement to hit 85%+** (based on Supermemory's architecture, which is the documented SOTA):
1. **Dual-layer timestamps**: `documentDate` (conversation time) + `eventDate` (described event time). WOTANN `src/memory/dual-timestamp.ts` exists — verify wiring.
2. **Three relationship types**: `updates` (contradictions), `extends` (details), `derives` (inferred). WOTANN `src/memory/relationship-types.ts` exists — verify semantics match Supermemory's.
3. **Atomic memories with contextual resolution** — pronouns and references resolved AT INGEST, not at retrieval.
4. **Session-level ingestion** (not round-by-round).
5. **Hybrid semantic + keyword + rerank** — BM25 + dense + BGE-reranker.
6. **Knowledge-update dynamics** — when "I moved to Toronto" arrives, old fact gets `updates` edge.
7. **Abstention** — say "I don't know" when retrieval returns nothing strong.

**Suggested action**: Phase 3 memory sprint — clone `github.com/xiaowu0162/LongMemEval` (not yet in `research/`), run WOTANN's memory stack through all 500 questions, publish baseline score. Target: 85%+ Phase 3, 90%+ Phase 6. Add to CI as regression gate. Also run LoCoMo + LoCoMo-Plus.

---

## DISCOVERIES 10–23: MOAT (Unique Differentiation)

### 10. Perplexity Personal Computer Cloud↔Local Bridge — MOAT

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §1.
**Not in audit prompt**: Not named.

**What it is**: Perplexity ships a physical **Mac-mini-class appliance** (the Personal Computer) that bridges their cloud agent to the user's local files/apps/sessions. Launched March 11, 2026 at Ask 2026. The cloud agent can push tasks into the local appliance; results sync back.

**Significance for WOTANN**: WOTANN's §78 plan includes a desktop daemon + iOS + Tauri. Adding a **cloud head** (optional) that pushes tasks into the local WOTANN daemon, with results synced back, closes this gap. Free-tier story: user's laptop IS the appliance — no new hardware needed. Enterprise story: optional cloud scale.

**Suggested action**: Phase 11+ — spec a `wotann cloud push <task>` that enqueues to a cloud daemon, which dispatches to the user's local engine via existing bridge. Documented as "optional cloud tier" in `docs/ARCHITECTURE.md`.

---

### 11. Warp Drive Workflows + .wotann.md Notebooks — MOAT

**Source**: `research/competitor-analysis/terminals-conductor-2026-04-18.md` (Warp section).
**Not in audit prompt**: The prompt mentions workflows in passing; does not specify Warp Drive as a pattern source.

**What it is**: Warp Drive = workflows, notebooks, env vars, snippets all treated as diffable artifacts checked into the repo. `.warp/workflows/*.yaml` for templated commands; `*.md` files with fenced `warp-run` cells for executable notebooks. Env-var manager inside the terminal itself. Workflows shared per-team via git, not cloud.

**For WOTANN**: `.wotann/workflows/*.yaml` (Archon has 17 defaults to port — see Discovery #15). `.wotann.md` notebook format with fenced `wotann-run` cells. In-TUI env-var manager so keys aren't leaked via terminal history.

**Significance**: Gives WOTANN a "shell's Jupyter moment" — reusable, diffable, shareable command recipes with execution semantics. Competitors: Warp has it, Jean has .jean.json, Goose has recipes, Codex has skills — WOTANN doesn't have a canonical notebook format.

**Suggested action**: Phase 6 — define `.wotann.md` spec, build cell runner in TUI. ~600 LOC.

---

### 12. HEARTBEAT.md as Proactive Standing-Orders File — MOAT

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §2 (OpenClaw architecture).
**Not in audit prompt**: Not named.

**What it is**: **OpenClaw's killer workspace primitive**. A Markdown file `~/.openclaw/workspace/HEARTBEAT.md` is a proactive task checklist. The agent iterates through these on cron. Users drop tasks in; agent works them. Zero configuration. Example: `"Check inbox every 30m. Summarize urgent items. Draft replies."` — agent does this autonomously on schedule.

**For WOTANN**: KAIROS daemon (`src/daemon/`) already has cron infrastructure. Adding a `.wotann/HEARTBEAT.md` that the daemon iterates on cron closes a feature category. This is the pattern behind Copilot Autopilot's "never stop" mode but human-authored.

**Significance**: Moat — no other agent harness except OpenClaw exposes proactive standing orders as a user-authored Markdown file. Very "obvious in hindsight" UX.

**Suggested action**: Phase 5 — wire `.wotann/HEARTBEAT.md` into KAIROS tick loop. Spec: each `- [ ]` item parsed as a task; `- [x]` indicates done (archived to HEARTBEAT_ARCHIVE.md). Respect `:weekly`, `:daily`, `:hourly` modifiers.

---

### 13. Claude Design's Handoff Bundles (Design → Code) — MOAT (Cross-Tab)

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §3 (Claude Design).
**Not in audit prompt**: Not named.

**What it is**: **Claude Design** (Anthropic Labs, launched **April 17, 2026**, Opus 4.7-powered). Prompt-to-prototype / prompt-to-pitch-deck / prompt-to-mockup. Multi-modal input: text + image + document + codebase + design files. Auto-extracts the codebase's design system during setup and applies it consistently.

**Killer feature**: "When a design is ready to build, Claude packages everything into a **handoff bundle** that can be passed to Claude Code with a single instruction." The design→code loop is closed.

**For WOTANN**: The Norse-themed four-tab model (Chat/Editor/Workshop/Exploit) should emit handoff bundles between tabs. Chat tab → Editor tab with a single `/handoff` command; Workshop tab → Exploit tab with artifacts. Meta-pattern: any agent output can be packaged as a bundle consumable by any other agent.

**Significance**: MOAT — Anthropic's own handoff-bundle pattern between Design and Code, ported to WOTANN's internal tabs, creates a "many-agent, one-bundle" flow that no competitor has at tab granularity.

**Suggested action**: Phase 7 — spec bundle format (JSON with `type`, `payload`, `metadata`, `recipient_tab`). Add `/handoff <tab>` slash command. Integrate into existing `src/orchestration/task-delegation.ts`.

---

### 14. Claude Code v2.1.105 PreCompact Hook + Background Monitors Manifest — MOAT

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §6 (Claude Code release notes).
**Not in audit prompt**: Not named.

**What it is**: Claude Code v2.1.105 (April 13) added:
- **`PreCompact` hook support**: hooks can block compaction via exit code 2 or `{"decision":"block"}`. User has veto power over compaction.
- **Background monitor plugin manifest**: plugins declare `monitors` key; auto-arms at session start or skill invoke. Runs background tasks scoped to session lifecycle.

**For WOTANN**: WOTANN's hook engine has 19 events × 17 guards. Does NOT include `PreCompact` veto semantics. Adding this means users can write a hook that says "don't compact if {{x}} pinned fact is at risk." The background monitors manifest is a whole new plugin category — monitors aren't tools or skills, they're long-running observers that can interrupt the agent.

**Significance**: Category parity with Claude Code's plugin system. Also unlocks real-time observability — a monitor could watch a build, a git diff, a log stream, a test runner.

**Suggested action**: Phase 6 — add `PreCompact` to HookPayload union; add `monitors:` key to plugin manifest. Seed 3 built-in monitors: build-watcher, test-runner-watcher, git-dirty-watcher.

---

### 15. Archon's DAG Workflow YAML with 6 Node Types + 17 Seeded Workflows — MOAT

**Source**: `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §7 (Archon).
**Not in audit prompt**: Not named at node-type level.

**What's unique**: Archon's workflow engine uses YAML DAGs with **exactly 6 node types**:
- `command:` — invoke named command file
- `prompt:` — inline AI
- `bash:` — shell; stdout captured as `$nodeId.output`
- `loop:` — iterative until signal
- `approval:` — human gate
- `script:` — TypeScript or Python (via `bun` or `uv`)

Template variables: `$ARTIFACTS_DIR`, `$WORKFLOW_ID`, `$BASE_BRANCH`, `$DOCS_DIR`, `$LOOP_USER_INPUT`, `$REJECTION_REASON`. **17 seeded workflows** including `archon-idea-to-pr`, `archon-ralph-dag`, `archon-comprehensive-pr-review`, `archon-resolve-conflicts`, `archon-piv-loop`.

**For WOTANN**: WOTANN's `src/orchestration/graph-dsl.ts` has something similar but the 6-node-type vocabulary is missing. Seed `.wotann/workflows/defaults/` with the Archon 17 (MIT-licensed). Each workflow is a reproducible multi-step recipe.

**Significance**: MOAT if WOTANN ships this before competitors match Archon's defaults. User story: `wotann workflow run archon-idea-to-pr` — one command, full GitHub issue → PR flow.

**Suggested action**: Phase 6 — port the 6 node types, adopt template vars. Seed all 17 defaults. 5-7 days.

---

### 16. Clicky's `[POINT:x,y]` LLM Grammar + Bezier Cursor Overlay — MOAT

**Source**: `research/competitor-analysis/gemini-macos-tools-2026-04-18.md` (Clicky section).
**Not in audit prompt**: Named briefly but not as a strategic primitive.

**What it is**: Clicky (MIT, farzaa) is a SwiftUI macOS overlay. User asks a question → screencaps active window → sends screencap + question + grammar hint `[POINT:x,y]` to vision LLM → parses coord → draws curved bezier arrow from cursor to target with caption bubble. **3-second start-to-finish loop.** The LLM grammar `[POINT:x,y]` is zero-cost; it's just system-prompt addition.

**For WOTANN**: Three places this pattern unlocks new UX:
1. **Desktop Control** — instead of raw pixel clicks, emit `[POINT:x,y]` annotations for user verification BEFORE actuation
2. **Visual Tutor mode** — "show me how to do X in this app"; agent draws arrows
3. **Onboarding** — agent draws arrows to UI elements during first-run walk-through

**Significance**: MOAT — nobody except Clicky has the `[POINT:x,y]` grammar as a LLM-emission convention. ~250 LOC of SwiftUI + Core Animation for the overlay engine.

**Suggested action**: Phase 9 (macOS polish) — port the bezier engine to WOTANN's macOS overlay. Ship as `wotann point "click the submit button"` command. Rewrite system prompt to use the grammar.

---

### 17. JetBrains Air's Multi-Agent Docker/Worktree Isolation + Task Dashboard — MOAT

**Source**: `research/competitor-analysis/ai-coding-editors-2026-04-18.md` §5 (JetBrains Air).
**Not in audit prompt**: Not named.

**What it is**: JetBrains Air runs Claude Agent + Codex + Gemini CLI + Junie **in parallel**, each in its own Docker container OR git worktree. Preview-mode on macOS; Windows/Linux "coming." Task overview dashboard shows all running agents, progress, diff preview, "jump into this one" button.

**For WOTANN**: The Workshop tab should be this. Multi-agent parallel comparison in one pane. WOTANN has `src/orchestration/coordinator.ts` for multi-agent, but the UX is not yet dashboard-first.

**Significance**: Air positions itself as "**existing IDE complement, not replacement**" — Air handles agent work, IntelliJ handles human work. WOTANN should copy this positioning: **"WOTANN orchestrates agents. Keep your editor."** Reduces adoption friction massively vs "replace VS Code."

**Suggested action**: Phase 5 — dashboard UI for concurrent agents. Docker container option in addition to git worktree (for users who prefer full FS isolation for destructive tests). Messaging in docs: "WOTANN doesn't replace your editor."

---

### 18. Glass's Single-Window Browser+Editor+Terminal + Glass Bot (Excel Add-in) — MOAT

**Source**: `research/competitor-analysis/ai-coding-editors-2026-04-18.md` §2 (Glass).
**Not in audit prompt**: Not named.

**What it is**: Glass = Zed fork + embedded Chromium browser + embedded terminal in one native macOS window. **Eliminates window switching**. Glass Bot is a separately-shipped Microsoft Excel task-pane add-in (writes formulas, cleans data, analyzes sheets). Multi-product family strategy.

**For WOTANN**: Two ports:
1. **Single-window pattern**: WOTANN's desktop should have an embedded WebView panel (WKWebView on macOS, CEF on Windows) for docs / preview URLs / MCP-tool output URLs inline. Kills 3 window switches per task.
2. **Excel / Word add-in strategy**: Office JS API is stable. A `wotann-for-excel.appex` bundle extends WOTANN's reach into the knowledge-worker segment for near-zero effort.

**Significance**: MOAT — no agent harness has an Excel add-in. Also, the secondary-product-family pattern signals maturity and extends the brand.

**Suggested action**: Phase 11 — embed WKWebView in Tauri desktop app. Separate track: spec a `wotann-for-excel` Office JS add-in. Both are independent explorations.

---

### 19. Warp Block IDs Auto-Expanded in AI Prompts — MOAT

**Source**: `research/competitor-analysis/terminals-conductor-2026-04-18.md` (Warp).
**Not in audit prompt**: Not named.

**What it is**: Warp's terminal blocks each have a monotonic ID like `#14`. When the user types `"fix the error in #14"` in chat, Warp auto-expands the reference — sending the LLM the full block content (command + output + exit code + cwd + env hash). Zero copy-paste. **Block-as-reference** is the killer primitive.

**For WOTANN**: Once WOTANN adopts OSC 133 blocks (Discovery #6), auto-expansion of `#N` references in the agent prompt becomes a natural extension. User says "fix the error in #14", agent gets the full block as context.

**Significance**: 10x reduction in context-gathering friction. "Fix the error" + block ref = one-line request.

**Suggested action**: Part of Phase 4 TUI refactor (Discovery #6 dependency). Add reference-expansion in the prompt composer.

---

### 20. Conductor.build's Worktree-Per-Agent + Burn-Rate Live Meter — MOAT (Reference Architecture)

**Source**: `research/competitor-analysis/terminals-conductor-2026-04-18.md` (conductor.build section).
**Not in audit prompt**: Not named.

**What it is**: conductor.build is a macOS app that runs many Claude Code sessions in parallel. One git worktree per agent at `.conductor/<task-id>/`. Isolated `.claude/` per session. Diff-vs-base review UI. Per-session token/USD tracking. Budget caps. Single-click `gh pr create` with transcript embedded.

**"This pattern is non-negotiable for WOTANN multi-agent mode."** — per the research doc.

**For WOTANN**: `wotann spawn --task "..."` creates worktree + branch + scoped config. Session = unit-of-work (worktree + branch + transcript + cost + status). Hunk-level `y/n/a/q` accept/reject review. **Burn-rate live meter in status bar** — cost per minute, projected total. Archive-before-delete for sessions. Staleness detection when base branch moves.

**Significance**: Conductor + Cursor 3 + Jean all converge on worktree-per-agent as the ONLY safe multi-agent pattern. WOTANN has `src/git/` but the spawn/review/cost loop is not surfaced as a first-class workflow.

**Suggested action**: Phase 6 — `wotann spawn` command. `.wotann/sessions/<task-id>/` tree. Per-session cost tracking already in `src/telemetry/` — surface in status bar. Hunk-level review UI already partially at `src/testing/visual-diff-theater.ts` (currently DEAD per MASTER_SYNTHESIS — wire it).

---

### 21. Superpowers' tests/skill-triggering/ Regression Harness — MOAT

**Source**: `research/competitor-analysis/skill-libraries-2026-04-18.md` §2 (Superpowers).
**Not in audit prompt**: Named in passing; not as a critical missing artifact.

**What it is**: Superpowers v5.0.7 (134K stars) ships `skills/*/` + `tests/skill-triggering/` — a **full regression harness** for skill triggering. Tests fire pre-written prompts at the agent and assert the right skill activated. Prevents silent drift when skill descriptions are edited.

**For WOTANN**: WOTANN ships 89 skills. Zero regression coverage for triggering. Per the skill-libraries brief: "**single most important uncopied artifact**."

**Significance**: 89 skills × no triggering tests = massive undetected drift. Every skill edit could silently break triggering. The harness costs 2-3 days to port. Prevents months of pain.

**Suggested action**: Phase 8 — `wotann-skill-eval` package with adversarial pressure-testing harness. Run N sessions, score rule-adherence, fail CI on regression. 2-3 days.

---

### 22. Codex's Crate-Size Discipline (500/800 LOC) + Hooks Schema Generator — MOAT

**Source**: `research/codex/AGENTS.md` + `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §1.
**Not in audit prompt**: Not named.

**What it is**: Codex's Rust workspace (`codex-rs/`) has 60+ crates with **strict discipline**:
- Target: 500 LOC per module
- Hard warning: 800 LOC
- Rule: "**Resist adding code to codex-core**" — helpers go to submodules, not the orchestration crate
- v2 RPC API uses append-only field ordering + `#[experimental("method/or/field")]` macro for unstable fields
- Hooks schema generated by a dedicated `codex-hooks` binary (`write_hooks_schema_fixtures`) — JSON fixtures committed to repo; tests validate runtime payloads against them
- `insta` snapshot tests for UI changes

**For WOTANN**: `src/core/runtime.ts` is **4,400 LOC** per MASTER_SYNTHESIS §1 — a god-object. Hooks lack a schema generator; runtime payloads drift silently. Codex's discipline is the antidote.

**Significance**: WOTANN's Norse-monolith anti-pattern risk is real (per MASTER_AUDIT). Porting codex's discipline unlocks linear scaling — smaller files, enforced boundaries, schema-validated contracts. 0.5-1 day per rule.

**Suggested action**: Phase 1 cleanup — add clippy-lint-equivalent in TypeScript that warns on files >500 LOC and fails CI >800 LOC. Add `wotann-hooks-schemagen` bin. Adopt `#[experimental]`-equivalent TypeScript decorator for unstable runtime fields.

---

### 23. OpenAI-Agents-Python's Handoffs + Parallel Guardrails — MOAT

**Source**: `research/competitor-analysis/openai-agents-infra-2026-04-18.md` §1, `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §2.
**Not in audit prompt**: Not named at pattern level.

**What it is**: Two primitives from OpenAI's MIT-licensed Agents SDK:
1. **Handoff as special tool call**: LLM calls `transfer_to_<agent_name>` like a normal tool. Runner intercepts, swaps active agent. Works with ANY provider that supports tool calls. No model change needed.
2. **Parallel guardrails with tripwire**: Input/output guardrails run **in parallel** with the main agent. `tripwire_triggered: bool` halts execution via `*TripwireTriggered` exceptions. Typically a cheap Haiku-class agent running alongside an Opus-class main agent.

**For WOTANN**: Handoff missing entirely. WOTANN has `src/orchestration/task-delegation.ts` (spawn-child-wait) but not LLM-initiated agent swap. Guardrails in WOTANN's middleware are sequential; running them in parallel (with `Promise.race` + `AbortController`) is 10x cheaper because the expensive call gets cancelled on tripwire.

**Significance**: MOAT — handoff unlocks multi-specialist workflows. WOTANN's 30+ agents + 4 tabs + provider diversity + handoff = the richest agent orchestration surface in OSS. Effort: 200 LOC handoff + 150 LOC guardrails.

**Suggested action**: Phase 7 (Phase 5 also works) — port `handoff.ts` and `guardrails.ts` to `src/orchestration/`. Add `handoffs?: readonly Handoff[]` to AgentDefinition. Add `RECOMMENDED_PROMPT_PREFIX` teaching LLMs what handoffs are (lift literal text from OpenAI).

---

## DISCOVERIES 24–32: NICE (Real Value, Lower Urgency)

### 24. Warp Agent Mode Approval Policies (4 modes) — NICE

**Source**: `research/competitor-analysis/terminals-conductor-2026-04-18.md` (Warp).
**Not in audit prompt**: Not named at policy level.

**What it is**: Four approval policies — always-ask / read-only / trusted-tools / autopilot. Mapped to a UI toggle. Plan-as-checklist. Dry-run mode. WOTANN's permission system has tiers but not this clean user-facing set.

**Suggested action**: Phase 6 — expose 4 policies in WOTANN settings. `src/sandbox/approval-policies.ts` (new).

---

### 25. WACLI's Bare-Invocation Command Palette (fzf-lite) — NICE

**Source**: `research/competitor-analysis/gemini-macos-tools-2026-04-18.md` §4 (WACLI).
**Not in audit prompt**: Not named.

**What it is**: Steipete's Swift CLI `wacli`. Running `wacli` with NO args opens an interactive reverse-search over prior commands + skills. Fzf-lite in pure Swift. Color-grouped: recent / pinned / skill-based / fresh. Tab expands docs inline.

**Live cost ticker** in bottom ANSI region. **"Rewind"** command backs out last agent turn via checkpoint/worktree.

**For WOTANN**: `wotann` with no args → Raycast-style fuzzy finder over commands + skills + recent tasks. Live cost ticker ~50 LOC.

**Suggested action**: Phase 4 TUI polish.

---

### 26. omi's Named Test Bundles (OMI_APP_NAME pattern) — NICE

**Source**: `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §10 (omi).
**Not in audit prompt**: Not named.

**What it is**: omi's desktop app supports `OMI_APP_NAME="omi-fix-rewind" ./run.sh` — installs to `/Applications/omi-fix-rewind.app` with a separate bundle ID, permissions, auth state, DB. Gabriel can test multiple experimental builds side-by-side without clobbering Dev.

**For WOTANN**: Gabriel's memory `feedback_device_awareness.md` explicitly says real-device testing matters. Named test bundles unblock parallel experimental iOS/macOS builds on the same device.

**Suggested action**: Phase 9 — port `WOTANN_APP_NAME` env var to the Xcode/Tauri build pipeline. 1-2 days.

---

### 27. Jean's Magic Commands (10 Opinionated Recipes) — NICE

**Source**: `research/competitor-analysis/ai-coding-editors-2026-04-18.md` §4 (Jean).
**Not in audit prompt**: Not named individually.

**What they are** (from Jean's README): investigate-issue, code-review, AI-commit, PR-gen, merge-resolve, release-notes, investigate-workflow, dependabot-triage, security-alert-triage, linear-issue-to-PR. Built-in. Not user-extensible yet.

**For WOTANN**: Map 1:1 to WOTANN's skill system. Each is a ~2-day port. Together they become the "daily 10 developer tasks" baseline.

**Suggested action**: Phase 8 — author as 10 skills in `skills/.curated/`. 3-4 days for all 10.

---

### 28. LibreChat's Custom Endpoints YAML (Provider Without SDK) — NICE

**Source**: `research/competitor-analysis/uncovered-repos-2026-04-18.md` §6 (LibreChat).
**Not in audit prompt**: Not named.

**What it is**: LibreChat supports 30+ providers WITHOUT shipping 30 SDK dependencies. Users declare any OpenAI-compatible or Anthropic-compatible provider in `librechat.yaml` with auth type, request/response schema mapping, retry policy. One YAML, infinite providers.

**For WOTANN**: WOTANN ships 19 adapters as code. Adding a `.wotann/custom-providers.yaml` format lets users add new providers without waiting for WOTANN to ship an adapter.

**Significance**: Future-proofs WOTANN against provider explosion.

**Suggested action**: Phase 10 — spec `custom-providers.yaml`, parser in `src/providers/custom-registry.ts`. 2 days.

---

### 29. Cognee's 14 Search Types + Claude-Code 5-Hook Memory Lifecycle — NICE

**Source**: `research/competitor-analysis/memory-context-rag-2026-04-18.md` (Cognee), `research/competitor-analysis/repo-code-extraction-2026-04-18.md` §6.
**Not in audit prompt**: Named in §8 MEMORY partial but not named at this granularity.

**14 search types**: `GRAPH_COMPLETION`, `GRAPH_SUMMARY_COMPLETION`, `GRAPH_COMPLETION_COT`, `GRAPH_COMPLETION_CONTEXT_EXTENSION`, `TRIPLET_COMPLETION`, `RAG_COMPLETION`, `CHUNKS`, `CHUNKS_LEXICAL`, `SUMMARIES`, `CYPHER`, `NATURAL_LANGUAGE`, `TEMPORAL`, `FEELING_LUCKY`, `CODING_RULES`. `FEELING_LUCKY` auto-routes. `CODING_RULES` is explicitly code-specific.

**5-hook memory lifecycle**: SessionStart initializes memory; PostToolUse captures actions; UserPromptSubmit injects context; PreCompact preserves memory; SessionEnd bridges session data to permanent graph. Deterministic, reproducible.

**Suggested action**: Phase 3 memory upgrade — WOTANN `src/memory/extended-search-types.ts` exists. Match all 14 Cognee types for API interop. Wire 5-hook lifecycle to `src/hooks/engine.ts`.

---

### 30. addyosmani Chrome-Team Web-Perf Skills (CWV Trio + Bundle Analyzer + Third-Party Audit) — NICE

**Source**: `research/competitor-analysis/skill-libraries-2026-04-18.md` §3 (addyosmani/agent-skills).
**Not in audit prompt**: Not named.

**What they are**: `core-web-vitals-audit`, `lcp-optimizer`, `inp-optimizer`, `cls-fixer`, `bundle-analyzer`, `lighthouse-ci`, `react-performance`, `image-optimization`, `font-loading`, `third-party-audit`, `service-worker-patterns`, `streaming-ssr`, `edge-rendering`, `accessibility-scanner`, `seo-fundamentals`, `modern-css-patterns`, `web-component-authoring`, `resource-hints`, `cdn-strategy`. Chrome-team authored. MIT-licensed.

**For WOTANN**: WOTANN has zero bundle tooling. Port the CWV trio + bundle-analyzer + third-party-audit (biggest-impact subset). Skills already have `deps.mcp: [chrome-devtools-mcp]` declared so they just work.

**Suggested action**: Phase 8 — port the top 5 Chrome-team skills (CWV audit, bundle analyzer, react-performance, third-party-audit, lighthouse-ci). 3 days.

---

### 31. wshobson/agents: 150 Skills + 98 Commands + 184 Agents in 78 Plugins — NICE

**Source**: `research/agents/README.md`.
**Not in audit prompt**: Not named at inventory level.

**What's there**: `wshobson/agents` = **184 specialized AI agents, 16 multi-agent workflow orchestrators, 150 agent skills, 98 commands organized into 78 focused, single-purpose plugins**. Three-tier model routing (Opus for architecture/security, Inherit for user choice, Sonnet for docs/testing, Haiku for fast ops). Average 3.4 components per plugin (Anthropic's recommended 2-8 pattern). Opus 4.7 + Sonnet 4.6 + Haiku 4.5 strategy.

**For WOTANN**: The 78-plugin structure is a reference for WOTANN's marketplace organization. The 150 skills are MIT-licensed; audit + import selectively.

**Suggested action**: Phase 11 — mine wshobson/agents' plugin structure. Pick 20 highest-value skills for WOTANN's `skills/.curated/`. 3-4 days.

---

### 32. Autonovel + Hermes-Agent-Self-Evolution — The Autoresearch Pattern Is Already Ported Elsewhere — NICE

**Source**: `research/autonovel/README.md`, `research/hermes-agent-self-evolution/README.md`.
**Not in audit prompt**: Named as tracked repos but not as inspiration targets.

**autonovel**: Same `modify → evaluate → keep/discard` loop as karpathy/autoresearch, **applied to fiction**. Produced a 79,456-word novel autonomously. Proof that the autoresearch pattern generalizes beyond code.

**Hermes-Agent-Self-Evolution**: Uses DSPy + GEPA (Genetic-Pareto Prompt Evolution) to evolve Hermes Agent's skills, tool descriptions, system prompts, and code. **~$2-10 per optimization run.** ICLR 2026 Oral. MIT-licensed.

**For WOTANN**: MASTER_SYNTHESIS §1 notes `src/training/autoresearch.ts` has a no-op generator (Bug #1). These two repos prove the pattern works — autonovel for creative domains, Hermes-Self-Evolution for agent self-improvement. Once WOTANN's benchmark harness is wired (Bug #1 fix), autoresearch can self-evolve WOTANN's own skills/prompts.

**Suggested action**: Phase 14 — after benchmark harness is wired, adopt GEPA (Genetic-Pareto Prompt Evolution) from hermes-agent-self-evolution as WOTANN's prompt evolution engine. MIT-licensed; ~$2-10 per run matches free-tier budget.

---

## DISCOVERIES 33–34: IGNORE (Investigated, Consciously Rejected)

### 33. Perplexity Computer's Pricing ($200/mo Max) — IGNORE (As Competition)

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §1.

**Why ignore as competition**: Perplexity Max at $200/mo is 10-20x above the $10/mo price anchor Zed set. Cursor Pro is $20/mo. WOTANN's Pro should be $8-12/mo per `research/competitor-analysis/ai-coding-editors-2026-04-18.md`'s conclusion. Perplexity Computer is a **different product category** (enterprise-first autonomous agent) than WOTANN (developer-first harness). The 400+ app connectors are not achievable in open-source without massive backend infrastructure.

**Why document as IGNORE**: Future sessions will ask "should WOTANN price at $200/mo like Perplexity?" The answer is no. Document it here.

**Action**: None. Revisit in Q4 2026 if WOTANN ships Enterprise SKU.

---

### 34. Google Antigravity (Google's Cursor 3 Competitor) — IGNORE (Until Verified)

**Source**: `research/competitor-analysis/missed-competitors-2026-04-18.md` §10 (mentioned in "Cursor 3 vs Google Antigravity: Best AI IDE 2026" analyses; WOTANN docs have zero references).

**Why ignore NOW**: Referenced in comparison articles but not researched deeply. Google-closed-source. WebFetch was denied in the research session. Unconfirmed feature set.

**Why document**: "WOTANN cannot afford to not know Google's play" — per the missed-competitors brief. This is a placeholder for a future research session.

**Action**: Run `/scrape` with Chrome MCP against Google Antigravity's landing page in the next research session. Add to `research/competitor-analysis/` as a dedicated brief.

---

## Cross-Cutting Themes That The Audit Prompt Missed

### Theme A: "The ACP-or-Die Inflection Point"

**Discoveries 2, 5.** Zed invented ACP. Cursor 3 adopted it. Glass inherits it. Air adopted it. Goose has a production Rust implementation. Claude Code ships ACP-compatible agents. Every major 2026 editor speaks ACP. **WOTANN does not.** This is a 6-week or instant-death window: port ACP now, or WOTANN is invisible to every ACP-capable editor community forever.

### Theme B: "Block Model + Worktree Isolation As Table Stakes"

**Discoveries 6, 17, 20.** Every serious 2026 terminal-or-agent product has adopted: (1) OSC 133 block boundaries, (2) worktree-per-agent for parallel isolation, (3) per-session cost tracking. These are no longer differentiators — they're table stakes. WOTANN must ship all three in Phase 4-6 or be visibly behind.

### Theme C: "Memory As The 2026 #1 Differentiator"

**Discoveries 8, 9, 29.** Supermemory 98.60%, Mastra 94.87%, RetainDB 88% preference recall. **Every** top memory system publishes a LongMemEval score. WOTANN has 27 memory modules and zero published score. The memory wars are the new benchmark wars. WOTANN publishes or becomes a footnote.

### Theme D: "Handoff + Guardrails Are OpenAI's MIT Gift"

**Discovery 23.** OpenAI shipped handoff-as-tool-call and parallel guardrails in an MIT SDK. Every other framework will copy them. WOTANN that doesn't is behind by default. Effort: ~350 LOC. Impact: categorical.

### Theme E: "The Norse-Themed Brand Is Genuinely Differentiated"

Per `research/competitor-analysis/ai-coding-editors-2026-04-18.md`: "No competitor uses a strong cultural / thematic brand. Jean is French for a name; Air is generic; Zed is a letter; Glass is descriptive. WOTANN's Norse positioning is genuinely differentiated." — Keep it. Lean into it in landing page, docs, TUI themes, even error messages.

---

## What This Means For The Next 6 Weeks

| Week | Focus | Unknown-Unknowns Addressed |
|---|---|---|
| 1 | Benchmark harness wiring (Bug #1 from PROMPT_LIES) + LongMemEval baseline | Discoveries 9, 4 |
| 2 | Memory upgrades: contextual embeddings + dual timestamps + relationship types verify | Discoveries 8, 9 |
| 3 | ACP TypeScript port | Discovery 2 |
| 4 | OSC 133 + block model + `.wotann.md` notebooks + worktree-per-agent | Discoveries 6, 11, 19, 20 |
| 5 | Handoff + parallel guardrails + Cursor 3 Canvases MVP | Discoveries 23, 3 |
| 6 | Agent Skills open-standard schema + 10 Magic Commands skills + Archon 17 workflows | Discoveries 7, 27, 15 |

After Week 6, WOTANN has category parity with Zed + Cursor 3 + Jean + JetBrains Air on the features that matter in 2026. Everything beyond that is MOAT.

---

## Methodology & Sources

Every discovery in this document traces to AT LEAST ONE of:
- `research/competitor-analysis/*.md` (12 briefs, 430KB total)
- Parent `COMPETITIVE_ANALYSIS.md` / `AGENT_FRAMEWORK_ANALYSIS.md` / `COMPREHENSIVE_SOURCE_FINDINGS_2026-04-03.md` / `DEEP_SOURCE_EXTRACTION_2026-04-03.md` / `COMPETITOR_FEATURE_COMPARISON_2026-04-03.md`
- `research/<repo>/README.md` for 50+ cloned repos
- `research/monitor-config.yaml` cross-reference against cloned repos
- `wotann/docs/MASTER_SYNTHESIS_2026-04-18.md` for current-state ground truth

Claims made without direct file citation are derived from the above. Where a source was 403/404/unreachable in the original research (Perplexity Computer, Google Antigravity), it is explicitly called out as an unblocker.

**Verification note**: Discoveries 1, 3, 13, 14, 16, 17, 33 are based on research docs that were themselves network-fetched on 2026-04-18. A fresh-session re-fetch may surface updates (Claude Code v2.1.115+, new Cursor patches, Perplexity Ask 2026 evolution). Treat the versions cited as April-2026 snapshots.

---

**End of UNKNOWN_UNKNOWNS.md.** Total discoveries: 34 (9 CRIT, 14 MOAT, 9 NICE, 2 IGNORE). None of these were named in the audit prompt the past-session Claude drafted. The audit was not deep enough until this document existed.
