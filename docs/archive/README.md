# Archive

Historical documents kept for context but no longer load-bearing.
The active documentation lives one level up at `docs/`.

This archive collects:

- **Dated audit / plan docs** — frozen-in-time reports from earlier
  V9 cycles (Apr 18, Apr 19, Apr 20). Useful for tracing how a
  specific decision was reached, but the conclusions are baked into
  `docs/MASTER_PLAN_V9.md` itself.
- **Superseded execution plans** — v2/v3/v4 of the autonomous-
  execution plan that V9 replaced. Kept so anyone digging through
  `git log` can read the contemporary intent rather than guessing.
- **One-shot extraction docs** — research outputs (competitor
  extraction lanes, benchmark beat strategy) that fed into V9 and
  no longer need to be a top-level doc.

## Triage policy

Move a doc into `archive/` when ALL THREE are true:

1. The doc has a date in its filename, OR a "Status: archived" note
   in its first 5 lines.
2. The conclusions / decisions it captures are reflected in
   `docs/MASTER_PLAN_V9.md` or another active source-of-truth doc.
3. No file in `src/` or `tests/` references it.

When in doubt, leave the doc in `docs/`. The archive is a one-way
move — once moved, the doc is documented as historical.
