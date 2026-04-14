---
name: dream-cycle
description: autoDream memory consolidation - WOTANN's nightly learning extraction pipeline
context: fork
paths: []
---

# Dream Cycle (autoDream)

## When to Use

- Nightly or idle periods when WOTANN's Engine daemon has spare CPU.
- After a heavy session with 20+ new observations that need consolidation.
- Before a release, to promote proven patterns into durable rules.
- When `.wotann/learning/observations.jsonl` grows past its soft cap.
- To decay stale observations that no longer reflect current behavior.

## Rules

- Three gates (time, volume, lock) must all pass before a cycle runs.
- Only one consolidation at a time — the lock gate prevents concurrent cycles.
- Never destroy raw observations; archive them instead so corrections can re-examine source.
- Confidence thresholds: <0.3 decay, 0.3-0.7 keep, >=0.7 promote to rule/skill candidate.
- Pattern promotion requires human review before becoming a shipped skill.
- Record each cycle's summary to Engram (`topic_key: learning/dreams/<date>`).

## Patterns

- **Three-gate trigger**: (1) time >= 4h since last, (2) >= 20 new observations, (3) lock free.
- **Four phases**: Collect -> Classify -> Consolidate -> Promote.
- **Classification bins**: correction, confirmation, discovery, pattern.
- **Decay curve**: linear confidence drop per week of inactivity; floor at 0.
- **Promotion pipeline**: high-confidence patterns -> skill candidates -> `superpowers:writing-skills`.

## Example

```
[2026-04-13 03:14] autoDream cycle start (trigger: time+volume)
  lock acquired: .wotann/learning/dream.lock
  phase 1 collect   -> 47 observations since 2026-04-12 23:00
  phase 2 classify  -> corrections: 6, confirmations: 22, discoveries: 8, patterns: 11
  phase 3 consolidate -> merged 14 duplicates; confidence recomputed
  phase 4 promote   -> 3 patterns queued as skill candidates
  summary saved     -> Engram topic_key=learning/dreams/2026-04-13
  lock released; next cycle eligible after 2026-04-13 07:14
```

## Checklist

- [ ] All three gates confirmed passing before starting.
- [ ] Lock file created and released on exit (even on error).
- [ ] Raw observations archived, not deleted.
- [ ] Summary saved to Engram for human review.

## Common Pitfalls

- Forgetting to release the lock on crash; next cycle never runs until manually cleared.
- Promoting single-session patterns; require the pattern to recur in >=3 sessions.
- Decaying corrections too aggressively; user feedback must stick longer than tips.
