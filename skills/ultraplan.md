---
name: ultraplan
description: Extended-thinking planning for complex WOTANN architecture and migration problems
context: fork
paths: []
---

# ULTRAPLAN

## When to Use

- Architecting a new WOTANN subsystem that crosses 5+ existing modules.
- Rewriting a critical path (e.g., `src/providers/router.ts`) with irreversible consequences.
- Planning a phase of the mega-plan (`~/.claude/plans/glistening-wondering-nova.md`).
- Designing a migration (SQLite schema, memory taxonomy, provider API v2).
- Deciding between competing architectures with long-term lock-in (TurboQuant vs. alternatives).

## Rules

- Offload planning to the most capable model (Opus + 1M context) — never a smaller one.
- Allocate extended thinking budget (>=10K tokens, up to 50K for mega-plans).
- Each phase must declare acceptance criteria and a rollback plan.
- Adversarially review the plan before execution (dispatch `critic` agent).
- Record the plan to `plans/<slug>.md` for later session recovery.
- Never start implementation until the plan has been reviewed and approved.

## Patterns

- **Phase decomposition**: split into 3-7 phases, each with its own checkpoints.
- **Dependency graph**: list upstream/downstream for every phase to unlock parallelism.
- **Acceptance criteria**: each phase has a measurable "done" signal.
- **Rollback plan**: every phase has an inverse operation documented.
- **Review loop**: `planner` -> `critic` -> revise -> `critic` again until green.

## Example

```
ULTRAPLAN: Migrate WOTANN memory from JSONL to SQLite+FTS5
  budget: 25K thinking tokens
  phases:
    1. Design schema (depends: none)          accept: schema diff reviewed
    2. Build migration tool (depends: 1)      accept: dry-run on sample data
    3. Dual-write adapter (depends: 2)        accept: parity tests pass
    4. Cutover + verify (depends: 3)          accept: 7 days of shadow reads
    5. Decommission JSONL path (depends: 4)   accept: feature flag removed
  rollback: re-enable JSONL reader, flip read path via config flag
  review: critic agent -> 2 rounds -> approved 2026-04-13
```

## Checklist

- [ ] Plan written to `plans/<slug>.md`.
- [ ] Every phase has acceptance criteria and rollback steps.
- [ ] Dependency graph shows parallel vs. serial phases.
- [ ] `critic` agent has reviewed and signed off.

## Common Pitfalls

- Skipping acceptance criteria — "done when it feels right" leads to scope drift.
- Designing only the happy path; a phase without rollback is a one-way door.
- Starting implementation before `critic` review; rework cost far exceeds planning cost.
