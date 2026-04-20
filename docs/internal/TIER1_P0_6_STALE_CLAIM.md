# P0-6 Listener Leak Claim — STALE (2026-04-20)

## TL;DR

MASTER_PLAN_V8.md §4 P0-6 ("73 `.on()` / 0 `.off()` → 2GB RSS growth in 30 days")
does NOT match the current codebase. No listener-registry fix was written.
The real concern (unbounded SQLite table growth) is a separate problem
handled by memory work, not listener-registry work.

## Verification (by agent a075383ceb9ff84f8, 2026-04-20)

### `.on()` counts vs plan claim

| Scope | Actual count | Plan claim |
|---|---|---|
| Allow-list (daemon / telemetry / auto-capture / intelligence / arena) | **22** | 73 |
| Whole `src/` | 105 | — |

### The 22 in-scope `.on()` are all Node stdlib lifecycle hooks

- `process.on("SIGINT"|"SIGTERM"|"exit")` — already paired with `process.removeListener` at `src/daemon/kairos.ts:2204-2206` (comment at 2152-2159 explains this is for vitest).
- `socket.on("data"|"close"|"error")` — bounded by socket lifetime.
- `server.on("error")` — bounded by server lifetime.
- `stdout/stderr.on("data")`, `proc.on("close"|"error")` — bounded by subprocess lifetime.

None is a pub/sub topic with unbounded-accumulation pattern.

### The four "hot topics" do not exist as listener surfaces

- **`audit_trail`**: SQLite append-only log in `src/telemetry/audit-trail.ts`. Zero `.on()`, zero `EventEmitter`. Already has `prune(olderThanDays)` retention at line 159-168.
- **`auto_capture`**: SQLite table in `src/memory/store.ts:358`. Writes via INSERT. Has `consolidated_at` bookkeeping and consolidation job invoked from `kairos.ts:277-281, 1547`.
- **`trace-analyzer`**: `src/intelligence/trace-analyzer.ts` (362 LOC). Zero `.on()`, zero `EventEmitter`.
- **`arena-leaderboard`**: Directory `src/arena/` and file `arena-leaderboard.*` do not exist anywhere in `src/`. Fictional.

### Existing cleanup usage

28 `removeListener`/`removeAllListeners` occurrences across 10 files (e.g. `kairos.ts:2204-2206`, `orchestration/agent-registry.ts` 5×, `core/handoff.ts` 3×). The codebase already practices listener cleanup where EventEmitters exist.

## Why the claim doesn't hold

The "73 `.on()` / 0 `.off()`" figure likely came from:
1. A pre-refactor codebase state (the file count and structure have changed substantially since the audit was written)
2. Counting the whole `src/` (which is 105, still not 73)
3. A sibling repo's audit that didn't apply here

## Real concern (out of P0-6 scope)

Unbounded growth in the SQLite-backed tables (`audit_trail` row count, `auto_capture` row count, `memory_entries` row count) IS a real risk on long-running daemons. The fix is:

1. Enforce TTL on `audit_trail` via a periodic `auditTrail.prune(30)` cron tick (already implemented; just needs default wiring).
2. Cap `auto_capture` row count with FIFO eviction.
3. Review `memory_entries` retention strategy.

Scope owner: memory work agent(s). Task: future P1-M8 extension.

## Plan correction

Update MASTER_PLAN_V8.md §4 P0-6 to either:
- **(a)** RESOLVED / STALE with link to this ERRATA, OR
- **(b)** Reclassify as "SQLite table TTL enforcement" under P1-M8 instead of P0-6.

## Commit impact

No commit created. Tree remains clean at `329e8f0`. Phase 1 P0 count revised from 11 real items to 10 real items + 1 stale claim.
