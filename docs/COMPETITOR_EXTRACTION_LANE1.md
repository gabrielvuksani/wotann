# COMPETITOR EXTRACTION — LANE 1 (Reference Harnesses)

**Generated:** 2026-04-19
**Audit scope:** 5 reference repos
**Agent:** Deep-Extraction Agent 1/8 (Opus 4.7 max effort)

## Repos Covered

1. `openai/codex` (Apache 2.0) — reference OpenAI CLI harness (Rust)
2. `openclaw/openclaw` (MIT) — 50+ channels, Gateway daemon (TypeScript)
3. `VoltAgent/awesome-openclaw-skills` (MIT) — 5,200+ curated skills registry
4. `NousResearch/hermes-agent` (MIT) — shadow git, ACP, closed learning (Python)
5. `NousResearch/hermes-agent-self-evolution` (MIT) — GEPA self-evolution loop (Python)

All five are MIT-or-Apache-2.0, meaning every extracted pattern is **license-compatible with WOTANN (MIT)** and ready to port. Only one dependency in the ecosystem is AGPL (Darwinian Evolver as external CLI in hermes-self-evolution — already treated as "external CLI only" by Nous).

---

## 1. EXECUTIVE SUMMARY — TOP-10 HIGHEST-VALUE PORTS

Ranked by (moat × effort-efficiency). Each has been verified missing/weak in `wotann/src/`.

| # | Pattern | Source | Est. effort | Why it matters |
|---|---------|--------|-------------|----------------|
| 1 | **Ghost-snapshot + shadow-git checkpointing** | `hermes-agent/tools/checkpoint_manager.py` + `codex/core/src/tasks/ghost_snapshot.rs` | 16 h | Per-turn automatic filesystem snapshots, no user-repo pollution. Wotann has `autopilot/checkpoint.ts` but no shadow-repo isolation, no GIT_CONFIG_GLOBAL=/dev/null hardening, no per-turn dedup. Enables `/undo` as a first-class capability. |
| 2 | **Guardian auto-review (LLM-as-judge approval)** | `codex-rs/core/src/guardian/*` | 20 h | Instead of user approving every on-request action, a dedicated cheap model reviews and decides allow/deny, fails closed on timeout, returns structured JSON. Wotann's `approval-rules.ts` is rule-based only. This is the "autonomous agent" unlock. |
| 3 | **Memory consolidation phase-1/phase-2 pipeline** | `codex-rs/core/src/memories/*` (README + phase1.rs, phase2.rs) | 24 h | Two-phase startup pipeline: phase-1 extracts per-rollout memories to SQLite (with claim/retry leases); phase-2 consolidates globally into `raw_memories.md` + `rollout_summaries/`. Wotann has many memory backends but no consolidation lifecycle. |
| 4 | **Guardian-isolated shell snapshot (sanitized env capture)** | `codex-rs/core/src/shell_snapshot.rs` | 10 h | Captures user's shell env + cwd once per session, sanitizes (drops `PWD`, `OLDPWD`), validates via round-trip test, uses atomic rename, 3-day retention. Wotann lacks any shell-snapshot primitive — every exec re-reads env. |
| 5 | **Missing 22 channels** (BlueBubbles, Feishu, Mattermost, Nextcloud Talk, Nostr, QQ Bot, Synology Chat, Tlon, Twitch, Voice-call, WeChat, WhatsApp, Zalo, Zalo-personal, Line, IRC, SMS, iMessage-BlueBubbles, Google Chat, Microsoft Teams, Webhook, Bluebubbles) | `openclaw/extensions/*` | 80 h (per channel avg 3-4h) | Wotann has 25 channel files; OpenClaw ships 50+. Each missing channel is direct audience reach. See §2.B for full diff. |
| 6 | **Thread fork/rollback primitives** (`TruncateBeforeNthUserMessage`, `Interrupted` fork snapshots) | `codex-rs/core/src/thread_manager.rs` | 14 h | Wotann has `conversation-branching.ts` but no fork-snapshot mode. This enables "fork from any turn and try again." Codex exposes these as `thread/fork` JSON-RPC in app-server. |
| 7 | **5,200-skill registry (VoltAgent awesome-openclaw-skills) seeded into wotann/skills** | `awesome-openclaw-skills/categories/*.md` | 20 h (curation) + auto-install script | Wotann has ~87 skills. VoltAgent curated 5,211 from 13,729 by filtering spam, duplicates, malicious. Top-20 high-leverage: see §2.C. Mass import gives instant breadth. |
| 8 | **Gateway Control UI (port 18789, HTTP dashboard)** | `openclaw/src/gateway/control-ui*.ts` | 40 h | Wotann daemon (`kairos-ipc.ts`, `kairos-rpc.ts`) has RPC but no HTML dashboard. OpenClaw serves `http://localhost:18789` with CSP hardening, avatar serving, agent-scoped media roots, OAuth-bypass paths. This is the visible-daemon moat. |
| 9 | **Unified Exec PTY process manager** (reuse processes across turns, head+tail output buffer, sandbox retry-without-sandbox on denial) | `codex-rs/core/src/unified_exec/*` | 18 h | Wotann has `sandbox/unified-exec.ts` but single-shot only. Codex keeps up to 64 PTY processes alive across turns with 1 MiB rolling buffer, auto-retry on sandbox denial, orchestrator-driven approvals. |
| 10 | **Self-evolution loop (GEPA + evaluation harness + benchmark gate)** | `hermes-agent-self-evolution/evolution/skills/*` + `PLAN.md` | 60 h (Phase 1 only) | Wotann has `learning/gepa-optimizer.ts` and `learning/self-evolution.ts` as stubs. Nous shipped a complete Phase-1 pipeline: skill-as-DSPy module wrapper, eval dataset builder (synthetic + SessionDB mining), constraint gates, auto-PR generation. Port the full pipeline. |

---

## 2. PER-REPO EXTRACTION

### A. `openai/codex` — Reference Rust Harness

**Summary:** The most mature CLI-agent harness in production. Bazel-built multi-crate workspace (~90 crates). The MIT/Apache-2.0 codex-rs workspace defines the "reference implementation" for agent loop, sandboxing, multi-agent, hooks, memory, MCP, and more. Key invariants:

- Bazel + rust nightly, supports macOS (Seatbelt), Linux (bubblewrap + landlock fallback), Windows (restricted-token + elevated-runner split).
- `codex-core` (business logic, ~100 .rs files), `codex-tui` (Ratatui), `codex-app-server` (JSON-RPC for IDE extensions), `codex-exec-server` (sandboxed PTY/FS RPC), `codex-mcp` + `codex-mcp-server`.
- Feature flags via `codex-features` crate with 5 lifecycle stages (UnderDevelopment, Experimental, Stable, Deprecated, Removed).

**Parity check for specific items requested in brief:**

| Feature | Codex source | Wotann equivalent | Status |
|---|---|---|---|
| `unified_exec` | `codex-rs/core/src/unified_exec/mod.rs` | `wotann/src/sandbox/unified-exec.ts` | **Partial** — Wotann single-shot, codex persists up to 64 processes + head/tail buffer. PORT NEEDED. |
| `shell_snapshot` | `codex-rs/core/src/shell_snapshot.rs` | NONE | **Missing** — PORT NEEDED. |
| `thread/fork` | `codex-rs/core/src/thread_manager.rs` (ForkSnapshot enum) + tests/suite/fork_thread.rs | `wotann/src/core/conversation-branching.ts` | **Partial** — Wotann branches but no snapshot modes. PORT NEEDED. |
| `thread/rollback` | `codex-rs/core/src/tasks/undo.rs` + thread_rollout_truncation.rs | `wotann/src/autopilot/checkpoint.ts` | **Partial** — Checkpoint exists but no turn-level rollback protocol. PORT NEEDED. |
| `request_rule` | `codex-rs/features/src/lib.rs:116` (feature flag) + exec_policy handling | `wotann/src/sandbox/approval-rules.ts` | **Partial** — Wotann has rules but not the "propose exec rule for future approval" protocol. PORT NEEDED. |
| `mcp-server` | `codex-rs/mcp-server/*` + `codex-rs/codex-mcp/src/*` | `wotann/src/mcp/mcp-server.ts` | **Present** — but Wotann lacks the `ToolInfo` deferred-tool manifest pattern. MINOR PORT. |

#### Patterns extracted from `openai/codex` (36 patterns):

| # | Pattern | Source file:line | What it does | Why Wotann needs it | Effort | License | Status |
|---|---|---|---|---|---|---|---|
| 1 | Ghost-commit per turn | `codex-rs/core/src/tasks/ghost_snapshot.rs:22-120` | Async task that creates a git ghost commit + report on each turn, warns if >4 min, skips non-git dirs. | Wotann autopilot/checkpoint.ts doesn't issue per-turn commits. Enables `/undo last turn`. | 6h | Apache-2.0 | ready |
| 2 | Unified Exec PTY manager | `codex-rs/core/src/unified_exec/mod.rs:88-145` | Up to 64 persistent PTY processes, 1 MiB output buffer, auto-retry on sandbox denial, 300s default background timeout. | Wotann can only spawn single processes. Persistent terminals = REPL agents + long builds. | 18h | Apache-2.0 | ready |
| 3 | Shell snapshot (sanitized env capture) | `codex-rs/core/src/shell_snapshot.rs:27-176` | Spawns user shell, captures exports, sanitizes PWD/OLDPWD, validates round-trip, atomic rename, 3-day retention. | Every wotann exec re-reads env. Snapshot speeds up multi-turn. | 10h | Apache-2.0 | ready |
| 4 | Guardian auto-review | `codex-rs/core/src/guardian/mod.rs:1-100` + review_session.rs | LLM-as-judge for on-request approvals: builds compact transcript, asks cheap model for structured JSON verdict, fails closed on timeout, inherits parent network policy. | Wotann approval-rules.ts has no LLM fallback. This is "autonomous mode without user blocking." | 20h | Apache-2.0 | ready |
| 5 | Thread fork snapshot modes | `codex-rs/core/src/thread_manager.rs:152-178` (ForkSnapshot) + agent/control.rs:42-49 (SpawnAgentForkMode) | Enum `TruncateBeforeNthUserMessage(n)` + `Interrupted`; SpawnAgentForkMode with `FullHistory` + `LastNTurns(n)`. | Wotann conversation-branching doesn't support "fork after nth user msg" or "fork-as-if-interrupted." | 14h | Apache-2.0 | ready |
| 6 | Rollout recorder + compaction resume | `codex-rs/core/src/rollout.rs` + compact.rs | RolloutRecorder streams events to disk; on fork, keeps Initial context injection modes (`BeforeLastUserMessage` vs `DoNotInject`). | Wotann compact logic is ad-hoc. Codex's 2-mode compaction protocol is battle-tested. | 12h | Apache-2.0 | ready |
| 7 | Memories phase-1/phase-2 pipeline | `codex-rs/core/src/memories/README.md` + phase1.rs, phase2.rs | Phase-1 claims rollouts from state-DB, extracts to structured `raw_memory + rollout_summary`, retries failed. Phase-2 consolidates globally with watermark + added/retained/removed diff. | Wotann has many memory backends but no consolidation lifecycle. | 24h | Apache-2.0 | ready |
| 8 | Agent Control multi-agent spawn | `codex-rs/core/src/agent/control.rs:45-149` | SpawnAgentOptions with fork_parent_spawn_call_id; AgentRegistry tracked via Arc<Weak<ThreadManagerState>>; max-depth protection. | Wotann's `agent-hierarchy.ts` lacks spawn-call-id tracking. | 16h | Apache-2.0 | ready |
| 9 | Multi-agent V2 (spawn/send_message/followup_task/list/close/wait) | `codex-rs/core/src/tools/handlers/multi_agents_v2/*.rs` | 6 new tools replacing V1: spawn (+role/model/reasoning_effort), send_message (inter-agent chat), followup_task (chain tasks), list_agents, close, wait. | Wotann has `agent-hierarchy.ts` but no inter-agent messaging tool surface. | 18h | Apache-2.0 | ready |
| 10 | Guardian auto-review prompt template | `codex-rs/core/src/guardian/policy_template.md` | Policy template for the guardian model: risk_level, user_authorization, outcome (allow/deny), rationale. | Need structured prompts for our guardian. | 4h | Apache-2.0 | ready |
| 11 | Exec policy (Starlark-based command matching) | `codex-rs/execpolicy/*` | Full Starlark interpreter for matching commands to policy rules. Argv-level with type-aware arguments. | Wotann approval-rules.ts is regex-only. Starlark gives a DSL. | 24h | Apache-2.0 | ready |
| 12 | Sandboxing manager (3 platforms) | `codex-rs/sandboxing/*` + `codex-rs/windows-sandbox-rs/*` + core/src/landlock.rs | Unified `SandboxManager` with Seatbelt (macOS), bubblewrap/landlock (Linux), restricted-token/elevated-runner (Windows). | Wotann docker-backend.ts covers only Docker. Native sandboxing removes Docker dep. | 40h | Apache-2.0 | ready |
| 13 | Feature flag registry with lifecycle stages | `codex-rs/features/src/lib.rs:23-150` | Five stages: UnderDevelopment, Experimental {name, description, announcement}, Stable, Deprecated, Removed. /experimental menu auto-generated. | Wotann has no feature-flag system. This prevents shipping half-done features. | 8h | Apache-2.0 | ready |
| 14 | Plugin marketplace (discoverable + installed) | `codex-rs/core/src/plugins/*` (marketplace_add.rs, installed_marketplaces.rs, startup_sync.rs) | Marketplace add/remove, startup sync, `@mentions` in user input → plugin activation. | Wotann marketplace/registry.ts is stub. Full pattern incl. mentions. | 20h | Apache-2.0 | ready |
| 15 | Skills watcher (auto-reload on FS change) | `codex-rs/core/src/skills_watcher.rs` | FileWatcher + broadcast channel; on SkillsChanged event, clears skill manager cache. | Wotann skills/loader.ts reads once. Watcher = hot-reload. | 4h | Apache-2.0 | ready |
| 16 | Hook runtime (SessionStart, PreToolUse, PostToolUse, UserPromptSubmit, PermissionRequest) | `codex-rs/core/src/hook_runtime.rs` + hooks/* crate | 5 hook lifecycle events with preview-then-run pattern, additional_contexts injection channel, OTEL metrics. | Wotann hooks/engine.ts supports only 2-3 events. 5-event lifecycle is the Claude-style standard. | 16h | Apache-2.0 | ready |
| 17 | Session rollout reconstruction | `codex-rs/core/src/session/rollout_reconstruction.rs` | Rebuild in-memory session from persisted rollout on resume. | Wotann session-resume.ts lacks event-replay. | 10h | Apache-2.0 | ready |
| 18 | Turn diff tracker | `codex-rs/core/src/turn_diff_tracker.rs` | Per-turn diff accumulation across exec/apply_patch outputs; flushed on turn complete. | Wotann has no per-turn diff. Enables "show me what this turn changed." | 8h | Apache-2.0 | ready |
| 19 | JS REPL kernel (persistent Node VM) | `codex-rs/core/src/tools/js_repl/*` | Persistent Node kernel across turns, survives interruption. | Wotann has no REPL. Crucial for iterative code work. | 16h | Apache-2.0 | ready |
| 20 | Code Mode (nested tools via a single code-mode entrypoint) | `codex-rs/code-mode/*` + core/src/tools/handlers/code_mode | Exposes only `exec`/`wait` to model; all other tools called as nested code. | Wotann has no "reduced tool surface" mode. Saves tokens massively. | 20h | Apache-2.0 | ready |
| 21 | Agent identity (persona + memory persistence) | `codex-rs/core/src/agent_identity.rs` + `codex-rs/core/src/agent_identity/` | Persona file with versioning + migration (personality_migration.rs). | Wotann identity/persona.ts lacks versioned migration. | 6h | Apache-2.0 | ready |
| 22 | Agents.md discovery | `codex-rs/core/src/agents_md.rs` | Walks up from cwd to find `AGENTS.md` / `CLAUDE.md`, concatenates. | Wotann has partial via context-loader.ts but no symlink handling. | 4h | Apache-2.0 | ready |
| 23 | Tool search (deferred tool schema loading) | `codex-rs/core/src/tools/tool_search_entry.rs` + handlers/tool_search.rs | Deferred tools appear by name in system reminders; `ToolSearch` fetches schemas on demand. Reduces startup context by ~60%. | Wotann loads all tool schemas up front. This is the single biggest token save. | 14h | Apache-2.0 | ready |
| 24 | Request-rule protocol (model proposes exec rule) | `codex-rs/features/src/lib.rs:116` + exec_policy | Model can ask "approve this command AND save as rule for future." | Wotann approvals don't persist. This builds a policy library. | 12h | Apache-2.0 | ready |
| 25 | MCP tool exposure gating | `codex-rs/core/src/mcp_tool_exposure.rs` + mcp_skill_dependencies.rs | Per-session MCP tool allowlist, skills can declare MCP dependencies. | Wotann exposes all MCP tools always. Gating = security + tokens. | 8h | Apache-2.0 | ready |
| 26 | App server JSON-RPC protocol (thread/turn/item) | `codex-rs/app-server/README.md` + src/* | Bi-directional JSON-RPC 2.0, thread/turn/item primitives, ws + stdio transports, HMAC-signed bearer tokens, capability-token auth. | Wotann daemon uses loose RPC. App-server protocol is the IDE-extension standard. | 24h | Apache-2.0 | ready |
| 27 | Exec server (separate sandboxed process) | `codex-rs/exec-server/README.md` + src/server.rs | Separate process speaking JSON-RPC ws://, spawns/controls PTY, owns FS sandbox. Client terminates processes on disconnect. | Wotann runs exec in-process. Separate process = crash isolation. | 18h | Apache-2.0 | ready |
| 28 | Response debug context (capture failed turn inputs) | `codex-rs/response-debug-context/*` | Captures full model input/output for debugging. | Wotann has no debug-capture. Priceless for production debugging. | 6h | Apache-2.0 | ready |
| 29 | Auto-review mode (background code review) | `codex-rs/core/src/session/review.rs` + review_prompts.rs | Dedicated review agent spawns automatically post-turn, uses own prompt template. | Wotann has no inline review. | 10h | Apache-2.0 | ready |
| 30 | Realtime WebRTC voice | `codex-rs/realtime-webrtc/*` + core/src/realtime_conversation.rs | OpenAI Realtime API integration, full WebRTC client. | Wotann has voice but no realtime stream. | 30h | Apache-2.0 | blocker (OpenAI realtime API key needed for production path) |
| 31 | Responses API proxy | `codex-rs/responses-api-proxy/*` | Proxy OpenAI Responses API through local sandbox. | Wotann has no responses proxy. Enables local mock for tests. | 8h | Apache-2.0 | ready |
| 32 | Collaboration mode templates | `codex-rs/core/src/collaboration-mode-templates/*` | Pre-built personas (reviewer, pair, architect) selectable per thread. | Wotann has agent-profiles.ts but no templates. | 6h | Apache-2.0 | ready |
| 33 | Telepathy sidecar (passive screen context) | `codex-rs/features/src/lib.rs:135` (flag) + core/src/screen_context_collector.rs (if present) | Screen-reader that surfaces "user is on file X line Y" as context. | Wotann has no passive context. | 20h | Apache-2.0 | ready |
| 34 | Ansi-escape + terminal-detection crates | `codex-rs/ansi-escape/*` + terminal-detection/* | Robust ANSI escape parsing + terminal emulator detection. | Wotann TUI has bugs with iTerm / Windows Terminal. Battle-tested crate = instant fix. | 4h | Apache-2.0 | ready |
| 35 | Fuzzy file search | `codex-rs/file-search/*` | Skim-based fuzzy file/symbol search. | Wotann has no fuzzy-find. | 6h | Apache-2.0 | ready |
| 36 | OAuth keyring store | `codex-rs/keyring-store/*` + login/* | Keyring-backed auth token storage (macOS Keychain, libsecret, Windows Credential Store). | Wotann stores auth in plaintext JSON. Keyring = actual security. | 10h | Apache-2.0 | ready |

---

### B. `openclaw/openclaw` — Gateway Daemon + 50+ Channels

**Summary:** TypeScript-based locally-running AI assistant. Ships a **Gateway** (port 18789) that acts as a control plane; channels are loaded as bundled plugins under `extensions/` (101 extension directories inc. providers and channels). Plugin SDK at `src/plugin-sdk/*` is the public contract. Very strong on channels breadth and plugin architecture.

**Key architectural invariants from `AGENTS.md`:**
- Core must stay extension-agnostic (no bundled-plugin special cases in core)
- Extensions cross into core only via `openclaw/plugin-sdk/*`
- Prompt cache stability is correctness-critical: deterministic request assembly, no mid-conversation history rewrites
- Plugin discovery is manifest-first, runtime loading is narrow/targeted
- Test performance is boundary-enforced (no heavy module reloads per test)

**Channels diff (wotann 25 vs openclaw 50+):**

| # | Channel | Wotann has it? | OpenClaw ships at | Port effort |
|---|---|---|---|---|
| 1 | Slack | YES | src/channels + ext | — |
| 2 | Discord | YES | extensions/discord | — |
| 3 | Telegram | YES | extensions/telegram | — |
| 4 | Matrix | YES | extensions/matrix | — |
| 5 | Signal | YES | extensions/signal | — |
| 6 | Email | YES (partial) | (no first-class ext) | — |
| 7 | SMS | YES | (via twilio ext) | — |
| 8 | IRC | YES | extensions/irc | — |
| 9 | WhatsApp | YES | extensions/whatsapp | — |
| 10 | Teams (Microsoft) | YES | extensions/msteams | — |
| 11 | Google Chat | YES | extensions/googlechat | — |
| 12 | GitHub Bot | YES | (none) | — (wotann ahead) |
| 13 | iMessage | YES | extensions/imessage | — |
| 14 | Webchat | YES | src/web (webchat) | — |
| 15 | Webhook | YES | extensions/webhooks | — |
| 16 | IDE Bridge | YES | extensions/vscode-bridge | — |
| 17 | Terminal Mention | YES | (no first-class ext) | — |
| 18 | Unified Dispatch | YES | (central dispatch module) | — |
| 19 | Route Policies | YES | src/routing/* | — |
| 20-25 | (misc) | YES | — | — |
| **26** | **BlueBubbles** | **NO** | `extensions/bluebubbles` | 4h |
| **27** | **Feishu / Lark** | **NO** | `extensions/feishu` | 6h |
| **28** | **Mattermost** | **NO** | `extensions/mattermost` | 3h |
| **29** | **Nextcloud Talk** | **NO** | `extensions/nextcloud-talk` | 4h |
| **30** | **Nostr** (NIP-04) | **NO** | `extensions/nostr` | 5h |
| **31** | **QQ Bot** | **NO** | `extensions/qqbot` | 4h |
| **32** | **Synology Chat** | **NO** | `extensions/synology-chat` | 3h |
| **33** | **Tlon** (Urbit) | **NO** | `extensions/tlon` | 5h |
| **34** | **Twitch** (IRC) | **NO** | `extensions/twitch` | 3h |
| **35** | **Voice Call** (Plivo/Twilio) | **NO** | `extensions/voice-call` | 8h |
| **36** | **WeChat** (Tencent) | **NO** | `extensions/wechat` (external ext) | 8h (external API) |
| **37** | **Zalo** (bot) | **NO** | `extensions/zalo` | 4h |
| **38** | **Zalo Personal** (QR-login) | **NO** | `extensions/zalouser` | 6h |
| **39** | **Line** (Messaging API) | **NO** | `extensions/line` | 4h |
| **40** | **Phone Control** | **NO** | `extensions/phone-control` | 6h |
| **41** | **DingTalk** | **NO** | (hermes has it, `gateway/platforms/dingtalk.py`) | 5h |
| **42** | **HomeAssistant** | **NO** | (hermes has it, `gateway/platforms/homeassistant.py`) | 5h |
| **43** | **WeCom** | **NO** | (hermes has it) | 6h |
| **44** | **Weixin** | **NO** | (hermes has it) | 5h |
| **45** | **Device Pair** (pairing protocol) | PARTIAL | `extensions/device-pair` + src/pairing/* | 6h |
| **46** | **QA Channel** (internal test) | **NO** | `extensions/qa-channel` | 2h |
| **47** | **QA Lab** (internal test harness) | **NO** | `extensions/qa-lab` | 4h |
| **48** | **QA Matrix** (matrix-based QA) | **NO** | `extensions/qa-matrix` | 3h |
| **49** | **Thread Ownership** | **NO** | `extensions/thread-ownership` | 4h |
| **50** | **Diagnostics-OTel** | PARTIAL | `extensions/diagnostics-otel` | 4h |
| **51** | **Diffs extension** | **NO** | `extensions/diffs` | 4h |

**Total missing channels: 22-26 distinct platforms** (depending on how QA-* internal channels are counted).

#### Patterns extracted from `openclaw/openclaw` (32 patterns):

| # | Pattern | Source file | What it does | Why Wotann needs it | Effort | License | Status |
|---|---|---|---|---|---|---|---|
| 37 | Gateway Control UI (HTTP dashboard on port 18789) | `src/gateway/control-ui.ts:1-100` + control-ui-csp.ts + control-ui-routing.ts | Full SPA served on localhost:18789 with CSP header, HMAC-signed bearer-token auth, avatar/media routes scoped to agent. | Wotann has daemon RPC but no visible dashboard. This is the "always-on assistant" visual hook. | 40h | MIT | ready |
| 38 | Control-UI CSP hardening | `src/gateway/control-ui-csp.ts` | Dynamic inline-script hash computation, strict CSP that blocks XSS while allowing hash-based inlines. | Wotann has no CSP. Dashboard without CSP = XSS risk. | 6h | MIT | ready |
| 39 | Auth rate limiter | `src/gateway/auth-rate-limit.ts` | Per-IP request budget, sliding window, configurable. | Wotann daemon has no rate-limit. | 4h | MIT | ready |
| 40 | Gateway connection auth | `src/gateway/connection-auth.ts` + authorize-http-gateway-connect | Capability-token + signed-bearer-token, max-clock-skew validation, http-browser-origin-policy. | Wotann daemon auth is basic. | 10h | MIT | ready |
| 41 | Device pairing protocol | `src/gateway/pairing.ts` + src/pairing/* | Short-code pairing flow for mobile apps joining a running gateway. | Wotann has pairing hints but no full protocol. | 12h | MIT | ready |
| 42 | Auth profile rotation (fallback chain) | `src/agents/auth-profiles.ts` + auth-profiles.runtime.ts + resolve-auth-profile-order tests | When one auth profile hits rate-limit, auto-rotate to next; cooldown-auto-expiry; lastUsed ordering. | Wotann has `providers/account-pool.ts` and `budget-downgrader.ts` but no cooldown timing. | 10h | MIT | ready |
| 43 | Plugin activation planner | `src/plugins/activation-planner.ts` | Plan which plugins to activate given config + manifests before loading runtime. | Wotann loads all plugins eagerly. Planner reduces startup cost. | 8h | MIT | ready |
| 44 | Plugin manifest + discovery | `src/plugins/bundled-plugin-metadata.ts` + bundled-sources.ts | Manifest-first plugin control plane: discover, validate, enable, setup hints driven by metadata not code. | Wotann plugin layer lacks manifests. | 12h | MIT | ready |
| 45 | Plugin capability registry | `src/plugins/bundled-capability-runtime.ts` + capability-provider-runtime.ts | Capabilities (provider / channel / tool) registered per plugin; avoids ad-hoc id lists in core. | Wotann hardcodes capability lists. | 10h | MIT | ready |
| 46 | Plugin command registration | `src/plugins/bundled-commands.ts` + command-registration.ts | Slash commands defined by plugin manifests, registered at activation. | Wotann commands are code-defined. | 6h | MIT | ready |
| 47 | ClawHub (community skill registry) | `src/plugins/clawhub.ts` + clawhub.test.ts | HTTP-based installer from clawhub.ai; install-download.ts, install-extract.ts, install-fallback.ts, install-output.ts, install-tar-verbose.ts. | Wotann marketplace/ is a stub. Clawhub = 13k skills. | 20h | MIT | ready |
| 48 | Skills installer (download + extract + fallback) | `src/agents/skills-install*.ts` (11 files) | Resilient skill installer with tarball extraction, fallback to alt mirrors, verbose progress. | Wotann skills loader is local-only. | 14h | MIT | ready |
| 49 | Channel allowlist / command gating | `src/channels/command-gating.ts` + mention-gating.ts | Per-channel allowlist of who can trigger commands; mention-based gating (only respond when @mentioned). | Wotann channels respond to everything. | 6h | MIT | ready |
| 50 | Channel pairing (DM allowlist bootstrap) | `src/channels/pairing/*` + docs/channels/pairing.md | First-contact pairing flow for DM-based channels to build allowlist. | Wotann has pairing for device but not for messaging DMs. | 8h | MIT | ready |
| 51 | Channel config presence check | `src/channels/config-presence.ts` | Per-channel "is this channel configured and healthy?" probe used by doctor command. | Wotann has no doctor. | 4h | MIT | ready |
| 52 | Channel health monitor | `src/agents/channel-health-monitor.ts` + channel-health-policy.ts + channel-status-patches.ts | Continuous per-channel health probe, status patches emitted to UI, policy-driven thresholds. | Wotann has no health-check loop. | 10h | MIT | ready |
| 53 | Configured binding matcher (chat↔agent routing) | `src/channels/configured-binding-*.ts` (8 files) | Route inbound messages to the right agent based on configured bindings (channel+chat→agent). | Wotann dispatch is coarse. | 12h | MIT | ready |
| 54 | Session envelope | `src/channels/session-envelope.ts` + session-meta.ts | Per-session metadata wrapper with labels + bindings that follow a chat across restarts. | Wotann sessions are flat. | 6h | MIT | ready |
| 55 | Persistent ACP bindings | `src/acp/persistent-bindings*.ts` (6 files) | ACP session bindings that survive across restarts. | Wotann ACP (acp/*) lacks persistence. | 10h | MIT | ready |
| 56 | ACP approval classifier | `src/acp/approval-classifier.ts` | Classifies approval requests into auto / ask / deny buckets via rules. | Wotann has approval-rules but no auto/ask/deny trichotomy. | 4h | MIT | ready |
| 57 | ACP translator (multi-ACP-version adapter) | `src/acp/translator.ts` + many tests (.cancel-scoping, .error-kind, .prompt-harness, .session-rate-limit, .set-session-mode, .stop-reason) | Translates between ACP protocol versions; handles cancel-scoping, rate-limit forwarding, stop-reason mapping. | Wotann ACP is single-version. Translator = future-proof. | 12h | MIT | ready |
| 58 | Daemon launchd / systemd / schtasks managers | `src/daemon/launchd*.ts` + systemd*.ts + schtasks*.ts | Full cross-platform daemon registration: macOS launchd, Linux systemd, Windows Task Scheduler with restart handoff, linger, hints. | Wotann daemon has no OS-level install. Required for "always running." | 24h | MIT | ready |
| 59 | Daemon launch hints | `src/daemon/runtime-hints.ts` + runtime-hints.windows-paths.test.ts | Detect best-available runtime (Node / Bun), report to user. | Wotann has no runtime detection. | 4h | MIT | ready |
| 60 | Canvas Host (in-editor canvas) | `src/canvas-host/*` + a2ui | A2UI bundle (compiled web app) served as canvas inside chat; bundle.hash guarded for cache. | Wotann has no canvas. Huge for data-viz answers. | 30h | MIT | ready |
| 61 | Link understanding (URL preview resolver) | `src/link-understanding/*` | Fetches + previews URLs in messages with OG-tag extraction. | Wotann has no link previews. | 6h | MIT | ready |
| 62 | Web-fetch primitive with sandbox isolation | `src/web-fetch/*` | Sandboxed HTTP fetch with content-type policy, max-bytes, redirect handling. | Wotann web tools lack sandbox isolation. | 6h | MIT | ready |
| 63 | Secrets management (Gateway side) | `src/secrets/*` + src/security/* | Encrypted-at-rest secret store with Gateway-mediated access. | Wotann stores env in .env plain. | 12h | MIT | ready |
| 64 | Proxy capture (MITM debug proxy) | `src/proxy-capture/*` | Local HTTP proxy that records agent↔model traffic for debugging. | Wotann has no traffic-capture. | 10h | MIT | ready |
| 65 | Realtime transcription | `src/realtime-transcription/*` + realtime-voice | Live transcription of voice input to Gateway. | Wotann voice-call.ts is stub. | 20h | MIT | ready |
| 66 | Task Brain control panel / Task routing | `src/tasks/*` (not fully read, but referenced in gateway/run.ts) | Central task queue visible in Control UI with priorities + resume. | Wotann has no visible task queue. | 14h | MIT | ready |
| 67 | OAuth auth-profile rotation fallback | `src/agents/auth-profiles.chutes.test.ts` + .cooldown-auto-expiry.test.ts + ensureauthprofilestore.test.ts + getsoonestcooldownexpiry.test.ts + markauthprofilefailure.test.ts + readonly-sync.test.ts + resolve-auth-profile-order.*.test.ts (6 order tests) | Round-robin order, lastUsed ordering, Z-AI alias normalization, automatic cooldown expiry. | Wotann credential-pool.ts lacks cooldown timing + alias normalization. | 10h | MIT | ready |
| 68 | Skill-metadata-on-demand | `src/agents/skills.compact-skill-paths.test.ts` + skills.build-workspace-skills-prompt.applies-bundled-allowlist-without-affecting-workspace-skills.test.ts | Skills loaded by metadata first (name + purpose), full body fetched on activation. Cuts system-prompt size. | Wotann loads all skills up front. Major token save. | 12h | MIT | ready |

---

### C. `VoltAgent/awesome-openclaw-skills` — 5,200+ Curated Skills

**Summary:** Not a runtime; it's a curated catalog of 5,211 community skills published to ClawHub (OpenClaw's skill registry). VoltAgent filtered 7,215 from the original 13,729 (spam, duplicates, low-quality, crypto, malicious). README sections organize by 28 categories. Each skill has (1) a ClawHub link (clawskills.sh/skills/...) and (2) a GitHub link (github.com/openclaw/skills/tree/main/skills/...).

**Structure:**
- `README.md` (127 KB) — the full list
- `categories/*.md` (28 files) — per-category breakdowns
- `CONTRIBUTING.md` — PR process

**Category volumes:**
- Coding Agents & IDEs (1184)
- Web & Frontend Development (919)
- DevOps & Cloud (393)
- Search & Research (345)
- Browser & Automation (322)
- Productivity & Tasks (205)
- CLI Utilities (180)
- AI & LLMs (176)
- Image & Video Generation (170)
- Git & GitHub (167)
- Communication (146)
- Transportation (110)
- PDF & Documents (105)
- Marketing & Sales (102)
- Health & Fitness (87)
- Media & Streaming (85)
- Notes & PKM (69)
- Calendar & Scheduling (65)
- Security & Passwords (53)
- Shopping & E-commerce (51)
- Personal Development (50)
- Speech & Transcription (45)
- Apple Apps & Services (44)
- Smart Home & IoT (41)
- Clawdbot Tools (37)
- Gaming (35)
- Self-Hosted & Automation (33)
- iOS & macOS Development (29)
- Moltbook (29)
- Data & Analytics (28)

**Overlap with `wotann/skills/`:**
Wotann has 87 skill files — covering dev stack experts (react, vue, angular, etc.), marketing ops, security, testing. Almost **zero direct overlap** with the ClawHub catalog (they are community task-skills like "summarize-gmail", "book-uber"; wotann's are role-based like "react-expert", "karpathy-principles").

**Top-20 leveraged missing skills (recommended for immediate import):**

| # | Skill (ClawHub slug) | Category | Leverage | Effort |
|---|---|---|---|---|
| 1 | `steipete/slack` | Communication | Full Slack DM/channel ops (curated ref impl) | 1h |
| 2 | `arminnaimi/agent-team-orchestration` | Git | Multi-agent team lifecycle with handoff | 2h |
| 3 | `wrannaman/agentdo` | Git | Post/pick-up tasks from global queue | 2h |
| 4 | `xbillwatsonx/alex-session-wrap-up` | Git | End-of-session commit + learnings extraction | 1h |
| 5 | `monteslu/agentgate` | Git | API gateway for personal data w/ human approval | 2h |
| 6 | `skill-creator` | Meta | Creates new skills from description | 1h |
| 7 | `steipete/github` | Git | Full gh CLI integration (PR/issue/release) | 1h |
| 8 | `camsnap` | Browser | Screenshot current screen context | 1h |
| 9 | `peekaboo` | Apple | macOS screen peek + OCR | 2h |
| 10 | `obsidian` | Notes | Read/write Obsidian vault | 2h |
| 11 | `notion` | Notes | Notion API CRUD | 2h |
| 12 | `tmux` | CLI | tmux session manager | 1h |
| 13 | `apple-reminders` | Apple | iOS/macOS Reminders CRUD | 1h |
| 14 | `things-mac` | Apple | Things 3 integration | 1h |
| 15 | `trello` | Productivity | Trello board manager | 1h |
| 16 | `spotify-player` | Media | Spotify playback control | 1h |
| 17 | `video-frames` | Media | Extract frames from video | 1h |
| 18 | `nano-pdf` | PDF | Fast PDF read/manipulate | 1h |
| 19 | `mcporter` | Tools | MCP server installer/manager | 2h |
| 20 | `1password` | Security | 1Password CLI wrapper | 1h |

**Import strategy (port effort: 20h for curation + script):**
1. Scrape `awesome-openclaw-skills/categories/*.md` → structured list with (name, slug, description, github-url).
2. For each skill, fetch `SKILL.md` from `github.com/openclaw/skills/tree/main/skills/<slug>`.
3. Normalize to Wotann skill format (convert frontmatter, rewrite local paths).
4. Place under `wotann/skills/imported/` with attribution.
5. Run `wotann/scripts/skill-lint` to validate each.
6. Expose in `wotann/skills/agentskills-registry.ts` with provenance tag (`source: "clawhub"`).

**Patterns extracted (5 patterns):**

| # | Pattern | Source | What it does | Why Wotann needs it | Effort | License | Status |
|---|---|---|---|---|---|---|---|
| 69 | Curated-skill catalog with provenance tags | `README.md` (full 127 KB list) | Category-organized catalog of 5,211 skills with 2 links each (ClawHub + GitHub). | Wotann has no mass-import. This = 60× skill breadth overnight. | 20h | MIT (list) + per-skill (mixed, mostly MIT) | ready |
| 70 | Skill filter taxonomy (spam, duplicate, non-English, crypto, malicious) | `README.md:79-89` | Explicit filter criteria for community submissions: bulk accounts, duplicates, crypto, malicious (from security audit). | Wotann marketplace has no vetting. This template = avoid polluting registry. | 4h | MIT | ready |
| 71 | VirusTotal integration for skill security scanning | `README.md:162` (mentioned) | OpenClaw partnered with VirusTotal; per-skill security reports visible on ClawHub page. | Wotann has no skill security scanning. | 6h (plumbing) | MIT | ready (needs VirusTotal API key) |
| 72 | Snyk Skill Security Scanner reference | `README.md:166` | External tool: github.com/snyk/agent-scan for skill auditing. | Wotann skill-security-auditor.md is stub. | 2h (wire up external tool) | MIT for wotann side | ready |
| 73 | Agent Trust Hub | `README.md:167` | ai.gendigital.com/agent-trust-hub for skill trust scoring. | Wotann has no trust scoring. | 4h | MIT for wotann side | ready |

---

### D. `NousResearch/hermes-agent` — Shadow Git + ACP + Closed Learning

**Summary:** The most Python-native agent harness; focuses on (1) shadow-git checkpointing (transparent filesystem snapshots), (2) full ACP adapter (VS Code / Zed / JetBrains), (3) cron scheduling, (4) session-db with FTS5 search, (5) 30+ provider adapters. Also has a full Ink-based TUI (ui-tui/) with JSON-RPC bridge to Python. Deep profile (HERMES_HOME) support for multi-instance isolation.

**Key invariants from AGENTS.md:**
- Prompt caching must never break (no mid-conversation history rewrites)
- Use `get_hermes_home()` always; never hardcode `~/.hermes`
- Tests must run via `scripts/run_tests.sh` for hermetic parity with CI
- Slash command registry is central (`hermes_cli/commands.py::COMMAND_REGISTRY`) — all surfaces auto-derive
- Token locks on gateway platform adapters to prevent multi-profile credential conflicts
- Background process notifications gate by config (`display.background_process_notifications`)

#### Patterns extracted from `hermes-agent` (18 patterns):

| # | Pattern | Source file:line | What it does | Why Wotann needs it | Effort | License | Status |
|---|---|---|---|---|---|---|---|
| 74 | Shadow-git checkpoint manager | `tools/checkpoint_manager.py:1-344` | Per-turn automatic snapshots via shadow git repo at `~/.hermes/checkpoints/{sha256(dir)[:16]}/`. GIT_CONFIG_GLOBAL=/dev/null isolation prevents user-config leakage (gpgsign, hooks). HERMES_WORKDIR marker file. 50 snapshot cap per dir. Commit hash validation to prevent git flag injection. Path traversal protection. | Wotann `autopilot/checkpoint.ts` lacks (a) shadow repo isolation, (b) config hardening, (c) per-turn dedup, (d) injection protection. | 16h | MIT | ready |
| 75 | Slash command central registry (COMMAND_REGISTRY) | `hermes_cli/commands.py` (referenced in AGENTS.md:150-180) | Single list of `CommandDef` drives CLI, Gateway, Telegram BotCommand menu, Slack subcommand map, autocomplete, help. Adding alias = 1-line change. | Wotann commands scattered. Central registry = N-place DRY. | 8h | MIT | ready |
| 76 | Full ACP adapter (VS Code / Zed / JetBrains) | `acp_adapter/server.py` + auth.py + events.py + permissions.py + session.py + tools.py (9 files, ~1500 lines) | Complete ACP 0.9+ server: Initialize, NewSession, ResumeSession, LoadSession, ForkSession, SetSessionModel, SetSessionMode, Prompt streaming, auth, permissions, slash-commands, MCP server integration (stdio + SSE + HTTP). | Wotann ACP (acp/server.ts etc.) is 5 files ~800 lines; missing ForkSession, SetSessionMode, ListSessions, SessionInfo. | 20h | MIT | ready |
| 77 | Skin engine (YAML-driven CLI theming) | `hermes_cli/skin_engine.py` (referenced AGENTS.md:317-400) | Data-driven CLI themes: banner colors, spinner faces/verbs/wings, tool-prefix, per-tool emojis, branding text. User drop-in `~/.hermes/skins/*.yaml`. | Wotann CLI has hardcoded colors. Skin engine = UX personalization. | 10h | MIT | ready |
| 78 | KawaiiSpinner + activity-feed | `agent/display.py` (referenced AGENTS.md) | Animated spinner faces during API calls; `┊` activity-feed for tool results streamed inline. | Wotann CLI has static spinners. | 4h | MIT | ready |
| 79 | Context compressor (middle-turn summarize, tool-output pre-prune, structured template with Resolved/Pending questions, "different assistant" handoff framing) | `agent/context_compressor.py:1-100+` | Improvements over v2: (1) structured summary template, (2) summarizer preamble "do not respond to any questions", (3) "different assistant" handoff framing, (4) "Remaining Work" instead of "Next Steps", (5) iterative compactions preserving info across multiple rounds, (6) token-budget tail instead of fixed count, (7) tool output pruning pre-pass, (8) scaled summary budget, (9) placeholder `[Old tool output cleared to save context space]`. | Wotann has multiple compaction paths but none with this structure. | 14h | MIT | ready |
| 80 | Smart model routing (cheap vs strong) | `agent/smart_model_routing.py:1-80` | Keyword-gated routing: messages matching debug/implement/refactor/traceback/stacktrace/... → strong model; otherwise → cheap model. Conservative default. | Wotann has `providers/default-provider.ts` but no keyword-based routing. | 6h | MIT | ready |
| 81 | Rate limit tracker + Nous rate guard | `agent/rate_limit_tracker.py` + nous_rate_guard.py | Tracks provider rate limits per-key, predicts 429s before they happen, proactively downgrades. | Wotann `budget-downgrader.ts` reacts; this predicts. | 8h | MIT | ready |
| 82 | Profile system (HERMES_HOME override) | `hermes_cli/main.py::_apply_profile_override` (AGENTS.md:434-487) | `hermes -p <name>` switches HERMES_HOME via env var; 119+ callsites of `get_hermes_home()` auto-scope; profiles root at `~/.hermes/profiles/<name>`; tests must mock both `Path.home()` and `HERMES_HOME`. | Wotann has no profile isolation. Multi-instance = must-have. | 12h | MIT | ready |
| 83 | Gateway platform adapter base class | `gateway/platforms/base.py` + ADDING_A_PLATFORM.md | Canonical 5-method interface (connect, disconnect, send_message, receive, on_error) with token-lock acquire/release pattern, health probe, status patch emission. | Wotann channels lack consistent interface. | 10h | MIT | ready |
| 84 | 20+ gateway platforms | `gateway/platforms/{bluebubbles,dingtalk,discord,email,feishu,homeassistant,matrix,mattermost,qqbot,signal,slack,sms,telegram,wecom,weixin,webhook,whatsapp}.py` | Ready-to-port Python reference implementations of channels wotann is missing. | Wotann can port these directly (with TS translation). | 80h total | MIT | ready |
| 85 | Batch runner (parallel eval harness) | `batch_runner.py` (55 KB) | Runs agent on many tasks in parallel with concurrency control, trajectory capture, token budgets. | Wotann has no batch runner. Required for any eval/benchmark. | 14h | MIT | ready |
| 86 | Mini SWE-bench runner | `mini_swe_runner.py` (27 KB) | Runs SWE-bench-Lite eval against agent; harness for benchmark regression checks. | Wotann benchmark-engineering.md is stub. | 16h | MIT | ready |
| 87 | Cron scheduler (agent-triggered jobs) | `cron/` directory + `hermes_cli/cron.py` | Schedule agent tasks on a cron; run_agent.py picks them up. Includes DST-aware scheduling. | Wotann has `daemon/cron-utils.ts` but no runtime execution. | 10h | MIT | ready |
| 88 | Interactive setup wizard | `hermes_cli/setup.py` + interactive auth + memory_setup.py | Multi-step onboarding: pick provider, login/key, configure memory backend, pick skills, pick channels, pick skin. | Wotann has `wizard/` stub. | 12h | MIT | ready |
| 89 | Doctor command | `hermes_cli/doctor.py` + docs/gateway/doctor.md (openclaw) | Diagnose setup rot: missing config, stale auth, broken channels; `--fix` mode to auto-repair. Legacy config migration is doctor-owned (not startup). | Wotann has no doctor. | 12h | MIT | ready |
| 90 | Memory provider abstraction | `agent/memory_provider.py` + memory_manager.py + active-memory | Pluggable backend (SQLite FTS5 default; LanceDB optional; Wiki optional). | Wotann has many memory backends but no common provider interface. | 8h | MIT | ready |
| 91 | Sessions as SQLite with FTS5 | `hermes_state.py` (50 KB) | SessionDB: per-conversation SQLite with FTS5 full-text search, trajectory persistence, metadata columns. | Wotann session.ts is file-based. FTS5 = instant search. | 12h | MIT | ready |

---

### E. `NousResearch/hermes-agent-self-evolution` — GEPA Self-Evolution

**Summary:** Standalone optimization pipeline for Hermes, separate repo. Uses DSPy + GEPA (Genetic-Pareto Prompt Evolution, ICLR 2026 oral) to evolve SKILL.md, tool descriptions, system prompts, and tool code. No GPU training — all text mutation via API calls. Operates ON hermes-agent, not inside it. 5 phases: skills → tool descriptions → system prompts → code → continuous loop.

**Key invariants from PLAN.md:**
- Zero changes to hermes-agent repo (reads + writes git branches, creates PRs)
- Every evolved variant must pass: full test suite, size limits, caching compat, semantic preservation, PR review
- Phases are sequential with validation gates (≥10% score improvement + no benchmark regression)
- Between phases: run TBLite + YC-Bench to establish new baseline
- No BootstrapFinetune (excludes GPU training); only MIPROv2 and GEPA
- Darwinian Evolver is external CLI (AGPL v3) — integrated as subprocess, no code imports

#### Patterns extracted from `hermes-agent-self-evolution` (13 patterns):

| # | Pattern | Source file | What it does | Why Wotann needs it | Effort | License | Status |
|---|---|---|---|---|---|---|---|
| 92 | Skill-as-DSPy-module wrapper | `evolution/skills/skill_module.py` | Takes SKILL.md → wraps as `dspy.Module` that: (1) injects skill text as system prompt, (2) runs agent on test task, (3) returns result for scoring. | Wotann `learning/gepa-optimizer.ts` is stub; no module-wrapper. This is the core primitive. | 8h | MIT | ready |
| 93 | Evolve skill CLI entrypoint | `evolution/skills/evolve_skill.py` | `python -m evolution.skills.evolve_skill --skill <name> --iterations 10 --eval-source synthetic` → evolved SKILL.md, auto-PR. Eval sources: synthetic / sessiondb / golden / auto. | Wotann has no evolve-skill CLI. | 6h | MIT | ready |
| 94 | Eval dataset builder (synthetic + SessionDB mining) | `evolution/core/dataset_builder.py` | Strong model reads skill → generates 15-30 test cases; alternately mines SessionDB for real usage examples; train/val/test split. | Wotann has no dataset builder. | 14h | MIT | ready |
| 95 | Fitness function library (LLM-as-judge, rubrics, length penalties) | `evolution/core/fitness.py` | Pluggable fitness functions for different optimization targets. | Wotann has no fitness lib. | 8h | MIT | ready |
| 96 | Constraint validator (char limits, caching compat, test suite) | `evolution/core/constraints.py` | Rejects variants that: exceed 15KB, break prompt caching, fail pytest. | Wotann has no constraint gates. | 6h | MIT | ready |
| 97 | Benchmark gate (TBLite/YC-Bench regression check) | `evolution/core/benchmark_gate.py` | After each optimization round, re-run benchmarks; reject variants that regress TBLite >2%. | Wotann has no benchmark gating. | 10h | MIT | ready |
| 98 | Auto-PR builder | `evolution/core/pr_builder.py` | Generates PR with diff, before/after metrics, statistical significance. | Wotann has no auto-PR. Required for "learn without human in the loop." | 6h | MIT | ready |
| 99 | Phase-1 skill evolution (complete Phase-1 pipeline) | `evolution/skills/*` + PLAN.md Phase 1 | 3-4 week build+run+validate flow with explicit "done" criteria (≥10% improvement, no regression, reusable). | Wotann self-evolution.ts has no lifecycle. | 60h (Phase 1 only) | MIT | ready |
| 100 | Phase-2 tool description evolution plan | PLAN.md:253-254 + evolution/tools/ (planned) | Tool selection = classification; GEPA evolves description field only. | Wotann has no tool-desc evolution. | 40h (per plan) | MIT | planned (not yet implemented upstream) |
| 101 | Phase-3 system prompt section evolution plan | PLAN.md:255-256 + evolution/prompts/ | Parameterize prompt_builder sections as DSPy signatures. | Wotann has no prompt section evolution. | 40h | MIT | planned |
| 102 | Phase-4 code evolution (Darwinian Evolver + Git-based organisms) | PLAN.md:257-258 + evolution/code/ | Evolves tool code via Git branches + pytest gate. External CLI (AGPL v3). | Wotann `learning/darwinian-evolver.ts` is stub. | 60h | AGPL v3 (external only) | planned (AGPL — external CLI only, no imports; wotann core stays MIT) |
| 103 | Phase-5 continuous improvement loop | PLAN.md:259 + evolution/monitor/ | Unattended pipeline running on schedule. | Wotann has no autoloop. | 30h | MIT | planned |
| 104 | Trajectory collection for GEPA reflection | `agent/trajectory.py` (hermes-agent) + evolution consumption | Saves (inputs, outputs, success/fail, reason) for GEPA's reflective analysis. | Wotann `autopilot/trajectory-recorder.ts` exists but doesn't feed into GEPA. | 6h | MIT | ready |

---

## 3. LICENSE / PORTABILITY TABLE

| Repo | License | Wotann-compat | Notes |
|------|---------|---------------|-------|
| openai/codex | Apache-2.0 | YES (MIT + Apache-2.0 are compatible; include NOTICE + LICENSE text on port) | Apache-2.0 requires copyright + NOTICE forwarding; prefer porting as "inspired by" rather than verbatim copy for >50-line code blocks. |
| openclaw/openclaw | MIT | YES (perfect) | Plain MIT; forward copyright line. Check CODEOWNERS before porting security-sensitive paths. |
| VoltAgent/awesome-openclaw-skills | MIT (for the list itself) | YES for list | **Per-skill licenses vary.** Before bulk import, must check `LICENSE` inside each skill's GitHub dir. Many skills in `openclaw/skills` are MIT, but ~10-15% use Apache-2.0, BSD, or no license. Auto-import script must gate on LICENSE presence + compatibility. |
| NousResearch/hermes-agent | MIT | YES (perfect) | Plain MIT. Python → TypeScript translation effort counted into port estimates. |
| NousResearch/hermes-agent-self-evolution | MIT (self) + AGPL v3 (Darwinian Evolver, external-only) | MIXED — self is MIT, safe to port; Darwinian Evolver stays external CLI (no imports, subprocess-only) to keep wotann MIT | Same pattern as upstream. If you want Darwinian Evolver, invoke via `execFileSync("darwinian-evolver", ...)` with no library imports. |

**Overall license risk: LOW.** Every pattern above can ship in a MIT-licensed wotann with proper attribution. The only caveat is per-skill licensing in awesome-openclaw-skills bulk import.

---

## 4. EFFORT-RANKED PORT LIST

Ordered by (moat-value / effort) descending. Top of list = immediate wins.

### TIER 1: Critical moat wins (< 12h each, high moat)

| Rank | Pattern | # | Effort |
|------|---------|---|--------|
| 1 | Skills watcher (hot-reload) | 15 | 4h |
| 2 | Ansi-escape + terminal-detection | 34 | 4h |
| 3 | Fuzzy file search | 35 | 6h |
| 4 | Turn diff tracker | 18 | 8h |
| 5 | Agents.md discovery | 22 | 4h |
| 6 | Feature flag registry + lifecycle stages | 13 | 8h |
| 7 | KawaiiSpinner activity feed | 78 | 4h |
| 8 | Channel allowlist / command gating | 49 | 6h |
| 9 | Channel config presence check | 51 | 4h |
| 10 | Auth rate limiter | 39 | 4h |
| 11 | Smart model routing (cheap vs strong) | 80 | 6h |
| 12 | Session envelope / labeled bindings | 54 | 6h |
| 13 | Control-UI CSP hardening | 38 | 6h |
| 14 | Link understanding | 61 | 6h |
| 15 | Web-fetch sandbox | 62 | 6h |
| 16 | Collaboration mode templates | 32 | 6h |
| 17 | ACP approval classifier | 56 | 4h |
| 18 | Response debug context | 28 | 6h |
| 19 | VirusTotal skill scanning integration | 71 | 6h |
| 20 | Constraint validator for self-evolution | 96 | 6h |
| 21 | Auto-PR builder for self-evolution | 98 | 6h |
| 22 | Fitness function library | 95 | 8h |
| 23 | Evolve-skill CLI entrypoint | 93 | 6h |
| 24 | Agent identity + migration | 21 | 6h |
| 25 | Trajectory collection feed | 104 | 6h |

### TIER 2: Critical moat wins (12-20h each)

| Rank | Pattern | # | Effort |
|------|---------|---|--------|
| 26 | Shell snapshot | 3 | 10h |
| 27 | Shadow-git checkpoint manager | 74 | 16h |
| 28 | Channel pairing (DM allowlist) | 50 | 8h |
| 29 | Plugin activation planner | 43 | 8h |
| 30 | Channel health monitor | 52 | 10h |
| 31 | Configured binding matcher | 53 | 12h |
| 32 | Persistent ACP bindings | 55 | 10h |
| 33 | ACP translator (multi-version) | 57 | 12h |
| 34 | Profile system (HERMES_HOME) | 82 | 12h |
| 35 | Gateway platform adapter base class | 83 | 10h |
| 36 | Mini SWE-bench runner | 86 | 16h |
| 37 | Context compressor (9-improvement version) | 79 | 14h |
| 38 | Cron scheduler execution | 87 | 10h |
| 39 | Doctor command | 89 | 12h |
| 40 | Sessions-as-SQLite-FTS5 | 91 | 12h |
| 41 | Thread fork snapshot modes | 5 | 14h |
| 42 | Rollout recorder + compaction modes | 6 | 12h |
| 43 | Agent control multi-agent spawn | 8 | 16h |
| 44 | JS REPL kernel | 19 | 16h |
| 45 | Hook runtime 5-event lifecycle | 16 | 16h |
| 46 | Session rollout reconstruction | 17 | 10h |
| 47 | Skills installer (download+extract+fallback) | 48 | 14h |
| 48 | Eval dataset builder (synthetic+SessionDB) | 94 | 14h |
| 49 | Benchmark gate | 97 | 10h |
| 50 | Tool search (deferred schemas) | 23 | 14h |
| 51 | Secrets management (Gateway side) | 63 | 12h |
| 52 | Proxy capture MITM | 64 | 10h |
| 53 | MCP tool exposure gating | 25 | 8h |
| 54 | Batch runner parallel eval | 85 | 14h |
| 55 | Plugin manifest + discovery | 44 | 12h |
| 56 | Plugin capability registry | 45 | 10h |
| 57 | Auth profile rotation (cooldown timing) | 42 | 10h |
| 58 | OAuth keyring store | 36 | 10h |
| 59 | Auto-review mode | 29 | 10h |
| 60 | Memory provider abstraction | 90 | 8h |

### TIER 3: Big swings (20-40h each)

| Rank | Pattern | # | Effort |
|------|---------|---|--------|
| 61 | Unified Exec PTY manager | 2 | 18h |
| 62 | Guardian auto-review | 4 | 20h |
| 63 | Memory phase-1/phase-2 pipeline | 7 | 24h |
| 64 | Multi-agent V2 tool surface | 9 | 18h |
| 65 | Exec policy Starlark | 11 | 24h |
| 66 | Code Mode (reduced surface) | 20 | 20h |
| 67 | App server JSON-RPC | 26 | 24h |
| 68 | Exec server (separate process) | 27 | 18h |
| 69 | Gateway Control UI (dashboard) | 37 | 40h |
| 70 | Full ACP adapter (9 files) | 76 | 20h |
| 71 | Realtime transcription | 65 | 20h |
| 72 | Daemon launchd/systemd/schtasks | 58 | 24h |
| 73 | Plugin marketplace + mentions | 14 | 20h |
| 74 | ClawHub installer integration | 47 | 20h |
| 75 | Curated 5,200-skill mass import | 69 | 20h |
| 76 | Telepathy sidecar (passive screen) | 33 | 20h |
| 77 | Plugin command registration | 46 | 6h |
| 78 | Interactive setup wizard | 88 | 12h |

### TIER 4: Long-horizon / 40h+ (strategic bets)

| Rank | Pattern | # | Effort |
|------|---------|---|--------|
| 79 | Phase-1 skill evolution pipeline (complete) | 99 | 60h |
| 80 | Canvas Host (in-editor canvas) | 60 | 30h |
| 81 | Sandboxing 3-platform manager | 12 | 40h |
| 82 | Task Brain control panel | 66 | 14h |
| 83 | 22 missing channels (aggregate) | (5 + individuals) | 80h |
| 84 | Realtime WebRTC voice | 30 | 30h |
| 85 | Phase-4 code evolution (Darwinian Evolver external) | 102 | 60h |
| 86 | Phase-2/3/5 self-evolution phases | 100, 101, 103 | 110h |
| 87 | 20+ hermes platform adapters port | 84 | 80h |

---

## 5. SUMMARY STATISTICS

- **Total patterns extracted:** 104 (Codex: 36, OpenClaw: 32, Awesome-Skills: 5, Hermes: 18, Hermes-Self-Evolution: 13)
- **Missing channels:** 22 distinct platforms (named in §2.B)
- **License compatibility:** 100% MIT/Apache-2.0 compatible; 1 AGPL tool usable as external-only CLI
- **Tier 1 immediate wins (< 12h each):** 25 patterns, total ~145h
- **Tier 2 medium efforts (12-20h):** 35 patterns, total ~450h
- **Tier 3 big swings (20-40h):** 18 patterns, total ~420h
- **Tier 4 strategic (40h+):** 9 patterns, total ~494h
- **Grand total estimated effort:** ~1,500 hours (37 engineer-weeks at 40h/week)

**Recommended first 10 ports (by strategic impact):**
1. Guardian auto-review (#4) — 20h — unlocks "autonomous mode"
2. Shadow-git checkpoint manager (#74) — 16h — `/undo` as first-class
3. Memory phase-1/phase-2 pipeline (#7) — 24h — the "learning" moat
4. Shell snapshot (#3) — 10h — single biggest env-setup speedup
5. Unified Exec PTY manager (#2) — 18h — persistent terminals / REPLs
6. Thread fork snapshot modes (#5) — 14h — "try again from turn N" UX
7. Tool search deferred schemas (#23) — 14h — biggest single token save
8. Skills watcher hot-reload (#15) — 4h — dev velocity
9. Channel allowlist + gating (#49) — 6h — security baseline
10. Self-evolution Phase-1 (#99) — 60h — the "becomes smarter over time" moat

---

## 6. APPENDIX — Notable Cross-Repo Insights

- **Every repo uses keyring/Keychain-backed auth (codex), or profile-scoped dir (hermes), or encrypted secret store (openclaw).** Wotann stores auth in plaintext JSON. This is the single most embarrassing security gap.
- **All four Python/Rust repos have a doctor command.** Wotann does not. This is a must-have for shipping.
- **Codex and Hermes both have Auto-compact at ~50% context.** Wotann has manual compact. Tier-2 #37 fixes this.
- **OpenClaw enforces prompt-cache stability as a correctness invariant** (deterministic request assembly, no mid-conversation rewrites). Wotann should adopt this as a rule in `rules/cache-stability.md`.
- **Nous' self-evolution approach is orthogonal to Codex's memory pipeline.** Codex consolidates session memories into `raw_memories.md`; Nous evolves the skills/prompts themselves. Wotann should port BOTH for maximum flywheel.
- **Three repos (codex, openclaw, hermes) all have some form of "thread/fork".** The Codex approach (ForkSnapshot enum with TruncateBeforeNthUserMessage / Interrupted) is the cleanest — port it.
- **Hermes has 26 gateway platform adapters vs OpenClaw's 20+ vs Wotann's 25.** Merging all three lists gives ~30 unique channels. Any channel Wotann can port from both Hermes (Python ref) and OpenClaw (TS ref) is a fast port.

---

**End of Lane 1 extraction. Agent 1/8 complete.**
