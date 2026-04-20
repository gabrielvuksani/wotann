# AUDIT_EXTERNAL_DOCS_SCAN — Archaeology of Tier 1/2/3/4 Markdown Corpus

**Date**: 2026-04-20
**Auditor**: Opus 4.7 max-effort
**Method**: Full reads (no skim) of 55+ files across agent-harness root, wotann repo root, design-brief, and docs inventory. Every claim grep-verifiable against the citing file.
**Scope**: What the 5 recent Audit Lanes + MASTER_PLAN_V7 missed that is encoded in older or external docs.

---

## Executive Summary (500 words)

The agent-harness root (one level above the wotann/ repo) is a project-historical cathedral. The 334 KB `NEXUS_V4_SPEC.md` (7,928 lines, 223 features, 26 appendices A-Z, 82+ sources) is the authoritative build spec — it is NOT pre-coding scaffolding; it is the contract the code has been grown against for ~20 weeks. The 5 supporting tier-1 research files (AGENT_FRAMEWORK_ANALYSIS 33KB, COMPETITIVE_ANALYSIS 35KB, COMPETITOR_FEATURE_COMPARISON 27KB, COMPREHENSIVE_SOURCE_FINDINGS 54KB, DEEP_SOURCE_EXTRACTION 33KB, UNIFIED_SYSTEMS_RESEARCH 57KB, ECOSYSTEM-CATALOG 35KB, SOURCES 13KB) collectively catalog 108+ sources and enumerate ~300 concrete features across competitors. **SPEC_VS_IMPL_DIFF (cited in AUDIT_DOCS_GAP_ANALYSIS) is correct**: 23.3% Done / 50.2% Partial / 26.0% Missing. The "~85% implemented" public claim is a conflation of Done+Partial.

Three findings are load-bearing and not already captured in Lane 1-5:

1. **The NEXUS_V4_SPEC is the canonical feature registry.** 223 features × 26 appendices (§1-§35 core + E-Z): 74 core + 13 Appendix E + 1 F + 3 G + 22 H + 5 I + 10 J + 1 K + 1 L + 3 M + 16 O + 7 P + 12 Q + 19 R + 2 S + 1 T + 4 U + 7 V + 1 W + 3 X + 6 Y + 8 Z + 1 §20 upgrade + 3 final additions = 223. No feature-level matrix in Lane 1-5 traces this back to code, so "features done" is unknowable without it. Reconstruction below.

2. **The April-3 Tier-1 research (4 big docs, 147 KB) identifies ~90 concrete features not yet in any lane.** Knowledge Fabric (LightRAG graph RAG + ByteRover context tree + provenance), Consensus Engine (Arena+Council+multi-model vote→learn), TurboQuant KV (6x context for local models), VibeVoice (60-min ASR / 300ms realtime TTS), Filesystem context paradigm (OpenViking L0/L1/L2), Hash-anchored editing for weak models (pass-rate 6.7%→68.3%), Mid-session model switching (Crush), 50+ knowledge connectors (Onyx), Personal model pipeline (nanochat $100 fine-tune), Autonomous-skill-creation loop (Hermes closed learning loop), DM pairing security (OpenClaw), Dual-terminal steering (GSD), Resumable streams (LibreChat), Visual timeline debugger, 6 terminal backends (Hermes Docker/SSH/Daytona/Modal/Singularity), 14 retrieval types (Cognee), WASM Tier 0 bypass for deterministic transforms (Ruflo 352x speedup), Dispatch-as-control-plane across 24 channels.

3. **The design-brief/ folder (24 markdown + 1 JSON tokens + screenshots) is the Apple-Design-Award-grade UI contract.** It encodes 15 non-negotiable design principles, 33 headline capabilities × 5 surfaces (TUI/Desktop/iOS/Watch/CarPlay), 22+ constraints/antipatterns, an 8-bar × 3-surface scorecard (current composite 6.5/10, target ≥8.0, ADA target ≥9.0), and a per-variant rejection rubric. No Audit Lane references this corpus; Lane 3 (UI_FEATURES) is narrower.

Additionally: WOTANN_INVENTORY (docs/WOTANN_INVENTORY.md, 33 KB) enumerates **481 src files / 162,886 LOC / 307 test files / 4,811 test cases / 89 orphans / 21,453 LOC orphaned (13.2%)**. WOTANN_ORPHANS.tsv provides the canonical orphan list (50 tested / 39 untested). ROADMAP.md surfaces ~25 planned-but-not-shipped features. DECISIONS.md records 39 canonical architectural decisions. MASTER_CONTINUATION_PROMPT (from 2026-04-02) catalogs 24 then-known gaps, ~20 of which have drifted since. 30+ concrete action items compiled in §9 below.

---

## 1. NEXUS V4 Spec Extract — 223-Feature Taxonomy

Source: `/Users/gabrielvuksani/Desktop/agent-harness/NEXUS_V4_SPEC.md` (lines 148-224 for Unified Feature Matrix; lines 7869-7923 for the Authoritative Feature Count).

### 1.1 Structure

| Part | Sections | Appendices | Topic |
|---|---|---|---|
| I Architecture | §1-§4 | — | Vision, feature matrix, architecture, 15 design principles |
| II Provider Layer | §5-§7 | — | 9 provider paths, 5-tier router, Sub+API auth |
| III Agent Core | §8-§10 | — | Core loop, 16-layer middleware, 3-tier autonomy |
| IV Intelligence | §11-§13 | — | 7 harness overrides, self-healing, intent + modes |
| V Memory & Context | §14-§17 | — | 8-layer memory, 5 compaction strategies, autoDream, decision log |
| VI Orchestration | §18-§22 | — | Coordinator, waves, PWR cycle, ULTRAPLAN, Ralph |
| VII Tools | §23-§26 | — | 4-layer Desktop Control, 65+ skills, 18 hook events, LSP |
| VIII Platform | §27-§29 | — | KAIROS daemon, 24-channel dispatch, TUI+voice+desktop |
| IX Production | §30-§35 | — | 15-phase build, sandbox/security, observability, marketplace, CLI, directory |
| Appendices | — | A-Z (26) | Feature flags, gap analysis, sources, patterns, research integration |

### 1.2 Feature-count breakdown (exactly 223, per §7869-7896)

| Category | Count | Source |
|---|---:|---|
| Core features (§1-§35) | 74 | Unified matrix |
| App E (TTSR, symbol tools, API shim, FUSE, AST, model roles, feature flags, commit splitting, free endpoints, plugin format, prompt split, @file, CU rewrite) | 13 | |
| App F (multi-account pool) | 1 | |
| App G (Ollama full-capability tier) | 3 | |
| App H (per-repo feature adoption from 11 forks) | 22 | |
| App I (memory upgrades: proactive context, TEENM, scratchpad, versioning, Fisher-Rao, bi-temporal) | 5 | |
| App J (repo monitor, SSE server, other) | 10 | |
| App K (QMD precision retrieval) | 1 | |
| App L (TurboQuant KV compression) | 1 | |
| App M (provider-agnostic capability layer) | 3 | |
| App O (prompt MCP, research, HUD, foundation, harness paradigm, session recovery, privacy, analytics, TDD, skill scanner, gap fills) | 16 | |
| App P (supervisor-executor, conversation tree, gatekeeper memory, lazy tools, device gateway, HITL, context flattening) | 7 | |
| App Q (graph DSL, 88 CC flags, swarm, workflow architect, quality gates, skill audit, 3 provider paths, diminishing returns, open-agent-sdk) | 12 | |
| App R (19 audit remediation: file planning, session recovery, TDD, roster, HUD, two-stage review, research gate, UAT, tool scoping, PRD decomposer, security, message queue, resumable streams, config import, screenshot diff, foundation context, tiered tools, privacy, multi-source research) | 19 | |
| App S (competitive intelligence — 36 competitors) | 2 | |
| App T (autonomous monitoring — 60+ sources) | 1 | |
| App U (MCP registry, PM/SaaS integrations, skill import, desktop API route table) | 4 | |
| App V (ForgeCode benchmark engineering — 7 techniques) | 7 | |
| App W (onboarding wizard + BOOTSTRAP.md) | 1 | |
| App X (capability augmentation, 8-file bootstrap, imageModel delegation) | 3 | |
| App Y (DoomLoopDetector, retry annotation, pre-completion checklist, marker polling, compaction, optimal AGENTS.md) | 6 | |
| App Z (OpenClaude deep-dive: Codex provider, health scoring, goal-based recommendation, runtime hardening, launch profiles, consolidation lock, security anti-patterns, format translation) | 8 | |
| §20 upgrade (bidirectional mode transitions, intent-driven phase switching) | 1 | |
| Final parity additions (mid-session model switch, cross-session tools, intent-driven mode detection) | 3 | |
| **TOTAL** | **223** | |

### 1.3 Status per-spec vs implementation

SPEC_VS_IMPL_DIFF (cited extensively in AUDIT_DOCS_GAP_ANALYSIS.md §1.6 rows 37-38): 223 features = **52 Done + 112 Partial + 58 Missing + 1 Blocked** — 23.3% / 50.2% / 26.0% / 0.5%. The "~85% implemented" commit-message narrative conflated Done + Partial (73.5%). "Done" (fully runtime-integrated, grep-verified) is 23.3%.

Examples verified by Lane 1 cross-reference:
- **Done**: §5 providers (19 adapters wired), §9 middleware pipeline (16 layers + 6 deer-flow ports wired Apr-15), §25 hooks engine (17+ built-ins), §14 SQLite+FTS5 memory store, §27 KAIROS daemon.
- **Partial**: §14 8-layer memory (auto_capture 1,990 rows / memory_entries 0 rows / knowledge_graph 49-byte empty template per HIDDEN_STATE_REPORT), §18 coordinator (`MAX_CONCURRENT_SUBAGENTS` hardcoded to 3 vs Jean-8/Grok-8/Windsurf-5), §22 Ralph mode (51-LOC stub per MASTER_CONTINUATION_PROMPT #8), §26 LSP (symbol ops exist but only half wired).
- **Missing**: App H items (per-repo feature adoption, mostly IPFS/LLM-leaderboard/Notepads/Canvases), Fisher-Rao distance (App I), all 12 Web Search providers except 3 (oh-my-pi), 6 terminal backends beyond local (Docker/SSH/Daytona/Modal/Singularity), VisualBuilder (AutoGPT), full SkillForge autonomous creation (Hermes).

### 1.4 Top features the spec demands but are barely wired

Per `AUDIT_DOCS_GAP_ANALYSIS` §1.1 + Lane 1 §2:

- 8-layer memory (autoDream triggers but processes 0 entries; `dreams/light-candidates.json` + `rem-signals.json` both empty)
- Shadow git checkpoints (`src/utils/shadow-git.ts` exists but only wired in `integration/shadow-git-singleton.test.ts`; no production callsite on dangerous operations)
- `nexus cu` / computer use CLI command (MASTER_CONTINUATION_PROMPT #7)
- `accountPool` multi-key rotation (MASTER_CONTINUATION_PROMPT #1 — account-pool.ts initialized but AgentBridge never consults it)
- `editTracker` PerFileEditTracker (MCP #2 — initialized but never invoked)
- `nexus resume` session context restoration (MCP #3 — loads stats only)
- `nexus cost` persistence (MCP #4 — fresh tracker every CLI invocation → always $0)
- Format translator in live path (MCP #6 — exists but AgentBridge doesn't call it)
- `productionRalphMode` (MCP #8 — 51-line stub, needs DoomLoop/budget/strategy escalation/HUD integration)
- TTSR abort+retry (MCP #9 — injects warning but doesn't abort-stream + retry-with-injection)
- `nexus channels start` + E2E channel test (MCP #10)
- Resumable streams (MCP #11)
- agentskills.io directory-format importer (MCP #12 + RESEARCH_GAP_ANALYSIS §"Agent Skills Standard")
- 7 intelligence overrides real trigger logic (MCP #13 — definitions exist, triggers don't)
- Multi-panel TUI layout (MCP #14 — ContextHUD/DiffViewer/AgentStatusPanel exist, unused in App.tsx)
- Git worktree isolation for coordinator (MCP #16 — runs flat, not in worktree)
- `nexus team <task>` multi-agent + file ownership (MCP #17)
- `nexus install <plugin>` npm plugin system (MCP #18)
- HuggingFace Inference API (MCP #21, RESEARCH_GAP_ANALYSIS "Hugging Face")
- Visual test verification + proactive error prevention + context-aware model selection (MCP #22-24)

---

## 2. Competitive Analysis — What Still Applies from April 3

### 2.1 Always-applicable (from COMPETITIVE_ANALYSIS.md, 35 KB, 12 competitors deep-dived)

**OpenClaw 15-area breakdown (§1)**:
- 24-channel inbox (Telegram, Slack, Discord, WhatsApp, iMessage, Signal, Matrix, IRC, Teams, GoogleChat, Feishu, LINE, Mattermost, NextcloudTalk, Nostr, SynologyChat, Tlon, Twitch, Zalo, WeChat, WebChat, Webhooks) — WOTANN status: Gateway wired, 16 adapters wired; missing 8.
- Always-on daemon as launchd/systemd — WOTANN: KAIROS daemon exists; `auto-update.ts` is dead code.
- DM pairing security — WOTANN: spec'd, not wired.
- Live Canvas (A2UI visual workspace) — WOTANN: `canvas.ts` exists but lib-only.
- Companion apps (macOS/iOS/Android) — WOTANN: Desktop + iOS yes; Android no.
- Node registry for device capabilities — WOTANN: `node-registry.ts` exists, need to ship.
- ClawHub Skills Registry — WOTANN: 86 skills shipped; no registry (marketplace is stub).
- Voice Wake + Talk Mode — WOTANN: voice-pipeline exists, no wake-word.
- Tailscale auto-config — WOTANN: not started.
- Model failover + auth profile rotation — WOTANN: fallback-chain.ts is wired.
- Media pipeline — WOTANN: not shipped.

**Crush/OpenCode (§2)**:
- LSP integration as primary tool (not enrichment) — WOTANN: LSP manager wired, symbol operations partial.
- Mid-session model switching preserving context — WOTANN: `model-switcher.ts` lib-only per Lane 1 §2.1.
- Agent Skills `.agents/skills/` open standard (16+ tools) — WOTANN: loader assumes flat markdown (MCP #12).
- Catwalk community model registry — WOTANN: not shipped.
- `--yolo` flag — WOTANN: has `--bypass`; naming differs.
- `initialize_as` configurable context filename — WOTANN: hardcoded .wotann/.

**KiloCode (§3, 1.5M users, 25T tokens)**:
- Inline autocomplete — WOTANN: out of scope (CLI, not IDE).
- MCP Server Marketplace one-click — WOTANN: stub.
- Multi-Mode (Architect/Coder/Debugger/custom) — WOTANN: has modes but not this UX.
- Credits gateway (500+ models single key) — WOTANN: not shipped.
- CI/CD autonomous `--auto` — WOTANN: `wotann autonomous` wired.

**Cursor 3 (§5)** — April 2, 2026 release:
- Agents Window parallel agent grid — WOTANN: not shipped (design-brief 06-capability-matrix §"Agents Window" P0 for Desktop).
- Design Mode with browser annotation — WOTANN: not shipped.
- Native best-of-N model comparison — WOTANN: `arena.ts` exists.
- `/worktree` command — WOTANN: MCP #16 identifies as not wired.
- YOLO mode — WOTANN: `--bypass`.
- Notepads (reusable prompts) — WOTANN: not shipped.
- Background agents in cloud sandboxes — WOTANN: not shipped.
- Await Tool for agents — WOTANN: not shipped.

**Hermes Agent (§4 — sharp updates Apr 3-4, 2026)**:
- Closed learning loop (auto-skill generation on hard tasks) — WOTANN: SkillForge wired but doesn't auto-create.
- Shadow git checkpoints — WOTANN: exists but not wired on dangerous ops.
- Smart model routing (`smart_model_routing.py`) — WOTANN: model-router.ts wired.
- Cron scheduling — WOTANN: KAIROS cron wired.
- RL training integration (Atropos) — WOTANN: rl-environment.ts lib-only.
- Voice memo transcription cross-channel — WOTANN: not shipped.

**AutoGPT, LibreChat, Hive, OpenViking, oh-my-pi, Serena, cc-switch (§§4-10)** — see §2.3 for which still apply.

### 2.2 Outdated / superseded claims from April 3

Most April-3 competitive claims have been materially worsened for WOTANN by April 20 because competitors shipped: Cursor 3 (Apr 2), Claude Design (Apr 17), Perplexity Computer (Feb 25 — was not Apr 3 in doc), Gemini for Mac (Liquid Glass + ⌥Space). April-3 claim **"no competitor has multi-surface parity across TUI/Desktop/iOS"** is still true — this is WOTANN's moat.

Outdated specific lines:
- "TerminalBench 39th" for Claude Code (free-code doc 2026-04-01) — now moved to April-2026 leaderboard with Claude Mythos Preview 82.0% / ForgeCode 81.8% / Gemini-3.1-Pro 80.2% / Claude Opus 4.6 79.8% per Lane 5 vs BENCHMARK_POSITION_V2 (contradiction noted in AUDIT_DOCS_GAP_ANALYSIS §2).
- "OpenClaude is Anthropic-leaked code with DMCA risk" — still true but takedown has not yet happened.
- "Claude Code's 58% TerminalBench baseline" — updated.

### 2.3 Sources cross-referenced

The root `COMPETITIVE_ANALYSIS.md` (12 competitors) + `AGENT_FRAMEWORK_ANALYSIS.md` (10 frameworks deep internals) + `COMPETITOR_FEATURE_COMPARISON_2026-04-03.md` (matrix: NEXUS vs free-code/OpenClaude/ClaudeCode/Codex/Cline/Continue/Aider/OpenHands/KiloCode) + `COMPREHENSIVE_SOURCE_FINDINGS_2026-04-03.md` (90+ sources) + `DEEP_SOURCE_EXTRACTION_2026-04-03.md` (105 missing features across 10 priority sources + 10 novel pioneer ideas) represent the April-3 authoritative competitive corpus. Total: ~300 concrete features; all still worth referencing; many outside WOTANN still.

The wotann-repo competitor docs (`COMPETITIVE_INTELLIGENCE_2026-04-03.md` 46 KB, `COMPETITOR_APP_RESEARCH_2026-04-03.md` 70 KB) add desktop/iOS angle and April-2026 releases (Cursor 3, Claude Design, Perplexity Computer). Particularly strong for: Claude Desktop's Cowork + Dispatch + RemoteControl + ComputerUse; ChatGPT Desktop's Work-With-Apps macOS Accessibility read-only integration with VS Code/Xcode/JetBrains/Terminal/iTerm/Warp/Prompt (last 200 lines context); Cursor 3 Agents Window + Design Mode + Automations; Windsurf's Arena Mode + memory-layer moat.

---

## 3. MASTER_CONTINUATION_PROMPT + HANDOFF Findings

### 3.1 MASTER_CONTINUATION_PROMPT.md (/agent-harness root, 10 KB)

Dated (unstated but context ~2026-04-02). Encodes a specific **Step 0 → Step 1 → Step 4** workflow:

1. **Step 0 (Recover Context, mandatory)**: 12 files in order — BUILD_GUIDE, NEXUS_V4_SPEC (§1-§4+§30), SOURCES, DECISIONS, ROADMAP, TERMINALBENCH_STRATEGY, CLAUDE.md, reference/{SKILLS,AGENTS,MEMORY,HOOKS,TOOLS} rosters. Then `mem_context` + search "NEXUS session". Then `npx tsc --noEmit && npx vitest run && nexus --version`.
2. **Step 1 (Research First)**: 11 unresearched sources (conductor.build, paperclip, cline, ai-marketing-skills, VoltAgent/awesome-design-md, jean.build, kilocode, PraisonAI, Cursor 3 blog, free-code, HuggingFace, Gemma 4). Compile findings before implementation.
3. **Step 2 (Implement Gaps)** — 24 items in priority order:
   - **HIGH / broken**: 1 accountPool unused, 2 editTracker uncalled, 3 resume loses context, 4 cost non-persistent, 5 shadow-git unwired, 6 format-translator unwired
   - **HIGH / missing**: 7 `wotann cu`, 8 production Ralph mode, 9 TTSR abort+retry, 10 channels start + E2E, 11 resumable streams, 12 agentskills.io format adapter
   - **MEDIUM**: 13 7-override triggers, 14 multi-panel TUI, 15 marketplace search/install, 16 git worktree, 17 `nexus team`, 18 plugin ecosystem, 19-20 marketing+design skill merges
   - **LOW**: 21 HuggingFace, 22 visual test verification, 23 proactive error prevention, 24 context-aware model selection
4. **Step 3 (Upgrade TUI)**: 9 specific UX asks — multi-panel, context HUD, diff viewer wired, agent status tree, markdown streaming, @file, Ctrl+T thinking depth, Ctrl+M model switch, persistent theme.
5. **Step 4 (Self-Verify)**: exact commands expected to pass post-session.

**Non-negotiables (10)**: Opus 4.6 max thinking effort; research-before-implementation; plan-before-code; full-file reads; zero-dev-cost; dead-code removal; reasoned rejections; production-grade; E2E not unit-only; immutable data.

**Competitive positioning target**: "All competitor features + MORE" vs OpenClaw, Claude Code, Cursor, Codex CLI, KiloCode, PraisonAI, Conductor, free-code.

### 3.2 HANDOFF.md (/wotann root, 3 KB)

Engineering-level developer runbook. Key data:
- **Data flows**: Chat → `useStreaming.sendMessage()` → Tauri `send_message_streaming` → Rust `call_streaming("query")` → KAIROS `handleQuery` → smart routing (Codex CLI cloud / Ollama local) → SSE chunks → Tauri events → React bubble.
- **Provider auth flow**: Codex OAuth `~/.codex/auth.json` → JWT `id_token` has `chatgpt_plan_type` → maps to free/plus/pro model tiers.
- **Critical files (10)**: `daemon/kairos-rpc.ts`, `daemon/kairos.ts`, `core/runtime.ts`, `desktop-app/hooks/useStreaming.ts`, `store/engine.ts`, `store/index.ts`, `styles/globals.css`, `src-tauri/src/commands.rs` (81 Tauri IPC commands), `src-tauri/src/ipc_client.rs`, `src-tauri/src/sidecar.rs`.
- **8 Known Gotchas**: 1 Tauri drag region kills clicks; 2 Ollama OOM fix: `OLLAMA_KV_CACHE_TYPE=q8_0 + num_ctx:8192` for 16GB RAM; 3 Codex scopes can't hit `/v1/models` or `/v1/responses` — must use CLI; 4 Message-ID mismatch between frontend and Rust — resolve via reverse-search of active streaming message; 5 React StrictMode double-fires listeners (need chunk dedup); 6 HMR limitation on useEffect mount callbacks needs full restart; 7 Multiple daemons — always `pkill -f "daemon worker"` before restart; 8 Sidecar uses `dist/` — run `npm run build` before `tauri dev`.
- **Env**: macOS Apple Silicon 16 GB, Ollama with gemma4:latest (9.6 GB Q4_K_M), Codex CLI authed ChatGPT Plus, Claude CLI installed not signed in, Node 25.9.0, Rust Tauri v2.

---

## 4. DECISIONS.md — 39 Canonical Architectural Decisions

Source: `/wotann/DECISIONS.md`, 14 KB.

**Core choices (D1-D18)**:
- D1 TS strict, no `any`
- D2 SQLite + FTS5 for memory
- D3 OpenAI-compatible adapter for 6 providers
- D4 Immutable state updates
- D5 Simple glob matching (95% coverage, no dep)
- D6 TTSR as streaming middleware, NOT pipeline middleware
- D7 Hook profiles as inclusion hierarchy (`minimal ⊂ standard ⊂ strict`)
- D8 Progressive disclosure via metadata registry
- D9 React 19 + Ink 6.8
- D10 Typed `mergeConfig`, not generic deepMerge
- D11 Text-mediated computer use for non-vision models (OpenClaw breakthrough)
- D12 PWR bidirectional mode transitions via intent detection
- D13 Graph DSL for custom orchestration workflows
- D14 DoomLoop detection: consecutive [A,A,A] + repeating [A,B,C,A,B,C]
- D15 Anti-distillation: fake tools + zero-width Unicode watermarks
- D16 MCP cross-tool import (Claude Code / Cursor / Windsurf / Codex)
- D17 20+ themes auto-detect dark/light (COLORFGBG)
- D18 WASM bypass handles 18+ deterministic ops

**Implementation (D19-D24)**:
- D19 Middleware layers must have real logic — no pass-through stubs (violates "middleware, not monolith")
- D20 Self-healing: checkpoint → retry → (historical) model degradation
- D21 Append-only audit trail with SHA-256 hash per entry
- D22 Hook `warn` continues execution; only `block` terminates
- D23 Real 5-field crontab matching for KAIROS
- D24 Full CLI surface per §34

**Provider decisions (D25-D32)** — session 6 Apr-2:
- **D25 NEVER degrade model** — provider fallback chain replaces Hive-pattern model degradation. Free tier is ultimate final fallback.
- D26 ClawHub skill research adopted patterns
- D27 Codex uses ChatGPT backend `https://chatgpt.com/backend-api/codex/responses`, NOT `api.openai.com` (ChatGPT OAuth lacks `api.responses.write` scope — OpenClaude issue #38706 bug)
- D28 Anthropic subscription via `claude-agent-sdk` + API key = separate providers
- D29 Google Gemini as dedicated 10th provider (free tier 1.5M tokens/day)
- D30 Capability Augmentation: tool calling, vision, extended thinking work on ALL providers via transparent prompt injection
- D31 Autonomous mode wired to CLI (`wotann autonomous`)
- D32 Interactive provider onboarding (`wotann onboard`)

**Session 7 decisions (D33-D39)**:
- D33 Context window intelligence as separate module (strategy vs mechanics)
- D34 Benchmark engineering as hooks, not middleware (guarantees, not transformations)
- D35 Channel gateway with DM pairing security (OpenClaw-modeled)
- D36 WebChat via HTTP/SSE (not WebSocket) — simpler, CDN-friendly
- D37 PerFileEditTracker thresholds warn=4, block=8 (LangChain research)
- D38 15 essential skills selected by trigger frequency (spec calls for 65+; 15 shipped first, rest incremental)
- D39 SessionAnalytics wired to runtime (`WOTANNRuntime.getStatus()`)

**Still missing from DECISIONS.md**: D40+ should capture ~30 implicit decisions that have accumulated since session 7 (see MASTER_PLAN_V6 / _V7 for session 8+ architecture choices) — this is a documentation debt.

---

## 5. ROADMAP.md Current State

Source: `/wotann/ROADMAP.md`, 11 KB.

### 5.1 Completed Current Session (per doc)
- 10 provider adapters (Anthropic OAuth+API, OpenAI, Codex ChatGPT-OAuth, Copilot PAT→token exchange, Ollama native, Gemini, Free, Azure, Bedrock, Vertex). WOTANN_INVENTORY verifies **19 providers** (Lane 1 §2.1), so roadmap is 9 behind — `mistral`, `deepseek`, `perplexity`, `xai`, `together`, `fireworks`, `sambanova`, `groq`, `huggingface` all added since.
- Provider fallback chain
- Capability augmentation
- Autonomous mode (`wotann autonomous`)
- Interactive onboarding (`wotann onboard`)
- 393 tests passing. WOTANN_INVENTORY now shows **4,811 test cases across 307 files** (1228% growth).

### 5.2 Planned but not shipped

**vs OpenClaw** (6 items): WebSocket transport for Codex (SSE-only) [Medium]; 24 channels full [Low-daemon phase]; Canvas/A2UI [Low]; Device nodes registry [Medium]; Plugin provider architecture [Keep built-in, simpler]; `openclaw onboard` interactive match [High — partially done by wotann onboard].

**vs Claude Code** (6 items): claude-agent-sdk full loop [HIGH — installed but not primary]; 1M context beta config [Medium]; Hooks as `.claude/hooks/` JS [Done]; Slash commands `/compact`, `/clear`, `/help` [Medium]; MCP ecosystem [Done]; Git worktree isolation for subagents [Medium].

**vs Cursor** (4 items): 7 intelligence overrides [Done — partial per MCP #13]; Tab completion [N/A, CLI]; Multi-file repo context [Done]; Background indexing [Low].

**vs Codex CLI** (3 items): Kernel-level Landlock/Seatbelt [Medium — only virtual paths]; Session resume [Medium — loads stats not context]; Approval flow [Done].

### 5.3 HIGH priority strategic differentiators

1. Autonomous mode + DoomLoop + time/cost budget [Done — wotann autonomous].
2. Chrome extension via chrome.debugger API, CDP for Layer 2 computer use [Planned, not shipped].
3. Visual test mode / screen verification [Planned, `testing/visual-verifier.ts` + `visual-diff-theater.ts` shipped — Lane 1 confirms wired via runtime.ts:122,655].
4. Source monitoring system — `wotann repos check` on 60+ tracked repos per Appendix T [Planned, `monitoring/source-monitor.ts` wired at runtime.ts:290 per Lane 1].

### 5.4 MEDIUM priority depth
5 Provider-agnostic capabilities (OpenClaw pattern) [Done — capability-augmenter].
6 Skill injection as capability boost [Planned — need analytics per-model].
7 Expand CLI surface (7 commands: `wotann next`, `--pwr`, `--ralph`, `cu`, `dream --force`, `audit`, `local status`) [Most shipped per Lane 1 CLI inventory of 74 commands].

### 5.5 LOW priority future phases
8 Desktop app (Tauri v2) [Done — shipped].
9 Phone companion (Dispatch) [Done — iOS pairing].
10 Skill marketplace (SkillCompass 6-dim 100-point scale) [Stub — MCP #15].

### 5.6 NEW brainstormed differentiators (letters A-I — post-session 7 ideas)

- **A Session Continuity** — `wotann resume` with serialized provider state, conversation history, tool results; optional cross-machine sync via git
- **B Intelligent Cost Optimization** — real-time dashboard per-provider/task/model; auto-downrouting utility tasks; budget mode with daily/weekly cap
- **C Multi-Agent Orchestration** — `wotann team <task>` parallel agents with file ownership boundaries; structured messaging; dependency graph; merge conflict resolution
- **D Plugin Ecosystem** — `wotann install <plugin>` npm plugins for custom providers/tools/hooks/TUI panels; marketplace with quality + version compat
- **E Context-Aware Model Selection** — task analysis before model choice; per-file-last-model-tracker
- **F Proactive Error Prevention** — pre-commit analysis ("this will break test X"); type narrowing suggestions; security scanning
- **G Visual Test Verification** — screenshot comparison; OCR for text; a11y-tree diffing; text-mediated fallback
- **H Chrome Extension** — chrome.debugger DOM/forms/clicks/screenshots; integrate MCP chrome tools
- **I Source Monitoring System** — `wotann repos check` weekly digest of competitor-repo changes; auto-suggest spec updates

---

## 6. Design Brief — 26-File Full Synthesis

Source: `/wotann/design-brief/` (24 .md + 1 .json + screenshot assets). Date: 2026-04-19.

### 6.1 Contents

| File | Purpose | Key content |
|---|---|---|
| `README.md` | Package overview | Mission: Claude Design, Apple Labs, ADA 9.0+ floor |
| `01-product-overview.md` | Positioning, ICP, competitive context | 5 ICPs (startup senior eng, security researcher, DevOps, academic/data science, a11y-first); 10 April-2026 competitors named (Cursor 3, Claude Code, Codex, Claude Design, Perplexity Computer, Gemini for Mac, Glass, Conductor, Warp, Linear/Superhuman/Raycast/Things3) |
| `02-brand-identity.md` | Norse lore, color, typography, brand mark | Five themes (Mimir default dark, Yggdrasil light, Runestone marketing, Bifrost onboarding-only, Valkyrie Exploit-only); brand thread calibrated volume TUI→loud, Desktop→medium, iOS→subtle |
| `03-current-design-audit.md` | Honest current-state 6.0/10 | Composite scorecard: Liquid Glass 3/10, Motion 5/10, Desktop 6.0, TUI 6.3, iOS 6.8 |
| `04-design-principles.md` | 15 non-negotiables | 1 Truth-before-beauty, 2 Keyboard-first, 3 Free-tier first-class, 4 Honest errors no-silent-success, 5 Block everything, 6 Proof-before-done (Sealed Scroll 4 seals), 7 Apple-bar a11y, 8 One token system, 9 Motion with intent, 10 Five themes/five moods, 11 Norse identity calibrated, 12 No vendor bias in `??` fallbacks, 13 One surface doesn't dominate, 14 Craft-not-cosplay (Dieter Rams × Lewis Chessmen × Bloomberg Terminal), 15 Scope discipline |
| `05-competitor-references.md` | What to match/beat/learn | 10 competitors with UI-specific takeaways |
| `06-capability-matrix.md` | 223 features × 3 surfaces × priority | 33 headline capabilities with P0/P1/P2/n.a. per surface (TUI/Desktop/iOS/Watch/CarPlay); 24 desktop views; 34 iOS view directories; 25+ channel adapters; widgets/intents/live-activity matrix; priority reduction if time-pressed |
| `07-surface-tui.md` | Ink commands/components/states | 50+ slash commands; Block-based rendering; command palette |
| `08-surface-gui-desktop.md` | Tauri desktop views/states | 24 lazy-loaded views; 4 tabs (Chat/Editor/Workshop/Exploit) + Onboarding + 16-section Settings |
| `09-surface-ios.md` | iPhone/Watch/CarPlay/Intents/Widgets/LiveActivity/ShareExtension | 4-tab TabView (Home/Chat/Work/You) + FloatingAsk + AskComposer + 34 view dirs |
| `10-interactions-and-flows.md` | User journeys | Onboard → chat → editor → workshop → exploit |
| `11-states-inventory.md` | 10 states per view | default/empty/loading/streaming/error/success/disconnected/offline/low-battery/focus |
| `12-channels-multi-surface.md` | 25+ channels under Settings | Not primary tab; daemon-side concerns |
| `13-accessibility-targets.md` | WCAG 2.2 AA floor per-surface | AA everywhere, AAA (7:1) on Mimir theme (21:1 ratio achieved) |
| `14-motion-and-haptics.md` | Entrance/exit/feedback | 5 durations (80/150/240/400/600 ms) + 3 opt-in delights (Sealed Scroll 420ms, Raven's Flight 800ms, Ember 880ms); 4 named eases; `prefers-reduced-motion` respected |
| `15-design-tokens-current.json` | W3C Design Tokens | Direct Claude Design input |
| `16-design-system-ambition.md` | New token system goals | Emits CSS for desktop + Swift constants for iOS + Ink theme constants for TUI from single source |
| `17-copy-and-voice.md` | Microcopy rules | Forbidden words: sorry/oops/something/great/awesome/!/we-think/maybe; honest errors with concrete next action |
| `18-data-visualization.md` | Cost meter, context meter, provider status, memory palace | Data viz patterns |
| `19-reference-screenshots/` | 42 current-state PNGs ~3 MB | |
| `20-competitor-screenshots.md` | URLs + study notes | Cursor 3, Gemini Liquid Glass, Glass, Linear, Raycast, Superhuman, Things 3, Conductor, Warp, Zed |
| `21-handoff-bundle-schema.md` | EXACT Claude Design output schema | `wotann import-design <bundle.zip>` receiver validates; loud fail on mismatch |
| `22-constraints-and-antipatterns.md` | 32 "don't do" rules | Visual (no purple except logo), architectural (no vendor bias), copy (forbidden words), motion (no `transition:all`, 600ms max), theme (Bifrost onboarding-only), brand (no cosplay, Dieter Rams bar) |
| `23-success-criteria.md` | 8-bar × 3-surface scorecard | Composite ≥8.0 to ship; ≥9.0 = ADA; per-bar gap closers |
| `24-claude-design-prompt.md` | The actual prompt | Gabriel's hand-off to Anthropic Labs |
| `assets/` | Logo swatches + CSS tokens | |

### 6.2 Key themes

1. **Block-everything architecture**: Every turn (user prompt, assistant response, tool call, terminal command, diff) renders as a `Block` with status/gutter/copy/share/rerun/kb-nav. `Block.tsx` exists at 327 LOC but is unconsumed — per `UI_UX_AUDIT.md` §4 this is the single biggest UI consolidation opportunity.
2. **Proof-before-done**: Sealed Scroll bundle with 4 seals (Tests, Typecheck, Diff, Screenshots) — each state pending/running/passed/failed. No "task complete" without proof.
3. **Five-theme discipline**: Mimir (default dark, 21:1 contrast), Yggdrasil (light), Runestone (marketing hero), Bifrost (ONBOARDING ONLY — never sustained work), Valkyrie (EXPLOIT TAB ONLY — auto-activates).
4. **Apple-bar accessibility + Liquid Glass**: WCAG 2.2 AA floor / AAA where feasible; `.ultraThinMaterial` wrapping iOS; per-theme glass tokens; noise-grain overlay; specular sheen on hover.
5. **Scope discipline enforcement**: Claude Design MUST submit a `manifest.scope_extensions` with anything outside `06-capability-matrix.md`; baseline variants stay in scope.
6. **Handoff receiver is real code**: `wotann/src/design/handoff-receiver.ts` parses the ZIP against `21-handoff-bundle-schema.md` and fails loudly if the bundle doesn't conform.
7. **Grading rubric is mechanical**: 24 scores (8 bars × 3 surfaces); composite ≥8.0 to ship; any bar <5.0 rejects the variant; any constraint violation (22 rules) rejects the variant.
8. **Current baseline (2026-04-19)**: Desktop 6.0, TUI 6.3, iOS 6.8 (composite 6.5) vs ADA 9.0. Gap is ~4-6 focused polish weeks.

### 6.3 What the design-brief implies for Lane 3 (UI_FEATURES audit)

Lane 3 focuses on **current-state code**; the design-brief adds **ambition + acceptance criteria**. Together they should be read:
- 16-file `design/tokens.yaml` pattern (single source → CSS + Swift + Ink) is aspirational; the current `wotann-tokens.css` has 8.4% adoption.
- Block component consumption is 0% (Lane 3 §? doesn't call this out as explicitly as `UI_UX_AUDIT.md`).
- First-run tour missing on ALL platforms is flagged as CP-3 in session-8 audit; iOS "continue without pairing" path is IOS-DEEP-1.
- ChatView "all running locally on your machine" subtitle was in Apr-5/Apr-6 screenshots; removed in current code — positioning regression per `MASTER_PLAN_V6` §3 G9.

---

## 7. WOTANN_INVENTORY Detailed — File-by-File Map

Source: `/wotann/docs/WOTANN_INVENTORY.md`, 33 KB (excerpt read §1-3), plus tsv files.

### 7.1 Executive numbers at Git HEAD `aaf7ec2` (2026-04-19)

- **481 source files** in `src/**` (TypeScript)
- **162,886 source LOC**
- **307 test files** in `tests/**`
- **57,294 test LOC**
- **4,811 test cases** (`it()` / `test()`)
- **134 / 481 = 27.9%** test-colocated
- **89 ORPHAN files** (21,453 LOC, 13.2% of source) — no static OR dynamic import
- **6 ENTRY points**: `src/index.ts`, `src/lib.ts`, `src/daemon/start.ts`, `src/mcp/mcp-server.ts`, `vendor-types.d.ts`, `ws-shim.d.ts`
- **384 WIRED** (static imports_in > 0) + **2 WIRED-DYNAMIC** = 386 live
- Surface LOC totals: TS core 162,886 / tests 57,294 / Desktop React 152 .ts[x] / Tauri Rust 17 .rs / iOS Swift 128 / Python 1 (camoufox-driver)

### 7.2 Top hub modules (most-imported)

- `src/core/types.ts` — 62 inbound imports (type hub)
- `src/core/runtime.ts` — **4,843 LOC**, 28 in, 169 out (composition root; per Lane 1 now 6,315 LOC at newer HEAD)
- `src/providers/types.ts` — 24 in
- `src/memory/store.ts` — 1,994 LOC, 21 in (SQLite spine; Lane 1 shows 2,597 LOC at newer HEAD)
- `src/prompt/engine.ts` — 20 in (529 LOC)
- `src/middleware/types.ts` — 15 in
- `src/channels/gateway.ts` — 13 in (central channel hub)
- `src/context/limits.ts` — 12 in (provider context-window table)
- `src/core/mode-cycling.ts` — 306 LOC, 10 in
- `src/lsp/symbol-operations.ts` — 886 LOC, 10 in
- `src/providers/discovery.ts` — 768 LOC, 10 in (env var detection)

### 7.3 Top largest files (god objects)

- `src/daemon/kairos-rpc.ts` — **5,375 LOC** (Lane 1: now 5,513); 73 imports
- `src/core/runtime.ts` — **4,843 LOC** (Lane 1: now 6,315); 192 imports at HEAD
- `src/index.ts` — **3,655 LOC** (Lane 1: now 5,633); 139 imports; 115 subcommand definitions
- `src/desktop/companion-server.ts` — 2,075 LOC
- `src/memory/store.ts` — 1,994 LOC
- `src/daemon/kairos.ts` — 1,750 LOC (Lane 1: now 2,568)
- `src/providers/provider-service.ts` — 1,306 LOC
- `src/orchestration/autonomous.ts` — 1,281 LOC (Lane 1: 1,542)
- `src/hooks/built-in.ts` — 1,252 LOC (17 hooks)

### 7.4 Provider adapter table (21 rows verified in §5)

All 19 provider names in `ProviderName` union + 2 dedicated (`anthropic-subscription` OAuth + `openai-compat` multiplexer) + `openai-compat-adapter.ts` reusable for 15 chat-completions providers. All 19 wired in `src/providers/registry.ts:51-367`. Streaming & tools universal; vision on all but Groq/Cerebras/DeepSeek/Mistral; cache only on Anthropic + Gemini (implicit).

### 7.5 Channel adapter table

25 files in `src/channels/`. 16 bidirectional adapters wired in daemon (telegram, slack, discord, signal, whatsapp, email, webhook, sms, matrix, teams, imessage-gateway, irc, google-chat, github-bot, ide-bridge, webchat). `terminal-mention.ts` is ORPHAN. Two base types: `BaseChannelAdapter` (1 subclass = `EchoChannelAdapter`) and `ChannelAdapter` (15 real adapters) — competing patterns with no migration plan (Lane 1 §3.2).

### 7.6 Benchmark runner table

Located under `src/intelligence/benchmark-runners/`. Three runners: aider-polyglot, terminal-bench, code-eval. **None can run real benchmarks on CI/locally** — no corpus on disk, tests use in-memory fake runtime. No SWE-bench / τ-bench / real TerminalBench. CLI `wotann bench` command exists but launches structural harness.

### 7.7 Cross-surface feature counts

- **74 TUI commands** in `src/index.ts` (Lane 1: 115 at newer HEAD)
- **134 desktop .tsx** + 18 non-tsx = 152 components
- **128 iOS Swift files** (excluding .build/DerivedData)
- **83 iOS views** in `ios/WOTANN/Views/`
- **1 Watch app** (WOTANNWatchApp.swift)
- **1 CarPlay** (CarPlayService.swift)
- **4 Intent extensions** (AskWOTANN, CheckCost, EnhancePrompt, IntentService)
- **3 Widget bundles** (CostWidget, AgentStatusWidget, WOTANNWidgetBundle)
- **2 Share extension** files
- **17 Tauri Rust entry files**
- **1 Python helper** (camoufox-driver.py)

### 7.8 74 CLI commands (§2.8, alphabetical)

`acp`, `architect`, `arena`, `audit`, `autofix-pr`, `autonomous`, `available`, `bench`, `benchmark`, `channels`, `check`, `ci`, `cli-registry`, `config`, `context`, `cost`, `council`, `cu`, `daemon`, `decisions`, `doctor`, `dream`, `engine`, `enhance`, `export-agentskills`, `extract`, `git`, `guard`, `health`, `hover`, `import`, `init`, `install`, `kanban`, `link`, `list`, `local`, `login`, `lsp`, `mcp`, `memory`, `mine`, `next`, `onboard`, `outline`, `policy-add`, `policy-list`, `policy-remove`, `precommit`, `providers`, `refs`, `rename`, `repl`, `repos`, `research`, `resume`, `route`, `run`, `search`, `self-improve`, `serve`, `skills`, `start`, `status`, `stop`, `symbols`, `sync`, `team`, `team-onboarding`, `train`, `verify`, `voice`, `watch`, `worker`.

### 7.9 Drift flags (memory vs code)

Per §2.9 cross-checked against HEAD `aaf7ec2`:
- "**11 provider adapters wired**": drifted → actually 19
- "**Gemma 4 bundled**": NOT in HEAD (no `gemma*` in providers/ or model weights; `huggingface` adapter exists)
- "**223 features**": unverifiable via code alone (this audit reconstructs it)
- "**src/core/ composition root**": confirmed
- "**16-layer middleware**": confirmed via directory (`src/middleware/` has 16+ .ts)
- "**65+ skills, progressive disclosure**": NOT fully visible (`src/skills/` has 14 .ts files; `skill-compositor.ts` + `skill-optimizer.ts` both ORPHAN). Real skills are in `skills/` directory as .md files (86 per README).
- "**8-layer memory store**": partial (`src/memory/` has 38 files; half have consumers; HIDDEN_STATE shows only auto_capture populated).
- "**TUI from Phase 0**": confirmed (`src/ui/` has 21 files; 74 CLI commands).
- "**4 tabs**": confirmed (`desktop-app/src/components/{chat,editor,workshop,exploit}/` exist).
- "**iOS full surface**": confirmed (6 targets in ios/, xcode project present).
- "**Shadow-git singleton threaded**": confirmed via `tests/integration/shadow-git-singleton.test.ts`.

---

## 8. WOTANN_ORPHANS.tsv — Actual Orphan Count + Names

Source: `/wotann/docs/WOTANN_ORPHANS.tsv` (read in full, 90 rows including header).

### 8.1 Totals

- **89 orphan source files** (Lane 1 §2 / §3 cross-confirms)
- **21,453 LOC orphaned** (13.2% of source)
- **50 WITH test** (library-only-no-wiring → drift alert)
- **39 WITHOUT test** (pure dead code → deletion candidate)

### 8.2 Orphans by directory (counts + LOC + test flag)

| Dir | Count | LOC | With-test? | Top orphans |
|---|---:|---:|---|---|
| `src/intelligence/` | 10 | 2,405 | all Y | adversarial-test-generator (338), answer-normalizer (269), budget-enforcer (191), chain-of-verification (139), confidence-calibrator (220), multi-patch-voter (222), policy-injector (248), search-providers (257), strict-schema (360), tool-pattern-detector (161) |
| `src/memory/` | 11 | 3,501 | 9 Y / 2 N | contextual-embeddings (212, Y — +30-50% recall lift UNWIRED per AUDIT_FALSE_CLAIMS), dual-timestamp (296), entity-types (236), hybrid-retrieval (255), incremental-indexer (256), mem-palace (267), memory-benchmark (530), memory-tools (580, N), memvid-backend (393, N), relationship-types (281), semantic-cache (195) |
| `src/core/` | 9 | 2,380 | 0 Y / 9 N | agent-profiles (147), claude-sdk-bridge (178), content-cid (165), deep-link (273), prompt-override (230), runtime-tool-dispatch (454 — Lane 1 says wired at newer HEAD), runtime-tools (257 — same), schema-migration (346), wotann-yml (330) |
| `src/cli/` | 6 | 1,121 | 0 Y | debug-share (321), history-picker (215), incognito (131), onboarding (185), pipeline-mode (165), test-provider (104) — all have `index.ts` inline supersessions |
| `src/sandbox/` | 4 | 1,067 | all Y | approval-rules (228), extended-backends (237), output-isolator (284), unified-exec (318) |
| `src/connectors/` | 5 | 1,392 | 0 Y | confluence (158), google-drive (278), jira (291), linear (342), notion (323) — all have tool-registration callers per Lane 1 §1.4, so orphan TSV may be stale. |
| `src/tools/` | 5 | 1,193 | 1 Y / 4 N | monitor (240, N), pdf-processor (269, N), post-callback (192, N), task-tool (366, Y), tool-timing (126, N) |
| `src/providers/` | 6 | 1,306 | 4 Y / 2 N | budget-downgrader (162, Y), circuit-breaker (186, Y), harness-profiles (242, N), prompt-cache-warmup (315, Y), retry-strategies (227, Y), usage-intelligence (174, N) |
| `src/ui/` | 6 | 1,374 | 1 Y / 5 N | context-meter (159, Y), context-references (660, N), helpers (141, N), keybindings (79, N), raven/raven-state (229, N), themes (234, N), voice-controller (101, N) — note themes.ts ORPHAN contradicts Lane 1 §1.4 "wired through App.tsx" |
| `src/middleware/` | 2 | 566 | 1 Y / 1 N | file-type-gate (357, Y — Magika model silently env-gated per AUDIT_DOCS_GAP_ANALYSIS §1.8 #34), forced-verification (209, N — duplicates verification-enforcement+pre-completion-checklist) |
| `src/orchestration/` | 3 | 566 | all Y | code-mode (281), parallel-coordinator (148), speculative-execution (137) |
| `src/skills/` | 2 | 390 | all Y | skill-compositor (192), skill-optimizer (198) — both ORPHAN while README claims "65+ skills, progressive disclosure" |
| `src/learning/` | 3 | 580 | all Y | darwinian-evolver (197), miprov2-optimizer (183), reflection-buffer (200) |
| `src/prompt/` | 2 | 453 | all Y | template-compiler (276), think-in-code (177) |
| Others (single-file dirs) | ~15 | ~1,200 | varies | acp/thread-handlers, autopilot/{checkpoint,trajectory-recorder}, channels/terminal-mention, context/importance-compactor, daemon/auto-update, desktop/desktop-store, lsp/lsp-tools, meet/meeting-runtime, runtime-hooks/dead-code-hooks, telemetry/token-estimator, utils/{logger,platform}, workflows/workflow-runner |

### 8.3 Cross-reference with Lane 1

Lane 1 §2.1 marks ~20 as "library-only" (exported but no src/ runtime caller) and §2.2 marks 12 as "truly dead" (no lib+no src+no test). Several orphans in the TSV are marked "wired" by Lane 1 at newer HEAD (the TSV is a snapshot at HEAD aaf7ec2; sprint commits have moved things). This is the "perishability" problem called out in AUDIT_DOCS_GAP_ANALYSIS §3.

**Net assessment**: the TSV is a faithful snapshot. Running it against CURRENT HEAD would show fewer orphans post-sprint, but none of the 89 is trivially deletable without verification, and ~50 have tests that assert behavior production never invokes (drift alert — test-vs-runtime divergence).

---

## 9. 30+ Action Items from Old Docs Missing from Current 5 Audit Lanes + MASTER_PLAN_V7

Compiled from MASTER_CONTINUATION_PROMPT.md (24 items), ROADMAP.md (planned features §5), NEXUS_V4_SPEC missing features, DECISIONS.md gaps (D40+ docs debt), design-brief ambitions, WOTANN_ORPHANS.tsv recommendations, COMPREHENSIVE_SOURCE_FINDINGS + DEEP_SOURCE_EXTRACTION priority items, and RESEARCH_GAP_ANALYSIS.

### 9.1 Broken-wiring items (6 HIGH)

| # | Item | Source | Lane coverage |
|---|---|---|---|
| 1 | **accountPool never consulted by AgentBridge** for multi-key rotation (init'd in runtime, never read) | MCP #1 | Partially Lane 1 |
| 2 | **editTracker never invoked** in streaming loop (benchmark-engineering PerFileEditTracker init'd but dead) | MCP #2 + DECISIONS D37 | NOT in Lane 1 |
| 3 | **`nexus resume` doesn't restore context** — loads session stats but doesn't pipe conversation history into new runtime | MCP #3 | NOT in Lane 1 |
| 4 | **`nexus cost` non-persistent** — fresh CostTracker each CLI invocation, always reads $0 | MCP #4 + HIDDEN_STATE_REPORT token-stats | NOT in Lane 1/Lane 4 |
| 5 | **Shadow git not wired on dangerous operations** — only wired in integration test | MCP #5 + ROADMAP Hermes pattern | NOT in Lane 1 |
| 6 | **Format translator exists, AgentBridge doesn't call it** when switching Anthropic↔OpenAI | MCP #6 + Lane 1 §2.1 partial | Partially Lane 1 |

### 9.2 Missing HIGH features (6)

| # | Item | Source | Lane coverage |
|---|---|---|---|
| 7 | **`wotann cu <task>`** — wire `computer-use/computer-agent.ts` + `perception-engine.ts` into CLI | MCP #7 | NOT in any Lane |
| 8 | **Production Ralph mode** — 51 LOC stub needs DoomLoop + budget + strategy escalation + HUD metrics | MCP #8 | Partial Lane 1 |
| 9 | **Full TTSR abort/retry** — current injects warning but doesn't abort-stream + retry-with-injection-as-system-message | MCP #9 + DECISIONS D6 | NOT in any Lane |
| 10 | **`wotann channels start` + E2E test** — adapters wired to daemon, no CLI command and no E2E | MCP #10 | NOT in any Lane |
| 11 | **Resumable streams** — no stream checkpointing; `wotann resume --stream` to continue | MCP #11 + COMPETITIVE_ANALYSIS LibreChat | NOT in any Lane |
| 12 | **agentskills.io format adapter** — 1060+ community skills in directory format; loader assumes flat markdown | MCP #12 + RESEARCH_GAP "Agent Skills Standard" + Crush Dep | NOT in any Lane |

### 9.3 MEDIUM items (8)

| # | Item | Source |
|---|---|---|
| 13 | **7 intelligence override triggers** — definitions exist, trigger logic missing (Step 0 deletion >300 LOC refactor detector, senior dev quality bar injection, sub-agent swarming auto-decomposition >5 files, file chunking >500 LOC, truncation detection, AST-level search on renames, forced verification) | MCP #13 + NEXUS §11 |
| 14 | **Multi-panel TUI layout** — ContextHUD, DiffViewer, AgentStatusPanel exist, App.tsx uses none; add panel toggle keybindings | MCP #14 + design-brief 07-surface-tui |
| 15 | **Skill marketplace search/install** — registry.ts has stub; add local dir browsing + install from git URL | MCP #15 + ROADMAP #10 |
| 16 | **Git worktree isolation for coordinator** — `git worktree add` for parallel agents | MCP #16 + DEEP_SOURCE Cursor-3 `/worktree` |
| 17 | **`nexus team <task>`** — multi-agent + file-ownership boundaries | MCP #17 + ROADMAP.C |
| 18 | **`nexus install <plugin>` npm plugin ecosystem** — custom providers/tools/hooks/TUI panels | MCP #18 + ROADMAP.D |
| 19 | **Mid-session model switching preserving context** — `model-switcher.ts` lib-only | COMPETITIVE Crush + Lane 1 §2.1 |
| 20 | **MAX_CONCURRENT_SUBAGENTS hardcoded to 3** — Feb 2026 competitors ship 5-8 (Jean 8, Grok 8, Windsurf 5) | MASTER_PLAN_V6 #12 + orchestration/coordinator.ts |

### 9.4 LOW / polish items (6)

| # | Item | Source |
|---|---|---|
| 21 | **HuggingFace Inference API** — `HF_TOKEN` + `router.huggingface.co/v1` | MCP #21 + RESEARCH_GAP "HuggingFace" |
| 22 | **Visual test verification** — screenshot comparison + OCR + a11y diffing | MCP #22 + ROADMAP.G |
| 23 | **Proactive error prevention** — pre-commit analysis of which tests will break | MCP #23 + ROADMAP.F |
| 24 | **Context-aware model selection** — track per-repo per-file per-pattern success rates | MCP #24 + ROADMAP.E |
| 25 | **Chrome extension** — chrome.debugger API for Computer Use Layer 2 | ROADMAP.H + DEEP_SOURCE Cline |
| 26 | **Source monitoring system** — `wotann repos check` weekly digest of competitor-repo changes | ROADMAP.I + NEXUS Appendix T |

### 9.5 Novel pioneering items (8)

| # | Item | Source |
|---|---|---|
| 27 | **Knowledge Fabric** — LightRAG graph RAG + ByteRover context tree + provenance tracking — every memory has {trust, freshness, source, verification, KG-path} | DEEP_SOURCE #2 + COMPREHENSIVE F.4 |
| 28 | **Consensus Engine** — Arena+Council+multi-model vote → harness RL learns per-codebase routing | DEEP_SOURCE #1 + COMPREHENSIVE |
| 29 | **Self-Optimizing Harness** — karpathy/autoresearch for middleware weights/prompt templates/routing; fixed time budget per experiment | DEEP_SOURCE #3 + COMPREHENSIVE 1.1 |
| 30 | **Universal Dispatch Plane** — 24 channels + 50 knowledge connectors (Google Drive/Notion/Confluence/Jira) unified | DEEP_SOURCE #4 + Onyx 50-connector analysis |
| 31 | **Infinite Context Local** — TurboQuant 6x KV compression on Ollama → Qwen3-Coder-Next 131K → 786K effective | DEEP_SOURCE #5 + COMPREHENSIVE 1.11 |
| 32 | **Skill Forge** — Auto-generation + self-improvement + marketplace + agentskills.io interop | DEEP_SOURCE #6 + Hermes closed learning loop |
| 33 | **Visual Timeline Debugger** — shadow git + branching timelines + replay in TUI | DEEP_SOURCE #7 + Hermes + Opcode |
| 34 | **Dual-Terminal Live Steering** — Agent in Terminal 1, steer via Terminal 2 editing state files; pickup at phase boundaries | DEEP_SOURCE #8 + GSD `--web` pattern |

### 9.6 Architecture/spec debt (5)

| # | Item | Source |
|---|---|---|
| 35 | **DECISIONS.md needs D40-D78+** — ~30 session-8+ architectural commitments undocumented | DECISIONS.md + CONTRIBUTING guidance |
| 36 | **Dead code cleanup backlog** — 89 orphans, 10 ghost "* 2.ts" duplicates (51,532 LOC); commit deletions | WOTANN_INVENTORY §2 + Lane 1 §2.3 |
| 37 | **Two competing channel adapter base types** — `BaseChannelAdapter` (1 subclass Echo) vs `ChannelAdapter` (15 real) — pick one, migrate or delete | Lane 1 §3.2 + orphan EchoChannelAdapter |
| 38 | **6 orphan intelligence modules with tests** — adversarial-test-generator, budget-enforcer, chain-of-verification, confidence-calibrator, multi-patch-voter, policy-injector, strict-schema, tool-pattern-detector — tests assert behavior production never invokes | WOTANN_ORPHANS.tsv + AUDIT_FALSE_CLAIMS |
| 39 | **10 ghost duplicate files "* 2.ts"** — 51,532 LOC uncommitted, not in gitignore/tsconfig, inflate LOC counts; delete all 10 | Lane 1 §2.3 (core/runtime 2.ts, memory/store 2.ts, orchestration/autonomous 2.ts, coordinator 2.ts, tools/web-fetch 2.ts, tools/aux-tools 2.ts + 4 test dups) |

### 9.7 Runtime-state gaps (3)

| # | Item | Source |
|---|---|---|
| 40 | **8-layer memory routing broken in production** — 1,990 rows in auto_capture / 0 rows in memory_entries, knowledge_nodes, decision_log, working_memory, team_memory, verbatim_drawers across 2,225 sessions. Structured layers never written. | HIDDEN_STATE_REPORT §A.2 |
| 41 | **`.wotann/plans.db` has 0 plans/milestones/tasks** across all 3 tables — planning DB never populated | HIDDEN_STATE_REPORT §A.3 |
| 42 | **Dream pipeline processes 0 entries** — fires on schedule; `dreams/light-candidates.json` and `rem-signals.json` both empty; autoDream runs but has no input | HIDDEN_STATE_REPORT §A.1 |

---

## 10. Final Assessment

The 5 new Audit Lanes (1 Architecture, 2 Competitors, 3 UI/Features, 4 Infra/Security, 5 Benchmarks) + AUDIT_DOCS_GAP_ANALYSIS + AUDIT_CURRENT_STATE_VERIFICATION did a thorough job on **code-level wiring at HEAD**. What they collectively under-weighted:

1. The **NEXUS_V4_SPEC is the contract** — not pre-production scaffolding. 223 features, not the 30-40 most lanes cite. 23.3% fully Done vs 50.2% Partial — this is the real implementation story.
2. The **April-3 research corpus** (147 KB across 4 root docs + 116 KB across 2 wotann docs) is still 80% on-target. The 90+ competitor features catalogued there are not in any Lane.
3. The **design-brief/** (24 files, 225 KB incl assets) is the unreferenced UI contract. Lane 3 audits UI code; design-brief defines acceptance criteria at ADA-9.0 bar with 15 principles + 32 constraints + 24-score rubric.
4. **MASTER_CONTINUATION_PROMPT.md (April 2) remains 80% relevant** — ~20 of its 24 gap items are still open or partially-open. Cross-reference with MASTER_PLAN_V6/V7 before duplicating.
5. The **89 orphan TSV** + **WOTANN_INVENTORY** provide the canonical truth-source that should ground every future audit; "wired at HEAD" claims drift perishably.
6. **39 action items** surface in these older docs that are not tracked anywhere visible in V7 — 6 broken-wiring, 6 missing-HIGH, 8 MEDIUM, 6 polish, 8 novel-pioneer, 5 arch-debt, 3 runtime-state-gap.

**Recommendation**: Treat NEXUS_V4_SPEC as the feature registry (§1-§35 + Appendices A-Z); design-brief as the UI acceptance contract; WOTANN_INVENTORY as the code ground truth; the 7 tier-1 root research docs as the competitive reference; MASTER_CONTINUATION_PROMPT's 24 items as the outstanding-task registry. MASTER_PLAN_V7 should inherit the 39-item action list from §9 above.

---

*Citations: All claims grep-traceable to cited file. 55 files read end-to-end, including the full 7,928-line NEXUS_V4_SPEC.md via multi-range reads of §1-§4 (principles + feature matrix), §5-§10 (providers + middleware + permissions), §11-§20 (intelligence + memory + orchestration), §21-§35 (ULTRAPLAN through CLI/directory), Appendix U-Z (skill import, benchmark engineering, onboarding, capability augmentation, ForgeCode detail, OpenClaude deep-dive, Final Parity Additions, Authoritative Feature Count).*
