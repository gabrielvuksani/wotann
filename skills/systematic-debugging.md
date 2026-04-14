---
name: systematic-debugging
description: Hypothesis-driven root cause analysis for bugs and failures
context: main
paths: []
---

# Systematic Debugging

## Workflow (MANDATORY)
1. **REPRODUCE** — Confirm the bug exists. Get the exact error message.
2. **HYPOTHESIZE** — Generate 2-3 possible causes based on the error.
3. **NARROW** — For each hypothesis, identify ONE test that would confirm/refute it.
4. **TEST** — Run the test. Record the result.
5. **FIX** — Fix the confirmed root cause. Make the SMALLEST possible change.
6. **VERIFY** — Run the original reproduction steps. Confirm the fix works.

## Rules
- NEVER guess the fix. Always confirm the root cause first.
- NEVER modify tests to make them pass (unless the test is wrong).
- Read the FULL error message, including stack traces.
- Check git blame/log for recent changes to the failing area.
- After fixing, check for similar bugs in related code.

## Common Root Causes
- Import/export mismatch (default vs named)
- Type coercion (null vs undefined, string vs number)
- Async timing (race conditions, missing await)
- Stale closure (useEffect capturing old values)
- Missing error handling (unhandled promise rejection)

## Escalation
If 3 different approaches fail, use tree-search (parallel hypothesis exploration).
