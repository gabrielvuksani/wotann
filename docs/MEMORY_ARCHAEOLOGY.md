# MEMORY_ARCHAEOLOGY — WOTANN Phase-1 Audit, Agent C

**Date**: 2026-04-19
**Agent**: Phase 1 Agent C (memory archaeology)
**HEAD**: `aaf7ec2` (feat(intelligence/tool-pattern-detector)) — 239 commits total
**Purpose**: Reconstruct the full picture of prior-session knowledge from every memory store and cross-reference against git HEAD to surface claims that disagree with reality.

This report is ruthlessly honest. Where past-session Claude over-claimed or lied, that is stated plainly.

---

## 1. Memory-system inventory

| Store | Path / ID | Size | Freshness | Verdict |
|---|---|---|---|---|
| Auto-memory (MEMORY.md + 15 others) | `/Users/gabrielvuksani/.claude/projects/-Users-gabrielvuksani-Desktop-agent-harness/memory/` | 15 files, 32KB total | MEMORY.md 2 days old, others 2-17 days old | ACTIVE, but contains stale index — references a "Session 6 handoff prompt" for work that never happened as described |
| Engram (MCP, SQLite FTS5) | `~/.engram/` (managed by MCP) | 379 observations, 8 sessions, project: `agent-harness` has 282 observations | Most recent: 2026-04-19 11:48:55. No mem_save calls for 215 min (archaeologist hasn't saved anything yet — expected) | AUTHORITATIVE for decisions/bugfixes/architecture; contains both signal and stale-claim fossil record |
| claude-mem (MCP) | `~/.claude-mem/` | 27,146 files / 7,932 symbols indexed across the whole `agent-harness/` tree, including cloned `research/*` repos | Live | USEFUL for code-search / symbol lookup; WEAK for memorized decisions — it surfaced mostly matches from `research/` clones, not `wotann/` session logs. The semantic search for "wotann session 5 audit" returned multica/ruflo/codex hits rather than wotann session work. |
| Prior-Nexus DB | `/Users/gabrielvuksani/Desktop/agent-harness/.nexus/memory.db` | 160KB SQLite, 7 tables (memory_entries, knowledge_nodes, knowledge_edges, team_memory, working_memory, decision_log, auto_capture, memory_vectors, memory_provenance_log) | Frozen since 2026-04-03 14:29 | **COMPLETELY EMPTY**. Every table has 0 rows. Schema is preserved but no data was ever persisted. The pre-WOTANN Nexus agent never stored any decisions. |
| `.nexus/episodes/` | `/Users/gabrielvuksani/Desktop/agent-harness/.nexus/episodes/` | 1 subdir `memory/` containing nothing | Apr 3 | Empty scaffold |
| `.nexus/sessions/` | `/Users/gabrielvuksani/Desktop/agent-harness/.nexus/sessions/` | 9 JSON files × 310 bytes each | Apr 3 14:29 – 19:19 | Session stub files only; each is a minimal 310-byte JSON skeleton |
| `.nexus/screenshots/` | `/Users/gabrielvuksani/Desktop/agent-harness/.nexus/screenshots/` | 0 files | — | Empty |
| Session transcripts | `/Users/gabrielvuksani/.claude/session-data/*wotann*.md` | 9 files, 217KB total | Apr 15 01:05 → Apr 16 23:28 | **The authoritative session-level log**. Covers sessions 1-5 + continuation prompts for sessions 3-6. Session 6 prompt was written but the ACTUAL Apr 18-19 work took an entirely different path (V4 plan Phase 1/4, not the §78 Track A/B from the prompt). |
| Swarm Q-learning | `/Users/gabrielvuksani/Desktop/agent-harness/.swarm/q-learning-model.json` | 582 bytes | Frozen 2026-04-03 23:19 | 1 state (`fstate_4gfz7k`), 1 action with Q-value 5.374 (others all 0), 32,008 visits, ε=0.634 (still mostly exploring), 1000 steps. Single `state.json` shows `swarmId: swarm-mnjiy5y6`, objective "Test project", 6 agents, status: stopped after 15ms. **This is abandoned stub data from an initial framework experiment that never moved past "Test project".** |
| Superpowers brainstorms | `/Users/gabrielvuksani/Desktop/agent-harness/.superpowers/brainstorm/84327-1775441060/` | directory exists, empty or unlisted | Apr 7 00:52 | Empty scaffold |
| claude-flow metrics | `/Users/gabrielvuksani/Desktop/agent-harness/.claude-flow/metrics/swarm-activity.json` | 138 bytes | Apr 3 19:18 | One snapshot: 20 agents, coordination active. Companion to the abandoned swarm experiment. |
| Untracked files at HEAD | `big.txt` (0 bytes), `p1.txt`/`p2.txt`/`p3.txt` (2-byte stubs — "AB"), `ios/Package.resolved` | all tiny | Current | Look like scratch-pad debris from a recent session. Not load-bearing. |

---

## 2. Auto-memory synthesis (15 files, by block-type)

Files under `/Users/gabrielvuksani/.claude/projects/-Users-gabrielvuksani-Desktop-agent-harness/memory/`:

```
MEMORY.md                                      3074 B  Apr 16  (index of everything else)
user_gabriel.md                                1130 B  Apr 6   (identity)
project_nexus_v3.md                            1438 B  Apr 1   (superseded)
project_nexus_v4.md                            1291 B  Apr 1   (spec, active reference)
project_wotann_rebrand.md                      1008 B  Apr 4   (rebrand explanation)
project_wotann_plan_v3.md                      1233 B  Apr 5   (20-phase production plan)
project_wotann_sprint78_progress.md            7313 B  Apr 16  (59 commits after session 5)
feedback_agent_discipline.md                    867 B  Apr 5   (no touching agent-owned files)
feedback_agent_file_ownership.md                718 B  Apr 6   (same rule, duplicate)
feedback_tier_audit.md                          982 B  Apr 11  (post-tier deep audit)
feedback_device_awareness.md                   1163 B  Apr 12  (real iOS device testing)
feedback_verify_full_chain.md                  1233 B  Apr 12  (compile+deploy+verify, not just edit)
feedback_wotann_quality_bars.md                2244 B  Apr 15  (rules 1-4)
feedback_wotann_quality_bars_session2.md       4118 B  Apr 15  (rules 5-9)
feedback_wotann_quality_bars_session4.md       2690 B  Apr 16  (rule 13)
```

### `user` block (1 entry)
- **Gabriel Vuksani**, Full Stack Dev in Toronto; Claude Pro/Max + ChatGPT; prefers TypeScript, functional/immutable patterns, TDD; wants **full autonomy — says WHAT, agent decides HOW**; demands exhaustive planning; will reject plans 5-7 times for insufficient depth; wants Apple Design Award / competitive-parity UI.

### `project` block (5 entries — some stale)
- **project_nexus_v3**: 2004-line spec, superseded — stale
- **project_nexus_v4**: 7927-line spec (NEXUS_V4_SPEC.md), 223 features, 26 appendices, 82+ sources, 37 competitors, 9 provider paths. Current canonical *spec*.
- **project_wotann_rebrand**: NEXUS → WOTANN; Norse internal names, clear English user-facing names
- **project_wotann_plan_v3**: 20-phase production plan with 4 tabs (Chat/Editor/Workshop/Exploit), TerminalBench target 83-95%, Gemma4 default
- **project_wotann_sprint78_progress**: claims "52 commits on origin/main" after session 4. **STALE** — HEAD is 239 commits and the current work is Phase-1 of "V4 Autonomous Execution Plan", not §78.

### `feedback` block (9 entries; note: two duplicate rules on agent file ownership — `feedback_agent_discipline.md` and `feedback_agent_file_ownership.md` are essentially the same "don't touch agent-owned files" rule)
- **Agent file ownership** (2 dupes): never edit files currently owned by a dispatched background agent
- **Device awareness**: real iOS devices, not simulator — NEVER use `#if targetEnvironment(simulator)` guards
- **Tier audit**: always run deep Opus audit after each tier
- **Verify full chain**: "Editing code != fixing" — must rebuild ALL targets + restart daemon + verify logs
- **Quality bars S1 (4 rules)**: no vendor bias at `??` tails; opt-in caps (default unbounded); Sonnet-not-Haiku; never skip tasks
- **Quality bars S2 (5 rules, 5-9)**: Opus for every audit; honest stubs over silent success; per-session state (not module-global); HookResult.contextPrefix channel; test files can codify bugs
- **Quality bars S4 (1 rule, 13)**: env-gate symmetry — strict string equality + mandatory NODE_ENV guard. (Rules 10-12 from session 3 and rule 14 from session 5 are mentioned in MEMORY.md index but the session-3 and session-5 dedicated rule files were never written; they live only in the session transcripts and Engram.)

### `reference` block
None exist as standalone files. References are inline links inside MEMORY.md.

### MEMORY.md — critical stale anchors
Line 15: "Session 6 Handoff Prompt — Max-power prompt for next session; ... TIER 1-5 tier-ordered work with effort estimates". **This session-6 prompt WAS written but the Apr 18-19 work never executed it** — instead Gabriel ran a /compact, loaded the V4 plan, and burned through bug-fix Phase 1 + Phase 4 benchmark harness. The "TIER 1-5" competitor wins (Magika, Karpathy-mode, Agent Skills standard, Conductor undo, Monitor) were NOT shipped as planned; Karpathy was shipped mid-session 5 (commit `41be4de`), Magika was claimed in Engram #293 but the file `src/middleware/file-type-gate.ts` DOES now exist at HEAD — so that one IS real.

### MEMORY.md — hidden contradictions
- MEMORY.md line 16 says "Session 3 Quality Bars — see session-2/3/4/5 transcripts for rules 10-14". This conflates Session 3 quality bars (10-12) with Session 4 (13) and Session 5 (14). The file label says "Session 3" but the content reference spans S3-S5.

---

## 3. Engram — top ~50 most relevant observations

Project has 282 observations. Ranked by salience to the current audit:

| ID | Type | Date | Key claim | Verdict vs HEAD |
|---|---|---|---|---|
| **#375** | decision | Apr 19 11:43 | Phase 4 Sprint B1 — 100% shipped; CompletionOracle wired to `runtime.verifyCompletion`; TerminalBench/Aider-Polyglot/code-eval runners landed; selfConsistencyVote added | **TRUE** — HEAD has `7798084 feat(autopilot) wire CompletionOracle`, `36ce2ba feat(benchmark-runners): TerminalBench scaffold`, `c9d9f7b feat(orchestration/council): selfConsistencyVote`, `ee66fc7 feat(benchmark-runners): Aider Polyglot + code-eval`, `e3c3ca8 feat(cli): wotann bench <flavour>` |
| **#376** | decision | Apr 19 11:48 | 11/11 V4 bugs fixed + Phase 4 B1 done + B2 partial (items 14 + 22 shipped) | **TRUE per commit log** — lists 24 commits; all exist at HEAD (55b68ff, 4e33869, 2346381, 16f6a83, b6fe189, c766c5c, 12006de, f938f08, e14a2c8, 563f666, 0d5dced, 27e63dc, b06b184, 7798084, 36ce2ba, c9d9f7b, ee5d71f, ee66fc7, 8b766a5, f949429, e3c3ca8, cb6d886, 78793c0, 603fe15). |
| **#372** | decision | Apr 18 21:10 | Post-compaction session delivery; 11 bugs closed; 14 prior-audit corrections; Phase 4 prep | **TRUE** |
| **#370** | decision | Apr 18 20:52 | Phase 1 complete — 11/11 bugs fixed; typecheck clean | **TRUE** — 13 files listed all match HEAD |
| **#369** | decision | Apr 18 20:39 | 8 bugs fixed + 3 dispatched to parallel agents | **TRUE** — Apr 18 parallel Opus agents closed Bedrock + Vertex + Camoufox |
| **#368** | discovery | Apr 18 20:34 | **14 PRIOR-AUDIT CORRECTIONS** — V4 plan overcounted gaps by ~60% | **CRITICAL**: means earlier sessions' "ZERO output", "dead", "never loads" claims were mostly wrong. Learning stack WIRED, memoryMiddleware WIRED, KnowledgeGraph PERSISTED, decisionLedger DUAL-PERSISTED, bootstrap WIRED, MCP marketplace ALREADY FIXED, etc. |
| **#367** | discovery | Apr 18 20:32 | Phase 2 consolidations done — dup memory_search_in_domain removed, turboquant already renamed, MCP fake registry already removed | **TRUE** — HEAD shows `563f666 refactor(memory): remove duplicate memory_search_in_domain` + `src/context/ollama-kv-compression.ts` exists |
| **#366** | discovery | Apr 18 20:28 | Learning stack wired at runtime.ts:4280-4475 | **TRUE** at least in name — needs direct re-read to confirm line numbers (runtime.ts has grown) |
| **#365** | bugfix | Apr 18 20:22 | 8 of 11 bugs fixed in-session | **TRUE**, commits match |
| **#363** | decision | Apr 18 19:32 | MASTER_SYNTHESIS_2026-04-18.md + POST_COMPACTION_HANDOFF — 2 canonical docs | **TRUE** — both files exist in `docs/` (52KB + 17KB) |
| **#359** | bugfix | Apr 18 19:15 | kairos-rpc.ts full audit — 156 handlers, 9 of 10 prior stubs actually fixed | Need verify; my grep for voice.transcribe/stream/forge/completion shows 25 occurrences, suggesting they're at minimum referenced |
| **#358** | bugfix | Apr 18 19:15 | index.ts CLI deep read — 74 leaf commands + 7 missing verbs + 8 orphan files | Needs direct verify |
| **#356** | decision | Apr 18 19:01 | AUTONOMOUS_EXECUTION_PLAN_V4 — supersedes ALL prior plans; critical path Phase 0→1→4→7 = 56 days with 14-day buffer | This is the plan that the Apr 18-19 sessions actually executed. **SUPERSEDES the session-6 continuation prompt from session 5**. |
| **#353** | decision | Apr 18 18:55 | V3 Execution Plan — Wave 3 ground truth — 16 major wave-3 patterns, 9 new S.4 items | Superseded by V4 |
| **#344** | discovery | Apr 18 18:41 | Wave 3 ground-truth research via Chrome MCP | Evidence-based |
| **#342** | discovery | Apr 18 18:17 | 10 missed competitors deep research | `/research/competitor-analysis/missed-competitors-2026-04-18.md` file exists |
| **#339** | decision | Apr 18 18:12 | Top-40 leverage-per-LOC leaderboard + 10 addendum = 50 priority tasks | `MASTER_PLAN_SESSION_10.md` (§5) + addendum — both exist |
| **#338** | discovery | Apr 18 18:11 | SESSION_10_STATE.md — 24 commits incl Bedrock/Vertex auth real, FocusView, SealedScroll, Well, ghost-delete | True per commit log + doc file exists |
| **#336** | bugfix | Apr 18 18:10 | CONTRADICTIONS RESOLVED via direct source read — Bedrock SigV4 IS real, Vertex OAuth2 IS real, agent-bridge tools forwarding FIXED, SOUL.md may or may not be fixed | **This is load-bearing**: confirms prior sessions' "fabricated auth" claims were wrong. |
| **#335** | bugfix | Apr 18 18:09 | MASTER_PLAN_SESSION_10 — S9 signature components ORPHANED (Runering, CapabilityChips, SealedScroll, Well, FocusView); Bedrock+Vertex auth fabricated; fallback chain excludes 9 of 18 | **CONTRADICTS #336 and #338** — two docs disagree. #338 (SESSION_10_STATE) claims the orphaned components were fixed in S10 commit `8e3a3fe`; #336 claims Bedrock auth IS real. #335 (S9/S10 audit) claims the opposite. Most likely: #335 is the older claim synthesized into the V2 plan; #336/#338 are the ground-truth corrections. HEAD should be checked. |
| **#324** | bugfix | Apr 18 17:52 | Dead code + fake hooks + RPC stubs inventory — 4500 LOC + 10 hooks + 10 stubs + 15 unreachable + 10 sec + 30 hermes + 15 opencode + 16 oh-my-pi patterns | Aspirational / research-grade; not all acted on |
| **#323** | bugfix | Apr 18 17:50 | MASTER_AUDIT_2026-04-14 — 5 hard truths + 19 ship-blockers + 4500 LOC dead code | Referenced in downstream plans |
| **#322** | bugfix | Apr 18 17:40 | Wiring audit — 3,300 LOC DEAD + AutoresearchEngine FALSE CLAIM (runtime.ts:932 `async () => null` no-op generator) | **Smoking gun**, closed in commit `e14a2c8 feat(training): wire real LLM modification generator for autoresearch` |
| **#318** | bugfix | Apr 18 17:30 | Docs audit — 156 claims, 17% FALSE; LIVE Supabase key in GAP_AUDIT_2026-04-15.md; MASTER_PLAN_SESSION_10 has stale false claims | **LEAKED KEY STILL ACTIVE** per auto-memory. Manual Gabriel action unchanged across 5+ sessions. |
| **#302** | session_summary | Apr 17 02:37 | Session 4 extended — 10 commits including MiniLM wiring; claimed voice RPCs wired | **CAUGHT LATER**: session 5 audit (#293) found voice.transcribe + voice.stream were still stubs after the session-4 commit message claimed they were wired. |
| **#301** | session_summary | Apr 17 01:49 | Session 4 initial — Phase 1 audit of session 3's 6 commits | Evidence-based |
| **#299** | session_summary | Apr 15 16:30 | Session 3 — 6 commits, 4 critical Opus audit fixes | Evidence-based |
| **#298** | discovery | Apr 15 15:12 | Session 2 — 22 commits, Wave 1-9, 4 novel ports, 36 total local | Evidence-based |
| **#297** | session_summary | Apr 15 15:10 | Session 2 summary — §78 phase 1 + 2 + wave 1-9 | Evidence-based |
| **#295** | decision | Apr 15 05:56 | Sprint §78 Phase 1 — Opus audit + 6 fix clusters + GAP_AUDIT | Evidence-based |
| **#293** | decision | Apr 15 04:58 | Session 5/6 round-2 — 12 commits to 5f2c35c + UI_DESIGN_SPEC + Magika + Karpathy + GAP-11 (QVS never instantiated false-claim caught) | **MAINLY TRUE** — commit `5f2c35c` exists on Apr 16 23:53 (`refactor(dead-code): delete 5 orchestration + 1 telemetry module ~1200 LOC`), `docs/UI_DESIGN_SPEC_2026-04-16.md` exists, `src/middleware/file-type-gate.ts` exists, `skills/karpathy-principles.md` exists. **BUT** the Engram entry has a puzzling datestamp of Apr 15 04:58 — that's BEFORE any session 4 or 5 happened in real time. The content describes session 5 round-2 which actually happened Apr 16. Most likely this is a `topic_key` upsert overwritten multiple times — the `Revisions: 8` field confirms. |
| **#292** | session_summary | Apr 15 04:57 | Session 2 — §78 execution | Evidence-based |
| **#290** | decision | Apr 15 02:13 | Master audit FINAL — 28 agents, 76 sections, 3,675 lines, 114 sprint items | MASTER_AUDIT_2026-04-14.md exists (265KB, 4063 lines) |
| **#288** | decision | Apr 15 01:35 | §74 Multi-provider cost optimization 4-layer strategy | Reference |
| **#283** | architecture | Apr 14 21:15 | **SOUL.md regex mismatch** — identity.ts looks for `## Core Values` but SOUL.md has `## What You Value`. 52-line Norse narrative NEVER reaches model. | Prior audit claim. Engram #318 (Apr 18) and #336 (Apr 18 ground-truth) disagree on whether this was later fixed. Needs direct HEAD read. |
| **#281** | architecture | Apr 14 21:12 | Competitor + benchmark research — threat ranking with OpenAI Codex CLI (10/10), Serena (9/10) | Strategic context |
| **#278** | architecture | Apr 14 20:29 | App-builders deep-dive + 60-90 day Anthropic timeline | Race-context framing |
| **#269** | bugfix | Apr 14 19:06 | **URGENT: WOTANN leaked Supabase creds in CREDENTIALS_NEEDED.md on public GitHub** | File was deleted but key still valid. **Manual action outstanding 5+ sessions.** |
| **#260** | session_summary | Apr 14 00:41 | DEEP_AUDIT_2026-04-13 plan — 76-item Phases A-G | Evidence-based |
| **#258** | discovery | Apr 13 05:33 | WOTANN Audit Final — 11 total Opus agents + competitor cross-ref | Evidence-based |
| **#226** | architecture | Apr 11 23:42 | Multica patterns complete — 138/138 PASS | Pre-sprint-78 state |
| **#220** | architecture | Apr 11 22:48 | Tier 4 — iOS ECDH + Supabase creds removed + security indicator | — |
| **#219** | architecture | Apr 11 22:44 | Tier 3 — iMessage adapter wired + Supabase creds removed + STUB_PATTERNS extended | — |
| **#195** | architecture | Apr 9 05:04 | Five Pillars plan 100% — Phases A-D | Older, pre-§78 state |
| **#183** | architecture | Apr 9 02:24 | iOS AI architecture corrected — daemon PRIMARY, on-device opt-in | — |
| **#166** | architecture | Apr 8 19:12 | Exhaustive Final Audit — 66 desktop components + 15 plan features | — |
| **#126** | architecture | Apr 7 00:00 | UI redesign — 40+ files, 8 new components | Pre-sprint-78 UI baseline |
| **#115** | architecture | Apr 6 16:10 | Comprehensive UI overhaul + 8-phase implementation | — |
| **#105** | bugfix | Apr 5 20:18 | Desktop Phase 1 — 8 critical bugs resolved (useEngine never called) | — |
| **#92** | architecture | Apr 2 20:23 | **NEXUS** Session 8 Final Audit — 922 tests, comprehensive gap list (pre-rebrand) | Historical |
| **#84** | architecture | Apr 1 21:50 | NEXUS V4 Spec Final — 7927 lines, 325KB, 223 features, 26 appendices | Foundational spec |
| **#82** | discovery | Apr 1 21:28 | OpenClaude competitive intel — 2838 stars Apr 1 2026 | Competitive snapshot |

---

## 4. Prior-Nexus-DB contents

**Empty.** All 7 tables have 0 rows. Schema preserved only.

```
memory_entries    0 rows
knowledge_nodes   0
knowledge_edges   0
team_memory       0
working_memory    0
decision_log      0
auto_capture      0
memory_vectors    0
memory_provenance_log 0
```

The pre-WOTANN Nexus agent at `.nexus/memory.db` was initialized but nothing was ever persisted. Nothing to port. This confirms the architectural transition from Nexus → WOTANN was a clean start, not a migration of data.

The 9 `.nexus/sessions/*.json` files (310 bytes each) are empty session-start stubs, not conversation records. The `.nexus/screenshots/` dir is empty.

---

## 5. Session-transcript synthesis (9 files)

Location: `/Users/gabrielvuksani/.claude/session-data/2026-04-*-wotann-*.md`.

### Session 1 — `2026-04-15-wotann-sprint78-execution.md` (16,905 B, Apr 15 01:05)
- **14 commits** (`cb55d53` through `aa32af8`) on local main, ~85 of 155 §78 items
- Established quality bars 1-4 (vendor bias, unbounded caps, Sonnet not Haiku, no-skipping)
- Skipped S0-10 (ESLint 9 flat config — hook-blocked) and S1-15 (event listener `.off()` cleanup)
- **Did NOT push** — 13 commits stayed local
- Manual actions owed: rotate Supabase key; approve ESLint 9; push 13 commits

### Session 2 — `2026-04-15-wotann-session2-transcript.md` (18,486 B, Apr 15 11:09)
- **22 commits** (`ad37d2c`..`3334ef9`), Wave 1-9 + 4 novel ports (S3-2 parsers, S3-4 QVS scaffold, S3-5 active-memory, S3-7 OCR)
- Established quality bars 5-9
- Also **not pushed** — local-only
- **Key architectural win**: PreToolUse event finally fires (session-2 commit `352fd7f`) — unblocked 16+ registered hooks

### Session 3 — `2026-04-15-wotann-session3-transcript.md` (24,474 B, Apr 15 18:15)
- **6 commits** (`1b99f08`..`a830dd0`) — 4 CRITICAL Opus audit fixes: PreToolUse.filePath, shadow-git 3-way instance mismatch, 5 parser drifts + dead dispatch, DNS rebinding TOCTOU
- **First session to push to origin** — all 42 prior commits pushed
- Established quality bars 10-12
- `@xenova/transformers` installed as optional dep
- Manual-state: Supabase key STILL not rotated

### Session 4 — `2026-04-16-wotann-session4-transcript.md` (18,690 B, Apr 16 22:46)
- **10 commits** (`5bdab0c`..`322ec25`) — 4 adversarial findings closed + Phase 2 Tier 1 MiniLM wire + ToolResultReceived event + voice/completion/forge RPCs "wired" + 83 lint warnings → 0
- Established quality bar 13 (env-gate symmetry)
- **Honest post-mortem block**: transcript itself admits Tier 2 (query pipeline consolidation, cost unification) was skipped and session scope drifted — "the snub Gabriel called out earlier"
- **Seeded a future lie**: commit `11697f3` claimed voice.transcribe was wired; session 5 audit proved it was still a stub

### Session 5 — `2026-04-16-wotann-session5-transcript.md` (22,675 B, Apr 16 23:22)
- **6 commits** (`72d34e9`..`41be4de`) — 10 Phase-1 gaps closed including 2 FALSE commit-message claims from session 4 (voice.transcribe/stream + "runtime-verified" MiniLM test that had zero real ONNX path coverage)
- Tier 2: deleted `runtime-query-pipeline.ts` + `token-persistence.ts` (`72d34e9`) = −1006 LOC of drifted parallel extract / write-only orphan
- Competitor ports: Karpathy skill + Groq free-tier $0 (`41be4de`)
- Established quality bar 14 (commit-messages-are-claims)
- 33-project competitor research synthesized into a top-10 ranked port list for session 6

### Session 5 "round 2" — Engram #293 (Apr 15 04:58 datestamp but content describes Apr 16 work)
- An additional 5-6 commits after `41be4de` that the transcript file doesn't document: `5f2c35c refactor(dead-code): delete 5 orchestration + 1 telemetry module ~1200 LOC` + Magika middleware + UI_DESIGN_SPEC doc. This round-2 actually happened but is only in Engram, not in a transcript file.

### Continuation prompts
| File | Written for | What it asked for | What actually happened |
|---|---|---|---|
| `2026-04-15-wotann-continuation-prompt.md` | Session 3 | Audit session 2's 22 commits + continue §78 | Ran: became session 3 |
| `2026-04-15-wotann-session4-continuation-prompt.md` | Session 4 | Audit session 3's 6 commits + MiniLM phase 2 + ToolResultReceived + voice RPCs | Ran: became session 4 (with the false voice-RPC lie) |
| `2026-04-16-wotann-session5-continuation-prompt.md` | Session 5 | Audit session 4 + continue Tier 2 (query pipeline consolidation + cost unification) | Ran partially: became session 5 (audit done, Tier 2 = file deletion, then round-2 for UI spec + competitor ports) |
| **`2026-04-16-wotann-session6-continuation-prompt.md`** | Session 6 | **Audit session 5 + ship tier-1 competitor wins (Karpathy toggle, Magika middleware, Agent Skills open standard, Conductor undo, Monitor tool)** | **NEVER EXECUTED AS WRITTEN.** A Apr 18 /compact happened and the session pivoted to "V4 Execution Plan" — 15-phase work with Phase 1 (11 bugs) + Phase 4 (benchmark harness), not §78 Track A/B. Magika + Karpathy had already been shipped in session-5 round-2, not session 6. |

---

## 6. Swarm Q-learning artifact analysis

`/Users/gabrielvuksani/Desktop/agent-harness/.swarm/q-learning-model.json`:
```json
{
  "version": "1.0.0",
  "config": {
    "learningRate": 0.1,
    "gamma": 0.99,
    "explorationDecayType": "exponential",
    "numActions": 8
  },
  "qTable": {
    "fstate_4gfz7k": {
      "qValues": [5.374, 0, 0, 0, 0, 0, 0, 0],
      "visits": 32008
    }
  },
  "stats": {
    "stepCount": 1000,
    "updateCount": 1000,
    "avgTDError": 2.513,
    "epsilon": 0.635
  },
  "metadata": {
    "savedAt": "2026-04-03T23:19:22.473Z",
    "totalExperiences": 1000
  }
}
```

Paired with `state.json`:
```json
{
  "swarmId": "swarm-mnjiy5y6",
  "objective": "Test project",
  "strategy": "testing",
  "status": "stopped",
  "agents": 6,
  ... (6 testers/reviewers),
  "startedAt": "2026-04-03T23:18:08.286Z",
  "parallel": true,
  "stoppedAt": "2026-04-03T23:18:08.301Z"  // 15ms after start
}
```

**Interpretation**: This is a short-lived initial experiment with the `claude-flow` / swarm framework. Objective was literally the placeholder string "Test project". 1000 Q-learning updates ran on ONE state (`fstate_4gfz7k`) with 8 discrete actions; only action-0 got positive reward (~5.37). The swarm itself stopped 15 milliseconds after starting. 32,008 visits to one state suggests a tight training loop not tied to any real agent task.

**Abandoned feature.** Not wired into WOTANN. No code at HEAD imports `.swarm/`. Superpowers-brainstorm + claude-flow are dead scaffolding from an April 3 framework-integration attempt, frozen 16 days ago. Safe to delete but noting it for the "zero-deletion" rule Gabriel codified in the V4 plan — it should probably be preserved as historical debris unless explicitly greenlit.

---

## 7. Claims vs reality — discrepancies

Verified against HEAD `aaf7ec2`.

### DISCREPANCY 1 — "Session 6" was a plan, not an execution
- **Claim** (MEMORY.md line 15, session-6 continuation prompt): Session 6 would audit session 5, then ship the top-10 competitor wins (Karpathy toggle, Magika, Agent Skills standard, Conductor undo, Monitor, hooks `if` field, Credential pool, GenericAgent crystallization, Code Mode, ACP).
- **Reality at HEAD**: The session-6 plan as-written was NEVER RUN. The Apr 18-19 work instead executed the "V4 Autonomous Execution Plan" (see Engram #356) which is a completely different 15-phase plan written POST-session-5 and replaces the §78 track. Phase 1 closed 11 bugs; Phase 2+3 confirmed already-done; Phase 4 Sprint B1 + B2-partial shipped the benchmark harness. The specific "tier-1 competitor wins" from the session-6 prompt:
  - Karpathy-mode: **shipped in session 5** (`41be4de`), not session 6 — done
  - Magika middleware: **shipped between session 5 and Apr 18**, per Engram #293, and `src/middleware/file-type-gate.ts` exists at HEAD — done (but not via the session-6 plan)
  - Agent Skills open standard, Conductor undo, Monitor tool, Hooks `if` field, Credential pool, GenericAgent crystallization, Code Mode, ACP compliance — **NONE landed yet**. ACP thread-handlers commit `436d8f0` (Phase 5) exists but is just the fork/rollback/list/switch RPC methods, not full stdio host compliance. **These are forgotten deferrals (see §8).**

### DISCREPANCY 2 — auto-memory MEMORY.md is stale
- **Claim**: `project_wotann_sprint78_progress.md` header says "52 commits on origin/main" (actually the file body says "52 total" at session-4 close). MEMORY.md line 10 says "59 commits pushed to origin after session 5".
- **Reality at HEAD**: 239 commits. The sprint-78 framing is two generations behind. Auto-memory never updated after the Apr 17 sessions beyond the session-5 bump.

### DISCREPANCY 3 — "Session 5 landed 6 commits" vs "12 commits through 5f2c35c"
- **Session 5 transcript** says 6 commits (`72d34e9..41be4de`).
- **Engram #293** says "12 commits total (72d34e9..5f2c35c + UI_DESIGN_SPEC commit)".
- **Reality**: Both are true about different time-windows. The transcript captured the first 6 commits before Gabriel said "surface-level"; the round-2 added 5-6 more (`5f2c35c` deletion + UI_DESIGN_SPEC write + Magika + Karpathy-mode was already in `41be4de`). **The round-2 work was never captured in a transcript file — only in Engram.** Future sessions reading transcripts-only would miss it.

### DISCREPANCY 4 — Bedrock/Vertex auth contradictions in Engram
- **Engram #335** (Apr 18 18:09): "BEDROCK + VERTEX AUTH IS FABRICATED — registry cases send Bearer tokens to /chat/completions. NO SigV4 anywhere. NO OAuth2. Vertex passes service-account-JSON file path AS the token."
- **Engram #336** (Apr 18 18:10, **one minute later**): "BEDROCK SIGV4 IS REAL: bedrock-signer.ts:40-100 has full AWS SigV4. NOT fabricated. VERTEX OAUTH2 JWT IS REAL: vertex-oauth.ts:55-100 buildSignedJwt with RS256. NOT fabricated."
- **Reality at HEAD**: HEAD has `c766c5c fix(providers/bedrock): real toolConfig body + stream state machine` + `12006de fix(providers/vertex): full messages+tools+system body + stream events`. Those fix the BODY construction. The AUTH signer/oauth was real even before — #336 is correct, #335 was the stale prior-audit claim that the V4 plan was correcting. BUT a reader who pulls only #335 would think the auth is still broken.

### DISCREPANCY 5 — Session 4's voice.transcribe + MiniLM false claims
- **Session 4 commit message** `11697f3` (and Engram #302): claimed voice.transcribe + voice.stream.* + completion.suggest + skills.forge.run all wired to real implementations.
- **Session 5 audit** (Engram #293 GAP-1, #293 GAP-2, session-5 transcript): 2 of the 4 claimed-wired were still stubs. **OUTRIGHT FALSE CLAIM.** The MiniLM "runtime-verified" claim was also false — all 10 tests used `forceTFIDFFallback: true`.
- **Closed at commit**: `7eb2313` (Apr 16 23:08) + `b40bdc7` (real ONNX tests) — session 5
- **Lesson codified**: quality bar 14 — commit-messages-are-claims-that-need-runtime-verification.

### DISCREPANCY 6 — Session 4 "session 5 priorities" were renamed "session 6", then "V4 plan"
- Session 4 transcript calls specific items "session 5 priorities" (Tier 2 query pipeline consolidation + cost unification).
- Session 5 picked up Tier 2 (did the deletion part), then named further items "session 6 priorities".
- Session 6 continuation prompt named the competitor wins.
- Apr 18 /compact scrapped all prior planning and wrote V4 plan.
- **None of those backlog items were explicitly cancelled**; they just drifted out of the active plan. See §8 for the list of forgotten deferrals.

### DISCREPANCY 7 — "Runtime-query-pipeline deleted" still has 2 references
- Session 5 transcript: "Deleted runtime-query-pipeline.ts".
- Engram #293: "−1006 LOC dead code".
- **Reality**: File is deleted from `src/core/`, but grep across src/ shows 2 files still reference the NAME:
  - `src/cli/self-improve.ts` — self-improve extraction-suggestion description updated (as the session-5 transcript admits)
  - `src/core/tool-path-extractor.ts` — contains the consolidated extractor that supersedes the duplicate; no import
  Neither is a live importer. The deletion IS clean.

### DISCREPANCY 8 — `src/telemetry/token-persistence.ts` deletion has 1 reference at runtime.ts
- Grep shows 1 match in `src/core/runtime.ts`. Most likely a comment or a removed-import trace. The file itself is gone. The 1 reference is cosmetic.

### DISCREPANCY 9 — Nexus session stub files
- Engram contains NO observations from the prior-product Nexus agent. `.nexus/memory.db` is empty. Sessions stubs are 310-byte empty JSONs. **The pre-WOTANN agent never learned anything.** This is not a discrepancy so much as a gap — but any claim like "we learned from Nexus" is false.

### DISCREPANCY 10 — "40+ tautological tests" was overcounted
- Engram #368 correction 14: "Actual tautology was fallback-e2e.test.ts:95 (fixed this session). 258 `.toBeTruthy()` across tests/ are 'weak existence checks' not self-equality tautologies."
- Sessions 1-10 earlier claimed 40+ tautological tests. HEAD has `0d5dced test(integration): replace fallback-e2e self-equality with real invariants` — ONE test was the real tautology.

### DISCREPANCY 11 — Dead-code churn claims vs preservation
- Engram #322 (Apr 18): "11 of 14 major subsystems verified wired. 3+ completely dangling, 6 partial/leaky." Lists meet/* (454 LOC), autopilot/completion-oracle (288), autopilot/pr-artifacts (276), computer-use/perception-adapter (316), skills/self-crystallization (172), channels/route-policies (412), channels/auto-detect (390), channels/terminal-mention (116), testing/visual-diff-theater (509), agents/required-reading as dead.
- **HEAD check**: `src/meet/` exists (coaching-engine, meeting-pipeline, meeting-runtime, meeting-store). Commit `b7924fc feat(meet/meeting-runtime): compose pipeline + store + coaching-engine (Phase 14)` WIRED the meet trilogy. `src/autopilot/completion-oracle.ts` AND `pr-artifacts.ts` exist; completion-oracle was wired in `7798084`. `src/channels/auto-detect.ts` exists. `docs/PHASE_14_PROGRESS.md` claims 8 of 14 were already-wired + 3 exposed via lib.ts this session + 3 deferred. **Gabriel's "zero-deletion" rule held** — nothing the audits flagged as dead got deleted; most got wired.

### DISCREPANCY 12 — Ephemeral untracked files
- `big.txt` (0 bytes), `p1.txt`/`p2.txt`/`p3.txt` (2 bytes: "AB") in wotann/ — look like scratch-pad left over from ripgrep/sed attempts. Should probably be gitignored and nuked, but not worth a commit; flagging only.

---

## 8. Forgotten deferrals — items that past sessions set aside and the CURRENT session should heed

### FD-1 — Tier 2 query-pipeline consolidation (PARTIALLY done)
Session 5 deleted runtime-query-pipeline.ts. ✅ Done.
Session 4's sibling claim: "pick ONE authoritative query pipeline". With the sibling deleted, runtime.query is authoritative. ✅ Done.

### FD-2 — Cost-tracking unification
Session 4 prompt + session 5 prompt: "5 disparate sources (cost-tracker, token-persistence, runtime.getCostTracker, runtime.getStatus, cost.current). Pick one authoritative, delete the rest."
Session 5 deleted `token-persistence.ts` (write-only orphan) and added `CostTracker.getTokenStats()` projection. ✅ Partially done (4 sources left).
**Still open**: verify cost.current RPC handler + runtime.getStatus share the same `CostTracker` singleton. No HEAD commit explicitly addresses this consolidation beyond the deletion.

### FD-3 — Forgecode-techniques (S5-8): 875 LOC dead, 7 exports with zero consumers
Session 5 deferred to session 6: wire StaleReadTracker into ReadBeforeEdit hook + getTimeoutForCommand into bash/execute tool (natural fits). Delete the rest: `getModelProfile`, `runPreCompletionChecklist`, `discoverEntryPoints`, `allocateReasoningBudget`, `autoInstallMissingDep`.
**NOT in any subsequent commit.** V4 plan's Phase 14 zero-deletion scope may have re-swept these but PHASE_14_PROGRESS.md does not list them.
**STILL OPEN.**

### FD-4 — S5-9 lib.ts-only orchestration modules
Session 5 named 5 modules: `agent-graph-gen`, `agent-messaging`, `agent-protocol`, `consensus-router`, `ambient-code-radio`.
**HEAD check**: commit `5f2c35c refactor(dead-code): delete 5 orchestration + 1 telemetry module (~1200 LOC)` — **these were DELETED** in session 5 round-2. ✅ Done.

### FD-5 — S5-12 intel getter-only modules (6 modules per master audit)
Session 5 deferred.
**HEAD check**: No commit message explicitly closes this. Phase 14 doc doesn't list them. **STILL OPEN.**

### FD-6 — S5-1 Edge TTS
`src/voice/edge-tts-backend.ts` exists but "never called from voice-pipeline.ts" per Engram #324.
**STILL OPEN.**

### FD-7 — S5-2 sidecar download verification
"wired but not runtime-verified (release binaries may not exist yet)". Session 5 transcript: Gabriel owes GitHub Release binary setup.
**STILL OPEN** (Gabriel manual action).

### FD-8 — S5-7 macOS STT misleading "system" detection
"find the false-positive code path". Never addressed.
**STILL OPEN.**

### FD-9 — S5-15-19 keyboard/aria UI polish (5 items)
External-blocker (live tauri:dev + Chrome DevTools MCP).
**STILL OPEN** (external-blocker).

### FD-10 — Large-file splits (S4-1, S4-2) Gabriel-deferred
- runtime.ts now ~4450 LOC (session-5 transcript), may have grown further
- kairos-rpc.ts ~5100 LOC after session-5 voice additions
- companion-server.ts 2052, memory/store.ts 1994, kairos.ts 1750, provider-service.ts 1306, 13 others >800
CLAUDE.md says "200-400 typical, 800 max". All these violate.
**Explicitly Gabriel-deferred.** Not a bug — a tracked deferral.

### FD-11 — iOS work (18 items) — external-blocker (Xcode + physical iPhone)
### FD-12 — Tauri UI work (30 items) — external-blocker (live tauri:dev + Chrome DevTools MCP)
### FD-13 — Production (3 items): S4-6 Apple Developer ID, S4-17 Sentry DSN, S4-18 Keychain non-Mac fallback
All external-blocker. Unchanged across all 5+ sessions.

### FD-14 — Top-10 competitor wins from session-6 prompt
Shipped:
- ✅ Karpathy skill (commit `41be4de`, session 5) + potentially wired via env var (`WOTANN_KARPATHY_MODE`, not verified at HEAD)
- ✅ Magika file-type-gate (per Engram #293, middleware exists at HEAD)

NOT shipped:
- ❌ **Agent Skills open-standard compliance** (~350 LOC, MIT) — would give 1000s of OSS skills for free
- ❌ **Code Mode** (~450 LOC, Apache-2.0) — 70-90% context cost reduction on multi-step flows, huge optimization win
- ❌ **DSPy + GEPA self-evolution** (~1100 LOC, MIT) — V4 plan Phase 7 addresses partial: commit `3c1b215 feat(learning/gepa-optimizer)` + `c06d3cc feat(learning/miprov2-optimizer)` ARE in HEAD
- ❌ **ACP compliance** (~600 LOC, open spec) — partial: `436d8f0 feat(acp/thread-handlers)` exists but the stdio JSON-RPC host shim is not visible in HEAD
- ❌ **Credential pool + rate guard + prompt caching** (~600 LOC, MIT) — partial: `5b31410 feat(providers/circuit-breaker)` + `37bfea5 feat(providers/retry-strategies)` + `a5137c7 feat(providers/prompt-cache-warmup)` exist but not the Hermes `credential_pool.py` OAuth rotation
- ❌ **Claude Code Monitor tool pattern** (~150 LOC)
- ❌ **Conductor's "reset to previous turn"** — `903a42a feat(core/conversation-branching): rollback + rollbackToTurn` exists but the UI gesture `/undo-turn` + sidebar surface may not
- ❌ **GenericAgent self-crystallization** (~400 LOC, MIT)
- ❌ **Docker sandbox over worktrees** (~500 LOC, Air)
- ❌ **Hooks `if` field + `prompt`/`agent` handler types** (~300 LOC)

### FD-15 — Manual actions Gabriel owes (5 sessions unchanged)
1. **Rotate Supabase anon key** `sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT` — still live in production per Engram #318
2. **Publish GitHub release binaries** for sidecars — referenced URLs may 404 (blocks S5-2 verification)

### FD-16 — MASTER_PLAN_SESSION_10.md tier-S items
`MASTER_PLAN_SESSION_10.md` §5 lists a 50-item leverage-per-LOC leaderboard (Engram #339). Many items are marked done by session-10 commits but were NEVER reverified against HEAD:
- Item 6: SOUL.md path fix (workspace-first, $HOME fallback) — **conflicting claims**: Engram #283 says still broken (regex mismatch). #318 says "actually reads workspace first in identity.ts:23-50". Needs HEAD verification.
- Item 1: Runering wire to mem_save events — 40 LOC, Tier S
- Items 2-5: CapabilityChips/SealedScroll/Well scrubber/FocusView live-mount — mostly done per session 10 claims but NOT reverified after Apr 18 work
- Items 10-20 (tool-serialization, instruction-provenance wiring, memoryMiddleware consumer, QVS runtime instantiation) — mostly done per corrections #366-#368
- Items 24-25 (Tauri per-command allowlist, delete 20 dead Rust commands) — not obviously addressed
**Many of these are de-facto open unless a fresh audit verifies.**

---

## 9. Unknown unknowns — things memory mentions that the audit prompt does NOT

These are facts/constraints/artifacts that past sessions care about but the current Agent-C prompt didn't explicitly flag:

### UU-1 — Session-6 prompt references a NONEXISTENT session
The whole session-6 continuation prompt was written by session 5 but the actual Apr 18-19 work pivoted to a brand-new "V4 Autonomous Execution Plan" that session 5 had no knowledge of. **Anyone reading the session-6 prompt as the "current plan" would be 2 plans behind.** The live plan is V4 (Engram #356, `docs/AUTONOMOUS_EXECUTION_PLAN_V4_2026-04-18.md`).

### UU-2 — "Compaction" event on Apr 18
A /compact happened between session 5 (Apr 16 23:22) and Engram #322 (Apr 18 17:40). The V4 plan was written post-compaction. **Every pre-Apr-18 Engram observation is working off the pre-compaction state.** The 14 prior-audit corrections documented in Engram #368 are precisely what was re-verified post-compaction. Any new audit that rehydrates only pre-Apr-18 observations will over-count gaps by ~60% (the #368 finding).

### UU-3 — `docs/MASTER_AUDIT_2026-04-14.md` is 4063 lines / 265KB
Gabriel twice reinforced "read master plan IN FULL" in session 3. It's the foundational document; most Engram audit decisions trace back to §77 findings + §78 sprint plan. Any current session NOT reading it is missing foundational context.

### UU-4 — `~/.claude/plans/glistening-wondering-nova.md` referenced in CLAUDE.md is the "mega-plan"
CLAUDE.md line 4: "The mega-plan is at `~/.claude/plans/glistening-wondering-nova.md`." This file exists outside the repo tree and is **not** part of any session transcript reference chain. It appears to be WOTANN's original 20-phase plan. Never read by any Agent-C-style deep audit I can find.

### UU-5 — Two contradictory "final delivery" claims on Apr 18-19
- Engram #372 (Apr 18 21:10): "FINAL DELIVERY (11 bugs + Phase 4 prep + 14 audit corrections)"
- Engram #376 (Apr 19 11:48): "Phase 1 complete + Phase 4 Sprint B1 done + B2 partial — 17 commits on origin/main"
Both use word "final"; they are ~15 hours apart. #376 is newer and supersedes #372, but #372's Phase 4 PREP morphed into #376's Phase 4 SHIP. **The "final" label is overused.**

### UU-6 — Abandoned swarm/claude-flow/superpowers artifacts
`.swarm/`, `.claude-flow/`, `.superpowers/` are all early-April experimental scaffolding, frozen 16 days ago, not referenced by any current work. Preserved only because of Gabriel's "zero-deletion" rule. They represent **three separate AI agent frameworks that were evaluated and abandoned** before WOTANN settled on its current architecture.

### UU-7 — `.wotann/SOUL.md` regex mismatch — still unresolved per contradicting reports
- Engram #283 (Apr 14): bug confirmed, regex looks for `## Core Values`, SOUL.md has `## What You Value`. Norse narrative never loads.
- Engram #318 (Apr 18): "MASTER_PLAN_SESSION_10 has STALE FALSE CLAIMS ... SOUL.md never loads (actually reads workspace first in identity.ts:23-50)" — the word "actually" here is ambiguous; could mean "session 10 fixed it" or "the original regex was right and the audit was wrong".
Needs a direct HEAD read of `src/prompt/modules/identity.ts` and `.wotann/SOUL.md` to close this out.

### UU-8 — CI flake migration: shard 1 GH runner preemption
10+ consecutive CI runs failed on Test 1/2 with `##[error]The runner has received a shutdown signal`. Final mitigation: commit `10402ed ci: move test shards to self-hosted runner`. Gabriel's laptop is now the CI runner. **Fragility**: if Gabriel's laptop is offline, CI goes red. Documented in PHASE_15_SHIP_PLAN.md §Risk 4.

### UU-9 — `ios/Package.resolved` is untracked
Apparently a swift-package-manager resolution file. If it changed due to recent work, it should probably be gitignored or committed. Flagging.

### UU-10 — Two rule-sets compete in this project
- Gabriel's global rules at `~/.claude/CLAUDE.md` + `~/.claude/rules/*` (14+ quality bars codified across sessions 1-5)
- Project CLAUDE.md at `wotann/CLAUDE.md` (directory structure + architectural rules + build order)
- V4 plan `docs/AUTONOMOUS_EXECUTION_PLAN_V4_2026-04-18.md` (tactical execution)
When these conflict, which wins? Global rules override session-level by fiat (see `~/.claude/rules/always-on-behaviors.md` §15). But the V4 plan's "zero-deletion" rule was added BY GABRIEL mid-Apr-18 and isn't in the global rules yet. Any new session needs to know to preserve "zero-deletion" — it's not codified outside Engram #356.

### UU-11 — `research/` directory is MASSIVE and cloned-in
claude-mem's smart_search returned most of its matches from `/Users/gabrielvuksani/Desktop/agent-harness/research/*` (codex, ruflo, omi, multica, hermes, cognee, archon, goose, deeptutor, ruflo, superpowers, etc.). Thousands of files representing the 33-project competitor landscape. **Not part of the wotann/ build tree, but consumes significant claude-mem index space.** Explains why semantic memory search often returns research/* hits instead of wotann/ hits.

### UU-12 — The CLAUDE.md sprint order is OUT OF SYNC with reality
CLAUDE.md Build Order says:
```
Sprint 0: Fix issues (DONE ✅)
Sprint 1: Foundation ...
Sprint 6: Differentiation ...
```
Reality: Gabriel has been executing Sprint §78 (a single 155-item unified sprint that supersedes Sprints 1-6), then the V4 plan (15 phases). **The CLAUDE.md build-order section is ~2 months stale.**

### UU-13 — 87 skills on disk (via `ls skills/ | wc -l`)
Gabriel + various sessions variously cite "65+", "86", "87", "115 target". 87 is the current exact count. Engram #283 noted 11 skills lacked frontmatter (won't load); sessions 1-10 fixed those. Karpathy-principles was added session 5. A small number may still be stubs <1KB.

---

## Summary — what the current session should NOT trust without verification

1. Any pre-Apr-18 Engram claim about a module being "dead/orphaned/never-called" — ~60% of these were refuted by the Apr 18 ground-truth corrections (Engram #368).
2. The session-6 continuation prompt as a canonical plan — SUPERSEDED by the V4 plan (Engram #356).
3. `project_wotann_sprint78_progress.md` — its "59 commits" number is 180 commits stale (HEAD is 239).
4. Any commit message claiming "wired" or "runtime-verified" — quality bar 14 says verify by grep + test-invariant inspection.
5. MASTER_PLAN_SESSION_10.md's Bedrock/Vertex/FALLBACK/SOUL claims — contradicted by Apr 18 Engram ground-truth checks (#336, #338).

## Summary — what the current session SHOULD trust

1. The session transcripts 1-5 (authoritative, write-once, file-based)
2. Engram #356 (V4 plan), #368 (14 audit corrections), #370 (11 bugs closed), #375 (Phase 4 B1 shipped), #376 (latest final)
3. `docs/MASTER_SYNTHESIS_2026-04-18.md` (canonical, written post-compaction)
4. The 14 quality bars as codified in session transcripts 1-5 + this archaeology
5. HEAD commit messages when they describe file-level work (they're evidence-level, not claim-level)

## Summary — items the audit prompt should explicitly surface to the current session

1. **4 false-claim pattern**: session 4 lied about voice RPCs + MiniLM ranking. Session 5 caught it. Current session should adversarially audit Phase 4 Sprint B1/B2 claims (Engram #375, #376) since that's the most recent work.
2. **V4 plan supersedes §78**: if the current prompt says "Tier 1-5 competitor wins" it's working off an outdated plan.
3. **Zero-deletion rule** (Gabriel codified Apr 18): prefer wire-or-defer over delete.
4. **Supabase key still leaked**: manual action outstanding.
5. **10 competitor wins NOT shipped**: Agent Skills standard, Code Mode, full ACP compliance, credential pool, Monitor tool, Conductor undo UI surface, GenericAgent crystallization, Docker sandbox, Hooks `if` field, and 1-2 more per the session-6 prompt. These are the pre-June 2026 ship targets.
6. **SOUL.md regex** and **MASTER_PLAN_SESSION_10 item-by-item** are unresolved — needs a focused HEAD verification pass.
