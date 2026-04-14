# WOTANN — Development Handoff

## Quick Start

```bash
# Terminal 1: Start KAIROS daemon
cd ~/Desktop/agent-harness/wotann
npm run build && npx tsx src/index.ts daemon worker

# Terminal 2: Start desktop app
cd ~/Desktop/agent-harness/wotann/desktop-app
npx tauri dev
```

## Architecture

```
User → Tauri Desktop App → Rust IPC → KAIROS Daemon → Provider
              ↕                              ↕
         React UI                    WotannRuntime (70+ subsystems)
              ↕                              ↕
         Zustand Store              SQLite + FTS5 Memory
```

### Key Data Flows

**Chat Message**: User types → `useStreaming.sendMessage()` → Tauri `send_message_streaming` → Rust `call_streaming("query")` → KAIROS daemon `handleQuery` → smart routing (Codex CLI for cloud / Ollama for local) → streaming chunks → Tauri events → React updates message bubble

**Model Discovery**: KAIROS `providers.list` → probes Ollama `/api/tags` + decodes Codex JWT plan type → returns `ProviderInfo[]` → Rust parses → React ModelPicker renders

**Provider Auth**: Codex OAuth token in `~/.codex/auth.json` → JWT `id_token` contains `chatgpt_plan_type` → maps to available models per tier (free/plus/pro)

## Critical Files

| File | Purpose |
|------|---------|
| `src/daemon/kairos-rpc.ts` | All RPC handlers. `providers.list` (dynamic), `handleQuery` (smart routing) |
| `src/daemon/kairos.ts` | Daemon startup, tick loop, background workers |
| `src/core/runtime.ts` | 70+ subsystem composition root |
| `desktop-app/src/hooks/useStreaming.ts` | Stream event handling, message ID matching |
| `desktop-app/src/store/engine.ts` | Tauri command dispatchers, polling |
| `desktop-app/src/store/index.ts` | Zustand store, model persistence |
| `desktop-app/src/styles/globals.css` | Design system tokens |
| `desktop-app/src-tauri/src/commands.rs` | 81 Tauri IPC commands |
| `desktop-app/src-tauri/src/ipc_client.rs` | Unix socket JSON-RPC client |
| `desktop-app/src-tauri/src/sidecar.rs` | Daemon lifecycle + watchdog |

## Known Gotchas

1. **Tauri drag region**: NEVER put `data-tauri-drag-region` on elements with child buttons — it blocks clicks
2. **Ollama OOM**: Set `OLLAMA_KV_CACHE_TYPE=q8_0` and pass `num_ctx: 8192` for 16GB RAM
3. **Codex scopes**: OAuth token can't access `/v1/models` or `/v1/responses` — must use CLI
4. **Message ID mismatch**: Frontend and Rust generate different IDs — useStreaming finds active streaming message via reverse search
5. **React StrictMode**: Event listeners double-fire — chunk deduplication guard needed
6. **HMR limitation**: Changes to `useEffect` mount callbacks require full app restart
7. **Multiple daemons**: Always `pkill -f "daemon worker"` before restarting — stale processes accumulate
8. **Sidecar uses dist/**: Run `npm run build` before restarting Tauri for daemon changes

## Build Commands

```bash
# TypeScript check
cd desktop-app && npx tsc --noEmit  # Desktop
cd wotann && npx tsc --noEmit       # Core

# Vite build
cd desktop-app && npx vite build

# Core build (for daemon)
cd wotann && npm run build

# Tauri dev (full app)
cd desktop-app && npx tauri dev

# Tests
cd wotann && npx vitest run

# iOS project regeneration
cd ios && xcodegen generate
```

## Environment

- macOS Apple Silicon, 16GB RAM
- Ollama with gemma4:latest (9.6GB Q4_K_M)
- Codex CLI authenticated (ChatGPT Plus)
- Claude CLI installed (not signed in)
- Node.js 25.9.0, Rust (Tauri v2)
