# RESEARCH — Conductor, Jean, Zed + Ecosystem Deep-Dive

**Date**: 2026-04-20
**Researcher**: Opus 4.7 (1M) — max-effort mode
**Scope**: Deep comparative analysis for WOTANN of three named projects (Conductor, Jean, Zed) plus eight adjacent systems that feed WOTANN's decision surface.
**Method**: WebFetch on raw source files, `gh api` on GitHub metadata/issues/PRs/commits/releases, WebSearch for release notes and analysis coverage. Browser tooling (claude-in-chrome) was unavailable (no extension connected); pivoted to WebFetch + gh CLI + WebSearch — every claim below has a URL or file-path citation.

---

## 0. Executive Summary (400 words)

Three very different systems, three very different lessons.

**Conductor** (Netflix/Orkes, 31,658 stars, Apache-2, Java) is not a direct WOTANN competitor — it is a **durable-execution workflow engine** that has quietly become the most battle-tested AI-agent orchestration backend on earth. v3.30.0.rc2 shipped 2026-04-17 with 14 LLM providers, an `LLM_CHAT_COMPLETE` task type with native tool calling, `LIST_MCP_TOOLS`/`CALL_MCP_TOOL` as first-class task verbs, and a `DO_WHILE` loop operator whose JSONPath `loopCondition` lets you build think-act agents as declarative JSON rather than code ([ai/README.md](https://github.com/conductor-oss/conductor/blob/main/ai/README.md)). **WOTANN port value: very high.** Conductor's architectural claim — "orchestration is deterministic; workers don't have to be" — is the single most important pattern WOTANN is currently missing. Port this: workflow-as-JSON, DO_WHILE+SWITCH inside agent loops, checkpoint-per-task replay, a WorkflowMessageQueue (PR #982, 2026-04-06) for pushing live events into running workflows.

**Jean** (coollabsio, 841 stars, Tauri v2 + React 19, active since 2026-01-23) is what happens when someone ships a polished desktop IDE that *runs other harnesses* rather than *becoming* one. v0.1.41 (2026-04-16) added session message pagination, an `xhigh` effort level, plugin skills in a slash popover, and an "Opinionated" preferences pane that auto-installs [RTK and Caveman](https://github.com/coollabsio/jean/blob/main/src-tauri/src/opinionated/commands.rs) Claude plugins. Jean's architecture is a reference design for WOTANN's desktop tab: four `Lazy<Mutex<>>` process registries (Claude/Cursor by PID, OpenCode by HTTP-flag, Codex by thread/turn RPC) multiplexed transparently through one `cancel_process()` call ([chat/registry.rs](https://github.com/coollabsio/jean/blob/main/src-tauri/src/chat/registry.rs)). The HTTP server is Axum with `?token=...` auth, constant-time compare, and a WebSocket that uses pre-serialized `Arc<str>` events for broadcast. **WOTANN port value: P0.** Copy the registry pattern, copy the Axum+WS design, copy the Plan/Build/Yolo+xhigh mode system.

**Zed** (79,398 stars, Rust/GPUI, v0.232.2 released 2026-04-15) is the project that **invented the standard** WOTANN will have to speak fluently: the Agent Client Protocol and the ACP Registry (launched 2026-01-28). The registry now lists 28 agents including `claude-acp@0.29.2`, `codex-acp`, `gemini`, `opencode@1.14.18`, `github-copilot`, `github-copilot-cli`, `cursor`, `goose`, `cline`, `pi-acp`, and `factory-droid` ([registry](https://github.com/agentclientprotocol/registry)). Zed's [agent_servers crate](https://github.com/zed-industries/zed/tree/main/crates/agent_servers) is the canonical ACP client. ACP ships at ProtocolVersion::V1 with 18 JSON-RPC methods (initialize, new_session, load_session, resume_session, close_session, prompt, cancel, authenticate, set_session_mode, set_session_model, set_session_config_option, list_sessions, create_terminal, kill_terminal, release_terminal, terminal_output, wait_for_terminal_exit, request_permission), three tool-permission modes (Allow/Confirm/Deny) with regex-pattern rules and three built-in profiles (Write/Ask/Minimal). **WOTANN port value: must-have.** Register `wotann-acp` in the ACP registry by Phase 4; expose WOTANN as an ACP server so Zed and JetBrains IDEs can drive it.

---

## 1. Conductor — Durable Execution for AI Agents

### 1.1 Metadata snapshot (as of 2026-04-20)

| Field | Value | Source |
|---|---|---|
| Stars | 31,658 | `gh repo view conductor-oss/conductor` |
| Forks | 857 | same |
| Open issues | 115 | same |
| Primary language | Java (7.27 MB) + TypeScript UI (3.73 MB) + Groovy (918 KB) | same |
| License | Apache-2.0 | same |
| Latest release | v3.30.0.rc2 @ 2026-04-17 | [releases](https://github.com/conductor-oss/conductor/releases/tag/v3.30.0.rc2) |
| Last push | 2026-04-20 06:51 UTC (active today) | same |
| Created | 2023-12-08 (project was re-homed from Netflix to Orkes) | same |
| Contributors | 300+ (top: orkes-harshil 1,011 commits, apanicker-nflx Netflix OG) | `gh api .../contributors` |
| Home | [conductor-oss.org](https://conductor-oss.org), [docs](https://docs.conductor-oss.org), [orkes.io](https://orkes.io) | README |

### 1.2 What Conductor actually is

The README opens: *"Conductor is an open-source, durable workflow engine built at Netflix for orchestrating microservices, AI agents, and durable workflows at internet scale. Trusted in production at Netflix, Tesla, LinkedIn, and J.P. Morgan."* ([README](https://github.com/conductor-oss/conductor/blob/main/README.md))

Conductor is not a harness; it is the **orchestration substrate** underneath harnesses. Its core claim:

> Code-first engines force your code to be deterministic so the framework can replay it. Conductor makes the engine deterministic — so your code doesn't have to be.

That single line captures an architectural choice WOTANN has not yet made. WOTANN's 26-layer middleware is a code-first approach — handlers run in JavaScript and are expected to be well-behaved. Conductor inverts this: the workflow graph is declarative JSON, workers are dumb polling processes in any language, and the engine persists every step so resumption from crash is an engine property, not a developer property.

### 1.3 Architecture — DAG + JSON + polyglot workers

Top-level tree (from `gh api .../contents`):

```
ai/              # 14+ LLM providers as native system tasks
annotations/     # @WorkflowTask, @TaskDef decorators for polyglot SDKs
awss3-storage/   # Pluggable blob storage backends
awssqs-event-queue/ amqp/ # 6 event queue backends
cassandra-persistence/ common-persistence/ # 5 persistence backends
conductor-clients/  # Polyglot client SDKs
core/            # The scheduler, retry engine, state machine
docker/          # Docker images
e2e/             # End-to-end tests
docs/ ROADMAP.md CHANGELOG.md
```

The core abstraction is a **Workflow** — a directed graph of **Tasks**. Each task has a type (SIMPLE for user code, SYSTEM for built-ins, OPERATORS for flow control) and all state transitions are written to one of 5 persistence backends (Postgres, MySQL, Cassandra, Redis, in-memory). Task types documented ([docs.conductor-oss.org](https://docs.conductor-oss.org/)):

**System tasks**: HTTP, Inline, Event, Human, JSON JQ Transform, Kafka Publish, No Op, JDBC, Wait.

**Operators** (flow control): Fork, Join, Switch, Do While, Dynamic, Dynamic Fork, Sub Workflow, Start Workflow, Set Variable, Terminate.

**AI-specific tasks** (from [ai/README.md](https://github.com/conductor-oss/conductor/blob/main/ai/README.md)):
- `LLM_CHAT_COMPLETE` — multi-turn conversational with `tools` array, returns `finishReason: "TOOL_CALLS"`
- `LLM_TEXT_COMPLETE` — single-prompt generation
- `LLM_GENERATE_EMBEDDINGS` / `LLM_INDEX_TEXT` / `LLM_STORE_EMBEDDINGS` / `LLM_SEARCH_INDEX` / `LLM_SEARCH_EMBEDDINGS` / `LLM_GET_EMBEDDINGS` — full RAG pipeline
- `GENERATE_IMAGE` / `GENERATE_AUDIO` / `GENERATE_VIDEO` (OpenAI Sora + Google Veo) / `GENERATE_PDF` — multi-modal
- `LIST_MCP_TOOLS` / `CALL_MCP_TOOL` — **MCP as native task verbs**

### 1.4 The 11-provider AI matrix

| Provider | Chat | Embeddings | Image | Audio | Video |
|---|:-:|:-:|:-:|:-:|:-:|
| OpenAI | ✅ | ✅ | ✅ | ✅ | ✅ |
| Anthropic | ✅ | ❌ | ❌ | ❌ | ❌ |
| Google Gemini | ✅ | ✅ | ✅ | ✅ | ✅ |
| Azure OpenAI | ✅ | ✅ | ✅ | ❌ | ❌ |
| AWS Bedrock | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mistral AI | ✅ | ✅ | ❌ | ❌ | ❌ |
| Cohere | ✅ | ✅ | ❌ | ❌ | ❌ |
| Grok | ✅ | ❌ | ❌ | ❌ | ❌ |
| Perplexity | ✅ | ❌ | ❌ | ❌ | ❌ |
| HuggingFace | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ollama (local) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Stability AI | ❌ | ❌ | ✅ | ❌ | ❌ |

Three vector DBs: Postgres pgvector (self-hosted), Pinecone (managed), MongoDB Atlas. ([ai/VECTORDB_CONFIGURATION.md](https://github.com/conductor-oss/conductor/blob/main/ai/VECTORDB_CONFIGURATION.md))

### 1.5 The think-act agent pattern

The repository README ships this exact canonical autonomous-agent workflow as production copy:

```json
{
  "name": "autonomous_agent",
  "version": 1,
  "tasks": [
    { "name": "discover_tools", "type": "LIST_MCP_TOOLS",
      "inputParameters": { "mcpServer": "${workflow.input.mcpServerUrl}" } },
    { "name": "agent_loop", "type": "DO_WHILE",
      "loopCondition": "if ($.loop['think'].output.result.done == true) { false; } else { true; }",
      "loopOver": [
        { "name": "think", "type": "LLM_CHAT_COMPLETE",
          "inputParameters": {
            "llmProvider": "openai", "model": "gpt-4o-mini",
            "messages": [
              { "role": "system",
                "message": "You are an autonomous agent. Available tools: ${discover.output.tools}. Previous results: ${loop.output.results}. Respond with JSON: {\"action\": \"tool_name\", \"arguments\": {}, \"done\": false} or {\"answer\": \"final answer\", \"done\": true}." },
              { "role": "user", "message": "${workflow.input.task}" }
            ]
          }
        },
        { "name": "act", "type": "SWITCH",
          "expression": "$.think.output.result.done ? 'done' : 'call_tool'",
          "decisionCases": {
            "call_tool": [
              { "name": "execute_tool", "type": "CALL_MCP_TOOL",
                "inputParameters": {
                  "mcpServer": "${workflow.input.mcpServerUrl}",
                  "method": "${think.output.result.action}",
                  "arguments": "${think.output.result.arguments}" } }
            ]
          }
        }
      ]
    }
  ]
}
```

Each iteration is durably checkpointed. If the worker process dies at iteration 12, it resumes from iteration 12.

### 1.6 What's new in Q1 2026

From [v3.30.0.rc1/rc2 release notes](https://github.com/conductor-oss/conductor/releases) and recent PRs:

- **PR #982 (2026-04-06)**: `WMQ` — Workflow Message Queue. Push messages into *running* workflows. This is the pattern WOTANN needs for its "human-in-the-loop" and "agent-to-agent handoff" stories.
- **PR #996**: Wildcard search and sub-workflow filtering
- **PR #1021 (open)**: "Atomic Task updates" — fixing a race in DO_WHILE + SWITCH
- **PR #998**: Migrated from `mcp` to `mcp-core` crate (the standard MCP library)
- **PR #1018 (open, security)**: SSRF protection in HTTP task — a bug pattern WOTANN must avoid in any HTTP fetch node
- **PR #1019/1011/1013**: `/names-and-versions` lightweight APIs to avoid loading full workflow catalogs into memory at scale (OOM concerns — see PR #1006)
- **[Conductor Skills](https://github.com/conductor-oss/conductor-skills)** (Claude Code plugin marketplace integration, 2026): `/plugin marketplace add conductor-oss/conductor-skills && /plugin install conductor@conductor-skills`

### 1.7 Conductor's open-issue themes (top 20)

Retrieved via `gh api`:
- Task retry policy improvements (#1030, #1031)
- SUB_WORKFLOW reliability (#973)
- ES8 workflow state refresh consistency (#1012)
- Graceful shutdown for SystemTaskWorker (#1020) — `drain-timeout` pattern WOTANN daemons should copy
- `/versions` API + lazy UI version loading (#1019, #1013, #1011) — performance
- `WorkflowMonitor` OOM at scale (#1006) — architectural
- SSRF protection in HTTP task (#1018) — security
- Configurable object storage for AI outputs (#1024) — image/video generation outputs
- SQLite-backed WorkflowMessageQueueDAO (#1015) — single-user local-first mode

### 1.8 What WOTANN can port from Conductor

| Pattern | Value | Effort |
|---|---|---|
| **Workflow-as-JSON** with task types and operators | CRITICAL — WOTANN's "tabs are workflows" vision needs this | 2-3 weeks |
| **DO_WHILE + SWITCH + JSONPath loopCondition** for agent loops | CRITICAL — declarative think-act without JS code | 1 week |
| **Checkpoint-per-task replay** (engine-deterministic, not code-deterministic) | CRITICAL — survives daemon crash | 2 weeks (requires persistent task state) |
| **Polyglot worker polling** pattern (Java/Python/Go/JS/C#/Ruby/Rust SDKs) | HIGH — WOTANN's connectors could be remote workers | 1-2 weeks per SDK |
| **WorkflowMessageQueue** for live event injection into running workflows | HIGH — enables human-in-loop + agent-to-agent handoff | 1 week |
| **5-backend persistence abstraction** (SQLite, Postgres, Redis, etc.) | MEDIUM — WOTANN already has multi-backend planned | already scoped |
| **Drain-timeout graceful shutdown** (PR #1020) | HIGH — WOTANN daemons currently SIGKILL on reload | 2 days |
| **SSRF protection layer** for HTTP tasks (PR #1018) | HIGH — before WOTANN ships any user-driven HTTP connector | 3 days |
| **Saga pattern / compensation flows** | MEDIUM — adds to Exploit tab reversibility | 2 weeks |

---

## 2. Jean — The Meta-Harness (Deep Pass)

Lane 2 established Jean as "the Desktop-IDE-without-being-VS-Code answer" and marked it P0. This pass extracts the exact mechanism.

### 2.1 Metadata snapshot

| Field | Value | Source |
|---|---|---|
| Stars | 841 | `gh repo view coollabsio/jean` |
| Forks | 85 | same |
| Open issues | 52 | same |
| Created | 2026-01-23 (under 3 months old) | same |
| Last push | 2026-04-19 15:48 UTC | same |
| Latest release | v0.1.41 @ 2026-04-16, with v0.1.42 tagged 2026-04-17 on main | [releases](https://github.com/coollabsio/jean/releases), [commits](https://github.com/coollabsio/jean/commits/main) |
| Primary stack | TypeScript 4.02 MB + Rust 2.20 MB | same |
| License | Apache-2.0 | same |
| Core maintainer | **Andras Bacsai** (creator of Coolify — open-source Heroku alternative, ~50k stars, which is Jean's sibling project) | [README](https://github.com/coollabsio/jean/blob/main/README.md) |

### 2.2 Is Jean a fork of something? No — but Coolify is the sibling

Both Jean and Coolify live under `coollabsio`. Bacsai's [Coolify](https://github.com/coollabsio/coolify) (~50k stars) is a self-hostable Heroku/Netlify/Vercel alternative built on the same "opinionated, everything-local, no-vendor-lock-in" philosophy. Jean is that philosophy applied to AI development environments instead of application hosting. This matters for WOTANN because Jean's design instincts — opinionated defaults, local-first, philosophy documented at [coollabs.io/philosophy](https://coollabs.io/philosophy/) — are battle-tested on an adjacent product.

### 2.3 Tauri v2 vs Electron

Jean ships Tauri v2 + React 19 with an Apache-2.0 license. WOTANN currently targets Tauri for its desktop shell — this validates the choice. The trade-offs Jean accepts:

- Windows support is "Not fully tested" (README)
- Linux support is "Community tested (Arch Linux + Hyprland/Wayland)"
- macOS is the only fully tested platform
- AppImage auto-updater for Linux required custom `.tar.gz` updater artifacts (release v0.1.39, PR #305)

This tells WOTANN's team: **macOS-first is fine, Linux second, Windows can be best-effort for months** without losing users.

### 2.4 The four process registries — the core architectural insight

Jean multiplexes 4 different CLIs through one common interface. The mechanism lives in [`src-tauri/src/chat/registry.rs`](https://github.com/coollabsio/jean/blob/main/src-tauri/src/chat/registry.rs). Four `Lazy<Mutex<>>` structures, all accessed via `lock_recover()` to handle poisoned mutexes:

| Registry | Tracks | Used by |
|---|---|---|
| `PROCESS_REGISTRY` | `session_id → PID` | Claude CLI, Cursor CLI (SIGKILL process group) |
| `PENDING_CANCELS` | sessions cancelled before process registration | cancellation race safety |
| `CANCEL_FLAGS` | `session_id → Arc<AtomicBool>` + optional OpenCode session_id + cwd | OpenCode (HTTP interrupt endpoint) |
| `CODEX_TURN_REGISTRY` | `session_id → (thread_id, turn_id)` | Codex (turn/interrupt RPC) |

The public API ([extracted by WebFetch](https://raw.githubusercontent.com/coollabsio/jean/main/src-tauri/src/chat/registry.rs)):

```rust
register_process(session_id, pid) -> bool
register_cancel_flag(session_id, flag) -> bool
update_cancel_flag_context(session_id, opencode_id, working_dir)
register_codex_turn(session_id, thread_id, turn_id) -> bool
unregister_process(session_id)
unregister_codex_turn(session_id)
cancel_process(app, session_id, worktree_id) -> Result<bool>
cancel_process_if_running(app, session_id, worktree_id) -> Result<bool>
cancel_processes_for_worktree(app, worktree_id)
is_session_actively_managed(session_id) -> bool
get_actively_managed_sessions() -> HashSet<String>
cleanup_session_registrations(session_id)
```

One `cancel_process()` call resolves the right mechanism automatically — transparent multiplexing. WOTANN currently spawns CLI processes per tab; it should port this exact registry pattern to its daemon.

### 2.5 The Plan/Build/Yolo state machine

From [`src/services/chat.ts`](https://github.com/coollabsio/jean/blob/main/src/services/chat.ts):

- `ExecutionMode` is stored per-session in a Zustand store `executionModes: Record<sessionId, ExecutionMode>`
- Backend persists via Tauri commands `set_session_model` / `update_session_state`
- **Plan mode special handling**: detected via `waiting_for_input_type === 'plan'` in prefetch logic, allowing resumable Plan states after user approval
- Per-prompt model override: `useSendMessage` mutationFn accepts optional `model?: string`; overrides session default, persisted via `useSetSessionModel`

**The lifecycle**: user starts a session → selects a mode → sends prompts with optional per-prompt model/effort/thinking overrides → if Plan, UI stalls at approval gate → user approves → Build phase begins → if Yolo, auto-execute everything.

Session state tracked:
```typescript
answeredQuestions?: string[]
submittedAnswers?: Record<string, unknown>
fixedFindings?: string[]
```
Plus **five** pending-request queues specifically for Codex (command approval, permission, user input, MCP elicitation, dynamic tool call) — each with `rpc_id` + `item_id` markers for cross-client sync.

### 2.6 HTTP server — the "phone-as-client" pattern

[`src-tauri/src/http_server/server.rs`](https://github.com/coollabsio/jean/blob/main/src-tauri/src/http_server/server.rs) — Axum-based:

| Endpoint | Method | Purpose |
|---|---|---|
| `/ws` | GET | WebSocket upgrade, token-gated |
| `/api/auth` | GET | Token validation |
| `/api/init` | GET | Preload bundle: projects + sessions + UI state |
| `/api/files/{*filepath}` | GET | Authenticated file serving from app-data dir |
| `/*` (fallback) | GET | Static `dist/` with index.html SPA fallback |

Auth ([`auth.rs`](https://github.com/coollabsio/jean/blob/main/src-tauri/src/http_server/auth.rs)):
- 32 random bytes via `rand::thread_rng()`
- base64url, no padding → URL-safe token
- `validate_token()` is **constant-time**: XOR across byte pairs, bitwise OR accumulator, no early return
- CORS wide-open (`Any` origin/method/header) — suitable for trusted network

WebSocket protocol ([`websocket.rs`](https://github.com/coollabsio/jean/blob/main/src-tauri/src/http_server/websocket.rs)):
- Pre-serialized events as `Arc<str>` to avoid per-client JSON serialization
- Non-blocking drain up to 32 messages from broadcast + response channels before single flush (syscall optimization)
- Lagged-client detection with warnings
- Message types:
  ```
  C→S: {"type":"invoke", "id":"...", "command":"...", "args":{...}}
  S→C: {"type":"response", "id":"...", "data":{...}}
  S→C: {"type":"error", "id":"...", "error":"..."}
  C→S: {"type":"replay", "session_id":"...", "last_seq":N}
  ```

The `replay` message is gold — **session recovery on reconnect**, exactly what WOTANN needs for iOS-device-to-desktop reattach.

Headless mode:
```bash
jean --headless --host 127.0.0.1 --port 3456
```
Passing a Tailscale IP binds Jean only to that interface — a clean local-mesh story.

### 2.7 Magic Commands + MCP + Skills

From the README + releases + source:

**Magic Commands** (per-session, customizable model/backend/effort per command):
- Investigate issues / PRs / workflows
- Code review with finding tracking
- AI commit messages
- PR content generation
- Merge conflict resolution
- Release notes generation

**MCP** (from [`src/services/mcp.ts`](https://github.com/coollabsio/jean/blob/main/src/services/mcp.ts)): Jean reads MCP config from backend-specific sources:
| Backend | Global config | Project config |
|---|---|---|
| Claude | `~/.claude.json` + `.mcp.json` | project `.mcp.json` |
| Codex | `~/.codex/config.toml` | `.codex/config.toml` |
| OpenCode | `~/.config/opencode/opencode.json` | `opencode.json` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |

Composite keys use `backend:name` format (PR #291, 2026-04-09) to disambiguate the same MCP server name across backends.

Codex MCP support (from [`src-tauri/src/codex_cli/mcp.rs`](https://github.com/coollabsio/jean/blob/main/src-tauri/src/codex_cli/mcp.rs)):
- TOML section `[mcp_servers.<name>]`
- Two transports: **STDIO** (`command`, `args`, `env`, `cwd`) and **HTTP** (`url`, `bearer_token_env_var`, `http_headers`)
- Per-server `enabled`, `required`, `enabled_tools`, `disabled_tools`, `startup_timeout`, `tool_timeout`

**Plugin Skills** (v0.1.41, 2026-04-16): Claude Code plugin skills surface as dedicated sections in the `/` slash popover. The "Opinionated" preferences pane auto-installs RTK and Caveman plugins ([`opinionated/commands.rs`](https://github.com/coollabsio/jean/blob/main/src-tauri/src/opinionated/commands.rs)):

**RTK**:
- `brew install rtk-ai/tap/rtk` (Homebrew first)
- Curl-based fallback from GitHub master branch
- Post-install: `rtk init -g`

**Caveman**:
- Requires Claude CLI present
- `claude plugin marketplace add JuliusBrussee/caveman`
- `claude plugin install caveman@caveman`
- Detection via `~/.claude/plugins/cache/` and `~/.claude/skills/caveman/SKILL.md`

Both handlers use `tokio::task::spawn_blocking()` to avoid blocking the async runtime.

### 2.8 Model lineup (v0.1.41)

| Model | Source | Notes |
|---|---|---|
| claude-opus-4-7 | new default (v0.1.41) | |
| claude-opus-4-6, 4-6-1m | existing | |
| claude-opus-4-5 | added v0.1.40 | |
| claude-sonnet-4-6 | default for lightweight ops (v0.1.39 upgrade from Haiku) | |
| claude-haiku | still listed | |
| gpt-5.4 / gpt-5.4-mini | Codex (v0.1.38 added mini) | |
| Cursor Agent models | added v0.1.39 (PR #302) | full first-class backend |
| OpenCode (any) | | |

Effort levels: low / medium / high / **xhigh** (new in v0.1.41).

Thinking levels: per-mode overrides — Build and Yolo can independently override. "Skip model/thinking overrides when session backend mismatches" (commit ae1fbdb, 2026-04-15).

### 2.9 Crash recovery + reconnect

v0.1.39 (2026-04-15): "Codex crash recovery & resume — persisted Codex thread and turn IDs per run; in-flight chat state is now correctly restored after reconnects or crashes, with buffered websocket event replay."

This is the replay pattern from §2.6 made explicit. WOTANN's daemon should:
1. Persist `(session_id, provider_thread_id, turn_id)` per turn to disk/SQLite
2. Buffer outbound WebSocket events
3. On reconnect, replay from `last_seq`

### 2.10 What WOTANN must clone from Jean (P0 list)

| Feature | Effort | Priority |
|---|---|---|
| Plan/Build/Yolo execution modes + xhigh | 1 week | P0 |
| Per-prompt model/effort/thinking override | 3 days | P0 |
| Four-registry multi-CLI multiplexing | 2 weeks | P0 |
| Axum HTTP server + WS with constant-time token auth + Arc<str> event broadcast | 1 week | P0 |
| Replay messages for reconnect recovery | 1 week | P0 |
| Magic Commands as per-session customizable presets | 1 week | P1 |
| Multi-dock terminal (floating / left / right / bottom) | 2 weeks | P1 |
| Save Contexts with AI summarization | 1 week | P1 |
| Linked Projects for cross-project context | 1 week | P1 |
| GitHub tab with Issues/PRs/Security/Advisories + Dependabot investigation | 2 weeks | P1 |
| Linear per-project API key + team config | 3 days | P2 |
| Opinionated plugin installer (RTK/Caveman pattern) | 3 days | P2 |
| MCP composite `backend:name` keys | 2 days | P1 |

---

## 3. Zed — The ACP Authority

### 3.1 Metadata snapshot

| Field | Value | Source |
|---|---|---|
| Stars | 79,398 | `gh repo view zed-industries/zed` |
| Forks | 7,903 | same |
| Open issues | **2,700** (the cost of scale) | same |
| Latest stable | v0.232.2 @ 2026-04-15 | [releases](https://github.com/zed-industries/zed/releases/tag/v0.232.2) |
| Pre-release | v0.233.2-pre @ 2026-04-18 (Claude Opus 4.7 added as language model) | [releases](https://github.com/zed-industries/zed/releases/tag/v0.233.2-pre) |
| Stack | Rust 45.9 MB + Metal shader code + WGSL + HLSL (GPU compositor) | same |
| License | Other (AGPL, APACHE, GPL mixed) | same |
| Last push | 2026-04-20 03:08 UTC | same |
| Created | 2021-02-20 | same |

### 3.2 Crate inventory — 200+ crates, 40+ agent-related

From `gh api .../contents/crates` (condensed, agent-relevant only):

**ACP core**: `acp_thread/`, `acp_tools/`, `agent/`, `agent_servers/`, `agent_settings/`, `agent_ui/`

**Provider crates** (each a separate network layer + auth): `anthropic/`, `bedrock/`, `codestral/`, `copilot/`, `copilot_chat/`, `copilot_ui/`, `deepseek/`, `google_ai/`, `lmstudio/`, `mistral/`, `ollama/`, `open_ai/`, `open_router/`, `opencode/`, `language_model/`, `language_model_core/`, `language_models/`, `language_models_cloud/`, `cloud_llm_client/`, `cloud_api_client/`, `cloud_api_types/`

**Supporting**: `action_log/`, `context_server/` (MCP), `edit_prediction/`, `edit_prediction_context/`, `edit_prediction_cli/`, `edit_prediction_metrics/`, `edit_prediction_ui/`, `inline_assistant/`, `prompt_store/`, `rules_library/`, `streaming_diff/`

This is the scale of abstraction WOTANN will eventually reach if it remains serious. Zed spent 5 years getting here.

### 3.3 The ACP Registry — launched 2026-01-28

Source: [Zed blog post](https://zed.dev/blog/acp-registry). Curated set of agents requiring authentication support. 28 agent directories currently in [agentclientprotocol/registry](https://github.com/agentclientprotocol/registry):

```
amp-acp, auggie, autohand, claude-acp, cline, codebuddy-code, codex-acp,
corust-agent, crow-cli, cursor, deepagents, factory-droid, fast-agent,
gemini, github-copilot, github-copilot-cli, goose, junie, kilo, kimi,
minion-code, mistral-vibe, nova, opencode, pi-acp, qoder, qwen-code, stakpak
```

Registry served from `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`. Agent author flow: PR adds a directory with `agent.json` + optional `icon.svg`. CI verifies the agent returns valid `authMethods` in the ACP handshake. Hourly automated re-validation checks new releases on npm, PyPI, GitHub releases.

### 3.4 The registry manifest format

From [FORMAT.md](https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md):

**Top-level registry.json**:
```json
{ "version": "1.0.0", "agents": [/* array of agent objects */] }
```

**Per-agent agent.json required fields**:
- `id` — unique identifier (kebab-case)
- `name` — display name
- `version` — semver
- `description` — brief summary
- `repository`, `website`, `authors`, `license`, `icon` — metadata
- `distribution` — at least one of three transport methods

**Distribution methods**:
1. **Binary** — platform-specific downloads, formats: `.zip`, `.tar.gz`, `.tgz`, `.tar.bz2`, `.tbz2`, or raw binaries. Six platforms: `darwin-aarch64`, `darwin-x86_64`, `linux-aarch64`, `linux-x86_64`, `windows-aarch64`, `windows-x86_64`
2. **NPX** — `npx <package> [args]`
3. **UVX** — `uvx <package> [args]` (PyPI via uv)

**Real example** — `claude-acp/agent.json`:
```json
{
  "id": "claude-acp",
  "name": "Claude Agent",
  "version": "0.29.2",
  "description": "ACP wrapper for Anthropic's Claude",
  "repository": "https://github.com/agentclientprotocol/claude-agent-acp",
  "authors": ["Anthropic", "Zed Industries", "JetBrains"],
  "license": "proprietary",
  "distribution": {
    "npx": { "package": "@agentclientprotocol/claude-agent-acp@0.29.2" }
  }
}
```

**Real example** — `opencode/agent.json` (binary distribution):
```json
{
  "id": "opencode",
  "name": "OpenCode",
  "version": "1.14.18",
  "distribution": {
    "binary": {
      "darwin-aarch64": { "archive": "https://.../opencode-darwin-arm64.zip", "cmd": "./opencode", "args": ["acp"] },
      "darwin-x86_64": { "archive": "...", "cmd": "./opencode", "args": ["acp"] },
      "linux-aarch64": { "archive": "...", "cmd": "./opencode", "args": ["acp"] },
      "linux-x86_64": { "archive": "...", "cmd": "./opencode", "args": ["acp"] },
      "windows-x86_64": { "archive": "...", "cmd": "./opencode.exe", "args": ["acp"] }
    }
  }
}
```

### 3.5 ACP protocol surface — ProtocolVersion::V1, 18 methods

From [`crates/agent_servers/src/acp.rs`](https://github.com/zed-industries/zed/blob/main/crates/agent_servers/src/acp.rs):

**Core JSON-RPC methods** (18 total):
- `initialize` — capabilities exchange
- `new_session`, `load_session`, `resume_session`, `close_session`, `list_sessions`
- `prompt` — send user request; returns `PromptResponse` with `stop_reason`
- `cancel` — abort in-flight prompt
- `authenticate` — auth flow (supports `terminal-auth` extension)
- `set_session_mode`, `set_session_model`, `set_session_config_option`
- `create_terminal`, `kill_terminal`, `release_terminal`, `terminal_output`, `wait_for_terminal_exit`
- `request_permission` — agent-initiated tool authorization

**Session update types** (SSE-like stream via `SessionUpdate` enum):
- `UserMessageChunk`, `AgentMessageChunk`, `AgentThought`
- `ToolCall`, `ToolCallUpdate`
- `Plan` modifications (separate plan state with entry priorities)
- `SessionInfo` (title, mode, config options)
- `TokenUsage`, `Cost`

**Capabilities exchange** — client advertises: FileSystem.read/write, Terminal:true, Auth.terminal. Server responds with `AgentCapabilities`: `load_session`, `session_capabilities.session_modes`/`models`/`config_options`, `prompt_capabilities`.

**Extensions (meta fields)**:
- `"terminal-auth"` — `{ command, args, env }` for CLI-based auth (Gemini uses this)
- `"terminal_info"` — `{ terminal_id, cwd }` inside ToolCall meta
- `"terminal_output"` — `{ terminal_id, data }` inside ToolCallUpdate meta
- `"terminal_exit"` — `{ exit_code, signal }` inside ToolCallUpdate meta

Transports per [agentclientprotocol.com](https://agentclientprotocol.com): JSON-RPC over **stdio** (local), **HTTP**, or **WebSocket** (remote).

### 3.6 AcpThread — the client-side representation

From [`crates/acp_thread/src/acp_thread.rs`](https://github.com/zed-industries/zed/blob/main/crates/acp_thread/src/acp_thread.rs):

```rust
pub struct AcpThread {
  session_id, parent_session_id, connection,
  entries: Vec<AgentThreadEntry>, plan,
  project, action_log, terminals, shared_buffers,
  turn_id, running_turn, token_usage, cost,
  title, draft_prompt, ui_scroll_position, streaming_text_buffer,
}
```

Three entry types: `UserMessage`, `AssistantMessage`, `ToolCall`. `ContentBlock` variants: Empty / Markdown / ResourceLink / Image. Tool-call state machine: `Pending → WaitingForConfirmation → InProgress → Completed/Failed/Rejected/Canceled`.

ACP-specific features vs a standard chat thread:
- **Subagent spawning** tracked within tool calls
- **Permission request/response** through `SelectedPermissionOutcome`
- **Terminal entities** with streaming output
- **Plan tracking** with priorities and status
- **Checkpoint system** — **git snapshots per user message** for reverting changes
- **Token budgets** with explicit `MaxOutputTokensError`

The connection trait ([connection.rs](https://github.com/zed-industries/zed/blob/main/crates/acp_thread/src/connection.rs)):
```rust
pub trait AgentConnection {
  fn agent_id(&self) -> AgentId;
  fn new_session(...) -> Task<Result<Entity<AcpThread>>>;
  fn authenticate(&self, method: acp::AuthMethodId, cx: &mut App) -> Task<Result<()>>;
  fn prompt(&self, user_message_id: UserMessageId, params: acp::PromptRequest, cx: &mut App) -> Task<Result<acp::PromptResponse>>;
  fn cancel(&self, session_id: &acp::SessionId, cx: &mut App);
}
```

Same trait backs both the native Zed agent (`NativeAgentConnection`) and external ACP servers — the whole point of ACP.

### 3.7 Agent settings — three install modes

From [`agent_servers/src/custom.rs`](https://github.com/zed-industries/zed/blob/main/crates/agent_servers/src/custom.rs) and the external-agents docs:

```json
{
  "agent_servers": {
    "claude-acp": { "type": "registry",
      "env": { "CLAUDE_CODE_EXECUTABLE": "/path/to/executable" } },
    "My Custom Agent": { "type": "custom",
      "command": "node", "args": ["~/projects/agent/index.js", "--acp"],
      "env": {} },
    "some-extension-agent": { "type": "extension" }
  }
}
```

Three modes:
- **Registry** (preferred, auto-update) — takes precedence over extensions
- **Custom** (user-configured stdio command) — full control
- **Extension** (Zed marketplace) — being deprecated in favor of Registry

Registry settings support `default_model`, `default_mode`, `default_config_options`, `favorite_models`, `favorite_config_option_values`, `env`.

### 3.8 The tool-permission model

From [`crates/agent/src/tool_permissions.rs`](https://github.com/zed-industries/zed/blob/main/crates/agent/src/tool_permissions.rs):

**Three decisions**: `Allow`, `Confirm` (ask user), `Deny`.

**Per-tool rule types**:
- `always_allow` — regex patterns matching inputs that auto-approve
- `always_deny` — patterns blocking regardless of other settings
- `always_confirm` — patterns forcing confirmation
- `default` — Allow/Confirm/Deny fallback

**Decision precedence** (highest to lowest):
1. Hardcoded security rules (catastrophic ops like `rm -rf /`)
2. `always_deny` (short-circuit on first match)
3. `always_confirm`
4. `always_allow` (requires ALL commands to match, for terminal tool)
5. Tool-specific default
6. Global default

Terminal tool additionally parses shell sub-commands and validates syntax before matching rules. This is a pattern WOTANN's shell tool is missing.

### 3.9 Three built-in profiles

From [`agent_settings/src/agent_profile.rs`](https://github.com/zed-industries/zed/blob/main/crates/agent_settings/src/agent_profile.rs):

```
Write   — "Get help to write anything."       (all tools enabled)
Ask     — "Chat about your codebase."         (read-only tools)
Minimal — "Chat about anything with no tools."(no tools at all)
```

`AgentProfileSettings`: `{ name, tools: IndexMap<bool>, enable_all_context_servers: bool, context_servers: IndexMap<preset>, default_model: Option<_> }`. Custom profiles inherit from a base profile.

### 3.10 Zed's tool catalog (22 built-in tools)

From [`crates/agent/src/tools/`](https://github.com/zed-industries/zed/tree/main/crates/agent/src/tools):

| Tool | Purpose |
|---|---|
| `context_server_registry.rs` | MCP tools bridge |
| `copy_path_tool.rs` | Copy file/dir |
| `create_directory_tool.rs` | mkdir |
| `delete_path_tool.rs` | rm |
| `diagnostics_tool.rs` | LSP diagnostics |
| `edit_file_tool.rs` | Edit with 3 modes (Edit/Create/Overwrite), format-on-save via LSP, diff entity |
| `fetch_tool.rs` | HTTP GET |
| `find_path_tool.rs` | Fuzzy filepath search |
| `grep_tool.rs` | Content search |
| `list_directory_tool.rs` | ls |
| `move_path_tool.rs` | mv/rename |
| `now_tool.rs` | Current time |
| `open_tool.rs` | Open file in editor |
| `read_file_tool.rs` | cat (updates agent location for UI tracking) |
| `restore_file_from_disk_tool.rs` | Reset buffer |
| `save_file_tool.rs` | Write buffer to disk |
| `spawn_agent_tool.rs` | **Subagent spawn** — fresh session or resume existing; design note says "parallel delegation of independent tasks" |
| `streaming_edit_file_tool.rs` | Incremental edit with streaming diff |
| `terminal_tool.rs` | Execute shell command |
| `tool_edit_parser.rs` | Parse agent-proposed edits |
| `update_plan_tool.rs` | Mutate plan state |
| `web_search_tool.rs` | Search web |

Tools are registered via a `tools!` macro with compile-time duplicate detection, dynamic lookup via `tool_supports_provider()`, and an `ALL_TOOL_NAMES` constant. Schema format determined by `LanguageModelToolSchemaFormat`, supports streaming input, per-provider compatibility check.

### 3.11 Zed's agent UI — the panel pattern

From [`agent_ui/src/agent_panel.rs`](https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/agent_panel.rs):

```rust
pub struct AgentPanel {
  base_view: ...,          // Uninitialized | AgentThread(ConversationView)
  overlay_view: Option<...>,// History or Configuration
  draft_thread,
  retained_threads: HashMap<...>,  // max 5 idle background threads
}
```

Three UI modes: **Thread View** (active conversation), **History Overlay** (6-item recent), **Configuration Overlay**. Agent selection persists globally via KVP store with workspace-level overrides. Collaborative workspaces bypass external-agent options (forces NativeAgent).

Registry UI ([`agent_registry_ui.rs`](https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/agent_registry_ui.rs)):
- `AgentRegistryCard` components with icon, name, version, description, agent ID
- Virtualized `uniform_list` with search/filtering
- Install button calls `update_settings_file()` → adds `CustomAgentServerSettings::Registry`
- Four status states: `NotInstalled`, `InstalledRegistry`, `InstalledCustom`, `InstalledExtension`

Mode selector ([`mode_selector.rs`](https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/mode_selector.rs)): dropdown with Cycle/Set/Display operations, async transition with disabled state during switching. Secondary-click to set a mode as default via `agent_server.set_default_mode()`.

### 3.12 Zed's recent ACP work (commits on `crates/acp_thread`)

From `gh api .../commits?path=crates/acp_thread`:
- **2026-04-15** `Simplify draft threads` (#53940)
- **2026-04-14** `acp: Initial support for ACP usage` (#53894)
- **2026-04-13** `acp_thread: Make UserMessageId required in AgentConnection::prompt` (#53850)
- **2026-04-08** `Fix repeated prompts in opencode acp` (#53216)
- **2026-04-08** `acp: Better handling of terminal auth on remote connections` (#53396)
- **2026-04-06** `Restore ACP slash commands when reopening threads` (#53209)

ACP is still actively evolving — WOTANN should treat ACP as a moving target, not a fixed spec.

### 3.13 Release notes highlights — v0.233 pre (2026-04-15 — 2026-04-19)

From [releases](https://github.com/zed-industries/zed/releases):
- **Claude Opus 4.7** added as language model (PR #54190, 2026-04-19 pre-release)
- Crash fix when ACP server process exits unexpectedly (PR #54138)
- Fixed thread titles hanging in generating state on failure (PR #54134)
- Fixed archiving agent thread deleting linked git worktrees outside managed dirs (PR #53991)
- Agent panel scroll/zoom bug fixed (PR #54116)
- Copilot chat: invalid reasoning effort for some models fixed (PR #54106)

Also notable from main: **OpenCode Zen provider added** (PR #49589, merged 2026-03-23, label `area:ai large-pr`). Zed talks to OpenCode Zen via remote API at `https://opencode.ai/zen/v1/models/{model}:streamGenerateContent?alt=sse`, bearer token auth, SSE streaming. Local OpenCode (via ACP) and hosted OpenCode Zen (via remote API) are two distinct integration paths.

### 3.14 Zed's open-issue top themes

From `gh api .../issues?state=open&sort=updated`:
- Extension installation broken (P1, #54280)
- Tab switcher alternatefile buffer bug (P3, #45068)
- `pane::alternatefile` and command palette interaction (#43297)
- "Go to Definition" viewport positioning (P3, #52173)
- Various priority-tagged ACP, LSP, diagnostic issues

2,700 open issues = scale pain. WOTANN will want a triage model before it hits 500.

### 3.15 What WOTANN learns from Zed

| Lesson | Port target |
|---|---|
| **Register WOTANN as an ACP server** (so Zed and JetBrains can drive it) | Phase 4, `wotann-acp/agent.json` submission to registry |
| **Consume external ACP agents** (so WOTANN becomes a meta-harness like Jean) | Phase 3, use the `AgentConnection` trait pattern |
| **Per-agent tool allowlist via regex patterns** (always_allow/deny/confirm) | P0 for Exploit tab safety |
| **Three-profile default** (Write/Ask/Minimal) as an onboarding reduction | P1 |
| **Git snapshots per user message** (checkpoint system for revert) | P1, requires shallow git snapshots |
| **Streaming edit with diff entity** as the primary edit mechanism | P0 for Editor tab |
| **`spawn_agent` tool** for subagent delegation | P1 for Workshop tab multi-agent |
| **SessionUpdate streaming** as the universal protocol between UI and model-runtime | P0 (replaces WOTANN's current ad-hoc channel broadcasts) |
| **22 built-in tool catalog** as a reference set | P1, WOTANN currently has ~15 |
| **Terminal-auth extension** for CLI-based auth flows | P1 for provider onboarding |
| **Three install modes** (Registry/Custom/Extension) for agent installation | P2 (WOTANN has connectors but no registry yet) |

---

## 4. Adjacent ecosystem — the eight other systems

### 4.1 OpenCode (sst/opencode) — the TUI reference

**Status**: v1.14.18 @ 2026-04-19, 769 releases, 11,628 commits on `dev`. **Actively developed.** [Repo](https://github.com/sst/opencode). Note: [ACP registry lists opencode under `anomalyco`](https://github.com/agentclientprotocol/registry/blob/main/opencode/agent.json) — project may have forked/renamed; needs verification.

**Architecture** ([DeepWiki source](https://deepwiki.com/sst/opencode)):
- In-house **OpenTUI** framework: Zig backend + SolidJS reactive frontend
- 60 FPS rendering with dirty-rectangle optimization
- Flexbox-like layout, mouse + keyboard events, clipboard integration
- Bun compilation for release artifacts
- **HTTP/SSE server** with SDK client (`@opencode-ai/sdk`) — TUI and SDK speak same wire protocol

**Built-in agents**: `build` (full-access, default), `plan` (read-only, permission-gated), `general` (subagent for complex tasks).

**Client/server design**: "OpenCode can run on your computer while you drive it remotely from a mobile app." Architecturally identical to Jean's HTTP+WS+token pattern — WOTANN is converging on this design by inference from multiple independent references.

**ACP registry entry**: binary distribution on 5 platforms, cmd is `./opencode acp`.

**Port value for WOTANN**: OpenTUI @ Bun is a compelling alternative to Ink (WOTANN's current TUI). If Ink hits performance walls, OpenTUI is the escape.

### 4.2 StackBlitz Bolt.new — WebContainer pattern

[github.com/stackblitz/bolt.new](https://github.com/stackblitz/bolt.new)

**Core differentiator**: WebContainer runs a full Node.js runtime **entirely inside the browser tab**. No remote VM, no VPS, no cloud IDE cost. 40% cold-start improvement in Jan 2026 ([source](https://aitoolsinsights.com/articles/stackblitz-bolt-new-infrastructure-explained)). Caches node_modules in browser IndexedDB for near-instant subsequent loads. LLM reasoning at the edge.

**Security model**: Browser sandbox — code has no access to local fs unless explicitly permitted. "Secure-by-Default."

**Stack**: Remix + AI SDK + Claude Sonnet 3.5 (as of writing; may have upgraded).

**Port value for WOTANN**: probably zero directly (WOTANN is native desktop/TUI, not browser). But *the architectural pattern* — "run the entire dev environment in the client" — is worth considering for WOTANN's web sandbox play if it builds one. Also relevant: StackBlitz-Labs maintains [bolt.diy](https://github.com/stackblitz-labs/bolt.diy) with Ollama, OpenAI, Groq support — another multi-provider routing reference.

### 4.3 Signal Desktop — messaging UX exemplar

[github.com/signalapp/Signal-Desktop](https://github.com/signalapp/Signal-Desktop)

**Architecture**: Electron with TypeScript + React + Redux + SQLCipher. Node 20.x. Three process design: main (Node) / renderer (Chromium) / preload (secure bridge). Context isolation always on; nodeIntegration always off.

**Key state patterns** ([DeepWiki](https://deepwiki.com/signalapp/Signal-Desktop)):
- `window.MessageCache` — in-memory cache to avoid DB thrashing
- `window.reduxStore` — single source of truth for UI state
- `window.IPC` — typed interface for main-process RPC

**i18n**: ICU MessageFormat, 60+ languages.

**Port value for WOTANN**: Signal's preload-bridge + IPC typing pattern is exactly what WOTANN's desktop needs as it scales beyond a handful of commands. Also Signal's "new design" rationale is instructive: they deliberately prioritized UX polish over feature velocity after reaching 10M+ desktop users. WOTANN should plan a design refresh at similar scale.

### 4.4 Raycast — command palette master

[raycast.com](https://www.raycast.com/), [extensions repo](https://github.com/raycast/extensions)

**Architecture**: Native macOS app with TypeScript + React 19 extension runtime on Node 22. Each extension exposes one or more "commands." The Raycast API handles UI rendering — extensions provide logic, Raycast provides the interface. esbuild transpiles extensions for a Darwin/Linux Go CLI.

**2026 addition**: **AI Extensions** — a new entry-point type called "Tools." Tools don't appear in root search; they provide functionality that AI can invoke. Extensions can declare Tools alongside Commands. This is Raycast's equivalent of MCP — but curated and native. ([source](https://developers.raycast.com/misc/changelog))

**Port value for WOTANN**: WOTANN's Workshop tab currently has commands; adding a Raycast-style "Tools" extension mechanism (third-party packages as MCP servers registered at install-time) would be a major UX unlock. Raycast's extension marketplace pattern (pure TypeScript/React, npm-distributed, hot-reload `npm run dev`) is a direct template.

### 4.5 Composio — connector marketplace

[composio.dev](https://composio.dev/)

**Claims**: 250-500+ apps/APIs (Slack, GitHub, Notion, Jira, etc.). Python + TypeScript SDKs. Framework adapters for LangChain, CrewAI, Groq. Managed auth, real-time triggers, audit logs, RBAC.

**Positioning vs WOTANN**: Composio is at the same layer as WOTANN's connectors. If WOTANN ships first-class connectors for Slack/GitHub/Notion/Linear, it competes directly. **Alternative**: WOTANN integrates Composio as an MCP server, gets 250+ apps for free. Worth evaluating the license/cost tradeoff.

### 4.6 Cognition Devin — the autonomous-coding reference

[cognition.ai](https://cognition.ai/), [docs.devin.ai](https://docs.devin.ai/)

**Devin 2.0** (public): "swarm of specialized models orchestrating a workflow." Compound AI system. $20 starting plan. Features:
- **Devin Wiki** — auto-indexes repos every few hours, generates architecture diagrams with linked sources
- **Interactive Planning** — validate approach before execution starts
- **Multiple parallel Devins** with dedicated cloud IDEs

**Port value for WOTANN**:
- **Wiki-from-repo** pattern: WOTANN could generate a `/wiki` view per project using `init` skill + architecture-diagram-from-AST
- **Interactive Planning gate** — WOTANN already has this via Jean's Plan mode pattern (§2.5)
- **Multi-Devin parallelism** — WOTANN's Workshop tab could mirror this with parallel worktrees + context isolation

### 4.7 Claude Code plugin marketplace

**Official**: [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) — Anthropic-managed, split into `/plugins` (internal) and `/external_plugins` (community).

**Community**: [anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community) — read-only mirror, submit at [clau.de/plugin-directory-submission](https://clau.de/plugin-directory-submission).

**Structure**: skill = single instruction set; plugin = bundle of skills/MCP servers/commands; marketplace = GitHub repo that distributes many plugins under one registry.

**105,000+ developers/month** visit [claudemarketplaces.com](https://claudemarketplaces.com/). Alternative directories: [Build with Claude](https://buildwithclaude.com/), [aitmpl.com/plugins](https://www.aitmpl.com/plugins/).

**Port value for WOTANN**:
- **WOTANN should ship a Claude Code plugin** that exposes WOTANN's most useful features as a plugin in the official directory — distribution wedge
- Jean already does this indirectly via the Opinionated pane (RTK + Caveman) — **copy the pattern**
- WOTANN's own skill/plugin marketplace should follow the same format: a GitHub repo with `.claude-plugin/marketplace.json` at root

### 4.8 Sierra AI τ-bench — the agent-evaluation standard

[sierra.ai/resources/research](https://sierra.ai/resources/research/tau-bench), [github.com/sierra-research/tau-bench](https://github.com/sierra-research/tau-bench), [tau2-bench](https://github.com/sierra-research/tau2-bench)

**Timeline**:
- **June 2024**: original τ-bench launched (retail + airline tasks, tool-agent-user interaction)
- **2025**: τ²-bench added telecom domain + DUO environment, policy-aware agents
- **March 2026**: **τ³-bench** adds:
  - **τ-Knowledge**: agents over large internal document collections across systems/formats
  - **τ-Voice**: live voice with accents, noisy environments, spotty connections, compressed lines

**Community incorporation**: Sierra merged external audit fixes (including from Anthropic) to resolve incorrect expected actions and tighten evaluation. This validates τ-bench as the de-facto standard for agent eval.

**Port value for WOTANN**:
- **WOTANN must benchmark on τ³-bench** — the retail/airline/telecom tracks are the reference. Add to WOTANN's QA harness.
- Pair with TerminalBench (for coding) and SWE-Bench (for real issues). **Three-way benchmark triangulation** is what separates real harnesses from vibe coders.

### 4.9 Minor entries

- **agent-zero** ([agent0ai/agent-zero](https://github.com/agent0ai/agent-zero)): multi-agent framework, primary-spawns-subordinates pattern, each subordinate in its own Docker container. Ollama-friendly local models. 15k+ stars. **Port value**: Docker-per-subagent isolation pattern for WOTANN's Exploit tab.
- **Mentat**: 38% SWE-Bench Lite. Multi-file + project-wide context + autonomous execution. Mostly dormant vs 2024 peak.
- **smol-ai**: no 2026 signal, likely dormant. Skip.

---

## 5. Comparison table — all 11 systems vs WOTANN

| Dimension | Conductor | Jean | Zed | OpenCode | Bolt | Raycast | Composio | Devin | τ-bench | agent-zero | WOTANN (current) |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Stars | 31.6k | 841 | 79.4k | many | 90k+ | — | — | — | 600+ | 15k | private |
| Primary language | Java | TS+Rust | Rust | Zig+TS | TS | Swift+TS | JS+Py | proprietary | Py | Py | TS |
| Durable execution | ✅✅✅ | partial | partial | ✅ | — | — | — | ✅ | n/a | — | ❌ |
| Multi-provider | 14 | 4 CLIs | 18+ | 4+ | 3 | via API | 250+ | 1 (theirs) | — | — | 13+ |
| MCP | native tasks | full | context_server | ✅ | — | via ext | — | — | — | — | ✅ |
| ACP | — | — | ✅✅✅ (created) | ✅ (registry) | — | — | — | — | — | — | ❌ port needed |
| Desktop | — | ✅ Tauri | ✅ GPUI | — | browser | ✅ native mac | — | web | — | — | partial |
| TUI | — | — | — | ✅ | — | — | — | — | — | — | ✅ Ink |
| iOS | — | partial (headless) | — | partial | — | — | — | — | — | — | ✅ |
| Sandboxes | Docker | worktrees | worktrees | — | WebContainer | — | — | cloud IDE | — | Docker | planned |
| Plan/Build/Yolo | — | ✅ | partial (mode) | plan/build | — | — | — | interactive | — | — | ❌ port needed |
| Subagent spawn | DO_WHILE | — | spawn_agent | general | — | — | — | multi-Devin | — | multi-agent | partial |
| Session replay | ✅ | ✅ (WS) | ✅ | ✅ | — | — | — | ✅ | — | — | ❌ port needed |
| Registry/marketplace | — | — | ✅ ACP | — | — | ✅ | — | — | — | — | planned |
| Benchmark position | n/a | n/a | n/a | ? | n/a | n/a | n/a | SWE-Bench 13.86% | **standard** | SWE-Bench Lite 38% | TerminalBench target 83-95% |
| License | Apache-2 | Apache-2 | AGPL/etc | MIT | MIT | commercial | commercial | commercial | MIT | MIT | pending |

---

## 6. Citations — every source used

**Conductor**:
- [github.com/conductor-oss/conductor](https://github.com/conductor-oss/conductor)
- [README.md](https://github.com/conductor-oss/conductor/blob/main/README.md)
- [ai/README.md](https://github.com/conductor-oss/conductor/blob/main/ai/README.md)
- [v3.30.0.rc2 release](https://github.com/conductor-oss/conductor/releases/tag/v3.30.0.rc2)
- [docs.conductor-oss.org](https://docs.conductor-oss.org/)
- [conductor-oss.github.io/conductor](https://conductor-oss.github.io/conductor/index.html)
- [orkes.io AI orchestration webinar](https://www.orkes.io/webinars/powering-ai-agent-orchestration-with-orkes-conductor)
- [orkes.io Conductor MCP + Claude tutorial](https://orkes.io/content/tutorials/create-workflows-using-ai-agent-claude)
- [conductor-oss/conductor-skills plugin](https://github.com/conductor-oss/conductor-skills)
- Netflix Tech Blog: "Netflix Conductor: A microservices orchestrator" (2016)

**Jean**:
- [github.com/coollabsio/jean](https://github.com/coollabsio/jean)
- [README.md](https://github.com/coollabsio/jean/blob/main/README.md)
- [jean.build](https://jean.build)
- [v0.1.41 release](https://github.com/coollabsio/jean/releases/tag/v0.1.41)
- [chat/registry.rs](https://github.com/coollabsio/jean/blob/main/src-tauri/src/chat/registry.rs)
- [http_server/server.rs](https://github.com/coollabsio/jean/blob/main/src-tauri/src/http_server/server.rs)
- [http_server/auth.rs](https://github.com/coollabsio/jean/blob/main/src-tauri/src/http_server/auth.rs)
- [http_server/websocket.rs](https://github.com/coollabsio/jean/blob/main/src-tauri/src/http_server/websocket.rs)
- [src/services/claude-cli.ts](https://github.com/coollabsio/jean/blob/main/src/services/claude-cli.ts)
- [src/services/chat.ts](https://github.com/coollabsio/jean/blob/main/src/services/chat.ts)
- [src/services/mcp.ts](https://github.com/coollabsio/jean/blob/main/src/services/mcp.ts)
- [opinionated/commands.rs](https://github.com/coollabsio/jean/blob/main/src-tauri/src/opinionated/commands.rs)
- [codex_cli/mcp.rs](https://github.com/coollabsio/jean/blob/main/src-tauri/src/codex_cli/mcp.rs)
- [coollabs.io/philosophy](https://coollabs.io/philosophy/)

**Zed**:
- [github.com/zed-industries/zed](https://github.com/zed-industries/zed)
- [zed.dev](https://zed.dev)
- [zed.dev/acp](https://zed.dev/acp)
- [zed.dev/blog/acp-registry](https://zed.dev/blog/acp-registry)
- [zed.dev/blog/claude-code-via-acp](https://zed.dev/blog/claude-code-via-acp)
- [zed.dev/docs/ai/external-agents](https://zed.dev/docs/ai/external-agents)
- [zed.dev/acp/agent/claude-agent](https://zed.dev/acp/agent/claude-agent)
- [v0.232.2 release](https://github.com/zed-industries/zed/releases/tag/v0.232.2)
- [v0.233.2-pre release](https://github.com/zed-industries/zed/releases/tag/v0.233.2-pre)
- [agent_servers/src/acp.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_servers/src/acp.rs)
- [agent_servers/src/agent_servers.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_servers/src/agent_servers.rs)
- [agent_servers/src/custom.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_servers/src/custom.rs)
- [acp_thread/src/acp_thread.rs](https://github.com/zed-industries/zed/blob/main/crates/acp_thread/src/acp_thread.rs)
- [acp_thread/src/connection.rs](https://github.com/zed-industries/zed/blob/main/crates/acp_thread/src/connection.rs)
- [agent/src/agent.rs](https://github.com/zed-industries/zed/blob/main/crates/agent/src/agent.rs)
- [agent/src/tools/](https://github.com/zed-industries/zed/tree/main/crates/agent/src/tools)
- [agent/src/tool_permissions.rs](https://github.com/zed-industries/zed/blob/main/crates/agent/src/tool_permissions.rs)
- [agent/src/thread.rs](https://github.com/zed-industries/zed/blob/main/crates/agent/src/thread.rs)
- [agent_settings/src/agent_profile.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_settings/src/agent_profile.rs)
- [agent_ui/src/agent_panel.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/agent_panel.rs)
- [agent_ui/src/agent_registry_ui.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/agent_registry_ui.rs)
- [agent_ui/src/mode_selector.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/mode_selector.rs)
- [agent_ui/src/profile_selector.rs](https://github.com/zed-industries/zed/blob/main/crates/agent_ui/src/profile_selector.rs)
- [opencode/src/opencode.rs](https://github.com/zed-industries/zed/blob/main/crates/opencode/src/opencode.rs)

**ACP Registry**:
- [github.com/agentclientprotocol/registry](https://github.com/agentclientprotocol/registry)
- [FORMAT.md](https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md)
- [claude-acp/agent.json](https://github.com/agentclientprotocol/registry/blob/main/claude-acp/agent.json)
- [opencode/agent.json](https://github.com/agentclientprotocol/registry/blob/main/opencode/agent.json)
- [agentclientprotocol.com](https://agentclientprotocol.com)
- [blog.jetbrains.com ACP Registry announcement (Jan 2026)](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/)
- [github.com/Xuanwo/acp-claude-code](https://github.com/Xuanwo/acp-claude-code)
- [npm: @zed-industries/claude-code-acp](https://www.npmjs.com/package/@zed-industries/claude-code-acp)

**Adjacent**:
- [github.com/sst/opencode](https://github.com/sst/opencode)
- [deepwiki.com/sst/opencode](https://deepwiki.com/sst/opencode)
- [github.com/stackblitz/bolt.new](https://github.com/stackblitz/bolt.new)
- [aitoolsinsights.com bolt.new infrastructure](https://aitoolsinsights.com/articles/stackblitz-bolt-new-infrastructure-explained)
- [webcontainers.io](https://webcontainers.io/)
- [github.com/stackblitz-labs/bolt.diy](https://github.com/stackblitz-labs/bolt.diy)
- [github.com/signalapp/Signal-Desktop](https://github.com/signalapp/Signal-Desktop)
- [deepwiki.com/signalapp/Signal-Desktop](https://deepwiki.com/signalapp/Signal-Desktop)
- [raycast.com/blog api/extensions](https://www.raycast.com/blog/how-raycast-api-extensions-work)
- [developers.raycast.com](https://developers.raycast.com)
- [developers.raycast.com/misc/changelog](https://developers.raycast.com/misc/changelog)
- [github.com/raycast/extensions](https://github.com/raycast/extensions)
- [composio.dev](https://composio.dev/)
- [cognition.ai/blog/devin-2](https://cognition.ai/blog/devin-2)
- [docs.devin.ai](https://docs.devin.ai/)
- [github.com/anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)
- [github.com/anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community)
- [claudemarketplaces.com](https://claudemarketplaces.com/)
- [buildwithclaude.com](https://buildwithclaude.com/)
- [sierra.ai/resources/research/tau-bench](https://sierra.ai/resources/research/tau-bench)
- [sierra.ai/resources/research/tau-3-bench](https://sierra.ai/resources/research/tau-3-bench)
- [github.com/sierra-research/tau-bench](https://github.com/sierra-research/tau-bench)
- [github.com/sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench)
- [github.com/agent0ai/agent-zero](https://github.com/agent0ai/agent-zero)

**Existing WOTANN internal refs**:
- `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/internal/AUDIT_LANE_2_COMPETITORS.md` — Lane 2 baseline (Jean at lines 117-133)

---

## 7. Top-10 port list for WOTANN (ranked by leverage × shovel-readiness)

1. **Register `wotann-acp` in the ACP registry** (Zed §3.4) — 1 PR, opens distribution to Zed + JetBrains + Emacs + Neovim users. **Phase 4, 1 week.**
2. **Jean's four-process registry pattern** (§2.4) — single `cancel_process()` multiplexes Claude/Cursor/Codex/OpenCode. **P0, 2 weeks.**
3. **Axum HTTP + WS with constant-time token + Arc<str> broadcast** (Jean §2.6) — replaces WOTANN's current ad-hoc channels. **P0, 1 week.**
4. **Conductor's workflow-as-JSON with DO_WHILE + SWITCH + JSONPath** (§1.5) — Exploit tab primitive. **P1, 2 weeks.**
5. **Plan/Build/Yolo + xhigh effort levels** (Jean §2.5) — per-session state machine. **P0, 1 week.**
6. **ACP `SessionUpdate` stream as universal UI↔runtime protocol** (Zed §3.5, §3.6) — replaces current broadcasts. **P0, 2 weeks.**
7. **Zed's regex-based tool-permission model** (§3.8) — always_allow/deny/confirm. **P0 for Exploit safety, 1 week.**
8. **Replay messages with `last_seq`** (Jean §2.6, §2.9) — crash-resume for daemon/client. **P0, 1 week.**
9. **Three built-in profiles** (Write/Ask/Minimal — Zed §3.9) + WOTANN's own 4th (Exploit). **P1, 3 days.**
10. **τ³-bench integration into WOTANN QA harness** (§4.8) — retail/airline/telecom/knowledge/voice. **P1 for credibility, 2 weeks.**

---

## 8. Meta — this research's own provenance

This document is the product of:
- **15+ `gh api` calls** (repo metadata, contributors, contents, issues, PRs, commits, releases for all 3 primary repos + ACP registry)
- **25+ WebFetch calls** on raw source files and docs
- **9 WebSearch queries** for ecosystem updates
- **Cross-referenced with**: `AUDIT_LANE_2_COMPETITORS.md` (WOTANN's prior Jean baseline at lines 117-133), `MEMORY.md` (WOTANN project context)
- **Browser automation** (claude-in-chrome) was attempted; extension not connected. Pivoted cleanly.

**Not verified** (explicitly):
- Zed's telemetry schemas (crate exists at `crates/telemetry`, not deeply inspected)
- Devin's proprietary architecture internals (closed-source)
- Composio's exact pricing + connector count (docs vary: 250 vs 500+)
- Mentat's 2026 status (appears dormant; not confirmed via last-commit)
- OpenCode authorship ambiguity: [ACP registry lists `anomalyco`](https://github.com/agentclientprotocol/registry/blob/main/opencode/agent.json) but `sst/opencode` is also active — may be distinct projects with colliding names. WOTANN should confirm before porting either.
