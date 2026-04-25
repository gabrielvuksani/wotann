---
name: capability-evolver
description: Agent self-improvement loop — capture failure, propose patch, test, merge. Use after every failed task to compound learnings into durable capability.
type: cognitive-framework
source: openclaw
---

# Capability Evolver — The Self-Improvement Loop

A reusable post-failure protocol that turns every "this didn't work" into a
durable capability upgrade. The intuition: failure is the most expensive
signal an agent generates, and discarding it is the deepest waste in
agent engineering. This skill ensures every failure becomes a regression
test, a documented case, and (when warranted) a code change.

## When to invoke

- After ANY failed task — a test that didn't pass, a wrong answer, a tool that errored
- After a user correction — "no, do it like this" is a learning signal, not a chat turn
- During a postmortem on a multi-step plan that took the wrong branch
- When the same kind of failure has happened twice — the second time MUST trigger this skill
- At the end of a session when reviewing the day's work

## The Loop

```
1. CAPTURE   — write down exactly what failed, with the inputs that triggered it
2. CLASSIFY  — is this a sense / understand / plan / act / reflect failure? (see turing-pyramid)
3. PROPOSE   — write the smallest possible patch that prevents the failure
4. TEST      — write a regression test that fails on the old behavior, passes on the new
5. MERGE     — apply the patch; the test is now the durable proof
6. RECORD    — save the case + patch + test to memory so future sessions know
```

## Process

### Step 1 — Capture (do this BEFORE anything else)

Open a capture document with these fields:

```
title: <one-line summary of the failure>
date: <YYYY-MM-DD>
trigger: <the exact input or context that caused the failure>
expected: <what should have happened>
actual: <what happened>
error_chain: <traceback / log / observed wrong output>
hypothesis: <best guess at the root cause — may be wrong, that's fine>
```

If you cannot fill in `trigger` and `actual` precisely, you are not yet ready
for steps 2-6. Go reproduce the failure first.

### Step 2 — Classify

Apply the `turing-pyramid` skill to identify the layer of the failure. The
classification determines the kind of patch:

- Sense failures → broaden the working set (more files, more context, more memory)
- Understand failures → fix parsers, schemas, or the prompt that interprets input
- Plan failures → fix the decision rule, add a missing case, change priority
- Act failures → fix the tool wrapper, add timeouts/retries, validate the call site
- Reflect failures → add a logger, add a metric, add a test

### Step 3 — Propose the patch

The patch should be the SMALLEST change that prevents this specific failure
without introducing regressions elsewhere. Default mode: surgical.

Anti-pattern: refactoring three modules because "while I'm here". The user
wanted the bug fixed, not a tour of your aesthetic preferences.

### Step 4 — Write the regression test

The test must:
- Reproduce the exact `trigger` from Step 1
- Assert against the `expected` behavior from Step 1
- Fail on the OLD code (run it once on the old code to prove the test catches the bug)
- Pass on the NEW code with the patch applied

If the test passes on the OLD code, the test is NOT testing the bug. Try again.

### Step 5 — Merge

Apply the patch + test together as a single atomic unit. Never merge a fix
without its test — that loses the durability of the lesson.

### Step 6 — Record

Save the capture document to memory using:
- `mem_save` with `topic_key="cases/<domain>"` for the case + root cause + fix
- `mem_save` with `topic_key="patterns/<domain>"` for the technique that worked

A future agent session searching for "agent stuck in test loop" will surface
your case and skip the failure path entirely.

## Examples

### Example — agent kept hardcoding test fixtures

**Capture**: Agent generated `expect(result).toBe(42)` for every test, regardless of
the actual return value. Tests passed but were meaningless.

**Classify**: Plan-layer failure. The agent's plan included "make the test pass" not
"make the test test the actual behavior".

**Propose**: Tighten the test-engineer agent's system prompt to add: "tests must fail
on broken implementations — verify by negating the expected value and re-running".

**Test**: Add a regression test that mutates the implementation and asserts the test
suite catches the mutation.

**Merge**: PR includes the prompt change AND the regression test.

**Record**: `mem_save(topic_key="cases/test-quality", title="Hardcoded test values defeat regression testing", ...)`.

## Recurrence detection

When recording, check if a similar `topic_key` already has 3+ entries. If yes,
the failure is recurrent — escalate to a structural fix, not another patch.
Recurrence means the patch surface is wrong; you need a deeper change.

## Anti-patterns

- Skipping the capture step ("I'll remember it"). You won't.
- Patching without a test. Future-you will undo this fix in 3 weeks.
- Recording the patch but not the failure mode — without the trigger, the case is unsearchable.
- Using `try/catch` around the failing call as the "fix". That's hiding the failure, not preventing it.

## Stopping criteria

- Capture document is complete
- Test is in the suite, passing
- Patch is merged
- Memory entry is written and searchable

## Provenance

OpenClaw's capability-evolver skill, adapted for WOTANN. Pairs naturally
with the turing-pyramid skill (for layer classification) and the
elite-longterm-memory skill (for the memory-recording step).
