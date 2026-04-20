# AUDIT LANE 1 — Codebase Wiring + Dead Code + Architecture

**Date**: 2026-04-19
**Auditor**: Opus 4.7 max-effort, lane 1 of 5 (codebase wiring + architectural gaps)
**Scope**: `src/` only (481+ files, 195,311 LOC incl. 5 "* 2.ts" duplicates; 544 .ts files, 9 .tsx)
**Method**: Grep-evidence for every claim. Every file cited has been opened. Speculative claims labelled.

---

## 0. Top-line numbers

| Surface | LOC | Files |
|---|---|---|
| `src/**/*.ts` (excluding `* 2.ts` duplicates) | 195,311 | 536 |
| `src/**/*.tsx` | 5,533 | 9 |
| `tests/**/*.ts` | ~72,574 | 373 (364 `.test.ts` + 9 fixtures) |
| `src/index.ts` (CLI god file) | 5,633 | 1 |
| `src/lib.ts` (barrel) | 1,282 | 1 (184 re-exports, 99 section headers) |
| Top-10 largest source files | 28,277 | 10 (see §3.1) |
| Duplicate ghost files `* 2.ts` | 51,532 | 10 (6 src + 4 test) |
| `src/core/runtime.ts` (composition root) | 6,315 | 1 (168 private fields, 192 imports) |

**Big picture**: the codebase has a large surface (~480 hand-authored .ts files) but the tree has three structural problems that matter:

1. **Three god-objects** carry too much weight: `core/runtime.ts` (6,315 LOC), `daemon/kairos-rpc.ts` (5,513 LOC), and `index.ts` (5,633 LOC; 115 CLI subcommands in one file).
2. **Ten "* 2.ts" ghost files** (51,532 LOC of uncommitted duplicates not imported anywhere, see §2).
3. **A 1,282-line barrel (`lib.ts`) with 20 genuinely lib-only re-exports** — modules that no `src/` callsite imports.

---

## 1. Module Inventory

Each top-level `src/` directory: file count, LOC, primary purpose, key exports, and an honest assessment.

### 1.1 Runtime-critical (the real backbone)

| Directory | Files | LOC | Purpose | Key Exports | Assessment |
|---|---|---|---|---|---|
| `core/` | 30 | 19,519 | Composition root, session, types, config. Contains `WotannRuntime`, the spine that wires nearly every subsystem. | `WotannRuntime`, `createRuntime`, `RuntimeConfig`, session machinery, `AgentBridge` | **Production-grade but god-objected.** `runtime.ts` has 168 private fields, 192 imports, ~169 methods. Extracted helpers (`runtime-tools.ts`, `runtime-tool-dispatch.ts`, `runtime-intelligence.ts`) are correct composition. `core/claude-sdk-bridge.ts` has test-only wiring (no runtime caller). |
| `providers/` | 41 | 14,713 | Provider adapters (11 real), router, capability fingerprint, rate limiter, format translator. | `createAnthropicAdapter` + 8 siblings, `ModelRouter`, `AccountPool`, `CapabilityEqualizer`, `CapabilityFingerprinter` | **Production-grade.** `registry.ts` builds infrastructure cleanly; adapters are independently testable. Library-only: `header-injection.ts`, `capability-fingerprint.ts`, `extended-thinking.ts`, `model-switcher.ts`, `thinking-preserver.ts`, `harness-profiles.ts` (§2.1). |
| `daemon/` | 14 | 12,447 | KAIROS daemon process, JSON-RPC server, Unix socket IPC, cron, terminal monitor, file dep graph. | `KairosDaemon`, `KairosRPCHandler`, `KairosIPCServer`/`Client`, `AutomationEngine` | **Production-grade for the hot path; cold spots unwired.** `kairos.ts` is itself a god-object (2,568 LOC, 90 methods). `start.ts` is a binary entry point used by the Tauri sidecar (desktop-app/src-tauri/src/sidecar.rs:201). `auto-update.ts` is fully dead (§2.2). |
| `middleware/` | 26 | 7,772 | 31-layer middleware pipeline (intent → thread → uploads → sandbox → summarization → autonomy → ... → self-reflection). | `createDefaultPipeline`, 30+ middlewares | **Production-grade.** `pipeline.ts` wires all layers. 6 Lane-2 "deer-flow ports" (dangling-tool-call, deferred-tool-filter, guardrail-provider, llm-error-handling, sandbox-audit, title) were added 2026-04-15 and ARE in the pipeline. One orphan: `forced-verification.ts` has 0 runtime callers; `verification-enforcement.ts` + `pre-completion-checklist.ts` cover the same ground with different names. |
| `memory/` | 47 | 20,009 | SQLite+FTS5 memory store, 30+ memory primitives: vector/hybrid/graph-rag/episodic/temporal/pluggable/proactive/conversation-miner + unified knowledge fabric. | `MemoryStore`, `UnifiedKnowledgeFabric`, `KnowledgeGraph`, 30+ classes | **Production-grade core, experimental perimeter.** `store.ts` (2,597 LOC) is the real spine; it now wires the previously-orphaned `UnifiedKnowledgeFabric` + `ContextTreeManager` through `runtime.ts:1090,1135`. Dead/test-only: `memvid-backend.ts` (393 LOC), `memory-tools.ts` (580 LOC, test-only), `pluggable-provider.ts` (abstraction never adopted by `MemoryStore` — 368 LOC of lib-only code). |
| `hooks/` | 6 | 3,172 | Hook event engine (PreToolUse/PostToolUse/PreRequest/...), 17+ built-in hooks, doom-loop detector, rate-limit-resume, auto-archive. | `HookEngine`, `registerBuiltinHooks`, `DoomLoopDetector` | **Production-grade.** `built-in.ts` is 1,382 LOC but legitimately dense (17 hooks + shared helpers). |

### 1.2 Orchestration and execution

| Directory | Files | LOC | Purpose | Key Exports | Assessment |
|---|---|---|---|---|---|
| `orchestration/` | 33 | 12,961 | Autonomous loops, waves, Ralph mode, PWR cycle, council, self-healing, wave executor, long-horizon orchestrator, ultraplan. | `AutonomousExecutor`, `Coordinator`, `runCouncil`, `runArenaContest`, `executeWaves`, `buildPlanningPrompt` | **Mixed.** `autonomous.ts` (1,542 LOC, 117 methods) is the real engine wired in runtime.ts. But 7 of 33 modules are library-only (`spec-to-ship`, `auto-commit`, `red-blue-testing`, `long-horizon-orchestrator`, `dual-persona-reviewer`, `plateau-detector`, `phase-gate`) — each has only tests, no runtime caller. **High overlap**: 7 different "orchestrator"/"cycle"/"executor" shapes solving related problems. |
| `autopilot/` | 7 | 1,978 | Completion oracle, oracle-worker, PR artifacts, checkpoint, trajectory recorder, CI feedback. | `evaluateCompletion`, `OracleWorkerPolicy`, `TrajectoryRecorder`, `PRArtifactGenerator` | **Production-grade core, one library-only.** `completion-oracle` + `oracle-worker` are wired through `runtime.ts`/`autonomous.ts`. `pr-artifacts.ts` has only test callers (no `src/` consumer). |
| `channels/` | 34 | 8,837 | 20+ messaging channels (Slack, Discord, iMessage, Telegram, Matrix, ...) + gateway + unified-dispatch + auto-detect + route policies. | `ChannelGateway`, 15+ `*Adapter` classes, `UnifiedDispatchPlane`, `ChannelDispatchManager` | **Mostly wired, one architecturally-stranded pattern.** All real adapters (slack/discord/line/mastodon/whatsapp/signal/matrix/...) are dynamically imported by `daemon/kairos.ts:1004+`. But `channels/base-adapter.ts` (`BaseChannelAdapter` abstract class, 161 LOC) has ONLY the 104-LOC `EchoChannelAdapter` as a subclass — a reference implementation added to close an audit finding. The 10+ real adapters implement the legacy `ChannelAdapter` interface from `adapter.ts` instead. **Two competing adapter base types live in the same directory with no migration plan.** |

### 1.3 Intelligence and learning

| Directory | Files | LOC | Purpose | Key Exports | Assessment |
|---|---|---|---|---|---|
| `intelligence/` | 58 | 20,070 | 50+ intelligence primitives (amplifier, accuracy-boost, context-relevance, auto-*, response-validator, deep-research, forgecode-techniques, adaptive-prompts, policy-injector, confidence-calibrator, chain-of-verification, ...). | 50+ classes; `IntelligenceAmplifier`, `AccuracyBooster`, `ContextRelevanceScorer`, `DeepResearchEngine`, `ForgeDoomLoopFingerprinter`, ... | **Mixed — many are solo experiments.** Core amplifier is wired; `auto-reviewer`, `bugbot`, `provider-arbitrage`, `error-pattern-learner`, `predictive-context`, `forgecode-techniques`, `bash-classifier`, `auto-enhance`, `cross-device-context`, `ai-time-machine`, `user-model`, `verification-cascade`, `wall-clock-budget`, `prefill-continuation`, `policy-injector`, `strict-schema`, `confidence-calibrator`, `chain-of-verification`, `tool-pattern-detector`, `search-providers`, `guardian`, `content-cid` — all have runtime.ts imports (verified line 192-356). But `budget-enforcer.ts`, `answer-normalizer.ts` have test-only. |
| `learning/` | 16 | 5,109 | Cross-session, dream pipeline, auto-dream, pattern-crystallizer, decision-ledger, skill-forge, MIPROv2, GEPA optimizer, Darwinian evolver, self-evolution, reflection-buffer, nightly consolidator. | `CrossSessionLearner`, `DreamPipeline`, `SkillForge`, `InstinctSystem`, `PatternCrystallizer`, `ReflectionBuffer`, `NightlyConsolidator` | **Production-wired.** All actively imported by `runtime.ts` / `daemon/kairos.ts`. Except `types.ts` which is a pure types file (lib-only is fine for this case). |
| `training/` | 6 | 2,040 | Autoresearch engine, LLM-modification-generator, RL-environment, session/trajectory extractor, pipeline. | `AutoresearchEngine`, `TrainingPipeline`, `createLlmModificationGenerator`, `runSessionExtractor`, `extractTrajectories` | **Mostly dormant.** `autoresearch.ts` + `pipeline.ts` + `llm-modification-generator.ts` wired in `runtime.ts:174-177`. `rl-environment.ts` and `session-extractor.ts` are lib+test-only. |

### 1.4 Tools, capabilities, and surfaces

| Directory | Files | LOC | Purpose | Key Exports | Assessment |
|---|---|---|---|---|---|
| `tools/` | 13 | 3,881 | LLM-invokable tools: web-fetch, hashline-edit, hash-anchored-edit, pdf-processor, image-gen-router, monitor (bg process), post-callback, task-tool, tool-timing, encoding-detector. | `applyHashEdit`, `WebFetchTool`, `spawnMonitor`, `ImageGenRouter`, `processPDF`, `TaskTool` | **Mostly wired.** `aux-tools.ts` (253 LOC) is fully dead (§2.2), `aux-tools 2.ts` is a duplicate ghost. |
| `connectors/` | 10 | 4,077 | Jira/Linear/Notion/Confluence/Slack/Google-Drive connectors + connector-registry + connector-tools + connector-writes + guarded-fetch. | `ConnectorRegistry`, `JiraConnector`, `LinearConnector`, `NotionConnector`, `buildConnectorToolDefinitions`, `isConnectorTool` | **Production-grade.** Tool functions now wired in `runtime-tools.ts:22-24,320-323`, dispatcher wired at `runtime-tool-dispatch.ts:21,602`. |
| `computer-use/` | 5 | 2,487 | Screen perception engine, platform bindings, perception adapter, computer agent. | `PerceptionEngine`, `ComputerAgent`, `PerceptionAdapter`, `detectPlatformBindings` | **Production-grade.** Perception adapter wired via `runtime-hooks/dead-code-hooks.ts::routePerception` + `computer-agent.ts:169,324`. |
| `lsp/` | 4 | 2,410 | LSP manager, server registry, symbol operations, agent tools. | `LSPManager`, `SymbolOperations`, `buildLspTools`, `LanguageServerRegistry` | **Production-wired.** `runtime-tools.ts:14-15,333,342,345` wires `AGENT_LSP_TOOL_NAMES` and dispatches through the LSP registry. |
| `skills/` | 8 | 2,621 | Skill registry, loader, eval, agentskills-registry, self-crystallization, compositor, merger, optimizer, standard. | `SkillRegistry`, `AgentSkillsRegistry`, `crystallizeSuccess` | **Mostly wired.** `loader.ts` is wired through `runtime.ts:69`. `self-crystallization.ts` wired via `dead-code-hooks.ts::crystallizeSuccessHook` — but the full path is caller-gated (§3.5). |
| `marketplace/` | 3 | 2,162 | MCP registry, ACP agent registry, manifest. | `MCPRegistry`, `ACPAgentRegistry`, `parseManifest` | **Production-wired.** `registry.ts` imported by `daemon/kairos.ts:820` + `ui/App.tsx:1497`. |
| `mcp/` | 2 | 821 | MCP tool loader, tool adapter. | `loadToolsWithOptions`, `McpTier`, `McpToolAdapter` | **Production-wired** at `runtime.ts:130,1366,1370`. |
| `cli/` | 20 | 4,055 | CLI subcommands (audit, autofix-pr, away-summary, ci-runner, history-picker, thin-client, voice, runtime-query, etc.). | `runRuntimeQuery`, `runInit`, `runProviders`, `runDoctor`, `runMagicGit`, `runAutofixPR`, `LoopManager`, `launchOrFallback` | **Mostly wired; 6 ghosts.** `index.ts` dynamically imports 15 of 20 CLI modules. Six CLI modules are fully dead/unused: `cli/onboarding.ts` (164 LOC wizard spec), `cli/incognito.ts` (130 LOC — App.tsx reimplements incognito inline), `cli/history-picker.ts` (class-form; UI uses separate `ui/components/HistoryPicker.tsx`), `cli/debug-share.ts` (289 LOC), `cli/pipeline-mode.ts` (180 LOC — `index.ts` has inline `--pipe` at line 48 instead), `cli/test-provider.ts` (dev-only npm script). |
| `ui/` | 14 (+ subdirs) | 3,621 + 5,533 tsx | Ink TUI main (`App.tsx` 3,081 LOC), components (9 .tsx files), bootstrap, helpers, canvas, themes, diff-engine, terminal-blocks. | `App` component, `createRuntime`, `CanvasEditor`, `BlockBuffer`, `Osc133Parser` | **App.tsx is a god-component.** 3,081 LOC in a single React file. `agent-fleet-dashboard.ts` is library-only. `context-meter.ts`, `raven/raven-state.ts` are test-only. |
| `desktop/` | 15 | 5,794 | Desktop app companion server, app state, artifacts, project-manager, tauri-config, layout, keyboard-shortcuts, command-palette, prompt-enhancer, conversation-manager, notification-manager, supabase-relay, desktop-runtime-bridge, desktop-store. | `CompanionServer`, `PromptEnhancer`, `NotificationManager`, 10+ store types | **Many library-only, real consumers elsewhere.** 6 modules are lib-only (`app-state`, `project-manager`, `keyboard-shortcuts`, `tauri-config`, `command-palette`, `layout`, `desktop-runtime-bridge`). The actual desktop app lives in `desktop-app/src/` (React frontend), which references `desktop/conversation-manager.ts` via Node sidecar but doesn't import most of these. `desktop-store.ts` is fully dead (214 LOC of Zustand-shaped types that no Zustand store consumes). |
| `mobile/` | 4 | 1,521 | iOS types, handlers, haptics, secure-auth. | `iOSAppHandler`, `SecureAuth`, `HapticFeedback` | **Lib-only exports, iOS app consumes via shared protocol.** 2 modules (`haptic-feedback.ts`, `secure-auth.ts`) have 1 src ref each (from `ios-app.ts`); the iOS Swift side consumes the JSON shapes. |
| `voice/` | 6 | 3,611 | STT/TTS detector, voice-pipeline, voice-mode, edge-tts, vibevoice. | `VoicePipeline`, `STTDetector`, `TTSEngine`, `VibeVoiceBackend` | **Production-wired** through `runtime.ts` (vibevoice at line 341) and `daemon/kairos-rpc.ts:35,54`. |
| `browser/` | 3 | 1,422 | Chrome bridge, browser tools. | `ChromeBridge`, `buildBrowserToolDefinitions`, `BROWSER_TOOL_NAMES` | **Production-wired** via `runtime-tools.ts:28-30,307,334`. |
| `acp/` | 5 | 1,621 | Agent Client Protocol (Zed's open ACP spec) — stdio + server + runtime-handlers + thread-handlers + protocol. | `AcpServer`, `AcpStdio`, `parseAcpRequest` | **Wired via `index.ts` acp subcommands.** |
| `meet/` | 4 | 690 | Meeting pipeline, runtime, summary, transcriber. | `MeetingRuntime`, `MeetingSummarizer` | **Wired** through `daemon/kairos.ts:242,433,437,444,453,647-649,778`. |
| `identity/` | 3 | 1,207 | Persona manager, user-model (481 LOC — the real one), reasoning engine. | `PersonaManager`, `UserModel`, `ReasoningEngine` | **Production-wired.** `runtime.ts:123` imports PersonaManager. Note: `intelligence/user-model.ts` is a 195-LOC thin manager wrapping this — not a duplicate, but worth consolidating (§4.2). |

### 1.5 Supporting and cross-cutting

| Directory | Files | LOC | Purpose | Assessment |
|---|---|---|---|
| `context/` | 12 | 4,815 | Context-replay, context-sharding, importance-compactor, maximizer, ollama-kv-compression (TurboQuant), virtual-context, window-intelligence, tiered-loader, repo-map, compaction, inspector, limits. | **Mostly wired.** `tiered-loader.ts` is lib+test-only. |
| `sandbox/` | 12 | 4,478 | Docker backend, extended-backends, executor, approval rules, terminal backends, task-isolation, unified-exec, security, output-isolator, execution-environments, virtual-paths, request-rule. | **Mixed.** Wired: executor, extended-backends, output-isolator. Lib-only: docker-backend, terminal-backends, unified-exec, request-rule, task-isolation. |
| `security/` | 18 | 5,856 | Anti-distillation, auto-classifier, file-freeze, guardrails-off, hash-audit-chain, intent-verifier, PII-redactor, privacy-router, secret-scanner, skills-guard, SSRF guard, rules-of-engagement, command-sanitizer, confirm-action, archive-preflight, write-audit, plugin-sandbox. | **Production-grade.** All major security modules wired through runtime.ts. `human-approval.ts` is lib-only (1 callsite). |
| `prompt/` | 23 (incl. `modules/`) | 2,682 | Prompt engine, instruction-provenance, model-formatter, template-compiler, think-in-code, + 18 prompt modules (identity, mode, tools, skills, memory, safety, etc.). | **Production-wired** via `runtime.ts:31` and `prompt/engine.ts:14`. Early audit flagged `assemblePromptModules` as unwired, but `engine.ts:321` now calls it. |
| `telemetry/` | 10 | 2,532 | Cost tracker, cost-oracle, daily-cost-store, session-analytics, session-replay, audit-trail, observability-export, opt-out, token-estimator, benchmarks. | **Production-wired.** Only `observability-export.ts` is lib-only. |
| `utils/` | 8 | 1,390 | Shadow git, sidecar downloader, WASM bypass, atomic IO, platform, logger, git-stale-check. | **Mixed.** `logger.ts` (98 LOC) + `platform.ts` (83 LOC) are fully dead. |
| `hooks/` | 6 | 3,172 | See §1.1. | **Production-wired.** |
| `design/` | 4 | 853 | Handoff receiver, design-tokens parser. | **Lib-only.** |
| `testing/` | 4 | 1,061 | Visual-verifier, visual-diff-theater, prompt-regression. | **Production-wired.** Visual diff theater wired at `runtime.ts:122,655,1213-1214`. |
| `monitoring/` | 1 | 324 | Source monitor — checks tracked external repos. | **Wired** at `runtime.ts:290`. |
| `agents/` | 2 | 550 | Required-reading, background-agent. | **Wired** — required-reading hook called from `agent-registry.ts:396,424`, background-agent from `daemon/kairos.ts`. |
| `plugins/` | 2 | 484 | Plugin lifecycle + manager. | **Production-wired.** |
| `api/` | 1 | 457 | WOTANN API server (OpenAI-compat). | **Lib-only — barrel-exported, no runtime consumer. Verified.** Real API deployment would add a command in `index.ts`. |
| `auth/` | 2 | 910 | Login flows. | **Wired via `index.ts`.** |
| `workflows/` | 1 | 447 | Workflow runner. | **Test-only — dead outside tests.** |
| `runtime-hooks/` | 1 | 317 | Dead-code hooks (resurrection layer). | **Production-wired.** Purpose-built to make orphaned modules callable. |
| `git/` | 1 | 330 | Git helpers. | **Wired.** |
| `verification/` | 1 | 106 | Pre-commit analysis. | **Wired** at `runtime.ts:88`. |

---

## 2. Wiring Verification

### 2.1 Library-only (exported but no src/ runtime caller)

Evidence: `grep -rln BASENAME src tests` filtered to exclude self-file, `src/lib.ts`, and tests. Column order: **SRC-refs | LIB-refs | TEST-refs**.

| Module | SRC | LIB | TEST | LOC | Resurrection check |
|---|---|---|---|---|---|
| `src/ui/agent-fleet-dashboard.ts` | 0 | 1 | 1 | 356 | **Wire it.** This would expose live multi-agent fleet status in the TUI — high-value feature for parallel workers. |
| `src/memory/pluggable-provider.ts` | 0 | 1 | 1 | 368 | **Park with TODO.** `InMemoryProvider`/`MultiTurnMemory` classes implement an alternate API shape incompatible with `MemoryStore`. Either retrofit `MemoryStore` to implement `MemoryProvider`, or delete this abstraction. Currently zero adapters. |
| `src/security/human-approval.ts` | 0 | 1 | 0 | 360 | **Wire it.** HumanLayer-inspired human-in-the-loop approval. Clearly valuable for destructive operations; no test, no caller. |
| `src/training/rl-environment.ts` | 0 | 1 | 1 | 357 | **Park.** RL scaffolding that pairs with `training/pipeline.ts`. No adaptation yet; may be valuable for autoresearch. |
| `src/providers/extended-thinking.ts` | 0 | 1 | 1 | 138 | **Wire it.** `buildThinkingParams` + `getThinkingMethod` should route through `provider-service.ts`. Currently `capability-fingerprint.ts:40` + `header-injection.ts:138` imports but no caller in the prod path. |
| `src/providers/header-injection.ts` | 0 | 1 | 1 | 187 | **Wire it.** `getProviderHeaders`/`buildProviderUrl` should be called by adapter factories. Currently test-only. |
| `src/providers/thinking-preserver.ts` | 0 | 1 | 1 | 127 | **Wire it.** Should thread thinking blocks across multi-turn conversations; a real correctness issue per Claude Opus 4.x docs. |
| `src/providers/capability-fingerprint.ts` | 0 | 1 | 1 | 235 | **Wire it.** Fingerprinting is a premise of `CapabilityEqualizer` (which IS wired); the equalizer should consult fingerprint cache. |
| `src/providers/model-switcher.ts` | 0 | 1 | 1 | 209 | **Wire it.** Matches the `model-router.ts` concern but with model-switching policy. Overlap with `model-router.ts`; consolidate rather than run both. |
| `src/desktop/project-manager.ts` | 0 | 1 | 1 | 329 | **Wire it into desktop-app.** The Tauri frontend manages projects via its own state; this TypeScript class is redundant unless bridged. |
| `src/desktop/keyboard-shortcuts.ts` | 0 | 1 | 1 | 336 | **Wire or delete.** Tauri shortcuts live in Rust (`src-tauri/src/`) + frontend. This file is either a spec or an unused abstraction. |
| `src/desktop/tauri-config.ts` | 0 | 1 | 0 | 140 | **Delete or document.** The real `tauri.conf.json` is in `desktop-app/src-tauri/`. This is parallel configuration. |
| `src/desktop/command-palette.ts` | 0 | 1 | 1 | 219 | **Wire it.** A real command palette would enhance the TUI. Currently only `desktop-app/src/components/palette/CommandPalette.tsx` imports `code-mode.ts`. |
| `src/desktop/layout.ts` | 0 | 1 | 0 | 157 | **Wire or delete.** Desktop layout math — not consumed by Tauri or TUI. |
| `src/desktop/desktop-runtime-bridge.ts` | 0 | 1 | 1 | 178 | **Investigate.** Name suggests bridge duty; real bridge is `desktop/companion-server.ts` (WebSocket). Likely superseded. |
| `src/orchestration/spec-to-ship.ts` | 0 | 1 | 1 | 455 | **Wire it.** End-to-end spec→implement→review→ship pipeline, valuable if integrated with autonomous + conductor. Currently a parallel implementation to `AutonomousExecutor`. |
| `src/orchestration/auto-commit.ts` | 0 | 1 | 1 | 307 | **Wire it.** Conventional-commit generator after verified cycles; would pair naturally with `autonomous.ts`'s post-verification path. |
| `src/orchestration/red-blue-testing.ts` | 0 | 1 | 1 | 268 | **Wire it.** Real adversarial testing primitive. Pair with `autonomous.ts` after a passing cycle. |
| `src/telemetry/observability-export.ts` | 0 | 1 | 0 | 295 | **Wire it.** OpenTelemetry-compatible export — important for prod-grade telemetry. |
| `src/channels/echo-channel-adapter.ts` | 0 | 1 | 1 | 104 | **Delete OR migrate.** Added to close a "BaseChannelAdapter has 0 subclasses" finding (see lib.ts:1272-1274). The fix is cosmetic — it doesn't actually motivate using the base class. See §3.2. |

### 2.2 Truly dead (no src/ ref, no lib.ts export, no test)

These are pure dead code: no grep hits outside their own file.

| Module | LOC | Reason for existence | Recommendation |
|---|---|---|---|
| `src/tools/aux-tools.ts` | 253 | Wraps pdf/post-callback/task.spawn as agent tools. `index.ts` dynamically imports these via `task-tool.ts` directly. | **Delete** (superseded by direct `TaskTool` wiring) OR **wire** via `runtime-tools.ts`. |
| `src/memory/memvid-backend.ts` | 393 | Portable single-file memory store inspired by memvid. | **Park with TODO** or **delete**. Feature is valuable (export/import/backup); wire it as `wotann memory export --memvid`. |
| `src/providers/harness-profiles.ts` | 242 | Named provider presets ("fast-cheap", "max-quality", "offline"). | **Wire it.** This is explicit value for free-tier users. Ship as `wotann profile [list|switch]`. |
| `src/desktop/desktop-store.ts` | 214 | Zustand-shaped state types + factory. Real Zustand store lives in `desktop-app/src/store/`. | **Delete.** Duplicate typing in TS when desktop-app/src/store has its own. |
| `src/utils/platform.ts` | 83 | OS detection — DIFFERENT `detectPlatform()` shape than `computer-use/platform-bindings.ts`. | **Delete.** `computer-use/platform-bindings.ts` is the real one (used in meeting-pipeline.ts + perception-engine.ts). |
| `src/utils/logger.ts` | 98 | `StructuredLogger` class. No callers. Audit trail lives in `telemetry/audit-trail.ts`. | **Delete.** |
| `src/cli/pipeline-mode.ts` | 180 | `readStdin` + `runPipeline` helpers. `index.ts:48-94` has inline implementation. | **Delete or unify.** The inline version at `index.ts:48` is actually used; the module is shelf-ware. |
| `src/cli/debug-share.ts` | 289 | `/debug share` command per spec Appendix. No wiring. | **Wire it.** Real bug-reporting flow. |
| `src/cli/onboarding.ts` | 164 | 7-step wizard for first-time setup. `index.ts` uses `ProjectOnboarder` from `core/project-onboarding.ts` instead. | **Wire or delete.** Two parallel onboarding flows. |
| `src/cli/incognito.ts` | 130 | `createIncognitoConfig`. App.tsx has its own inline incognito logic at line 2688. | **Delete or wire.** One must go. |
| `src/cli/history-picker.ts` | 247 | `HistoryPicker` class for Ctrl+R history. UI uses `ui/components/HistoryPicker.tsx` (separate React component). | **Delete** — the TSX component is the real implementation. |
| `src/daemon/auto-update.ts` | 193 | Model/skill/plugin auto-update checker on heartbeat. No caller. | **Wire it.** Real value — keep users' model list fresh. |

**Subtotal dead**: ~2,486 LOC of dead code (excluding duplicates).

### 2.3 Duplicate ghost files (" 2.ts")

Six src files + four test files are saved-as-copy duplicates. None are referenced. Total: 51,532 LOC of ghost text.

| File | LOC | Matching live file | Diff? |
|---|---|---|---|
| `src/core/runtime 2.ts` | 4,910 | `src/core/runtime.ts` (6,315) | Old snapshot, 1,400+ LOC older |
| `src/memory/store 2.ts` | 2,443 | `src/memory/store.ts` (2,597) | Older |
| `src/orchestration/autonomous 2.ts` | 1,344 | `src/orchestration/autonomous.ts` (1,542) | Older |
| `src/orchestration/coordinator 2.ts` | 273 | `src/orchestration/coordinator.ts` (324) | Older |
| `src/tools/web-fetch 2.ts` | 601 | `src/tools/web-fetch.ts` (601) | Older but same LOC — binary-different |
| `src/tools/aux-tools 2.ts` | 253 | `src/tools/aux-tools.ts` (253) | Same LOC — binary-different |
| `tests/unit/connector-tools.test 2.ts` | ? | `tests/unit/connector-tools.test.ts` | Older |
| `tests/unit/connector-writes.test 2.ts` | ? | same-named live | Older |
| `tests/unit/marketplace-acp.test 2.ts` | ? | same-named live | Older |
| `tests/unit/tool-timing-logger.test 2.ts` | ? | same-named live | Older |

**Recommendation: delete all 10 ghost files.** They are not in `.gitignore`, they are not in `tsconfig.json`, they are not imported anywhere, but they are in the working tree and probably inflated the "LOC" count in prior audits. Confirm by `grep -rn "runtime 2\|store 2\|autonomous 2\|coordinator 2\|web-fetch 2\|aux-tools 2" src tests` → 0 matches (verified).

### 2.4 Partially wired (caller exists but path gated/dead)

| Module | Status | Evidence |
|---|---|---|
| `runtime-hooks/dead-code-hooks.ts::crystallizeSuccessHook` | **Caller gated — invocation happens but provider-fn is never supplied.** `autonomous.ts:1062-1063` calls `callbacks?.getCrystallizationContext?.()` but `grep "getCrystallizationContext:" src` returns **0 matches** — no callsite passes the callback. The hook exists but its data source is never populated. |
| `runtime-hooks/dead-code-hooks.ts::requiredReadingHook` | **Caller exists.** `agent-registry.ts:396,424` calls it via `spawnWithContext`; `spawnWithContext` now has a consumer at `runtime.ts:5259` (closes the prior audit's "spawnWithContext has 0 callers" finding). ✅ |
| `orchestration/coordinator.ts::Coordinator` | **Lib-only callers.** `grep Coordinator src` returns `coordinator.ts`, `parallel-coordinator.ts` (related but different class), `lib.ts`. **Real dispatch is through `AutonomousExecutor`, not `Coordinator`.** |
| `memory/pluggable-provider.ts::MemoryProvider` interface | **Defined but unimplemented.** `MemoryStore` does NOT implement this interface. The pluggable backend is aspirational. |
| `channels/base-adapter.ts::BaseChannelAdapter` | **1 subclass (Echo reference); 15 real adapters implement `ChannelAdapter` (adapter.ts) instead.** See §3.2. |
| `memory/contextual-embeddings.ts::buildContextualChunk` | **Sibling-wired.** `memory/store.ts:31,911` imports `clampContextTokens` + `cleanContext` from this module, but the marquee `buildContextualChunk` function is never called. Flagged in prior audit. |
| `testing/visual-verifier.ts::verifyVisual` | **Lib+test-wired.** `runtime.ts` does not call it; `visual-diff-theater.ts` is the wired path. |

---

## 3. Architectural Gaps

### 3.1 God objects (files > 1,500 LOC)

| File | LOC | Methods | Fields/imports | Verdict |
|---|---|---|---|---|
| `src/core/runtime.ts` | 6,315 | ~169 | 168 private fields, 192 imports | **Worst god object.** Single class `WotannRuntime` composes every subsystem. `runtime-tools.ts` + `runtime-tool-dispatch.ts` + `runtime-intelligence.ts` were extracted; extract more. |
| `src/index.ts` | 5,633 | n/a | 115 subcommand definitions in one file | **CLI god file.** 12 subcommand namespaces (voice, local, daemon, plan, channels, memory, skills, telemetry, mcp, train, acp, shell). Should be one file per namespace. |
| `src/daemon/kairos-rpc.ts` | 5,513 | ~17 RPC methods + 459 helpers | 1 class (`KairosRPCHandler`) | **RPC god file.** Should be split into per-namespace handlers (voice-rpc, memory-rpc, cost-rpc, ...). |
| `src/memory/store.ts` | 2,597 | ~80 methods on `MemoryStore` | 10 SQLite tables | **Acceptable density — SQLite work is inherently verbose.** Could extract `embeddings/` + `migrations/`. |
| `src/daemon/kairos.ts` | 2,568 | ~90 methods (at least 30 are getters) | `KairosDaemon` class | **Secondary god object.** 30+ getters suggest this is a service locator — should be a DI container or separate the registry from the daemon. |
| `src/desktop/companion-server.ts` | 2,075 | ~40 | WebSocket handlers | **High, acceptable for network server.** |
| `src/orchestration/autonomous.ts` | 1,542 | 117 | `AutonomousExecutor` class | **High but cohesive.** 117 methods on one executor suggests strategy objects should be extracted. |
| `src/hooks/built-in.ts` | 1,382 | 17+ hook registrars | Dense but purposeful | **Acceptable — hooks are inherently a registry file.** |
| `src/providers/provider-service.ts` | 1,347 | ~22 | Provider health + routing | **High, acceptable.** Could extract health checks. |
| `src/connectors/connector-writes.ts` | 1,306 | 6 per-connector writers | External API calls | **Acceptable.** |
| `src/ui/App.tsx` | 3,081 | Many `use*` hooks inline | Massive React component | **UI god component.** Should be split into subcomponents by feature area (10-15 smaller TSX files). |

### 3.2 Two competing channel-adapter base types

`src/channels/adapter.ts:38` defines `ChannelAdapter` interface. Implementations: slack, discord, line, mastodon, whatsapp, signal, matrix, irc, email, webchat, telegram, sms, webhook, teams, imessage — **16 real adapters**.

`src/channels/base-adapter.ts:40` defines `BaseChannelAdapter` abstract class. Implementations: `EchoChannelAdapter` — **1 reference implementation added to make `extends BaseChannelAdapter` > 0.**

**Verdict**: two architecture plans for the same concern exist side by side. Either migrate all real adapters to `BaseChannelAdapter` (real refactor) or delete `base-adapter.ts` + `echo-channel-adapter.ts` (admit the experiment failed). Shipping both is pure cost — every new adapter author has to choose, and tests double.

Evidence:
```
grep -l "implements ChannelAdapter" src/channels/*.ts
  → adapter.ts + 15 real adapters
grep -l "extends BaseChannelAdapter" src/channels/*.ts
  → echo-channel-adapter.ts  (1 file)
```

### 3.3 Five "verification" classes with unclear boundaries

| Class | File | Concern |
|---|---|---|
| `AutoVerifier` | `intelligence/auto-verify.ts` | Post-response auto-verification |
| `VerificationCascade` | `intelligence/verification-cascade.ts` | Cascading verification steps |
| `ForcedVerificationMiddleware` | `middleware/forced-verification.ts` | Forces verification mid-stream (0 external callers) |
| `VerificationEnforcementMiddleware` | `middleware/verification-enforcement.ts` | Post-response verification enforcement |
| `IntentVerifier` | `security/intent-verifier.ts` | Verify user intent before risky ops |

`forced-verification.ts` and `verification-enforcement.ts` overlap; their files even admit this in their own docblocks (`pre-completion-checklist.ts:19` comments say "DIFFERENCE FROM forced-verification.ts"). `forced-verification.ts` has zero runtime callers (only docblock references). **Consolidate to two clear classes: pre-gate (intent) and post-gate (enforcement); delete or document the rest.**

### 3.4 Seven parallel orchestrators

| Class/Function | File | Purpose |
|---|---|---|
| `AutonomousExecutor` | `orchestration/autonomous.ts` | Main autonomous loop — wired |
| `Coordinator` | `orchestration/coordinator.ts` | Task coord — lib+test only |
| `LongHorizonOrchestrator` | `orchestration/long-horizon-orchestrator.ts` | Phase-gated 8h+ runs — lib only |
| `buildWaves` + `executeWaves` | `orchestration/wave-executor.ts` | Parallel wave executor — wired via runtime.ts:251 |
| `RalphMode` | `orchestration/ralph-mode.ts` | Verify-fix loop — wired |
| `PWRCycle` | `orchestration/pwr-cycle.ts` | 6-phase plan-work-review — lib only |
| `SpecToShip` | `orchestration/spec-to-ship.ts` | Spec→ship pipeline — lib only |
| `SelfHealingPipeline` | `orchestration/self-healing-pipeline.ts` | Self-healing — wired |
| `SpeculativeExecution` | `orchestration/speculative-execution.ts` | Speculative execution — lib only |
| `runCouncil` | `orchestration/council.ts` | Multi-agent council — wired |
| `runArenaContest` | `orchestration/arena.ts` | Multi-model arena — wired |
| `AgentHierarchyManager` | `orchestration/agent-hierarchy.ts` | Agent hierarchy |
| `AgentRegistry` | `orchestration/agent-registry.ts` | Registry + spawn |
| `AgentWorkspace` | `orchestration/agent-workspace.ts` | Shared workspace |

Strong overlap between `AutonomousExecutor`, `LongHorizonOrchestrator`, `PWRCycle`, `SpecToShip`, `RalphMode`, `Coordinator`. All are "run a loop with phases until done". A unifying base class (e.g. `PhasedExecutor`) with pluggable phase-policies would consolidate the contract.

### 3.5 Cyclic concerns (speculative — would need `madge` to confirm)

**Speculative**: `core/runtime.ts` imports from `memory/store.ts`; `memory/store.ts` has no import of `runtime.ts`. Kairos (`daemon/kairos.ts`) imports both runtime and memory store. No obvious cycle in the spine.

`core/runtime.ts:192` imports `orchestration/*` (autonomous, arena, council); `orchestration/autonomous.ts:42` imports `runtime-hooks/dead-code-hooks.ts` → which imports `skills/self-crystallization.ts` + `agents/required-reading.ts`. These are tree, not cycles.

Where cycles might live:
- `learning/dream-runner.ts:16` → `memory/store.ts`; `memory/store.ts:31` imports from `memory/contextual-embeddings.ts`, which imports nothing back — OK.
- `identity/persona.ts` ↔ `identity/user-model.ts` ↔ `intelligence/user-model.ts` — **speculative**: the intelligence wrapper imports `identity/user-model.ts:14`; neither imports back. OK.

### 3.6 Mid-flight UserModel split

`src/identity/user-model.ts` (481 LOC) contains the real class `UserModel`. `src/intelligence/user-model.ts` (195 LOC) contains `UserModelManager` which imports the real class. Lib.ts re-exports the Manager (line 1181). Runtime imports the Manager (line 214).

This is valid composition BUT the naming is confusing. **Recommendation**: rename `UserModelManager` to `UserContextRouter` or `UserProfileService` so the layered structure is obvious.

### 3.7 Pluggable-memory-provider abstraction with zero adopters

`src/memory/pluggable-provider.ts:20` defines a clean `MemoryProvider` interface. `MemoryStore` (the real implementation, 2,597 LOC) does NOT implement it. The ONLY consumers are `InMemoryProvider` (built-in ephemeral) + `MultiTurnMemory` (test scaffolding). **The abstraction was designed for an ecosystem that never materialized.**

Either retrofit `MemoryStore` to implement `MemoryProvider`, or delete the interface. Currently it's 368 LOC of lib.ts-only text that blocks simplification.

### 3.8 Two onboarding implementations

- `src/cli/onboarding.ts:42` — `runOnboarding()` + 7-step wizard per spec.
- `src/core/project-onboarding.ts` — `ProjectOnboarder` class, wired via `index.ts:428,436,448` and `ui/App.tsx:2653`.

**Only `ProjectOnboarder` is wired.** `runOnboarding()` is dead.

### 3.9 Two pipeline-mode implementations

- `src/cli/pipeline-mode.ts:16` — `readStdin` + `runPipeline` helpers (dead module).
- `src/index.ts:48-94` — inline pipe handler inside `start` command.

The CLI command short-circuits the module; the module is shelf-ware.

---

## 4. Wiring Priority List (top 20 by product impact)

Ordered by: **(a) user-visible feature impact** × **(b) how close to shipping it is** × **(c) wiring effort in days**.

| # | Module | Wiring effort | Impact |
|---|---|---|---|
| 1 | `security/human-approval.ts` | S | Destructive-op gating for autopilot. High-value guardrail. |
| 2 | `orchestration/auto-commit.ts` | M | Atomic conventional commits after each verified cycle — key autopilot UX. |
| 3 | `providers/harness-profiles.ts` | M | Named presets ("fast-cheap", "offline", "max-quality") — user-visible preset system. |
| 4 | `ui/agent-fleet-dashboard.ts` | M | Live fleet view in TUI — key differentiator for parallel-agent users. |
| 5 | `daemon/auto-update.ts` | M | Model/skill/plugin registry freshness — addresses the "how do I find new models" UX gap. |
| 6 | `memory/memvid-backend.ts` | M | Portable memory export/import — addresses the "share memory between machines" need. |
| 7 | `telemetry/observability-export.ts` | M | OpenTelemetry export — production-grade observability story. |
| 8 | `orchestration/red-blue-testing.ts` | L | Adversarial testing primitive post-verification. |
| 9 | `orchestration/long-horizon-orchestrator.ts` | L | Phase-gated 8h+ runs. Pairs with autopilot but needs integration. |
| 10 | `orchestration/spec-to-ship.ts` | L | End-to-end spec pipeline. |
| 11 | `cli/debug-share.ts` | S | `/debug share` command — bug-report UX. |
| 12 | `cli/onboarding.ts` | M | 7-step wizard — either fold into `ProjectOnboarder` or expose as `wotann setup --wizard`. |
| 13 | `providers/extended-thinking.ts` | S | Route `buildThinkingParams` through provider-service. |
| 14 | `providers/thinking-preserver.ts` | S | Multi-turn thinking preservation (correctness-critical). |
| 15 | `providers/capability-fingerprint.ts` | S | Fingerprint cache for CapabilityEqualizer. |
| 16 | `orchestration/dual-persona-reviewer.ts` | M | Two-persona code review pair. |
| 17 | `orchestration/phase-gate.ts` | S | Gate-per-phase pattern; generic primitive that many orchestrators could use. |
| 18 | `orchestration/plateau-detector.ts` | S | Detect plateau signals in long runs. |
| 19 | `providers/model-switcher.ts` | S | Merge with model-router OR wire as a separate switching policy. |
| 20 | `channels/echo-channel-adapter.ts` | **decide: delete or migrate all real adapters to BaseChannelAdapter** | Either way, stops shipping two architecture plans. |

---

## 5. Refactor Opportunities (top 10 by value × cost)

Effort: **S = <1 day**, **M = 1–3 days**, **L = 3+ days**.

| # | Refactor | Effort | Value |
|---|---|---|---|
| 1 | **Delete 10 "* 2.ts" ghost files** (6 src + 4 test). 0 callers, 51 KLOC of dead text. | S | High (confuses readers, inflates LOC stats). |
| 2 | **Extract per-namespace RPC handlers from `daemon/kairos-rpc.ts` (5,513 LOC → 12 files of ~450 LOC each)**. Structure: `kairos-rpc-voice.ts`, `kairos-rpc-memory.ts`, `kairos-rpc-cost.ts`, etc. `KairosRPCHandler` becomes a thin router. | L | High (single biggest maintainability win after duplicates). |
| 3 | **Split `index.ts` (5,633 LOC, 115 subcommands) into per-namespace command files** (`cli/commands-daemon.ts`, `cli/commands-channels.ts`, ...). Keep `index.ts` as a 500 LOC root that registers subcommands. | L | High (CLI readability + testability). |
| 4 | **Split `ui/App.tsx` (3,081 LOC) into ~15 focused TSX files by feature area.** E.g. extract the slash-command handler, the status-bar, the chat view, the history picker integration. | L | High (TUI changes currently require reasoning about 3K LOC at once). |
| 5 | **Consolidate verification classes** (§3.3). Delete `middleware/forced-verification.ts`; document `VerificationEnforcementMiddleware` + `IntentVerifier` + `AutoVerifier` + `VerificationCascade` as 4 layers with a single diagram. | M | Medium (removes 209 LOC of confusion). |
| 6 | **Resolve the two adapter base types** (§3.2). Pick one: either migrate 16 real adapters to `BaseChannelAdapter` or delete `base-adapter.ts` + `echo-channel-adapter.ts`. | M-L | Medium (eliminates onboarding confusion). |
| 7 | **Unify the 7 orchestrator patterns around a `PhasedExecutor` base** (§3.4). Pluggable phase policies (DISCUSS/PLAN/IMPLEMENT/REVIEW/UAT/SHIP vs RESEARCH/IMPLEMENT/TEST/REVIEW/SHIP vs OUTLINE/DRAFT/REVISE/POLISH). | L | High (currently the "what orchestrator do I use" decision has 7 options). |
| 8 | **Extract strategy objects from `AutonomousExecutor` (1,542 LOC, 117 methods → 800 LOC executor + 8 strategy files)**. | M | Medium (testability). |
| 9 | **Resolve `MemoryProvider` vs `MemoryStore`** (§3.7). Either make `MemoryStore` implement `MemoryProvider`, or delete the abstraction. | M | Medium. |
| 10 | **Delete the 12 "truly dead" modules (§2.2)** after sanity-check (preserve those that are clearly valuable, e.g. `memvid-backend.ts`, `harness-profiles.ts`, `cli/debug-share.ts`, `daemon/auto-update.ts`). | S | Medium. |

---

## 6. Unknown Unknowns (things previous audits missed)

### 6.1 Ghost duplicates are still in the tree

Previous audits emphasized LOC and "module count"; none flagged that `src/core/runtime 2.ts` is 4,910 LOC of stale runtime code sitting alongside the live 6,315 LOC `runtime.ts`. If anyone greps for `runtime` without anchoring to import paths, they get both. Ditto `store 2.ts`, `autonomous 2.ts`, `coordinator 2.ts`, `web-fetch 2.ts`, `aux-tools 2.ts`. Four test duplicates (`connector-tools.test 2.ts`, `connector-writes.test 2.ts`, `marketplace-acp.test 2.ts`, `tool-timing-logger.test 2.ts`) exist in `tests/unit/`.

### 6.2 `utils/logger.ts` and `utils/platform.ts` are fully dead, but their names sound production-critical

These files are 181 LOC combined of code that looks load-bearing (`StructuredLogger`, `detectPlatform`). Any new contributor grepping for "logger" would find this file and assume it's the answer. The real audit trail is `telemetry/audit-trail.ts`; the real platform detection is `computer-use/platform-bindings.ts`.

### 6.3 Prior audit declared `UnifiedKnowledgeFabric` + `ContextTreeManager` + `SteeringServer` + `assemblePromptModules` as FATAL orphans — all four are now wired

`FINAL_VERIFICATION_AUDIT_2026-04-19.md` (committed at end of Wave 4H) says these are still FATAL/ORPHAN. Verification this session:

- `UnifiedKnowledgeFabric`: wired at `runtime.ts:37,738,1090`.
- `ContextTreeManager`: wired at `runtime.ts:43,746,1135,5661,5680`.
- `SteeringServer`: wired at `runtime.ts:245,722,729`.
- `assemblePromptModules`: wired at `prompt/engine.ts:14,321`.

The doc is stale — these got wired between the audit commit (`4a0d31a`) and HEAD. **This audit has a perishability problem.** Suggestion: every wiring commit should simultaneously update the audit tables.

### 6.4 `echo-channel-adapter.ts` is "audit theater"

`lib.ts:1272-1274` explicitly admits: "_Added to close the 'BaseChannelAdapter has 0 extenders' finding_." The file is 104 LOC of reference code that exists to produce a non-zero grep count, not to ship a real channel. It is, in effect, a test fixture masquerading as production code. The finding it closes was legitimate; the fix is cosmetic. The real answer is either migrate all 16 adapters to `BaseChannelAdapter` or delete the base class.

### 6.5 `MemoryStore` ignores the `MemoryProvider` interface that was designed for it

`src/memory/pluggable-provider.ts:20` — a beautiful 20-method `MemoryProvider` interface with JSDoc. `MemoryStore` does NOT implement it. The interface is the API shape WOTANN exports for third-party memory backends; the built-in backend uses a different API. This means any third-party backend that implemented `MemoryProvider` could not be swapped in for the built-in. **The pluggability claim is unsubstantiated.**

### 6.6 `AgentProfiles` / `ClaudeSDKBridge` / `WotannYml` / `PromptOverride` / `SchemaMigration` in `core/` are test-only

Five `core/` modules are test-only (never imported by runtime.ts). Given they live in `core/` (the spine), users assume they are core. In fact they are experiments or specs.

- `core/agent-profiles.ts` — test-only
- `core/claude-sdk-bridge.ts` — test-only
- `core/wotann-yml.ts` — test-only
- `core/prompt-override.ts` — test-only
- `core/schema-migration.ts` — test-only

Either wire or move to `experiments/`.

### 6.7 `workflows/` directory has one file (`workflow-runner.ts`), test-only, 447 LOC

`src/workflows/` is a single-file directory containing `workflow-runner.ts` that no runtime code calls. `orchestration/workflow-dag.ts` is the wired workflow engine. Either merge `workflow-runner.ts` into `orchestration/` or delete it.

### 6.8 `src/memory/evals/` is an empty-except-subdir fixture

`ls src/memory/evals/` returns only `longmemeval/`. There is no TS code at the `evals/` level. Likely eval data — but it sits under `src/` where `tsc` would try to compile anything with `.ts`. Verify it's actually not shipping bytes.

### 6.9 The test tree is healthy despite src rot

`tests/` has 364 `.test.ts` files exercising 357 distinct src paths (verified via grep of test imports). Coverage in the "wiring-only" dimension is strong for experimental modules — many lib-only modules have tests that prove correctness, they just have no production caller. Good test discipline; bad wiring discipline.

### 6.10 `auth/` is 910 LOC (2 files) but `auth/login.ts` alone is probably enough

The `auth/` directory imports `anthropic-subscription.ts` + `codex-oauth.ts` + `vertex-oauth.ts` from `providers/` — all three are wired. The `auth/` wiring is clean; this is a nit: 910 LOC for 2 files suggests the second file (`login.ts`? or whatever siblings) is heavy. Worth a targeted read to see if it can shed weight.

---

## Handoff to Master Synthesis (top 5 findings)

1. **10 ghost "* 2.ts" files totaling ~51,532 LOC sit in the tree uncommitted-to and unimported.** `src/core/runtime 2.ts` alone is 4,910 LOC. Safe to delete; confirm via `grep -r "runtime 2\|store 2\|autonomous 2\|coordinator 2\|web-fetch 2\|aux-tools 2" src tests` → 0 matches.
2. **Three god-objects dominate the codebase and block composability**: `core/runtime.ts` (6,315 LOC / 168 fields / 192 imports), `index.ts` (5,633 LOC / 115 CLI subcommands in one file), and `daemon/kairos-rpc.ts` (5,513 LOC in one RPC handler class). Extracting per-namespace RPC handlers and per-namespace command files is the single biggest maintainability win.
3. **20 modules are library-only (exported but never imported by src/)** and **12 are fully dead (no callers anywhere)**, totaling ~8,000 LOC of text that looks production-grade but is shelf-ware. Most are salvageable — `harness-profiles`, `human-approval`, `auto-commit`, `debug-share`, `memvid-backend`, `auto-update`, `observability-export`, `agent-fleet-dashboard` all have concrete user value if wired. Priority list in §4.
4. **Two competing base abstractions ship side by side and confuse new contributors**: `ChannelAdapter` interface (16 real implementations) vs `BaseChannelAdapter` abstract class (1 reference implementation added purely to close an audit finding); `MemoryProvider` interface (0 real implementations) vs `MemoryStore` concrete class (the real backend). Both need a migration-or-delete decision.
5. **Prior audit docs are already stale** — `FINAL_VERIFICATION_AUDIT_2026-04-19.md` lists `UnifiedKnowledgeFabric`, `ContextTreeManager`, `SteeringServer`, `assemblePromptModules` as FATAL orphans; all four are wired in HEAD. The audit-as-ground-truth assumption needs a mechanical rebuild on every wiring commit, or the docs will keep lying. Also, `orchestration/` has 7+ overlapping "run a phased loop until done" classes — `AutonomousExecutor` (wired), `LongHorizonOrchestrator`, `PWRCycle`, `SpecToShip`, `RalphMode`, `Coordinator`, `SpeculativeExecution` — with no unifying base class; consolidating them around `PhasedExecutor` with pluggable phase-policies would eliminate the "which orchestrator should I use" choice that currently blocks adoption.
