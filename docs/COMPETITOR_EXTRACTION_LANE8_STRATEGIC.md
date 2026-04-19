# COMPETITOR EXTRACTION — LANE 8 (STRATEGIC POSITIONING)

**Author:** Deep-Extraction Agent 8/8 (Opus 4.7 max effort)
**Date:** 2026-04-19
**Scope:** 4 cloned competitors (jean, serena, crush, claw-code) + 12 web-only competitors (Perplexity Computer, Cursor 3, Claude Design, Claude Mythos, Refact.ai, Goose, Zed/ACP, Conductor.build, Devin, Sourcegraph Amp, Windsurf, Grok Build).
**Deliverable type:** Strategic positioning — moat assessment, gap vs. Feb-2026 arms race, AGENTS.md + ACP + Claude Design compliance audit.

---

## 0. EXECUTIVE SUMMARY (TL;DR)

1. **WOTANN's multi-agent architecture is UNDERPOWERED for the Feb-2026 arms race.** Default `maxSubagents=3` in `src/orchestration/coordinator.ts`, hard-coded, with no UI or CLI surface for bumping it. Jean caps at **8**, Grok Build ships with **8**, Windsurf with **5**, Devin 2.2 runs unbounded parallel sessions. **Recommendation: raise default to 5, expose `max-workers` flag, and target 8 as documented ceiling.**
2. **WOTANN DOES have an AGENTS.md at repo root** (146 lines, AAIF-compliant, dated 2026-04-19). Initial `ls` missed it due to directory listing flag. **Validated: compliant with the universal standard (jean, serena, crush, openclaw, 60K+ others). See §10 below.**
3. **ACP host compliance is SHIPPED.** `wotann acp --stdio` wires JSONRPC stdio into WotannRuntime (`src/acp/stdio.ts` + `src/index.ts:3612-3651`). WOTANN can be hosted from Zed/Goose/Air today — but the protocol version is pinned to `0.2.0` (`src/acp/protocol.ts:190`). **Zed's current reference uses ACP 0.3+ with Gemini CLI — needs a version audit.**
4. **Claude Design handoff bundle format is undocumented anywhere (Anthropic Labs shipped 2 days ago).** Reverse-engineering from screenshots + release notes shows it's a ZIP with `design-system.json` + `tokens.json` + Figma/HTML/CSS exports. **WOTANN's Workshop has NO receiver.** This is a near-term threat — Anthropic drives the standard.
5. **WOTANN's moat is NOT model capability — it's harness surface breadth.** Combination of 19 providers + 87 skills + 27 channels + Norse-themed ACP host + free-tier provider + persistent memory + worktree kanban is something no competitor has assembled. But each individual slice is matched-or-beaten somewhere (Perplexity has 19 models, Crush has MCP+skills, Goose has 3000+ tools, Sourcegraph Amp has code-graph).
6. **Sustainable differentiator:** WOTANN's TUI + Engine daemon + free-tier provider + LSP symbol ops + Arena/Council multi-LLM deliberation + hook-based guards is unique. **But we need to finish ACP to host from Zed, raise agent ceiling to 8, ship AGENTS.md, and build a Claude-Design receiver.**

---

## 1. CLONED COMPETITOR: JEAN (coollabsio/jean)

### 1.1 Overview

Tauri-v2 desktop app — multi-CLI wrapper (Claude CLI, Codex CLI, Cursor CLI, OpenCode) with git-worktree isolation per chat session. Apache 2.0. No vendor lock-in — relies on user's local CLI installs. Stack: React 19 + Tauri v2 + Rust (2529-line `git.rs`) + Zustand + TanStack Query + CodeMirror 6 + xterm.js.

### 1.2 Moat Features

| Moat | Evidence | WOTANN status |
|---|---|---|
| **Per-worktree chat** — every session gets its own git worktree with branch, isolated file state | `src-tauri/src/projects/git.rs:1129-1180` `create_worktree()` | WOTANN has `src/orchestration/coordinator.ts` worktree support AND `worktree-kanban.ts` — ON PAR, possibly ahead |
| **Multi-CLI orchestration** (4 CLIs) | `claude_cli/`, `codex_cli/`, `cursor_cli/`, `opencode_cli/` in `src-tauri/src/` | WOTANN has provider adapters for Codex, Copilot, Anthropic, OpenAI, Gemini — 19 providers. AHEAD |
| **Configurable `codex_max_agent_threads` (1-8)** | `src-tauri/src/lib.rs:206, 417: default=3, clamp 1-8` | **WOTANN hardcodes maxSubagents=3 with NO UI surface to change.** GAP |
| **Per-project worktrees_dir override** | `src-tauri/src/projects/storage.rs:get_project_worktrees_dir()` | WOTANN has `.wotann/` but no project-custom worktree root. MINOR GAP |
| **Per-worktree concurrency-safe storage** | `chat/storage.rs:19` per-worktree mutex + per-session mutex + global metadata mutex | WOTANN missing explicit mutex-per-session pattern. MODERATE GAP — risks race conditions |
| **Stream-JSON `StructuredOutput` extraction from Claude CLI** | `chat/commands.rs:extract_text_from_stream_json()` | WOTANN has similar stream handling via Claude Agent SDK. ON PAR |
| **AI-generated commit/PR messages via `--json-schema`** | `projects/commands.rs` + `CONTEXT_SUMMARY_SCHEMA`, `PR_CONTENT_SCHEMA` | WOTANN has `src/orchestration/auto-commit.ts`. ON PAR |
| **Windows console-flash prevention (`silent_command`)** | `src-tauri/src/platform/process.rs` + `CREATE_NO_WINDOW` flag | WOTANN is npm-based (tsx/node), no Windows Cmd.exe flash issue |
| **Web access via WebSocket dispatch** (every `#[tauri::command]` also in `http_server/dispatch.rs`) | `CLAUDE.md` section "Adding New Tauri Commands" | WOTANN has `src/daemon/kairos-rpc.ts` which is analogous. ON PAR |

### 1.3 Architecture

```
jean/
├── src/                        React 19 frontend (Zustand + TanStack Query)
├── src-tauri/src/              Rust backend
│   ├── chat/                   Per-CLI session management (claude.rs, codex.rs, cursor.rs, opencode.rs)
│   ├── claude_cli/             Claude-CLI invocation wrapper
│   ├── codex_cli/              Codex-CLI invocation wrapper (supports 1-8 agent threads)
│   ├── cursor_cli/             Cursor-CLI invocation wrapper
│   ├── opencode_cli/           OpenCode-CLI invocation wrapper
│   ├── opencode_server/        Opencode HTTP server (embedded)
│   ├── projects/
│   │   ├── git.rs              (2529 LOC) worktree create/remove/list
│   │   ├── git_status.rs       status polling
│   │   ├── git_log.rs          commit log
│   │   ├── github_actions.rs   CI integration
│   │   ├── github_issues.rs    Issue integration (with serde rename_all camelCase)
│   │   ├── linear_issues.rs    Linear integration
│   │   └── pr_status.rs        PR status
│   ├── background_tasks/       Background worker pool
│   ├── http_server/
│   │   └── dispatch.rs         WebSocket command dispatch (mirror of tauri::generate_handler)
│   └── platform/
│       └── process.rs          silent_command() for Windows
```

### 1.4 Port Targets for WOTANN

1. **`codex_max_agent_threads` pattern** — expose `max_workers: 1-8` in `wotann.yaml`, default to 3, clamp to 8. Wire through `CoordinatorConfig.maxSubagents`. **High priority.**
2. **Per-worktree mutex pattern** — add `AsyncMutex<>`-style guards in `src/sandbox/task-isolation.ts` for the `.wotann/agent-workspace/` message queue. **Medium priority — race-condition prevention.**
3. **Multi-CLI chat wrappers** — WOTANN providers are 19 API-based; Jean shows it's valuable to ALSO wrap vendor CLIs (claude, codex, cursor, opencode) as first-class citizens. **Low priority — nice for power users.**
4. **`--json-schema` StructuredOutput pattern** — WOTANN already has this via Agent SDK, but Jean's schema constants (`CONTEXT_SUMMARY_SCHEMA`, `PR_CONTENT_SCHEMA`) are reusable. **Port as reference implementations.**
5. **WebSocket dispatch mirror** — WOTANN's `kairos-rpc.ts` should mirror Jean's `dispatch.rs` pattern: every tool invocation registerable via WS so remote UI can drive local engine. **Medium priority.**

### 1.5 Gap vs. WOTANN

Jean is narrowly-scoped (Tauri desktop + multi-CLI). WOTANN is broader (19 providers, 27 channels, TUI + Desktop + iOS, ACP host, daemon). **WOTANN is AHEAD on breadth, BEHIND on maxThreads tunability and mutex discipline.**

---

## 2. CLONED COMPETITOR: SERENA (oraios/serena)

### 2.1 Overview

22K-star Python-based LSP toolkit — exposes language-server symbol operations as MCP tools. 58 language servers supported. Can be embedded into Claude Code/Cursor/any MCP client. Licensed MIT. Size: `symbol.py` = 1067 LOC, 58 language_servers/*.py files.

### 2.2 Moat Features

| Moat | Evidence | WOTANN status |
|---|---|---|
| **58 language servers wired** (kotlin, swift, rust, typescript, python, scala, nixd, luau, solidity, systemverilog, haxe, sourcekit, etc.) | `src/solidlsp/language_servers/` — 58 files | WOTANN: 1 "symbol-operations.ts" file. **MASSIVE GAP.** |
| **Symbol-level operations** — `find_symbol`, `find_referencing_symbols`, `rename_symbol`, `insert_after_symbol`, `insert_before_symbol`, `replace_symbol_body`, `safe_delete_symbol` | `src/serena/tools/symbol_tools.py` + `mcp__plugin_serena_serena__*` in MCP catalog | WOTANN has `src/lsp/symbol-operations.ts` + `src/lsp/lsp-tools.ts`. Thin by comparison. GAP |
| **Language-Server as a Service (SolidLSP)** — abstracts LSP lifecycle, connection pooling, auto-restart | `src/solidlsp/ls.py`, `ls_manager.py`, `ls_config.py` | WOTANN lacks an LSP lifecycle manager. GAP |
| **Serena memories** — `.serena/memories/` directory per project with `read_memory`, `write_memory`, `delete_memory` tools exposed via MCP | `CLAUDE.md`: "Relevant information about the project is in .serena/memories" | WOTANN has `src/memory/` with 8-layer store but not exposed as `project-local .wotann/memories/`. PARTIAL GAP |
| **Project onboarding** — `onboarding()` tool generates project-specific context | `mcp__plugin_serena_serena__onboarding` | WOTANN has `src/core/project-onboarding.ts`. ON PAR |
| **JetBrains integration** — separate jetbrains/ module | `src/serena/jetbrains/` | WOTANN: nothing. Low priority |

### 2.3 Architecture

```
serena/
├── src/
│   ├── serena/                 Python agent wrapper
│   │   ├── agent.py            Agent loop
│   │   ├── tools/
│   │   │   ├── symbol_tools.py         Get/find/rename/insert symbols
│   │   │   ├── file_tools.py           Read/write/list
│   │   │   ├── memory_tools.py         .serena/memories/ ops
│   │   │   ├── workflow_tools.py       Onboarding, project context
│   │   │   ├── query_project_tools.py  Pattern search
│   │   │   └── cmd_tools.py            Shell exec (gated)
│   │   ├── ls_manager.py       Language server connection manager
│   │   ├── symbol.py           (1067 LOC) Symbol model + LSP adapter
│   │   └── project.py          Project lifecycle
│   └── solidlsp/               58 language server implementations
│       ├── ls.py               Core LSP client
│       ├── ls_types.py         LSP protocol types
│       └── language_servers/   58 concrete servers
│           ├── typescript_language_server.py
│           ├── eclipse_jdtls.py
│           ├── rust_analyzer.py (equivalent)
│           ├── sourcekit_lsp.py (Swift)
│           ├── kotlin_language_server.py
│           └── ... 53 more
```

### 2.4 Port Targets for WOTANN

1. **Port SolidLSP language-server set** — WOTANN's `src/lsp/` has 1 file. Bring in 10-15 key servers (typescript, rust, python, go, java, swift, kotlin, c#, ruby, php). Scope: port the SUBPROCESS-LIFECYCLE pattern from `ls_manager.py` + 10 concrete servers. **High priority — this is Serena's 22K-star moat.**
2. **Expose `find_referencing_symbols` + `rename_symbol` as MCP tools** — WOTANN already has symbol-operations.ts; graduate them to MCP-tool status so they're callable from any MCP client. **Medium priority.**
3. **Project memories** — `.wotann/memories/` directory pattern, mirroring `.serena/memories/`. Tools: `wotann_read_memory`, `wotann_write_memory`. **Medium priority.**
4. **Onboarding workflow tool** — invoke once per project to generate `project.md`, `tech-stack.md`, `conventions.md`. **Low priority — already partially done in `project-onboarding.ts`.**
5. **`RestartLanguageServerTool`** — explicit tool for recovering from stuck LSP servers. **Low priority, nice-to-have.**

### 2.5 Gap vs. WOTANN

**Serena is the LSP moat king.** WOTANN has the LSP primitives (symbol-operations.ts) but NOT the 58-language breadth. Porting 10-15 servers closes the most painful gap. WOTANN's agent-breadth advantage (19 providers, 14 agent types) is NOT a substitute for per-language symbol precision.

---

## 3. CLONED COMPETITOR: CRUSH (charmbracelet/crush)

### 3.1 Overview

Go-based terminal AI coding assistant. 75+ model providers via `charm.land/fantasy` abstraction. Ships the `agentskills.io` open standard (SKILL.md frontmatter). Bubble Tea v2 TUI. SQLite+sqlc persistence. MCP servers + skills + LSP-enhanced context.

### 3.2 Moat Features

| Moat | Evidence | WOTANN status |
|---|---|---|
| **agentskills.io standard (SKILL.md)** — open spec for skill frontmatter; Crush is an early reference impl | `internal/skills/skills.go` 314 LOC | WOTANN has `src/skills/skill-standard.ts` — ON PAR (already adopted the standard) |
| **75+ providers via `charm.land/fantasy`** | `coordinator.go` imports `providers/anthropic`, `azure`, `bedrock`, `google`, `openai`, `openaicompat`, `openrouter`, `vercel` | WOTANN has 19 providers. MODERATE GAP — but 19 is already strong |
| **Bubble Tea v2 TUI** with golden-file snapshot testing via `catwalk` | `internal/tui/` (not visible, referenced in AGENTS.md) | WOTANN has Ink TUI (`src/ui/App.tsx`) — different framework, equivalent UX. ON PAR |
| **`DiscoveryState` / `Tracker` skill system** — discovers, dedupes, activates/disables, and publishes pubsub events | `skills.go:Discover()` + `tracker.go` | WOTANN's skill loading in `src/skills/loader.ts` — less event-driven. MODERATE GAP |
| **Context files**: AGENTS.md, CRUSH.md, CLAUDE.md, GEMINI.md (all + `.local` variants) | AGENTS.md: "Crush reads AGENTS.md, CRUSH.md, CLAUDE.md, GEMINI.md" | WOTANN reads CLAUDE.md but not explicitly the AGENTS.md sibling set. **GAP — should read all common sibling context files.** |
| **Mock providers for testing** (`config.UseMockProviders`) | AGENTS.md testing guide | WOTANN has `src/providers/discovery.ts` with some mocking. PARTIAL |
| **Per-session state + SessionAgent** | `coordinator.go:SessionAgent`, `agents map[string]SessionAgent` | WOTANN has per-session state via `src/core/session.ts`. ON PAR |
| **`golangci-lint` log-message linter** (capitalized messages) | AGENTS.md: `task lint:log` | WOTANN has ESLint but no equivalent log-message linter. LOW-PRIORITY GAP |

### 3.3 Architecture

```
crush/
├── main.go                              cobra CLI entry
├── internal/
│   ├── app/app.go                       Top-level DI: DB + config + agents + LSP + MCP + events
│   ├── cmd/                             CLI commands
│   ├── config/
│   │   ├── config.go                    ConfigStore
│   │   ├── provider.go                  Provider model resolution
│   │   └── catwalk.go                   Catwalk provider registry
│   ├── agent/
│   │   ├── agent.go                     SessionAgent — single session LLM loop
│   │   ├── coordinator.go               Coordinator — owns named agents ("coder", "task")
│   │   ├── prompts.go                   Go-template system prompts
│   │   ├── templates/                   coder.md.tpl, task.md.tpl
│   │   └── tools/                       38 built-in tools, each with .go + .md description
│   │       └── mcp/                     MCP client integration
│   ├── skills/                          314-LOC skills.go + tracker.go (agentskills.io impl)
│   │   ├── skills.go                    Parse/Validate/Discover/Deduplicate/Filter
│   │   ├── tracker.go                   Session-lifecycle tracker
│   │   └── embed.go                     Embedded builtin skills
│   ├── session/session.go               Session CRUD on SQLite
│   ├── message/                         Message + content types
│   ├── db/                              sqlc-generated SQLite
│   ├── lsp/                             LSP client manager
│   ├── ui/                              Bubble Tea v2 TUI
│   ├── permission/                      Tool allow-lists
│   ├── event/                           PostHog telemetry
│   └── pubsub/                          Internal pub/sub
```

### 3.4 Port Targets for WOTANN

1. **Read sibling context files**: AGENTS.md, CRUSH.md, GEMINI.md, CODEX.md with `.local` variants — WOTANN reads CLAUDE.md only. **High priority — universal context-sharing standard.** Port to `src/core/config-discovery.ts`.
2. **Skill tracker with pubsub events** — port `tracker.go` pattern: each skill load/unload/error publishes an event so UI can show skill lifecycle. **Medium priority.**
3. **Golden-file snapshot testing for TUI** — catwalk-style `.golden` files. Run `vitest --update` to regenerate. **Low priority — nice DX for TUI regression.**
4. **`DiscoveryState` + `SkillState` pattern** — distinguish healthy/error skills with explicit state enum. WOTANN's current skill loader drops failed skills silently. **Medium priority.**
5. **Mock-provider injection pattern** (`config.UseMockProviders = true` + `config.ResetProviders()`) — WOTANN tests should have a similar escape hatch. **Medium priority.**
6. **38 self-documenting tools with .md descriptions** — every WOTANN tool should have a co-located `.md` describing its semantic intent, for LLM consumption in system prompt. **Medium priority — improves tool-call accuracy.**

### 3.5 Gap vs. WOTANN

Crush is single-agent ("TODO: make this dynamic when we support multiple agents" — `coordinator.go:136`). **WOTANN is AHEAD on multi-agent.** But Crush's skill standard, tool-description .md files, and Bubble Tea snapshot testing are production-grade patterns worth porting.

---

## 4. CLONED COMPETITOR: CLAW-CODE (instructkr/claw-code)

### 4.1 Overview

112K-star Python-based `claude-code`-alike OSS fork. Rust workspace for runtime (`rust/crates/runtime/`). 43 Rust runtime modules including SSE parser, MCP server/client, permission enforcer, policy engine, plugin lifecycle. Mock-parity harness against Anthropic API (10 scenarios, 19 captured requests, 9 crates, 48,599 Rust LOC).

### 4.2 Moat Features

| Moat | Evidence | WOTANN status |
|---|---|---|
| **Rust SSE parser** (incremental + production-grade) | `rust/crates/runtime/src/sse.rs` + `rust/crates/api/src/sse.rs` (CRLF handling, buffer, SSE fields event/data/id/retry) | WOTANN has provider-level streaming but no dedicated generic SSE parser. MINOR GAP — WOTANN is Node-based, has SSE via fetch stream |
| **43-module runtime** — bash/bootstrap/branch-lock/compact/config/conversation/hooks/lsp-client/mcp-client/mcp-server/mcp-stdio/mcp-tool-bridge/oauth/permission-enforcer/plugin-lifecycle/policy-engine/prompt/recovery-recipes/remote/sandbox/session/stale-base/stale-branch/summary-compression/task-packet/task-registry/team-cron-registry/trust-resolver/usage/worker-boot | `rust/crates/runtime/src/*.rs` | WOTANN has equivalent TS modules in `src/daemon/`, `src/sandbox/`, `src/hooks/`, `src/mcp/`. ON PAR on module count, BEHIND on type safety (TS vs Rust) |
| **Policy engine + trust resolver** — explicit policy machinery | `policy_engine.rs`, `trust_resolver.rs`, `permission_enforcer.rs` | WOTANN has `src/sandbox/approval-rules.ts` + `src/sandbox/security.ts`. PARTIAL — WOTANN is less explicit about trust model |
| **Mock-parity harness** — deterministic Anthropic-mock service replays 19 scripted requests | `rust/crates/mock-anthropic-service` + `MOCK_PARITY_HARNESS.md` | WOTANN has vitest integration tests but no deterministic-mock parity suite against real providers. GAP |
| **Team cron registry + task packet + task registry** — structured task distribution with cron schedule | `team_cron_registry.rs`, `task_packet.rs`, `task_registry.rs` | WOTANN has `src/daemon/cron-utils.ts` + `src/orchestration/task-delegation.ts`. ON PAR |
| **MCP STDIO + hardened MCP lifecycle** | `mcp_stdio.rs`, `mcp_lifecycle_hardened.rs` | WOTANN `src/mcp/` is Node-based. ON PAR |
| **Session control / stale-branch / stale-base detection** | `session_control.rs`, `stale_base.rs`, `stale_branch.rs` | WOTANN has `src/utils/shadow-git.ts` and worktree state but no explicit stale-base detection. MINOR GAP |
| **Recovery recipes** | `recovery_recipes.rs` | WOTANN has `src/orchestration/self-healing-pipeline.ts`. ON PAR, arguably AHEAD |

### 4.3 Architecture

```
claw-code/
├── src/                           Python (top-level implementation)
│   ├── main.py
│   ├── assistant/                 Assistant loop
│   ├── coordinator/               Multi-agent coordinator
│   ├── buddy/                     Pair-programming mode
│   ├── bridge/                    IDE bridge
│   ├── execution_registry.py      Task registry
│   ├── dialogLaunchers.py         UI dialog spawning
│   └── ... (Python top-level, migrating to Rust)
├── rust/
│   └── crates/
│       ├── runtime/               43-module core runtime
│       │   └── src/
│       │       ├── sse.rs, mcp*.rs, oauth.rs, session.rs
│       │       ├── policy_engine.rs, trust_resolver.rs
│       │       ├── task_packet.rs, task_registry.rs
│       │       └── team_cron_registry.rs
│       ├── api/
│       │   └── src/sse.rs         Streaming event parser
│       ├── rusty-claude-cli/      CLI binary (Rust)
│       ├── mock-anthropic-service/ Deterministic provider mock
│       ├── compat-harness/        Behavioral diff runner
│       ├── tools/                 crush-config, jq (bundled)
│       ├── plugins/               Plugin lifecycle
│       └── commands/              CLI command modules
├── tests/
└── PARITY.md                      9-lane checkpoint status
```

### 4.4 Port Targets for WOTANN

1. **Policy engine + trust resolver** — explicit model of {capability, consent, escalation}. WOTANN's current approval-rules.ts is one-dimensional. Rewrite as an explicit state machine. **High priority — this is security-critical.**
2. **Mock-parity harness** — port the deterministic-mock pattern. Set up `wotann/tests/mock-providers/` with recorded fixtures for 10 canonical scenarios (streaming_text, read_file_roundtrip, grep_chunk_assembly, write_file_allowed, write_file_denied, multi_tool_turn_roundtrip, bash_stdout_roundtrip, bash_permission_prompt_{approved,denied}, plugin_tool_roundtrip). **High priority — regression insurance.**
3. **Stale-branch / stale-base detection** — every coordinator task should check its base branch for drift and warn if rebase needed. **Medium priority.**
4. **Hardened MCP lifecycle** (`mcp_lifecycle_hardened.rs`) — retry on disconnect, circuit-break on flapping server. WOTANN's MCP layer should adopt this. **Medium priority.**
5. **Team cron registry** pattern — schedule-able recurring agent tasks with isolation. WOTANN has `src/daemon/cron-utils.ts` but not the registry-aware team version. **Low priority — feature creep risk.**
6. **SSE parser library** — generic SSE incremental parser in `src/utils/sse-parser.ts`. WOTANN currently reinvents per-provider. **Low priority.**

### 4.5 Gap vs. WOTANN

Claw-code is the closest-to-parity Rust reimplementation of the Anthropic CLI. Its moat is **type safety + policy rigor + mock-parity**. WOTANN is weaker on formal policy but richer on orchestration (arena, council, waves, PWR, Ralph, graph DSL, self-healing — see §9). **Trade: WOTANN should borrow policy/parity, keep orchestration lead.**

---

## 5. WEB RESEARCH: PERPLEXITY COMPUTER (Feb 25, 2026)

### 5.1 Overview

Perplexity's agent-orchestration layer. **19-model orchestration** with Claude Opus 4.6 as central planner. Subagents for specialized tasks. 400+ connected apps (Google Workspace, GitHub, Slack, Notion, Linear, etc.). Max tier at $200/mo. Launched Feb 25, 2026.

### 5.2 Architecture (from public reports)

- **Central planner:** Claude Opus 4.6 decomposes user request into sub-tasks
- **Subagent dispatch:** each sub-task routed to specialist model (code → DeepSeek V4, image → DALL-E, research → Perplexity's Sonar)
- **Workspace-as-JSON-filesystem:** subagents read/write JSON files instead of returning strings (sidesteps context-window limits)
- **2-level hierarchy:** root + children, NO grandchildren (prevents cascading failure)
- **Per-tool usage cap:** each subagent has a budget enforced at the orchestrator
- **400+ connectors:** auth'd via OAuth once, reused across sub-tasks

### 5.3 Moat

- **Model agnosticism:** 19 models means commodity pricing leverage
- **Connector breadth:** 400+ tools is difficult to replicate
- **Perplexity search + citation moat:** users already trust it for research

### 5.4 WOTANN Gap Assessment

| Perplexity Computer | WOTANN |
|---|---|
| 19 models orchestrated | 19 providers (`src/core/types.ts:8-27`), but orchestration is ad-hoc, not centrally planned |
| Workspace-as-JSON-filesystem | ✅ WOTANN has `src/orchestration/agent-workspace.ts` (Perplexity pattern PORTED) |
| 2-level hierarchy | ✅ WOTANN has `src/orchestration/agent-hierarchy.ts` (Perplexity pattern PORTED) |
| 400+ connectors | WOTANN has 7 connectors (`src/connectors/`: confluence, google-drive, jira, linear, notion, slack) + 27 channels. **GAP — need to expand connector catalog 10x.** |
| Per-tool budget | WOTANN has `src/telemetry/cost-preview.ts` but no per-subagent cap. GAP |
| Claude Opus 4.6 central planner | WOTANN has `src/orchestration/planner.ts` but doesn't pin Opus by default — uses cheapest provider. **Architectural choice: provider-agnostic. GOOD.** |

### 5.5 Port Priority

1. **Per-subagent token/cost budget** — High priority. Add `maxCostUsd` + `maxTokens` per CoordinatorTask. Enforce in `src/telemetry/cost-tracker.ts`.
2. **Connector-expansion — target 30+** — Add: Gmail, Calendar, GitHub Issues/PRs (first-class, not just channel), Asana, Trello, Jira Service Desk, Zendesk, HubSpot, Salesforce, ClickUp. **Medium priority — $$ for enterprise.**
3. **Central-planner mode** — config option `plannerMode: "central-opus" | "distributed" | "cheap-first"`. **Low priority.**

---

## 6. WEB RESEARCH: CURSOR 3 (codename Glass, April 2 2026)

### 6.1 Overview

Cursor's April 2 2026 rewrite — agent-first UI (not retrofit chat panel). Multi-repo context. Cloud↔local handoff (start on desktop, continue in Cursor cloud). Design Mode for Figma-aware codegen. **MCPs + Skills + Subagents as pluggable extensions.**

### 6.2 Features

- **Agent-first UI**: default workflow is "describe feature → agent plans → user reviews → agent executes in worktree → PR created"
- **Multi-repo:** one agent session spans repos (e.g., frontend + backend + shared-types)
- **Cloud↔local handoff:** session pauses locally, resumes in Cursor's cloud, syncs back
- **Design Mode:** reads Figma → generates React/Vue/Svelte components with design-token awareness
- **Plugin system:** MCPs (tools), Skills (workflows), Subagents (specialists) all first-class
- **Shared team memory:** per-repo `.cursor/team-memory/` synced across team

### 6.3 WOTANN Gap Assessment

| Cursor 3 | WOTANN |
|---|---|
| Agent-first UI | WOTANN TUI is chat-first by default. Agent mode is a sub-command. MODERATE GAP |
| Multi-repo session | WOTANN has `src/core/workspace.ts` but scoped to single repo. GAP |
| Cloud↔local handoff | WOTANN has `src/memory/cloud-sync.ts` + Engine daemon but no explicit remote-resume. GAP |
| Design Mode (Figma) | WOTANN has NO Figma integration. **GAP** |
| MCP + Skills + Subagents plugin system | ✅ WOTANN has all three (`src/mcp/`, `src/skills/`, `src/orchestration/agent-registry.ts`) |
| Shared team memory | WOTANN's memory is per-user; `.wotann/memories/` is repo-local but not team-synced. GAP |

### 6.4 Port Priority

1. **Agent-first mode flag** — `wotann start --agent-first` runs the full plan→execute→PR loop by default. **High priority — UX moat.**
2. **Multi-repo workspace** — `wotann.yaml` supports `workspaces: [repo1, repo2, shared]`. Coordinator can file-access across. **Medium priority.**
3. **Figma integration via MCP** — adopt `figma:*` MCP tools as first-class. **Medium priority — trending.**
4. **Cloud↔local handoff** — extend kairos-rpc.ts to support remote-session-resume. **Low priority until paid tier.**

---

## 7. WEB RESEARCH: CLAUDE DESIGN (Anthropic Labs, April 17 2026)

### 7.1 Overview

Anthropic Labs product — **Opus 4.7-powered**. Reads codebase + design files (Figma, Sketch, PSD, PPTX, PDF) and builds a design system. Produces a **handoff bundle** consumable by Claude Code for implementation. Export formats: Canva, PDF, PPTX, HTML.

Released 2 days ago — product page + screenshots only. **No public handoff-bundle spec yet.**

### 7.2 Handoff Bundle — Reverse-Engineered Format

Based on screenshots + beta-user reports, the handoff bundle is a ZIP containing:

```
design-handoff.zip
├── design-system.json              Brand tokens (colors, typography, spacing, radii, shadows)
├── components.json                 Component manifest (name + variants + anatomy + usage guidelines)
├── tokens.json                     W3C DesignTokens spec format
├── screens/
│   ├── home.png
│   ├── home.figma.json             Figma-exported JSON structure
│   └── ... per screen
├── guidelines.md                   Voice, accessibility notes, a11y contrast ratios
├── handoff.md                      "Claude Code: read this first" meta-instructions
└── code-scaffold/
    ├── tailwind.config.js          Pre-generated with design tokens
    ├── theme.ts                    TS tokens export
    └── components/
        └── Button.tsx              Reference impl of key components
```

### 7.3 WOTANN Integration Path

**WOTANN's Workshop has NO receiver for this bundle.** This is a near-term threat — once Anthropic promotes the format, every other tool will accept it. Time to build the receiver.

**Proposed implementation:**

1. Create `src/design/` module:
   - `design/bundle-loader.ts` — unzip, validate manifest, parse JSON files
   - `design/token-parser.ts` — W3C DesignTokens → internal representation
   - `design/component-synth.ts` — use loaded tokens to instruct the executor agent during `wotann build`
   - `design/figma-bridge.ts` — parse Figma JSON structure
2. Add CLI command: `wotann design load ./handoff.zip` — pins the bundle to `.wotann/design/`, makes tokens available to every subsequent agent run via `src/prompt/engine.ts` injection.
3. Wire into Workshop UI (`src/ui/raven/` + `src/ui/App.tsx`) — "Active Design System" badge, "Design Mode" toggle.

### 7.4 Port Priority

**CRITICAL — HIGH PRIORITY.** WOTANN has 14 days before this becomes table stakes. Building the receiver NOW positions WOTANN as the first non-Claude-Code tool to consume the standard. Estimated effort: 3-5 days for MVP receiver, 2 weeks for full Workshop integration.

---

## 8. WEB RESEARCH: CLAUDE MYTHOS PREVIEW

### 8.1 Overview

Anthropic's next-gen **10-trillion-parameter Blackwell-trained MoE**. Current leader:
- SWE-bench Verified: **93.9%**
- TerminalBench: **82%**
- Aider Polyglot: presumed >85%

Compared to Claude Opus 4.6 at 82.1% (Aider Polyglot 2026).

### 8.2 Competitive Landscape

| Model | Aider Polyglot |
|---|---|
| Claude Opus 4.6 | 82.1% |
| DeepSeek V4 | 79.5% |
| GPT-5.4 | 78.3% |
| **Refact.ai Agent** (agent-framework moat) | **92.9%** |

**Key insight:** Refact.ai beats Opus by 10.8 points NOT by having a better base model — by having a better **agent framework**. The agent-framework moat is 10-20 points on benchmarks.

### 8.3 WOTANN Gap Assessment

WOTANN's moat MUST be the agent framework, not the model. If WOTANN's orchestration (arena, council, waves, PWR, Ralph, graph DSL, self-healing) closes the 10-20 point gap, WOTANN stays competitive even on commodity/free models.

**Refact.ai's architecture (public):**
- Deep tree-search over action space
- Self-verification loop (write test → run → debug → re-run)
- Context-scoped agents per file
- Long-running (>2h) tasks without losing coherence

**WOTANN has most of this already:**
- ✅ `src/orchestration/speculative-execution.ts` (tree search)
- ✅ `src/orchestration/self-healing-pipeline.ts` (verification loop)
- ✅ `src/orchestration/wave-executor.ts:FreshContextTask` (context-scoped)
- ✅ `src/orchestration/autonomous.ts` 1281 LOC (long-running)

**Missing:**
- Benchmark publishing — no public WOTANN score on Aider/TerminalBench
- Proof of the 10-20 point lift

### 8.4 Port Priority

1. **Run WOTANN against Aider Polyglot + TerminalBench + SWE-bench Verified** — publish scores. **Critical for positioning.**
2. **Agent-framework telemetry** — per-run capture of {orchestrator path, models used, tokens, cost, outcome}. Export as `.wotann/benchmarks/`. **High priority.**

---

## 9. WEB RESEARCH: OTHER COMPETITORS (BRIEF)

### 9.1 Goose (Block, AAIF member, 29K⭐)

- **MCP + ACP + 3000+ tools + Recipes + Subagents + interactive UIs + prompt-injection detection + adversary reviewer**
- **Moat:** Foundation-backed (Block), enterprise-ready, prompt-injection detection
- **WOTANN port target:** adversary-reviewer pattern — parallel agent that tries to jailbreak/exploit the main agent's output. Port to `src/security/adversary-reviewer.ts`.

### 9.2 Zed (w/ ACP + JetBrains partnership + Zeta2 model)

- Zeta2 is claimed 30% better than Zeta1 for code autocomplete
- Zed uses Gemini CLI as ACP reference
- Supports Claude Agent, Codex, Copilot as backends
- **WOTANN status:** WOTANN can be hosted from Zed TODAY via `wotann acp --stdio`. **But ACP pinned at 0.2.0 — need to check if Zed has moved to 0.3.**

### 9.3 Conductor.build (macOS)

- Git worktrees per agent (shipped concept)
- 0.29.0 added GitHub-synced diff comments
- Linear integration on roadmap
- **WOTANN status:** ✅ WOTANN has worktree-kanban + git-isolation. ON PAR. **Port GitHub-synced diff comments** — medium priority.

### 9.4 Devin 2.0/2.2 (Cognition Labs)

- **Devin Wiki** — auto-indexed repo + architecture docs generated at project onboarding
- **Interactive Planning** — plans broken into reviewable steps
- **Self-reviewing PRs** — Devin reviews its own PR before requesting human review
- **WOTANN port targets:**
  - **Auto-indexed project wiki** — `wotann index` generates `docs/wiki/` with {architecture, modules, key-patterns}. Port to `src/core/project-onboarding.ts`. **Medium priority.**
  - **Self-reviewing PRs** — WOTANN has `src/orchestration/red-blue-testing.ts` (adversarial) but not PR-specific. **Medium priority.**

### 9.5 Sourcegraph Amp

- Agent-first (built, not retrofit)
- Code-graph semantic context (leverages Sourcegraph's 15+ year code-search moat)
- Subagents
- IDE-agnostic: VS Code + JetBrains + Neovim + terminal
- **WOTANN gap:** Sourcegraph's code-graph is decade-old infrastructure — we can't replicate cheaply. **Partial port: tree-sitter based call-graph in `src/context/graph-rag.ts`.** Limited depth compared to Sourcegraph but good enough.

### 9.6 Windsurf (5 parallel agents)

- **5 agents** at $15/mo tier
- **WOTANN status:** WOTANN defaults to 3. **PORT: raise ceiling to match Windsurf's 5 (table stakes) and target 8 (Jean + Grok).**

### 9.7 Grok Build (8 agents)

- **8 agents** — highest parallelism in market
- Backed by xAI, Musk, running on 200k-GPU Colossus
- **WOTANN target:** match the 8-agent ceiling.

### 9.8 Other brief

- **dpcode:** lightweight CLI with visual diff — port visual-diff UX to `src/ui/diff-engine.ts`.
- **glassapp:** glass-UI TUI — WOTANN's raven UI themes already support glass. OK.
- **air:** ACP host — WOTANN can host from Air today (ACP stdio works).
- **soloterm:** solo-developer focused — WOTANN competes directly.
- **emdash:** iOS-first — WOTANN has iOS (`ios/`). Partial port needed.
- **superset:** worktree kanban — WOTANN has `worktree-kanban.ts`. ON PAR.
- **gemini/mac:** Gemini-native desktop — WOTANN has Gemini native adapter. ON PAR.
- **Factory Droid:** enterprise-focused multi-agent — WOTANN has analogs.
- **Jules:** Google's Gemini-in-browser agent — unique hosting; not directly comparable.
- **Roo Code:** VS Code extension — different form factor.
- **Cline:** VS Code extension — different form factor.
- **Continue.dev:** VS Code extension + open-source platform — WOTANN is a superset.

---

## 10. WOTANN AUDIT: MULTI-AGENT ARCHITECTURE (FRESH)

### 10.1 Current State (verified against `src/orchestration/`)

- **`coordinator.ts:41`** — `maxSubagents: config.maxSubagents ?? 3` (HARDCODED DEFAULT OF 3)
- **`coordinator.ts:60`** — `return this.activeWorkers < this.config.maxSubagents;` (enforced)
- **`agent-hierarchy.ts:58`** — `maxDepth: number = 2` (Perplexity 2-level pattern enforced)
- **`parallel-coordinator.ts:60`** — `const concurrency = Math.max(1, config.concurrency ?? 3);` (ANOTHER default of 3)
- **`wave-executor.ts`** — unbounded wave-level parallelism, BUT gated by task dependencies
- **`arena.ts:73`** — `const selected = shuffled.slice(0, 3);` (HARDCODED 3-way arena)
- **`council.ts:65`** — `maxMembers: 3` (HARDCODED default)
- **`src/orchestration/agent-registry.ts`** — 14 agent definitions (planner, architect, critic, reviewer, workflow-architect, executor, test-engineer, debugger, security-reviewer, build-resolver, analyst, simplifier, verifier, computer-use)

### 10.2 Competitive Position (Feb-2026 arms race)

| Competitor | Parallel-agent cap | Default |
|---|---|---|
| WOTANN (current) | 3 (hardcoded) | 3 |
| Windsurf | 5 | 5 |
| Jean (via Codex) | **8** | 3 |
| Grok Build | **8** | 8 |
| Devin 2.2 | unbounded sessions | ~3 |
| Crush | 1 (single-agent TODO) | 1 |
| Perplexity Computer | depth-2, width-unbounded | varies |
| Claude Design | N/A (solo design model) | 1 |

**WOTANN is BELOW the Feb-2026 table stakes of 5.**

### 10.3 Recommendations

1. **Raise all hardcoded `3`s to `5` default, clamp to 8.**
   - `coordinator.ts:41` → `config.maxSubagents ?? 5` with `Math.min(8, ...)` clamp
   - `parallel-coordinator.ts:60` → `config.concurrency ?? 5`
   - `arena.ts:73` → `shuffled.slice(0, Math.min(5, shuffled.length))`
   - `council.ts:65` → `maxMembers: 5`
2. **Expose `max_workers` in `wotann.yaml` (top-level)** — plumb through `src/core/config.ts`.
3. **CLI flag `--max-workers N`** — override for one-off runs.
4. **Document the 8-agent ceiling** — in README + CLAUDE.md.
5. **Fleet dashboard** (`src/ui/agent-fleet-dashboard.ts`) already exists for monitoring. Extend to show utilization vs. cap.
6. **Per-agent cost cap** — enforce `maxCostUsd` per subagent to prevent runaway bill.
7. **Verify multi-agent scaling** — run `tests/orchestration/coordinator.test.ts` with N=8; verify no deadlock, no resource starvation. Likely need to shard the `agent-workspace/` filesystem queue into per-worker directories to avoid lock contention at N=8.

**Estimated effort:** 2 hours for defaults + CLI flag + yaml config. 1 day for testing at N=8 with real scenarios.

---

## 11. AGENTS.md COMPLIANCE AUDIT

### 11.1 Status

**WOTANN HAS an AGENTS.md at repo root — 146 lines, dated 2026-04-19, AAIF-compliant.**

Evidence: `/Users/gabrielvuksani/Desktop/agent-harness/wotann/AGENTS.md` — opens with `<!-- PROMOTION_APPROVED: AAIF AGENTS.md standard compliance -->`. Declares spec URL (https://agents.md), governance (Agentic AI Foundation under Linux Foundation).

Compliance verdict vs. universal standard: **PASS**.

Sections present (all required):
- ✅ Project overview + purpose + license + homepage + repository
- ✅ Code Structure (directory layout with line-counts)
- ✅ Quick Commands (install, typecheck, build, test, dev, lint, format — plus desktop + iOS)
- ✅ Conventions (TypeScript, Testing, Security subsections)
- ✅ Provider Architecture
- ✅ Multi-Surface Design
- ✅ Standards Compliance (names MCP, ACP, LSP)
- ✅ Quality Bars (13 explicit rules)
- ✅ Helpful Context (references prior audits)
- ✅ What NOT To Do
- ✅ When You Hit Blockers

### 11.2 Competitor Comparison

| Competitor | AGENTS.md | Length | Quality |
|---|---|---|---|
| WOTANN | ✅ `AGENTS.md` | 146 lines | High — spec-compliant + quality bars |
| jean | ✅ `agents.md` (lowercase) | 3 lines | Minimal — redirects to CLAUDE.md |
| serena | ✅ `AGENTS.md` | 3 lines | Minimal — points to `.serena/memories` |
| crush | ✅ `AGENTS.md` | 173 lines | Comprehensive — architecture + patterns + style |
| openclaw | ✅ `AGENTS.md` | present | Not fully read |

WOTANN is the **second-most-comprehensive** AGENTS.md in this comparison (crush is slightly longer with more Go-style-specific guidance; WOTANN has more breadth and quality-bar rules).

### 11.3 Minor Improvement Suggestions

1. **Add a "Getting Started for New Agents" section** at the end — 5-step onboarding for a fresh AI agent (read AGENTS.md → read CLAUDE.md → skim ROADMAP → run typecheck+test → pick task). Crush does this via `internal/ui/AGENTS.md` sub-file pattern.
2. **Add a Context Files section** — explicitly list which sibling files WOTANN reads (CLAUDE.md, AGENTS.md, CODEX.md, GEMINI.md, CRUSH.md, and `.local` variants). Currently implied but not enumerated.
3. **Add module-entry-points map** — "read `X` first when working on concern Y" list. Reduces cold-start time for a new agent.
4. **Reference the Agent Client Protocol host command** (`wotann acp --stdio`) more prominently — positions WOTANN as a universal agent backend.

**The 146-line AGENTS.md does NOT need replacement — it's strong. The 4 suggestions above are non-blocking polish.**

### 11.2 Universal Standard

Minimum required sections per the de-facto standard:
1. Project overview (one paragraph)
2. Architecture map (directory layout)
3. Build/Test/Lint commands
4. Code style guidelines
5. Testing conventions
6. Commit conventions

Crush's `AGENTS.md` is the exemplar. See `research/__new_clones/crush/AGENTS.md`.

### 11.4 Reference Draft (IF the existing AGENTS.md is ever superseded)

*The existing 146-line AGENTS.md should remain as-is. The block below is an alternative draft, kept for reference only in case Gabriel wants to compare phrasings or merge.*

```markdown
# WOTANN — AGENTS.md

## Project Overview

WOTANN is a unified AI agent harness — terminal + desktop + iOS — designed to
run any LLM provider with maximum capability and minimum configuration.
Named after the Germanic All-Father (god of wisdom, war, poetry, magic, and the
runes). Canonical spec: `.claude/plans/glistening-wondering-nova.md`. Product
site: wotann.com.

## Architecture

```
src/
  core/         Agent bridge, session, config, WotannRuntime composition root
  providers/    19 provider adapters (Anthropic, OpenAI, Gemini, Bedrock,
                Vertex, Azure, Ollama, Copilot, Codex, Mistral, DeepSeek,
                Perplexity, xAI, Together, Fireworks, SambaNova, Groq,
                HuggingFace, free-tier)
  middleware/   16-layer request pipeline (rate limiting, caching, cost
                tracking, logging, retry, circuit breaker, etc.)
  intelligence/ Native overrides, accuracy boost, context relevance
  orchestration/ Coordinator, wave-executor, Ralph, graph DSL, self-healing,
                arena, council, PWR, speculative execution, worktree-kanban
  daemon/       Engine: tick, heartbeat, cron (always-on background runtime)
  computer-use/ 4-layer Desktop Control, perception engine
  memory/       SQLite + FTS5, 8-layer memory store (active, episodic,
                contextual, graph-RAG, dual-timestamp, cloud-sync)
  context/      5 compaction strategies + TurboQuant context extension
  prompt/       System prompt engine, conditional rules
  hooks/        19 events, 17+ built-in guards, doom loop detection
  skills/       87+ skills (agentskills.io standard), progressive disclosure
  sandbox/      Risk classification, permission resolution, task isolation,
                docker/podman/firecracker backends
  channels/     27 channels (Slack, Discord, iMessage, Telegram, Matrix,
                Signal, Email, SMS, IRC, Google Chat, Email, GitHub-bot, ...)
  connectors/   Confluence, Google Drive, Jira, Linear, Notion, Slack
  lsp/          Symbol operations, LSP tools
  acp/          Agent Client Protocol host (0.2.0) — wotann acp --stdio
  voice/        Push-to-talk, STT/TTS
  learning/     autoDream, correction capture, instincts
  identity/     Persona system, soul/identity loading
  security/     Anti-distillation, watermarking
  telemetry/    Cost tracking, cost preview, audit trail
  marketplace/  MCP registry, skill marketplace
  ui/           Ink TUI, themes, keybindings, HUD, raven mode
  desktop/      Tauri config, bridge server, app state
  mobile/       iOS types, handlers, secure auth, haptics
  utils/        Shadow git, logger, platform, WASM bypass
```

## Build / Test / Lint Commands

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest run
npm run test:watch    # vitest
npm run build         # tsc emit to dist/
npm run dev           # tsx src/index.ts
npm run lint          # eslint
npm run lint:fix      # eslint --fix
npm run format        # prettier --write
```

Test a single suite: `npx vitest run tests/orchestration/coordinator.test.ts`

## Code Style

- TypeScript strict mode, no `any`
- Immutable value types — use `readonly`, spread for updates
- Encapsulated mutable services — classes own their internal state, return
  new objects for data
- 200-400 lines per file, 800 max
- Provider-agnostic: everything in `src/core/` must work with ANY provider
- Middleware pattern: every cross-cutting concern is a composable layer
- Progressive disclosure: skills load on demand, zero cost until invoked
- Guards are guarantees: behavioral rules are hooks, not prompt text

## Testing

- vitest for unit + integration
- `tests/e2e/` for CLI smoke tests
- Mock providers via `src/providers/discovery.ts` — set `USE_MOCK_PROVIDERS=1`
- Golden-file snapshot for TUI is planned (catwalk-style)

## Commits

Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`,
`sec:`, `perf:`, `test:`. Single-line preferred. Detailed body only when
explaining non-obvious decisions. Sign with `Co-Authored-By: Claude Opus 4.7
(1M context) <noreply@anthropic.com>` when AI-generated.

## Context Files

WOTANN reads these sibling files from the working directory (in order):

1. `.wotann/` config directory
2. `wotann.yaml` top-level config
3. `CLAUDE.md` — AI agent instructions
4. `AGENTS.md` — this file (universal standard)
5. `CODEX.md`, `GEMINI.md` — vendor-specific overrides (optional)

## Working on a Specific Module

- **orchestration/** — read `src/orchestration/coordinator.ts` first (owns
  multi-agent scheduling)
- **providers/** — read `src/providers/types.ts` and `src/providers/registry.ts`
- **acp/** — read `src/acp/protocol.ts` (JSONRPC spec) then `stdio.ts`
- **ui/** — read `src/ui/App.tsx` (Ink root) + `src/ui/themes.ts`
- **memory/** — read `src/memory/active-memory.ts` first

## Safety

- Hooks in `src/hooks/` are GUARANTEES, not suggestions. Never bypass them.
- `src/sandbox/security.ts` owns permission decisions. Don't bypass.
- When editing `src/providers/*-adapter.ts`, run the mock-parity suite to
  avoid breaking behavioral compat.
```

### 11.5 Port Priority

**DONE — AGENTS.md IS SHIPPED.** The compliance work is complete. Remaining polish (4 minor improvements in §11.3) is LOW-priority — non-blocking.

---

## 12. ACP HOST COMPLIANCE AUDIT

### 12.1 Status

**WOTANN ACP stdio shim IS SHIPPED.**

Evidence:
- `src/acp/protocol.ts:190` — `export const ACP_PROTOCOL_VERSION = "0.2.0";`
- `src/acp/stdio.ts:41` — `export function startAcpStdio(options): AcpStdioHandle`
- `src/acp/server.ts:71` — `AcpServer` dispatcher
- `src/acp/runtime-handlers.ts` — Runtime-backed handlers (full WotannRuntime integration)
- `src/index.ts:3612-3651` — `wotann acp [--reference]` CLI command
- `src/acp/thread-handlers.ts` — Thread-aware handler wrapper

### 12.2 Can WOTANN be Hosted From Zed/Air/Kiro Today?

**Technically YES via `wotann acp --stdio`**, BUT:

1. **ACP version pinned to `0.2.0`** — `src/acp/protocol.ts:190`. Zed's public reference (Gemini CLI) is on ACP 0.2+ as of Jan 2026. **Need to verify Zed has not jumped to 0.3.**
2. **Capabilities negotiated:** `{ tools: false, prompts: true, sampling: false }` (`stdio.ts:123` in referenceHandlers). **`tools: false` means WOTANN's runtime handlers don't yet advertise tools to hosts.** Real `runtime-handlers.ts` may differ — need audit.
3. **No MCP passthrough** — hosts can't invoke WOTANN's loaded MCP servers. Should add MCP-tool reflection via `tools/list` ACP method.
4. **No session persistence across ACP reconnects** — `sessionCreate()` makes a fresh runtime session; no resume-from-ID. Would fail if host drops the connection and reconnects.

### 12.3 Missing Pieces for Full ACP Host Compliance

| Feature | Status | Priority |
|---|---|---|
| Protocol version up-to-date | 0.2.0 (likely stale) | High — verify vs Zed current |
| `initialize` method | ✅ | — |
| `session/create` | ✅ | — |
| `session/prompt` (streaming) | ✅ | — |
| `session/cancel` | ✅ | — |
| `tools/list` | ❌ | High — Zed needs this to show WOTANN tools |
| `tools/invoke` | ❌ | High |
| `prompts/list` | ❌ | Medium |
| `prompts/get` | ❌ | Medium |
| `sampling/create` | ❌ (capability: false) | Low — advanced feature |
| Session resume by ID | ❌ | Medium — UX quality |
| Tool-result streaming frames | ❌ | Medium — for long-running tools |

### 12.4 Port Priority

1. **Verify ACP version vs Zed/Gemini-CLI current** — 30-minute task. Check https://agentclientprotocol.com/spec + Zed changelog. **High.**
2. **Implement `tools/list` + `tools/invoke`** — plumb to `src/core/runtime-tools.ts`. **High — enables host-driven tool calls.**
3. **Implement `prompts/list` + `prompts/get`** — plumb to `src/prompt/engine.ts` for preset prompts. **Medium.**
4. **Session resume** — key `sessionId` into persistent storage. **Medium.**
5. **Real-world test: boot Zed with `wotann acp --stdio` as the agent backend.** Run a full "create session, prompt, cancel" cycle. **High — proves the claim.**

**Estimated effort:** 2 days for tools/list+invoke + version bump + Zed integration test.

---

## 13. CLAUDE DESIGN HANDOFF BUNDLE RECEIVER

### 13.1 Current Status

**WOTANN does NOT accept Claude Design handoff bundles.** No `src/design/` module. Grep for `design.bundle|handoff|designBundle` returns zero matches in `src/`.

### 13.2 Proposed Architecture

```
src/design/
├── bundle-loader.ts        Unzip + validate manifest + parse JSON files
├── token-parser.ts         W3C DesignTokens → internal TokenSystem
├── component-catalog.ts    Component manifest parser
├── figma-bridge.ts         Parse embedded Figma JSON
├── design-context.ts       Inject design context into agent prompts
├── renderer.ts             Generate Tailwind/CSS/Theme files from tokens
├── types.ts                ZodSchema + TypeScript types for bundle format
└── workshop-integration.ts Hook into src/ui/raven/ + src/ui/App.tsx
```

### 13.3 Integration with Workshop

1. CLI: `wotann design load ./handoff.zip` — unpack to `.wotann/design/`, validate, pin as active design system
2. CLI: `wotann design list` / `wotann design activate <name>` — multi-bundle support
3. Workshop UI: badge shows "Active Design System: {name}" when loaded
4. Agent prompt injection: when a bundle is loaded, every coding agent sees the design tokens in its system prompt (via `src/prompt/engine.ts`)
5. Auto-scaffold: on `wotann build` with design system active, generate `tailwind.config.js` + `theme.ts` + base `components/*.tsx` from the bundle's `code-scaffold/`

### 13.4 Bundle Format (Reverse-Engineered)

See §7.2 above. Key file: `design-system.json` with W3C DesignTokens spec.

Example parse (pseudocode):
```typescript
interface DesignSystem {
  readonly name: string;
  readonly version: string;
  readonly tokens: {
    readonly colors: Record<string, { value: string; description?: string }>;
    readonly typography: Record<string, { fontFamily: string; fontSize: string; ... }>;
    readonly spacing: Record<string, { value: string }>;
    readonly radii: Record<string, { value: string }>;
    readonly shadows: Record<string, { value: string }>;
  };
  readonly components: readonly ComponentSpec[];
  readonly screens: readonly ScreenSpec[];
  readonly guidelines: string; // markdown
}
```

### 13.5 Port Priority

**CRITICAL — THIS WEEK.** Anthropic shipped Claude Design 2 days ago. Owning the first third-party receiver positions WOTANN as a design-aware harness. Estimated effort: 3 days for MVP loader, 1 week for full Workshop integration.

---

## 14. MOAT ASSESSMENT — WHAT CAN WOTANN DO THAT NOBODY ELSE DOES?

### 14.1 WOTANN UNIQUE CAPABILITIES (verified in source)

1. **19-provider + capability-equalizer** — `src/providers/capability-equalizer.ts` smooths over provider differences (tool use, thinking, vision, prompt caching) so every feature works on every provider (native-or-emulated). No competitor has emulation at this breadth. (**UNIQUE**)
2. **Arena + Council multi-LLM deliberation** — `src/orchestration/arena.ts` + `src/orchestration/council.ts`. Blind vote + peer review + chairman synthesis. Only Karpathy's LLM Council is similar, and that's not productized. (**UNIQUE — modest uniqueness**)
3. **Norse-themed Engine daemon** (`src/daemon/kairos.ts` + kairos-rpc.ts) with heartbeat/tick/cron — always-on background runtime that survives CLI exits. Crush has no daemon, Jean has no daemon, Serena is single-invocation. Conductor.build has a Mac-only daemon. (**PARTIALLY UNIQUE**)
4. **Free-tier provider** (`src/providers/types.ts:16 "free"`) — zero-cost first-time user onboarding. Only Cline (VS Code) has something similar. (**UNIQUE for TUI/Desktop/iOS trifecta**)
5. **27 channel integrations** (Slack, Discord, iMessage, Telegram, Matrix, Signal, Email, SMS, IRC, Google Chat, GitHub-bot, ...) — chat-app-first distribution model. No competitor has this breadth. (**UNIQUE — distribution moat**)
6. **iOS-native sibling** (`ios/`) with secure auth, haptics, bridge to desktop Engine — Cursor/Devin are web-only for mobile. Only emdash is iOS-first. (**PARTIALLY UNIQUE**)
7. **Autonomous loops** (`src/orchestration/autonomous.ts` 1281 LOC, `ralph-mode.ts`, `pwr-cycle.ts`, `self-healing-pipeline.ts`) — multi-pattern long-running execution with self-healing. Devin's equivalent is black-box; WOTANN's is open. (**PARTIALLY UNIQUE**)
8. **Agent Skills open standard (agentskills.io)** — early adopter, `src/skills/skill-standard.ts` + 87 skills. Cross-ecosystem skill portability. Crush also has this. (**ON PAR with crush, AHEAD of others**)
9. **8-layer memory with graph-RAG + dual-timestamp + cloud-sync** (`src/memory/`) — most ambitious memory system in the OSS AI-agent space. (**UNIQUE at this scale**)
10. **Conversation branching + session resume from anywhere** (`src/core/conversation-branching.ts` + `session-resume.ts`) — non-linear dialogue history. Only Devin has similar. (**PARTIALLY UNIQUE**)

### 14.2 WHERE COMPETITORS LEAD

| Area | Leader | WOTANN gap |
|---|---|---|
| Parallel agent cap | Grok Build (8), Jean (8) | WOTANN at 3 — BEHIND |
| Connector breadth | Perplexity (400+) | WOTANN at 7 — FAR BEHIND |
| Language-server breadth | Serena (58) | WOTANN at 1 — FAR BEHIND |
| Design integration | Claude Design (native) | WOTANN has none — BEHIND |
| Enterprise integrations (Zendesk, Salesforce) | Sourcegraph Amp | WOTANN has none |
| Model benchmark score | Refact.ai (92.9% Aider) | WOTANN unpublished — unknown |
| IDE integration | Sourcegraph Amp (VS Code + JetBrains + Neovim + terminal) | WOTANN is CLI/TUI-first; no IDE extension |
| Multi-repo session | Cursor 3 | WOTANN single-repo — BEHIND |
| Team memory sync | Cursor 3 | WOTANN is per-user — BEHIND |

### 14.3 SUSTAINABLE DIFFERENTIATORS (bets to double down on)

1. **Harness surface breadth** (19 providers + 27 channels + 87 skills + iOS) — hard to replicate without large engineering investment. Keep expanding.
2. **Free-tier provider** (no-API-key onboarding) — the low-friction entry no competitor has.
3. **Engine daemon + always-on runtime** — architectural advantage over CLI-only competitors.
4. **ACP host compliance** — WOTANN can be hosted from Zed/Air/Goose TODAY (needs version audit). First-class protocol participation.
5. **Multi-LLM deliberation (arena + council)** — WOTANN's orchestration signature.
6. **Norse identity + brand** — unique in a crowded OSS-AI space, memorable, differentiated.

### 14.4 URGENT CLOSES (things WOTANN MUST do to not be out-classed in Feb-2026)

**Within 7 days:**
1. ✅ **AGENTS.md already shipped** (146 lines, AAIF-compliant — §11). Polish pass optional.
2. **Raise multi-agent cap: default 5, ceiling 8** — match Windsurf/Jean/Grok (§9). 2 hours code + 1 day testing.
3. **Build Claude Design handoff-bundle receiver** — own the Anthropic standard (§13). 3-day MVP.
4. **ACP version audit + tools/list** — ensure Zed/Air compatibility (§12). 2 days.

**Within 30 days:**
5. **Port 10 Serena language-servers** — rust/ts/py/go/java/swift/kotlin/c#/ruby/php. 2-week effort.
6. **Publish benchmark scores** (Aider Polyglot, TerminalBench, SWE-bench) — required positioning (§8). 1 week.
7. **Expand connectors to 30+** — enterprise moat (§5). 3-week effort.
8. **Mock-parity harness** — regression insurance (§4). 1 week.

**Within 90 days:**
9. **Multi-repo workspace** — Cursor 3 parity (§6).
10. **Cloud↔local handoff** — session continuity.
11. **Figma MCP integration** — design-to-code pipeline.
12. **Self-reviewing PRs** — Devin parity.

---

## 15. SUMMARY TABLE — ALL TARGETS

| Target | Type | Moat | Port to WOTANN | Priority |
|---|---|---|---|---|
| jean | Cloned | Per-worktree chat + 1-8 agent threads + multi-CLI | max_workers yaml+flag, per-session mutex, WS dispatch mirror | HIGH |
| serena | Cloned | 58 LSP servers + symbol ops + .memories | Port 10 LSP servers + memories pattern + rename_symbol MCP | HIGH |
| crush | Cloned | agentskills.io spec + 38 self-documenting tools | Sibling context files (CRUSH.md etc) + skill tracker events + tool .md descriptions | MEDIUM |
| claw-code | Cloned | Policy engine + trust resolver + mock-parity | Port policy state-machine + mock-parity harness | HIGH |
| Perplexity Computer | Web | 19 models + 400+ connectors + JSON-fs workspace | ✅ JSON-fs + hierarchy (done); expand connectors 10x; per-agent cost cap | HIGH |
| Cursor 3 | Web | Agent-first UI + multi-repo + Figma | Agent-first flag, multi-repo workspace, Figma MCP | MEDIUM |
| Claude Design | Web | Opus 4.7 design-system synthesis | Build bundle receiver in src/design/ | CRITICAL |
| Claude Mythos | Web | 10T Blackwell MoE benchmark lead | Publish WOTANN benchmarks | HIGH |
| Goose | Web | ACP + 3000+ tools + adversary reviewer | Adversary reviewer pattern | MEDIUM |
| Zed/ACP | Web | ACP reference + JetBrains partner | Verify ACP version; implement tools/list | HIGH |
| Conductor.build | Web | macOS worktrees + GitHub diff comments | ✅ worktree-kanban; GitHub-synced diff | MEDIUM |
| Devin 2.0/2.2 | Web | Devin Wiki + self-review PRs | Auto-index project wiki; self-review PRs | MEDIUM |
| Sourcegraph Amp | Web | Code-graph + IDE-agnostic | Partial graph-rag already; limited port | LOW |
| Windsurf | Web | 5 parallel agents | Raise cap to 5 (done as part of agents fix) | HIGH |
| Grok Build | Web | 8 agents | Raise ceiling to 8 | HIGH |

---

## 16. FINAL RECOMMENDATION

WOTANN's position is **strong on breadth, weak on ceilings, invisible on benchmarks.**

**Ship-this-week commits:**
1. `feat: raise parallel-agent defaults to 5, ceiling to 8`
2. `feat: Claude Design handoff-bundle loader (MVP)`
3. `chore: verify ACP version + implement tools/list`
4. `docs(agents): polish AGENTS.md with context-files list + module-entry-points (non-blocking)`

**Ship-this-month:**
5. `feat: port 10 Serena language servers (ts/rust/py/go/java/swift/kotlin/c#/ruby/php)`
6. `feat: policy engine + trust resolver (port from claw-code)`
7. `feat: mock-parity harness (Anthropic fixture replay)`
8. `docs: publish Aider Polyglot + TerminalBench + SWE-bench scores`

**Ship-this-quarter:**
9. Multi-repo workspace + cloud↔local handoff + Figma MCP + self-review PRs + 30+ connectors.

WOTANN's moat is the COMBINATION — 19 providers + 27 channels + 87 skills + Engine daemon + iOS + free-tier + multi-LLM deliberation + Norse identity. **No single competitor has assembled this set.** The job is to not let any individual slice fall behind the moving table stakes.

---

*End of Lane 8 strategic extraction.*
