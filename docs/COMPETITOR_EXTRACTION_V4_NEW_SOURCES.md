# Competitor Extraction V4 — New Sources

> Deep read of 5 new / updated external repos, cross-checked against `docs/WOTANN_INVENTORY.md` (HEAD `aaf7ec2`), `docs/COMPETITOR_EXTRACTION_LANE{1..8}.md`, and `docs/UNKNOWN_UNKNOWNS.md`.
> Scope: 5 fresh clones in `research/__new_clones_v3/`. Every pattern port cites a file:line anchor; every license claim is verified against `gh repo view`.
> Generated 2026-04-19. Sources: t3code, omi (updated), evolver (updated), paperless-ngx, Claude-Code-Game-Studios.

---

## 0. License & Portability Gate

| Source | License | Verdict | Source of truth |
|---|---|---|---|
| **pingdotgg/t3code** | MIT | Direct port OK with attribution | `gh repo view pingdotgg/t3code` licenseInfo.key=`mit` |
| **BasedHardware/omi** (v2) | MIT | Direct port OK with attribution | `gh repo view BasedHardware/omi` licenseInfo.key=`mit` |
| **EvoMap/evolver** (v2) | GPL-3.0 | **Inspection only — no port** | `gh repo view EvoMap/evolver` licenseInfo.key=`gpl-3.0` + upstream README 2026-03 notice that future releases move to source-available |
| **paperless-ngx/paperless-ngx** | GPL-3.0 | **Inspection only — no port** | `gh repo view paperless-ngx/paperless-ngx` licenseInfo.key=`gpl-3.0` |
| **Donchitos/Claude-Code-Game-Studios** | MIT | Direct port OK with attribution | `gh repo view Donchitos/Claude-Code-Game-Studios` licenseInfo.key=`mit` |

Rule applied throughout this document: for GPL-3.0 sources, extractions are **pattern-level only** — the upstream code may not be copy-pasted or adapted line-for-line. We document the structural idea, then WOTANN must reimplement independently. For MIT sources, direct ports are acceptable with `LICENSE` attribution in the copied file header.

All star counts and metadata are live readings on 2026-04-19 via `gh repo view --json`. No numbers are estimated.

---

## 1. pingdotgg/t3code — Theo Browne's Codex/Claude GUI

### 1.1 Overview

| Field | Value |
|---|---|
| Description | "T3 Code is a minimal web GUI for using coding agents like Codex and Claude." |
| Created | 2026-02-08 |
| Pushed (HEAD) | 2026-04-19T18:31:06Z |
| Stars | 9,803 |
| License | MIT |
| Primary language | TypeScript |
| Top-level layout | `apps/{server, web, desktop, marketing}` + `packages/{contracts, client-runtime, effect-acp, shared}` — **Bun/Node + Effect 4.0-beta monorepo** |
| Source files (.ts/.tsx/.js/.jsx/.mjs, excl. node_modules) | 852 |
| Source LOC | 227,457 |
| Git history | single commit (shallow `--depth=1`) |

**README summary** (`research/__new_clones_v3/t3code/README.md`): installable via `npx t3`, Homebrew, winget, AUR. Supports Codex CLI + Claude Code (ACP peers). Warns "VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged." Core invariants (`AGENTS.md:9-16`): performance first, reliability first, predictable under session restarts/reconnects/partial streams.

### 1.2 Architecture

Four-app monorepo with Effect Services + Layers architecture:

| Module | Path | LOC | Role |
|---|---|---|---|
| Server entry | `apps/server/src/server.ts` | 701 wired + 4,015 test | Bootstraps all Effect Services via Layer composition |
| Codex adapter | `apps/server/src/provider/Layers/CodexAdapter.ts` | 1,639 | Wraps `codex app-server` subprocess JSON-RPC |
| Claude adapter | `apps/server/src/provider/Layers/ClaudeAdapter.ts` | 3,217 | Wraps `claude-code-acp` subprocess ACP peer |
| Cursor adapter | `apps/server/src/provider/Layers/CursorAdapter.ts` | — (new) | Third provider via ACP |
| OpenCode adapter | `apps/server/src/provider/Layers/OpenCodeAdapter.ts` | 1,344 | Fourth provider |
| CodexAppServerManager | `apps/server/src/codexAppServerManager.ts` | 1,632 | Orchestrates `codex app-server` subprocess + JSON-RPC dispatch + approval/user-input pipelines |
| Terminal Manager | `apps/server/src/terminal/Layers/Manager.ts` | 1,915 | PTY sessions via node-pty with history-line-limit, debounce persist, subprocess-check, env blocklist |
| ProjectionPipeline | `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` | 1,477 | CQRS event-sourcing; 9 projectors (projects / threads / thread-messages / turns / approvals / …) |
| ProjectionSnapshotQuery | `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` | 1,434 | Read-side query API over projection tables (SQLite via @effect/sql-sqlite-bun) |
| Provider Registry | `apps/server/src/provider/Layers/ProviderRegistry.ts` | — | Registers 4 adapters, manages session directory, reaper for stale sessions |
| Contracts | `packages/contracts/src/**` | 25 files | Effect Schema defs for RPC, orchestration, provider, terminal, project, server, auth — **zero runtime** |
| Shared runtime | `packages/shared/src/**` | ~20 files | `KeyedCoalescingWorker`, `Struct`, `path`, `serverSettings`, `cliArgs`, `qrCode` — subpath-exports only, no barrel |
| effect-acp | `packages/effect-acp/src/**` | 8 files + generated | Effect wrapper around Zed's ACP protocol — `agent.ts`, `client.ts`, `protocol.ts`, `terminal.ts`, `errors.ts`, stdio adapter, code-generation from schemas |

The top-10 largest files are all tests (2,280-4,015 LOC), indicating heavy behavioral coverage. Excluding tests, the 10 largest real modules are `ClaudeAdapter.ts` (3,217), `GitCore.ts` (2,206), `Manager.ts` (terminal, 1,915), `GitManager.ts` (1,734), `CodexAdapter.ts` (1,639), `codexAppServerManager.ts` (1,632), `ProviderRuntimeIngestion.ts` (1,572), `ProjectionPipeline.ts` (1,477), `ProjectionSnapshotQuery.ts` (1,434), `OpenCodeAdapter.ts` (1,344).

### 1.3 Unique patterns (cross-check against WOTANN)

1. **Provider-as-subprocess with JSON-RPC over stdio**
   - Anchor: `apps/server/src/codexAppServerManager.ts:1-140` — spawns `codex app-server` child process, wires readline to a PendingRequest map for correlation, tracks `pendingApprovals` and `pendingUserInputs` as separate Maps keyed by `ApprovalRequestId` and `jsonRpcId`, with per-request timeout + resolve/reject.
   - **WOTANN has**: `src/core/claude-sdk-bridge.ts` (ORPHAN, 178 LOC), `src/acp/stdio.ts` (wired), `src/acp/runtime-handlers.ts` (wired), `src/daemon/kairos-rpc.ts` (5,375 LOC — the biggest file). The WOTANN path uses in-process `core/runtime.ts` (4,843 LOC) as the composition root instead of a subprocess-based provider harness.
   - **Gap**: WOTANN never spawns an external `codex app-server` / `claude-code-acp` subprocess as a peer. The benefit of the t3code pattern is isolation — a crashed provider does not take down the harness, and upgrading the provider is a matter of replacing the binary. This directly addresses the `anthropic-subscription.ts` fragility seen in Session-10 audits (ref `docs/MASTER_PLAN_SESSION_10_ADDENDUM.md`).

2. **Effect Service + Layer architecture everywhere**
   - Anchor: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:31-44` — 9 Live layers composed into one ProjectionPipeline via `Layer.mergeAll`. Every service has a `Services/` interface file and a `Layers/` implementation file.
   - **WOTANN has**: none. Middleware is composed procedurally in `src/middleware/pipeline.ts`; providers are registered through a switch statement in `src/providers/registry.ts:51-367`.
   - **Gap**: Effect's Layer system gives deterministic initialization order, Fiber-based cancellation, and declarative dependency injection. The type-system cost (every service returns `Effect.Effect<A, E, R>` where R is the dep list) is nontrivial but yields extraordinary test ergonomics — see 2,949-LOC `ProviderRuntimeIngestion.test.ts`. For WOTANN this is a "port-if-maintainability-bites" decision, not a pain-point right now.

3. **CQRS event-projection pipeline for agent state**
   - Anchor: `apps/server/src/orchestration/Layers/ProjectionPipeline.ts:52-62` — `ORCHESTRATION_PROJECTOR_NAMES` enumerates 9 projectors: `projects`, `threads`, `thread-messages`, `thread-proposed-plans`, `thread-activities`, `thread-sessions`, `thread-turns`, `checkpoints`, `pending-approvals`. Every provider event is projected into each repository.
   - **WOTANN has**: append-only memory under `src/memory/store.ts` (1,994 LOC, 21 imports-in — top-5 hub) and `src/memory/atomic-memory.ts`; checkpoint logic in `src/autopilot/checkpoint.ts` (ORPHAN, 290 LOC) and `src/core/runtime.ts`. No multi-projection CQRS separation.
   - **Gap**: the read-side separation means that expensive projections (pending approvals, thread activity) can be materialized once and queried cheaply, rather than recomputed per render. Relevant for WOTANN's 74 CLI commands + 134 Desktop GUI views where `thread-sessions` state is polled.

4. **KeyedCoalescingWorker — latest-wins per-key queue**
   - Anchor: `packages/shared/src/KeyedCoalescingWorker.ts:1-70` — enqueue a value for a key; if there is already a queued value for that key, the `merge(current, next)` reducer collapses them; `drainKey` resolves only when the key has no queued/pending/active work. Used by `apps/server/src/terminal/Layers/Manager.ts:9,49` to debounce terminal persist writes.
   - **WOTANN has**: nothing comparable. `src/providers/circuit-breaker.ts`, `src/providers/retry-strategies.ts` handle failure cases but not coalescing writes. `src/telemetry/cost-tracker.ts` has debouncing logic inline.
   - **Gap**: for WOTANN's `desktop-app/src/components/chat/` streaming + token-cost updates, this pattern eliminates thrash; critical for 74-command TUI where output rendering can outrace the event loop.

5. **Contracts package with zero runtime**
   - Anchor: `packages/contracts/src/orchestration.ts:1-100` — Schema.Literals unions for `ProviderKind = "codex" | "claudeAgent" | "cursor" | "opencode"`, `ProviderApprovalPolicy`, `ProviderSandboxMode`, `RuntimeMode`, `ProviderInteractionMode`. Both server and web import the same schemas; AGENTS.md line 22 says "Keep this package schema-only — no runtime logic."
   - **WOTANN has**: types scattered across `src/core/types.ts` (250 LOC, 62 imports-in — #1 hub), `src/providers/types.ts` (124 LOC), `src/channels/channel-types.ts`, `src/middleware/types.ts`, `src/autopilot/types.ts`, `src/desktop/types.ts`. No single contracts barrel.
   - **Gap**: a separate `@wotann/contracts` package would let desktop-app, iOS (via Swift codegen), and CLI share one schema source. Currently WOTANN has types spread across 7+ type-only modules. This is pre-existing tech debt flagged in `docs/DOCS_FULL_READ_SYNTHESIS_2026-04-18.md`.

6. **Hard limits on send-turn**
   - Anchor: `packages/contracts/src/orchestration.ts:110-114` — `PROVIDER_SEND_TURN_MAX_INPUT_CHARS = 120_000`, `PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8`, `PROVIDER_SEND_TURN_MAX_IMAGE_BYTES = 10 * 1024 * 1024`, `PROVIDER_SEND_TURN_MAX_IMAGE_DATA_URL_CHARS = 14_000_000`. Enforced before subprocess dispatch.
   - **WOTANN has**: `src/context/limits.ts` (722 LOC, 12 imports-in) has model-context limits, but not input-size hard caps on attachments.
   - **Gap**: attachment-based DoS is an unhandled surface. Adding constants + check in the Runtime input would mirror this.

7. **Approval-required / auto-accept / full-access runtime modes**
   - Anchor: `packages/contracts/src/orchestration.ts:86-91` — `RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access"`; `DEFAULT_RUNTIME_MODE = "full-access"`; per-provider `ProviderApprovalPolicy = "untrusted" | "on-failure" | "on-request" | "never"`; per-provider `ProviderSandboxMode = "read-only" | "workspace-write" | "danger-full-access"`.
   - **WOTANN has**: `src/core/mode-cycling.ts` (306 LOC, 10 imports-in) handles mode state; `src/sandbox/approval-rules.ts` (ORPHAN, 228 LOC) defines rules but is not consumed from production code.
   - **Gap**: mode-cycling ↔ approval-rules wiring is missing — the approval policies should be orchestrated from mode-cycling rather than defined as separate orphan logic.

### 1.4 Port priority (top 5)

| # | Pattern | Effort | Source anchor | WOTANN target | Acceptance criteria |
|---|---|---|---|---|---|
| 1 | Provider-as-subprocess wrapper for 3rd-party agents (codex/claude-code-acp/cursor/opencode) | **L** | `apps/server/src/codexAppServerManager.ts:1-140`, `apps/server/src/provider/Layers/ClaudeAdapter.ts:1-200` | New `src/providers/subprocess-adapter.ts` + fix the orphan `src/core/claude-sdk-bridge.ts` | Spawning a subprocess provider, sending a turn, and seeing streamed tool_use + text_delta events arrive over JSON-RPC stdio; survives provider crash with automatic reaper. |
| 2 | `PROVIDER_SEND_TURN_MAX_*` hard limits | **S** | `packages/contracts/src/orchestration.ts:110-114` | Append to `src/core/types.ts` + gate in `src/core/runtime.ts` input pipeline | 120k chars / 8 attachments / 10 MB image hard-fails with a typed error before provider dispatch; test in `tests/core/` asserts 121k input rejected. |
| 3 | KeyedCoalescingWorker for streaming event coalescing | **M** | `packages/shared/src/KeyedCoalescingWorker.ts:1-70` | New `src/utils/coalescing-worker.ts` | Given 100 enqueues for the same key in 50 ms, `process()` is called once with the merged value; `drainKey` awaits completion; no dangling references in `activeKeys`/`queuedKeys` state. |
| 4 | Wire `src/sandbox/approval-rules.ts` (orphan) into `src/core/mode-cycling.ts` | **S** | `packages/contracts/src/orchestration.ts:86-91` | `src/core/mode-cycling.ts` + `src/sandbox/approval-rules.ts` | `approval-rules.ts` has imports_in at least 1 after wiring; integration test asserts mode=`approval-required` routes approvals through the rules module; mode=`full-access` skips it. |
| 5 | Terminal session manager with history-line-limit + debounce-persist + subprocess-kill-grace | **M** | `apps/server/src/terminal/Layers/Manager.ts:48-56` | New `src/desktop/terminal-session-manager.ts` feeding `src/desktop/companion-server.ts` | Terminal output at least 5,000 lines auto-trims; persist writes debounced at 40ms; kill waits 1000ms grace before SIGKILL; 128-session cap eviction verified in test. |

### 1.5 Already-in-WOTANN check (t3code)

- **Multi-provider adapter pattern**: WOTANN has 19 providers vs t3code's 4 (codex, claude, cursor, opencode). WOTANN beats t3code on breadth but t3code's subprocess-adapter shape is orthogonal — it runs 3rd-party CLI agents rather than API vendors. *Not a duplicate.*
- **ACP protocol**: WOTANN has `src/acp/{protocol.ts,runtime-handlers.ts,server.ts,stdio.ts,thread-handlers.ts}` — 5 files, `src/acp/protocol.ts` is 290 LOC with 5 imports-in. `src/acp/thread-handlers.ts` is ORPHAN. t3code's `packages/effect-acp/` is more mature (includes code generation from upstream schemas). *Partial overlap — t3code's gen approach is stronger.*
- **Session reaper**: WOTANN has nothing equivalent to t3code's `ProviderSessionReaper.ts`. *Gap.*

---

## 2. BasedHardware/omi (updated v2)

### 2.1 Overview

| Field | Value |
|---|---|
| Description | "AI that sees your screen, listens to your conversations and tells you what to do" |
| Created | 2024-03-22 |
| Pushed (HEAD `9b69ad2`) | 2026-04-19T15:44:34Z |
| Prior clone HEAD (on disk, `research/omi/`) | `e55ee65` 2026-04-18 |
| Stars | 11,019 |
| License | MIT |
| Primary language | Dart |
| Source files (Dart/Py/Swift/Kt/TS/JS/TSX, excl. node_modules/build) | 2,157 |
| Monorepo apps | `app/` (Flutter), `backend/` (Python FastAPI), `desktop/` (Swift + Rust + TS), `ios/`, `omi/` (firmware), `omiGlass/`, `mcp/`, `plugins/`, `sdks/`, `web/` |

### 2.2 New since Lane 4 (Apr 18 → Apr 19)

Single-commit HEAD diff: `9b69ad2f6572086d7618dedfcdf919ac4d3344b6 "fix daily recap empty days and wrong action items (#6696)"`. The shallow clone shows only this one commit, but the tree itself has expanded substantially vs the Lane 4 snapshot:

**Major surface in v2 that Lane 4 did not emphasize:**

| Surface | Path | LOC |
|---|---|---|
| **acp-bridge** — JSON-lines protocol between Swift desktop app and a Node.js ACP peer wrapping `@zed-industries/claude-agent-acp@0.18.0` | `desktop/acp-bridge/src/*.ts` | 7 files, roughly 800 total |
| **agent-cloud** — Claude Code SDK on a remote VM for the Omi Agent feature | `desktop/agent-cloud/agent.mjs` | 1 file |
| **Backend-Rust** — Rust replica of the Python backend's critical paths (`services/firestore.rs` alone is 9,763 LOC) | `desktop/Backend-Rust/src/*.rs` | 15+ modules, 28,882 total |
| **Backend encryption in Rust** | `desktop/Backend-Rust/src/encryption.rs` | HKDF-SHA256-derived per-user key then AES-256-GCM, base64-encoded nonce concatenated with ciphertext — bit-for-bit compatible with Python backend `utils/encryption.py` |
| **Auth-Python** | `desktop/Auth-Python/` | New OAuth broker |
| **VAD gate unit tests** | `backend/tests/unit/test_vad_gate.py` | 2,065 LOC test (!) |
| **sync-v2 tests**, **desktop-migration tests**, **lock-bypass-fix tests** | `backend/tests/unit/test_{sync_v2,desktop_migration,lock_bypass_fixes}.py` | 4,766 LOC combined |

### 2.3 Architecture highlights

**Encryption** (`desktop/Backend-Rust/src/encryption.rs:62-98`):
```
derive_key(master_secret, uid) = HKDF-SHA256(salt=uid.bytes, info=b"user-data-encryption") produces 32B
encrypt(data, uid, master_secret) returns base64(12B nonce followed by AES-256-GCM(key, data) followed by 16B auth_tag)
```
Matches the Python `encryption.encrypt(data, uid)` contract. Has explicit `EncryptionError` + `DecryptionError` enums with `InvalidBase64 / PayloadTooShort / DecryptionFailed / InvalidUtf8` cases.

**ACP-bridge** (`desktop/acp-bridge/src/index.ts:1-48`):
- Spawns `claude-code-acp` as subprocess (JSON-RPC over stdio).
- Creates Unix socket server for `omi-tools` relay (`omiToolsPipePath`, `omiToolsClients: Socket[]`).
- `warmup`/`query`/`stop`/`interrupt`/`invalidate_session`/`authenticate` inbound messages (7 types).
- `init`/`text_delta`/`tool_use`/`auth_required`/`thinking`/`error`/`result` outbound.
- **Session lifecycle**: `warmup` applies system prompt once via `session/new`; `query` reuses session (systemPrompt ignored); cwd change means session is invalidated and a new `session/new` is created.
- **Token-count semantics documented inline** (`index.ts:15-19`): "session/prompt drives one or more internal Anthropic API calls (initial response + one per tool-use round). The usage returned in the result is the AGGREGATE across all those rounds. There are no separate sub-agents."

**Session manager** (`desktop/acp-bridge/src/session-manager.ts:21-70`):
- `resolveSession(sessions, sessionKey, requestedCwd)` — invalidates on cwd mismatch.
- `needsModelUpdate(existing, requested)` — triggers per-session model override.
- `filterSessionsToWarm(sessions, configs)` — only warms keys not yet in the map.
- `getRetryDeleteKey(sessionKey)` — documented bug-fix: retry deletion keys on sessionKey not model; this is the exact bug/fix pair the file is testing for.

### 2.4 Unique patterns (cross-check against WOTANN)

1. **Port-of-Python-to-Rust-for-perf/safety** (`desktop/Backend-Rust/src/encryption.rs`, `routes/proxy.rs` 1,224 LOC, `llm/client.rs` 1,189 LOC)
   - **WOTANN has**: Tauri Rust shell (`desktop-app/src-tauri/src/` — 17 files, sidecar/ipc/hotkeys only, no business logic). No parallel Rust backend.
   - **Gap**: omi ported its entire Firebase/Firestore client layer to Rust for the desktop app. For WOTANN this is not urgent since WOTANN's performance profile is different (desktop app is a reference UI, not a standalone product), but the pattern informs what the minimum-viable Rust surface looks like.

2. **Session warmup with pre-computed per-session system prompts**
   - Anchor: `desktop/acp-bridge/src/protocol.ts:44-57` — `WarmupSessionConfig { key, model, systemPrompt? }` + `WarmupMessage { sessions?: WarmupSessionConfig[] }`.
   - **WOTANN has**: `src/providers/prompt-cache-warmup.ts` (ORPHAN, 315 LOC) which is orphan — imports_in = 0. This is a false-claim area (cache warming exists on disk but is not wired).
   - **Gap**: wire `prompt-cache-warmup.ts` into daemon startup. The omi pattern confirms the value: warming multiple sessions concurrently with different system prompts is the right abstraction.

3. **Agent Client Protocol with `@zed-industries/claude-agent-acp`**
   - Anchor: `desktop/acp-bridge/package.json:14` — depends on `@zed-industries/claude-agent-acp@^0.18.0` + `@playwright/mcp@^0.0.68`.
   - **WOTANN has**: its own `src/acp/` implementation (5 files, 290 LOC `protocol.ts`).
   - **Gap**: WOTANN reimplemented ACP rather than depending on the Zed SDK. For ACP protocol drift, depending on upstream is safer. Decision trade-off documented for future port.

4. **Unix-socket-based tool-call relay between provider subprocess and host app**
   - Anchor: `desktop/acp-bridge/src/index.ts:80-100` — `pendingToolCalls: Map<string, {resolve(result: string)}>` with callId correlation, async `resolveToolCall(msg)` pattern.
   - **WOTANN has**: nothing for cross-process tool relay. `src/tools/` is all in-process.
   - **Gap**: for Desktop Control / computer-use (`src/computer-use/`), running tools out-of-process would isolate failures. Currently a WOTANN subprocess crash kills the daemon.

5. **VAD-gate test depth — 2,065 LOC for a single feature**
   - Anchor: `backend/tests/unit/test_vad_gate.py` (2,065 LOC).
   - **WOTANN has**: `src/voice/vibevoice-backend.ts` (has VAD/diariz references) + `src/voice/stt-detector.ts` (685 LOC). No dedicated VAD-gate test.
   - **Gap**: voice is listed as 5 test-less WIRED files in `docs/WOTANN_INVENTORY.md:297`. Investing 1 test-file at omi's depth would cover most of it.

6. **`test-preflight.sh` + `test.sh` per-module gating**
   - Anchor: `backend/test-preflight.sh`, `backend/test.sh`, `app/test.sh`.
   - **WOTANN has**: `npm test` (Vitest). No environment preflight.
   - **Gap**: a preflight script that verifies required env vars/binaries (redis, tesseract, etc.) before running tests is a standard omi pattern worth borrowing for WOTANN's channels and provider adapters.

### 2.5 Port priority (top 5 — omi-v2 specific)

| # | Pattern | Effort | Source anchor | WOTANN target | Acceptance criteria |
|---|---|---|---|---|---|
| 1 | Wire `src/providers/prompt-cache-warmup.ts` into daemon startup with per-session system prompts | **M** | `desktop/acp-bridge/src/protocol.ts:44-57`, `desktop/acp-bridge/src/session-manager.ts:55-62` | `src/daemon/kairos.ts`, `src/providers/prompt-cache-warmup.ts` | imports_in on prompt-cache-warmup.ts at least 1; daemon warms N configured sessions concurrently; orphan count drops by 1. |
| 2 | AES-256-GCM + HKDF per-user encryption for session state + memory | **M** | `desktop/Backend-Rust/src/encryption.rs:62-98` | New `src/security/user-encryption.ts` (TypeScript, using `@noble/ciphers`) | Round-trip encrypt/decrypt for 10 random payloads; nonce collision test (1M nonces); payload-too-short + invalid-base64 both typed-error; key-derivation produces identical 32B from (master_secret, uid) across runs. |
| 3 | Session-map with cwd invalidation + per-session model override + key mismatch retry-fix | **S** | `desktop/acp-bridge/src/session-manager.ts:21-70` | `src/core/runtime.ts` session state + new tests in `tests/core/session-map.test.ts` | Reused session in same cwd returns same sessionId; cwd change produces new sessionId; model change triggers model-update flag; retry after failure deletes by sessionKey not by model. |
| 4 | Unix-socket tool-call relay for computer-use (isolate subprocess crashes) | **L** | `desktop/acp-bridge/src/index.ts:75-100` | `src/computer-use/` + new `src/tools/out-of-process-relay.ts` | Perception-engine runs in subprocess; parent process continues receiving events after child SIGKILL; pending-tool-call map rejects with timeout after 30s. |
| 5 | VAD-gate test depth — port the 2,065-LOC test rigor pattern to WOTANN voice stack | **M** | `backend/tests/unit/test_vad_gate.py` | `tests/voice/vad-gate.test.ts` | Cover VAD detection with 15+ acoustic edge cases (silence / breath / noise / speech / music / low-SNR); close the 5-file voice test gap in `docs/WOTANN_INVENTORY.md:297`. |

### 2.6 Already-in-WOTANN check (omi-v2)

- **Meeting pipeline**: `src/meet/{coaching-engine,meeting-pipeline,meeting-runtime,meeting-store}.ts` all present — Lane 4 ports. *Confirmed.*
- **VAD/speaker diarization in production**: omi-v2 has 2,065-LOC VAD-gate test and `backend/diarizer/`; WOTANN has 1 file `src/voice/vibevoice-backend.ts`. *Test coverage gap.*
- **AES encryption**: WOTANN's `src/mobile/secure-auth.ts` exists but doesn't use AES-256-GCM with HKDF-derived per-user keys. *Weaker crypto.*
- **ACP**: WOTANN has its own implementation; omi depends on Zed SDK. *Structural difference, not duplicate.*

---

## 3. EvoMap/evolver (updated v2)

### 3.1 Overview

| Field | Value |
|---|---|
| Description | "The GEP-Powered Self-Evolution Engine for AI Agents. Genome Evolution Protocol. | evomap.ai" |
| Created | 2026-02-01 |
| Pushed (HEAD `0b2660d` v1.69.0) | 2026-04-19T15:24:15Z |
| Prior clone HEAD (`research/evolver/`) | v1.67.4 2026-04-18 |
| Stars | 5,430 |
| License | **GPL-3.0-or-later** then future releases **moving to source-available** (2026-03 notice in README) |
| Primary language | JavaScript |
| Source files (.js/.md, excl. node_modules) | 167 |
| Source LOC | 23,726 (pure .js) |
| Entry | `index.js` — `evolver` CLI, `start`/`run`/`solidify`/`review`/`a2a:export|ingest|promote` |

**Portability verdict: INSPECTION ONLY. No code ports permitted.** All findings below are patterns to re-implement independently in WOTANN if the underlying idea is valuable.

### 3.2 New since Lane 6 (v1.67.4 then v1.69.0)

New surface not covered in Lane 6:

| Module | Path | LOC | Purpose |
|---|---|---|---|
| **ATP** (Agent Trust Protocol) | `src/atp/{index,merchantAgent,consumerAgent,defaultHandler,serviceHelper,hubClient}.js` | 6 files | New agent-to-agent market with merchant/consumer roles, capability-bound handlers, hub-mediated negotiation |
| **Proxy mailbox** | `src/proxy/{index,mailbox/store,lifecycle/manager,server/{http,routes,settings},sync/{engine,inbound,outbound},task/monitor,extensions/{dmHandler,skillUpdater,sessionHandler}}.js` | 12 files | Local JSONL mailbox with outbound sync to `evomap.ai` Hub, inbound poll, session handler, skill updater, DM handler |
| **A2A export/ingest/promote** | `scripts/a2a_{export,ingest,promote}.js` | 3 scripts | Agent-to-agent asset transfer pipeline (export, ship, ingest, promote) |
| **Canary gating** | `src/canary.js` | New top-level | Runs experimental changes in canary mode before full rollout |
| **GEP Signals** (`src/gep/signals.js`) | 660 | 660 | Signal extraction for evolution triggers (log_error, perf_bottleneck, user_friction, etc.) |
| **GEP TaskReceiver** (`src/gep/taskReceiver.js`) | 566 | 566 | Hub-pushed tasks flowing through mailbox into local execution |
| **GEP QuestionGenerator** (`src/gep/questionGenerator.js`) | 415 | 415 | LLM-generated evolution questions from runtime signals |
| **GEP SelfPR** (`src/gep/selfPR.js`) | 400 | 400 | Self-authored pull-request generation (agent writes improvements to its own code) |
| **Sandbox executor** | `src/gep/validator/sandboxExecutor.js` | 262 | Isolated execution of evolution candidates |
| **GEP assetStore** | `src/gep/assetStore.js` | 369 | Genes + Capsules + EvolutionEvents stored as content-addressed assets |

### 3.3 Unique patterns (inspection-only — for pattern-level inspiration)

1. **Proxy Mailbox architecture**
   - Anchor: `SKILL.md:105-150` — Agent, local Proxy (localhost:19820 HTTP), EvoMap Hub. Local JSONL mailbox buffers messages; Proxy syncs in background; agent only reads/writes to local mailbox.
   - 11 message types: `asset_submit / asset_submit_result / task_available / task_claim / task_claim_result / task_complete / task_complete_result / dm / hub_event / skill_update / system`.
   - **WOTANN has**: nothing for offline-first queued agent-to-agent communication. `src/channels/gateway.ts` (in=13, top-7 hub) is real-time only.
   - **Pattern to consider** (reimplement independently): an offline-first outbound queue for WOTANN's Engine then remote hub flow (relevant for `src/desktop/supabase-relay.ts`, which is WIRED but undertested).

2. **Agent Trust Protocol (ATP) — merchant + consumer roles with capability-bound handlers**
   - Anchor: `src/atp/merchantAgent.js`, `src/atp/consumerAgent.js`, `src/atp/hubClient.js`.
   - **WOTANN has**: nothing. Agent orchestration is intra-process (`src/orchestration/autonomous.ts` 1,281 LOC).
   - **Pattern to consider**: for WOTANN's planned `wotann team` command (see `src/index.ts` command inventory), a role-based trust protocol enables agents to claim capabilities and get verified before execution. This is a "5 years out" idea — noted for `UNKNOWN_UNKNOWNS.md` rather than active port.

3. **Content-addressed asset store for evolution artifacts**
   - Anchor: `src/gep/assetStore.js` (369 LOC), SKILL.md `asset_id: sha256:...` references.
   - **WOTANN has**: `src/core/content-cid.ts` (ORPHAN, 165 LOC — never imported).
   - **Pattern to consider**: wire `content-cid.ts` into `src/memory/atomic-memory.ts` and `src/skills/loader.ts`. The orphan exists; a SHA-256-addressed store would let WOTANN deduplicate skills, memories, and guards.

4. **Genome Evolution Protocol (GEP) signal then question then candidate then validator then solidify loop**
   - Anchor: `SKILL.md` + `src/gep/{signals,questionGenerator,candidates,candidateEval,validator/index,solidify}.js`.
   - Loop: (a) extract signals from runtime logs; (b) generate evolution questions; (c) propose candidate mutations; (d) evaluate candidates; (e) validate in sandbox; (f) solidify then commit.
   - **WOTANN has**: `src/learning/self-evolution.ts` (WIRED), `src/learning/darwinian-evolver.ts` (ORPHAN with test), `src/learning/miprov2-optimizer.ts` (ORPHAN with test), `src/learning/reflection-buffer.ts` (ORPHAN with test). 3 orphans.
   - **Pattern to consider**: WOTANN already has the pieces; what's missing is the orchestration loop. Pattern (inspection-only, not code): signal-extraction, mutation, sandboxed eval, commit.

5. **Self-PR — agent writes a pull-request modifying its own source**
   - Anchor: `src/gep/selfPR.js` (400 LOC).
   - **WOTANN has**: `src/cli/autofix-pr.ts` (WIRED, 458 LOC) but it autofixes external code, not WOTANN's own source. `EVOLVE_ALLOW_SELF_MODIFY=false` by default in evolver (reasonable guardrail).
   - **Pattern to consider**: bounded self-modification within a separate WOTANN fork — not the main tree.

### 3.4 Port priority (Evolver v2)

**All pattern-level only — GPL-3.0 license is incompatible with WOTANN shipping.** These are not ports but inspiration for independent reimplementation:

| # | Pattern | Effort | Source anchor | WOTANN target | Acceptance criteria |
|---|---|---|---|---|---|
| 1 | Wire orphan `src/core/content-cid.ts` into `src/skills/loader.ts` + `src/memory/atomic-memory.ts` | **S** | evolver `src/gep/assetStore.js` (pattern only) | `src/core/content-cid.ts`, `src/skills/loader.ts`, `src/memory/atomic-memory.ts` | content-cid.ts imports_in at least 2; skills deduped by sha256; round-trip test for "same skill content produces same CID". |
| 2 | Offline-first outbound queue for Engine-to-hub messages | **M** | evolver `src/proxy/mailbox/store.js` (pattern only) | New `src/telemetry/outbound-mailbox.ts` using JSONL format | 1000 messages enqueued while hub unreachable; messages delivered FIFO when hub returns; crash-survival test (kill process mid-send, restart, no dupes). |
| 3 | Wire orphan `src/learning/darwinian-evolver.ts`, `miprov2-optimizer.ts`, `reflection-buffer.ts` into `src/learning/self-evolution.ts` loop | **M** | evolver GEP pattern (inspection only) | `src/learning/self-evolution.ts` + 3 orphans | 3 files move from ORPHAN to WIRED; integration test exercises signal, mutation, validate, commit end-to-end. |
| 4 | Content-addressable skill marketplace (avoid duplicate skill SHA uploads) | **M** | pattern-level only | `src/marketplace/registry.ts` (WIRED, 779 LOC) | Skill upload refuses duplicate CID; downstream fetch serves from local cache when CID matches. |
| 5 | Snapshot `SKILL.md` mailbox message-type schema to `docs/UNKNOWN_UNKNOWNS.md` as "5-year" item | **XS** | evolver SKILL.md | `docs/UNKNOWN_UNKNOWNS.md` | New entry: "Agent-to-agent marketplace mailbox protocol" with evolver URL + summary; explicit "not currently in roadmap, capture for future." |

### 3.5 Already-in-WOTANN check (evolver)

- **Self-evolution loop**: WOTANN `src/learning/self-evolution.ts` + 3 orphan learners. Evolver has this fully wired. *WOTANN has the pieces, no orchestration.*
- **Gene/Capsule/EvolutionEvent schema**: noted as "protocol-bound" in Lane 6. Evolver now has `assetStore.js` + content-addressed publishing. *Pattern-level inspiration; no code port.*
- **Reflection buffer**: WOTANN `src/learning/reflection-buffer.ts` is ORPHAN. Evolver has `src/gep/reflection.js` fully wired. *Wiring gap.*

---

## 4. paperless-ngx/paperless-ngx — Document Management (license-blocked)

### 4.1 Overview

| Field | Value |
|---|---|
| Description | "A community-supported supercharged document management system: scan, index and archive all your documents" |
| Created | 2022-02-12 |
| Pushed (HEAD) | 2026-04-19T12:23:18Z |
| Stars | 38,767 |
| License | **GPL-3.0** — **NO CODE PORTS** |
| Primary language | Python (Django) |
| Source files (.py under src/) | 925 |
| Python LOC | 101,621 |
| Top-level layout | `src/{documents, paperless, paperless_ai, paperless_mail}` |

**Portability verdict: INSPECTION ONLY. No code ports permitted.** Patterns below are re-implementation candidates.

### 4.2 Architecture

`src/documents/` is the core consumer + search + workflow engine (48 modules). `src/paperless/` holds Django settings + parser registry. `src/paperless_ai/` is the LLM/RAG layer (llama_index + faiss + ollama/openai). `src/paperless_mail/` is IMAP-based email-to-document ingest with OAuth support.

**Top 10 largest source files:**
1. `src/documents/views.py` — 4,647 LOC (REST API views)
2. `src/documents/serialisers.py` — 3,316 LOC
3. `src/documents/models.py` — 1,817 LOC
4. `src/documents/signals/handlers.py` — 1,159 LOC
5. `src/paperless/settings/__init__.py` — 1,188 LOC
6. `src/documents/consumer.py` — 1,090 LOC
7. `src/documents/filters.py` — 1,045 LOC
8. `src/documents/barcodes.py` — ~1,000 LOC (barcode-driven split)
9. `src/documents/workflows/actions.py` — workflow action dispatcher
10. `src/paperless_ai/indexing.py` — faiss + llama_index + huggingface/openai embeddings

### 4.3 Unique patterns (pattern inspiration only)

1. **Plugin-based consume-task pipeline with `ConsumeTaskPlugin` protocol**
   - Anchor: `src/documents/plugins/base.py:23-60` — abstract `ConsumeTaskPlugin` with `able_to_run` property + `setup() then run() then cleanup()` lifecycle + `StopConsumeTaskError` early-exit; RFC-2119 MUST/SHOULD/MAY contracts inlined as docstring.
   - Concrete plugins: `BarcodePlugin` (barcode-driven document split), `CollatePlugin` (double-sided scan collation), `ConsumerPreflightPlugin`, `WorkflowTriggerPlugin`, `AsnCheckPlugin`, `ConsumerPlugin`.
   - **WOTANN has**: `src/plugins/{lifecycle.ts, manager.ts}` (both test-less WIRED), `src/hooks/built-in.ts` (1,252 LOC — 17 built-in hooks). No RFC-2119 lifecycle protocol.
   - **Pattern to consider**: restructure `src/plugins/manager.ts` to use explicit `able_to_run / setup / run / cleanup` lifecycle + `StopPluginChainError` early-exit. This gives cleaner semantics than current hook firing.

2. **Tantivy-based full-text search with paperless_text tokenizer, bigram CJK support, simple-analyzer autocomplete, sort-shadow fields**
   - Anchor: `src/documents/search/_schema.py:16-90` — Tantivy schema with 6 stored text fields, 3 fast-access sort-shadow fields, bigram_content for CJK, simple_title/simple_content for substring search, permission filters, custom-field scalars.
   - **WOTANN has**: `src/memory/store.ts` (1,994 LOC) with **SQLite FTS5** (MEMORY.md: "Persistent knowledge: SQLite + FTS5"). No Tantivy dependency.
   - **Pattern to consider**: SQLite FTS5 is sufficient for WOTANN scale. But Tantivy's sort-shadow pattern — where `title_sort`/`correspondent_sort`/`type_sort` are separate fast fields — is applicable: WOTANN's memory store should have fast-access indexes for `created_ts`, `last_access_ts`, `entity_type` beyond the searchable content fields.

3. **WorkflowTrigger then WorkflowAction dispatcher with webhook transport validation**
   - Anchor: `src/documents/workflows/actions.py:1-80` + `src/documents/workflows/webhooks.py:1-50`.
   - `WebhookTransport` subclasses `httpx.HTTPTransport` to resolve/validate hostnames, reject non-public IPs unless `allow_internal`, rewrite request to vetted IP while keeping Host/SNI.
   - **WOTANN has**: `src/connectors/{confluence,google-drive,jira,linear,notion}.ts` — all ORPHANS (see `docs/WOTANN_INVENTORY.md:139-144`, 5 files 1,392 LOC). `src/channels/webhook.ts` is WIRED.
   - **Pattern to consider** (important SSRF defense): add a `ValidatedHttpTransport` wrapper in WOTANN webhook channel that blocks internal IPs unless explicitly opted-in. Current WOTANN state may allow SSRF to internal endpoints.

4. **ML-based document classifier with serialized scikit-learn model + cache-backed autoretraining**
   - Anchor: `src/documents/classifier.py:45-100` — `DocumentClassifier` with versioned `CLASSIFIER_HASH_KEY`, `CLASSIFIER_MODIFIED_KEY`, `CLASSIFIER_VERSION_KEY`; `load_classifier(raise_exception=False)` with `IncompatibleClassifierVersionError` / `ClassifierModelCorruptError` graceful-degradation path.
   - **WOTANN has**: `src/intelligence/task-semantic-router.ts` (WIRED) as a signal router but no document/task classifier with versioning and corrupt-model recovery.
   - **Pattern to consider**: version + hash every ML model artifact; fail-soft on version mismatch or corruption; queue retrain; never crash the daemon on classifier failure.

5. **RAG classifier with per-user-visible-docs context filtering**
   - Anchor: `src/paperless_ai/ai_classifier.py:7-55` — `build_prompt_with_rag(document, user)` queries similar documents scoped to `get_objects_for_user_owner_aware(user, "view_document", Document)`, takes up to 5 similar docs, truncates to 1k chars each. Uses LLM-structured output via `DocumentClassifierSchema` + llama_index `chat_with_tools`.
   - **WOTANN has**: `src/memory/graph-rag.ts` (762 LOC, 3 imports-in, WIRED with test), `src/memory/hybrid-retrieval.ts` (ORPHAN with test), `src/memory/hybrid-retrieval-v2.ts` (WIRED).
   - **Pattern to consider**: scope graph-rag retrieval by user/workspace permissions. Currently WOTANN memory is global; permissions-aware retrieval matters when multi-tenant.

6. **Outbound URL validation with internal-IP blocking**
   - Anchor: `src/paperless/network.py` — `validate_outbound_http_url(endpoint, allow_internal=...)`, `is_public_ip`, `resolve_hostname_ips`, `format_host_for_url`. Used in webhooks (`workflows/webhooks.py`), AI client (`paperless_ai/client.py`), AI embedding (`paperless_ai/embedding.py`).
   - **WOTANN has**: no equivalent. `src/browser/camoufox-backend.ts` handles browser traffic but doesn't validate internal-IP URLs at the HTTP layer.
   - **Pattern to consider**: WOTANN's webhook + connector channels should validate outbound URLs against non-public IPs by default.

7. **Double-sided scan collation with staging pattern**
   - Anchor: `src/documents/double_sided.py:13-50` — `CollatePlugin` uses `CONSUMER_COLLATE_DOUBLE_SIDED_SUBDIR_NAME`-based staging; first pass creates staging file with odd pages; second pass collates both.
   - **WOTANN has**: N/A (not a document-management product).
   - **Pattern to consider**: the "staging file on first pass, resolve on second" pattern is generally applicable — WOTANN's `src/orchestration/` could use it for pairing parallel outputs.

8. **LLM-backend abstraction with per-backend endpoint validation**
   - Anchor: `src/paperless_ai/client.py:15-60` — switch over `llm_backend` in `{"ollama","openai"}` with `validate_outbound_http_url(endpoint, allow_internal=self.settings.llm_allow_internal_endpoints)` before instantiating llama_index wrapper.
   - **WOTANN has**: 19-provider registry (`src/providers/registry.ts:51-367`) with no URL validation layer.
   - **Pattern to consider**: add URL validation hook in `src/providers/provider-service.ts:8` (1,306 LOC, 8 imports-in hub).

### 4.4 Port priority (paperless-ngx — inspection only)

All GPL-3.0 so the following are pattern-level only, requiring independent reimplementation:

| # | Pattern | Effort | Source anchor | WOTANN target | Acceptance criteria |
|---|---|---|---|---|---|
| 1 | SSRF defense: internal-IP blocking in webhook + connector outbound HTTP | **M** | `src/paperless/network.py::validate_outbound_http_url`, `src/documents/workflows/webhooks.py:1-50` | New `src/utils/safe-http.ts` + wire into `src/channels/webhook.ts`, `src/connectors/*.ts` | Request to `http://169.254.169.254` blocked by default; request to `http://127.0.0.1:8080` blocked unless `WOTANN_ALLOW_INTERNAL_HTTP=1`; Host/SNI preserved when request is to vetted IP. |
| 2 | `ConsumeTaskPlugin` lifecycle protocol for WOTANN plugin manager | **M** | `src/documents/plugins/base.py:23-80` | `src/plugins/manager.ts`, `src/plugins/lifecycle.ts` | Every plugin has `ableToRun`, `setup`, `run`, `cleanup`; manager always calls cleanup; `StopPluginChainError` short-circuits; RFC-2119 language documented in plugin interface docstring. |
| 3 | Versioned ML-model store with fail-soft corruption recovery | **M** | `src/documents/classifier.py:45-100` | `src/intelligence/task-semantic-router.ts` + new `src/intelligence/model-store.ts` | Classifier load returns `None` on version mismatch (not crash); hash of model file stored in cache; auto-queue retrain on corruption; daemon continues running with classifier disabled. |
| 4 | Fast-access sort-shadow fields in SQLite FTS5 memory store | **S** | `src/documents/search/_schema.py:30-50` | `src/memory/store.ts` | Add `created_ts_fast`, `last_access_ts_fast`, `entity_type_fast` as fast-read-only columns; 10x faster sort on list queries. |
| 5 | Per-user/per-workspace scope filter on graph-rag retrieval | **M** | `src/paperless_ai/ai_classifier.py:54-66` | `src/memory/graph-rag.ts` + `src/sandbox/approval-rules.ts` | RAG context limited to entities visible to the current workspace; multi-tenant isolation test; no cross-workspace leakage. |

### 4.5 Already-in-WOTANN check (paperless-ngx)

- **Full-text search**: WOTANN uses SQLite FTS5 (per MEMORY.md); paperless uses Tantivy. WOTANN's choice is appropriate for scale. *Not duplicate — but sort-shadow pattern is a gap.*
- **OCR pipeline**: WOTANN has `src/utils/vision-ocr.ts`; paperless has Tesseract/OCRmyPDF + barcode + double-sided. *WOTANN's OCR is lightweight; no gap unless WOTANN expands into full document ingest.*
- **Plugin lifecycle**: WOTANN `src/plugins/` is 2 files, no RFC-2119 lifecycle. *Gap.*
- **Document consumer**: WOTANN has no directory-watch then classify then file pipeline. *Not applicable to WOTANN scope.*
- **LLM RAG client**: WOTANN has `src/memory/graph-rag.ts` (762 LOC, test). *Overlap, permission-aware scoping is the gap.*

---

## 5. Donchitos/Claude-Code-Game-Studios — Claude Code Plugin Pack

### 5.1 Overview

| Field | Value |
|---|---|
| Description | "Turn Claude Code into a full game dev studio — 49 AI agents, 72 workflow skills, and a complete coordination system mirroring real studio hierarchy." |
| Created | 2026-02-12 |
| Pushed (HEAD) | 2026-04-10T10:28:38Z |
| Stars | 13,253 |
| License | MIT |
| Primary language | Shell (bash hooks) + Markdown (49 agents + 72 skills) |
| Files (all types, excl. .git) | 412 |
| MD/JSON/SH LOC | 74,641 |
| Layout | `.claude/{agents/, skills/, hooks/, rules/, docs/, agent-memory/}` — standard Claude Code plugin structure |

### 5.2 Architecture

- **49 agents** in 3 tiers (Directors/Opus, Leads/Sonnet, Specialists/Sonnet-Haiku) + 15 engine specialists (Godot/Unity/Unreal sub-specialists).
- **72 skills** — slash commands covering onboarding, design, art, UX, architecture, stories, sprints, reviews, QA, production, release, creative, team orchestration.
- **12 hooks**: `detect-gaps`, `log-agent{,-stop}`, `notify`, `post-compact`, `pre-compact`, `session-start`, `session-stop`, `validate-{assets,commit,push,skill-change}`.
- **11 rules**: `ai-code`, `data-files`, `design-docs`, `engine-code`, `gameplay-code`, `narrative`, `network-code`, `prototype-code`, `shader-code`, `test-standards`, `ui-code`.
- **Agent hierarchy docs** (`.claude/docs/{coordination-rules,agent-roster,agent-coordination-map,review-workflow}.md`) codify vertical delegation, horizontal consultation, conflict escalation, change propagation.

### 5.3 Unique patterns (cross-check against WOTANN)

1. **3-tier model-routing by task complexity (Haiku/Sonnet/Opus)**
   - Anchor: `.claude/docs/coordination-rules.md` — "Haiku: Read-only status checks, formatting, simple lookups. Sonnet: Implementation, design authoring. Opus: Multi-document synthesis, high-stakes phase gate verdicts, cross-system holistic review." Skills explicitly assigned: `haiku` for `/help`, `/sprint-status`, `/story-readiness`, `/scope-check`; `opus` for `/review-all-gdds`, `/architecture-review`, `/gate-check`.
   - **WOTANN has**: `src/providers/model-router.ts` (WIRED), `src/core/agent-profiles.ts` (ORPHAN, 147 LOC). The model-router routes by provider, not by task complexity tier.
   - **Gap**: WOTANN's `agent-profiles.ts` orphan is the exact right landing zone for 3-tier routing. WOTANN has the file, just not the wiring + tier-taxonomy.

2. **Agent-memory persistent directory per-agent**
   - Anchor: `.claude/agent-memory/lead-programmer/` (example subdirectory shipped in repo).
   - **WOTANN has**: `src/memory/store.ts` is global; `src/memory/episodic-memory.ts`, `src/memory/proactive-memory.ts`. No per-agent memory directory.
   - **Gap**: a per-agent (or per-persona) memory scoped view would let different personas maintain isolated learning. WOTANN has `src/identity/persona.ts` (WIRED, test-less) — this is the right landing file.

3. **Pre-compact hook dumps session state before compaction**
   - Anchor: `.claude/hooks/pre-compact.sh:1-60` — dumps `production/session-state/active.md`, `git status` (changed/staged/untracked), WIP design docs (searching for TODO/WIP/PLACEHOLDER/TBD tokens) into the conversation before compaction so that summary preserves critical state.
   - **WOTANN has**: `src/runtime-hooks/dead-code-hooks.ts` (ORPHAN with test), `src/hooks/` (6 test-less WIRED including `built-in.ts` 1,252 LOC). No pre-compact-session-state-dumper.
   - **Gap**: WOTANN's compaction is handled in `src/context/compaction.ts` (WIRED, test-less) but no session-state survival hook. This is a **free win** — a ~60-line shell/TS hook ports directly under MIT.

4. **File-backed state as primary persistence, not conversation**
   - Anchor: `.claude/docs/context-management.md` — "The file is the memory, not the conversation. Conversations are ephemeral and will be compacted or lost. Files on disk persist across compactions and session crashes." `production/session-state/active.md` is the living checkpoint.
   - **WOTANN has**: `src/memory/atomic-memory.ts` does persist to disk; `src/memory/active-memory.ts` (test-less). The active-memory.ts file is test-less — it's the file that implements this concept, but the workflow is not formalized.
   - **Gap**: adopt the `session-state/active.md` pattern explicitly. Document it in WOTANN CLAUDE.md.

5. **Directory-scoped coding-standards (11 rules, path-scoped)**
   - Anchor: `.claude/rules/{ai-code,data-files,design-docs,engine-code,gameplay-code,narrative,network-code,prototype-code,shader-code,test-standards,ui-code}.md`.
   - **WOTANN has**: single-file `CLAUDE.md`; `docs/` has multiple synthesis reports but not path-scoped rules.
   - **Gap**: WOTANN could ship per-directory `.claude/rules/*.md` for `src/providers/`, `src/channels/`, `src/voice/`, `src/computer-use/`, etc. This is a coding-hygiene pattern that CCGS institutionalizes.

6. **Skill metadata with `user-invocable: true`, `allowed-tools: ...`, `argument-hint: ...`**
   - Anchor: `.claude/skills/dev-story/SKILL.md:1-6` — YAML frontmatter `name: dev-story` / `description: ...` / `argument-hint: "[story-path]"` / `user-invocable: true` / `allowed-tools: Read, Glob, Grep, Write, Bash, Task, AskUserQuestion`.
   - **WOTANN has**: `src/skills/loader.ts` (713 LOC, 4 imports-in, WIRED) + `skills/*.md` directory of 65+ skills per CLAUDE.md claim. Need to verify skill frontmatter format matches CCGS.
   - **Gap**: standardize skill YAML-frontmatter fields to include `user-invocable`, `allowed-tools`, `argument-hint`. Aligns with Claude Code plugin contract and enables better restrict-tool enforcement.

7. **Structured validation hooks**
   - Anchor: `.claude/hooks/validate-commit.sh:1-50` — PreToolUse hook parses JSON from stdin, scans staged files for design-doc section coverage ("Overview", "Player Fantasy", "Detailed", "Formulas", "Edge Cases", "Dependencies", "Tuning Knobs", "Acceptance Criteria"). Validates JSON data files with Python.
   - **WOTANN has**: `src/hooks/built-in.ts` (1,252 LOC, 17+ hooks). No commit-time design-doc section validator.
   - **Gap**: commit-hook validator could enforce WOTANN own section conventions on `docs/**.md` (e.g., every audit file has `Executive Summary / Findings / Evidence / Recommendations`).

8. **Agent-audit log hook**
   - Anchor: `.claude/hooks/log-agent.sh:1-30` — on `SubagentStart`, appends to `production/session-logs/agent-audit.log`: `{timestamp} | Agent invoked: {agent_type}`. Includes a known-bug documentation inline: "The agent name is in `agent_type`, NOT `agent_name`."
   - **WOTANN has**: `src/telemetry/audit-trail.ts` (WIRED, test-less). Supports events but not subagent invocation specifically.
   - **Gap**: subagent invocation audit is a hard signal for reproducing behavior. Wire `audit-trail.ts` to `SubagentStart`/`SubagentStop` hooks.

9. **Vertical delegation coordination rules**
   - Anchor: `.claude/docs/coordination-rules.md:1-8` — (1) Leadership agents delegate to department leads then specialists, never skip tiers. (2) Same-tier agents consult but don't make binding cross-domain decisions. (3) Conflict escalates to shared parent; else creative-director (design) or technical-director (technical).
   - **WOTANN has**: `src/orchestration/agent-hierarchy.ts` (WIRED, test-less). `src/agents/background-agent.ts` (ORPHAN with test).
   - **Gap**: codify vertical delegation and conflict resolution in `agent-hierarchy.ts`. Currently the file is present but the delegation rules are implicit.

10. **Game-engine specialist roster pattern**
    - Anchor: 15 engine-specialist markdown files in `.claude/agents/` — `godot-{csharp,gdextension,gdscript,shader}-specialist`, `unity-{addressables,dots,shader,ui}-specialist`, `ue-{blueprint,gas,replication,umg}-specialist`, `godot-specialist`, `unity-specialist`, `unreal-specialist`.
    - **WOTANN has**: 0 domain specialists. Personas exist in `src/identity/persona.ts` but are undifferentiated.
    - **Pattern to consider**: WOTANN could ship personas for common coding stacks (typescript-specialist, python-specialist, swift-specialist, rust-specialist, etc.) using the CCGS pattern.

### 5.4 Port priority (CCGS — MIT direct port OK)

| # | Pattern | Effort | Source anchor | WOTANN target | Acceptance criteria |
|---|---|---|---|---|---|
| 1 | Pre-compact session-state dumper hook | **S** | `.claude/hooks/pre-compact.sh:1-60` | New `src/hooks/pre-compact-state-dump.ts` wired into `src/context/compaction.ts` | On compaction event, dumps `docs/SESSION_STATE.md` if present + `git status` summary + unsaved design-doc TODO scan into conversation before summary begins. Test asserts pre-compact event produces expected output. |
| 2 | 3-tier model routing (Haiku/Sonnet/Opus) based on task complexity, wire orphan `src/core/agent-profiles.ts` | **M** | `.claude/docs/coordination-rules.md:46-65` | `src/providers/model-router.ts` + `src/core/agent-profiles.ts` (orphan) | agent-profiles.ts moves from ORPHAN to WIRED (imports_in at least 1); tests cover Haiku-tier read-only skills, Sonnet default, Opus for multi-doc synthesis; router respects tier when available on provider. |
| 3 | Standardize skill YAML frontmatter (`user-invocable`, `allowed-tools`, `argument-hint`, `model`) | **M** | `.claude/skills/dev-story/SKILL.md:1-6` | `src/skills/loader.ts` + all skill MD files | Every skill file has the 4 standardized fields; loader rejects skills missing required fields; test covers validation. |
| 4 | Commit-time section-coverage validator for WOTANN docs | **S** | `.claude/hooks/validate-commit.sh:29-42` | New `src/hooks/commit-docs-validator.ts` (pre-commit hook) | `docs/AUDIT*.md` commits blocked if missing `Executive Summary / Findings / Evidence / Recommendations` sections. |
| 5 | Subagent invocation audit-trail wiring | **S** | `.claude/hooks/log-agent.sh:1-30` + `coordination-rules.md:41-75` | `src/telemetry/audit-trail.ts` + `src/orchestration/agent-hierarchy.ts` | Every subagent spawn/stop appended to `~/.wotann/audit.log` with timestamp + agent-type + parent + outcome; test verifies 3 spawns produce 3 audit entries. |

### 5.5 Already-in-WOTANN check (CCGS)

- **49 agents**: WOTANN does not ship agents in the Claude Code plugin sense. Personas exist (`src/identity/persona.ts`) but are not directory-scoped Markdown files. *Gap — but out of scope for phase-3 ports.*
- **72 skills**: CLAUDE.md says "65+ skills, progressive disclosure" — but inventory shows `src/skills/` = 14 .ts files + `skill-compositor.ts` + `skill-optimizer.ts` both ORPHAN. Actual loaded skill count unverified. Skill marketplace is `src/marketplace/`. *Claim-vs-code drift flagged in `docs/WOTANN_INVENTORY.md:462`.*
- **12 hooks**: WOTANN `src/hooks/built-in.ts` has 17+ hooks. *More than CCGS, overlap on session lifecycle.*
- **11 rules**: WOTANN has single CLAUDE.md — no per-dir rules files. *Gap.*
- **Pre-compact hook**: No WOTANN equivalent. *Clean port opportunity.*
- **Agent-memory directory**: Not present. *Gap.*

---

## 6. Synthesis — Top-10 Cross-Source Port Priorities (V4)

Ranking by (leverage divided by effort) times (WOTANN-gap times license-portability):

| Rank | Port | Source | Effort | License-OK? | Priority Rationale |
|---|---|---|---|---|---|
| 1 | Wire orphan `src/providers/prompt-cache-warmup.ts` into daemon startup with per-session system prompts | omi-v2 | M | MIT-port | Kills one orphan; directly addresses WOTANN CLAUDE.md's "prompt caching" promise; under 2h work. |
| 2 | `PROVIDER_SEND_TURN_MAX_*` hard limits | t3code | S | MIT-port | 15 min work; closes attachment-DoS surface; preempts a real audit finding. |
| 3 | SSRF defense: internal-IP blocking in outbound HTTP (webhooks + connectors) | paperless-ngx | M | **Pattern only (GPL)** — reimplement | Security fix. WOTANN has 5 orphan connectors (confluence/google-drive/jira/linear/notion) with no URL validation layer. |
| 4 | Pre-compact session-state dumper hook | CCGS | S | MIT-port | Free hook; pairs with existing `src/context/compaction.ts` and `src/hooks/built-in.ts`. |
| 5 | Wire orphan `src/sandbox/approval-rules.ts` into `src/core/mode-cycling.ts` | t3code | S | MIT-port | Kills one orphan; aligns approval rules with mode semantics. |
| 6 | Session-map with cwd invalidation + per-session model override + retry-fix | omi-v2 | S | MIT-port | Small surface, fixes a known class of retry-by-model bug inherent in session-keyed maps. |
| 7 | 3-tier model routing (Haiku/Sonnet/Opus) wiring `src/core/agent-profiles.ts` orphan | CCGS | M | MIT-port | Kills one orphan; aligns WOTANN with Anthropic's tier-cost envelope. |
| 8 | `ConsumeTaskPlugin`-style lifecycle protocol for `src/plugins/manager.ts` | paperless-ngx | M | **Pattern only (GPL)** — reimplement | Architectural cleanup; RFC-2119 rigor on plugin contract; enables third-party plugin ecosystem. |
| 9 | AES-256-GCM + HKDF per-user encryption for session state | omi-v2 | M | MIT-port | Strengthens `src/mobile/secure-auth.ts`; canonical crypto stance. |
| 10 | KeyedCoalescingWorker for streaming event coalescing | t3code | M | MIT-port | New primitive; directly relevant to 134 Desktop GUI views + 74 CLI commands; kill a class of ghost-flicker UI bugs. |

### 6.1 Dead ends — do NOT port

- **Evolver ATP + Proxy Mailbox + GEP full stack** — GPL-3.0 moving to source-available. Any GPL-3.0 code in WOTANN would force all of WOTANN to GPL, which conflicts with WOTANN's own licensing stance. Pattern inspiration only.
- **paperless-ngx full document consumer pipeline (OCR + classifier + workflow)** — GPL-3.0 and out of WOTANN scope (WOTANN is not a DMS). Only SSRF defense + plugin-lifecycle patterns are worth reimplementing.
- **CCGS agent roster as-is** — the 49 game-specific agents are the wrong domain. The framework patterns (tier routing, coordination rules, pre-compact hook, skill-frontmatter format) are worth porting; the agent content is not.

---

## 7. Delta vs prior extractions (Lane 1-8, UNKNOWN_UNKNOWNS)

### 7.1 Omi — Lane 4 update

Lane 4 (`docs/COMPETITOR_EXTRACTION_LANE4_UX.md`) captured meeting-pipeline + VAD basics. New in V4:
- **ACP-bridge pattern** (`desktop/acp-bridge/`) — not in Lane 4.
- **Backend-Rust full rewrite** (`desktop/Backend-Rust/`) — not in Lane 4.
- **HKDF + AES-256-GCM encryption scheme** — not in Lane 4.
- **Session-manager with cwd invalidation logic** — not in Lane 4.
- **2,065-LOC VAD-gate unit test** — not in Lane 4.

### 7.2 Evolver — Lane 6 update

Lane 6 (`docs/COMPETITOR_EXTRACTION_LANE6_SELFEVOLUTION.md`) captured GEP basics + Gene/Capsule/EvolutionEvent protocol shapes. New in V4:
- **ATP (Agent Trust Protocol)** — 6 files in `src/atp/` — not in Lane 6.
- **Proxy Mailbox architecture** — 12 files in `src/proxy/` — not in Lane 6.
- **A2A export/ingest/promote scripts** — not in Lane 6.
- **Canary gating, SelfPR, QuestionGenerator, TaskReceiver, sandboxExecutor** — all net-new in v2.
- **2026-03 upstream notice of source-available move** — critical licensing update.

### 7.3 Net-new sources (no prior Lane coverage)

- **t3code** — not covered in any Lane. Major novelty: Effect + Layer architecture, CQRS projections, provider-as-subprocess.
- **paperless-ngx** — not covered in any Lane. Major novelty: plugin lifecycle protocol, SSRF defense, ML-model versioning, Tantivy schema tricks.
- **CCGS** — not covered in any Lane. Major novelty: 3-tier model routing, pre-compact hook, directory-scoped rules, file-as-primary-state philosophy.

### 7.4 UNKNOWN_UNKNOWNS additions

For `docs/UNKNOWN_UNKNOWNS.md` consideration (not this session, just flag):

- Agent-to-agent trust protocols (evolver ATP pattern) — "5-year" item.
- Content-addressed evolution artifacts (evolver asset store) — mid-range item with existing orphan `src/core/content-cid.ts` as anchor.
- Per-user permission-scoped RAG retrieval (paperless_ai pattern) — becomes relevant when WOTANN goes multi-tenant.
- Effect + Layer architecture migration (t3code pattern) — "rewrite scale" item; informational.

---

## 8. Verification trail

All citations verified against local clone HEADs:

```
research/__new_clones_v3/t3code/                   MIT        9,803 stars   HEAD: shallow --depth=1
research/__new_clones_v3/omi-v2/                   MIT       11,019 stars   HEAD: 9b69ad2
research/__new_clones_v3/evolver-v2/               GPL-3.0    5,430 stars   HEAD: 0b2660d (v1.69.0)
research/__new_clones_v3/paperless-ngx/            GPL-3.0   38,767 stars   HEAD: shallow --depth=1
research/__new_clones_v3/claude-code-game-studios/ MIT       13,253 stars   HEAD: shallow --depth=1
```

License classification matches `gh repo view <owner/repo> --json licenseInfo`. Star counts are live as of 2026-04-19. All port recommendations from MIT-licensed repos only; GPL-3.0 repos yielded pattern-level inspiration but no code ports.

*End of V4 extraction. Next: consider Phase-3 wiring PRs for ports ranked 1, 2, 4, 5, 6 — all MIT-licensed, S/M effort, and each kills an existing orphan or closes a known security surface.*
