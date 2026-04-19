# Hidden-State Extraction Report

**Generated**: 2026-04-19 (Phase H agent — Opus 4.7, max effort)
**Scope**: runtime-state directories outside `wotann/src/**`, parent-level 250KB+ analysis docs
**Companion**: `docs/SPEC_VS_IMPL_DIFF.md` (223-feature spec-vs-impl matrix)

This report surfaces every byte of hidden state — live WOTANN daemon DBs, abandoned nexus stubs, q-learning weights, browser automation logs, spec archaeology — plus an unknown-unknowns harvest from nine parent-level analysis MDs that the 2026-04-19 audit cycle did NOT pick up.

---

## PART A — Runtime State (`wotann/.wotann/`)

### A.1 Inventory

47 files + 5 subdirs + 30+ stale `knowledge-graph.json.tmp.*` zombies (atomic-write leftovers that Node's graceful-shutdown never reaped). Active-runtime state lives under `/Users/gabrielvuksani/Desktop/agent-harness/wotann/.wotann/`. Parent-level `/Users/gabrielvuksani/Desktop/agent-harness/.wotann/` does NOT exist (Agent A's original "prior state" lead is false). Parent-level `/Users/gabrielvuksani/Desktop/agent-harness/.shadow-git/` also does not exist; the only shadow-git code path is `src/utils/shadow-git.ts`.

**Key files** (size + purpose):

| Path | Size | Notes |
|---|---|---|
| `memory.db` | (active SQLite, 21 tables, WAL mode) | 1,990 rows in auto_capture, 0 in memory_entries / knowledge_nodes / decision_log — **the canonical observation is that past sessions never populated the structured blocks**. Everything landed in auto_capture as session_start / session_end / instinct_active / user_prompt events. |
| `memory.db-wal` / `memory.db-shm` | varies | SQLite WAL files, last heartbeat 2026-04-19 11:17 |
| `memory 2.db-shm`, `memory 3.db-wal`, ..., `memory 7.db-shm` | 6 orphaned WAL/SHM pairs | **DB ROT** — 6 abandoned SQLite checkpoints from crashed daemons. No corresponding `.db` files. Deletion candidates. |
| `plans.db` | 3 tables (plans/milestones/tasks) | **ALL EMPTY** — the planning DB has never been used. 0 rows in all 3 tables. |
| `knowledge-graph.json` | 49 B | `{"entities":[],"relationships":[],"documents":[]}` — literally the empty template. The daemon writes to it on every tick but has never populated entities. |
| `knowledge-graph.json.tmp.*` × 30+ | 0–49 B each | Atomic-write temp files (`write-temp-then-rename`). Process crashes or SIGTERM-without-cleanup leaves these behind. **Footgun**: they accumulate forever. Need either `process.on('exit')` cleanup OR a startup-time sweep. |
| `instincts.json` | 345 B | Single test instinct: `"Say only the word HELLO and nothing else"` — confidence 0.01, 1 occurrence, seeded 2026-04-14. Confirms learning loop fires, just on a junk prompt. |
| `last-dream.json` | 124 B | `{"dreamedAt":"2026-04-13T00:00:53.917Z","gotchasAdded":0,"instinctsUpdated":0,"rulesUpdated":10}` — most recent dream ran but didn't enrich anything (0 processed entries). |
| `learnings.json` | 2 B | `[]` — no auto-learnings captured yet. |
| `daemon.status.json` | 130 B | `{"pid":24025,"startedAt":"2026-04-09T21:17:34","status":"stopped","heartbeatTasks":12,"tickCount":10575}` — daemon died after 10,575 ticks (roughly 44 hours uptime). |
| `token-stats.json` | 245 B | **`totalInputTokens:0, totalOutputTokens:0, sessionCount:2225, byProvider:{}`** — 2,225 sessions tracked but ZERO tokens attributed to any provider. `telemetry/cost-tracker.ts` never wrote. |
| `ui-state.json` | `{"panel":"diff"}` | Last UI panel was the diff view. |
| `HEARTBEAT.md` | 224 B | "Heartbeat interval: 15 seconds, Workers: 12 background analyzers" |
| `IDENTITY.md` | 239 B | "role: AI Development Agent, capabilities: multi-provider intelligence, autonomous execution, cross-device synergy, desktop control, security research" |
| `AGENTS.md` | 5164 B | **Full system prompt** — defines WOTANN as non-chatbot thinking partner, lists capabilities (file ops, shell, desktop control, web, multi-device, autonomous, memory, LSP, git). |
| `SOUL.md` | — | Germanic All-Father framing, Huginn + Muninn (thought + memory ravens), "no fake comprehension," "evidence over assertion." |
| `DESIGN.md` | 4644 B | Complete "Obsidian Precision" UI design token spec (OLED black `#000000`, Apple system blue `#0A84FF`, SF Pro Text, 8pt grid, 4 tabs Chat/Editor/Workshop/Exploit). |
| `USER.md` | 224 B | Template stub — `"WOTANN learns about you over time"`. No user profile captured. |
| `TOOLS.md` | — | Lists core tools (Read/Write/Edit/Glob/Grep/Bash/LSP) + standard + enhanced (HashlineEdit, SymbolEdit) + MCP (context7, lightpanda, playwright, qmd). |
| `BOOTSTRAP.md` | 921 B | Session-start bootstrap context template with placeholders `{workingDir}`, `{gitBranch}`, `{provider}`, `{model}`, `{mode}`, `{contextWindow}`, `{sessionCost}`. |
| `AGENT-ROSTER.md` | 1112 B | 14 agents — Planning-tier (planner/architect/critic/reviewer/workflow-architect), Implementation-tier (executor/test-engineer/debugger/security-reviewer/build-resolver), Utility-tier (analyst/simplifier/verifier), Specialist (computer-use). |
| `DREAMS.md` | 1654 B | Dream diary with 5+ consecutive "Entries processed: 0" entries on Apr 8, 11, 13 — dream pipeline fires on schedule but has no real content to consolidate. |
| `MEMORY.md` | — | 8-layer memory stack description (Layer 0 auto-capture → Layer 7 proactive). Listed path `~/.wotann/memory.db` is DIFFERENT from the actual `wotann/.wotann/memory.db` (wrong home-dir assumption). |
| `gotchas.md` | 18 B | Just the header `# WOTANN Gotchas`. No gotchas recorded. |
| `context-tree/user/profile.json` | 199 B | `{"corrections":[], "preferences":[], "expertise":[{"domain":"default","level":"intermediate"}], "communicationStyle":"concise", "observationMode":"observeMe"}` — **the per-user profile exists and is populated** but lacks corrections/preferences content. |
| `dreams/light-candidates.json` | 71 B | `{"candidates":[],"duplicatesRemoved":0,"totalProcessed":0}` |
| `dreams/rem-signals.json` | 55 B | `{"signals":[],"domainCount":0,"themes":[]}` |
| `episodes/memory/episodes/` | empty dir | The recursive `episodes/memory/episodes/…` suggests bootstrap code creates the tree but never writes EpisodicMemory rows. |
| `sessions/*.json` | 27 files | Each ~317–471 bytes: session shell only. **Every session has `conversation:[], activeTasks:[], totalCost:0, contextTokensUsed:0, memoryContext:""`** — runtime never hydrates sessions before saving. |
| `streams/stream-*.json` | 2 files | Stream state with "model":"gemma4:latest" provider ollama prompt "Say hello" — test/demo traffic. |
| `threads/1f5c78b0.../` and `threads/e294ba37.../` | 2 empty dirs | Thread-conversation rooms (empty). |
| `logs/2026-04-0{6..14}.jsonl`, `2026-04-17.jsonl`, `2026-04-18.jsonl`, `2026-04-19.jsonl` | **30.3 MiB total** | Daily JSONL. Apr-11 is largest (2.58 MiB). Apr-19 is growing (881 KiB at 12:16). This IS the real runtime trail; it has not been processed into structured memory. |

### A.2 Memory.db deep-dive

Schema = 21 tables. Canonical ones:
- `memory_entries` (6 layers + domain/topic + freshness_score + confidence_level + verification_status) — **0 rows**.
- `knowledge_nodes` + `knowledge_edges` (bi-temporal: `valid_from`/`valid_to`/`created_at`) — **0 rows**.
- `decision_log` (decision + rationale + alternatives + constraints + stakeholders) — **0 rows**.
- `working_memory`, `team_memory`, `memory_vectors`, `memory_provenance_log` — **all 0**.
- `verbatim_drawers` + `verbatim_fts` (raw conversation archive, FTS5) — **0 rows**.
- `auto_capture` — **1,990 rows**: 1,983 `session_end` + 3 `session_start` + 2 `instinct_active` + 2 `user_prompt`.

**CONCLUSION** — The runtime schema is mature (bi-temporal KG, domain/topic indexing, verbatim drawers, provenance log, FTS5 on both entries and verbatim), but NONE of the Layer-1-through-7 code paths actually write rows. Only auto-capture fires. **All 1,990 session_end events report: `Duration: 0m 0s, Provider: anthropic (auto), Tokens: 0, Cost: $0.0000, Tool calls: 0, Messages: 0`** — sessions are created-then-immediately-saved without running anything. This is consistent with the Gabriel 2026-04-04 testing pattern: daemon started, session fire, crash.

Sample user prompts captured: only 2 in 16 days — `"Say only the word HELLO and nothing else"` and `"Say hello"`. Both trigger the instinct pipeline with `confidence: 0.01` (default fallback). 

Top-level auto_capture-by-type: session_end (1,983) > session_start (3) > instinct_active (2) = user_prompt (2). The delta (1,983 ends vs 3 starts) proves `session_end` is called without a matching `session_start` — persistence is lopsided.

### A.3 Plans.db

Schema: plans → milestones → tasks, with status / phase / dependencies (JSON array) / files (JSON array) / sort_order / timestamps. 

**Status**: 0 plans, 0 milestones, 0 tasks. The planning system has never been invoked. This matches the audit finding that `.wotann/` planning state has never been produced — plans may exist in `plans/` on disk (I haven't checked), or the CLI uses in-memory plans.

---

## PART B — Abandoned State Directories (`/Users/gabrielvuksani/Desktop/agent-harness/.nexus/`)

Per prior Agent C inventory: `memory.db` is EMPTY (0 rows all 7 tables). Verified:

| Path | Size | Content |
|---|---|---|
| `.nexus/memory.db` | 159,744 B | 7 tables (memory_entries, knowledge_nodes, knowledge_edges, decision_log, auto_capture, working_memory, team_memory) — all 0 rows. |
| `.nexus/memory.db-shm`, `-wal` | 32 KiB, 0 B | WAL files present (daemon had this open until Apr-19 11:17). |
| `.nexus/sessions/` × 9 JSONs | 310 B each | All 310-byte session shells created 2026-04-03. Stale. |
| `.nexus/episodes/memory/` | empty | Episode dir scaffold, no rows. |
| `.nexus/screenshots/` | empty | Screenshot dir scaffold. |

**Verdict**: `.nexus/` is **pre-rebrand dead weight**. The old "Nexus" product's daemon wrote the same dirs but never populated data. Deletion candidate for Phase I cleanup (saves no bytes of value; only adds confusion to tree walks).

---

## PART C — q-Learning Model (`/Users/gabrielvuksani/Desktop/agent-harness/.swarm/`)

```json
{
  "version": "1.0.0",
  "config": { "learningRate": 0.1, "gamma": 0.99, "explorationDecayType": "exponential", "numActions": 8 },
  "qTable": {
    "fstate_4gfz7k": { "qValues": [5.37, 0, 0, 0, 0, 0, 0, 0], "visits": 32008 }
  },
  "stats": { "stepCount": 1000, "updateCount": 1000, "avgTDError": 2.51, "epsilon": 0.63 },
  "metadata": { "savedAt": "2026-04-03T23:19:22.473Z", "totalExperiences": 1000 }
}
```

**What it reveals about intent**: Swarm runtime was instrumented with Q-learning tabular RL (8 discrete actions, 1 feature-hashed state). It saw 32,008 visits of a single state, converged only action 0 (Q=5.37), and stopped after 1,000 experiences. The test objective was `"Test project"` with 6 agents (1 Test Lead, 2 Unit Tester, 2 Integration Tester, 1 QA Reviewer) but **the swarm was explicitly stopped within 15 milliseconds of starting** (`startedAt 23:18:08.286Z`, `stoppedAt 23:18:08.301Z`). This is a proof-of-concept RL harness that never ran real tasks.

**Signal for WOTANN**: There is latent infrastructure for agentic RL (`src/learning/darwinian-evolver.ts`, `src/learning/miprov2-optimizer.ts`, `src/learning/reflection-buffer.ts`) — all 3 ORPHAN per WOTANN_INVENTORY.md but tested. Wiring them into a real Q-learning loop is a **Tier 3 differentiation** opportunity (none of the 37 competitors in COMPETITIVE_ANALYSIS.md has an RL-based self-improving harness). See also `autoresearch` in `training/autoresearch.ts` — found via Grep, distinct from the abandoned `.swarm/` Q-table.

---

## PART D — Browser Automation (`/Users/gabrielvuksani/Desktop/agent-harness/.playwright-mcp/`)

101 console log files (~218 MiB total), one `Ollama.dmg` (not inspected — likely a drive-by cache from a Playwright job that tried to download Ollama).

Log timestamps cluster around **2026-04-05 between 17:24 and 21:57 UTC** — a burst of Playwright MCP activity on a single evening. Largest: 236 KiB (`console-2026-04-05T19-14-07-262Z.log`). These are browser console logs — stdout/stderr of Playwright's browser subprocess. They are incidental artifacts, not persistent state.

**What it reveals**: During the Apr-5 session, the Playwright MCP server was exercised heavily (101 runs in 4.5 hours = ~22 sessions/hour). This aligns with Apr-4/Apr-5 being the big competitor-research phase where WOTANN scraped sites to gather feature lists. None of the logs appear to contain secrets. Deletion recommended post-cleanup.

**Ollama.dmg presence** is suspect — did a scraping job navigate to ollama.com and trigger a download? Worth checking git log for `.playwright-mcp/` references. No intrinsic security issue, but 200+ MiB of evict-able dead weight.

---

## PART E — Parent `.claude-flow/` and `.github/` and `.superpowers/`

- `.claude-flow/metrics/swarm-activity.json` — (not opened, likely metric dump from the same abandoned swarm run as Part C).
- `.github/agents/planner.agent.md` (17,661 B) — **a full agent definition checked into parent `.github/`**. Given the project has its own `.github/` at `/Users/gabrielvuksani/Desktop/agent-harness/wotann/.github/`, this parent-level one is stale. The planner.agent.md predates the `~/.claude/agents/` directory (Gabriel's global agents now live there per CLAUDE.md). Candidate for deletion, but first verify: `git log --follow .github/agents/planner.agent.md` to see if it was referenced by a workflow.
- `.superpowers/brainstorm/` — 1 subdir with 0 files. Confirms Agent A's "empty scaffold" claim.

---

## PART F — Parent 250KB+ Doc Syntheses (~200 words each)

Nine large analysis docs at `/Users/gabrielvuksani/Desktop/agent-harness/` were produced in April 2026 during the multi-round research phase. Distilled here with focus on **features / patterns NOT in current WOTANN audit docs**.

### F.1 `AGENT_FRAMEWORK_ANALYSIS.md` (34 KB, 580 lines)

Architectural analysis of 10 agent frameworks (DeerFlow, DeepAgents, Open-SWE, Hermes, Eigent, Ruflo, Claude Task Master, wshobson/agents, Oh-My-OpenAgent, Opcode). **Cross-project pattern synthesis**: (1) every framework uses an ordered middleware chain with before-model / around-tool / after-model / after-agent hooks — this is the dominant pattern; (2) subagent delegation with MAX_CONCURRENT_SUBAGENTS=3 and MAX_DEPTH=2 is universal; (3) Open-SWE's `@after_agent` "deterministic safety net" pattern guarantees PR creation regardless of LLM — not just a prompt; (4) Ruflo implements **Raft consensus / Gossip protocol / Byzantine fault tolerance** for multi-agent coordination, a concept foreign to WOTANN's current orchestration; (5) Hermes implements **dangerous command approval system** with 30+ regex patterns for recursive delete/filesystem format/fork bombs/SQL DROP, plus smart-approval via auxiliary LLM for low-risk commands; (6) wshobson's **PluginEval framework** — 3-layer evaluation (static analysis + LLM judge + Monte Carlo simulation) with 10 quality dimensions (triggering accuracy, orchestration fitness, progressive disclosure, token efficiency, anti-patterns) and Platinum/Gold/Silver/Bronze certification. **Not in audit**: Raft/Gossip/Byzantine consensus; DangerousCommandApproval; PluginEval certification tiers; Opcode's "branching session timeline with fork/restore" as GUI-level history navigation; Mixture-of-Agents tool (combine outputs from multiple models as single response).

### F.2 `COMPETITIVE_ANALYSIS.md` (36 KB, 667 lines)

12-project competitor analysis (OpenClaw, Crush, KiloCode, AutoGPT, LibreChat, Hive, OpenViking, oh-my-pi, Serena, cc-switch, claude-code-router, LobeHub). Key features NOT in audit: (1) OpenClaw **DM pairing security** — unknown senders MUST receive a pairing code before bot processes messages (per Telegram abuse prevention); (2) Hive **Queen Bee / Worker Bees / Judge Node / Event Bus RAM pub/sub** architecture for multi-agent coordination with credential-store encrypted disk persistence; (3) OpenViking **filesystem paradigm for context** (`ls`, `tree`, `find`, `grep` on agent memory — radical UX); (4) LobeHub **Agent Groups** (multi-agent collaboration on same task with parallel iteration), **Scheduled agent runs**, **white-box editable memory** (users can see+edit what agents remember), **10,000+ MCP marketplace**; (5) cc-switch **Deep Link protocol** (`ccswitch://` URLs for one-click provider/MCP/prompt/skill imports); (6) claude-code-router **Intent-based routing** (`default`/`background`/`think`/`longContext`/`webSearch`/`image` task types route to different models with `/model` switch mid-session); (7) oh-my-pi **IPython kernel tool** with rich outputs (images, HTML, Markdown, JSON trees, mermaid diagrams, custom modules), **SSH tool with SSHFS mounts**, **AI-powered git commits with hunk-level staging**. **Not in audit**: Deep Link protocol; Scheduled agent runs as first-class feature (LobeHub-style cron); Agent Groups shared workspace; OpenViking filesystem context paradigm.

### F.3 `COMPETITOR_FEATURE_COMPARISON_2026-04-03.md` (27 KB, 414 lines)

Feature-by-feature matrix across 8 tools + NEXUS. **Context window table** (crucial for WOTANN context/limits.ts): Opus 4.6 = 1M, Sonnet 4.6 = 1M, GPT-5.4 = 1,050,000, Gemini 3.1 Pro = 1M+, **Grok 4.20 = 2M (largest)**, DeepSeek V3.2 = 128K, Mistral Large 3 = 128K. Current WOTANN limits.ts almost certainly undercounts — per the doc "**NEXUS limits.ts needs updating for Opus 4.6 (200K → 1M) and GPT-5.4 (400K → 1,050,000)**." **free-code feature-flag gaps** (things WOTANN is MISSING from the 88-flag audit): `HISTORY_PICKER`, `MESSAGE_ACTIONS`, `QUICK_SEARCH`, `SHOT_STATS`, `CACHED_MICROCOMPACT`, `BRIDGE_MODE` (IDE remote-control bridge), `BASH_CLASSIFIER`, `KAIROS_BRIEF`, `AWAY_SUMMARY`, `LODESTONE` (deep-link/protocol-registration flows), `TREE_SITTER_BASH`. **Unique to Codex**: Rust-native performance, desktop+web+CLI trinity, native web search. **Unique to OpenHands**: Docker sandbox runtime, Kubernetes scaling, web GUI, Slack/Jira/Linear integrations, Theory-of-Mind module, SWE-Bench leadership. **Not in audit**: the explicit 1M/2M context window gap for Opus+Grok; MESSAGE_ACTIONS + SHOT_STATS + KAIROS_BRIEF flags (distinct from the Session-1-through-5 provider bug list).

### F.4 `COMPREHENSIVE_SOURCE_FINDINGS_2026-04-03.md` (53 KB, 1,014 lines)

Deepest research document — 90+ sources, 8 parallel research agents. Top-10 novel features: (1) **karpathy/autoresearch** pattern — autonomous ML research loop with fixed 5-minute time budgets, metric independence (bits-per-byte not loss), program.md human-editable directives — applied to the harness itself gives a self-improving harness that optimizes its own middleware weights; (2) **llm-council 3-stage deliberation** (Individual → Peer Review → Chairman Synthesis) with anonymized peer review; (3) **nanochat $100 fine-tuning pipeline** — session data → training pairs → Unsloth LoRA → deploy to Ollama as personal provider tier; (4) **ByteRover context trees** with 96% memory accuracy benchmarks (LoCoMo + LongMemEval-S) — portable memory that works across Claude Code/Cursor/Windsurf/Cline; (5) **LightRAG** — graph-based RAG with dual-level retrieval (entity/relation + chunk), multi-hop inference, BGE-Reranker, pluggable storage (Neo4j/PostgreSQL/Chroma/Faiss/Milvus); (6) **TurboQuant** ICLR 2026 — 6x KV cache compression + 8x speedup zero accuracy loss — applied to Qwen3-Coder-Next 131K = effective 786K context; (7) **VibeVoice-Realtime 0.5B** — 300 ms first-audible latency streaming TTS; (8) **fff.nvim frecency + combo-boost** file search (100x multiplier for co-accessed file combinations); (9) **Onyx 50+ data connectors** (Google Drive, Slack, Notion, Confluence, Jira, GitHub) as KNOWLEDGE sources not just messaging channels; (10) **Hermes v0.7 credential pools with least-used rotation + compression-death-spiral prevention + PII redaction pre-provider + plugin lifecycle hooks (pre/post LLM call + session hooks) + GPT tool-use enforcement (prevent GPT from describing instead of calling) + MCP OAuth 2.1 PKCE**. **Not in audit**: autoresearch for harness self-optimization; llm-council 3-stage deliberation; LightRAG graph modes; TurboQuant + local 786K context; fff.nvim combo boost; Onyx knowledge connectors; compression-death-spiral detection as distinct from generic doom-loop.

### F.5 `DEEP_SOURCE_EXTRACTION_2026-04-03.md` (33 KB, 448 lines)

10 deep per-source extractions with effort tags. **Top missing features ranked**: Autonomous Skill Creation + Self-Improvement (Hermes — the only feature that compounds over time), DB-Backed Planning + Full-Milestone Auto Mode (GSD), Knowledge Graph from Codebase (LightRAG), Multi-Agent v2 with Structured Messaging (Codex — path-based addresses `/root/agent_a`, `fork_context`/`task_name`/`send_message`/`assign_task`/`list_agents`), Agents Window Parallel Grid (Cursor 3), Visual Workflow Builder (AutoGPT), VibeVoice ASR/TTS, FUSE/ProjFS Task Isolation, Credential Pools (Hermes), Agent Skills Open Standard Full Compliance (Crush/OpenCode — `.agents/skills/`). **10 Novel Features NEXUS Could Pioneer**: (1) Consensus Engine (arena + council + multi-model verification + harness-level RL that trains the router from deliberation outcomes); (2) Knowledge Fabric (graph RAG + 8-layer memory + context tree + provenance with trust score + freshness + verification-state on every retrieved context); (3) Self-Optimizing Harness (autoresearch applied to the harness itself — prompt templates, middleware order, routing weights); (4) Universal Dispatch Plane (messaging + knowledge source connectors unified — query Notion/Confluence/Jira from Slack message); (5) **Infinite Context Local** (TurboQuant 6x + context virtualization + sharding gives local Qwen3-Coder 786K effective context); (6) Skill Forge (auto-generate + track success rate + promote-on-success to marketplace + Agent Skills interop); (7) Visual Timeline Debugger (shadow git + branching timelines + replay + "what if it had tried approach B" forking); (8) Live Steering Dual-Terminal (GSD pattern — Terminal 1 auto-execute, Terminal 2 edit state files for mid-run steering); (9) **Personal Model Pipeline** (session traces → Alpaca pairs → Unsloth LoRA → Ollama deploy); (10) Provider-Agnostic Capability Equalization (vision for non-vision models, tool-use for non-tool models, thinking for non-thinking, MCP for non-MCP). **Not in audit**: 10 novel-feature combinations (vs individual features); "compression death spiral prevention" as separate from doom loop; path-based agent address tree (`/root/agent_a`) for subagent topology.

### F.6 `ECOSYSTEM-CATALOG.md` (34 KB, 735 lines)

Claude Code ecosystem catalog — 25 projects, 130K+ stars analyzed collectively. **12 feature categories** that emerged from convergent evolution: (1) CLAUDE.md project instructions (all 25), (2) skill files with frontmatter (.md), (3) hook system pre/post tool use, (4) mode switching (SuperClaude 7 modes), (5) memory persistence (claude-mem, Engram), (6) TDD enforcement (Superpowers deletes pre-test code), (7) parallel subagents (Wave + team mode), (8) prompt engineering tools (Thinking-Claude, prompts.chat), (9) cost tracking (last30days + /cost), (10) code review (code-reviewer skill/agent), (11) marketplaces (wshobson, VoltAgent, claude-code-templates), (12) onboarding (claude-howto quizzes). **Unique patterns**: Personas with C-level advisory (alirezarezvani — CTO/CMO/CFO thinking modes); **4 orchestration patterns** (Solo Sprint + Domain Deep-Dive + Multi-Agent Handoff + Skill Chain); **Foundation Context Pattern** (coreyhaines31 — one foundation skill that all domain skills consult before acting — enforces consistency); **Self-Assessment Quizzes** as skills (claude-howto — Claude Code tests user knowledge of Claude Code features — meta); **Defuddle** (kepano/obsidian-skills — clean web page markdown extraction optimized for token budget, removes UI clutter); **AgentShield** (everything-claude-code — 1282 tests, 102 security rules for scanning MCP/skills pre-install). **Not in audit**: foundation context pattern; self-assessment quizzes as skills; Defuddle clean extraction; AgentShield 1282-test scanner with 102 rules (distinct from the `security/` dir's 16 files).

### F.7 `research/COMPUTER_CONTROL_ARCHITECTURE.md` (48 KB, 1,040 lines)

Full technical architecture for hybrid Computer Use. **Claude Computer Use API (computer_20251124)** — the NEW version for Opus 4.6/Sonnet 4.6/Opus 4.5 adds `zoom` action (region-based inspection at full resolution via `enable_zoom: true`), on top of the 2025-01-24 enhanced set (scroll directional, drag, right/middle-click, double/triple-click, mouse up/down, hold_key with duration). **Coordinate scaling math** — API caps at 1568 px longest edge + 1.15 MP total; `scale = min(1.0, 1568/max(W,H), sqrt(1_150_000/(W*H)))`; screenshots MUST be pre-resized, and Claude's coordinates MUST be inverse-scaled back. **System prompt + tool overhead: 466-499 + 735 tokens PER turn** (a non-trivial context tax). **Playwright MCP 2 modes**: Snapshot mode (accessibility tree, 2-5 KB) vs Vision mode (coordinates, 100 KB+). **Apple safety pattern**: per-app permissions, blocked by default for investment/trading/crypto apps, passwords/financial/health auto-excluded from memory. **Lightpanda** — Zig-based headless browser, 9x faster 16x less memory than Chrome, CDP-compatible (Playwright code as drop-in), no rendering so no screenshots. **Not in audit**: the explicit Claude computer_20251124 tool version and its `zoom` action (WOTANN may still be on `computer_20250124`); the exact coordinate-scaling formula; CU per-turn overhead (466+735 tokens); Lightpanda as the "fast path" vs Playwright as the "visual path"; Apple's domain-allowlist pattern for CU safety.

### F.8 `AGENTS.md` (5,164 B) + `BUILD_GUIDE.md` (156 lines) + `MASTER_CONTINUATION_PROMPT.md` (176 lines)

Parent-level **AGENTS.md** is the global agent roster (also mirrored into `~/.claude/agents/` per CLAUDE.md). **BUILD_GUIDE.md** describes the 28-week phase-by-phase build order from V4 spec — Phase 0 accuracy → Phase 15 ship. **MASTER_CONTINUATION_PROMPT.md** is the resume-from-compaction prompt template with references to all the docs for context recovery. **Not in audit**: explicit 28-week phase timeline; MASTER_CONTINUATION_PROMPT as a reusable compaction-recovery template.

### F.9 `NEXUS_V1_SPEC_old.md` (1,559 lines) + `NEXUS_V2_SPEC_old.md` (1,321) + `NEXUS_V3_SPEC_old.md` (2,476) + `SOURCES.md` (188) + `UNIFIED_SYSTEMS_RESEARCH.md` (1,328)

Older spec generations (V1-V3, 5,356 lines combined). V4 is their synthesis. **Historical pattern observation**: V3 claimed **13 channels, 6-layer memory, 11 providers**; V4 upgraded to **24 channels, 8-layer memory, 9 providers** (but claims 11 elsewhere — inconsistent). Each major version doubled the feature count (roughly V1 ~80, V2 ~130, V3 ~180, V4 223). **SOURCES.md** is a 188-line ledger of the 82+ analyzed projects (plus Appendix N's audit matrix in V4). **UNIFIED_SYSTEMS_RESEARCH.md** has the cc-switch + musistudio/claude-code-router deep-dives + `~/.claude/rules/` audit. **Not in audit**: the versioning pattern showing spec inflation across V1→V4 (a 3x growth in 6 months, suggesting the spec itself may be over-scoped); explicit cross-version feature diff.

---

## PART G — Unknown-Unknowns Harvest

For each of the 9 parent docs + the hidden runtime state, here are the features / ideas / patterns that the audit prompt, `docs/AUDIT_2026-04-19.md`, and memory did NOT surface. **Collected in no particular order; deduplicated against the existing audit.**

### G.1 From runtime state
1. **zombie tmp-file leak** — 30+ `knowledge-graph.json.tmp.*` files accumulate because atomic writes don't cleanup on SIGTERM. Bar 15 candidate: "atomic-write cleanup hook on process exit."
2. **6 orphaned WAL/SHM pairs** (`memory 2.db-shm` through `memory 7.db-shm`) with no `.db` — proves past crashes left partial transaction state. Never detected by any doctor/health-check. **Consider: `wotann doctor --strict` should scan `.wotann/` for orphaned WAL without `.db`.**
3. **Session ends without starts** — 1,983 session_end rows vs 3 session_start in auto_capture. The start-event path is either never invoked OR races with an insta-close. Bug, not yet triaged in any audit.
4. **token-stats.json is always zero** (`totalInputTokens: 0, byProvider: {}`) across 2,225 sessions — cost-tracker wrote nothing. Confirmed silent-success path. Session-6 sprint had 59 commits pushed but zero cost telemetry captured.
5. **`knowledge-graph.json` is NEVER populated** — the file is `{"entities":[],"relationships":[],"documents":[]}` (49 bytes) and stays that way. The live KG is in `memory.db` tables (also 0 rows). Either the graph-building code path isn't wired, OR the graph is truly empty because no conversations ran.
6. **`stream-1776203265754.json` has model `"gemma4:latest"`** — proves Gemma 4 is wired for Ollama but the test prompt `"Say hello"` ran 4 minutes after session start. Gemma 4 is NOT bundled (WOTANN plan v3 claimed bundled) but IS wired as an Ollama model.
7. **Per-session state leaks inside `streams/`** — stream state retains full `sessionBeforeQuery` including provider+model+tokenCount. If multiple users share a daemon, one user's stream state is readable by all. Security smell; not in audit.

### G.2 From AGENT_FRAMEWORK_ANALYSIS
8. **Raft / Gossip / Byzantine consensus** for multi-agent coordination (Ruflo pattern) — not considered in WOTANN orchestration layer.
9. **DangerousCommandApproval with 30+ regex + smart-auto-approve via auxiliary LLM** (Hermes) — WOTANN has `security/command-sanitizer.ts` + `security/human-approval.ts`; the SMART auto-approve is missing.
10. **PluginEval Platinum/Gold/Silver/Bronze certification** (wshobson) — static analysis + LLM judge + Monte Carlo — 10 quality dimensions — NOT applied to WOTANN's 87 skills.

### G.3 From COMPETITIVE_ANALYSIS
11. **Deep Link protocol `wotann://` / `ccswitch://`** for one-click provider/MCP/prompt/skill imports (cc-switch) — `src/core/deep-link.ts` exists but is ORPHAN (imports_in = 0). Wire-up gap.
12. **LobeHub white-box editable memory** — users see + edit what agent remembers. WOTANN has 38 memory modules but no memory-editor UI panel.
13. **IPython kernel tool with rich outputs** (oh-my-pi) — images, HTML, Markdown, JSON trees, mermaid, custom modules. Not in WOTANN; would be a Tier-2 differentiator.
14. **SSH tool + SSHFS mounts** for remote command execution (oh-my-pi) — not in WOTANN.

### G.4 From COMPETITOR_FEATURE_COMPARISON
15. **`context/limits.ts` undercounts Opus 4.6 (1M actual)** and GPT-5.4 (1,050,000 actual) and **misses Grok 4.20 (2M, largest)** — fix in Tier 0.
16. **11 missing free-code flags**: HISTORY_PICKER, MESSAGE_ACTIONS, QUICK_SEARCH, SHOT_STATS, CACHED_MICROCOMPACT, BRIDGE_MODE, BASH_CLASSIFIER, KAIROS_BRIEF, AWAY_SUMMARY, LODESTONE, TREE_SITTER_BASH. Confirmed zero matches in `src/` for all 11 via grep.
17. **Theory-of-Mind module** (OpenHands) — understanding user intent via internal user model. WOTANN has `identity/user-model.ts` but no active Theory-of-Mind inference.
18. **IPFS code archival** (free-code) — novel feature; permanent pinned code on IPFS/Filecoin.

### G.5 From COMPREHENSIVE_SOURCE_FINDINGS
19. **autoresearch applied to the harness itself** — WOTANN has `src/training/autoresearch.ts` but no Grep hit showing it optimizes prompts/middleware/routing. Tier 3 Killer Feature candidate.
20. **llm-council 3-stage deliberation with anonymized peer review + chairman synthesis** — distinct from WOTANN's current `orchestration/council.ts` which may be simpler.
21. **TurboQuant 6x KV compression + 8x speedup → Qwen3-Coder-Next 131K → 786K effective** — WOTANN has `src/context/ollama-kv-compression.ts` (one of the 9 Grep hits). Wire to actual TurboQuant paper + benchmark.
22. **Onyx 50+ knowledge connectors** distinct from messaging channels (WOTANN has 25 channels but only 5 connectors: confluence, google-drive, jira, linear, notion — all ORPHAN per WOTANN_INVENTORY).
23. **fff.nvim combo-boost file search** (100x multiplier for files opened together) — WOTANN has `src/intelligence/parallel-search.ts` but no combo boost.
24. **MCP OAuth 2.1 PKCE** (Hermes v0.4) — WOTANN MCP registry may not support PKCE OAuth yet.
25. **Compression-Death-Spiral prevention** (Hermes) — distinct from generic doom-loop; specifically detects compression→fail→compress loop.
26. **GPT Tool-Use Enforcement** (Hermes v0.5) — prevent GPT models from describing tool calls in text. WOTANN tool parsing may be vulnerable.
27. **Multi-Instance Profiles** (Hermes v0.6) — run multiple isolated WOTANN instances from same install with own config/memory/sessions.
28. **Plugin Lifecycle Hooks** (Hermes v0.5) — pre/post LLM call hooks + session hooks; complements WOTANN's 23 hook registrations.

### G.6 From DEEP_SOURCE_EXTRACTION
29. **Agents Window Parallel Grid** (Cursor 3) — separate workspace for many agents in parallel side-by-side. WOTANN has `agent-fleet-dashboard.ts` but it's WIRED without test — may not have Cursor-3 grid UX.
30. **`/worktree` command** (Cursor 3) — one command creates git worktree for isolated agent work. WOTANN has `orchestration/worktree-kanban.ts` but no `/worktree` CLI verb.
31. **Await Tool for Agents** (Cursor 3) — agents wait for background shell commands OR specific output patterns. Tier-1 agent-loop feature.
32. **Background Agents in Cloud Sandboxes** — up to 8 parallel, laptop-closed operation. Would require cloud infra.
33. **Notepads (Reusable Context)** (Cursor 3) — save prompts/coding standards/API patterns. Reference in prompts for consistency. Simpler than skill system.
34. **Agent-First Interface Default** (Cursor 3) — interface centers on agent orchestration with editor as complement. WOTANN has 4 tabs Chat/Editor/Workshop/Exploit — Editor is a tab but Agents aren't a top-level panel.
35. **5 Retrieval Modes** (LightRAG: Naive/Local/Global/Hybrid/Mix) — WOTANN has RRF hybrid but not graph-based Local/Global/Mix modes.
36. **Citation functionality** (LightRAG) — source attribution on every answer. WOTANN has provenance in memory DB (log) but no citation rendering.
37. **5 Terminal Backends beyond local** (Hermes: Docker/SSH/Daytona/Modal/Singularity) — WOTANN has Docker + terminal-backends.ts; 3 more backends missing.
38. **Mini-SWE Runner built-in** (Hermes) — WOTANN has `intelligence/benchmark-runners/` but no SWE-bench corpus on disk; it's a fake-runtime harness per audit.
39. **VibeVoice-Realtime 0.5B (300ms latency)** — WOTANN has voice backends (edge-TTS + VibeVoice + faster-whisper) — worth upgrading to the 0.5B streaming realtime.
40. **Ultra-Low Frame Rate Tokenizers (7.5 Hz)** — continuous speech tokenizers. Research-level.
41. **Code Interpreter API (8 languages)** (LibreChat) — Python+Node+Go+C/C++/Java/PHP/Rust/Fortran sandboxed execution. WOTANN sandbox has subset.

### G.7 From ECOSYSTEM-CATALOG
42. **Foundation Context Pattern** (coreyhaines31) — one base skill all domain skills consult. WOTANN has 87 skills but no foundation-skill anchor.
43. **Self-Assessment Quizzes** (luongnv89/claude-howto) — meta-skill where Claude tests user's knowledge. Not in WOTANN.
44. **Defuddle clean web extraction** (kepano/obsidian-skills) — token-budget-optimized markdown from URLs. Distinct from raw WebFetch.
45. **AgentShield 102 security rules + 1282 tests** (everything-claude-code) — pre-install scanner for skills/MCPs. WOTANN has `security/skills-guard.ts` (simpler).
46. **Hook runtime profiles: minimal/standard/strict** (ECC `HOOK_PROFILE`) — WOTANN has 23 hooks but no profile-level toggling.
47. **5-layer observer loop prevention** (ECC) — layered breakers. WOTANN has doom-loop detector (single layer).
48. **Selective install architecture with manifest-driven pipeline** (ECC — `--minimal` / `--standard` / `--full` / `--features`) — WOTANN install.sh is single-mode.
49. **Cross-harness parity** (ECC — Claude Code + Cursor + OpenCode + Codex skills compat) — WOTANN may not export skills to other harnesses.
50. **Persona system with C-level advisory** (alirezarezvani — Startup CTO, Growth Marketer, Solo Founder personas) — WOTANN has `identity/persona.ts` but may not have pre-built C-level thinking modes.

### G.8 From COMPUTER_CONTROL_ARCHITECTURE
51. **`computer_20251124` with `zoom` action** — region-based full-resolution inspection. WOTANN may still be on 20250124.
52. **Coordinate scaling math** — `scale = min(1.0, 1568/max(W,H), sqrt(1_150_000/(W*H)))` with inverse on return. Must be verified in `computer-use/platform-bindings.ts`.
53. **Per-turn CU overhead: 466-499 + 735 tokens** — non-trivial budget that should be warned in `context/limits.ts`.
54. **Apple per-app permission model** + domain allowlists + blocked-by-default (investment/trading/crypto). WOTANN has `sandbox/approval-rules.ts` but the Apple pattern is a reference.
55. **Lightpanda as the "fast path" + Playwright as "visual path"** — WOTANN has both in MCP but policy for which to pick when is unclear.

### G.9 From spec versioning
56. **Spec version inflation** (V1 ~80 features → V4 223 features in 6 months) suggests the spec itself may be over-scoped. A "reduce to 100 feature core" exercise may be overdue.
57. **`.nexus/` deletion candidate** — 160 KB stale database scaffold from pre-rebrand.
58. **`.playwright-mcp/*.log` × 101 files** (~218 MiB) — deletion candidate post-audit.
59. **`.github/agents/planner.agent.md`** (17 KB) — stale parent-level agent; global agents now in `~/.claude/agents/`.

### G.10 Meta-observations
60. **The `auto_capture` table is populated 200:1 over structured memory** — Layer 0 dominates. This confirms the pattern: instrumentation fires; synthesis doesn't. "Layer 0 → Layer 1-3 promotion pipeline" is where WOTANN is thin.
61. **Dream pipeline fires on schedule but dreams-nothing** — 5+ consecutive dream diaries with "Entries processed: 0." Either dreams need minimum-entry thresholds (which they have: see `dreams/light-candidates.json` = empty), OR the post-session capture pipeline doesn't feed dreams.
62. **2,225 sessions × 0 tokens each** = the daemon has been creating sessions on startup/tick but not retaining usage. Smoke test: `daemon ticks → session_start fires → nothing happens → session_end fires with zeros → db.insert`.
63. **Identity files exist, user file is template** — `IDENTITY.md` + `SOUL.md` + `AGENTS.md` + `BOOTSTRAP.md` + `TOOLS.md` + `DESIGN.md` all populated; `USER.md` is a 224-byte template. **User-profile capture is the weakest link** — 2,225 sessions and nothing learned about the user.

---

## PART H — Immediate Deletion Candidates

Cleanup that's safe to ship (no runtime impact, saves ~470 MiB + reduces audit confusion):

| Path | Size | Reason |
|---|---|---|
| `wotann/.wotann/knowledge-graph.json.tmp.*` × 30+ | ~1.5 KB | Zombie atomic-write temp files |
| `wotann/.wotann/memory 2.db-shm`, `memory 2.db-wal`, …, `memory 7.db-shm`, `memory 7.db-wal` | 6 × 32 KB | Orphan WAL from crashed daemons |
| `.nexus/` (entire tree) | ~160 KB | Pre-rebrand dead weight |
| `.playwright-mcp/*.log` × 101 + `Ollama.dmg` | ~218 MiB | Browser console logs from Apr-5 burst + incidental download |
| `.swarm/q-learning-model.json` + `.swarm/state.json` | ~1.3 KB | Abandoned Test-project stub (keep as reference if building real RL) |
| `.github/agents/planner.agent.md` | 17 KB | Stale parent-level agent, duplicated in `~/.claude/agents/` |
| `.superpowers/brainstorm/` | empty | Empty scaffold |
| `.claude-flow/metrics/swarm-activity.json` | unknown | Same abandoned swarm run |

**Not a deletion candidate**: `wotann/.wotann/logs/*.jsonl` (30.3 MiB of real runtime trail — this IS the ground truth for Session-0 through Session-6 archaeology). Compress with gzip and archive; don't delete.

---

## PART I — Cleanup + Wiring Priorities (feeds Phase I+)

1. **Startup sweep**: `.wotann/` startup hook sweeps `*.tmp.*` files older than 1 hour.
2. **Orphan WAL detection** in `wotann doctor --strict`.
3. **Session-start / session-end mismatch**: instrument the code path that emits session_end without session_start (1,983 vs 3 is 600:1 skew).
4. **token-stats.json silent-success**: wire cost-tracker to actually write per-provider totals.
5. **Layer 0 → Layer 1 promotion**: auto_capture has 1,990 rows, memory_entries has 0. Either drop the structured layers from schema OR write the promotion pipeline.
6. **Dream pipeline fires on empty**: add minimum-entry threshold OR connect post-session capture → dream candidate injection.
7. **USER.md population**: 2,225 sessions and user profile still a template — this is the single biggest "learning" gap.
8. **`.nexus/` delete + commit**: user-approved deletion.
9. **`.playwright-mcp/` log rotation**: keep last 24 hours.
10. **Orphan connectors wire-up**: confluence/google-drive/jira/linear/notion are all ORPHAN per inventory — wire to a connectors/connector-registry or delete.

---

*End of HIDDEN_STATE_REPORT. Generated by Phase H Opus 4.7 agent. See SPEC_VS_IMPL_DIFF.md for the 223-feature spec-vs-implementation matrix.*
