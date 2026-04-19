# KAIROS RPC Full Deep Read — 2026-04-18

**Target:** `/Users/gabrielvuksani/Desktop/agent-harness/wotann/src/daemon/kairos-rpc.ts`
**Total lines:** 5,375
**Handler registrations (`this.handlers.set(...)`):** 160 call sites
**Unique method names (excluding the three `Map.get` aliases and the generic `register()` site):** **156 handlers**
**Prior-session claim:** "~153 handlers" — **undercount**; this deep read confirms 156.
**Method:** Chunked read (400-line stride) through the entire file, plus targeted `Grep` for every `handlers.set` occurrence.

The 156 figure excludes:
- Line 1110 — `this.handlers.set(method, handler)` inside the public `register()` helper (not a method registration).
- Three iOS aliases that reuse an existing handler by reference (L2738 `conversations.list`, L2741 `cost.snapshot`, L2744 `task.dispatch`) — these *are* distinct RPC method names but share the parent handler's body. Counted once below under "Aliases."

## Executive Summary

This file is the single RPC dispatcher for all three WOTANN surfaces (CLI over Unix socket, Desktop over IPC, iOS over WebSocket). Of the 156 unique handlers:

| Category | Count | Notes |
|---|---|---|
| **Fully wired (real subsystem calls)** | 115 | Includes every `lsp.*`, `git.*`, `providers.*` (except legacy), `channels.policy.*`, `agents.*` (except the stub arms of `agents.spawn`), `workflow.*`, `voice.*`, most `shadow.*` / `proofs.*` / `composer.*`, and `companion.*`. |
| **Pure stubs / returns empty / returns fake data** | 1 | `cron.list` (L2568) — hardcoded `{ jobs: [] }`. This is the **only** pure stub remaining; the 10 prior-session candidates listed in the task prompt have all been verified (9 of them are NOT stubs; see "Prior-Audit Verification" below). |
| **Best-effort with degradation to empty** | 22 | Catches `err`, returns `[]` / `{}` / `ok:false` (legitimate — calling subsystem may be uninitialized). |
| **Aliases** | 3 | `conversations.list`, `cost.snapshot`, `task.dispatch`. |
| **Dead / superseded** | 1 | `providers.list.legacy` (L1441) — kept as reference only. Never reached. |
| **Streaming (not in `handlers` Map)** | 2 | `query` (L245) and `chat.send` streaming path (L618). Dispatched pre-Map by `handleMessage()`. |

The security posture is generally much better than earlier sessions suggested — most of the prior-session "pure stubs" have been wired in session-3/4/5/6. However I found **1 new pure stub** (`cron.list`), **3 fire-and-forget handlers** with error-swallow concerns, **2 wildcard dispatchers** in various stages of hardening, and **at least 8 handlers** that trust caller-supplied paths/IDs without robust validation. Full matrix below.

---

## 1. Prior-Audit Verification

Each of the 10 prior-session "pure stubs" was re-read line-by-line:

| Method | Prior Line | Current Line | Current State | Verdict |
|---|---|---|---|---|
| `cron.list` | 2400 | **2568** | `return { jobs: [] };` | **Still a pure stub.** Only a literal empty array. No CronEngine lookup. |
| `cost.arbitrage` | 2170 | **2273** | Iterates `PROVIDER_DEFAULTS`, calls `costTracker.estimateCost()`, sorts by cost, recommends cheapest. Real. | **Wired.** Not a stub. |
| `mode.set` | 2214 | **2364** | Validates against `WotannMode` enum, calls `this.runtime.setMode(mode)`, returns `this.runtime.getModeName()`. Real. | **Wired.** Not a stub. |
| `channels.start` | 2819 | **3074** | Calls `plane.getChannelHealth()`, returns channel + health. **But does NOT actually "start" — adapters are self-managing; the RPC just reports current health.** Comment acknowledges this. | **Semi-stub / misnamed.** The name implies state change; the body is read-only. |
| `channels.stop` | 2830 | **3085** | Same pattern — returns `stopped: true` unconditionally without doing anything. | **Lie-stub.** Always claims success. |
| `memory.verify` | 2876 | **3136** | Reads entry from memory store, checks source-file existence, computes SHA-256 hash, calls `store.memoryVerify(entryId)`. Real. | **Wired.** Not a stub. |
| `context.info` `sources` | 2222 | **2390** | Returns `sources: []` unconditionally — ignores any context-source enumeration that might exist on runtime. The `percent`, `tokens`, `messageCount` fields ARE populated from real runtime status. | **Partial stub.** The `sources` array is hardcoded empty. |
| `continuity.frame` | 4154 | **5162** | Decodes base64 length → approximate byte count, pushes to in-memory ring buffer, trims to 30. **Does not persist, does not process, does not forward.** | **Partial stub.** Counts bytes but never uses the frame data. |
| `autonomous.run` | 2708 | **2885** | Full wire-up: calls `runtime.getAutonomousExecutor().execute(task, runTurn, runVerifier)` with real per-turn cost tracking and the verification cascade. ~100 lines of real logic. | **Fully wired.** Not a stub. |
| `session.create` | 2483 | **2651** | Returns `{ id, name, createdAt, init }`. When `init === true` it queues `files.hotspots`. **No actual session persistence to disk or runtime session registration.** | **Partial stub.** Generates an id and fires hotspots, but doesn't register the session anywhere. |

**Summary of prior-audit list:**
- Still a pure stub: 1 (`cron.list`)
- Wired (prior audit was out of date): 4 (`cost.arbitrage`, `mode.set`, `memory.verify`, `autonomous.run`)
- Partial / semantic stub (returns success without effect): 4 (`channels.start`, `channels.stop`, `context.info.sources`, `continuity.frame`, `session.create`)

---

## 2. New Pure Stubs Found (Not Previously Listed)

After reading 100% of the file, the **only** pure stub I can identify is `cron.list` (already known). Everything else either invokes runtime/daemon methods or performs real filesystem / cryptographic / git work. A few handlers are short but not stubs — e.g. `ping` returns a literal timestamp, which is the correct semantics for a ping.

However there ARE several handlers whose bodies do much less than their names imply — these are NOT pure stubs but worth flagging as "semantic gaps":

| Method | Line | Gap |
|---|---|---|
| `channels.start` | 3074 | Name suggests "connect this channel." Body just reads current health. |
| `channels.stop` | 3085 | Name suggests disconnect. Body returns `stopped: true` with no disconnect call. |
| `context.info` | 2390 | Populates `percent`/`tokens`/`messageCount` from runtime but `sources: []` is hardcoded. |
| `continuity.frame` | 5162 | Records a timestamp + size in a 30-slot ring but discards the actual frame payload. |
| `session.create` | 2651 | Fabricates an id but does not register the session with the runtime or persist it. |
| `cost.snapshot` | 2741 | Alias for `cost.current` — fine, but names imply different semantics (point-in-time vs. current). |
| `research` | 2226 | Just wraps runtime.query with `"Research the following topic thoroughly: …"`. No multi-source search, no citations. |
| `plugins.list` | 2458 | Builds plugin list from lifecycle hook registrations — works, but labels every plugin as `enabled: true` unconditionally. |
| `audit.query` | 3456 | Opens SQLite, queries, closes. Pattern is correct but no pagination bounds check — caller's `limit` becomes the SQL LIMIT with no upper cap. |

---

## 3. Full Handler Catalog

Format: `method — line — params — body summary — calls runtime? — security concerns`. This is the complete index in source order.

### 3.1 Core Dispatch / Auth

**status** — L1124 — `()` — Returns `this.runtime.getStatus()` or `{status:"stopped"}`. **Runtime: YES.** Low risk.

**auth.handshake** — L1135 — `()` — Reads session token from `kairos-ipc.readSessionToken()`. Exempt from session-token gate. **Runtime: NO.** Risk: exempt from gate — correct by design (bootstrap), but any code path that reaches this method without the OOB trust dance (ECDH pair or Unix socket ACL) bypasses auth. Dependent on IPC layer filtering.

**auth.anthropic-login** — L1151 — `()` — Spawns OAuth browser login via `startAnthropicLogin()`. **Runtime: NO.** Side effects: writes credentials to disk. Low risk (user-initiated).

**auth.codex-login** — L1166 — `()` — OAuth flow, re-uses existing Codex CLI creds if available. **Runtime: NO.** Side effects: credential import. Low risk.

**auth.detect-existing** — L1207 — `()` — Calls `detectExistingAnthropicCredential()` + `detectExistingCodexCredential()`. **Runtime: NO.** Read-only.

**auth.import-codex** — L1217 — `{path}` — Calls `importCodexCliCredential(path)`. **Runtime: NO.** **SECURITY: path is NOT validated for workspace escape** — user-supplied. The import routine presumably reads the file; an attacker who can convince the user to paste a path could read `/etc/passwd`-shaped files. Mitigated only by whatever the provider module itself does.

### 3.2 Companion / Pairing

**companion.pairing** — L1226 — `()` — Returns pairing QR + port. **Runtime: NO, daemon: YES.** Throws if not running. Low risk.

**companion.devices** — L1240 — `()` — Lists paired devices. **Daemon: YES.** Read-only.

**companion.sessions** — L1265 — `()` — Lists active pairing sessions. **Daemon: YES.** Read-only.

**companion.unpair** — L1284 — `{deviceId}` — Removes device pairing. **Daemon: YES.** Side-effecting. Medium risk: removes a device's trust relationship — caller is already session-authed.

**companion.session.end** — L1296 — `{sessionId}` — Ends an active pairing session. **Daemon: YES.** Side-effecting. Medium risk: no check that caller owns the session.

### 3.3 Sessions

**session.list** — L1309 — `()` — Returns array with a single SessionInfo derived from `runtime.getSession()`. **Runtime: YES.**

**session.create** — L2651 — `{name?, title?, init?}` — Returns fabricated id + timestamp; queues `files.hotspots` when `init:true`. **Runtime: NO (doesn't persist).** Semantic stub — see §2.

**session.resume** — L2977 — `{sessionId?}` — Validates sessionId against `/^[a-zA-Z0-9_-]+$/`, resolves path, double-checks `startsWith(safeRoot)`, reads JSON. **Runtime: YES (requires init).** Security: path-traversal guard is PRESENT and correct (S2-6 fix). Good.

### 3.4 Providers

**providers.list** — L1330 — `{force?}` — Returns enabled providers from ProviderService snapshot. **Runtime: NO, ProviderService: YES.** Read-only.

**providers.snapshot** — L1354 — `{force?}` — Full state dump including auth methods + env keys. **ProviderService: YES.** Read-only but surfaces envKeys (names only) — low risk.

**providers.saveCredential** — L1382 — `{providerId, method, token, expiresAt?, label?}` — Persists credential. **ProviderService: YES.** HIGH SENSITIVITY: stores API keys / OAuth tokens. No re-auth check — session-token gate is the only barrier.

**providers.deleteCredential** — L1408 — `{providerId}` — Removes credential. **ProviderService: YES.** Destructive. Medium risk.

**providers.test** — L1417 — `{providerId}` — Calls `testCredential()` (likely a models fetch). **ProviderService: YES.** Triggers outbound request — timing side-channel risk (negligible).

**providers.refresh** — L1425 — `()` — Forces provider rediscovery. **ProviderService: YES.** Side-effecting (sets state), cheap.

**providers.import** — L1432 — `{providerId, path}` — Imports credential file. **ProviderService: YES.** Same `path` concern as `auth.import-codex` — caller-supplied path without workspace containment. Medium risk.

**providers.list.legacy** — L1441 — `()` — Large inline implementation iterating Ollama/Anthropic/OpenAI/Gemini/Groq/Copilot/Codex. **DEAD CODE.** Never reached (earlier `providers.list` supersedes). Maintained as reference only.

**providers.switch** — L1845 — `{provider, model}` — Calls `getProviderService().setActive()`. **ProviderService: YES.**

### 3.5 Costs

**cost.current** — L1859 — `()` — Reads session totals + cost-tracker daily/weekly/budget. **Runtime: YES.** Read-only.

**cost.details** — L2242 — `()` — Extended breakdown incl. weekly/monthly via DailyCostStore. **Runtime: YES.** Read-only.

**cost.arbitrage** — L2273 — `{prompt}` — Iterates `PROVIDER_DEFAULTS`, estimates cost for each, sorts, flags cheapest as recommended. **Runtime: YES (for cost tracker).** Real. Note: `estimatedLatencyMs` is hardcoded at 1200 (router doesn't yet expose per-provider history).

**cost.predict** — L4399 — `{prompt, provider?, model?}` — Calls `daemon.getCostOracle().estimateTaskCost()`. **Daemon: YES.** Real.

### 3.6 Memory

**memory.search** — L1885 — `{query}` — Calls `runtime.getHybridSearch().search()`. **Runtime: YES.** Read-only.

**memory.verify** — L3136 — `{entryId}` — Reads entry, checks source-file existence + SHA-256. **Runtime: YES.** Real. Good.

**memory.fence** — L4665 — `()` — Returns `runtime.getContextFence().getStats()`. **Runtime: YES.**

**memory.quality** — L4671 — `()` — Returns `runtime.getRetrievalQuality().computeMetrics()`. **Runtime: YES.**

**memory.mine** — L4677 — `{text}` — Calls `runtime.getConversationMiner().mineGenericText(text)`. **Runtime: YES.**

### 3.7 Enhance / Research / Council / Architect

**enhance** — L1903 — `{prompt, style?}` — Routes through `runtime.getPromptEnhancerEngine().enhance()` with a custom QueryExecutor. **Runtime: YES.** Real.

**research** — L2226 — `{topic}` — Wraps `runtime.query` with a topic prefix. Single-model, no sources. Thin wrapper but not a stub.

**architect** — L3029 — `{prompt|question}` — Wraps `runtime.query` with `[ARCHITECT MODE]` prefix. Thin wrapper.

**council** — L3047 — `{query|prompt, providers?}` — Calls `runtime.runCouncil()`. **Runtime: YES.** Real multi-model deliberation.

### 3.8 Config

**config.get** — L1941 — `{key?}` — Reads `~/.wotann/wotann.yaml`. Returns whole config or `{key, value}`. **Runtime: NO.** Low risk.

**config.set** — L1956 — `{key, value}` — Atomic write via tmp-then-rename with 0o600 perms. Correct. **Runtime: NO.** Side-effecting. Security: keys are caller-supplied — no validation. A caller could inject arbitrary top-level keys (low impact since only code reading those keys would observe them).

**config.sync** — L5088 — `{config?, direction?}` — Pull or push; push is gated by `allowed = ["ui","providers","hooks","memory"]` allowlist. **Runtime: NO (optional ext).** Good hardening.

### 3.9 Agents

**agents.list** — L1998 — `()` — Combines delegation manager + background agents. **Runtime + Daemon: YES.** Read-only.

**agents.spawn** — L2058 — `{task}` — Creates a delegation task. On failure silently returns a fake `{id, task, status:"queued"}`. **Runtime: YES.** Best-effort fallback is a soft lie — if delegation fails the caller thinks a task was queued. Medium risk: surfaces misleading state.

**agents.kill** — L2095 — `{id}` — Marks delegation task as failed ("Terminated by user"). **Runtime: YES.** Real.

**agents.submit** — L2123 — `{description|task, model?, provider?, maxCost?, maxTurns?, workingDir?}` — Submits a background task. **Daemon: YES.** Side-effecting. Security: `workingDir` is caller-supplied without workspace containment — the background agent will run in that directory. HIGH RISK for iOS callers. No check that `workingDir` is inside the workspace.

**agents.cancel** — L2141 — `{id}` — Cancels background task. **Daemon: YES.** Real.

**agents.status** — L2151 — `{id}` — Returns single task object. **Daemon: YES.** Real.

**agents.hierarchy** — L4649 — `()` — `runtime.getAgentHierarchy()` tree + activeCount. **Runtime: YES.**

**agents.workspace** — L4659 — `()` — `runtime.getAgentWorkspace().getStats()`. **Runtime: YES.**

### 3.10 Channels

**channels.status** — L2162 — `()` — `dispatchPlane.getChannelHealth()`. **Runtime: YES.** Read-only.

**channels.start** — L3074 — `{channel}` — **Semi-stub.** Just reads health. Misleading name.

**channels.stop** — L3085 — `{channel}` — **Lie-stub.** Always returns `stopped:true` without disconnecting.

**channels.policy.list** — L3096 — `()` — `plane.getPolicies()`. **Runtime: YES.**

**channels.policy.add** — L3104 — `{id?, label?, channelType?, channelId?, senderId?, provider?, model?}` — Upserts a DispatchRoutePolicy. **Runtime: YES.** Real.

**channels.policy.remove** — L3121 — `{id}` — `plane.removePolicy(id)`. **Runtime: YES.** Real.

### 3.11 Automations

**automations.list** — L2575 — `()` — `daemon.getAutomationEngine().listAutomations()`. **Daemon: YES.**

**automations.create** — L2587 — `{name, trigger, agentConfig, enabled?, memoryScope?}` — Creates an automation. **Daemon: YES.** Side-effecting. Security: `trigger` and `agentConfig` are cast to the engine's types without structural validation. A malicious caller could inject an agentConfig pointing to an arbitrary `workingDir` or commands. HIGH RISK if reachable by iOS.

**automations.update** — L2610 — `{id, updates?}` — Updates automation. **Daemon: YES.** Same validation gap as create.

**automations.delete** — L2630 — `{id}` — Deletes. **Daemon: YES.**

**automations.status** — L2639 — `()` — Returns engine status + nextRuns + recentExecutions. **Daemon: YES.**

### 3.12 Arena / Workflows

**arena.run** — L2178 — `{prompt, models?}` — Queries each model in `targetModels` serially. **Runtime: YES.** Note: estimated cost = `content.length * 0.00004` is a fabricated approximation rather than the tracker's real cost. Low risk, wrong-answer concern.

**workflow.list** — L3580 — `()` — `daemon.getWorkflowEngine().listWorkflows()`. **Daemon: YES.**

**workflow.start** — L3604 — `{name?, workflow?, input?}` — Searches builtins, then custom dir, then accepts inline workflow. **Daemon: YES.** S1-11 fix. Real.

**workflow.save** — L3637 — `{name, workflow}` — Validates name against `/^[a-zA-Z0-9_-]+$/`, writes to `~/.wotann/workflows/<name>.yaml`. Good.

**workflow.status** — L3659 — `{runId}` — `engine.getRun(runId)`. **Daemon: YES.**

### 3.13 Chat / iOS

**chat.send** (streaming) — L618 — Dispatched pre-Map in `handleMessage` via `handleChatSend`. Validates images (A9 guard), streams runtime.query output.

**chat.send** (non-streaming) — L2705 — `{content|prompt|message, provider?, model?}` — Aggregates runtime.query output; same A9 image validation. **Runtime: YES.**

**conversations.list** — L2738 — **Alias for `session.list`.**

**cost.snapshot** — L2741 — **Alias for `cost.current`.**

**task.dispatch** — L2744 — **Alias for `agents.spawn`.**

**task.approve** — L2748 — `{taskId|id}` — Accepts + marks in-progress. **Runtime: YES.** Side-effecting. No caller-identity check beyond session-token (hardcoded "ios-user").

**task.reject** — L2757 — `{taskId|id}` — Marks delegation as failed ("Rejected by user"). **Runtime: YES.**

**task.cancel** — L2775 — `{taskId|id}` — Marks as cancelled. **Runtime: YES.**

### 3.14 Shell / Execute

**execute** — L2805 — `{cmd|command, cwd?, allowPrivileged?, timeoutMs?}` — Sanitizes command via `sanitizeCommand()`, then spawns `sh -c`. **Runtime: NO.** CRITICAL attack surface. Mitigations in place: sanitizer (B5), 30s default timeout clamped 100ms–300s, `cwd` defaults to process.cwd. **RESIDUAL RISK:** `cwd` is caller-supplied without workspace containment. An attacker who gets past the sanitizer (e.g. a command the sanitizer doesn't recognize as destructive) could run it anywhere on the filesystem. Suggest: clamp `cwd` to workspace root.

**shell.precheck** — L2866 — `{cmd|command, allowPrivileged?}` — Returns sanitizer verdict without spawning. Good.

### 3.15 Autonomous

**autonomous.run** — L2885 — `{task|prompt}` — Wires runtime.query into AutonomousExecutor with real per-turn cost tracking + verification cascade. **Runtime: YES.** Real. Good.

**autonomous.cancel** — L5068 — `{taskId?}` — Calls executor.cancel(taskId) + ext().abortActiveQueries(). **Runtime: YES.**

### 3.16 LSP / Symbols

**lsp.symbols** — L3189 — `{name}` — `SymbolOperations.findSymbol()`. **Runtime: YES (for workspaceRoot).** Real.
**lsp.outline** — L3200 — `{uri|file}` — `SymbolOperations.getDocumentSymbols()`. Real.
**lsp.refs** — L3211 — `{uri|file, line?, character?}` — Real.
**lsp.hover** — L3224 — `{uri|file, line?, character?}` — Real.
**lsp.rename** — L3237 — `{uri|file, line?, character?, newName}` — Workspace-wide rename. **Runtime: YES.** HIGH RISK: writes to every file touched by the rename. SymbolOperations performs the safety checks — no workspace containment check HERE. Trusted-subsystem risk.

### 3.17 Repo / Files

**repo.map** — L3254 — `{root?, maxBytes?}` — Calls `buildRepoMap()`. Note: accepts any `root` from the caller, not clamped to workspace. Read-only so low risk.

**files.search** — L4604 — `{query, limit?}` — `daemon.getSmartFileSearch().search()`. **Daemon: YES.**

**files.impact** — L4747 — `{file}` — FileDependencyGraph impact analysis. **Daemon: YES.**

**files.hotspots** — L4760 — `()` — Top 20 hotspots. **Daemon: YES.**

### 3.18 Composer / Shadow

**composer.apply** — L3311 — `{edits:[{path, newContent, acceptedHunkIds?}]}` — Writes files. **PATH-TRAVERSAL + SYMLINK hardening in place** (S2-5): rejects degenerate workspace roots `/` and `""`, requires `resolved.startsWith(workspaceRoot + /)`, and re-checks realpath on parent dir to catch symlinked-into-workspace attacks. Very strong. This handler is a good model for all write-path RPCs.

**composer.plan** — L4144 — `{edits}` — Dry-run diff preview via `simpleLineDiff`. Also workspace-scoped. Good.

**shadow.undo** — L4185 — `{toolName}` — Calls `shadowGit.restoreLastBefore(toolName)`. **Runtime: YES.** Real.

**shadow.undo-turn** — L4227 — `{turnsBack?}` — Walks checkpoint ring-buffer, restores Nth-latest. **Runtime: YES.** Real.

**shadow.checkpoints** — L4275 — `()` — Lists recent checkpoints. **Runtime: YES.**

### 3.19 Proofs

**proofs.list** — L4368 — `()` — Reads `{workingDir}/.wotann/proofs/*.json`. **Runtime: YES (for workingDir).** Read-only.

**proofs.reverify** — L4308 — `{id}` — Validates id against `/^[a-zA-Z0-9_-]+$/`, loads bundle, re-runs cascade, writes sibling `.reverified-<ts>.json`. **Runtime: YES.** Good path-traversal guard.

### 3.20 MCP

**mcp.list** — L3287 — `()` — Reads mcpServers from wotann.yaml. **Runtime: NO.** Read-only.

**mcp.toggle** — L3401 — `{name, enabled?}` — Flips `enabled` flag. **Runtime: NO.** Side-effecting; caller-supplied name is only looked up in existing map, so no path injection.

**mcp.add** — L3427 — `{name, command, args?, transport?}` — Writes new server config. **Runtime: NO.** CRITICAL: `command` and `args` are stored as-is; when the MCP engine later spawns this server, it runs an arbitrary command. The RPC itself doesn't execute, but it's persistence of an arbitrary command for later execution. Should gate on a caller-identity check or at least warn.

### 3.21 Voice

**voice.status** — L3495 — `()` — `runtime.getVibeVoiceBackend().detect()`. **Runtime: YES.**

**voice.transcribe** — L3979 — `{audioPath}` — Single-shot via VoicePipeline. **Runtime: NO (uses module singleton).** SECURITY: `audioPath` is caller-supplied — no workspace containment. VoicePipeline will read whatever path is given. Data exfil risk: a caller could convince the daemon to read `/etc/passwd` as "audio" — it'd fail STT but the file would be accessed. Low severity but still a concern.

**voice.stream.start** — L4020 — `{audioPath?}` — Opens polling stream id. Same audioPath concern.
**voice.stream.poll** — L4074 — `{streamId, cursor?}` — Drains chunks.
**voice.stream.cancel** — L4092 — `{streamId}` — Stops + deletes.
**voice.stream** — L4112 — `{audioPath}` — Single-shot alias.

### 3.22 Self-Improvement

**feedback.record** — L3682 — Real FeedbackCollector call.
**patterns.list** — L3707 — `()` — PatternCrystallizer. Real.
**training.extract** — L3721 — `()` — TrajectoryExtractor. Real.
**evolution.pending** — L3737 — `()` — SelfEvolutionEngine pending. Real.
**evolution.approve** — L3753 — `{index}` — Validates non-negative integer. Real.
**evolution.reject** — L3772 — `{index}` — Same. Real.
**skills.forge.triggers** — L3791 — `()` — SkillMerger triggers.
**skills.forge.run** — L3816 — `()` — SkillMerger.runMerge.
**skills.merge** — L4415 — `()` — Alias of forge.run with different return shape.
**skills.list** — L2341 — `()` — SkillRegistry.
**skills.search** — L3540 — `{query}` — SkillRegistry search.

### 3.23 Completion

**completion.suggest** — L3850 — `{prefix, suffix, language, maxTokens?}` — Runtime query with FIM-style prompt + session-scoped cache. **Runtime: YES.** Real.

**completion.accept** — L3933 — `{id?, characters}` — Atomic-write to `~/.wotann/completion-stats.json`. **Runtime: NO.** Good.

### 3.24 Surface / Phase 1A–4

**flow.insights** — L4442 — FlowTracker. **Daemon: YES.**
**health.report** — L4458 — lastHealthReport fallback to runtime.analyzeHealth. Real.
**decisions.list** — L4471 — DecisionLedger search/list. Real.
**decisions.record** — L4482 — runtime.recordDecision. Real. Validates title/description/rationale.
**spec.divergence** — L4502 — LivingSpecManager. **Daemon: YES.**
**pwr.status** — L4519 — PWREngine. **Daemon: YES.**
**pwr.advance** — L4531 — `{message}` — PWR.processMessage. Real.
**ambient.status** — L4541 — AmbientAwareness. **Daemon: YES.**
**idle.status** — L4553 — IdleDetector. **Daemon: YES.**
**crossdevice.context** — L4566 — CrossDeviceContext. **Daemon: YES.**
**triggers.list** — L4581 — EventTriggerSystem. **Daemon: YES.**
**triggers.load** — L4590 — `{configPath}` — loads trigger config. **Daemon: YES.** SECURITY: `configPath` is unvalidated — same path-traversal concern as other file-load handlers.

**route.classify** — L4617 — runtime.classifyAndRoute. Real.
**search.parallel** — L4625 — runtime.searchAll. Real.
**action.check** — L4633 — `{tool, args?}` — confirm-action gate.
**action.pending** — L4643 — pending approvals queue.
**prompts.adaptive** — L4687 — `{model}` — AdaptivePrompts tier.
**benchmark.history** — L4700 — `{type}` — Benchmark history.
**benchmark.best** — L4708 — `{type}` — Best score.
**wakeup.payload** — L4716 — L0+L1 context payload.

### 3.25 Tier 2A

**context.pressure** — L4724 — ContextPressureMonitor.
**terminal.lastError** — L4735 — TerminalMonitor last error.
**terminal.suggestions** — L4741 — 10 most recent errors.

### 3.26 iOS Surface

**git.status** / **git.log** / **git.diff** / **git.branches** — L4855–L4934 — Spawn `git` with safe argument lists (no shell interpolation). Good. Accept `path` from caller — SECURITY: `path` is unvalidated; git will run in whatever directory. Read-only, so lower severity.

**screen.capture** — L4959 — `ext().getComputerBindings().screenshot()`. **Runtime: YES (optional ext).**
**screen.input** — L4976 — click/move/scroll via bindings. **POWERFUL** — can synthesize mouse input. Session-token-gated only.
**screen.keyboard** — L5002 — typeText + keyPress. **POWERFUL** — session-token-gated only.

**briefing.daily** — L5016 — MorningBriefing or fallback aggregation. Real.

**meet.summarize** — L5043 — `{meetingId?, transcript?}` — Summary via runtime.query. Real.

**security.keyExchange** — L5124 — `{publicKey, sessionId?}` — **ECDH P-256 + HKDF-SHA256** with salt `"wotann-v1"` matching iOS CryptoKit. Good. 24h session expiry.

**continuity.frame** — L5162 — **Semi-stub** — counts bytes, discards frame data.
**continuity.photo** — L5179 — `{photo, sessionId?, metadata?}` — Writes to `~/.wotann/continuity/photo-*.jpg`. **Runtime: NO.** SECURITY: filename is `photo-${Date.now()}-${Math.random()…}.jpg` — safe. But the JPEG itself is not validated (no magic-byte check — this is inconsistent with `validateBase64Image` defined at top of file which DOES validate PNG/JPEG/WebP/GIF magic bytes). Should use `validateBase64Image`.

**node.register** — L5207 — `{nodeId, deviceId?, capabilities?}` — In-memory registry. Low risk.
**node.error** — L5223 — `{requestId, error}` — Resolves pending node request. No validation of requestId ownership.
**node.result** — L5235 — `{requestId, result}` — Resolves pending node request. Same.

**clipboard.inject** — L5248 — `{text}` — Sets clipboard via bindings or pbcopy/xclip fallback. SECURITY: can inject arbitrary text into the user's clipboard — low severity but could be chained with a screen.keyboard paste to execute text as commands. Should log these events for auditability.

**notifications.configure** — L5281 — Persists prefs to `~/.wotann/notifications.json` with 0o600. Good.

**quickAction** — L5339 — `{action, args?}` — **SIRI_ALLOWLIST** gates wildcard dispatch (post-Opus-audit hardening). Non-allowlisted actions fall through to a natural-language runtime.query. Good. 17 methods in allowlist — all read-only / low-risk. 

### 3.27 Misc

**doctor** — L2402 — runtime/node/memory health. Read-only.
**workspaces.list** — L2419 — Scans ~/Desktop, ~/Documents, etc. for `.wotann` dirs. Read-only.
**plugins.list** — L2458 — Builds list from lifecycle hooks. Read-only.
**connectors.list** — L2494 — Channel health. Read-only.
**connectors.save_config** — L2518 — Persists to wotann.yaml. Validated-shape (connectorType required).
**connectors.test** — L2543 — Reports current health. Read-only.
**cron.list** — L2568 — **PURE STUB.** `{ jobs: [] }`.
**dream** — L2680 — Daemon.getDreamPipeline().runPipelineSync(). Real.
**audit.query** — L3456 — AuditTrail query. No cap on limit.
**precommit** — L3479 — runtime.runPreCommitAnalysis. Real.
**local.status** — L3509 — Probes localhost:11434 for Ollama. Real.
**train.extract** — L3557 — TrainingPipeline.extractTrainingData. Real.
**train.status** — L3567 — TrainingPipeline.getStats.
**ping** — L3574 — `{pong:true, timestamp}`. Correct.
**workers.status** — L4355 — BackgroundWorkerManager. Real.

---

## 4. Stub vs Real Matrix (summary)

| Status | Count | Method names (examples) |
|---|---|---|
| Pure stub | **1** | `cron.list` |
| Semantic / partial stub | **6** | `channels.start`, `channels.stop`, `context.info` (sources), `continuity.frame`, `session.create`, `plugins.list` (enabled:true always) |
| Dead code | **1** | `providers.list.legacy` |
| Best-effort with fallback | ~22 | Various — return `[]` on error |
| Thin wrapper over runtime.query | **3** | `research`, `architect`, `enhance` (when enhancer fails) |
| Aliases | **3** | `conversations.list`, `cost.snapshot`, `task.dispatch` |
| Fully wired real | ~115 | Everything else |

---

## 5. Zero-Caller Candidates

I cannot definitively list zero-caller handlers without grepping the entire codebase for each method name; that's beyond this file. However these handlers look unused from internal evidence:

- **`providers.list.legacy`** — L1441 — explicitly marked "superseded." Dead.
- **`cost.snapshot`** — L2741 — pure alias; no distinct caller visible in this file.
- **`task.dispatch`** — L2744 — pure alias.
- **`conversations.list`** — L2738 — pure alias.
- **`session.create`** — L2651 — returns a fabricated id no subsystem tracks; any caller would be unable to look the session up later via `session.resume`.
- **`node.error` / `node.result`** — L5223/L5235 — require a `pendingNodeRequests` entry to have been set elsewhere (no `.set()` is visible in this file), so in the current wiring they're always no-ops.
- **`cron.list`** — L2568 — returns `[]` always; useful only if there's a UI that relies on the shape.

A follow-up grep across `desktop-app/`, `companion-server/`, and the iOS codebase would confirm which are truly dead.

---

## 6. Security Issues by Method

### 6.1 Critical (S1 / data-loss or RCE)

- **composer.apply** (L3311) — **HARDENED** (S2-5): workspace containment + realpath parent + degenerate-root guard. Keep as model.
- **execute** (L2805) — Sanitizer gate (B5); 300s timeout cap. **RESIDUAL: `cwd` not clamped to workspace.** Recommend: reject `cwd` outside workspace.
- **mcp.add** (L3427) — Persists arbitrary `command` + `args` that MCP engine will later spawn. Session-token-gated but no further checks. Recommend: require confirmation via action.check first.

### 6.2 High (S2 / privilege or data exfil)

- **agents.submit** (L2123) — `workingDir` unvalidated. Background agent runs there.
- **automations.create** / **automations.update** (L2587/L2610) — agentConfig shape not validated; can persist arbitrary configs with unsafe workingDir.
- **screen.input** / **screen.keyboard** (L4976/L5002) — synthetic input. Session-token-gated but no per-call confirm.
- **clipboard.inject** (L5248) — paired with screen.keyboard could type+paste to shell. Log+rate-limit.
- **lsp.rename** (L3237) — workspace-wide file writes (delegated to SymbolOperations).
- **voice.transcribe** / **voice.stream.start** (L3979/L4020) — unvalidated `audioPath`.
- **auth.import-codex** (L1217) — unvalidated `path`.
- **providers.import** (L1432) — unvalidated `path`.
- **triggers.load** (L4590) — unvalidated `configPath`.

### 6.3 Medium (S3 / misleading behavior)

- **channels.start** / **channels.stop** — claim to act but don't.
- **agents.spawn** — fake-success on delegation failure.
- **task.approve** / **task.reject** / **task.cancel** — hardcode `"ios-user"` as the approver; any session-token holder can approve.
- **continuity.photo** — no magic-byte check (inconsistent with `validateBase64Image` helper defined at top of file).

### 6.4 Low

- **config.set** — accepts arbitrary keys (no allowlist). Low impact.
- **audit.query** — no cap on `limit`. Could DoS the daemon with a huge query, but SQLite handles it.
- **arena.run** — fabricates `costUsd` from `content.length * 0.00004`.

---

## 7. Recommended Fixes

In priority order:

**P0**:
1. **Clamp `execute.cwd`** to inside the workspace root; reject otherwise.
2. **Validate `continuity.photo`** with `validateBase64Image` before writing to disk.
3. **Remove or rename `channels.start`/`channels.stop`** — either make them connect/disconnect the adapter or rename to `channels.health`.
4. **Kill `providers.list.legacy`** — dead code.
5. **Add structural validation to `automations.create/update`** — at minimum check `agentConfig.workingDir` is inside the workspace.

**P1**:
6. **Workspace-contain all path params**: `auth.import-codex.path`, `providers.import.path`, `voice.transcribe.audioPath`, `voice.stream.start.audioPath`, `triggers.load.configPath`, `agents.submit.workingDir`, `git.*.path`.
7. **Wire `session.create`** to actually register the session with the runtime, OR rename to `session.stub` if truly intended to be a no-op.
8. **Populate `context.info.sources`** with real sources from the runtime.
9. **Process `continuity.frame` data** — currently discards the payload.
10. **Log `clipboard.inject`** events and add rate limiting.

**P2**:
11. **Replace `quickAction` fallback to runtime.query with an explicit "unknown action" error** — natural-language fallback widens the attack surface for Siri.
12. **Validate `mcp.add.command`** — at minimum check it's an absolute path or a name with no shell metacharacters.
13. **Cap `audit.query.limit`** at e.g. 10,000.
14. **Resolve `agents.spawn` fake-success** — return a real error envelope.
15. **Track real `arena.run` costs** — call the cost tracker instead of fabricating.
16. **Confirm zero-caller handlers** via `gh search code` across desktop-app + iOS repos, then delete unreachable ones.

**P3**:
17. Add per-method rate limits to the iPC layer for `screen.*`, `clipboard.inject`, `security.keyExchange`.
18. Emit audit-trail events for all mutating methods (composer.apply, agents.submit, automations.*, config.set, providers.saveCredential, etc.). Many already do; standardize.

---

## 8. Additional Findings

### 8.1 Streaming Path (query + chat.send)

The two streaming methods (`query` at L245, `chat.send` at L618) are NOT registered in the `handlers` Map — they're dispatched pre-Map by `handleMessage`. Both have a three-layer fallback: **runtime.query → Codex CLI via stdin → Ollama local**. Security:
- Codex CLI path spawns `codex exec` with `model="${codexModel}"` — the model name is NOT sanitized. An attacker who controls `params.model` could inject shell metacharacters via the `-c` argument. RECOMMEND: validate model against a whitelist regex.
- The Ollama path fetches `${ollamaHost}/api/chat` with `ollamaHost = process.env["OLLAMA_HOST"] ?? "http://localhost:11434"` — safe default.

### 8.2 JWT Verification

`verifyCodexJWT` (L214) does 4 offline defence-in-depth checks (3-part, JSON payload, exp, iss). `verifyCodexJWTSignature` (L376) adds JWKS fetch + RS256 verify with 1-hour in-memory cache. Solid. Fire-and-forget signature verify during discovery (`void verifyCodexJWTSignature(idToken).then(...)`) is correct — blocking discovery on a network call would hurt UX.

### 8.3 Image Validation

`validateBase64Image` (L410) checks base64 decode, size < 20MB, magic bytes for PNG/JPEG/WebP/GIF. Invoked from `chat.send` and the streaming `handleChatSend`. But NOT from `continuity.photo` (see §6.3).

### 8.4 Voice Streams

Voice-stream map is module-global (`voiceStreams` at L72). `pruneStaleVoiceStreams` GCs after 10 min. Per-session state was flagged in CLAUDE.md as a violation of "per-session state not module-global." CURRENT CODE STILL USES MODULE-GLOBAL — not fixed. A cross-call stream hijack is possible if an attacker can predict a streamId: stream ids use `Date.now().toString(36)-Math.random().toString(36).slice(2,8)` — 48 bits of entropy, probably fine but not cryptographically strong.

### 8.5 ECDH Session Pruning

`security.keyExchange` (L5124) prunes sessions older than 24h. Good.

### 8.6 Redundant Session.Create Registration

The comment at L1319 notes "The canonical session.create handler is registered further below (see ~L1731). The earlier duplicate registered here was dead — Map.set silently overwrote it — and has been removed as part of C5 cleanup." The canonical is actually at L2651 now (not L1731). This is a **stale comment**.

### 8.7 Non-Handler Helper Functions Defined at Module Scope

- `simpleLineDiff` (L93) — two-pass set-based diff. Naive but fine for UI preview.
- `validateBase64Image` (L410), `detectImageMime` (L466), `validateImageParams` (L499).
- `verifyCodexJWT` (L214), `fetchJWKS` (L311), `verifyCodexJWTSignature` (L351).
- `getVoicePipeline` (L52) — lazy singleton.
- `pruneStaleVoiceStreams` (L73).

### 8.8 Session-Global State in the Handler Class

- `nodeRegistry` (Map<string, NodeRegistryEntry>) — L173
- `pendingNodeRequests` (Map<string, PendingNodeRequest>) — L174
- `ecdhSessions` (Map<string, ECDHSession>) — L175
- `frameBuffer` (ContinuityFrame[]) — L176

These are CLASS instance state, not module globals — correct. But `voiceStreams` (L72) IS module-global and violates the session-2 quality bar from MEMORY.md.

### 8.9 Prefer `Object.freeze` Pattern

Per coding-style immutability rules, mutable class state should be avoided. The handler Map (L159) and the 4 state Maps/arrays above are all mutable. Reasonable for an in-memory dispatcher, but consider whether `pendingNodeRequests` should move to per-session lifetimes.

---

## 9. Conclusion

The kairos-rpc.ts file is substantially healthier than earlier audit sessions implied. Of the 10 "pure stubs" listed in the task prompt, only **1 remains pure** (`cron.list`). Four are semantic stubs (do less than their name implies), four are fully wired. The dominant remaining risks are:

1. **Path-traversal gaps** across a dozen handlers that accept caller-supplied paths without workspace containment (execute.cwd, agents.submit.workingDir, voice.*.audioPath, triggers.load.configPath, auth.import-codex.path, providers.import.path, git.*.path).
2. **Misleading-success handlers** (`channels.start/stop`, `agents.spawn` fake-success, `session.create` without persistence).
3. **Inconsistency** — image validation is used for chat but not continuity.photo.
4. **One module-global state** (`voiceStreams`) violates the session-2 per-session rule.

Total handler count **156** (not 153). Security footprint, as of 2026-04-18, is dominated by the ten iOS-surface handlers (git.*, screen.*, clipboard.inject, continuity.*, node.*, notifications.*, quickAction) plus the mutating core (execute, composer.apply, config.set, providers.saveCredential, agents.submit, automations.*). The strongest hardened method is `composer.apply` (S2-5 workspace-contain + realpath + degenerate-root guard) — use it as the template for fixing the others.

**File pointer:** `/Users/gabrielvuksani/Desktop/agent-harness/wotann/docs/KAIROS_RPC_FULL_DEEP_READ_2026-04-18.md`
