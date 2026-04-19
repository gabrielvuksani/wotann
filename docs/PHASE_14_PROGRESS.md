# Phase 14 Zero-Deletion Dead-Code Audit — Progress

**Source doc**: `docs/DEAD_CODE_REPURPOSING_2026-04-18.md` (14 modules, ~3,600 LOC rescued, 30-45h estimated).

## Current wiring status (verified this session)

| # | Module | Original claim | Actual state | Action |
|---|---|---|---|---|
| 1 | meet/coaching-engine.ts | DEAD | DEAD | deferred |
| 2 | meet/meeting-pipeline.ts | DEAD | DEAD | deferred |
| 3 | meet/meeting-store.ts | DEAD | ✅ referenced in kairos-rpc.ts | already wired |
| 4 | autopilot/completion-oracle.ts | DEAD | ✅ referenced in runtime.ts + terminal-bench.ts + benchmark-harness.ts | already wired |
| 5 | autopilot/pr-artifacts.ts | DEAD | ✅ exported from lib.ts | already wired |
| 6 | computer-use/perception-adapter.ts | DEAD | DEAD → ✅ exposed via lib.ts this session | exported |
| 7 | skills/self-crystallization.ts | DEAD | DEAD → ✅ exposed via lib.ts this session | exported |
| 8 | channels/route-policies.ts | DEAD | ✅ referenced in channel-types.ts + unified-dispatch.ts | already wired |
| 9 | channels/auto-detect.ts | DEAD | REFACTOR deferred | deferred |
| 10 | channels/terminal-mention.ts | DEAD | ✅ exported from lib.ts | already wired |
| 11 | testing/visual-diff-theater.ts | DEAD | ✅ exported from lib.ts | already wired |
| 12 | agents/required-reading.ts | DEAD | DEAD → ✅ exposed via lib.ts this session | exported |
| 13 | training/autoresearch.ts no-op gen | DEAD | ✅ wired via llm-modification-generator (Phase 1 session) | already wired |
| 14 | kairos-rpc.ts getMeetingStore cb | DEAD | ✅ active | already wired |

## Progress summary

- **8 of 14 modules**: already wired in prior sessions (session 1-5 had done more than the audit doc captured)
- **3 of 14 modules**: exposed via lib.ts public API this session (perception-adapter, self-crystallization, required-reading) — callers can now import from `wotann/lib`
- **3 of 14 modules**: deferred to future sessions (meet trilogy needs a meeting-runtime composer; channels/auto-detect needs a 13-adapter extension)

## What "exposed via lib.ts" actually means

The 3 modules now have public API surface:
- Consumer code can `import { crystallizeSuccess } from "wotann/lib"` instead of reaching into src/
- Types + classes are reachable to plugin authors
- Still not WIRED into runtime success paths — autopilot success handler doesn't yet call `crystallizeSuccess`, Desktop Control doesn't yet pass outputs through `PerceptionAdapter.adapt()`, and agent prompts don't yet load `required-reading` blocks

## Remaining wiring (v0.5.0 scope)

1. **meet/ trilogy composer** (2-3h) — `src/meet/meeting-runtime.ts` that wires coaching-engine + meeting-pipeline + meeting-store. Instantiate in KairosDaemon.
2. **channels/auto-detect extension** (4-6h) — expand from 4 to 13 adapters, remove 150 LOC of manual wiring in kairos.ts:750-867.
3. **perception-adapter runtime integration** (1h) — insert `PerceptionAdapter.adapt()` between PerceptionEngine and ComputerAgent.
4. **self-crystallization autopilot hook** (1h) — call `crystallizeSuccess()` after successful completion-oracle verification, gated on >N cycles or >M files changed.
5. **required-reading prompt hook** (1h) — prepend `renderRequiredReadingBlock()` output to agent system prompt when task YAML declares `required_reading`.

## Integrity check

Despite this session's focus on extending OTHER modules, none of the DEAD list was DELETED. Zero-deletion mandate preserved. 8 modules found to be already-wired in the existing codebase + 3 exposed this session = 11 of 14 actively discoverable now.
