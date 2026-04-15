# CLAUDE.md — For Building WOTANN

## What This Is
WOTANN is a unified AI agent harness. Named after the Germanic All-Father — god of wisdom, war, poetry, magic, and the runes. The mega-plan is at `~/.claude/plans/glistening-wondering-nova.md`.

## Quick Commands
```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run dev           # tsx src/index.ts
```

## Naming Convention
- Product: **WOTANN** (wotann.com)
- CLI: `wotann start`, `wotann init`, `wotann build`, `wotann compare`
- Config: `.wotann/`, `wotann.yaml`
- URL scheme: `wotann://`

### User-Facing Feature Names (clear English — no jargon)

| Feature | Name | CLI Command | Description |
|---------|------|------------|-------------|
| Send task phone→desktop | **Relay** | `wotann relay` | Relay a task from phone to desktop |
| Local agent tasks | **Workshop** | `wotann workshop` | Agent workshop for local file tasks |
| Agent-crafted outputs | **Creations** | — | What the agent built (code, docs, diffs) |
| Side-by-side code editing | **Editor** | — | Monaco-based code editor in Desktop |
| Model comparison | **Compare** | `wotann compare` | Side-by-side model comparison |
| Multi-model review | **Review** | `wotann review` | Multiple models review together |
| Connect devices | **Link** | `wotann link` | Link phone to desktop session |
| Screen control | **Desktop Control** | — | Agent sees and controls your screen |
| Agent builds/creates | **Build** | `wotann build` | Agent mode — writes code |
| Background task executors | **Workers** | — | Background workers running in parallel |
| Autonomous execution | **Autopilot** | `wotann autopilot` | Agent runs until task is complete |
| Always-on daemon | **Engine** | `wotann engine` | Background runtime daemon |
| Phone↔desktop connection | **Bridge** | — | WebSocket bridge between devices |
| Prompt improvement | **Enhance** | `wotann enhance` | Make prompts clearer and more specific |
| Reusable capabilities | **Skills** | `wotann skills` | Loadable skill files |
| Behavioral safeguards | **Guards** | — | Hook-based behavior enforcement |
| Persistent knowledge | **Memory** | `wotann memory` | SQLite + FTS5 memory system |
| Cost prediction | **Cost Preview** | `wotann cost` | Predict cost before execution |
| Voice input | **Voice** | `wotann voice` | Push-to-talk voice mode |
| Scheduled tasks | **Schedule** | `wotann schedule` | Recurring/cron tasks |
| Channel messaging | **Channels** | `wotann channels` | Telegram, Discord, iMessage bridges |

### Internal Code Names (Norse-themed — NOT shown to users)
Internal class names can reference Norse mythology for developer experience:
- `WotannRuntime` (composition root), `WotannEngine` (daemon)
- Internal references to Mimir (memory), Huginn/Muninn (thought/memory) are fine in code comments

## Build Order
Follow the mega-plan sprint order:
```
Sprint 0: Fix issues (DONE ✅)
Sprint 1: Foundation (Phase 0 accuracy + Phase 1 wiring + Phase 2 placeholders)
Sprint 2: CLI Polish (Phase 3 features + Phase 4 TUI + Phase 13 refactoring)
Sprint 3: Desktop (Phase 16 Engine + Phase 5 Tauri + Phase 18 Editor)
Sprint 4: iOS (Phase 6 Swift + Phase 12 synergy)
Sprint 5: Parity (Phase 7 + Phase 9 + Phase 17)
Sprint 6: Differentiation (Phase 8 + Phase 11 + Phase 14 + Phase 15)
```

## Architecture Rules
- TypeScript strict mode, no `any` types
- Provider-agnostic: everything in src/core/ must work with ANY provider
- **Maximum Model Power**: harness amplifies, NEVER degrades model capability
- **Automagical by Default**: every feature works without user configuration
- **Universal Capability**: every feature works with every provider (native or emulated)
- Middleware pattern: every cross-cutting concern is a composable layer
- Progressive disclosure: skills load on demand, zero cost until invoked
- Guards are guarantees: every behavioral rule is a guard, not a prompt
- Immutable value types; encapsulated mutable services (return new objects for data; services own their internal state)
- 200-400 lines per file, 800 max

## Directory Structure
```
src/
  core/           — Agent bridge, session, config, types (WotannRuntime)
  providers/      — 11 adapters, router, rate limiter, format translator
  middleware/     — 16-layer pipeline + TTSR
  intelligence/   — 7 native overrides + accuracy boost + context relevance
  orchestration/  — Coordinator, waves, PWR, Ralph, graph DSL, self-healing
  daemon/         — Engine: tick, heartbeat, cron (always-on daemon)
  computer-use/   — 4-layer Desktop Control, perception engine
  memory/         — SQLite + FTS5, 8-layer memory store
  context/        — 5 compaction strategies + TurboQuant context extension
  prompt/         — System prompt engine, conditional rules
  hooks/          — 19 events, 17+ built-in guards, doom loop
  skills/         — 65+ skills, progressive disclosure
  sandbox/        — Risk classification, permission resolution
  channels/       — DM pairing, node registry, channel adapters
  lsp/            — Symbol operations, server management
  voice/          — Push-to-talk, STT/TTS detection
  learning/       — autoDream, correction capture, instincts
  identity/       — Persona system, soul/identity loading
  security/       — Anti-distillation, watermarking
  telemetry/      — Cost tracking, cost preview, audit trail
  marketplace/    — MCP registry, skill marketplace
  ui/             — Ink TUI, themes, keybindings, HUD
  desktop/        — Tauri config, bridge server, app state
  mobile/         — iOS types, handlers, secure auth, haptics
  utils/          — Shadow git, logger, platform, WASM bypass
```
