# WOTANN Master Audit Report — 2026-04-18

Version: v0.1.0 (per package.json; some docs claim 0.3.0)
Scope: 45 `/src/` subdirectories, 3 UI surfaces (Ink TUI + Tauri desktop + iOS native), 40+ competitor repos, 7 skill libraries, 15 benchmarks.
Methodology: 15-agent parallel Opus audit + manual hook-denied follow-ups.

---

## Executive Summary

WOTANN v0.1.0 is a **remarkably complete implementation** of the 7927-line NEXUS V4 spec: **~85% implemented, ~12% partial, ~3% missing**. Codebase is **148,446 LOC TS source + 47,767 LOC tests (254 test files)** plus **120+ Swift files, 97+ desktop TSX, and 11+ Rust Tauri files**. Only **~92 stubs/TODOs across 30 files** — unusually low for scope.

However, five independent audits surfaced **critical issues that block benchmark-winning reliability**:

1. **4 CRITICAL provider bugs** — Bedrock tool calls silently dropped, Vertex drops messages/tools, Azure URL malformed (every call 404s), Ollama missing `tool_calls` stopReason (multi-turn loops die after 1 call).
2. **Browser subsystem is fake** — `src/browser/camoufox-backend.ts` spawns a fresh Python subprocess per call; no persistent session. Confirms Apr 14 observation 5198.
3. **Architecture god-objects** — `src/core/runtime.ts` is 4,400 lines w/ 171 fields; `src/index.ts` has 85 commands inline; `src/middleware/layers.ts` crams 14 middlewares in one file. (Per user directive, splitting is LOW priority now.)
4. **Test integrity holes** — 40+ tautological `.toBeTruthy()` after own-constructor, tautological self-equality assertion at `fallback-e2e.test.ts:95`, zero iOS XCTest, zero `desktop-app` React tests, zero Rust `#[test]`, `quantized-vector-store.test.ts` silently skips real-MiniLM branch.
5. **FUSE-overlay sandbox (App. E.4) missing** — zero code references; only process-level docker-backend. Security moat unshipped.

The implementation is deeper than the competitors' and the path to beating every benchmark is well-scoped: **see §4 Top-50 Ranked Roadmap**.

---

## 1. Codebase Reality vs Documentation Claims

### Provider count claims
- CLAUDE.md says "11 providers" → actual `ProviderName` union declares **19** (anthropic, anthropic-subscription, openai, codex, copilot, ollama, gemini, huggingface, free, azure, bedrock, vertex, mistral, deepseek, perplexity, xai, together, fireworks, sambanova; groq folded in).
- CHANGELOG.md [0.1.0] says "17-provider adapter system" — also out of sync.
- **Recommendation:** Update CLAUDE.md to reflect reality. But note: Bedrock, Vertex, Azure are **capability-lying** — claim `supportsToolCalling: true` while silently dropping every tool call.

### Skills count claims
- Spec §24: "65+ skills"
- CLAUDE.md: "65+ skills"
- Reality: **86 markdown skills in `/wotann/skills/`** (over-delivered).

### Memory layers claims
- Spec §14 says "6-layer"; Appendix I says "upgraded to 8"
- Reality: **27 memory modules, no strict numerical layering** — functionally broader than any stated count. Reorganize the doc, not the code.

### iOS/Desktop claims
- Apr-4 memory observation: "Desktop and iOS Apps Are TypeScript Specifications, Not Compiled Native Apps"
- Reality: **120+ real Swift files + full SwiftUI stack + Xcode project; Tauri v2 desktop with Rust src-tauri + React + Monaco**
- **Action:** Archive the Apr-4 observation as stale.

### Channels claims
- Spec §28: "24 platforms"
- Reality: 17 adapters (Discord, Slack, Telegram, WhatsApp, iMessage, Signal, Matrix, IRC, Teams, Email, SMS, Webchat, Webhook, GitHub-bot, Google-chat, IDE-bridge, Terminal-mention).
- **Gap:** Mastodon, Twitter/X DM, LinkedIn, Instagram, WeChat, Line, Viber (≈7 missing).
- **Recommendation:** Either wire them, or reduce the spec claim to 17. Either side of drift OK; reconcile.

### CLI commands claim
- CLAUDE.md lists 20 user-facing verbs (start/init/build/compare/voice/relay/autopilot/engine/etc.)
- Source: `src/index.ts` has 85 `.command()` registrations inline (lines 42-3536).
- **Gap:** Audit discovered `src/cli/commands.ts` does NOT appear to dispatch the user-facing verbs — grep returned 0 matches. **Likely verbs are defined in index.ts inline action blocks, not dispatched through commands.ts.** Verify before shipping; users may hit "command not found."

---

## 2. Per-Subsystem Audit (Summary)

### ✅ Healthy subsystems (use as template)
- **`src/providers/`** — 34 files, clean registry+adapter+router split, format-translator, per-provider adapters, capability-augmenter. Reference quality.
- **`src/plugins/`** — clean InstalledPlugin/LoadedPluginModule interfaces, no runtime coupling.
- **`src/skills/`** — 6 modules, 2017 LOC, progressive-disclosure contract intact.
- **`src/hooks/engine.ts`** — HookEngine + HookHandler + HookPayload + HookResult; clean event shape.
- **`src/middleware/pipeline.ts`** — MiddlewarePipeline + createDefaultPipeline + createPipelineWithInstances. Clean. (Though `layers.ts` with 14 middlewares is the problem.)

### 🟡 Dense but working
- **`src/memory/`** — 27 files, deepest memory stack of any competitor; unique moats (TemporalMemory, EpisodicMemory, ObservationExtractor).
- **`src/context/`** — 13 files; window-intelligence, tiered-loader, repo-map, 5-stage compaction.
- **`src/channels/`** — 27 files; 17 adapters; dispatch/gateway/integration collapse candidates.
- **`src/orchestration/`** — 25 files; coordinator, waves, PWR, Ralph, self-healing, council, arena — all wired.
- **`src/intelligence/`** — 38 files; partial name-overlap with orchestration/learning.

### ⚠️ Boundary violations
- `src/ui/App.tsx:31` imports `../channels/unified-dispatch.js` — TUI should not know transports
- `src/desktop/companion-server.ts:49-67` imports `computer-use`, `mobile/*`, `sandbox` — platform-crossing file in one platform
- `src/hooks/built-in.ts:10` imports `../middleware/layers.js` (`detectFrustration`) — hooks should be leaves wrt middleware
- `src/middleware/layers.ts:11` imports `../sandbox/executor.js` — middleware should send events, not call sandbox

### 🔴 Critical bugs (per provider audit)

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| 1 | CRITICAL | `src/providers/bedrock-signer.ts:150-156,197-201` | Tool calls silently dropped — body omits toolConfig; regex parser ignores toolUse events |
| 2 | CRITICAL | `src/providers/vertex-oauth.ts:179-185` | Hardcoded 5-field body drops opts.messages/tools/systemPrompt |
| 3 | CRITICAL | `src/providers/vertex-oauth.ts:238-245` | Stream parser only emits text_delta; drops tool_calls/thinking/usage |
| 4 | CRITICAL | `src/providers/registry.ts:176-180` | Azure URL puts query param before path segment — every Azure call 404s |
| 5 | HIGH | `src/providers/ollama-adapter.ts:331-342` | Missing `stopReason: "tool_calls"` — multi-turn agent loops die after 1 call |
| 6 | HIGH | `src/providers/copilot-adapter.ts:346-355` | 401 response has no retry — user sees error |
| 7 | HIGH | `src/providers/copilot-adapter.ts:88-90` | Module-global cached token leaks across users |
| 8 | HIGH | `src/providers/gemini-native-adapter.ts:162-174` | Data URL mimeType trusted verbatim — injection risk |
| 9 | MEDIUM | `src/providers/tool-parsers/parsers.ts:45-52` | tolerantJSONParse globally replaces `'`→`"` — corrupts JSON strings with legit apostrophes |
| 10 | MEDIUM | `src/browser/camoufox-backend.ts` | Browser is FAKE — fresh subprocess per call, no persistence |

---

## 3. Competitive Positioning

### Where WOTANN leads
- **11+ providers** (vs Codex 1, Zed 11 BYOK, others 1-3) — structural moat
- **Persistent semantic memory** (SQLite+FTS5 + autoDream) vs session-only history
- **Voice mode** (edge-TTS, VibeVoice, faster-whisper) — Codex has none
- **iOS native app** with CarPlay + Watch + Widgets + LiveActivity + AppIntents + Share + 5 pairing transports — **unmatched**
- **Multi-channel messaging** (17 platforms) — Codex has none
- **Cost tracking + preview** — Codex has none (subscription)
- **Exploit mode / Security Research panel** — unique
- **Council + Arena** (multi-model deliberation) — unique
- **86 skills** exceeds all competitors

### Where WOTANN lags
- **OS-level sandbox enforcement** — Codex has bwrap/seatbelt/win-sandbox; WOTANN has policy-only
- **Liquid Glass / translucency** — Gemini Mac has it; zero `backdrop-filter` usage in WOTANN CSS
- **Block-based terminal** — Warp/soloterm have it; WOTANN ships linear log
- **AI-native terminal** — Warp's Agent Mode + Warp Drive workflows; WOTANN's TUI is chat-first, not command-first
- **ACP support** — Zed/Goose have Agent Communication Protocol, hosting by other editors; WOTANN has the spec but no port
- **LSP symbol-operations as agent tools** — Goose exposes `lsp_references/definition/hover/symbols/rename`; WOTANN has LSP module but not wired as agent tools
- **Collaborative cursors** — Zed has them; WOTANN has none
- **Design system unified tokens** — 3 separate schemes (CSS/Swift/Ink), no single source; Gemini Mac, Zed, Glass have unified materials
- **Browser automation** — WOTANN's camoufox-backend is fake; Goose's computercontroller is real

---

## 4. Top-50 Ranked Roadmap (Benchmark-Winning Priority)

Ranked by `impact × zero-cost feasibility`. Preference: **accuracy over architecture**, per user directive.

### Tier 0 — Fix lies (1-2 days each, blocks benchmark-winning)
| # | Task | File | Days |
|---|------|------|------|
| 1 | **Fix Bedrock tool-calling end-to-end** — body.toolConfig + AWS event-stream decoder | `bedrock-signer.ts:150-201` | 2 |
| 2 | **Fix Vertex adapter** — forward tools/messages/system + parse tool_calls/thinking/usage | `vertex-oauth.ts:179-245` | 2 |
| 3 | **Fix Azure URL composition** — query param AFTER path | `registry.ts:176-180` | 0.5 |
| 4 | **Fix Ollama stopReason: "tool_calls"** | `ollama-adapter.ts:344-346` | 0.25 |
| 5 | **Fix Copilot 401 retry** — one automatic re-exchange | `copilot-adapter.ts:346-355` | 0.5 |
| 6 | **Per-session Copilot token** — remove module-global cache | `copilot-adapter.ts:88-90` | 0.5 |
| 7 | **Fix tolerantJSONParse apostrophe corruption** | `parsers.ts:45` | 0.5 |
| 8 | **Persistent Camoufox subprocess bridge** — replace fresh-per-call with long-running JSON-RPC | `browser/camoufox-backend.ts` | 3 |
| 9 | **Strip 40+ tautological `.toBeTruthy()` assertions** | `tests/mobile/ios-app.test.ts` + others | 1 |
| 10 | **Remove tautological self-equality assertion** | `tests/integration/fallback-e2e.test.ts:95` | 0.1 |

**Tier 0 total: 10 days. This is the MUST-DO before benchmarking.**

### Tier 1 — Benchmark-winning harness (fitness first)
| # | Task | Source | Days |
|---|------|--------|------|
| 11 | **Benchmark harness** — 20 held-out tasks grow over time; fitness function | DSPy MIPROv2, DGM | 5 |
| 12 | **Self-consistency voting** — k samples + majority vote on hard tasks | LangChain research | 2 |
| 13 | **Verifier agent with retry budget** — fresh context, independent of executor | Anthropic verifier pattern | 2 |
| 14 | **Test-time search / tree-of-thought over plans** | AI Scientist v2, Agent-R | 3 |
| 15 | **Tool-use reliability: property-based fuzz of all parsers** | fast-check | 2 |
| 16 | **Per-language compile/type-check tools** — tsc/pyright/gopls/rustc check before completion | — | 2 |
| 17 | **Sticky planning scratchpad** — plan persists across turns, checkpoint-gated | Superpowers writing-plans | 1 |
| 18 | **Wire `benchmark-harness.ts` placeholders to real runners** — see existing file | WOTANN internal | 1 |
| 19 | **Context-aware retrieval with reranker** — BGE-small local + bge-reranker-v2-m3 ONNX | Archon / Anthropic | 2 |
| 20 | **Contextual embeddings step** — +30-50% recall; 1 extra LLM call per chunk | Anthropic | 1 |

### Tier 2 — Codex parity (P0)
| # | Task | Source | Days |
|---|------|--------|------|
| 21 | **OS-level sandbox wrappers** — bwrap (Linux) / seatbelt (macOS) / win-sandbox (Windows) | Codex | 7 |
| 22 | **`thread/fork`** — branch session at turn N for A/B exploration | Codex | 2 |
| 23 | **`thread/rollback(numTurns)`** — precise undo vs full reset | Codex | 1 |
| 24 | **`wotann mcp-server` mode** — WOTANN hostable by Cursor/Claude-Code | Codex | 3 |
| 25 | **`unified_exec` PTY-backed tool** — interactive vim/less/python REPL | Codex | 2 |
| 26 | **`shell_snapshot`** — cache shell env to skip boot cost | Codex | 1 |
| 27 | **`request_rule` smart approvals** — pattern-match safe commands | Codex | 1 |

### Tier 3 — Memory upgrades (competitive parity + moats)
| # | Task | Source | Days |
|---|------|--------|------|
| 28 | **Tree-sitter AST chunking** via web-tree-sitter WASM | Claude-Context | 2 |
| 29 | **sqlite-vec virtual tables** — 10-100x faster KNN | Claude-Context | 1 |
| 30 | **Unified graph+vector dual retrieval** — wrap existing subsystems | Cognee | 2 |
| 31 | **Typed EntityType schemas** — Zod + LLM structured output | Cognee | 2 |
| 32 | **Incremental index by file-SHA hash** — minutes→seconds | Claude-Context | 0.5 |
| 33 | **Mode registry + mode-scoped memory** | Context-Mode | 1.5 |
| 34 | **Project/task scope columns** — filter retrievals by active project | Archon | 0.5 |
| 35 | **Query reformulation + multi-query + HyDE** | Archon | 1 |

### Tier 4 — Self-evolution (needs Tier 1 first)
| # | Task | Source | Days |
|---|------|--------|------|
| 36 | **Failure-lesson capture** — `lessons.jsonl`, domain-indexed | Reflexion | 1 |
| 37 | **Rationalization step** — user-correction → rationale → skill crystallization | STaR | 1.5 |
| 38 | **3-layer memory split** — working/episodic/semantic | MemGPT/Letta | 1.5 |
| 39 | **Embedding-indexed skill retrieval** — BGE-small CPU | Voyager | 2 |
| 40 | **Archive-not-population** — tag replaced skills; sample parents by perf×novelty | DGM | 1 |
| 41 | **CodeAct upgrade** — code blocks in sandbox, +20% GAIA lift | CodeAct 2402.01030 | 6 (includes sandbox) |
| 42 | **Self-rewarding tournament** — Sonnet-as-judge on harness #11 | Self-Rewarding LMs | 1 |
| 43 | **Prompt mutation + tournament** — 5 preamble variants weekly | PromptBreeder | 3 |

### Tier 5 — UI/UX distinction
| # | Task | Source | Days |
|---|------|--------|------|
| 44 | **Liquid Glass HUD** — `backdrop-filter: blur(20px) saturate(180%)` on QuickActionsOverlay + palette + Sidebar | Gemini Mac | 2 |
| 45 | **Unified design tokens build script** — emit to CSS + Swift + Ink from single source | — | 1 |
| 46 | **Block-based terminal** — refactor `TerminalPanel.tsx` + `EditorTerminal.tsx` into command blocks (fold/rerun/share/AI-ize) with OSC 133 parsing | Warp | 5 |
| 47 | **`Cmd+/` shortcut cheatsheet overlay** | — | 0.5 |
| 48 | **Bezier cursor overlay + `[POINT:x,y]` grammar** | Clicky | 2 |
| 49 | **"Ask about this window" via ScreenCaptureKit + OCR** | Gemini Mac | 3 |
| 50 | **Global hotkey palette** — Tauri `global_shortcut` to summon from anywhere | Gemini Mac | 1 |

### Tier 6 — Skill library convergence
Port top-30 skills from `skill-libraries-2026-04-18.md` including skill-test-harness (Superpowers) and OpenAI Skills v1 schema adoption.

### Tier 7 — Channel parity
Add Mastodon, Twitter/X DM, LinkedIn, Instagram, WeChat, Line, Viber to reach claimed 24-platform count. Or cut spec.

### Tier 8 — Security moat (FUSE / App. E.4)
Implement FUSE-overlay filesystem isolation, or cut the spec claim. Currently lies.

---

## 5. Testing Roadmap (from test audit)

| # | Task | Priority |
|---|------|----------|
| T1 | **iOS XCTest target** for WOTANN/WOTANNIntents/Share/Watch/Widgets (currently ZERO) | CRITICAL |
| T2 | **src-tauri Rust #[test]** for commands.rs / state.rs / hotkeys.rs / computer_use/permissions.rs (currently ZERO) | CRITICAL |
| T3 | **desktop-app React component tests** for chat/Editor/Bridge pairing (currently ZERO) | HIGH |
| T4 | **`src/connectors/*` tests** — slack/jira/linear/notion/google-drive/confluence (currently ZERO) | HIGH |
| T5 | **`src/hooks/` unit tests** — 19 events × 17 guards matrix (current 7 `it()`) | HIGH |
| T6 | **Provider streaming SSE integration** — real streaming w/ tool-interleave | HIGH |
| T7 | **Full-stack runtime wiring test** — middleware pipeline receives X context in order, hooks fire on (Y,Z) events | HIGH |
| T8 | **E2E per CLI verb** — wotann init/compare/review/autopilot/voice/engine/schedule/channels | MEDIUM |
| T9 | **Quantized vector store real MiniLM** — remove silent-skip or require in CI | MEDIUM |
| T10 | **Tool-parser property-based fuzz** — fast-check | MEDIUM |

---

## 6. Docs Hygiene (pending docs-audit agent)

Preliminary from CHANGELOG + CLAUDE.md + README reads:

- **CLAUDE.md**: "11 providers" — update to 19 (or ship only the 15 that actually work)
- **CHANGELOG [0.1.0]**: "17-provider adapter system" — sync with package.json version (currently says 0.1.0 but some docs say 0.3.0)
- **CLAUDE.md Directory Structure**: mentions `WotannEngine` class but no such class exists in code — `WotannRuntime` is the composition root
- **NEXUS_V1/V2/V3/V4_SPEC.md**: Legacy names in /agent-harness/ root — rename or archive
- **MEMORY.md Apr-4 observation** about TypeScript specifications: STALE, archive

A deeper docs audit agent is still running; its output will append to this master audit.

---

## 7. Repo Hygiene

### Screenshot clutter
/agent-harness/ top-level has 40+ PNG screenshots from prior iteration (onboarding-*, depth-*, fix-layout-*, e2e-step*, wotann-*, chat-*, editor-*, exploit-*, workshop-*, settings-*, notification-panel, command-palette, main-app-*, model-picker-*). Candidate for a new `/screenshots/archive/` folder.

### Orphan directories at /agent-harness/
- `.abstract.md` (354 bytes — legacy abstract)
- `.claude-flow/` — claude-flow MCP cache
- `.nexus/` — legacy NEXUS session data (episodes/screenshots/sessions)
- `.swarm/` — claude-flow swarm state
- `wotann-old-git-20260414_120728/` — 624MB packfile backup; OK to keep until verified safe to delete

### Legacy spec files
- `NEXUS_V1_SPEC_old.md`, `NEXUS_V2_SPEC_old.md`, `NEXUS_V3_SPEC_old.md`, `NEXUS_V4_SPEC.md` — move to `/specs/archive/` or consolidate into current spec

---

## 8. Summary of Critical Actions

**Right now (next 48 hours):**
1. Fix provider criticals #1-#7 (~5 days, 4 CRITICALs + 3 HIGHs)
2. Fix browser fake camoufox-backend (~3 days)
3. Strip test tautologies (~1 day)
4. Archive stale Apr-4 memory observation about iOS/Desktop being TypeScript specs

**This week:**
5. Build benchmark harness (#11) — THE gating upgrade for self-evolution + benchmark-winning
6. Contextual embeddings (#20) — +30-50% recall for 1 day of work
7. Sqlite-vec integration (#29) — 10-100x faster KNN

**Next sprint:**
8. Codex parity P0 (#21-#27)
9. Self-evolution Tier 4 (#36-#43) sequenced behind benchmark harness
10. Channel parity to 24 platforms

**Ongoing:**
- Monitor 40+ tracked repos weekly via `/monitor-repos` slash command
- Port top-30 skills from external libraries
- Close FUSE security gap or cut spec claim

---

## References

- `/research/competitor-analysis/ai-coding-editors-2026-04-18.md` — dpcode/glass/zed/jean/air
- `/research/competitor-analysis/terminals-conductor-2026-04-18.md` — soloterm/emdash/superset/conductor/Warp
- `/research/competitor-analysis/gemini-macos-tools-2026-04-18.md` — Gemini Mac/Clicky/Goose/WACLI
- `/research/competitor-analysis/skill-libraries-2026-04-18.md` — Karpathy/Superpowers/Osmani/OpenAI Skills
- `/research/competitor-analysis/self-evolving-agents-2026-04-18.md` — Reflexion+Voyager+DGM+STaR
- `/research/competitor-analysis/browser-codex-tutoring-2026-04-18.md` — Camoufox/DeepTutor/openai/codex
- `/research/competitor-analysis/memory-context-rag-2026-04-18.md` — Cognee/Claude-Context/Context-Mode/Archon
- `/wotann/docs/BENCHMARK_BEAT_STRATEGY_2026-04-18.md` — benchmark-winning plan
- Engram memories under topic keys: `wotann/audit-architecture`, `wotann/audit-providers`, `wotann/audit-ui-ux`, `wotann/audit-tests`, `wotann/audit-spec-drift`, `wotann/benchmark-strategy`, `wotann/memory-upgrades`, `wotann/native-app-research`, `wotann/self-evolution-plan`, `wotann/browser-codex`, `wotann/ai-editors-research`, `wotann/skill-port-plan`
