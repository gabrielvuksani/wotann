---
name: file-based-planning
description: Manus-style task_plan.md, findings.md, progress.md
context: main
paths: []
---

# File-Based Planning

## Files
- **task_plan.md** — The plan. Phases, tasks, acceptance criteria.
- **findings.md** — Research results, decisions, alternatives considered.
- **progress.md** — Live progress tracker. Updated after each task.

## Workflow
1. Create `task_plan.md` with phases and tasks.
2. For each task, update `progress.md` with status.
3. Record discoveries in `findings.md`.
4. Mark tasks complete only when acceptance criteria are met.

## task_plan.md Format
```markdown
# Plan: [Feature Name]

## Phase 1: [Name]
- [ ] Task 1.1: [Description] — AC: [acceptance criteria]
- [ ] Task 1.2: [Description] — AC: [acceptance criteria]

## Phase 2: [Name]
- [ ] Task 2.1: [Description] — AC: [acceptance criteria]
```

## progress.md Format
```markdown
# Progress

## Current Phase: 1 (Foundation)
## Current Task: 1.2

| Task | Status | Notes |
|------|--------|-------|
| 1.1  | DONE   | Completed, tests pass |
| 1.2  | IN PROGRESS | Working on auth flow |
```

## Rules
- Plans survive context compaction (they're on disk).
- Update progress BEFORE moving to the next task.
- Record WHY decisions were made in findings.md.
