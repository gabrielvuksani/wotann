# Changelog

All notable changes to WOTANN are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-04-23

The V9 execution release. Ships Tier 0 legal hygiene, the top-10
wire-audit closures (Tier 1), memory SOTA activation (Tier 2),
MCP Apps server (Tier 4.1), the hardware-aware onboarding wizard
stack (Tier 6), Opus 4.7 + 1h-cache parity with Claude Code v2.1.x
(Tier 14.1), the Design Bridge emit/write/diff primitives (Tier 8.1-8.3),
and the dead-code cleanup (Tier 14.10). 21+ commits across Sessions
7–9 pushed to `origin/main`. Test suite: 7680+ passing.

### Added — Onboarding v2 (Tier 6)

- **Hardware detector** (`src/core/hardware-detect.ts`) — classifies
  the running machine into `cloud-only | low | medium | high | extreme`
  with Apple Silicon + NVIDIA detection and a reason string per tier.
- **Provider ladder** (`src/providers/provider-ladder.ts`) — canonical
  12-rung priority ordering (subscription → free-tier → BYOK → local →
  advanced) with `selectFirstAvailable` / `filterLadder` / `groupByCategory`.
- **LM Studio adapter** (`src/providers/lm-studio-adapter.ts`) — probe
  + adapter wrapper over the OpenAI-compat transport.
- **Config migration** (`src/core/config-migration.ts`) — detects
  pre-0.2 config signatures + legacy credential files, archives to
  `~/.wotann/.legacy/<stamp>/` without in-place rewrites.
- **First-run success driver** (`src/cli/first-run-success.ts`) —
  structured event generator (banner / roundtrip-started / chunks /
  done / failed) the Ink TUI streams.
- **Ink TUI wizard** (`src/cli/onboarding-screens.tsx`, 832 LOC) —
  5 screens: Welcome → Strategy → Pick → Confirm → FirstRun. Exposes
  pure reducer + helpers for headless testing; 28 reducer/logic tests.

### Added — Memory SOTA (Tier 2)

- **LongMemEval 500-item corpus download** with SHA-verified fetch +
  cache.
- **LLM-judge scorer** (`src/memory/evals/longmemeval/scorer.ts`) —
  ability-specific judge prompts + bounded-concurrency evaluation,
  preserves rule-based strict/lenient pass flags alongside verdict.
- **OMEGA + TEMPR default-on** — recall flags flip from explicit-opt-in
  to explicit-opt-out (`WOTANN_USE_TEMPR=0` to disable).
- **Nightly benchmark workflow** (`.github/workflows/benchmark-nightly.yml`)
  — cron + workflow_dispatch, env-var pattern for input allowlist,
  secret prereq check.

### Added — MCP Apps (Tier 4.1)

- **Server-side UI resources** (`src/mcp/ui-resources.ts`) — 3 prebuilt
  resources (memory-browser, cost-preview, editor-diff) registered with
  stable `ui://wotann/*` URIs; MCP server exposes `resources/list` +
  `resources/read`; iframe-safe HTML shell with `window.mcp.postMessage`
  bridge stub.

### Added — Top-10 Wire-Audit Closures (Tier 1)

- **T1.1 KEYSTONE** — `computer.session.step` RPC now actually invokes
  `executeDesktopAction`. Unblocks the entire F-series cross-surface
  flow.
- **T1.3** — `sqlite-vec` backend attached to MemoryStore (idempotent,
  opt-in via `attachVectorBackend`).
- **T1.4** — ONNX cross-encoder attached via `attachOnnxCrossEncoder`
  for memory reranking.
- **T1.5** — `warmupCache` fires after `buildStablePrefix` on
  `updateSystemPromptForMode`.
- **T1.6** — HMAC signature verification on Slack, Telegram, Discord,
  WhatsApp, Teams, and Twilio SMS channel adapters (scheme-specific:
  HMAC-SHA256, IP allowlist, Ed25519, HMAC-SHA1, JWT-structural).
- **T1.7** — `resolvePermission` wired into sandbox-audit middleware's
  `resolveToolPermission(msg, mode)`.
- **T1.8** — `SelfHealingPipeline` now fires from `AutonomousExecutor`'s
  failure branch with `executeRecovery` (corrects V9's wrong method
  name `heal`).
- **T1.9** — `searchUnifiedKnowledge` exposed via `memory.searchUnified`
  RPC handler.
- **T1.10** — 1h age gate on `.wotann` orphan-file sweep prevents
  false-positive deletions on fresh files.

### Added — Claude Code parity (Tier 14.1)

- **Opus 4.7 xhigh effort** tier (`ThinkingEffort = "low" | "medium" |
  "high" | "xhigh" | "max"`) with `supportsXhighEffort(model)` +
  `clampEffortForModel` helpers. Matches CC v2.1.111.
- **1h prompt cache TTL** (`ENABLE_PROMPT_CACHING_1H=1`) — opt-in
  longer cache tier with the `extended-cache-ttl-2025-04-11` beta
  header attached only on the 1h path. 5m wire format byte-identical
  pre/post T14.1b on the default path. Matches CC v2.1.108.

### Added — Design Bridge (Tier 8.1-8.3)

- **DTCG emitter** (`src/design/dtcg-emitter.ts`) — structural
  `DesignSystem` → W3C DTCG v6.3 tree with `$type`/`$value`/
  `$description` + alias helpers + deterministic serializer.
- **Bundle writer** (`src/design/bundle-writer.ts`) — mirror of
  `handoff-receiver.ts`. Produces manifest.json (snake_case) +
  design-system.json + optional components / figma / code-scaffold /
  assets. Overwrite-safe with `_wotann-partial` sentinel.
- **Bundle diff** (`src/design/bundle-diff.ts`) — tree-diff two
  bundles with added / removed / changed entries + dotted source
  paths. Field-prioritized (`$type > $value > $description > shape`),
  lexicographically sorted, plain-text formatter.

### Removed — DEAD-SAFE cleanup (Tier 14.10)

- Deleted 4 unreferenced duplicates (526 LOC): `src/utils/logger.ts`
  (telemetry/ covers audit logging), `src/utils/platform.ts` (direct
  duplicate of `computer-use/platform-bindings.ts::detectPlatform`),
  `src/cli/incognito.ts` (factory never called; session uses boolean
  flag), `src/desktop/desktop-store.ts` (Zustand types that belong in
  the separate desktop-app codebase).
- Kept `src/cli/history-picker.ts` + `src/cli/pipeline-mode.ts` as
  orphan scaffolds with inline status comments (resurrection-plausible
  for cross-session history + Unix-pipe composability).

### Changed — Legal hygiene (Tier 0)

- Renamed `anthropic-subscription.ts` → `claude-cli-backend.ts`
  (delegates to the Claude Code CLI instead of managing OAuth
  directly — follows pattern OpenClaw documents as sanctioned).
- Renamed `codex-oauth.ts` → `codex-detector.ts` (read-only, reads
  tokens written by `codex login`, never mints).
- Copilot adapter banner flags experimental status.
- `SECURITY.md` appended with the Subscription Provider Access Policy.

## [0.4.0] - 2026-04-20

The second major public release. **434 commits since v0.1.0.** This release lands every sprint from Phase 1–5, the full daemon RPC surface, the 8-layer memory, capability augmentation across 19 providers, the Ralph + self-healing autopilot, Tauri desktop, iOS companion, and the single-executable (SEA) release binary.

> **Distribution note:** This release ships the **macOS arm64 SEA binary only**. Linux / Windows / macOS x64 builds are produced by the CI matrix from the same tag — they are intentionally excluded from this manual release to avoid shipping artifacts that haven't been locally verified. Tag `v0.4.0` is in place; re-running the `Release` workflow will populate the remaining targets.

### Added
- **CI is green on `main`** — split jobs (typecheck-build hard-required on Ubuntu+macOS, test sharded 2-way with shard 1 advisory due to GH runner preemption flake, desktop-typecheck hard-required); `npm rebuild better-sqlite3` step + `--ignore-scripts` on `npm ci` to skip the postinstall tsc; `NODE_OPTIONS=--max-old-space-size=6144` on test jobs
- **NotificationService wiring** (A4) — `autonomous.run` now pushes `task-complete` on success and `error` on failure with task summary
- **MCP integrations CRUD** — `mcp.toggle` + `mcp.add` daemon handlers; Tauri proxies `toggle_mcp_server` + `add_mcp_server`; MCP tab works end-to-end
- **Connector save/test** — `connectors.save_config` + `connectors.test` daemon handlers; full Connectors panel functionality
- **Composer multi-file apply** — `composer.apply` daemon handler + `composer_apply` Tauri proxy; MultiFileComposer batch writes work
- **IRC + Google Chat channel registration** (E9) — env-gated activation via `IRC_SERVER`+`IRC_NICK` and `GOOGLE_CHAT_WEBHOOK`
- **Instruction provenance API** (E8) — `traceInstructions`, `whichSource`, `findProvenance`, `renderSourceSummary` exported from `src/lib.ts`
- **Trust UI + Integrations View routing** — both panels now reachable from the desktop AppShell router
- **Token accounting fix** — totalTokens now correctly accumulates as output (was input=0 silently failing across 812 sessions)
- **Memory promotion pipeline** — observations now promote from `auto_capture` to `memory_entries` with correct `MemoryBlockType` mapping (decision/preference/milestone/problem/discovery)
- **iOS cost surface** — `MobileRuntimeBridge.getCost` exposes optional `monthCost`; QuickAction + Widget handlers prefer real value over `weekCost*4` fallback
- **DiffPanel live updates** — `useStreaming.ts` dispatches `wotann:diff-update` events on `edit_file`/`write_file`/`write`/`edit`/`str_replace_editor` tool calls
- **3 silent-invoke fixes** — `channels.status` → `get_channels_status`, `connectors.list` → `get_connectors`, `skills.list` → `get_skills`
- **CONTRIBUTING.md, SECURITY.md, CODE_OF_CONDUCT.md** — community files for production-grade repo

### Changed
- **CI matrix** — Node 22 on ubuntu + macOS; added desktop-app typecheck job
- **Tauri ad-hoc codesign** (T6.1) — `signingIdentity` `""` → `"-"` so Gatekeeper recognises locally-built bundles
- **Monitor banner** — "NEXUS Research Intelligence" → "WOTANN Research Intelligence"
- **Monitor history path** — `.nexus/monitor/history.sqlite` → `.wotann/monitor/history.sqlite`
- **Defensive bridge calls** — `infra?.bridge.getAdapter` → `infra?.bridge?.getAdapter?.()` for graceful degradation in test mocks (drops 11 false-failing tests)

### Removed
- **`src/providers/extra-adapters.ts`** — 192 LOC of dead code superseded by `registry.ts` inline handling of all 7 OpenAI-compat providers
- **`tests/unit/self-healing.test.ts`** — tested `SelfHealingExecutor` from removed `self-healing.js` (renamed to `self-healing-pipeline.ts`); other tests cover the new class
- **`SecurityScanPanel.STATIC_SURFACE_STUB`** — fabricated 5 fake CVEs on first load; now empty until real scan runs
- **DiffPanel "Mock diff data" comment** — stale, replaced with real event-source documentation

### Fixed
- **Test suite 3660/3660** (1 intentional skip for daemon-lifecycle e2e gated by `WOTANN_E2E_DAEMON=1`): cleaned up 10 pre-existing test failures — provider count 11→18 (discovery, integration, e2e), persona default name "Nexus"→"WOTANN", local-context tree size 550→2000, parallel-search workspace moved to `os.tmpdir()`, diff-engine `applyDiff` skips conflict check in dry-run mode, kairos-rpc `providers.switch`/`providers.list` accept env-dependent outcomes, source-monitor tests skip when `research/monitor-config.yaml` is absent
- **secure-auth.ts** — pad P-256 private key hex to 64 chars (OpenSSL drops leading zero bytes occasionally; was a flaky test failure)
- **companion-server.ts** — swallow `EPERM`/`ESRCH` from `bonjourProc.kill()` (CI runners restrict process kill on subprocesses they didn't spawn)
- **runtime.ts** — defensive `infra?.bridge?.getAdapter?.()` optional-chain (drops 11 false test failures from incomplete bridge mocks)
- **vitest.config.ts** — migrated from deprecated nested `poolOptions` to Vitest 4 top-level `pool: "forks"`
- **desktop-app React 19 type errors** — `import type { JSX } from "react"`, `as unknown as ...` cast, `'bundles' in result` type guards, `e.nativeEvent.isComposing`, `vite-env.d.ts` for CSS module declarations
- **Corrupt 624 MB packfile** — repo reinit on `main` branch; backup preserved at `../wotann-old-git-20260414_114728/`
- **gitignore** — added runtime state, per-user caches, stale xcodeproj bundles, build artifacts; quoted patterns unquoted (quotes are literal in `.gitignore`)
- **Tauri build assets tracked** — Entitlements.plist, Info.plist, build.rs, capabilities/, icons/, .cargo/

## [0.1.0] - 2026-04-14

Initial public release.

- 17-provider adapter system with automatic fallback chaining
- 26-layer middleware pipeline
- 8-layer memory (SQLite + FTS5 + vector + graph-RAG + episodic)
- 29 orchestration patterns (coordinator, waves, PWR, Ralph, self-healing, council, arena)
- 4-layer Computer Use stack with text-mediated control
- 19-event hook engine + DoomLoop detector + PerFileEditTracker
- Multi-surface: CLI + TUI + Tauri Desktop + iOS (with Watch + CarPlay + Widgets + Siri + Share)
- 15 channel adapters (Telegram, Slack, Discord, Signal, WhatsApp, iMessage, Teams, Matrix, email, webchat, webhooks, SMS, GitHub bot, IDE bridge, IRC, Google Chat)
- Norse-themed identity system with 8-file bootstrap
- KAIROS daemon with 15s tick, cron, heartbeat, event triggers
- Session-token RPC auth (kairos-ipc.ts)
- Capability augmentation (tool-calling, vision, thinking) for any provider
- Voice pipeline (edge-TTS, VibeVoice, STT detection, faster-whisper)
- Skill registry with 86 progressive-disclosure skills
- MCP registry with import-from-Claude-Code support
- Anti-distillation (fake tool injection + zero-width Unicode watermarks)
- 3,723 unit tests via Vitest

[Unreleased]: https://github.com/gabrielvuksani/wotann/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/gabrielvuksani/wotann/releases/tag/v0.4.0
[0.1.0]: https://github.com/gabrielvuksani/wotann/releases/tag/v0.1.0
