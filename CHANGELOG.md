# Changelog

All notable changes to WOTANN are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

[Unreleased]: https://github.com/gabrielvuksani/wotann/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gabrielvuksani/wotann/releases/tag/v0.1.0
