# Phase 5 Codex + Goose Parity — Progress

**Target scope**: ~15 days. Shipping the highest-ROI subset in this session; remainder scheduled for follow-up.

## Shipped this session

| Item | Status | Commit |
|---|---|---|
| `thread/fork` (ConversationBranchManager.fork) | ✅ (pre-existed) | n/a |
| `thread/rollback(n)` + `rollbackToTurn(id)` | ✅ **shipped** | `903a42a` |
| `request_rule` — pattern approval engine | ✅ **shipped** | next |

## Remaining

Ordered by ROI × unblock-chain:

1. **ACP host compliance** (~600 LOC) — partially wired at `src/acp/runtime-handlers.ts` (sessions + prompt + cancel). Missing: tool-call routing, fs-permission boundary, session-resumption handshake with real IDE hosts (Zed, Kiro).
2. **wotann mcp-server mode** — inverse of MCP client: expose WOTANN's tool surface (memory, skills, providers) via MCP over stdio so Cursor/Claude-Code can embed WOTANN. Stub in `src/marketplace/registry.ts` — needs protocol shim.
3. **unified_exec PTY tool** — persistent shell session across multiple tool calls. Existing `src/sandbox/executor.ts` is fire-and-forget; unified_exec reuses env + cwd between calls. Requires `node-pty` dep.
4. **shell_snapshot cache** — caches `env`, `cwd`, `PWD`, `HISTFILE` between `unified_exec` calls. Prerequisite for (3).
5. **Expanded sandbox backends** — currently ship Docker + seatbelt (macOS). Missing: Daytona, Modal, Singularity, SSH-based, local-landlock. Each is a separate adapter implementing `src/sandbox/execution-environments.ts:ExecutionEnvironment`.

## Quality bar check

- **Immutable patterns**: rollback returns new branch + dropped-turns array, never mutates in place (immutable-safe)
- **Many small files**: approval-rules.ts 214 LOC, rollback adds 37 LOC to existing 230 LOC file → both under 400 LOC target
- **TDD**: 9 tests for rollback, 20 for approval-rules, all pre-written and red-before-green
- **No vendor-biased fallbacks**: approval rules are pattern-based, not provider-specific
- **No module-global state**: engine is per-instance; now() injectable for tests

## Integration notes

`src/acp/runtime-handlers.ts` currently has no RPC binding for `thread/rollback` — the method exists on `ConversationBranchManager` but no protocol endpoint routes to it. Wiring it up is a 20-LOC change in the handlers + 1 protocol method in `src/acp/protocol.ts` — tracked as a follow-up so this session's 17-task queue keeps moving.

`src/sandbox/approval-rules.ts` is consumed by neither `src/sandbox/security.ts` nor `src/sandbox/executor.ts` yet — both currently ask the user before every risky action. Wiring it in means one conditional check per executor entry point. Tracked as a follow-up.

## Ship target

Full Phase 5 parity lands in v0.5.0 (post-launch). Current v0.4.0 release scope ships with rollback + approval-rules as two of the Phase 5 value-props checked.
