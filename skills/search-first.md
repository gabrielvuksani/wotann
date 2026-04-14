---
name: search-first
description: Research before coding — find existing solutions first
context: main
paths: []
---

# Search First

## Workflow (MANDATORY before writing new code)
1. **Search GitHub** for existing implementations.
2. **Check package registries** (npm, PyPI) for existing libraries.
3. **Read library docs** (use Context7 for up-to-date docs).
4. **Check the current codebase** for existing utilities.
5. **Only then** write custom code if nothing suitable exists.

## Search Order
1. Current codebase (Grep, Glob) — maybe it already exists.
2. Package registries (npm search, PyPI) — maybe there's a library.
3. GitHub code search — maybe someone solved this already.
4. Web search — for patterns and best practices.
5. Library documentation (Context7) — for correct API usage.

## Skip When
- Trivial edits (<5 lines of obvious code).
- Project-internal code that's clearly understood.
- User explicitly says "skip research."

## Anti-Pattern
Writing a custom date parser when `date-fns` exists.
Writing a custom CSV parser when `papaparse` exists.
Writing a custom retry mechanism when `p-retry` exists.
