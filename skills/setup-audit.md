---
name: setup-audit
description: Detect configuration rot in .wotann/ - stale rules, orphaned skills, conflicts
context: main
paths: []
---

# Setup Audit

## When to Use

- After a major WOTANN refactor touches `src/hooks/`, `src/skills/`, or `src/prompt/`.
- When an old guard or skill hasn't fired in the last 50 sessions.
- Before a release candidate, to catch stale references in `wotann.yaml`.
- When the user reports "a rule I set last month isn't working anymore".
- Monthly hygiene pass as part of memory taxonomy maintenance.

## Rules

- Run in a read-only pass first; never auto-delete without user confirmation.
- Preserve the user's custom rules; only flag WOTANN-shipped defaults as removable.
- Report findings by severity (CRITICAL = breaks boot, HIGH = wrong behavior, LOW = cruft).
- Propose fixes as diffs, not free-form instructions.
- Never modify `MEMORY.md` beyond the 200-line cap enforced by the harness.
- Record each audit run to Engram (`topic_key: audits/<date>`) for drift tracking.

## Patterns

- **Config diff**: `.wotann/wotann.yaml` vs. the schema in `src/core/config.ts`.
- **Skill usage log**: `src/skills/usage.log` -> any skill with 0 triggers in 30 days.
- **Hook orphans**: `.wotann/hooks/*.sh` referencing events that no longer fire.
- **Memory bloat**: MEMORY.md line count, Engram observations older than 90 days.
- **Dependency drift**: `package.json` versions vs. `package-lock.json` resolved.

## Example

```
== WOTANN Setup Audit (2026-04-13) ==
[CRITICAL] hooks/pre-compact.sh -> references removed 'compactLegacy' event
[HIGH]     skills/epic-design.md -> 0 triggers in 45 days; consider archiving
[LOW]      wotann.yaml -> deprecated field 'providers.v1apiKey' (renamed 'providers.apiKey')
[OK]       memory/ -> 18 observations, no decay needed
```

## Checklist

- [ ] Scan completed without modifying any file (read-only pass).
- [ ] Findings categorized by severity.
- [ ] Each finding includes a proposed diff or fix command.
- [ ] Audit run recorded to Engram for future comparison.

## Common Pitfalls

- Auto-deleting "unused" skills that the user loads manually via `wotann skills load`.
- Assuming a hook is orphaned when it only fires on rare events (release, upgrade).
- Modifying `wotann.yaml` without backing it up first; user loses custom overrides.
