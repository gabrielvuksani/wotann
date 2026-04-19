<!-- PROMOTION_APPROVED: AAIF AGENTS.md standard compliance — user-requested deliverable in audit 2026-04-19 -->
# AGENTS.md — WOTANN

> Compliance with the AGENTS.md standard (adopted by Amp, Codex, Cursor, Devin, Factory, Gemini CLI, Copilot, Jules, VS Code, and 60,000+ OSS projects as of 2026-04-19). This file gives AI coding agents consistent project-specific guidance.
>
> **Spec**: https://agents.md | **Governance**: [Agentic AI Foundation (AAIF)](https://aaif.io) under the Linux Foundation (founding contributions: MCP, Goose, AGENTS.md).

## Project

**Name**: WOTANN — The All-Father of AI Agent Harnesses
**Purpose**: Unified, always-on, multi-provider, full-computer-controlling AI agent harness with Desktop (Tauri) + iOS (SwiftUI) + CLI (Ink) + Watch + CarPlay + 24 channels. Ships Gemma 4 bundled via Ollama for fully-offline operation; supports 19 providers with intelligent capability fallbacks.
**License**: MIT
**Homepage**: https://wotann.com
**Repository**: https://github.com/gabrielvuksani/wotann

## Code Structure

- `src/` — TypeScript core (481 files, 162k LOC). Composition root: `src/core/runtime.ts`.
  - `src/providers/` — 19 adapters + router + capability-augmenter + fallback-chain
  - `src/middleware/` — 16-layer pipeline (use `middleware/pipeline.ts`, not `middleware/layers.ts`)
  - `src/memory/` — 27 modules: SQLite+FTS5 + knowledge graph + dreams + episodes
  - `src/daemon/` — KAIROS always-on engine (tick + heartbeat + cron)
  - `src/channels/` — 25 channel adapters
  - `src/skills/` — 86+ markdown skills with progressive disclosure
  - `src/hooks/` — 19 events × 17 guards. Context injection via `HookResult.contextPrefix`
  - `src/intelligence/` — accuracy-boost + 7 native overrides
  - `src/orchestration/` — coordinator + waves + PWR + Ralph + council + arena
  - `src/computer-use/` — 4-layer (API → A11y → Vision → Text)
  - `src/acp/` — Agent Client Protocol (stdio JSONRPC, hostable from Zed/Kiro/JetBrains)
  - `src/mcp/` — Model Context Protocol (server)
  - `src/lsp/` — Symbol operations as agent tools
  - `src/learning/` — GEPA + MIPROv2 + Darwinian + reflection
  - `src/sandbox/` — Risk classification + permission + unified_exec
- `tests/` — Vitest (309 files, 4857 tests, 0 failures)
- `desktop-app/` — React + Tauri (134 `.tsx`)
  - `desktop-app/src-tauri/` — Rust (17 `.rs`)
- `ios/` — Swift/SwiftUI (128 `.swift`, 83 Views + WOTANNWatch + CarPlay + Widgets + Intents + ShareExt)
- `skills/`, `Formula/`, `scripts/release/`, `python-scripts/camoufox-driver.py`, `docs/` (60+ MDs)

## Quick Commands

```bash
npm install                                  # install deps
npm run typecheck                            # tsc --noEmit (must be clean)
npm run build                                # tsc + chmod +x dist/index.js
npm test                                     # vitest run (309 files / 4857 tests / 0 failures)
npm run dev                                  # tsx src/index.ts (direct run)
npm run lint                                 # eslint
npm run format                               # prettier --write

# Desktop app
cd desktop-app && npm run build              # Vite (~37s)
cd desktop-app/src-tauri && cargo check      # Rust compile check

# iOS (physical device preferred per user directive)
cd ios && xcodebuild -scheme WOTANN -configuration Debug
```

## Conventions

### TypeScript
- **Strict mode**, no `any`
- **Immutable data**: never mutate, return new objects
- **Many small files** (200-400 LOC typical, 800 max)
- **Functional patterns** preferred
- **Provider-agnostic**: everything in `src/core/` must work with ANY provider

### Testing
- **TDD**: RED → GREEN → REFACTOR
- **Never modify tests to make them pass** — fix source instead (exception: if test codifies a bug)
- **Real dependencies preferred** over mocks where feasible
- **Env-gate discipline**: `=== "1"` (not truthy); `NODE_ENV === "test"` as mandatory base

### Security
- **Never hardcode secrets**. Use `process.env.*` with empty-string defaults.
- **Supabase keys**: `sb_publishable_*` / `sb_secret_*` — GitHub default secret-scanning does NOT catch these. Custom patterns required.
- **GH Actions injection prevention**: pass untrusted input via `env:`, not inline `${{ }}`.
- **unified_exec**: `src/sandbox/unified-exec.ts` is NOT a sandbox boundary — wrap with `src/sandbox/executor.ts` + seatbelt for untrusted code.
- **Workflow DSL**: explicit string-pattern matching, no dynamic code execution.

## Provider Architecture

19 providers with **intelligent fallbacks** (OpenClaw pattern). See `src/providers/capability-augmenter.ts` + `capability-equalizer.ts` + `fallback-chain.ts`. Every capability has a fallback for every model tier.

## Multi-Surface Design

Each feature should work on **every** surface unless explicitly gated:
- **TUI (Ink)** — 74 commands, 15 components
- **Desktop GUI (Tauri + React + Monaco)** — 24 lazy-loaded views
- **iOS** — 83 Views + Watch + CarPlay + Intents + Widgets + ShareExt
- **Channels** — 25 adapters

**Physical device testing required for iOS**. Simulator is insufficient.

## Standards Compliance

- **AGENTS.md**: this file.
- **MCP (Model Context Protocol)**: `src/mcp/mcp-server.ts` hosts. Compatible with https://registry.modelcontextprotocol.io.
- **ACP (Agent Client Protocol)**: `src/acp/` — stdio JSONRPC. Hostable from Zed, Kiro, JetBrains.
- **LSP**: `src/lsp/symbol-operations.ts` — `find_symbol` / `find_references` / `rename_symbol` / `hover` / `definition`.

## Quality Bars

1. No vendor-biased `??` fallbacks (single source: `src/providers/model-defaults.ts:PROVIDER_DEFAULTS`)
2. In-memory caps default UNBOUNDED (opt-in via env var)
3. Sonnet, not Haiku, is the Anthropic worker tier (Opus for audits)
4. Never skip tasks; document deferrals with concrete reasons
5. Opus for every `Agent({...})` dispatch that reviews code
6. Honest stubs over silent success (`{ok: false, error: "not yet wired"}`)
7. Per-session state, not module-global (`Map<sessionId, ...>` + FIFO eviction)
8. `HookResult.contextPrefix` is the context-injection channel
9. Tests can codify bugs — if prod fix invalidates test, ask "asserting BUG or DESIRED BEHAVIOR"
10. Env-dependent test gates explicit (`=== "1"` + `NODE_ENV === "test"` mandatory)
11. Sibling-site scan (pattern discovery)
12. Singleton threading (one runtime instance)
13. Commit-message-is-claim verification

## Helpful Context

- **Prior audits**: `docs/MASTER_SYNTHESIS_2026-04-18.md`, `docs/AUDIT_2026-04-19.md`, `docs/MASTER_PLAN_V5.md`
- **Prompt-lies catalogue**: `docs/PROMPT_LIES.md`
- **Source-of-truth registry**: `docs/WOTANN_INVENTORY.md` + `docs/WOTANN_ORPHANS.tsv`
- **Dead code to RESURRECT (not delete)**: `docs/DEAD_CODE_REPURPOSING_2026-04-18.md`
- **Security**: `docs/GIT_ARCHAEOLOGY.md`

## What NOT To Do

- Do NOT commit `dist/`, `.wotann/`, or `wotann-old-git-*`
- Do NOT include `Co-Authored-By: Claude` in commit messages
- Do NOT push directly to main without `npm run typecheck && npm test` green
- Do NOT modify tests to make them pass — fix source (unless test codifies a bug)
- Do NOT delete orphan modules without asking "would wiring make WOTANN more powerful?"
- Do NOT assume simulator testing suffices for iOS
- Do NOT add `any` types
- Do NOT use vendor-biased `??` fallbacks

## When You Hit Blockers

1. Check `docs/*.md` (60+ docs)
2. Search Engram via `mcp__engram__mem_search`
3. Check `~/.claude/rules/` for coding-style + testing + security
4. `AskUserQuestion` only as last resort — cite grep/web attempts first

---

*WOTANN aims to be the most capable, powerful, accurate, feature-rich, beautiful agent harness ever built. Every feature works on every surface via intelligent fallbacks. Zero developer cost. Automagical by default.*
