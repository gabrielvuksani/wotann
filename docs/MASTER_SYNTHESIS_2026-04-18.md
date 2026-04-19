# WOTANN Master Synthesis — 2026-04-18

**Supersedes** MASTER_AUDIT_2026-04-18 and AUTONOMOUS_EXECUTION_PLAN_V4 for the single consolidated view. Sourced from 20 wave-1/2/3/4 deep-read docs, 12 competitor-analysis briefs, and 50+ Engram topic-keys. Ground-truthed against direct reads of `src/core/runtime.ts`, `src/core/kairos-rpc.ts`, `src/runtime.ts` (tail), `src/index.ts`, and `src/desktop/src-tauri/`.

**Author**: Synthesis agent (wave 4 closure) | **Codebase SHA**: tip of `main`, 59 commits past session-5 | **Word count target**: 6,000+ | **Audience**: future sessions (post-compaction), release reviewer, public roadmap.

---

## 0. Executive Summary

WOTANN v0.1.0 is a **remarkably complete implementation** of the 7,927-line NEXUS V4 build spec: **~85% implemented, ~12% partial, ~3% missing**. The codebase totals **148,446 LOC of TypeScript source plus 47,767 LOC of tests (254 test files)**, **120+ Swift files** across seven iOS targets (WOTANN, WOTANNIntents, Share extension, Watch, Widgets, CarPlay, LiveActivity), **97+ React TSX files** in the Tauri desktop app, and **11+ Rust files** in `src-tauri/` (`commands.rs`, `state.rs`, `hotkeys.rs`, `computer_use/permissions.rs`, etc.). The CLI exposes **85 command registrations** inline in `src/index.ts` (spec claimed 20 user-facing verbs). The provider layer declares **19 adapters** (spec/docs claimed "11"). The memory stack contains **27 modules** (spec claimed "8-layer"). The skill library ships **86 markdown skills** (spec claimed "65+"). In every dimension the codebase over-delivers against its own specification.

However, five independent Opus audits plus four wave-4 deep reads surfaced **11 verified bugs** and a handful of architectural gaps that currently block a "top-3 TerminalBench + SWE-bench Verified" claim. This synthesis fuses those findings into one coherent status board and a **15-phase, 56-day critical-path execution plan** that ships **v0.4.0** (the first public MVP) by **June 30 2026** — the day Anthropic is expected to GA Claude Apps, which is the inflection point beyond which WOTANN must already be in the market.

**The bet is simple**: WOTANN is the *harness*, not a model. Harness engineering contributes 15–30% absolute to benchmark scores independent of the base model (Princeton SWE-agent, Anthropic CodeLog, internal TerminalBench strategy doc), and WOTANN has already implemented roughly 80% of the known harness tricks in its `src/intelligence/`, `src/orchestration/`, and `src/providers/` subsystems. The remaining 20% is mostly *wiring* — benchmark-adapter plumbing, verifier-retry budgets, the AutoresearchEngine generator callback — not greenfield research. Phase 0 verifies HEAD, Phase 1 fixes bugs, Phase 4 lights up the benchmark harness, Phases 5–14 build moats and match competitor parity, and Phase 15 ships.

---

## 1. Status Matrix — Per Subsystem

The matrix uses five states: **REAL** (fully implemented, wired, and exercised by at least one code path), **WIRED-BUT-STUB** (wired into the runtime but the implementation is a no-op or returns a hardcoded constant), **DEAD** (present in source, exported, but never called in production), **MISSING** (claimed in spec, absent from code), **BUG** (implemented but broken end-to-end).

| Subsystem | State | Notes |
|-----------|-------|-------|
| `src/core/runtime.ts` (4,400 LOC, 171 fields) | REAL | God-object; session-10 fix classifies memoryCandidate by tool; rehydrateKnowledgeGraph on boot; persistKnowledgeGraph on close; recordDecision dual-persists |
| `src/core/kairos-rpc.ts` | REAL (except `getMeetingStore` callback) | 5,100+ LOC of JSON-RPC handlers; `ext()` adapter line 4796 + 5047 returns null for meeting store |
| `src/runtime.ts` (tail) | REAL | Composition helpers, boot wiring, signal traps |
| `src/index.ts` (CLI) | REAL | 85 `.command()` registrations inline; spec claimed 20 user-facing verbs but `commands.ts` file does NOT dispatch them — they live in inline `.action()` blocks |
| `src/providers/` (34 files, 19 adapters) | PARTIAL | 15 work; Bedrock/Vertex/Azure/Ollama/Copilot have verified bugs; gemini-native-adapter, perplexity, xai, together, fireworks, sambanova, mistral, deepseek, huggingface, free = REAL |
| `src/providers/bedrock-signer.ts` | BUG | Body omits `toolConfig`; regex parser ignores `toolUse` events — tool calls silently dropped |
| `src/providers/vertex-oauth.ts` | BUG | Hardcoded 5-field body drops `opts.messages/tools/systemPrompt`; stream parser only emits `text_delta` |
| `src/providers/registry.ts:176-180` | BUG | Azure URL puts query param before path — every Azure call 404s |
| `src/providers/ollama-adapter.ts:331-342` | BUG | Missing `stopReason: "tool_calls"` — multi-turn agent loops die after 1 call |
| `src/providers/copilot-adapter.ts` | BUG (x2) | Lines 346-355: 401 has no retry; lines 88-90: module-global cached token leaks across users |
| `src/providers/gemini-native-adapter.ts` | BUG | Data URL `mimeType` trusted verbatim — injection risk |
| `src/providers/tool-parsers/parsers.ts:35-53` | BUG | `tolerantJSONParse` replaces `'`→`"` globally — corrupts strings with legitimate apostrophes |
| `src/browser/camoufox-backend.ts` | BUG | Spawns fresh Python subprocess per call — no persistent stealth session |
| `src/middleware/layers.ts` (14 middlewares) | REAL | God-file; `detectFrustration`, `memoryMiddleware`, `costMiddleware`, `guardsMiddleware` all wired; boundary violation — imports `sandbox/executor.js` |
| `src/middleware/pipeline.ts` | REAL | Clean composition root; `createDefaultPipeline` + `createPipelineWithInstances` |
| `src/intelligence/` (38 files) | REAL | Accuracy boost, context relevance, autoresearch ENGINE real, 7 native overrides wired |
| `src/intelligence/benchmark-harness.ts` | WIRED-BUT-STUB | Placeholder tasks; needs real SWE-bench/TB/LCB/Aider runner bindings |
| `src/intelligence/trajectory-scorer.ts` | REAL | Wired but not bound to TB runner |
| `src/training/autoresearch.ts` | WIRED-BUT-STUB | Engine real; constructed at `runtime.ts:934` with `async () => null` no-op generator — blocks Tier-4 self-evolution entirely |
| `src/memory/` (27 modules) | REAL | Deepest stack of any competitor; TemporalMemory, EpisodicMemory, ObservationExtractor all wired; SQLite + FTS5 with WAL; quantized-vector-store silently skips real-MiniLM branch in CI |
| `src/context/` (13 files) | REAL | Window-intelligence, tiered-loader, repo-map, 5-stage compaction |
| `src/prompt/engine.ts` | REAL | `assembleSystemPromptParts` reads `.wotann/`, `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.github/copilot-instructions.md`, `WOTANN.md`, `.wotann/rules/*.md` every initialize(); injects `KARPATHY_PRINCIPLES_PREAMBLE` when `WOTANN_KARPATHY_MODE=1` |
| `src/prompt/persona.ts` | DEAD | `loadBootstrapFiles`/`buildIdentityPrompt` parallel implementation — superseded by engine.ts inline loop |
| `src/hooks/engine.ts` | REAL | 19 events × 17 guards matrix; HookEngine + HookHandler + HookPayload + HookResult; `HookResult.contextPrefix` as injection channel (per session-2 quality bar) |
| `src/hooks/built-in.ts` | REAL (with boundary violation) | Imports `detectFrustration` from middleware — hooks should be leaves wrt middleware |
| `src/skills/` (6 modules, 2,017 LOC) | REAL | Progressive-disclosure contract intact |
| `src/skills/self-crystallization.ts` | DEAD | 172 LOC Tier-4 primitive never wired; memory save 5962 confirmed implemented Apr 17 |
| `src/channels/` (27 files, 17 adapters) | PARTIAL | Discord/Slack/Telegram/WhatsApp/iMessage/Signal/Matrix/IRC/Teams/Email/SMS/Webchat/Webhook/GitHub-bot/Google-chat/IDE-bridge/Terminal-mention all real; Mastodon/Twitter-X-DM/LinkedIn/Instagram/WeChat/Line/Viber MISSING (7-platform gap to spec's "24") |
| `src/channels/route-policies.ts` | DEAD | 412 LOC policy engine; Gabriel's explicit ask; daemon bypasses it |
| `src/channels/auto-detect.ts` | DEAD-ish | 390 LOC; daemon has ~150 lines of manual adapter wiring; auto-detect only knows 4 of 13 adapters |
| `src/channels/terminal-mention.ts` | DEAD | 116 LOC `@terminal` mention; unwired |
| `src/orchestration/` (25 files) | REAL | Coordinator, waves, PWR, Ralph, self-healing, council, arena all wired |
| `src/orchestration/council.ts` | REAL | Self-consistency voting primitive ready; not bound to benchmarks |
| `src/orchestration/self-healing-pipeline.ts` | REAL | Scaffolded; SWEBenchAdapter call-site missing |
| `src/orchestration/tree-search.ts` | MISSING | Aspirational for ARC-AGI; not priority |
| `src/autopilot/completion-oracle.ts` | DEAD | 288 LOC multi-criterion verifier — Tier-1 gating upgrade for TerminalBench 83-95% |
| `src/autopilot/pr-artifacts.ts` | DEAD | 276 LOC auto-generates commit + PR description; `wotann autofix-pr` prints fix-plan only |
| `src/computer-use/` (4-layer) | PARTIAL | API/CLI + A11y + Vision + Text-mediated scaffold; perception-adapter.ts DEAD |
| `src/computer-use/perception-adapter.ts` | DEAD | 316 LOC; multiplies Desktop Control from ~3 vision-capable providers to ~11 |
| `src/sandbox/` | PARTIAL | Policy-only; FUSE-overlay (App. E.4) MISSING; OS-level wrappers (bwrap/seatbelt/win-sandbox) MISSING |
| `src/lsp/` | REAL | Symbol operations module; not surfaced as agent tools (Goose-style `lsp_references/definition/hover/symbols/rename`) |
| `src/voice/` | REAL | Push-to-talk, edge-TTS, VibeVoice, faster-whisper |
| `src/learning/` (12 files) | WIRED-BUT-STUB | Files exist; conversation end hook not persisting; produces ZERO output until Phase 3 |
| `src/daemon/` (KAIROS) | REAL | Tick, heartbeat, cron; `cron.list` returns `{jobs:[]}` stub; `memory.verify` always `{verified:true}` stub |
| `src/identity/` | REAL | Persona system; SOUL.md + IDENTITY.md |
| `src/security/` | PARTIAL | Anti-distillation watermark present; FUSE missing |
| `src/telemetry/` | REAL | Cost tracking + cost preview + audit trail |
| `src/marketplace/mcp-marketplace.ts` | BUG | Hardcoded 5 entries + fake `registry.wotann.com`; `wotann mcp import --from-claude` works |
| `src/ui/` (Ink TUI) | REAL (with boundary violation) | `App.tsx:31` imports `../channels/unified-dispatch.js` — TUI should not know transports |
| `src/desktop/` (Tauri + React + Monaco) | REAL (with boundary violation) | `companion-server.ts:49-67` imports `computer-use`, `mobile/*`, `sandbox` — platform-crossing |
| `src/desktop/src-tauri/` (Rust) | REAL | `commands.rs`, `state.rs`, `hotkeys.rs`, `computer_use/permissions.rs`; zero `#[test]` coverage |
| `src/mobile/` + iOS native | REAL | 120+ Swift files, full SwiftUI, Xcode project, 7 targets; zero XCTest coverage |
| `src/intelligence/turboquant.ts` | MIS-NAMED | 381 LOC just passes Ollama q4_0 flags; session-10 confirmed rename to `ollama-kv-compression.ts` |
| `src/agents/required-reading.ts` | DEAD | 152 LOC YAML `required_reading:` support; parseAgentSpecYaml doesn't read the block |
| `src/meet/coaching-engine.ts` + `meeting-pipeline.ts` + `meeting-store.ts` | DEAD (trilogy) | 454 LOC post-meeting assistant; iOS Meet RPCs from Session 4 inert until wired |
| `src/testing/visual-diff-theater.ts` | DEAD | 509 LOC per-hunk accept/reject for Editor tab |
| `src/connectors/` (slack/jira/linear/notion/google-drive/confluence) | REAL (zero tests) | Code present, no test coverage |
| `benchmark-harness.ts` | WIRED-BUT-STUB | Phase-4 gate |

**Headline count**: **REAL 33 subsystems, WIRED-BUT-STUB 4, DEAD 13, MISSING 3, BUG 11.**

---

## 2. The 11 Verified Bugs (Ground-Truth From Direct Source Read)

Every bug was verified by Wave-4 direct file reads after Wave-1/2/3 Opus agents flagged speculative issues. The prior waves got ~50% of "dead/unwired" claims WRONG — below is only what remains after source-level confirmation.

| # | File:Line | Bug | Severity | Effort | Impact When Fixed |
|---|-----------|-----|----------|--------|-------------------|
| 1 | `src/core/runtime.ts:934` | `AutoresearchEngine` constructed with `async () => null` no-op generator | HIGH | 30 min — wire real LLM generator via `runtime.query` | Unlocks Karpathy-autoresearch self-optimization; Tier-4 self-evolution activates |
| 2 | `src/providers/bedrock-signer.ts:150-201` | Body omits `toolConfig`; regex parser ignores `toolUse` events — tool calls silently dropped | CRITICAL | 2 days | Bedrock tool-use works end-to-end; capability claim stops lying |
| 3 | `src/providers/vertex-oauth.ts:179-245` | Hardcoded 5-field body drops `opts.messages/tools/systemPrompt`; stream parser only emits `text_delta` | CRITICAL | 2 days | Vertex multi-turn with tools & thinking streams works |
| 4 | `src/providers/registry.ts:176-180` | Azure URL puts query param before path segment — every Azure call 404s | CRITICAL | 0.5 day | Azure works at all |
| 5 | `src/providers/ollama-adapter.ts:331-342` | Missing `stopReason: "tool_calls"` — multi-turn agent loops die after 1 call | HIGH | 15 min | Multi-turn Ollama agents work |
| 6 | `src/providers/copilot-adapter.ts:346-355` | 401 response has no retry — user sees error | HIGH | 30 min | Better UX |
| 7 | `src/providers/copilot-adapter.ts:88-90` | Module-global cached token leaks across users | HIGH | 30 min | Multi-session safety; Gabriel quality bar |
| 8 | `src/providers/gemini-native-adapter.ts:162-174` | Data URL `mimeType` trusted verbatim — injection risk | HIGH | 30 min | Security-review gate |
| 9 | `src/providers/tool-parsers/parsers.ts:35-53` | `tolerantJSONParse` replaces `'`→`"` globally — corrupts JSON strings with legit apostrophes | MEDIUM | 30 min | Tool call reliability on natural-language-containing args |
| 10 | `src/browser/camoufox-backend.ts` | Fresh subprocess per call — no persistent stealth session | HIGH | 3 days | Real browsing/automation; matches Goose's computercontroller |
| 11 | `tests/mobile/ios-app.test.ts` + others | 40+ tautological `.toBeTruthy()` after own-constructor assertions, plus `fallback-e2e.test.ts:95` self-equality assertion | MEDIUM | 1 day | Test quality; mobile/iOS actually validated |

**Total fix effort**: ~10 engineering days. **Gate for shipping**: ALL must close before v0.4.0 label.

### New bugs from Wave 4 deep reads

The wave-4 deep reads (`CORE_DAEMON_DEEP_READ`, `PROVIDERS_MIDDLEWARE_DEEP_READ`, `MEMORY_ORCHESTRATION_DEEP_READ`, `UI_PLATFORMS_DEEP_READ`, `CHANNELS_ACP_CONNECTORS_DEEP_READ`, `RUNTIME_TS_TAIL_DEEP_READ`, `KAIROS_RPC_FULL_DEEP_READ`, `INDEX_TS_CLI_DEEP_READ`, `TAURI_RUST_DEEP_READ`) did not surface additional CRITICAL bugs beyond the 11 above. They instead surfaced the ~13 DEAD modules listed in §1 and confirmed the 11 bugs are the full production-blocking set. The `active-memory field bug` in the post-compaction handoff prompt is bug #1 in this table (AutoresearchEngine no-op).

### Bugs prior audits incorrectly flagged

Session-10 / Wave-4 corrections established these prior claims are FALSE:

- ❌ "8-file bootstrap never invoked" — FALSE. `prompt/engine.ts:208 assembleSystemPromptParts` reads all 8 files at every `initialize()`.
- ❌ "memoryMiddleware producer with no consumer" — FALSE. `runtime.ts:2569` Session-10 fix classifies `memoryCandidate` by tool name and inserts into `memory_entries` under working/patterns/reference/cases.
- ❌ "KnowledgeGraph every restart wipes graph" — FALSE. `runtime.ts:3533` `rehydrateKnowledgeGraph` on boot + `runtime.ts:3550` `persistKnowledgeGraph` atomic write on close.
- ❌ "decisionLedger getter-only dead code" — FALSE. `runtime.ts:3680 recordDecision()` dual-persists to in-memory ledger + `memoryStore.logDecision` SQLite.
- ❌ "Karpathy preamble never injected" — FALSE. Injected when `WOTANN_KARPATHY_MODE=1` env set.
- ❌ "Bedrock/Vertex auth fabricated" — FALSE. `bedrock-signer.ts:40-100` has full SigV4 HMAC. `vertex-oauth.ts:55-100` has RS256 JWT exchange. Only body construction is broken.
- ❌ "Runtime isn't persistent" — FALSE. Session state, stream checkpoints, shadow-git, knowledge graph, decision log, observation-extractor, autodream, cross-session-learner all persist to `.wotann/` subfolders.

---

## 3. Competitor Landscape — Complete Table (~45 competitors)

Version numbers verified 2026-04-18 from uncovered-repos and prior wave briefs. Install commands copied verbatim.

| # | Name | Version | License | Install | What WOTANN ports |
|---|------|---------|---------|---------|-------------------|
| 1 | anthropics/claude-code | GA bundle (curl installer) | Anthropic Commercial | `curl -fsSL https://claude.ai/install.sh \| bash` | plugin.json v2 schema; `/plugin marketplace`; `.claude-plugin/` separation; OTEL IDs; curl installer pattern |
| 2 | charmbracelet/crush | v0.3.x | Charm source-available | `brew install charmbracelet/tap/crush` | Mid-session LLM switch; per-provider hot-swap; NixOS/NUR; multi-channel packaging; session-based workspaces |
| 3 | paoloanzn/free-code | main@2026-04-01 | Unlicensed | git clone + bun build | 88-flag compendium; DCE telemetry at build; 5-provider env-var matrix; IPFS mirror |
| 4 | Significant-Gravitas/AutoGPT | v0.6.x | Polyform Shield/MIT blocks | docker-compose up | Block I/O schema; DAG retry budgets; credentials manager; block versioning; agent manifest.yaml |
| 5 | lobehub/lobe-chat | v1.30+ | Apache-style | `npm run start` / docker | Conversation branching; CoT inspector; MCP marketplace with health; PWA/mobile; Tauri+web mono |
| 6 | danny-avila/LibreChat | v0.7.x | MIT | docker-compose | Custom endpoints via YAML; multi-lang docker sandbox; RBAC + org; message FTS; `librechat.yaml` |
| 7 | letta-ai/letta | v0.8+ (letta-code npm) | Apache 2.0 | `npm i -g @letta-ai/letta-code` | Memory block primitive; compression+rehydration; subagent memory scoping; `letta-code` CLI; leaderboard |
| 8 | coollabsio/jean (jean.build) | v0.1.41 | Apache 2.0 | `brew install coollabsio/tap/jean` | Install paths; Plan/Build/Yolo modes; multi-CLI (Claude/Codex/Cursor/OpenCode); worktree-per-session; Linear+GitHub |
| 9 | Perplexity Computer | Feb 25 2026 launch (Max only) | Proprietary | Perplexity Max subscription | 5-step goal→subtask→sub-agents→async→self-correct; isolated compute; multi-model per-subtask routing |
| 10 | openclaw/openclaw (steipete) | latest | MIT | `npm install -g openclaw@latest && openclaw onboard --install-daemon` | Single-command install + dashboard; 11 channels; local port 18789 |
| 11 | NousResearch/Hermes-Agent | main | MIT | `curl -fsSL https://hermes.nous.ai/install \| bash` | Sandbox diversity (local/Docker/SSH/Daytona/Singularity/Modal); serverless persistence; OpenClaw migration |
| 12 | NousResearch/Hermes-Agent-Self-Evolution | main | MIT | via Hermes-Agent | DSPy + GEPA (ICLR 2026 Oral, MIT); 4-tier optimization skills→tool descs→prompt sections→code; MIPROv2 fallback; Darwinian Evolver |
| 13 | aaif-goose/goose (Linux Foundation) | post-move | Apache 2.0 | `brew install block-goose-cli` | ACP for Claude/ChatGPT/Gemini subscription; 70+ MCP extensions; 15+ providers; lsp_* tools |
| 14 | mksglu/context-mode | v1.x | ELv2 | (HN #1 570+ pts) | PreCompact hook blocks compaction; sandbox tool output isolation 315KB→5.4KB; think-in-code |
| 15 | coleam00/archon | main | MIT | git clone + cli | `.wotann/workflows/*.yaml` runner; deterministic node types (id/prompt/depends_on/loop with until/bash/interactive); 5 pillars |
| 16 | ByteDance/DeerFlow 2.0 | v2.x | Apache 2.0 | Python 3.12+ + Node.js 22+ | Loop detection hash keys; per-agent skill filter; compound command splitting; doc outline injection; Langfuse tracing |
| 17 | multica-ai/multica | main | Proprietary | `brew install multica-ai/tap/multica` | Register WOTANN as supported runtime type |
| 18 | EvoMap/Evolver | latest | GPL-3.0 → source-available | `node index.js` | GEP vs GEPA study; audit trail + genes + capsules + prompt governance |
| 19 | warpdotdev/warp | closed client + Oz platform | Closed | app download | Host-foreign-CLIs pattern; block-based terminal (OSC 133 parsing); Warp Drive workflows |
| 20 | CloverLabsAI/camoufox (fork) | alpha via pip | MPL-2.0 | `pip install cloverlabs-camoufox` | Subprocess boundary; stealth profiles; keep licensing clean |
| 21 | steipete/wacli | latest | MIT | `brew install steipete/tap/wacli` | Go + whatsmeow; SQLite FTS5 for WhatsApp channel; auth/sync/doctor/messages/history/media |
| 22 | BasedHardware/omi | 300K+ users | MIT | `git clone && cd omi/desktop && ./run.sh --yolo` | Single-command "no env, no credentials, no backend"; multi-platform capture; action items |
| 23 | farzaa/clicky | viral prototype | unclear | macOS 14.2+ app | ScreenCaptureKit; Cloudflare Worker proxy pattern for API keys; Bezier cursor grammar |
| 24 | HKUDS/DeepTutor | v1.1.2 | Apache 2.0 | Python 3.11+ + Next.js 16 + React 19 | Agent-native rewrite; Glass theme; multi-LLM (Qwen/vLLM/LM Studio/llama.cpp); native SDK (dropped litellm) |
| 25 | code-yeongyu/oh-my-openagent | SUL-1.0 | SUL-1.0 | git clone | Multi-model orchestration philosophy; Jobdori AI on OpenClaw fork |
| 26 | langchain-ai/open-swe | main | MIT | LangGraph + Deep Agents | `create_deep_agent(model, system_prompt, tools=[http_request,...], backend=sandbox_backend, middleware=[ToolErrorMiddleware])`; cloud sandboxes + Slack/Linear invocation + auto PR |
| 27 | wshobson/agents | v4.x | MIT | `/plugin marketplace add wshobson/agents` | 184 agents + 16 workflow orchestrators + 150 skills + 98 commands + 78 plugins; 3.6 components/plugin; Opus+Sonnet+Haiku tier |
| 28 | lsdefine/generic-agent | ~3K LOC | MIT | git clone + node | 9 atomic tools + ~100-line Agent Loop; self-bootstrap proof; <30K context philosophy; layered memory; Claude/Gemini/Kimi/MiniMax |
| 29 | tirth8205/code-review-graph | v1.x | MIT | Python 3.10+ | 8.2x token reduction; tree-sitter + incremental diff + MCP delivery; auto-detects 9 harnesses |
| 30 | OpenAI Codex CLI | v1.x | Apache 2.0 | `npm install -g @openai/codex` | `thread/fork`, `thread/rollback(n)`, `unified_exec` PTY, `shell_snapshot`, `request_rule`; bwrap/seatbelt/win-sandbox |
| 31 | OpenAI Agents Python SDK | v0.2+ | MIT | `pip install openai-agents` | Handoff; guardrails; traces |
| 32 | DSPy (Stanford) | v3.x | MIT | `pip install dspy-ai` | MIPROv2; signature compilation; GEPA integration |
| 33 | karpathy/andrej-karpathy-skills | latest | MIT | `git clone` | 4 engineering-discipline principles; autoresearch inspiration |
| 34 | openai-skills (OpenAI Skills v1) | v1 | MIT | — | Skill manifest schema; skill-test-harness |
| 35 | superpowers (plugin ecosystem) | v5.0.6 | MIT | Claude Code plugin | writing-plans, executing-plans, subagent-driven-development, verification-before-completion, brainstorming |
| 36 | addyosmani-agent-skills | latest | MIT | git | 7 reusable agent commands |
| 37 | zed-industries/zed | weekly builds | GPL/BSD dual | `brew install zed` | ACP host; 11 BYOK providers; collaborative cursors |
| 38 | sourcegraph/cody (amp closed) | amp closed | partial MIT | VS Code ext | Context engine for mega-codebases |
| 39 | dpcode/dpcode | latest | MIT | — | AI-coding editor reference; voice + glass UI |
| 40 | deepgemm | latest | MIT | CUDA lib | GEMM kernel tuning for local inference |
| 41 | deeptutor / deepagents / deep-agents (LangChain) | latest | MIT | langchain | deepagents 0.5 better-harness pattern |
| 42 | eigent | latest | MIT | git | multi-agent coordination reference |
| 43 | ampcode/homebrew-tap | latest | MIT | `brew install ampcode` | Amp install channel (closed client) |
| 44 | Osmani 7-commands | latest | MIT | git | workflow command reference |
| 45 | Cognee | v0.2 | Apache 2.0 | `pip install cognee` | Graph+vector dual retrieval; Zod EntityType; 14 search types |

Additional competitors tracked in `/research/competitor-analysis/*.md` (less critical for port list): self-evolving-agents (Reflexion+Voyager+DGM+STaR literature), claude-context (tree-sitter chunking + sqlite-vec), eigent, andy-avila patterns, autonovel, awesome-design-systems, claude-task-master, cognee, context-mode (listed above), deepagents, deer-flow (listed above as #16), deeptutor (listed above as #24), eigent, evolver (listed above as #18), gstack, opcode, openai-agents-python (listed above as #31), openai-skills (#34), ruflo, superpowers (#35), vercel-open-agents, addyosmani-agent-skills (#36). Plus closed-source addenda: Windsurf (Codeium), Amp (Sourcegraph).

---

## 4. The 15-Phase Execution Plan (Corrected After Wave 4)

Starts from V4 execution plan, corrected by wave-4 findings. Serial total 178–195 days; with 3 parallel streams (provider/benchmark + memory/learning + UI/channel) shrinks to ~65–75 calendar days. **Critical path Phase 0→1→4→7 = 46 days**, fitting the 56-day window to June 30 2026 Anthropic GA with 10 days of buffer.

### Phase 0 — HEAD verification sweep (1 day)
Grep each claim in this doc against current HEAD of `main`. Produce `verification-report-v4.md`. Check that Wave-4 deep read findings are still true at tip. Required before any code changes.

### Phase 1 — Fix the 11 verified bugs (3-5 days)
Per table in §2. Smallest high-impact fixes first. Gate: all 11 closed before moving to Phase 4.

1. Bug #5 Ollama stopReason — 15 min
2. Bug #1 AutoresearchEngine generator — 30 min (unblocks Tier 4)
3. Bugs #6, #7 Copilot — 1 hour combined
4. Bugs #8, #9 Gemini mimeType + tolerantJSONParse — 1 hour combined
5. Bug #4 Azure URL — 0.5 day
6. Bug #11 Tautological assertions — 1 day
7. Bug #2 Bedrock toolConfig + event decoder — 2 days
8. Bug #3 Vertex body + stream parser — 2 days
9. Bug #10 Camoufox persistent subprocess — 3 days

### Phase 2 — Consolidate parallel implementations (2 days)
Delete orphan `persona.ts loadBootstrapFiles/buildIdentityPrompt`. Delete duplicate `memory_search_in_domain`. Rename `turboquant.ts` → `ollama-kv-compression.ts` (session-10 confirmation). Merge duplicate `channels/adapter.ts` + `channels/supabase-relay.ts` + `channels/knowledge-connectors.ts` into live paths. **Do NOT delete** any dead modules without direct grep confirming zero production callers — per Gabriel's explicit "zero deletions" mandate (Phase 14 scope only).

### Phase 3 — Wire the learning stack chain (3 days)
Wire `AutoresearchEngine` generator + activate conversation auto-persist → observation-extractor → dream pipeline → instinct system → skill-forge → self-evolution chain. Current state: 12 files in `src/learning/` produce ZERO output. Wire conversation end hook in `runtime.close()` to persist. This is the **learning-stack chain fix** referenced in the handoff.

### Phase 4 — Benchmark harness (20 days) [CRITICAL PATH]
Per V3 Tier 1 + BENCHMARK_BEAT_STRATEGY Sprint B1. Wire `src/intelligence/benchmark-harness.ts` placeholders to real TerminalBench/SWE-bench/LCB/Aider/τ-bench/GAIA runners. Add better-harness pattern (deepagents 0.5). Build `WOTANNBench` — self-authored leaderboard category with 20 held-out tasks grown from weekly sampling of SWE-bench Live. Self-consistency voting wired to `council.ts`. Verifier-gated completion wired to `autopilot/completion-oracle.ts` (DEAD until now; refactor to accept pre-collected evidence). 

**Target**: Top-3 on TerminalBench + SWE-bench Verified + Aider Polyglot at `WOTANN-Free` (Groq/Cerebras/DeepSeek/Gemini free-tier only) and Top-3 at `WOTANN-Sonnet` (≤$5 Sonnet 4.6 verifier cap). Publish both tables per benchmark with ablation "harness on/off" delta.

### Phase 5 — Codex + Goose parity (15 days)
- ACP host compliance (~600 TS LOC per session-10 wave-5 estimate) — lets Claude/ChatGPT/Gemini subscriptions plug in
- `thread/fork(numTurns)` + `thread/rollback(n)` for precise undo
- `wotann mcp-server` mode — WOTANN hostable by Cursor/Claude-Code/etc.
- `unified_exec` PTY-backed tool (vim/less/python REPL)
- `shell_snapshot` cache
- `request_rule` smart approvals
- 6 sandbox backends: keep Docker, add Daytona + Modal + Singularity + SSH + local
- Wire existing `src/lsp/` as agent tools (`lsp_references/definition/hover/symbols/rename`) — Goose parity

### Phase 6 — Memory upgrades to 98.6% Supermemory parity (15 days)
- Supermemory dual-layer timestamps + 3 relationship types
- MemPalace wing/room/hall hierarchy
- Cognee 14 search types
- Tree-sitter AST chunking via web-tree-sitter WASM
- sqlite-vec virtual tables (10-100x faster KNN)
- Contextual embeddings (+30-50% recall per Anthropic)
- Typed EntityType schemas (Zod + LLM structured output)
- Incremental index by file-SHA hash
- Query reformulation + multi-query + HyDE (Archon)
- Mode registry + mode-scoped memory
- Project/task scope columns

### Phase 7 — DSPy + GEPA self-evolution (20 days) [CRITICAL PATH]
ICLR 2026 Oral, MIT license, no GPU required, ~$2-10/run. 4-tier optimization: skills → tool descs → prompt sections → code. Wire to existing `skill-forge` + `observation-extractor` + benchmark harness from Phase 4. MIPROv2 fallback. Darwinian Evolver for code tier. **This is the benchmark moat** — lets WOTANN beat SOTA by evolving its own harness, not by upgrading models.

### Phase 8 — Context-Mode parity (15 days)
PreCompact hook blocks compaction + sandbox tool output isolation (315KB→5.4KB 98% reduction) + think-in-code enforcement. The HN #1 approach. LLM writes code that produces result, not LLM processes data.

### Phase 9 — Archon workflow YAML runner (3 days)
`.wotann/workflows/*.yaml` runner with deterministic node types: id/prompt/depends_on/loop with until/bash/interactive. Seed three workflows: `build-feature.yaml`, `fix-bug.yaml`, `review-pr.yaml`.

### Phase 10 — UI/UX per UI_DESIGN_SPEC_2026-04-16 (30 days)
5 themes + 7 signature interactions + 3 layouts + 10 micro-interactions + 5 onboarding flows + sound + mobile. Sidebar redesign structural decisions. Liquid Glass HUD (`backdrop-filter: blur(20px) saturate(180%)`) on QuickActionsOverlay + palette + Sidebar. Unified design tokens build script emitting to CSS + Swift + Ink from single source. Block-based terminal refactor with OSC 133 parsing. Bezier cursor overlay + `[POINT:x,y]` grammar. "Ask about this window" via ScreenCaptureKit + OCR. Global hotkey palette via Tauri `global_shortcut`. Premium macOS-native feel, not mockup copy — per Gabriel direction.

### Phase 11 — Skill library to ~130 (25 days, parallel with 10)
Port top-30 from Superpowers + OpenAI Skills + Karpathy 4 principles + Osmani 7 commands. OpenClaw 560+ catalog scan (pick 20). wshobson 184-agent scan. skill-test-harness + OpenAI Skills v1 schema adoption.

### Phase 12 — Channel parity 17→24 (10 days)
Add Mastodon, Twitter/X DM, LinkedIn, Instagram, WeChat, Line, Viber. Feishu interactive cards. Slack thread auto-respond. Telegram message reactions. OpenRouter variant tag preservation (Hermes patterns).

### Phase 13 — FUSE security moat (15 days)
Linux FUSE + macOS APFS snapshots + Windows ProjFS + seccomp BPF filter. Appendix E.4 shipped. Currently entirely missing.

### Phase 14 — Zero-deletion dead code audit (1 day)
Grep each of the 13 DEAD modules (§1) against production call sites. Per Gabriel's "before you plan to delete anything, ensure that it wouldn't help in any way before removing it." Reference `DEAD_CODE_REPURPOSING_2026-04-18.md` — zero modules warrant deletion; all wire. Wire the entire list per dependency order:

1. `meet/meeting-store.ts` + `kairos-rpc.ts:4796,5047 getMeetingStore` callback (30 min)
2. `meet/coaching-engine.ts` + `meet/meeting-pipeline.ts` (2-3h)
3. `autopilot/completion-oracle.ts` (3-4h) + `autopilot/pr-artifacts.ts` (1-2h)
4. `computer-use/perception-adapter.ts` (2-3h)
5. `channels/auto-detect.ts` refactor → `channels/route-policies.ts` wire
6. `skills/self-crystallization.ts` wire (depends on oracle, 2h)
7. `agents/required-reading.ts` (2-3h)
8. `training/autoresearch.ts llm-modification-generator.ts` (4-6h)
9. `testing/visual-diff-theater.ts` (3-5h)
10. `channels/terminal-mention.ts` (1-2h)

Aggregate: **~3,600 LOC recovered in 30-45 engineering hours**, closing major Tier-1 feature gaps (verifier oracle, perception multi-provider, policy engine, autoresearch, self-crystallization).

### Phase 15 — Ship v0.4.0 MVP (5 days)
Download page matching jean.build. Homebrew tap + NPM global + `curl|sh` installer + macOS DMG + Windows EXE/MSI + Linux AppImage/DEB/RPM for x64+ARM. wotann.com marketing page. Announcement post referencing two-table benchmark results (`WOTANN-Free` + `WOTANN-Sonnet`) with ablation deltas on TerminalBench + SWE-bench Verified + Aider Polyglot. Public SWE-bench Live nightly cron publishing to `wotann.com/bench`. **This is the moat**: nobody else runs a zero-cost leaderboard publicly.

---

## 5. Dependencies + Critical Path

```
Phase 0 (1d) → Phase 1 (5d) → Phase 2 (2d) → Phase 3 (3d) → Phase 4 (20d) → Phase 7 (20d) = 51 days critical path
                                                          ↘ Phase 5 (15d) → Phase 9 (3d)
                                                          ↘ Phase 6 (15d) → Phase 8 (15d)
                                                          ↘ Phase 10 (30d, parallel) + Phase 11 (25d, parallel)
                                                          ↘ Phase 12 (10d, parallel) + Phase 13 (15d, parallel)
                                                          ↘ Phase 14 (1d, interleave)
                                                          ↘ Phase 15 (5d, serial-last)
```

Phase 15 cannot start until Phases 1, 4, 7 close (bugs fixed, benchmark numbers published, self-evolution demonstrated). Phase 10 + 11 + 12 + 13 run in parallel against Phase 4–9 on a second stream (UI engineer + skills curator). Phase 14 is interleaved as a 1-day budget spread across sessions.

**Serial critical path**: 1 + 5 + 2 + 3 + 20 + 20 + 5 = **56 days**. **Target ship**: June 30 2026 Anthropic Claude Apps GA. **Buffer**: 44 days if starting today (2026-04-18); 10 days if the critical path slips 30%.

---

## 6. Known Blockers

1. **AutonomousExecutor ECANCELED** — `wotann autonomous edit-file` → `node:fs:732 Error: ECANCELED: operation canceled, read` at ESM load. Likely an import dep cycle on Ollama adapter under autonomous orchestration. Investigation needed before Phase 4 benchmark runs can use `autonomous` mode.
2. **Real-MiniLM branch in quantized-vector-store.test.ts silently skips** — must be required in CI before v0.4.0 or quantization quality claim is unverified.
3. **Zero iOS XCTest coverage** — 120+ Swift files, no test target. Blocks "iOS production ready" claim.
4. **Zero Rust `#[test]` in src-tauri** — commands.rs/state.rs/hotkeys.rs/permissions.rs untested. Blocks "Tauri production ready" claim.
5. **Zero desktop-app React component tests** — Editor/Bridge pairing untested.
6. **FUSE sandbox missing** — Appendix E.4 spec claim. Phase 13 blocker.
7. **MCP marketplace hardcoded stub** — `registry.wotann.com` fake; hardcoded 5 entries. Must wire real registry backend (Supabase or GitHub Pages static index) or delete and rely on `wotann mcp import --from-claude`.
8. **Doc drift across 20 docs** — CLAUDE.md says "11 providers" (actual 19); CHANGELOG says "17-provider adapter system" (drift); `WotannEngine` mentioned in docs but class doesn't exist (composition root is `WotannRuntime`); NEXUS_V1/V2/V3/V4_SPEC.md legacy names in root must archive.
9. **Screenshot clutter** — `/agent-harness/` top-level has 40+ PNG screenshots; candidate for `/screenshots/archive/` folder (not a blocker but looks messy pre-ship).
10. **Legacy orphan directories** — `.abstract.md`, `.claude-flow/`, `.nexus/`, `.swarm/`, `wotann-old-git-20260414_120728/` (624MB packfile). Keep until verified safe to delete.
11. **Provider rate limits** — Groq/Cerebras free tiers are generous but not infinite. Full TB run may need provider rotation mid-run; `fallback-chain.ts` must handle. If it doesn't, overnight runs will fail.
12. **Contamination in HumanEval/MBPP** — Llama 3.3 / DeepSeek v3 training cutoffs likely include those benchmarks. Publish with "may include contamination" footnote. Use post-cutoff slice for LCB and SWE-bench Live only.
13. **OSWorld + MLE-bench compute** — Require local GPU + VM orchestration. Schedule for Sprint B3, not B1. Budget estimate $220–1,100 per MLE-bench Lite full run due to GPU rental.

---

## 7. References

Every claim in this synthesis traces to one of the following documents. All paths absolute.

### Wave 4 deep reads (direct source reads)
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/CORE_DAEMON_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/PROVIDERS_MIDDLEWARE_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/MEMORY_ORCHESTRATION_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/UI_PLATFORMS_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/CHANNELS_ACP_CONNECTORS_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/RUNTIME_TS_TAIL_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/KAIROS_RPC_FULL_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/INDEX_TS_CLI_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/TAURI_RUST_DEEP_READ_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/NEXUS_V4_SPEC_SYNTHESIS_2026-04-18.md`

### Audit + plan + strategy
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/MASTER_AUDIT_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/AUTONOMOUS_EXECUTION_PLAN_V4_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/BENCHMARK_BEAT_STRATEGY_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/_DOCS_AUDIT_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/DEAD_CODE_REPURPOSING_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/DOCS_FULL_READ_SYNTHESIS_2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/CLAUDE_CODE_QUICKSTART_2026-04-18.md`

### Competitor analysis
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/uncovered-repos-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/ai-coding-editors-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/terminals-conductor-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/gemini-macos-tools-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/skill-libraries-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/self-evolving-agents-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/browser-codex-tutoring-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/memory-context-rag-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/openai-agents-infra-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/missed-competitors-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/perf-design-analysis-2026-04-18.md`
- `/Users/gabrielvuksani/Desktop/agent-harness/research/competitor-analysis/repo-code-extraction-2026-04-18.md`

### Engram memory (50+ topic keys)
- `wotann/audit-architecture`, `wotann/audit-providers`, `wotann/audit-ui-ux`, `wotann/audit-tests`, `wotann/audit-spec-drift`
- `wotann/benchmark-strategy`, `wotann/memory-upgrades`, `wotann/native-app-research`, `wotann/self-evolution-plan`
- `wotann/browser-codex`, `wotann/ai-editors-research`, `wotann/skill-port-plan`
- `wotann/wave3-ground-truth`, `wotann/wave3-repos-batch1-5`, `wotann/deep-audit-full`, `wotann/repo-research-updates`
- `wotann/depth-sidebar-redesign`, `wotann/bootstrap-correction`, `wotann/prior-audit-corrections`
- `wotann/execution-plan-v4` — definitive pointer to V4 plan
- `cases/*`, `patterns/*`, `known-issues/*` per memory-taxonomy
- Sessions 1–5 transcripts under `~/.claude/session-data/2026-04-*-wotann-session*`

---

## 7a. Benchmark-By-Benchmark Target Scores + Harness Readiness

From `BENCHMARK_BEAT_STRATEGY_2026-04-18.md`, condensed. Two numbers per benchmark: `WOTANN-Free` (Groq/Cerebras/DeepSeek/Gemini free tiers, $0) and `WOTANN-Sonnet` (≤$5 Sonnet 4.6 verifier cap). Harness-on-vs-off ablation published for top 3 benchmarks.

| Benchmark | Zero-cost baseline | Zero-cost target | Sonnet-capped target | Opus-ceiling | SOTA today | WOTANN readiness |
|-----------|-------------------|------------------|---------------------|--------------|-----------|------------------|
| TerminalBench (Stanford/Laude) | 60% | 76% | 87% | 90% | ~80–83% | Has trajectory-scorer, doom-loop detector, pre-completion checklist. Needs tmux_send_keys/tmux_snapshot, bg_start/bg_logs/bg_kill, sticky plan.md binding to TB runner. 2-week sprint. |
| SWE-bench Verified | 55% | 68% | 78% | 84% | ~80–82% | Has self-healing-pipeline scaffold. Needs BM25+embedding repo-retriever, read-before-edit extended to imports+test triangulation, multi-patch voting with 3 worktrees, regression-aware diff-size selection, anti-patch-the-test guard. ~$15 Sonnet-verifier cost per full run. |
| SWE-bench Lite | 62% | 73% | 82% | 85% | ~78–80% | Same backlog as Verified, skip multi-patch voting if cost-tight. ~$3–8 per full run with Sonnet. |
| SWE-bench Full | 38% | 48% | 58% | 62% | ~50–55% | Same as Verified + issue-ambiguity detector (if <100 words or "not sure"/"maybe" → deep-research preamble). |
| SWE-bench Live | 60% | 72% | 75% | 78% | ~65–72% | Same backlog. **Continuous eval cron publishing nightly to wotann.com/bench is the marketing moat — nobody else runs this publicly.** |
| HumanEval+ | 85% | 92% | 96% | 97% | ~95% | Saturated. pass@10 with self-consistency voting. Prompt simplification preamble for small models. Essentially $0. |
| MBPP+ | 87% | 92% | 95% | 96% | ~94% | Same as HumanEval+. $0. |
| LiveCodeBench | 52% | 58% | 65% | 68% | ~55–68% | Competitive programming preamble + self-repair loop (LCB subtask 2 boosts subtask 1) + adversarial example generator + complexity-aware routing (easy→Groq, hard→Sonnet). ~$4/run. |
| AgentBench | 55% | 63% | 72% | 75% | ~70–75% | Subtask-specialized prompts via task-semantic-router.ts. Tool availability per subtask. Persistent per-turn memory for Card Game. $10–20 with Sonnet. |
| WebArena | 28% | 36% | 46% | 50% | ~45–50% | Audit a11y-tree DOM nav + pixel screenshots + form-fill + wait-for-network-idle. Deep-research mode wire. Gemini 3.1 vision free-tier. ~800 tasks, $50–100 Sonnet. |
| VisualWebArena | 25% | 32% | 38% | 42% | ~35–42% | Same as WebArena + Gemini vision. |
| BrowseComp | 18% | 28% | 38% | 44% | ~45–55% | Needs stronger search integration. Brave/Tavily free tier. V2 goal. |
| MLE-bench Lite | n/a (GPU) | n/a | 20% | 28% | ~25–40% | Long-horizon autopilot checkpoint/resume. GPU-aware tool surface. Kaggle skills pack. Artifact caching. GPU rental $220–1,100 per full run. Sprint B3. |
| BigCodeBench | 58% | 66% | 74% | 77% | ~60–75% | Library-aware retrieval preamble. Post-gen mypy --ignore-missing-imports. Import hygiene auto-fixer. ~$5–10 Sonnet. |
| GAIA (Meta) | 50% | 60% | 70% | 75% | ~72–77% | Robust file-parsing (PDF/Excel/DOCX/images). Brave/Tavily search with caching. Gemini vision. Answer normalization post-processor. ~$5–15 Sonnet. |
| ARC-AGI 2 | 5% | 10% | 15% | 25% | ~30–55% | Not WOTANN's moat. Defer. Aspirational only. |
| Aider Polyglot | 62% | 72% | 83% | 87% | ~75–85% | Edit tool already uses exact-string replace (most robust). Per-language preambles. Compile-before-submit. Whole-file fallback after 3 diff-edit failures. ~$2–5 Sonnet. |
| τ-bench retail | 50% | 60% | 72% | 76% | ~70–75% | Policy-awareness guard + deterministic tool calling + per-turn self-check + pass^k temp=0 on tool phase. ~$2–5 per run. |
| τ-bench airline | 40% | 50% | 62% | 66% | ~55–65% | Same as retail. Harder domain. |
| OSWorld | 12% | 20% | 32% | 40% | ~35–40% | Computer-Use harden (real pixel-click via Xdotool/pyautogui). Sonnet 4.6 native computer-use API as primary path. UI-tree fallback via AT-SPI/UIAutomation. Action replay/undo stack. $50–150 per full run. |

**Publishable positioning**: after the 30-item backlog in `BENCHMARK_BEAT_STRATEGY §Top 30`, WOTANN realistically claims **top-3 on 7 benchmarks** at zero cost (TerminalBench, SWE-bench Lite, HumanEval+, MBPP+, Aider Polyglot, τ-bench retail, LiveCodeBench) and **SOTA-tier on 4 benchmarks** with the ≤$5 Sonnet tier (TerminalBench, SWE-bench Verified, SWE-bench Live, Aider Polyglot). That is a publishable, differentiated leaderboard with clear harness ablation.

## 7b. Cross-Cutting Engineering Backlog (Ranked By ROI)

Ordered by (expected score gain) × (benchmarks affected) / (engineering weeks). This is the prioritized Phase-4 work-queue that feeds into `WOTANN-Free` + `WOTANN-Sonnet` numbers:

1. Multi-trajectory self-consistency with voting — wire `src/orchestration/council.ts` to benchmarks. **Affects 6 benchmarks, +3–6% each.**
2. BM25 + embedding repo retrieval — `src/intelligence/repo-retriever.ts`. **Affects SWE-bench ×4 + Aider, +5–8%.**
3. Verifier-gated completion with cheap-model self-critique. **Affects 10+ benchmarks, +2–4%.**
4. Self-healing pipeline for test failures — existing `src/orchestration/self-healing-pipeline.ts`. **Affects 5 benchmarks, +3–5%.**
5. Tmux / interactive-process tool surface — new tool. **+5–10% on TB alone.**
6. Task-type semantic routing — existing `src/intelligence/task-semantic-router.ts`. **Affects 7 benchmarks, +2–3%.**
7. Sticky planning scratchpad (task-lifetime `plan.md`). **Affects 4 benchmarks, +3–5%.**
8. File-parsing tools (PDF/Excel/DOCX/images). **+8–15% on GAIA.**
9. Per-language compile-before-submit (Rust/Go/C++/Java). **Affects Aider + BigCodeBench, +3–5%.**
10. Cheap provider fallback chain — `src/providers/fallback-chain.ts` tuned for benchmark throughput.
11. Benchmark-runner adapters — `src/intelligence/benchmark-harness.ts` currently placeholders. **Unblocks everything.**
12. Hidden-test-aware patch scoring — run all existing tests, score by `pass_delta`. **Affects SWE-bench + Aider, +2–4%.**
13. Adversarial test generator — second cheap model produces 3 adversarial inputs. **Affects 4 benchmarks, +2–4%.**
14. Answer-normalization post-processor ("The answer is: X" → "X"). **+3–5% on GAIA.**
15. Search-provider integration (Brave free + Tavily free + caching). **+5–10% on BrowseComp.**
16. Vision-model routing (Gemini 3.1 free tier for image tasks). **+5–10% on 3 benchmarks.**
17. Policy-document injection per session. **+4–6% on τ-bench.**
18. Deterministic tool-call schema enforcement. **Affects τ-bench + AgentBench, +3–5%.**
19. Long-horizon autopilot checkpointing (24h+ runs). **Unblocks MLE-bench.**
20. Sandboxed multi-patch voting — 3 patches, 3 worktrees, pick by test-pass count + diff-size. **Affects SWE-bench ×4, +3–5%.**
21. Repo-wide symbol index (LSP). **Affects SWE-bench + Aider + TB, +2–4%.**
22. Cost + wall-clock budget enforcement.
23. Trajectory caching / artifact memo — `src/orchestration/proof-bundles.ts`.
24. Adversarial self-critique agent (red/blue teaming). **+2–3% on 3 benchmarks.**
25. Memory across turns (episodic recall). **+2–4% on 3 benchmarks.**
26. Import-hygiene auto-fixer. **+1–2% on 3 benchmarks.**
27. Test-time fine-tuning with small local Gemma 4. **Marginal; experimental.**
28. Sandboxed GPU tool-surface (nvidia-smi, torch wrappers). **Unlocks MLE-bench.**
29. Screen-operation retry / undo stack. **+4–6% on OSWorld.**
30. ARC-AGI tree-search + DSL. Defer to v2.

**Sequencing**: items 1–11 for Sprint B1 (~2 weeks, Phase 4 week 1-2) — moves TB, SWE-bench, Aider to top-3 tier. Items 12–22 for Sprint B2 (~2 weeks, Phase 4 week 3-4) — unlocks τ-bench, GAIA, LiveCodeBench. Items 23–30 opportunistically in Phase 5 windows or deferred.

## 7c. Zero-Cost Provider Routing Plan

The whole point of "WOTANN-on-benchmarks-at-zero-cost" is defensible routing. Canonical tier map:

| Tier | Provider | Free-tier limit | Role |
|------|----------|-----------------|------|
| Hot path: planning + short reasoning | Groq (Llama 3.3 70B, Mixtral) | ~14,400 RPD free | Instant planning, classification, retrieval re-rank |
| Hot path: code gen (cheap bulk) | DeepSeek v3 ($0.14/1M in) or Cerebras Qwen 3 Coder 480B | Cerebras: ~1M tokens/min free | Patch generation, file edits |
| Hot path: long context (1M) | Gemini 3.1 Pro (free tier via AI Studio) | ~1,500 RPD free | Large repo traversal, MLE-bench preamble |
| Hot path: local / always-available | Ollama — Gemma 4, Qwen 3 Coder 32B | unlimited | Parse-heavy background tasks, test-time fine-tune |
| Verifier / hard steps | Claude Sonnet 4.6 | paid ~$3/1M in | Final-answer adjudication, hard SWE-bench patches (≤10% of calls) |
| Ceiling run (leaderboard submissions) | Claude Opus 4.6 | paid ~$15/1M in | Post-SOTA numbers; tiny % of calls |

Routing rules in `src/providers/model-router.ts`:

1. Default model = Groq Llama 3.3 70B
2. If task requires >32k tokens of code context → DeepSeek or Gemini 3.1 Pro
3. If task is planning/classification → Groq
4. If task is verification → Sonnet 4.6 (cap: 10% of total calls per session)
5. If free-tier rate-limited → fall back to next tier via `fallback-chain.ts`
6. If task requires vision → Gemini 3.1 Pro free-tier (or Sonnet for verification)
7. If task is long-horizon autonomous → Gemini 3.1 Pro (1M context avoids compaction)

**Publishable honesty**: publish every benchmark as two numbers — `WOTANN-Free` ($0) and `WOTANN-Sonnet` (≤$5 Sonnet 4.6). No other harness posts zero-cost leaderboards. This positions WOTANN as uniquely defensible.

## 8. Target State On Ship Day (v0.4.0, June 30 2026)

- All 11 bugs closed; capability-lying providers either fixed or removed from the adapter list
- Benchmark harness wired; `WOTANN-Free` + `WOTANN-Sonnet` two-table leaderboard live at `wotann.com/bench`
- Top-3 claim on TerminalBench + SWE-bench Verified + Aider Polyglot with `WOTANN-Sonnet` cap
- Top-3 claim on SWE-bench Live (contamination-free, the publicly defensible SOTA)
- DSPy + GEPA self-evolution wired to nightly skill-forge
- ACP host compliant (Claude/ChatGPT/Gemini subscription plug-ins)
- 6-backend sandbox matrix (Docker/Daytona/Modal/Singularity/SSH/local)
- Memory at 98.6% Supermemory parity; tree-sitter AST + sqlite-vec + contextual embeddings
- 130+ skill library with OpenAI Skills v1 manifest format
- 24-platform channel parity (add Mastodon/Twitter/LinkedIn/Instagram/WeChat/Line/Viber)
- FUSE sandbox shipped (or spec claim cut)
- 13 dead modules wired (no deletions per Gabriel mandate)
- Liquid Glass UI on QuickActions + palette + Sidebar; block-based terminal; unified design tokens
- iOS XCTest + Rust `#[test]` + desktop-app React tests = minimum coverage (target 80%)
- Zero hardcoded secrets; no capability lies
- Download page at wotann.com with Homebrew + NPM + curl|sh + DMG + EXE/MSI + AppImage/DEB/RPM x64+ARM
- Single `wotann benchmark run <name>` command with pinned Docker image `wotann-bench:2026.06`
- Public SWE-bench Live nightly cron publishing rolling numbers
- Ablation deltas (`harness on vs off`) publicly verifiable

**Positioning claim**: *"WOTANN is the first open-source harness that hits top-3 on TerminalBench, SWE-bench Verified, SWE-bench Live, Aider Polyglot, and τ-bench on a single code path at $0 baseline inference cost (Groq/Cerebras/DeepSeek free tiers), scaling to SOTA when paired with Sonnet 4.6 or Opus 4.6."*

This is the target. The plan from today to ship: Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 7 → Phase 15, with Phases 5/6/8/9/10/11/12/13 in parallel streams. 56 days critical path. 44 days buffer. Let's ship.
