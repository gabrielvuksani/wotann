# WOTANN Autonomous Execution Plan V3 — 2026-04-18

**Supersedes:** V2 + V1 + MASTER_PLAN_SESSION_10 + ADDENDUM + BENCHMARK_BEAT_STRATEGY_2026-04-18 + MASTER_PLAN_PHASE_2 + DEEP_AUDIT_2026-04-13 + UI_DESIGN_SPEC + Depth/Sidebar specs.
**Method:** Wave 1 (15 agents) + Wave 2 (15 agents) + Wave 3 (direct-source ground-truth via Chrome MCP + 38 repos read + 20 doc files read).
**Governing principles:** Gabriel's: (1) "DON'T HARDCODE NOTHING" (2) triple-check via source verification (3) "no vendor bias" (4) automagical by default for every model with intelligent fallbacks (5) beat every benchmark.

## Why V3 (vs V2)

V2 was HEAD-verified for Tier 0/S4. V3 adds 100+ items discovered in Wave 3 from direct-source reads of 38 repos + 20 wotann docs that V2 missed because agents either stalled, hit sandbox denials, or inferred from training data.

## 16 MAJOR PATTERNS TO INCORPORATE (discovered Wave 3)

### A. Competitor patterns with VERIFIED source

| # | Source | Pattern | WOTANN target |
|---|--------|---------|---------------|
| A1 | Archon | **Workflow YAML format** in `.archon/workflows/*.yaml` with nodes (id/prompt/depends_on/loop/bash/interactive) | Create `.wotann/workflows/*.yaml` + runner |
| A2 | Context-Mode (HN #1) | **Sandbox tool isolation (ctx_execute/index/search) + PreCompact hook + SessionStart hook + "think in code"** | Add WOTANN PreCompact hook that blocks compaction until context compressed to external index |
| A3 | Hermes-Agent-Self-Evolution | **DSPy + GEPA** (ICLR 2026 Oral MIT) evolution loop w/ 4-tier optimization (skills → tool descs → system prompt sections → code) | Implement as Tier 4 self-evolution backbone |
| A4 | Hermes-Agent | **Spawn-per-call execution + 6 terminal backends (local/Docker/SSH/Daytona/Singularity/Modal) + serverless persistence** | Add Daytona + Modal backends to sandbox layer |
| A5 | Hermes-Agent | **Voxtral Transcribe STT (Mistral AI) + Qwen OAuth + thinking-only prefill continuation** | Add to provider lineup |
| A6 | Hermes-Agent | **OpenRouter variant tag preservation (:free, :extended, :fast) during model switch** | Preserve in WOTANN provider router |
| A7 | deepagents 0.5 | **better-harness pattern** (train/holdout eval splits, proposer-workspace, module_attr patching, TOML experiment config) | Port to WOTANN's benchmark harness |
| A8 | deepagents 0.5 | **Sub-250ms first paint** (aggressive import deferral + markdown stack prewarming + reduced health-poll intervals) | Cold start optimization target |
| A9 | deepagents 0.5 | **`/skill:name` slash dispatch + `--skill` startup flag** | WOTANN CLI command addition |
| A10 | deer-flow 2.0 | **Per-agent `available_skills` filter** + built-in grep/glob in sandbox + **loop detection via stable hash keys** + document outline injection | All portable to WOTANN |
| A11 | GenericAgent | **3K-line minimal agent + 9 atomic tools + ~100-line Agent Loop + <30K context window** philosophy | Pressure test WOTANN's runtime.ts for simplicity |
| A12 | Cognee | **14 search-type enum + 4-verb memory API + OpenClaw + Claude Code plugin packaging** | Model WOTANN's public memory API |
| A13 | Claude-Context | **AST tree-sitter chunking + per-file SHA incremental index + MCP install 1-line `claude mcp add claude-context -e ... -- npx ...@latest`** | Package WOTANN as equivalent MCP |
| A14 | Goose (AAIF) | **ACP for subscription auth (Claude/ChatGPT/Gemini) + 70+ MCP extensions + 15+ providers + download_cli.sh one-liner** | WOTANN `install.sh` should match; ACP port confirmed |
| A15 | Oh-My-OpenCode | **Multi-model orchestration philosophy**: "Claude/Kimi/GLM orchestration, GPT reasoning, Minimax speed, Gemini creativity" | Enshrine in WOTANN routing strategy |
| A16 | Clicky | **Cloudflare Worker proxy pattern** (API keys never ship in app binary) | Package for WOTANN free-tier distribution |

### B. Benchmark targets with VERIFIED SOTAs

| Benchmark | SOTA | WOTANN target | Source |
|-----------|------|---------------|--------|
| TerminalBench 2.0 | ~82% (Claude Mythos Preview) | 75%+ (top-5 band) | MASTER_AUDIT_2026-04-14 |
| SWE-bench Verified | 93.9% (Claude Mythos) | 80%+ | same |
| SWE-bench Pro | ~23% | report honestly | missed-competitors |
| SWE-bench Live | match Verified within 5pp | — | same |
| LongMemEval | 98.6% (Supermemory ensemble) | 85%+ | missed-competitors |
| LoCoMo | ~70% | 70%+ | competitor-research-mempalace |
| LoCoMo-Plus | — | report | 2026 cognitive benchmark |
| τ-bench Retail | 0.862 (Claude Sonnet 4.5) | 70-80% | MASTER_AUDIT_2026-04-14 |
| Aider Polyglot | — | top-5 | BENCHMARK_BEAT_STRATEGY |
| LiveCodeBench | — | track | same |
| HumanEval+/MBPP+ | saturated | publish baseline | same |
| BigCodeBench | — | track | same |
| GAIA | — | Tier 4 CodeAct gives +15-20% lift | per openai-agents-python |
| WebArena/VisualWebArena/OSWorld | — | compute-gated | same |
| WOTANNBench (self-authored) | N/A | own category: "free-tier-first + TUI-first + local-first" | missed-competitors |

### C. Memory architecture upgrades (verified competitor benchmarks)

- Supermemory approach: dual-layer timestamps (documentDate + eventDate) + 3 rel types (updates/extends/derives) → +10pp LongMemEval
- MemPalace approach: hierarchical domain/topic partitioning → +34% retrieval on 22k messages
- Cognee approach: knowledge-graph construction + graph-RAG + 14 search types
- Claude-Context approach: AST tree-sitter + per-file SHA incremental + MCP delivery

### D. UI/UX moves (from UI_DESIGN_SPEC + Depth + Sidebar specs)

**5 THEMES** (UI_DESIGN_SPEC_2026-04-16 — overrides earlier Depth):
- Mimir's Well (default dark), Yggdrasil (light), Runestone (high-contrast obsidian), Bifröst (onboarding celebrations only), Valkyrie (Exploit tab only)

**7 signature interactions**: Runering, Huginn & Muninn split pane (⌘⇧2), Sealed Scroll Proof Bundle, Capability Chips, Raven's Flight sync, Sigil Stamp, Council Mode (⌘⇧C)

**3 layout innovations**: Mead-Hall 3-tier morphing palette (⌘K), Conversation Braids (⌘⇧B), Well timeline scrubber (⌘⇧T)

**10 micro-interactions**: streaming text fade, thinking rune-forge, tool call expand, diff accept physics, provider chip hover, message hover actions, input focus ritual, sidebar collapse, error shake, session end Ember

**5 onboarding hooks**: Well of Mimir (primary), Summoning (4 patrons Thor/Odin/Loki/Freya), Rune Revealed tutorial, Cost Glint, First Quest

**Sound design** (opt-in, in-house WAV 48kHz 24-bit -12dBFS): Rune-tap (80ms wooden mallet on bronze), Well-hum (2400ms cavern loop -22dB), Wax-seal press (180ms low-mid thud + high sizzle tail), Wood-knock (120ms oak rap for destructive warnings)

**Mobile/Watch/Widgets/CarPlay**: Home feed = conversation spines with patron-color ribbons (ribbon-thickness=activity, height=recency), Work tab = swipeable Tinder-style diff cards, Arena tab = Exploit red-team color. Watch: complication with single rune (Fehu idle/Raidho running/Ansuz awaiting/Tiwaz proof-complete). Widgets: Small 2×2 (rune + metric, pulses on need), Medium 4×2 (rune + quest title + X of Y + progress ring), Large 4×4 (braid view 3 ribbons tappable). CarPlay: CPListTemplate per thread with patron voices (Odin deeper, Freya warmer), tool execution SUSPENDED while driving, spoken "The forge rests while you drive."

### E. Sidebar architecture (approved structural per 2026-04-09 spec)

- Header pills: Chat | Editor ONLY (drop 4-tab space switcher Chat/Editor/Workshop/Exploit)
- Toolbar icon toggles: Terminal (bottom VS Code panel) + Diff/Changes (right Codex panel) — independent + simultaneous
- Sidebar top-to-bottom: (1) Brand row W + WOTANN + New Chat + Settings gear (2) Search with Cmd+K hint (3) Project groups collapsible with conversation lists + violet 2-3px left bar active indicator (4) Divider (5) Worker pill floating compact — **WORKSHOP ENTRY POINT** via click-to-expand
- Exploit mode accessed via command palette or settings (no dedicated tab)
- User note: "many UI elements need refinement... text contrast needs to be higher... feel like a premium macOS-native app, not a copy of these mockups"

## CONSOLIDATED V3 Execution Plan

### Phase 0: Re-read HEAD before anything (1 day)

**Re-verify every TableS matrix row from V2.** Session 10 may have landed additional fixes. Run:
```bash
for check in bedrock_toolConfig vertex_messages azure_url ollama_stopReason copilot_401 tolerantJSONParse camoufox agent_bridge_tools parseToolCallFromText bootstrap_loadBootstrapFiles active_memory_field memory_search_duplicate soul_path vector_store_reembed; do
  # specific grep for each predicate
done
```
Output: `verification-report-v3.md`.

### Phase 1: Tier 0 Lies (HEAD-filtered) — 6-10 days
Run only tasks still showing ❌. If earlier audit was wrong (like camoufox verification — agent-bridge actually fixed), skip.

### Phase 2: S4 Prior Criticals — 10-15 days
+ NEW items:
- **S.4.26 Wire loadBootstrapFiles + buildIdentityPrompt** into runtime.ts prompt assembly (2h) — MASSIVE UX unlock (identity/SOUL/AGENTS/HEARTBEAT all become live)
- **S.4.27 Fix active-memory.ts:141 field name** (5min) — unlocks recall pipeline
- **S.4.28 Delete duplicate memory_search_in_domain** (2min)
- **S.4.29 autodream stop-word filter** (15min)
- **S.4.30 vector-store first-search re-embed** (2h)
- **S.4.31 FTS5 coverage to all 8 memory tables** (3h)
- **S.4.32 ConnectorRegistry register concrete classes** (2h)
- **S.4.33 Wire 9 CLI files** (2h)
- **S.4.34 Wire 40 dead Tauri commands OR delete with approval** (per DEEP_AUDIT) — Computer Use / Remote Control / Native Input CoreGraphics / Audio Capture / Agent Cursor Overlay / LocalSend Receive surfaces

### Phase 3: Learning Stack Resurrection — 3 days
Currently 12 files in src/learning/ produce ZERO output. Fix:
- Conversations auto-persist to memory store on turn completion
- Memory store → observations → dream pipeline (nightly consolidation)
- Observations → instinct system → preferences inference
- Instincts → self-evolution (Tier 4 GEPA integration)
- Skill-forge extracts skills from successful patterns

### Phase 4: Tier 1 Benchmark Harness — 20 days
+ **better-harness pattern** (deepagents 0.5): train/holdout eval splits, proposer-workspace, TOML experiment config (A7)
+ WOTANNBench authored as own leaderboard category (B)

### Phase 5: Tier 2 Codex Parity P0 — 17 days
+ **6 terminal backends** (Hermes A4): add Daytona + Modal serverless persistence
+ **ACP host compliance** verified — hermes has `hermes claw migrate`; WOTANN needs equivalent `wotann claw migrate` (or compat import)

### Phase 6: Memory Upgrades + Dual-Layer Timestamps — 20 days
+ **Tier 3 V2 tasks** (tree-sitter AST, sqlite-vec, unified dual-retrieval, typed EntityType Zod, incremental SHA index, mode registry, project/task scope, query reformulation+HyDE)
+ **Supermemory dual-layer** (documentDate + eventDate + 3 rel types) — +10pp LongMemEval lift
+ **MemPalace wing/room/hall hierarchy** — +34% retrieval
+ **Cognee 14 search types** (A12)

### Phase 7: Self-Evolution with DSPy/GEPA — 27 days
+ V2 Tier 4 tasks (Reflexion, Voyager, DGM, STaR, MemGPT 3-layer, Embedding-indexed skills, CodeAct, Self-rewarding, PromptBreeder)
+ **GEPA integration** (A3 from Hermes-Agent-Self-Evolution) — 4-tier optimization: Tier 1 skill files, Tier 2 tool descriptions, Tier 3 system prompt sections, Tier 4 code evolution. ICLR 2026 Oral, MIT, no GPU, $2-10/run.
+ Hermes SuperMemory multi-container (search mode + identity templates + env var overrides)

### Phase 8: UI/UX Distinction — 30 days (expanded from V2)
+ Full UI_DESIGN_SPEC v0.3.0 implementation (5 themes + 7 interactions + 3 layouts + 10 micro + 5 onboarding + sound + mobile)
+ **Sidebar architectural decisions** (per 2026-04-09 spec) — 2 header pills, workshop as worker-pill expand, exploit via palette
+ V2 Tier 5 items (Liquid Glass, unified tokens, block terminal, Cmd+/ cheatsheet, bezier cursor + [POINT:x,y], Ask-about-window ScreenCaptureKit OCR, global hotkey palette)
+ **Refinement pass** per user's "many UI elements need refinement... feel like premium macOS-native app" direction — pixel perfection audit with live Tauri dev loop

### Phase 9: Skills library — 25 days (~115 target)
+ V2 Tier 6 top-30 (Superpowers 14 + OpenAI Skills format + Karpathy 4 principles + Osmani 7 commands)
+ **OpenClaw 560+ skills catalog scan** — identify 10-20 production-grade enterprise skills (C-Suite advisors + senior engineers + product management) to port via agentskills.io standard

### Phase 10: Workflow YAML (Archon pattern) — 3 days
+ `.wotann/workflows/*.yaml` spec with nodes (id/prompt/depends_on/loop with until/bash/interactive)
+ CLI: `wotann workflow run build-feature.yaml`
+ UI: Workshop worker-pill expanded view = workflow runner
+ Example seed: `build-feature.yaml` (plan → implement-loop → run-tests → review → approve-interactive → create-pr)

### Phase 11: Channel parity 17→24 + WeCom + Feishu — 10 days
+ V2 Tier 7 tasks (Mastodon, Twitter/X DM, LinkedIn, Instagram, WeChat, Line, Viber)
+ Hermes pattern: Discord forum channel thread inheritance, Telegram message reactions, Feishu interactive cards, Slack thread auto-respond + approval buttons

### Phase 12: FUSE Security Moat — 15 days (unchanged from V2)

### Phase 13: God-object split — 3 days (unchanged from V2)
+ Gabriel explicitly scoped runtime.ts + kairos-rpc.ts splits OUT of autonomous runs per SESSION_8_HANDOFF — human-mediated PR

### Phase 14: Archon workflow runner + Multica managed agents compatibility — 5 days
Multica works with "Claude Code, Codex, OpenClaw, OpenCode, Hermes, Gemini, Pi, Cursor Agent". WOTANN should register as supported runtime type in these platforms + support inbound task assignment.

### Phase 15: Ship v0.4.0 MVP — 7 days
- Download page like jean.build/cursor/goose: macOS DMG + Windows EXE/MSI + Linux AppImage/DEB/RPM x64+ARM
- `curl | sh` installer like hermes
- Homebrew tap: `brew tap wotann/tap && brew install wotann`
- NPM: `npm install -g wotann`
- Documentation site + changelog + release notes
- Marketing page at wotann.com

## Updated dependency DAG

```
Phase 0 HEAD verify
  ↓
Phase 1 Tier 0 lies  ──┬──> Phase 4 Benchmark harness ──┐
                       │                                ├──> Phase 7 Self-evolution
Phase 2 S4 criticals ──┤                                │
                       ├──> Phase 3 Learning stack ─────┘
Phase 3 Learning resurrection
  ↓                          
Phase 4 Benchmark harness ─────┐
  ↓                            ↓
Phase 5 Codex parity    Phase 7 Self-evolution
Phase 6 Memory upgrades (parallel w/ 5-7)
  ↓
Phase 10 Workflow YAML
Phase 8 UI/UX ── independent
Phase 9 Skills ── independent
Phase 11 Channels ── independent
Phase 12 FUSE ── independent
Phase 13 God-object split ── deferred (human-mediated)
Phase 14 Archon+Multica compat (after 10)
Phase 15 Ship v0.4.0 ── after 1-11
```

## Total V3 Effort

| Phase | Days |
|-------|------|
| 0. HEAD verify | 1 |
| 1. Tier 0 (filtered) | 6-10 |
| 2. S4 criticals | 10-15 |
| 3. Learning resurrection | 3 |
| 4. Benchmark harness | 20 |
| 5. Codex parity | 17 |
| 6. Memory upgrades (Cognee+MemPalace+Supermemory) | 20 |
| 7. Self-evolution DSPy/GEPA | 27 |
| 8. UI/UX + design system | 30 |
| 9. Skills (parallel) | 25 |
| 10. Workflow YAML | 3 |
| 11. Channels 24 | 10 |
| 12. FUSE | 15 |
| 13. God-object (deferred) | — |
| 14. Archon+Multica compat | 5 |
| 15. Ship v0.4.0 | 7 |
| **TOTAL SERIAL** | **199-219 days** |
| **3 PARALLEL STREAMS** | **~75-85 calendar days** |

Race window: ship v0.4.0 by June 30, 2026 (60-90 day Anthropic Claude Apps GA). V3 critical-path = Phase 0 → Phase 1 → Phase 4 → Phase 7 = 1 + 8 + 20 + 27 = 56 days. Ships in time with ~14 days buffer.

## References (all Engram topic keys)

- `wotann/wave3-ground-truth` (jean + perplexity + openclaw + openai-agents + superpowers + openai-skills)
- `wotann/wave3-repos-batch1` (Goose AAIF + Cognee + Archon + Claude-Context)
- `wotann/wave3-repos-batch2` (Warp Oz + Camoufox moved to CloverLabsAI + WACLI Go-CLI + Omi 300K + Clicky + DeepTutor v1.1.2)
- `wotann/wave3-repos-batch3` (hermes-self-evolution DSPy+GEPA + autonovel + context-mode HN#1)
- `wotann/wave3-repos-batch4` (Magika 99% + Karpathy 4 + Osmani 7 + Multica + Evolver GEP + gstack 247K OpenClaw + vercel open-agents + GenericAgent 3K + code-review-graph)
- `wotann/wave3-repos-batch5` (Taskmaster + DeerFlow 2.0 + Hermes-Agent + Eigent + Oh-My-OpenCode + Open-SWE + Ruflo + Opcode + wshobson/agents 184-agent + DeepGEMM)
- `wotann/deep-audit-full` (AUTH + DEEP_AUDIT_2026-04-13 + SESSION_8_HANDOFF)
- `wotann/repo-research-updates` (32 tracked repos + 10 cloned repos deltas)
- `wotann/depth-sidebar-redesign` (Depth canonical tokens + Sidebar architectural)
- `wotann/five-hard-truths` + `wotann/ground-truth-resolution` + `wotann/round6-7-critical` (earlier waves)

All of V2's topic keys remain valid — V3 is additive.
