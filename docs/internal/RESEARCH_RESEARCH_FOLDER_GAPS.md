# Research Folder Deep Scan — Gaps Beyond Lane 2

**Date**: 2026-04-20
**Author**: Opus 4.7 (1M context, max-effort) — manual pass after 2 watchdog-stalled agents
**Scope**: 30+ research repos NOT covered in Lane 2's deep-dive (openclaw/hermes/jean/claude-code/codex/opcode/deepagents/letta/mem0/aider/serena/crush/opencode/goose/jan/OpenHands excluded).
**Method**: Direct Read on README.md + key files. Time-boxed to ~30 minutes of scanning.

---

## 0. Executive Summary

20+ repos surveyed surface **7 novel patterns** not captured in prior WOTANN research:

1. **Addy Osmani's 7-slash-command dev lifecycle** (`/spec` → `/plan` → `/build` → `/test` → `/review` → `/ship`) as a turn-key skill package — model for WOTANN's own CLI verbs to align with industry standard.
2. **Karpathy's 4 Engineering Principles** (Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution) already distilled as a CLAUDE.md drop-in — WOTANN has `karpathy-principles` skill per memory #5920, verify alignment.
3. **DSPy + GEPA (Genetic-Pareto Prompt Evolution)** from `hermes-agent-self-evolution` + competing `evolver` — automatic skill/prompt/tool optimization. No GPU. ~$2-10/run. Already spec'd in WOTANN learning module; verify actual wiring.
4. **OpenAI Agents SDK's 9-concept surface** — Sandbox Agents + Realtime Agents (voice) + Guardrails + built-in Handoffs. WOTANN partially covers; Realtime Agents + Guardrails are weak spots.
5. **Vercel Open Agents 3-layer (Web+Workflow+Sandbox)** — durable workflow on Vercel. Background-agent pattern matters for the "dispatch to cloud" UX Cursor 3 + Perplexity Computer ship.
6. **archon — self-declared "first open-source harness builder"** — make AI coding deterministic + repeatable. Direct positional competitor to WOTANN.
7. **Glass — fork of Zed = browser + editor + terminal unified** — alt-architecture for the WOTANN 4-tab vision. Uses Zed's pane-management model.

**Plus 5 strategic signals**:
- **gstack** (Garry Tan's personal tooling, YC President) — 810× productivity acceleration. Motivates WOTANN's narrative.
- **claude-code-game-studios** — 49 agents + 72 skills + 12 hooks + 11 rules in ONE Claude Code session. Proves mass-agent coordination works.
- **multica** — "Your next 10 hires won't be human" — parallel-agent positioning ahead of Cursor 3's Agents Window.
- **generic-agent** — ~3K LOC self-evolving agent with 9 atomic tools. Validates minimalism thesis.
- **evolver vs hermes-agent-self-evolution tension** — Evolver going source-available because Hermes copied their design. Shows agent-self-evolution is a competitive category.

---

## 1. Per-Repo Findings

### 1.1 `research/addyosmani-agent-skills/` — Production Skill Package

**Tagline**: "Production-grade engineering skills for AI coding agents."

**Pattern**: 7 slash commands map to full dev lifecycle:
```
DEFINE  PLAN   BUILD  VERIFY  REVIEW  SHIP
/spec   /plan  /build /test   /review /ship
```
Each command activates the right skills automatically. The implicit curriculum is the full software SDLC packaged as turn-key skills.

**WOTANN port**: Verify `wotann spec`, `wotann plan`, `wotann build`, `wotann test`, `wotann review`, `wotann ship` all exist as top-level CLI verbs. If missing, add them matching this taxonomy. Per CLAUDE.md line-by-line, WOTANN already has `build / compare / review / autopilot` — verify coverage of the remaining `/spec`, `/plan`, `/test`, `/ship` alignment.

**Priority**: P1 — low effort, alignment with industry-standard taxonomy.

### 1.2 `research/andrej-karpathy-skills/` — 4 Engineering Principles

**Tagline**: "Karpathy-Inspired Claude Code Guidelines" — distilled from Karpathy's observations on LLM coding pitfalls.

**4 Principles as CLAUDE.md**:
| Principle | Addresses |
|---|---|
| **Think Before Coding** | Wrong assumptions, hidden confusion, missing tradeoffs |
| **Simplicity First** | Overcomplication, bloated abstractions |
| **Surgical Changes** | Orthogonal edits, touching code you shouldn't |
| **Goal-Driven Execution** | Leverage through tests-first, verifiable success criteria |

**WOTANN port**: Memory observation #5920 ("Karpathy Principles Engineering Discipline Skill") indicates WOTANN already has this as a skill. Verify the actual implementation matches these 4 principles. Audit WOTANN's `src/prompt/modules/karpathy-principles.ts` or equivalent against the 4-cell table.

**Priority**: P1 — alignment verification.

### 1.3 `research/vercel-open-agents/` — 3-Layer Cloud Coding Agent

**Tagline**: "Open-source reference app for building and running background coding agents on Vercel."

**Architecture**:
```
Web → Agent workflow → Sandbox VM
```
- Web: auth, sessions, chat, streaming UI
- Agent workflow: durable workflow on Vercel (resumable across crashes)
- Sandbox: filesystem + shell + git + dev servers + preview ports

**Key stack**: Next.js + Neon Postgres + Upstash KV + GitHub App + Vercel OAuth.

**WOTANN port**: WOTANN already has daemon + sandbox + desktop companion; adopting the Vercel-hosted model is a strategic call (operate WOTANN as a hosted SaaS). Prompts and workflow orchestration patterns from Vercel's `agent workflow` are worth porting to `src/orchestration/`.

**Priority**: P2 — architecture inspiration, not direct port.

### 1.4 `research/openai-agents-python/` — OpenAI Agents SDK

**Tagline**: "Lightweight yet powerful framework for building multi-agent workflows. Provider-agnostic, 100+ LLMs."

**9 Concepts** (of which 5 are actively ahead of WOTANN):
1. Agents (LLM + instructions + tools + guardrails + handoffs)
2. **Sandbox Agents** — Pre-configured long-horizon container-running agents
3. Agents-as-tools / **Handoffs** — explicit delegation primitive
4. Tools (functions, MCP, hosted tools)
5. **Guardrails** — configurable input/output validators
6. **Human-in-the-loop** — built-in mechanisms
7. Sessions — automatic conversation history
8. Tracing — built-in run tracking
9. **Realtime Agents** — voice agents with `gpt-realtime-1.5`

**WOTANN gaps vs this surface**:
- **Guardrails as a first-class API** (WOTANN has `src/security/guardrails-off.ts` but as a policy toggle, not a composable-per-agent surface)
- **Realtime voice agents** — WOTANN has voice pipeline (`src/voice/*`) but not OpenAI's realtime-agent class
- **Handoffs as a first-class API** — WOTANN has `src/core/handoff.ts` (verified in runtime.ts:143) but the explicit agent-to-agent delegation pattern may need consolidation
- **Sandbox Agents** as a preconfigured class — WOTANN's `src/autopilot/` autonomous loops are similar but not labeled this way

**Priority**: P1 — port Realtime Agents (already close) + formalize Guardrails API.

### 1.5 `research/__new_clones_v2/Glass/` — Zed Fork = Browser + Editor + Terminal

**Tagline**: "Glass is a browser, code editor, and terminal in one app."

**Strategic significance**: **Fork of Zed, syncs upstream weekly.** This is the closest in-app-unification play to WOTANN's 4-tab vision — but at the IDE layer instead of the agent layer.

**Features**:
- Full browser (Zed-integrated)
- Code editor (inherited from Zed)
- Terminal (built-in)
- Active development, macOS-mature, Windows supported

**WOTANN port**: Not a direct port target — Glass is a different segment (universal app, not harness). But Glass's "one-app replaces many" thesis validates WOTANN's 4-tab consolidation. Study their pane-management model.

**Priority**: P3 — strategic reference.

### 1.6 `research/hermes-agent-self-evolution/` — DSPy + GEPA

**Tagline**: "Evolutionary self-improvement for Hermes Agent."

**Pattern**:
```
Read current skill/prompt/tool → Generate eval dataset
                                         ↓
                                    GEPA Optimizer ← Execution traces
                                         ↓
                                    Candidate variants → Evaluate
                                         ↓
                                    Constraint gates (tests, size limits, benchmarks)
```

**Key innovation**: **No GPU required.** Everything via API calls. ~$2-10 per optimization run. Uses DSPy (Stanford) + GEPA (Genetic-Pareto Prompt Evolution). Optimizes skills, tool descriptions, system prompts, and CODE.

**WOTANN port**: WOTANN has `src/learning/` with DreamPipeline, SkillForge, MIPROv2, GEPA optimizer, Darwinian evolver — verify ACTUAL wiring of GEPA (Lane 1 said all wired; MASTER_PLAN_V6 implies otherwise). Port the **constraint gates** pattern (tests/size/benchmarks) for evolutionary validation.

**Priority**: P1 — massive differentiator if properly wired. Audit + test existing modules first.

### 1.7 `research/evolver/` — Competing Agent-Self-Evolution

**Tagline**: "Evolver — agent self-evolution via memory + skill + evolution-asset system."

**Strategic note**: Evolver is transitioning from open-source to **source-available** because Hermes Agent (above) released a similar design without attribution. The similarity is documented in their analysis blog. **Signals that agent-self-evolution is a competitive category** — WOTANN should decide positioning.

**Key primitives**: GEP (Genetic Evolution Programming) integration + memory + skill system + evolution-asset accumulation.

**WOTANN port**: Study but don't fork (license trap). Port techniques — memory + skill evolution + constraint-driven selection.

**Priority**: P2 — technique study.

### 1.8 `research/omi/` — 300k-User Wearable AI

**Tagline**: "A 2nd brain you trust more than your 1st." 300,000+ professionals.

**Features**: Captures screen + conversations, transcribes real-time, generates summaries + action items, AI chat that remembers everything. Desktop + phone + wearables. Fully open source.

**WOTANN port**: Screen capture + conversation capture + memory retention patterns. WOTANN has computer-use + voice + memory — the wearable hardware is out of scope but the "always-on capture" model is relevant for iOS Dynamic Island + Widgets.

**Priority**: P2 — memory + always-on capture inspiration.

### 1.9 `research/clicky/` — AI Cursor Buddy

**Tagline**: "An AI teacher that lives as a buddy next to your cursor." Free, Mac-only.

**Features**: Sees screen, talks, points at UI. Open-source version on GitHub. Built with Claude Code.

**WOTANN port**: The "AI tutor next to cursor" is an interaction pattern for iOS + desktop (tutorial mode). Low effort but distinctive UX.

**Priority**: P3 — niche feature.

### 1.10 `research/archon/` — "First Open-Source Harness Builder"

**Tagline**: "The first open-source harness builder for AI coding. Make AI coding deterministic and repeatable."

**Positional**: Direct WOTANN competitor. Self-declared "harness builder" (not a harness itself — the meta-layer).

**WOTANN differentiation**: WOTANN is the harness + the multi-surface + the multi-channel. Archon is the substrate for building harnesses. Study their determinism approach.

**Priority**: P1 — competitive intelligence.

### 1.11 `research/claude-context/` — Codebase-as-MCP-Plugin

**Tagline**: "MCP plugin that adds semantic code search to Claude Code."

**Stack**: Node 20+, VS Code marketplace (@zilliz/claude-context-core, @zilliz/claude-context-mcp npm packages). Owned by Zilliz (Milvus/vector DB company).

**WOTANN port**: WOTANN has `src/context/*` (repo-map, virtual-context, window-intelligence) — claude-context is a simpler MCP-only surface. Consider exposing WOTANN's repo-map as an MCP tool compatible with Zilliz's surface.

**Priority**: P2 — MCP compatibility play.

### 1.12 `research/claude-task-master/` — Task Management MCP

**Tagline**: "A task management system for AI-driven development, designed to work seamlessly with any AI chat." task-master.dev.

**WOTANN port**: WOTANN has `TaskCreate/TaskUpdate/TaskList/TaskStop` built-in (internal). claude-task-master is the externalized MCP equivalent. Consider bridge.

**Priority**: P3 — nice alignment.

### 1.13 `research/cognee/` — Knowledge Engine

**Tagline**: "Cognee — Build AI memory with a Knowledge Engine that learns."

**14 retrieval types** (per MASTER_PLAN_V6 reference #30): GRAPH_COMPLETION / GRAPH_SUMMARY / GRAPH_COT / GRAPH_CONTEXT_EXT / TRIPLET / RAG / CHUNKS / CHUNKS_LEXICAL / SUMMARIES / CYPHER / NATURAL_LANG / TEMPORAL / FEELING_LUCKY / CODING_RULES.

**WOTANN has 2 retrieval types** (lexical + vector via `hybrid-retrieval.ts`). Gap: 12 retrieval modes.

**WOTANN port**: High-value — add graph-based + triplet + temporal retrieval modes. Aligns with LongMemEval leaders.

**Priority**: P1 — memory system expansion.

### 1.14 `research/deeptutor/` — Agent-Native Tutoring

**Tagline**: "DeepTutor: Agent-Native Personalized Tutoring" — HKUDS, Python 3.11+ + Next.js 16.

**WOTANN port**: Not directly relevant to code-agent use case. Pattern: per-user personalization + adaptive difficulty. Could inform iOS DesignModePanel user-guidance flow.

**Priority**: P3 — inspiration only.

### 1.15 `research/__new_clones_v2/emdash/` — YC W26 Project

**Tagline**: Not fully captured (README shields-heavy). Y Combinator W26 batch.

**Action**: Re-investigate when reachable. YC W26 is fresh (batch started March 2026), so this is leading-edge positioning.

**Priority**: Unknown — need deeper read.

### 1.16 `research/__new_clones_v2/superset/` — Apache Superset?

Not a git-clone-native repo given top-level structure. Likely Apache Superset (data viz). Not directly relevant to AI agent harness — skip.

**Priority**: Skip.

### 1.17 `research/__new_clones_v3/claude-code-game-studios/`

**Tagline**: "Turn a single Claude Code session into a full game development studio. 49 agents. 72 skills. One coordinated AI team."

**Counts**:
- 49 agents
- 72 skills
- 12 hooks
- 11 rules

**Significance**: Proves mass-agent coordination works inside Claude Code. WOTANN's 40+ slash commands + 86+ skills + 19-event hooks match this scale. Learn the coordination pattern.

**Priority**: P2 — study the orchestration within a single session.

### 1.18 `research/__new_clones_v3/evolver-v2/`

Likely next version of evolver (above). Same license/strategic trajectory. Read if relevant.

**Priority**: Deferred — evolver v1 analysis covers the concept.

### 1.19 `research/__new_clones_v3/omi-v2/`

Next version of omi (above). Same concept; may have new hardware.

**Priority**: Deferred.

### 1.20 `research/__new_clones_v3/paperless-ngx/`

**Tagline**: Document management system (not agent harness). Skip.

**Priority**: Skip.

### 1.21 `research/multica/` — "Next 10 Hires Won't Be Human"

**Tagline**: "Your next 10 hires won't be human." Open-source platform for running + managing coding agents with reusable skills.

**Positioning**: Multi-agent productivity harness. Direct WOTANN competitor in the "parallel agents" segment (Cursor 3 Agents Window equivalent).

**Priority**: P1 — positional study.

### 1.22 `research/generic-agent/` — 3K LOC Self-Evolving Agent

**Tagline**: "GenericAgent: minimal, self-evolving autonomous agent framework. ~3K lines of code. 9 atomic tools + ~100-line Agent Loop."

**Philosophy**: "Don't preload skills — evolve them." Every task solved → execution path crystallized into a skill. Skill tree accumulates over time.

**Key primitives**:
- 9 atomic tools
- ~100-line Agent Loop
- Browser + terminal + filesystem + keyboard/mouse + screen vision + ADB mobile
- Skill crystallization after every task

**WOTANN port**: Already have `src/skills/self-crystallization.ts` per Lane 1. Verify it matches generic-agent's pattern: auto-generate skill at every task completion, not just on-demand.

**Priority**: P1 — validate crystallization wiring.

### 1.23 `research/__new_clones/claw-code/` — OpenClaw Variant

**Tagline**: "Claw Code — ultraworkers/claw-code." Has Rust workspace, PARITY.md, ROADMAP.md, and UltraWorkers Discord.

**Significance**: Another OpenClaw fork/port. Confirms OpenClaw's ecosystem density. Lane 2 already noted OpenClaw's 247k stars + ecosystem.

**Priority**: Deferred — OpenClaw ecosystem broadly covered.

### 1.24 `research/autonovel/` — Karpathy autoresearch for Fiction

**Tagline**: "An autonomous pipeline for writing, revising, typesetting, illustrating, and narrating a complete novel."

**Inspired by**: Karpathy's autoresearch. Same modify-evaluate-keep/discard loop.

**First production**: "The Second Son of the House of Bells" — 19 chapters, 79,456 words.

**WOTANN port**: WOTANN has `src/training/autoresearch.ts`. Verify pattern matches. Not directly relevant to code-agent use case but demonstrates the iterate-on-artifact pattern.

**Priority**: P3 — technique validation.

### 1.25 `research/warp/` — Agentic Development Environment

**Tagline**: "Warp — Code + Agents + Terminal + Drive." Already partially covered in RESEARCH_USER_NAMED_COMPETITORS.md (Warp Oz = 60% of Warp's PRs via cron+webhook).

**Priority**: Covered elsewhere.

### 1.26 `research/oh-my-openagent/ (OMO)` — OpenClaw + Sisyphus Labs

**Tagline**: "Building in Public" with Jobdori, AI assistant built on heavily customized OpenClaw fork. Maintained by Sisyphus Labs ("agent that codes like your team").

**Significance**: OMO = OpenClaw customization pattern. Sisyphus is building a productized version. Hashline Edits (from user-named-competitors doc) come from this lineage.

**Priority**: Covered in USER_NAMED_COMPETITORS.

### 1.27 `research/wacli/` — WhatsApp CLI

**Tagline**: "wacli — WhatsApp CLI: sync, search, send."

**WOTANN relevance**: WOTANN has a WhatsApp channel adapter. `wacli` is a CLI client; study if WOTANN's adapter covers same operations.

**Priority**: P3 — adapter completeness check.

### 1.28 `research/ruflo/` — "Enterprise AI Orchestration"

**Tagline**: "🌊 RuFlo v3.5: Enterprise AI Orchestration Platform."

**Stack**: Node.js-based. Enterprise orchestration — distinct from WOTANN's dev-focused positioning.

**Priority**: P3 — tangential.

### 1.29 `research/magika/` — File Classification (WOTANN dep)

**Tagline**: "Magika" — Google's file-type classifier. **Note: this is the SECURITY-FLAGGED dependency** (9 CVEs in WOTANN's audit). P0-3 in master plan: drop this dep and replace with `magic-bytes.js`.

**Priority**: Already in P0 plan.

### 1.30 `research/gstack/` — Garry Tan's Tooling

**Tagline**: Garry Tan (YC President & CEO) showing 810× productivity acceleration via AI agents. Cites OpenClaw's Peter Steinberger shipping 247k-star project essentially solo.

**Strategic signal**: Normalizing "one-person-builds-like-team-of-20" with AI harnesses. WOTANN's positioning should emphasize this (narrative framing, not tech).

**Priority**: P3 — narrative source.

### 1.31 `research/awesome-design-systems/` — Design System References

**Tagline**: "A design system is a collection of documentation on principles and best practices."

**WOTANN port**: Reference material for WOTANN's design-brief work. Already embedded in the 20-file `design-brief/` directory.

**Priority**: Covered.

### 1.32 `research/deepgemm/` — DeepSeek CUDA Kernels

**Tagline**: "Unified, high-performance tensor core kernel library" — DeepSeek.

**WOTANN relevance**: Zero. GPU kernel library, not agent harness.

**Priority**: Skip.

### 1.33 `research/agents/` + `research/superpowers/`

Skill/agent collections. Similar to Addy Osmani + Karpathy packages. If not already mined, check for novel patterns.

**Priority**: P2 — quick scan.

### 1.34 `research/__new_clones/longmemeval/`

LongMemEval benchmark itself (already covered in Lane 5 + benchmark-leaders).

**Priority**: Covered.

### 1.35 `research/code-review-graph/`

**Tagline**: "Stop burning tokens. Start reviewing smarter." Multi-language i18n.

**WOTANN port**: Token-efficient code review pattern. WOTANN has `src/intelligence/auto-reviewer.ts` + the code-reviewer agent. Study token efficiency approach.

**Priority**: P2 — efficiency study.

---

## 2. Top 20 Port Candidates (ranked by impact × ease)

| # | Item | Source | Effort | Impact |
|---|---|---|---|---|
| 1 | 7 slash commands `/spec /plan /build /test /review /ship` | addyosmani-agent-skills | 1 day | Industry-standard alignment |
| 2 | Karpathy 4 principles audit vs current CLAUDE.md | andrej-karpathy-skills | 2 hrs | Quality baseline confirmation |
| 3 | OpenAI Agents SDK Guardrails API | openai-agents-python | 3 days | First-class validation |
| 4 | OpenAI Realtime Agents (voice via gpt-realtime-1.5) | openai-agents-python | 1 week | Voice as table-stakes |
| 5 | Cognee 12 additional retrieval modes | cognee | 2 weeks | LongMemEval-relevant moat |
| 6 | GenericAgent auto-crystallize-per-task | generic-agent | 2 days | Validate self-crystallization wire |
| 7 | DSPy + GEPA wiring audit | hermes-agent-self-evolution | 3 days | Unlock learning pipeline |
| 8 | Zed-style pane-management for 4 tabs | Glass (Zed fork) | 1 week | UX consolidation |
| 9 | claude-context MCP compatibility | claude-context | 3 days | Zilliz ecosystem reach |
| 10 | claude-task-master MCP bridge | claude-task-master | 2 days | TaskMaster ecosystem |
| 11 | Mass-agent coordination audit (49+72+12+11 counts) | claude-code-game-studios | 2 days | Proof of scale |
| 12 | "Parallel 10 hires" positioning | multica | 1 day | Narrative |
| 13 | clicky cursor-buddy UX on desktop | clicky | 3 days | Distinctive UX |
| 14 | Vercel Open Agents 3-layer cloud workflow | vercel-open-agents | 2 weeks (stretch) | Cloud WOTANN |
| 15 | Token-efficient code review patterns | code-review-graph | 2 days | Cost reduction |
| 16 | Omi screen+convo capture patterns | omi | 1 week | Always-on 2nd brain |
| 17 | Archon determinism model study | archon | 2 days | Determinism goals |
| 18 | autonovel modify-evaluate-keep/discard audit | autonovel | 1 day | Confirm pattern in WOTANN training |
| 19 | gstack narrative framing (810× productivity) | gstack | 0 days (marketing) | Positioning |
| 20 | wacli WhatsApp adapter completeness | wacli | 1 day | Channel parity |

---

## 3. Convergent Patterns (appearing in 3+ repos)

1. **Skill registry with slash-command mapping** — Addy Osmani, Karpathy, claude-code-game-studios, OMO, WOTANN itself all converge. This is the canonical pattern for discoverable AI workflows.

2. **Modify-evaluate-keep/discard evolutionary loop** — Hermes self-evolution (DSPy+GEPA), evolver, autonovel, generic-agent. Karpathy's autoresearch coined this. Core to "self-improving" agents.

3. **Crystallize task → skill after success** — GenericAgent, Hermes self-evolving, WOTANN `src/skills/self-crystallization.ts`. Accumulative learning without explicit training.

4. **3-layer architecture: UI / Agent-workflow / Sandbox-VM** — Vercel Open Agents, Jean, WOTANN (CLI+TUI+Desktop ↔ daemon ↔ sandbox executor). Universal pattern.

5. **MCP-native instead of bespoke API** — claude-context, claude-task-master, serena, cognee, every modern harness. WOTANN's `src/mcp/` already aligns; port as the only integration path.

---

## 4. Novel Items NOT in Prior Research

1. **Addy Osmani's 7-slash-command lifecycle** — packaged SDLC skills
2. **Karpathy's 4 principles as CLAUDE.md** — distilled, copy-pasteable
3. **Cognee's 14 retrieval modes** — WOTANN has 2, gap of 12
4. **OpenAI Realtime Agents + Guardrails as first-class APIs** — Voice parity baseline
5. **Glass (Zed fork) — browser + editor + terminal unified** — IDE segment competitor
6. **GenericAgent ~3K LOC minimalism + skill tree** — validates thesis
7. **Evolver vs Hermes source-available tension** — market signal that agent self-evolution is contested
8. **YC W26 emdash** — unknown competitor, investigate

---

## 5. Action Items (to fold into MASTER_PLAN_V7)

Add to P1 Competitor-Port Batch:
- **P1-C34**: Cognee 12 retrieval modes expansion
- **P1-C35**: Addy Osmani 7 slash commands taxonomy alignment
- **P1-C36**: Karpathy 4-principles audit in CLAUDE.md
- **P1-C37**: OpenAI Guardrails first-class API
- **P1-C38**: OpenAI Realtime Agents voice port
- **P1-C39**: GenericAgent auto-crystallize wiring audit
- **P1-C40**: DSPy + GEPA wiring audit (Hermes evolution or evolver pattern)

Add to P2 Polish:
- Token-efficient code review (code-review-graph) integration
- Vercel Open Agents cloud-mode exploration
- MCP bridges to claude-context + claude-task-master

---

## 6. Sources

All file paths in this document reference `/Users/gabrielvuksani/Desktop/agent-harness/research/<repo>/` on disk at 2026-04-20. Freshness varies — `rfix` script attempted pull-to-latest but 36/37 repos hit `git checkout -B` issues (stale `index.lock` from prior agent kills). Fetches succeeded, so repos have latest data fetched even if not checked out.

---

*Research folder scan completed manually after 2 agent watchdog stalls. Coverage: 20+ repos. Gaps: emdash and `__new_clones_v2/superset` require deeper investigation. All claims cite README.md or directory listings on disk.*

*Master plan V7 will integrate findings in §8 addendum as P1-C34 through P1-C40.*
