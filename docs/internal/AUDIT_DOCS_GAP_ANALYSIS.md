# AUDIT_DOCS_GAP_ANALYSIS — What the 5 Audit Lanes Missed

**Date**: 2026-04-20
**Author**: Codebase archaeologist (Opus 4.7 max-effort, synthesis of 25+ Tier-1/2/3 docs against `docs/internal/AUDIT_LANE_{1..5}*.md`)
**Method**: Full reads of UNKNOWN_UNKNOWNS, MASTER_PLAN_V5/V6, WIRING_GAP_REPORT, HIDDEN_STATE_REPORT, SPEC_VS_IMPL_DIFF, PROMPT_LIES, AUDIT_FALSE_CLAIMS, TESTS_SUSPECT, UI_UX_AUDIT, UI_REALITY, CAPABILITY_ADAPTATION_MATRIX, BENCHMARK_POSITION_V2, PROVIDER_HEALTH_REPORT, SURFACE_PARITY_REPORT, FINAL_VERIFICATION_AUDIT_2026-04-19, all 8 COMPETITOR_EXTRACTION lanes + V3/V4 web, README, CI_STATUS, NEXUS_V4_SPEC_SYNTHESIS, GAP_AUDIT_2026-04-15, SLASH_COMMAND_AUDIT, DEAD_CODE_REPURPOSING, CHANGELOG.

**Scope**: find items, contradictions, stale claims, unexplored failure modes, and unanswered questions present in the broader docs corpus that the 5 recently-completed Audit Lanes did NOT surface. Duplicates of Lane 1-5 findings are explicitly excluded.

---

## Executive Summary (400 words)

The 5 new Audit Lanes do a rigorous job on what was in their window but leave **seven major doc-corpus gaps** that change the shape of the work:

1. **Hidden runtime rot the code audits never loaded.** `HIDDEN_STATE_REPORT.md` shows `.wotann/memory.db` has **1,990 rows in auto_capture and ZERO in memory_entries / knowledge_nodes / decision_log** across 2,225 sessions — the structured memory layers are never written in production. `token-stats.json` reports **0 tokens across all 2,225 sessions** (cost-tracker silent-success failure), `knowledge-graph.json` is the **49-byte empty template**, `instincts.json` has **one seeded junk instinct** ("Say only the word HELLO"), and there are **30+ zombie `.tmp.*` files** plus **6 orphan `memory {N}.db-{wal,shm}` pairs** from crashed daemons. None of the 5 Lanes mention this; Lane 1 audits code-wiring, not runtime output.

2. **Prior "wired" claims vs HEAD drift.** `AUDIT_FALSE_CLAIMS.md` catalogs **20+ FATAL lib.ts-only modules** commit messages called "wired" (UnifiedKnowledgeFabric, ContextTreeManager, SteeringServer, assemblePromptModules, BaseChannelAdapter, ≥15 others). `FINAL_VERIFICATION_AUDIT_2026-04-19.md` shows 15 of 22 FATAL closed between sessions, but **3 FALSE-CLAIM commit messages** (`112db5a` browser-tools, `ec36ed2` connectors-tools, `26e594e` think-in-code) still overstate wiring. Lane 1 calls most of these "production-wired" without the claim-vs-code grep pass.

3. **Ship-blocker bugs not in any Lane.** `FINAL_VERIFICATION_AUDIT_2026-04-19.md` §7: the **SEA binary is 50 KB stub, exits 137** (vs the 53 MB CJS bundle on disk) — v0.4.0 binary is unrunnable. Test suite regressed to **15 failing / 5683 passing** (from 0 failing) with fixture drift. Neither appears in Lanes 1-5.

4. **Supabase key leak re-exposed.** `PROMPT_LIES.md` §LIE #10/#21 and `MASTER_PLAN_V6.md` §0 A1-A2 confirm **blob `dbaf1225` still reachable via GitHub API**; key never rotated. Lane 4 mentions it but marks as "CRITICAL pending user action" — doesn't note the `wotann-old-git-20260414` backup (685 MiB) preserves it independently.

5. **Massive competitor coverage the 5 lanes skipped.** `UNKNOWN_UNKNOWNS.md` surfaces **34 discoveries** (9 CRIT), `HIDDEN_STATE_REPORT.md` adds **63 more** (total 97). Not in Lanes 2/5: ACP-as-first-class (Zed/Cursor 3/JetBrains Air/Glass), Agents Window grid (Cursor 3), Canvases, Contextual Embeddings (+30-50% recall), Warp OSC 133 + block IDs, Conductor worktree-per-agent, llm-council 3-stage, TurboQuant 786K context, 5 Terminal Backends (Hermes: Docker/SSH/Daytona/Modal/Singularity), Cognee's 14 retrieval types.

6. **50.2% of the NEXUS V4 spec is Partial (not Done).** `SPEC_VS_IMPL_DIFF.md` 223-feature audit: **23.3% Done / 50.2% Partial / 26.0% Missing / 0.5% Blocked**. Prior "~85% implemented" claim confused "exported from lib.ts" with "runtime-integrated." Lane 1 counts wiring per-module; there is no feature-level spec matrix in the 5 Lanes.

7. **Workspace dead weight + CI + self-hosted runner.** 4.85 GiB of prunable artifacts (`target-audit/` 3.42 GiB, `.build/` 278 MiB, `wotann-old-git-*` 685 MiB). CI test-job has been **queued forever on an unregistered self-hosted runner** since 2026-04-19 13:47 UTC. Lane 4 audits CI workflow YAMLs but doesn't flag that the runner pool is empty.

---

## 1. Findings in Tier 1 Docs NOT Present in 5 Audit Lanes

### 1.1 Runtime-state findings (HIDDEN_STATE_REPORT.md)

| # | Finding | Evidence | Lane coverage |
|---|---|---|---|
| 1 | **Memory block routing broken** — 1,990 rows in auto_capture, 0 rows in memory_entries/knowledge_nodes/decision_log/working_memory/team_memory/verbatim_drawers across 2,225 sessions | HIDDEN_STATE_REPORT.md §A.2; also MASTER_PLAN_V6 §2 item #1 | NOT in Lanes 1-5. Lane 1 audits code-wiring, not that the code is never called in production. |
| 2 | **`token-stats.json` reports 0 tokens across all 2,225 sessions** — cost-tracker silent-success failure | HIDDEN_STATE_REPORT.md §A.1 line 31 | NOT in any Lane. Lane 4 audits security; Lane 5 audits benchmarks. No Lane covers telemetry integrity. |
| 3 | **`knowledge-graph.json` is 49 bytes of empty template** — KG never populated | HIDDEN_STATE_REPORT.md §A.1 line 26 | NOT covered. |
| 4 | **30+ zombie `.tmp.*` files + 6 orphan `memory {N}.db-{wal,shm}` pairs** from crashed daemons, never swept | HIDDEN_STATE_REPORT.md §A.1 table row 3 + Part I item 1-2 | NOT covered. |
| 5 | **Session end without session start** — 1,983 session_end events vs 3 session_start (600:1 skew) | HIDDEN_STATE_REPORT.md §A.2 bottom | NOT covered. |
| 6 | **`.wotann/plans.db` has 0 plans / milestones / tasks** across all 3 tables — planning DB never populated | HIDDEN_STATE_REPORT.md §A.3 | NOT covered. |
| 7 | **`USER.md` is a 224-byte stub** — user-profile capture has learned nothing across 2,225 sessions | HIDDEN_STATE_REPORT.md §A.1 row 39 + §G.1 #10 | NOT covered. |
| 8 | **`dreams/light-candidates.json` + `rem-signals.json` both empty** — dream pipeline fires on schedule but processes 0 entries | HIDDEN_STATE_REPORT.md §A.1 rows 41-42 + DREAMS.md data | NOT covered. |
| 9 | **`.nexus/` 160 KB stale scaffold from pre-rebrand** — still on disk | HIDDEN_STATE_REPORT.md Part B + Part H | NOT covered. |
| 10 | **`.swarm/q-learning-model.json`** — abandoned RL scaffold (32,008 visits, 1 converged state, 15ms run) | HIDDEN_STATE_REPORT.md Part C | NOT covered. Signals latent RL infra opportunity. |
| 11 | **`.playwright-mcp/` 218 MiB console-log cache** + mystery `Ollama.dmg` from Apr-5 scraping burst | HIDDEN_STATE_REPORT.md Part D | NOT covered. |

### 1.2 Commit-claim vs code drift (AUDIT_FALSE_CLAIMS.md + FINAL_VERIFICATION_AUDIT)

| # | Finding | Evidence | Lane coverage |
|---|---|---|---|
| 12 | **20+ FATAL lib.ts-only modules** commit messages called "wired" — most fixed this week, but 7 still orphan | AUDIT_FALSE_CLAIMS.md §"FATAL lies" table, lines 52-85 | Lane 1 marks most of these "production-wired" without running the outside-lib-outside-own-module grep. |
| 13 | **Residual orphans after 180-commit sprint**: BaseChannelAdapter (0 subclasses), UnifiedKnowledgeFabric, ContextTreeManager, SteeringServer, assemblePromptModules, `tools/monitor.ts` (type-only reference), `crystallizeSuccessHook` caller-gated, `requiredReadingHook` caller-dead | FINAL_VERIFICATION_AUDIT_2026-04-19.md §1 table + §7 "Residual orphans" 7-14 | Lane 1 §2.1-2.4 overlaps partially but shows BaseChannelAdapter as the ONLY such pattern — the other 7 aren't in Lane 1's table. |
| 14 | **3 FALSE-CLAIM commit messages** — `112db5a` (browser/tools), `ec36ed2` (connectors/tools), `26e594e` (think-in-code): all say "wired/registered" but grep confirms 0 runtime dispatchers | FINAL_VERIFICATION_AUDIT_2026-04-19.md §1 line 64-69 + §7 items 3-5 | NOT in Lanes 1-5. Lane 1 does not audit commit messages vs code. |
| 15 | **`memory/contextual-embeddings.ts::buildContextualChunk` is sibling-wired only** — sibling `clampContextTokens`+`cleanContext` wired from `store.ts`, but the marquee `buildContextualChunk` function is never called (the +30-50% recall lift is unwired) | FINAL_VERIFICATION_AUDIT_2026-04-19.md §1 line 51 + Lane 1 §2.4 row 6 | Lane 1 DOES flag this but doesn't cross-reference it with UNKNOWN_UNKNOWNS.md's #8 where this is the SINGLE BIGGEST memory lever (+30-50% recall). |
| 16 | **`test-expectation flip" incidents (gepa / skill-compositor / confidence-calibrator / output-isolator) were FALSE claims** — each module is a single atomic commit with co-committed tests; no flip occurred | PROMPT_LIES.md §LIE #2 | Lane 5 audits benchmark tests but not the prior "flipped tests" narrative. |

### 1.3 Ship-blocker bugs not audited by any Lane

| # | Finding | Evidence | Lane coverage |
|---|---|---|---|
| 17 | **SEA binary broken** — 50 KB stub, exits 137 (SIGKILL) vs 53 MB CJS bundle on disk; `postject` injection failed silently | FINAL_VERIFICATION_AUDIT_2026-04-19.md §6 table + §2 line 19 + §7 "Ship-blockers" #1 | Lane 4 audits CI/release but stops at the `.sha256` layer; doesn't exec the binary. |
| 18 | **Test suite regressed to 15 failing / 5683 passing** (from 0 failing baseline) — fixture drift + slow-test timeouts | FINAL_VERIFICATION_AUDIT_2026-04-19.md §3 | NOT in Lane 5 (benchmarks) or any Lane. |
| 19 | **CI self-hosted runner queue stuck indefinitely** since 2026-04-19 13:47 UTC — runner pool has 0 registered runners, concurrency-cancel kills queued runs | CI_STATUS_2026-04-19.md §"TL;DR" + §"Evidence" | Lane 4 §1.1 covers ci.yml content but NOT that the current runner target has 0 registrations. |
| 20 | **camoufox Python driver fails imports in CI** (`ModuleNotFoundError: camoufox`, `playwright`) — repeatedly spawns/kills stub, log spam | PROMPT_LIES.md §NOT-A-LIE #6 bottom + TESTS_SUSPECT.md §1.1 row 5 | Lane 4 dependency analysis doesn't cover Python-side installability. |
| 21 | **`release.yml` silent-success footgun** — `cp dist/index.js "$ART" || printf '#!/bin/sh\n' > "$ART"` ships empty sh on build failure | MASTER_PLAN_V6.md §2 item 15 + MASTER_PLAN_V5 §"Phase B2" | Lane 4 §1.3 reviews release.yml but misses this specific line. |
| 22 | **`getMeetingStore` callback returns null** — `kairos-rpc.ts:4796,5047` silently breaks `meet.summarize` on Desktop+iOS | MASTER_PLAN_V6.md §2 item #2 + DEAD_CODE_REPURPOSING_2026-04-18.md #14 + SURFACE_PARITY_REPORT.md §3 known-bugs | Lane 1 §2.4 does not flag the callback-supply failure. |
| 23 | **Supabase leak preserved in `wotann-old-git-20260414_114728/` backup (685 MiB)** — even if main .git/ is scrubbed, this dir has the blob | PROMPT_LIES.md §LIE #14 + MASTER_PLAN_V6 §0 A2 | Lane 4 §3 notes the main git blob but NOT the sibling backup. |

### 1.4 UI/UX findings not in Lane 3

| # | Finding | Evidence | Lane coverage |
|---|---|---|---|
| 24 | **Three generations of UI captured in screenshots** — only Gen3 (Apr 6 23:30+) matches current code; 19 older screenshots are retired Gen1 (Chat/Build/Autopilot/Compare) | UI_REALITY.md §"Executive summary" #1-2 + §"Screenshot inventory" | Lane 3 covers current code but not the screenshot-vs-code archeology. |
| 25 | **`Header.tsx:5-9` doc comment says "4-tab header is eliminated"** — directly above `VIEW_PILLS` with those 4 tabs — self-invalidating | PROMPT_LIES.md §CODE-LIE #19 + UI_REALITY.md §"Header.tsx is contradicting itself" | Lane 3 §3.6 mentions stale comment in passing but not that the code contradicts the comment about its own content. |
| 26 | **ChatView subtitle regression** — "all running locally on your machine" removed from ChatView.tsx:134 (was in Apr-5/Apr-6 screenshots); positioning weakened | UI_REALITY.md §"Executive summary" #7 + MASTER_PLAN_V6 §3 G9 | NOT in Lane 3. |
| 27 | **19/24 desktop lazy-loaded views are visually unverified** (MeetPanel, ArenaView, IntelligenceDashboard, CanvasView, AgentFleetDashboard, ConnectorsGUI, ProjectList, DispatchInbox, ExecApprovals, PluginManager, DesignModePanel, CodePlayground, ScheduledTasks, ComputerUsePanel, CouncilView, TrainingReview, TrustView, IntegrationsView, ModePicker) | UI_REALITY.md §"Screenshot inventory" + PROMPT_LIES.md §LIE #18 | Lane 3 §1.3 counts them but doesn't flag screenshot-gap. |
| 28 | **Zero iOS screenshots** in inventory + zero TUI screenshots — 100% of iOS's 34 view directories + all Ink TUI states are visually unverified | PROMPT_LIES.md §LIE #18 + UI_REALITY.md §"Executive summary" #9 | Lane 3 §1.4 audits iOS components but from source; §1.2 doesn't note the TUI screenshot gap. |
| 29 | **Liquid Glass apple-ADA gap** — layered translucency (single-layer shipped), noise-grain (0%), animated specular highlights (0%), dynamic tint via `contrast()` (0), per-theme glass tokens (none) | UI_UX_AUDIT.md §3.3 + §3.4 G1-G7 | Lane 3 §2.3 flags 4 `.ultraThinMaterial` sites but doesn't enumerate the 5 concrete Apple-ADA gaps. |

### 1.5 Memory/benchmarks not in Lane 5

| # | Finding | Evidence | Lane coverage |
|---|---|---|---|
| 30 | **Cognee has 14 first-class retrieval types** (GRAPH_COMPLETION / GRAPH_SUMMARY / GRAPH_COT / GRAPH_CONTEXT_EXT / TRIPLET / RAG / CHUNKS / CHUNKS_LEXICAL / SUMMARIES / CYPHER / NATURAL_LANG / TEMPORAL / FEELING_LUCKY / CODING_RULES); WOTANN has 2 (lexical+vector in `hybrid-retrieval.ts`) | COMPETITOR_EXTRACTION_LANE3_MEMORY.md §2.1 + UNKNOWN_UNKNOWNS.md #29 | Lane 2 and Lane 5 don't match the retrieval-mode count. |
| 31 | **No LongMemEval runner exists** — cloning the repo is done but no `memory/longmemeval-runner.ts` in src/ can produce a `{question_id, hypothesis}` JSONL | COMPETITOR_EXTRACTION_LANE3_MEMORY.md §"LongMemEval runnability assessment" + Lane 5 §3 | Lane 5 §3 notes the rule-based scorer and 10-instance smoke; it doesn't say "no hypothesis emitter wired at all." |
| 32 | **Fisher-Rao distance NOT found in WOTANN** — was spec'd in Appendix I | SPEC_VS_IMPL_DIFF.md §"Part VI" row 118 | Lane 5 doesn't audit Fisher-Rao. |
| 33 | **`tests/memory/quantized-vector-store.test.ts` real MiniLM branch silently skips in CI** (env-gated `WOTANN_RUN_MAGIKA_TESTS`) | TESTS_SUSPECT.md §1.1 row 3 | Lane 5 audits benchmark runners, not memory-eval test gates. |
| 34 | **`tests/middleware/file-type-gate.test.ts` Magika model also env-gated** — the 10 MB ONNX model never loads in CI | TESTS_SUSPECT.md §1.1 row 2 | Not in any Lane. |
| 35 | **BFCL v4 / GAIA / WebArena / BrowseComp / SWE-bench Pro / SWE-bench Live / RE-Bench / CyBench / SciCode / τ²-bench / MultiChallenge / SimpleQA — not implemented** | Lane 5 §4 table | ✅ Lane 5 DOES cover this — marking as ALREADY in Lane 5 for deduplication. |
| 36 | **Leaderboard numbers in Lane 5 vs BENCHMARK_POSITION_V2 subtle drift** — Lane 5 says TerminalBench leader "Claude Mythos Preview 82.0%"; BENCHMARK_POSITION_V2 says "ForgeCode 81.8% / Gemini-3.1-Pro 80.2% / Claude Opus 4.6 79.8%". Reconcile. | Lane 5 §5 vs BENCHMARK_POSITION_V2 §0 | Inter-Lane tension. |

### 1.6 Architecture/spec items not in Lane 1

| # | Finding | Evidence | Lane coverage |
|---|---|---|---|
| 37 | **NEXUS V4 spec has 223 features across 26 appendices (A-Z)** — 52 Done / 112 Partial / 58 Missing / 1 Blocked per full trace | SPEC_VS_IMPL_DIFF.md §"Summary" line 450 | Lane 1 audits module wiring, not spec-trace. |
| 38 | **Prior "~85% implemented" claim was conflated** — Done+Partial = 73.5% (code on disk), Done alone = 23.3% (actually runs) | SPEC_VS_IMPL_DIFF.md §"Reconciliation" line 460 + PROMPT_LIES.md §LIE #20 | Not addressed by any Lane. |
| 39 | **Five core/ modules are test-only** (agent-profiles, claude-sdk-bridge, wotann-yml, prompt-override, schema-migration) — living in `core/` suggests they are core, but they are experiments | Lane 1 §6.6 + WIRING_GAP_REPORT.md | ✅ Lane 1 DOES cover this — excluding from new findings. |
| 40 | **Maximum subagents hardcoded at 3** in `orchestration/coordinator.ts` — Feb-2026 arms race is 5-8 (Jean 8, Grok 8, Windsurf 5) | MASTER_PLAN_V6.md §2 item 12 | NOT in Lane 1. |
| 41 | **ACP protocol pinned at 0.2.0** in `src/acp/protocol.ts:190` — Zed uses 0.3+ with Gemini CLI | MASTER_PLAN_V6.md §2 item 10 + UNKNOWN_UNKNOWNS.md #2 | NOT in Lane 1. |
| 42 | **Six Deer-flow middleware missing** from WOTANN's 25: GuardrailMiddleware, DanglingToolCallMiddleware, LLMErrorHandlingMiddleware, SandboxAuditMiddleware, TitleMiddleware, DeferredToolFilterMiddleware | MASTER_PLAN_V6.md §2 item 7 | NOT in Lane 1 (Lane 1 says "6 deer-flow ports ARE in the pipeline" — contradicts). See Contradictions §2. |
| 43 | **Virtual paths abstraction missing** — `/mnt/user-data/*` bidirectional mapping (deer-flow) — WOTANN leaks physical paths in every tool output | MASTER_PLAN_V6.md §2 item 8 + AUDIT_FALSE_CLAIMS §"FATAL table" (sandbox/virtual-paths.ts is partial: only scrubPaths wired, toVirtual/toPhysical/unscrubPaths lib.ts-only) | Lane 1 treats it as wired; reality is partial. |
| 44 | **`shell_snapshot` missing** — Codex parity gap; `unified_exec` is single-shot vs Codex's 64-process pool + 1MiB buffer | MASTER_PLAN_V6.md §2 item 9 | NOT in Lane 1. |
| 45 | **Claude Design handoff bundle receiver missing** — Anthropic Labs shipped Apr 17, 2026; Workshop tab has no parser (though FINAL_VERIFICATION_AUDIT says `parseHandoffBundle` is wired at `index.ts:4463,4471`) | MASTER_PLAN_V6 §2 item 11 vs FINAL_VERIFICATION_AUDIT §"What DID ship correctly" | Intra-doc contradiction — see §2. |

### 1.7 Competitor items not in Lane 2

| # | Finding | Evidence |
|---|---|---|
| 46 | **Perplexity Personal Computer** — physical Mac-mini-class cloud↔local bridge, launched Mar 11 2026. WOTANN has no cloud head | UNKNOWN_UNKNOWNS.md #10 |
| 47 | **ACP Client-Provided MCP (Hermes v0.7.0)** — editors register their own MCP servers at connection time via ACP | UNKNOWN_UNKNOWNS.md #5 |
| 48 | **OSC 133 Prompt-Boundary Escapes → Block Model** (Warp) — parser + zsh/bash/fish init snippets | UNKNOWN_UNKNOWNS.md #6 |
| 49 | **Archon 6 workflow node types + 17 seeded DAG workflows** — YAML DAG engine with `command/prompt/bash/loop/approval/script` | UNKNOWN_UNKNOWNS.md #15 |
| 50 | **Clicky `[POINT:x,y]` LLM grammar + Bezier cursor overlay** — macOS SwiftUI 3-second visual-tutor loop | UNKNOWN_UNKNOWNS.md #16 |
| 51 | **JetBrains Air multi-agent Docker/worktree isolation + task dashboard** — positions as "IDE complement not replacement" | UNKNOWN_UNKNOWNS.md #17 |
| 52 | **Glass single-window Chromium+editor+terminal + Glass Bot Excel add-in** | UNKNOWN_UNKNOWNS.md #18 |
| 53 | **Warp Block IDs auto-expanded in AI prompts** — `"fix the error in #14"` auto-fetches full block | UNKNOWN_UNKNOWNS.md #19 |
| 54 | **Conductor.build worktree-per-agent + burn-rate live meter** — macOS git-worktree-per-agent + per-session cost tracking | UNKNOWN_UNKNOWNS.md #20 |
| 55 | **Superpowers tests/skill-triggering/ regression harness** — adversarial pressure-test for skill activation; 89 WOTANN skills have 0 triggering tests | UNKNOWN_UNKNOWNS.md #21 |
| 56 | **Codex crate-size discipline** — 500 LOC target / 800 LOC warning / per-namespace crate split + `codex-hooks` schema generator + `insta` snapshots | UNKNOWN_UNKNOWNS.md #22 |
| 57 | **OpenAI Agents handoff-as-tool-call + parallel guardrails with tripwire** — MIT licensed; 350 LOC port | UNKNOWN_UNKNOWNS.md #23 |
| 58 | **LightRAG 5 retrieval modes** (Naive / Local / Global / Hybrid / Mix) + citation rendering | UNKNOWN_UNKNOWNS.md #35-36 + COMPREHENSIVE_SOURCE_FINDINGS (F.4) |
| 59 | **5 terminal backends beyond local** (Hermes: Docker / SSH / Daytona / Modal / Singularity) — WOTANN has Docker only | UNKNOWN_UNKNOWNS.md #37 |
| 60 | **Cursor 3 Await / Notepads / Canvases / Design Mode** — four primitives WOTANN needs for parity | UNKNOWN_UNKNOWNS.md #3, #31, #32-34 |
| 61 | **Raft / Gossip / Byzantine consensus** (Ruflo) for multi-agent coordination | HIDDEN_STATE_REPORT.md §G.2 #8 + AGENT_FRAMEWORK_ANALYSIS parent doc |
| 62 | **DangerousCommandApproval with 30+ regex + smart auto-approve via auxiliary LLM** (Hermes) — WOTANN has `command-sanitizer.ts` + `human-approval.ts` but smart auto-approve is missing | HIDDEN_STATE_REPORT.md §G.2 #9 |
| 63 | **wshobson PluginEval 3-layer framework** — static analysis + LLM judge + Monte Carlo; Platinum/Gold/Silver/Bronze certification | HIDDEN_STATE_REPORT.md §G.2 #10 |
| 64 | **LobeHub Agent Groups + white-box editable memory + 10,000+ MCP marketplace** | HIDDEN_STATE_REPORT.md §G.3 #12 + COMPETITIVE_ANALYSIS parent doc |
| 65 | **oh-my-pi IPython kernel tool with rich outputs** (images, HTML, Markdown, mermaid, custom modules) + SSH/SSHFS mounts + AI git hunk staging | HIDDEN_STATE_REPORT.md §G.3 #13-14 |
| 66 | **11 free-code feature flags missing** (HISTORY_PICKER, MESSAGE_ACTIONS, QUICK_SEARCH, SHOT_STATS, CACHED_MICROCOMPACT, BRIDGE_MODE, BASH_CLASSIFIER, KAIROS_BRIEF, AWAY_SUMMARY, LODESTONE, TREE_SITTER_BASH) | HIDDEN_STATE_REPORT.md §G.4 #16 + COMPETITOR_FEATURE_COMPARISON |
| 67 | **Theory-of-Mind module** (OpenHands) — understanding user intent via internal user model | HIDDEN_STATE_REPORT.md §G.4 #17 |
| 68 | **Compression-Death-Spiral prevention distinct from generic doom-loop** (Hermes) — specific detector for compression→fail→compress | HIDDEN_STATE_REPORT.md §G.5 #25 |
| 69 | **GPT Tool-Use Enforcement** (Hermes v0.5) — prevent GPT from describing tool calls in text | HIDDEN_STATE_REPORT.md §G.5 #26 |
| 70 | **Multi-Instance Profiles** (Hermes v0.6) — run multiple isolated WOTANN instances with own config/memory/sessions from same install | HIDDEN_STATE_REPORT.md §G.5 #27 |
| 71 | **Plugin Lifecycle Hooks** (Hermes v0.5) — pre/post LLM call hooks + session hooks | HIDDEN_STATE_REPORT.md §G.5 #28 |
| 72 | **mini-SWE-agent runner built-in** (Hermes) — WOTANN has `intelligence/benchmark-runners/` but no SWE-bench corpus on disk | HIDDEN_STATE_REPORT.md §G.6 #38 |
| 73 | **Foundation Context Pattern** (coreyhaines31) — one base skill all domain skills consult for consistency | HIDDEN_STATE_REPORT.md §G.7 #42 |
| 74 | **AgentShield 102 security rules + 1282 tests** (everything-claude-code) — pre-install scanner for skills/MCPs | HIDDEN_STATE_REPORT.md §G.7 #45 |
| 75 | **Hook runtime profiles: minimal/standard/strict** (ECC `HOOK_PROFILE`) — 23 hooks with no profile toggling | HIDDEN_STATE_REPORT.md §G.7 #46 |
| 76 | **5-layer observer loop prevention** (ECC) — WOTANN has doom-loop (single layer) | HIDDEN_STATE_REPORT.md §G.7 #47 |
| 77 | **Selective install architecture** (`--minimal` / `--standard` / `--full` / `--features`) — WOTANN install.sh single-mode | HIDDEN_STATE_REPORT.md §G.7 #48 |
| 78 | **Claude computer_20251124 `zoom` action** + coordinate scaling `scale = min(1.0, 1568/max(W,H), sqrt(1_150_000/(W*H)))` + 466-499 + 735 tokens/turn overhead | HIDDEN_STATE_REPORT.md §G.8 #51-53 + COMPUTER_CONTROL_ARCHITECTURE parent doc |
| 79 | **Lightpanda Zig-based headless browser** — 9x faster / 16x less memory than Chrome, CDP-compatible, no rendering | HIDDEN_STATE_REPORT.md §G.8 #55 |
| 80 | **Apple per-app permission model + domain allowlists + blocked-by-default (investment/trading/crypto)** for Computer Use safety | HIDDEN_STATE_REPORT.md §G.8 #54 |

### 1.8 Test-corpus findings not in Lane 1/5

| # | Finding | Evidence |
|---|---|---|
| 81 | **354 test files / ~310 LEGITIMATE / ~4-5 ENV-GATED-SILENT-SKIP** (source-monitor FIXED, file-type-gate Magika, quantized-vector-store ONNX, cli-commands daemon, camoufox-persistent) — these pass but run 0 assertions in CI | TESTS_SUSPECT.md §1.1 |
| 82 | **~15 HAPPY-PATH-ONLY files** (anti-distillation, doom-loop, graph-dsl, predictive-context, reasoning-sandwich, canvas) — 0 error cases | TESTS_SUSPECT.md §1.3 |
| 83 | **~5 MOCK-AND-ASSERT-THE-MOCK patterns** (benchmark-runners, health-check, dispatch, runtime-query, feishu) | TESTS_SUSPECT.md §1.4 |
| 84 | **WOTANN_TEST_FLAGS.tsv 255-file "happy-path" flag is a regex false-positive** — heuristic misses negative assertions like `expect(x).toBe(false)`, `expect(obj).toBeNull()`, `not.toContain`. Real count is ~15, not 255 | TESTS_SUSPECT.md §2 |

### 1.9 Capability-adaptation gaps not in Lane 1 or 2

| # | Finding | Evidence |
|---|---|---|
| 85 | **Streaming emulation** — `capability-equalizer` flags non-streaming providers but there is no buffered-polling fallback; user sees nothing while provider churns | CAPABILITY_ADAPTATION_MATRIX.md row 6 "Chunked replay fallback" line 133 |
| 86 | **Vision dual-model routing gap** — Gemini 3 free has vision; Groq/Cerebras don't. Current router treats "free" as a flat tier, doesn't hop to Gemini for vision sub-task | CAPABILITY_ADAPTATION_MATRIX.md row 2 "Free-tier" |
| 87 | **Local-LRU prompt cache** for non-cache providers (Ollama/Groq) — big latency win for repeated system prompts; not wired | CAPABILITY_ADAPTATION_MATRIX.md row 7 "Text-only-small" |
| 88 | **Ollama `keep_alive` for pseudo-statefulness** — not threaded through `ollama-adapter.ts` | CAPABILITY_ADAPTATION_MATRIX.md row 8 |
| 89 | **`sharp`-based Set-of-Mark label overlay** — `generateSetOfMark()` returns raw screenshot (no overlay rendered) | CAPABILITY_ADAPTATION_MATRIX.md row 1 "Small-vision" |
| 90 | **Grammar-constrained JSON generation via Ollama `format: "json"`** — not wired through `ollama-adapter.ts` | CAPABILITY_ADAPTATION_MATRIX.md row 5 "Text-only-small" |
| 91 | **Groq/Cerebras/Sambanova `responseFormatSupported` bits missing** — only OpenAI/Gemini/Mistral declare "native" | CAPABILITY_ADAPTATION_MATRIX.md row 5 "Free-tier" |

---

## 2. Contradictions Between Docs

| Subject | Doc A says | Doc B says | Resolution |
|---|---|---|---|
| Deer-flow 6 middlewares | **Lane 1** §1.1 middleware row: "6 Lane-2 deer-flow ports were added 2026-04-15 and ARE in the pipeline" | **MASTER_PLAN_V6** §2 item 7 (v6 2026-04-19): "6 Deer-flow middleware missing from WOTANN's 25" | **FINAL_VERIFICATION_AUDIT §1 table** confirms Lane 1 is correct — all 6 `create*Middleware` calls in `pipeline.ts:103-121` + `pipeline.ts:243-261`. MASTER_PLAN_V6 is STALE on this point. |
| Claude Design handoff receiver | **MASTER_PLAN_V6** §2 #11: "Claude Design handoff receiver missing" | **FINAL_VERIFICATION_AUDIT §"What DID ship correctly"**: "`parseHandoffBundle` wired at `index.ts:4463,4471`" | FINAL_VERIFICATION_AUDIT is newer + grep-proven. MASTER_PLAN_V6 stale. |
| 4 CRITICAL provider bugs | **PROMPT_LIES §LIE #5**: "All closed via named commits post-Apr-18" (Bedrock c766c5c, Vertex 12006de, Azure 16f6a83, Copilot b6fe189) | **GAP_AUDIT_2026-04-15** (older): lists them as OPEN | GAP_AUDIT is pre-closure; PROMPT_LIES is correct. Lane 4 §8.1 confirms these are REAL. |
| WIRING_GAP_REPORT orphan count | **WIRING_GAP_REPORT** §1: "89 orphans / 0 deletion candidates" | **AUDIT_FALSE_CLAIMS §"Cross-reference"** line 175: "~89 orphans; ~20 FATAL overlap" | Both are correct — WIRING_GAP is per-module; AUDIT_FALSE_CLAIMS scopes to modules whose commits overstated wiring. |
| Purple theme violation | **Lane 3** §2.1.4 "themes.ts:45-63 has 12+ purple hex values" | **UI_REALITY.md** §"Color" row "Mimir blue accent `#3e8fd1`" (implied purple purged) | Lane 3 is correct — `themes.ts` (TUI) still has purple; `wotann-tokens.css` (desktop) is purged. Two surfaces, inconsistent purge state. |
| Contextual embeddings wiring | **PHASE_6_PROGRESS.md** header: "Contextual embeddings ✅ (commit 81c7a48)" | **AUDIT_FALSE_CLAIMS §FATAL table** row 10: "ORPHAN; not yet wired into conversation-miner or vector-store" | AUDIT_FALSE_CLAIMS is correct; PHASE_6_PROGRESS header lies by omission (integration note admits it). |
| Runtime LOC | **Lane 1** §0: "core/runtime.ts 6,315 LOC" | **UNKNOWN_UNKNOWNS** §22: "`src/core/runtime.ts` is **4,400 LOC** per MASTER_SYNTHESIS" + **CAPABILITY_ADAPTATION_MATRIX** §"runtime.ts is 4,843 LOC" | Lane 1 is at HEAD; earlier docs were snapshots. Runtime grew ~1,500 LOC across sessions. |
| Test count (baseline vs current) | **AUDIT_FALSE_CLAIMS**: "357 files / 5691 passing / 0 failing" | **FINAL_VERIFICATION_AUDIT**: "357 files / 5683 passing / 15 failing" | FINAL (newer) shows the 180-commit sprint REGRESSED 15 tests. |
| Provider count | **CLAUDE.md** (wotann root): "19 providers" | **README.md**: "19 providers" | **CHANGELOG.md** line 1: "[0.1.0] 17-provider adapter system" | Both newer sources agree on 19; CHANGELOG stale. |
| Skill count | **CLAUDE.md**: "65+ skills" | **MASTER_SYNTHESIS**: "86 markdown skills" + **README**: "86" | CLAUDE.md is an understatement. |
| FINAL_VERIFICATION_AUDIT orphan list | Says: "UnifiedKnowledgeFabric, ContextTreeManager, SteeringServer, assemblePromptModules — all ORPHAN" | **Lane 1** §6.3: "`UnifiedKnowledgeFabric` wired at `runtime.ts:37,738,1090`; `ContextTreeManager` wired at runtime.ts:43,746,1135,5661,5680; `SteeringServer` wired at 245,722,729; `assemblePromptModules` wired at `prompt/engine.ts:14,321`" | **Lane 1 is correct for HEAD**. FINAL_VERIFICATION_AUDIT lists a stale snapshot (4a0d31a) — these got wired between that commit and Lane 1's HEAD. This is the "perishability" problem Lane 1 §6.3 calls out. |

---

## 3. Stale Claims (dead per old doc, actually wired now, or vice versa)

| Doc | Stale claim | Current reality |
|---|---|---|
| **DEAD_CODE_REPURPOSING_2026-04-18** row #13 | "training/autoresearch.ts ModificationGenerator is a no-op in production — violates Session 2 quality bar" | Closed in `e14a2c8` (session 5); runtime.ts:1157 uses `createLlmModificationGenerator`. Doc is stale. |
| **DEAD_CODE_REPURPOSING** row #11 | "autopilot/completion-oracle.ts DEAD" | PHASE_1_PROGRESS closed this Apr-18 via `runtime.ts:139,3678,3739`. |
| **DEAD_CODE_REPURPOSING** row "encoding-detector" | "orphan" | Used by `src/computer-use/platform-bindings.ts:22`. TSV was stale. |
| **MASTER_AUDIT_2026-04-18** §"Where WOTANN lags" item (b) | "zero backdrop-filter usage in WOTANN CSS" | 29 backdrop-filter occurrences across 11 TSX + heavy use in globals.css. Obsolete. |
| **MASTER_PLAN_V5** §"Phase B" items B1/B2/B4 | "pending to do" | All closed per MASTER_PLAN_V6 §2 + FINAL_VERIFICATION_AUDIT. |
| **CLAUDE.md** (wotann root) | "22 src/ subdirs" + "21 hooks" | Actual 50 subdirs + 23 hook registrations. |
| **CHANGELOG.md** top | "[0.1.0] 17-provider adapter system" | Package.json is 0.4.0; provider count is 19. |
| **FINAL_VERIFICATION_AUDIT_2026-04-19** §1 line 47-48 | "`monitor/spawnMonitor` type-only reference; no runtime invocation" | ✅ Status is still FATAL — this one is NOT stale; it's a confirmed gap. Keep. |
| **BENCHMARK_BEAT_STRATEGY_2026-04-18** | TerminalBench target 83-95% | BENCHMARK_POSITION_V2 marks 82-87% Sonnet target; 70-76% Free target. The 95% upper bound was over-ambition; V2 is realistic. |
| **GAP_AUDIT_2026-04-15** links to `[REDACTED_SUPABASE_KEY]` | "scrubbed" | PROMPT_LIES + MASTER_PLAN_V6 §0 confirm blob still live. Cosmetic redaction; blob persists. |
| **UX_AUDIT_2026-04-17** session-7 items "CHAT/SET/PAL/IOS top 10" | "priorities" | SESSION_8_UX_AUDIT fixes 2 (TD-3.1 4-tab pills, TD-8.1 Cmd+3/⌘4); rest still open per UI_UX_AUDIT §2.1 table. |
| **PHASE_14_PROGRESS.md** row 11 | "visual-diff-theater ✅ already wired" | Actually wired as real service on runtime.ts:122,655,1213-1214 (FINAL_VERIFICATION_AUDIT) but via Wave-4 commits — PHASE_14_PROGRESS stale until recent. |
| **SESSION_HISTORY_AUDIT** recent entries | "9 transcripts" | MEMORY.md now references 6 — sessions 1/2/4/... — discrepancy not resolved. |
| **MASTER_SYNTHESIS_2026-04-18** claim "~45 cloned research repos" | "~45" | Parent-level research tree has more; PROMPT_LIES LIE #13 found 15+ MDs beyond the 6 prompt-listed. |

---

## 4. Unexplored Failure Modes (issues surfaced in older docs that newer audits didn't address)

| # | Failure mode | Source | Status |
|---|---|---|---|
| 1 | **Session start/end skew 600:1** — 1,983 `session_end` rows vs 3 `session_start` (HIDDEN_STATE A.2). Either session_start never emits OR a race condition inserts end without start | HIDDEN_STATE_REPORT.md §G.1 #3 | Unaddressed. |
| 2 | **Atomic-write cleanup on SIGTERM** — `.tmp.*` files accumulate forever; no `process.on('exit')` unlink | HIDDEN_STATE_REPORT.md §A.1 row 3 | Unaddressed. |
| 3 | **Orphan WAL/SHM detection** — 6 pairs of `memory {N}.db-{wal,shm}` with NO matching `.db` file. Prior crashes left partial tx state; doctor/health-check never scans for this | HIDDEN_STATE_REPORT.md §A.1 row 4 + §Part I item 2 | Unaddressed. |
| 4 | **Daemon receives SIGKILL (exit 137) on SEA binary** — no fallback diagnosis, no repro log | FINAL_VERIFICATION_AUDIT §6 + §7 item 1 | Unaddressed. |
| 5 | **Camoufox Python subprocess spawn-kill loop** — repeated spawn/kill when `camoufox` + `playwright` not installed; log spam | TESTS_SUSPECT §1.1 row 5 + PROMPT_LIES §NOT-A-LIE #6 | Unaddressed — needs runtime dep declaration or silent-guard. |
| 6 | **`channels/base-adapter.ts` 0 subclasses except cosmetic Echo** — "audit theater" pattern | Lane 1 §6.4 + AUDIT_FALSE_CLAIMS §FATAL row "base-adapter" + DEAD_CODE_REPURPOSING | Lane 1 flags it; resolution still pending (migrate 16 adapters OR delete). |
| 7 | **Streaming-state leak across users in `.wotann/streams/`** — stream state retains full `sessionBeforeQuery` with provider+model+tokenCount. If multiple users share a daemon, one user's stream state is readable by all | HIDDEN_STATE_REPORT.md §G.1 #7 | Security smell; unaddressed. |
| 8 | **Channel adapter dead on unknown sender** — OpenClaw pattern requires pairing code for new senders. WOTANN adapters accept all inbound | COMPETITOR_EXTRACTION_LANE1.md §2.1 OpenClaw "DM pairing security" | Unaddressed. |
| 9 | **Plugin sandbox is theater** — `plugin-sandbox.ts:195,233` comments admit "simulate execution" — no VM isolation | Lane 4 §0 row #5 + §8 | Lane 4 FLAGS but doesn't fix. Marked CRITICAL in Lane 4 but belongs in failure-mode list because it wasn't in docs prior to Lane 4. |
| 10 | **Config schema migration doesn't exist on actual upgrades** — `core/schema-migration.ts` is ORPHAN (WIRING_GAP #19) + 1,990-row auto_capture never promoted to `memory_entries` means version-migration on memory has never run | HIDDEN_STATE_REPORT A.2 + WIRING_GAP_REPORT #19 | Unaddressed. |
| 11 | **CSRF protection on cookie-based auth** — `~/.claude/rules/security.md` requires it; no grep-proof it's implemented for daemon RPC | CLAUDE.md (global) security rule + Lane 4 §8 | Lane 4 covers daemon auth token but doesn't audit CSRF specifically. |
| 12 | **Rate limiting on public-facing endpoints** — security rule requires it; `daemon/kairos-rpc.ts` has no per-endpoint rate limit | CLAUDE.md rules/security.md + Lane 4 | Lane 4 confirms `maxConnections: 10` but not per-endpoint rate limit. |
| 13 | **SQLite integrity check on startup** — not wired per GAP_AUDIT item S4-19 | GAP_AUDIT_2026-04-15 line S4-19 | Unaddressed. |
| 14 | **Self-hosted runner label/OS mismatch** — YAML says `[self-hosted, linux]`, macOS arm64 host. Either side could silently break | CI_STATUS_2026-04-19 §6 + SELF_HOSTED_RUNNER_SETUP | Called out by Agent D; unresolved. |
| 15 | **Token-stats.json cost-tracker writes 0 silently** — cost-tracker never fires across 2,225 sessions. This is the same "silent success" anti-pattern bar #6 prohibits | HIDDEN_STATE_REPORT A.1 row 31 | Unaddressed. |
| 16 | **Dream pipeline fires on empty** — 5+ consecutive dream diary entries "Entries processed: 0". Post-session capture pipeline never feeds dream candidates | HIDDEN_STATE_REPORT A.1 row 42 + §Part I item 6 | Unaddressed. |
| 17 | **Bundle size warning unaddressed** — desktop main bundle 614 kB > 500 kB threshold; vite warning every build | SURFACE_PARITY_REPORT §3 + FINAL_VERIFICATION_AUDIT §2 | Unaddressed. |

---

## 5. Unanswered Questions (open issues in MASTER_PLAN_V5/V6 unresolved)

| # | Question | Source | Blocker |
|---|---|---|---|
| 1 | **Do we ship WOTANN-Free leaderboard numbers?** | MASTER_PLAN_V6 §3 Phase E10 + BENCHMARK_POSITION_V2 §0 | Requires wiring all 9 runners to real graders first. |
| 2 | **Pricing tier: $8-12/mo vs $20/mo vs $199/mo?** | UNKNOWN_UNKNOWNS #33 + MASTER_PLAN_V6 §3 | Business decision pending. |
| 3 | **ACP 0.3+ vs 0.2.0 upgrade** — does WOTANN speak current Zed protocol? | MASTER_PLAN_V6 §2 #10 + UNKNOWN_UNKNOWNS #2 | Port is 5-7 days; decision not made. |
| 4 | **19-model Perplexity-style routing vs 3-tier (cheap/mid/premium)?** | UNKNOWN_UNKNOWNS #1 | Routing architecture decision. |
| 5 | **`wotann council` = Model Council first-class feature?** | UNKNOWN_UNKNOWNS #1 + SURFACE_PARITY row 12 (Council on iOS absent) | Not decided. |
| 6 | **Launch Editor tab on iOS (Monaco)?** | SURFACE_PARITY_REPORT §2 row 2 "biggest single-feature gap" | Requires Monaco-for-iOS evaluation. |
| 7 | **Deliver Apple Developer ID notarization?** | GAP_AUDIT_2026-04-15 + MASTER_PLAN_V6 §3 J3 | $99/yr user signup. |
| 8 | **Supabase key rotation timeline** — user-blocking | MASTER_PLAN_V6 §0 A1-A2 | Blocks any new Supabase-dependent feature. |
| 9 | **Donate WOTANN to AAIF (Linux Foundation) like Goose did?** | UNKNOWN_UNKNOWNS #6 + Lane 2 §2.11 (Goose moved) | Strategic decision. |
| 10 | **Cloud head: build vs skip?** | UNKNOWN_UNKNOWNS #10 Perplexity Personal Computer | Backend infra investment. |
| 11 | **WOTANN for Excel add-in: ship in Phase 11 or drop?** | UNKNOWN_UNKNOWNS #18 Glass Bot | Not decided. |
| 12 | **Autoresearch for harness self-optimization** — DGM-style self-modification on own skills/prompts | UNKNOWN_UNKNOWNS #19 + Lane 6 self-evolution gap | Depends on LongMemEval runner (E1). |
| 13 | **Wings/Rooms/Halls 4-level hierarchy** — port for +34% retrieval? | MASTER_PLAN_V6 §3 Phase H9 | Unclear if +34% holds on WOTANN memory. |
| 14 | **wshobson 78-plugin + 150-skill port** — how much to mine? | UNKNOWN_UNKNOWNS #31 | Audit + selective import decision. |
| 15 | **Should Bifrost theme fire only on "first task complete"?** | Lane 3 §6.3.2 "Bifrost misuse risk" | Design decision. |
| 16 | **TUI terminal-capability detection** — ship or skip? | Lane 3 §2.1 "terminal-capability detection: MISSING" | Engineering scope decision. |
| 17 | **Gabriel's quality bars 11-13 canonicalization** — write the feedback files or subsume? | MASTER_PLAN_V6 §3 Phase B4 + PROMPT_LIES §LIE #7 | Documentation-only task. |

---

## 6. Top 25 Items to Add to Master Action Plan (NOT captured by 5 Lanes)

Ranked by impact × urgency × low effort.

| # | Item | Effort | Impact | Source |
|---|---|---|---|---|
| 1 | **Fix SEA binary** (postject injection in `scripts/sea-build.mjs`) — current 50 KB stub exits 137; v0.4.0 unrunnable | 4-8h | CRITICAL ship-blocker | FINAL_VERIFICATION_AUDIT §7 #1 |
| 2 | **Fix 15 failing tests** (source-monitor fixture drift + e2e/codebase-health timeouts) — was 0 failing at baseline | 3-4h | CRITICAL (red CI) | FINAL_VERIFICATION_AUDIT §3 |
| 3 | **Wire memory block routing** — 1,990 auto_capture rows must promote to structured `memory_entries` / `knowledge_nodes` / `decision_log` | 4-8h | HIGH (8-layer memory is vaporware until this) | HIDDEN_STATE_REPORT §A.2 |
| 4 | **Wire cost-tracker** — 0 tokens across 2,225 sessions means telemetry is fake | 2-4h | HIGH | HIDDEN_STATE_REPORT §A.1 row 31 |
| 5 | **Register self-hosted runner** OR revert to hosted runner in ci.yml — runner pool has 0 registrations, test job blocked since 13:47 UTC 2026-04-19 | 15m user time | CRITICAL (CI blocked) | CI_STATUS_2026-04-19 |
| 6 | **Rotate Supabase key + scrub blob `dbaf1225` + delete wotann-old-git-20260414 backup** | 30m user time | CRITICAL | PROMPT_LIES #10 + MASTER_PLAN_V6 §0 A1-A2 |
| 7 | **Wire `contextual-embeddings::buildContextualChunk`** on ingest — +30-50% recall, single biggest memory lever | 4h | HIGH | UNKNOWN_UNKNOWNS #8 + AUDIT_FALSE_CLAIMS row 10 |
| 8 | **LongMemEval hypothesis-emitter runner** — enables publishable memory score | 1 day | HIGH (moat) | Lane5 §3 + COMPETITOR_EXTRACTION_LANE3_MEMORY §"runnability" |
| 9 | **Wire LSP agent-tools** (`buildLspTools`, `AGENT_LSP_TOOL_NAMES`) — Serena parity — currently FATAL orphan marked WIRE in Lane1 but AUDIT_FALSE_CLAIMS disagrees | 2h | HIGH | Lane1 §2.1 row + FINAL_VERIFICATION_AUDIT §1 |
| 10 | **Fix `getMeetingStore` null callback** (`kairos-rpc.ts:4796,5047`) — silently breaks meet.summarize | 30m | HIGH | DEAD_CODE_REPURPOSING #14 + MASTER_PLAN_V6 §2 #2 |
| 11 | **Wire `tools/monitor.ts::spawnMonitor`** — still type-only reference after Wave-4; Claude Code v2.1.98 parity | 1-2h | HIGH | FINAL_VERIFICATION_AUDIT §1 line 47 |
| 12 | **Delete 10 "* 2.ts" ghost files** (6 src + 4 test = 51,532 LOC of unreferenced ghost text) | 30m | MEDIUM | Lane1 §2.3 — already in Lane 1 but add to action plan |
| 13 | **Clean up 30+ `.tmp.*` zombie files + 6 orphan WAL/SHM pairs** in `.wotann/` — add `process.on('exit')` cleanup | 1h | MEDIUM | HIDDEN_STATE_REPORT §A.1 + §Part I #1-2 |
| 14 | **Fix `release.yml` silent-success footgun** — remove `|| printf '#!/bin/sh\n' > "$ART"` fallback | 15m | HIGH | MASTER_PLAN_V5/V6 |
| 15 | **Wire Cursor 3 Canvases** — React-rendered interactive agent output for Workshop tab | 3 days | HIGH (differentiator) | UNKNOWN_UNKNOWNS #3 + MASTER_PLAN_V6 §3 G3 |
| 16 | **OSC 133 block parser wiring** — Warp-parity; parser + BlockBuffer allocated in TUI (FINAL_VERIFICATION_AUDIT §1 confirms both wired) but feed stays opt-in via env var. Ship default-on. | 1 day | MEDIUM | UNKNOWN_UNKNOWNS #6 + Lane3 §1.2 |
| 17 | **Implement ACP 0.3+ upgrade** — Zed / Cursor 3 / JetBrains Air / Glass all speak this; WOTANN pinned at 0.2.0 | 2 days | HIGH (reach multiplier) | UNKNOWN_UNKNOWNS #2 + MASTER_PLAN_V6 §2 #10 |
| 18 | **Wire 6 orphan channel adapters** (Mastodon, WeChat, Line, Viber, DingTalk, Feishu) — FINAL_VERIFICATION_AUDIT §1 confirms wiring but Lane3 §1.7 says still orphan | 1h each | MEDIUM | Lane3 §1.7 + FINAL_VERIFICATION_AUDIT |
| 19 | **Raise maxSubagents 3 → 5 (+ CLI flag `--max-workers` 1-8)** — Feb-2026 arms race is 5-8 | 1h | MEDIUM | MASTER_PLAN_V6 §3 B7 |
| 20 | **Wire Handoff-as-tool-call + parallel guardrails** (OpenAI MIT SDK — 350 LOC) | 2 days | MEDIUM (compounds multi-agent) | UNKNOWN_UNKNOWNS #23 |
| 21 | **Port Hermes credential pool rotation + session hooks + plugin lifecycle** | 2-3 days | MEDIUM | UNKNOWN_UNKNOWNS #12 G.5 + Lane2 §2.2 |
| 22 | **Superpowers `tests/skill-triggering/` regression harness** — 89 skills have 0 triggering tests | 2-3 days | MEDIUM | UNKNOWN_UNKNOWNS #21 |
| 23 | **Screenshot capture for 19 desktop views + TUI states + iOS device** — visual verification of 80% of UI | 1 day agent + device time | MEDIUM | PROMPT_LIES #18 + UI_REALITY |
| 24 | **Capability-router streaming emulation + free-tier vision hop** — Gemini-for-vision → Groq-for-reasoning dual-model pattern | 3 days | MEDIUM | CAPABILITY_ADAPTATION_MATRIX §1 row 1-2 |
| 25 | **Delete `.nexus/` (160 KB) + `.swarm/` stub + `.playwright-mcp/*.log` (218 MiB) + `wotann-old-git-20260414` (685 MiB) + `target-audit/` (3.42 GiB)** — 4.85 GiB cleanup | 15m user review | LOW-MED (hygiene + tree-walk clarity) | HIDDEN_STATE_REPORT §Part H + MASTER_PLAN_V6 §0 A4 |

---

## 7. Single Canonical Source-of-Truth Table

For every major subsystem, which doc is the current authoritative reference (supersedes earlier snapshots):

| Subsystem | Authoritative doc (2026-04-20) | Supersedes | Notes |
|---|---|---|---|
| **Codebase wiring (module-level)** | `internal/AUDIT_LANE_1_ARCHITECTURE.md` | `WIRING_GAP_REPORT.md`, `DEAD_CODE_REPURPOSING_2026-04-18.md`, `WOTANN_INVENTORY.md` | Lane 1 is at HEAD; prior TSVs are snapshots. Cross-verify with `FINAL_VERIFICATION_AUDIT_2026-04-19.md` for wave-4 fixes. |
| **Commit-claim vs code honesty** | `AUDIT_FALSE_CLAIMS.md` + `FINAL_VERIFICATION_AUDIT_2026-04-19.md` | `PHASE_14_PROGRESS.md`, `MASTER_SYNTHESIS_2026-04-18.md`, most PHASE_*.md | AUDIT_FALSE_CLAIMS lists the lie-pattern; FINAL_VERIFICATION closes 15/22; 3 remain. |
| **Runtime-state / hidden state** | `HIDDEN_STATE_REPORT.md` | N/A — unique | Memory DB content, dream state, telemetry files. |
| **Prompt accuracy audit** | `PROMPT_LIES.md` | N/A — unique | 23 prompt lies catalogued with evidence. |
| **Competitor landscape** | `UNKNOWN_UNKNOWNS.md` + `COMPETITOR_EXTRACTION_LANE{1..8}.md` + `COMPETITOR_EXTRACTION_V{3_WEB, 4_NEW_SOURCES}.md` + Lane 2 | `competitor-research-perplexity-mempalace-2026-04-09.md`, `repo-updates-*` | UNKNOWN_UNKNOWNS is strategic synthesis; LANE1-8 are deep-extractions; V3/V4 are fresh clones. |
| **UI/UX (desktop + iOS + TUI)** | `internal/AUDIT_LANE_3_UI_FEATURES.md` + `UI_UX_AUDIT.md` | `UX_AUDIT_2026-04-17.md`, `SESSION_8_UX_AUDIT.md`, `UI_DESIGN_SPEC_2026-04-16.md` | Lane 3 supersedes prior sessions; UI_UX_AUDIT has Apple-ADA scorecard. UI_REALITY.md covers screenshot archaeology. |
| **Infra / CI / release / security** | `internal/AUDIT_LANE_4_INFRA_SECURITY.md` + `FINAL_VERIFICATION_AUDIT_2026-04-19.md` | `CI_STATUS_2026-04-19.md` (runner registration), `PROMPT_LIES.md` §LIE #10/#14/#21 | Lane 4 is primary; FINAL_VERIFICATION covers SEA binary + tests. |
| **Benchmarks + memory evals** | `internal/AUDIT_LANE_5_BENCHMARKS.md` + `BENCHMARK_POSITION_V2.md` | `BENCHMARK_BEAT_STRATEGY_2026-04-18.md` | Lane 5 is runner-level; POSITION_V2 has 35-bench table with run/scaf/gap/blk status. |
| **Capability adaptation (provider × tier)** | `CAPABILITY_ADAPTATION_MATRIX.md` | N/A — unique | 18×6 matrix with per-cell fallback. |
| **Provider health** | `PROVIDER_HEALTH_REPORT.md` | N/A | Per-provider adapter audit; Bug #5 closure confirmed. |
| **Surface parity (CLI/TUI/Desktop/iOS/Watch/CarPlay/Channels)** | `SURFACE_PARITY_REPORT.md` | `UI_PLATFORMS_DEEP_READ_2026-04-18.md`, per-deep-read docs | 32-feature × 11-surface matrix. |
| **NEXUS V4 spec trace** | `SPEC_VS_IMPL_DIFF.md` | `NEXUS_V4_SPEC_SYNTHESIS_2026-04-18.md`, `MASTER_SYNTHESIS_2026-04-18.md` ("~85% implemented" claim superseded) | Authoritative 223-feature matrix. |
| **Tests** | `TESTS_SUSPECT.md` | `WOTANN_TEST_FLAGS.tsv` (regex-heuristic false positives) | 354-file AST-style adversary scan. |
| **Master plan / execution** | `MASTER_PLAN_V6.md` | `MASTER_PLAN_V5.md`, `MASTER_PLAN_SESSION_10.md`, `MASTER_PLAN_PHASE_2.md` | V6 is current; V5 still has useful "Quick-start" bootstrap steps. |
| **Quality bars (session 1-5)** | Auto-memory `feedback_wotann_quality_bars_session{1,2,4}.md` + narrative-only bars 11-13 in sessions 3/5 | N/A — accumulating | Bars 10+ need canonicalization per MASTER_PLAN_V6 B4. |
| **User-facing configuration** | `wotann.yaml` schema + CLAUDE.md | README.md (overview only) | Config discovery lives in `core/config-discovery.ts`. |
| **Build/release process** | `SELF_HOSTED_RUNNER_SETUP.md` + `.github/workflows/{ci,release}.yml` + `scripts/release/*` | CHANGELOG.md ordering | CI + release are primary source; CHANGELOG is history. |
| **Auth** | `docs/AUTH.md` | N/A — unique | Daemon RPC session-token convention. |
| **iOS deep-read (rarely referenced)** | `IOS_SWIFT_DEEP_READ_2026-04-18.md` | N/A | Supersedes `MOBILE_*` references. |
| **Provider/middleware deep-read** | `PROVIDERS_MIDDLEWARE_DEEP_READ_2026-04-18.md` | N/A | Per-provider wiring. |
| **Tauri/Rust deep-read** | `TAURI_RUST_DEEP_READ_2026-04-18.md` | N/A | 108 Tauri commands. |
| **Runtime tail deep-read** | `RUNTIME_TS_TAIL_DEEP_READ_2026-04-18.md` | N/A | `runtime.ts` tail ~2000 LOC. |
| **Session handoff** | Most recent `docs/SESSION_{N}_STATE.md` + `POST_COMPACTION_HANDOFF_2026-04-18.md` | Older `SESSION_{1..9}_HANDOFF.md` | Session-10 onward use the new format. |
| **Key architectural decisions** | `DECISIONS.md` (if exists) OR scattered in `docs/PHASE_*.md` | ADRs not formalized | **GAP**: no single ADR log — recommend creating `docs/DECISIONS.md` as canonical. |

---

## 8. Final observations

Three meta-patterns from this gap analysis:

**A. The audit layer itself has a perishability problem.** Lane 1 §6.3 explicitly calls this out: modules that were FATAL orphans at commit `4a0d31a` got wired between audit commit and HEAD, but the audit docs weren't regenerated. `FINAL_VERIFICATION_AUDIT_2026-04-19.md` now contradicts `AUDIT_FALSE_CLAIMS.md` (its direct predecessor) on 15 of 22 rows simply because code moved. Solution: every wiring commit should update a machine-regeneratable "wiring-status" table via hook, not a human-written doc.

**B. "Wired" is overloaded across the docs.** There are 3 distinct meanings in use: (1) exported from lib.ts, (2) covered by own tests, (3) runtime-integrated. Commit messages + PHASE_*.md progress docs routinely conflate (1) with (3). `AUDIT_FALSE_CLAIMS.md` §"Recommended remediation" proposes a CI lint that flags lib.ts exports with no non-lib/non-own-module/non-tests importer — this would eliminate the class of lies at commit time.

**C. The 5 Audit Lanes don't audit runtime behavior.** Lane 1 audits wiring at AST level. Lane 2 audits competitors. Lane 3 audits source code + screenshots. Lane 4 audits CI/release/security. Lane 5 audits benchmark runners. None of them load a running daemon and inspect its memory.db / token-stats.json / dream state / session logs. The biggest single class of failures (memory block routing, cost-tracker silent-success, dream pipeline empty, KG never populated) sits in runtime output that is only visible via `HIDDEN_STATE_REPORT.md`-style archeology. Strongly recommend Lane 6 = "runtime output audit."

---

**End of AUDIT_DOCS_GAP_ANALYSIS.** Total findings: 91 gaps + 11 contradictions + 14 stale claims + 17 unexplored failure modes + 17 unanswered questions + 25 master-plan additions + 22-row source-of-truth table. ~5,900 words.
