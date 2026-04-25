---
name: agent-autonomy-kit
description: Full-autonomy operating mode with self-verification, self-correction, self-completion. Use for autopilot until done runs.
type: cognitive-framework
source: openclaw
---

# Agent Autonomy Kit — Self-Operating Mode

The toolkit for an agent running in full-autonomy mode: no user in the loop
between task start and task completion. The agent must self-verify,
self-correct on failure, and self-determine when the task is done. This
skill encodes the disciplines that keep an autonomous agent honest.

## When to invoke

- The user invoked `wotann autopilot` (autonomous-until-done mode)
- A scheduled task is running unattended (cron, schedule, /loop)
- A long-running multi-step plan must complete without intervention
- A worker is processing a queue of tasks in parallel without supervision

## When NOT to invoke

- The user is sitting at the terminal expecting interactive feedback
- The task involves destructive operations on shared resources
- The task requires judgment calls that the user should make
- A previous autonomous run failed in this same context (give the user a chance to course-correct first)

## The Three Disciplines

```
1. SELF-VERIFY    — every claim of "done" must produce evidence
2. SELF-CORRECT   — every failure must be followed by a corrective attempt
3. SELF-COMPLETE  — the agent decides when it is done, not the clock
```

## Process

### Discipline 1 — Self-Verify

Before producing any "done" output, the agent runs the project's verification
chain and CAPTURES the output. Verification is not a comment; it is exit
codes and logs.

For each delivered claim, attach evidence:

| Claim | Evidence |
|---|---|
| "tests pass" | `vitest run` exit 0 + output snippet |
| "build succeeds" | `tsc --noEmit` exit 0 + output snippet |
| "feature works" | smoke-test script exit 0 + observable output |
| "lint clean" | `eslint .` exit 0 |
| "no secrets" | `git diff` review + secret-scan output |

Claims without evidence are not done. The agent must NOT pretend.

### Discipline 2 — Self-Correct

When verification fails, the agent:

1. Captures the failure mode (output, exit code, observed wrong behavior)
2. Forms 1-3 hypotheses about the cause
3. Tests the most likely hypothesis FIRST
4. If hypothesis is right, applies the smallest fix and re-verifies
5. If hypothesis is wrong, captures the disconfirming evidence and moves to next

Cap: 3 distinct fix attempts on the same error. After 3 failed attempts,
escalate via the agent's escalation channel (write a message to the user,
save state to memory, exit with an honest "stuck" message — never silently
mark "done").

### Discipline 3 — Self-Complete

The agent declares "done" when:

- ALL acceptance criteria from the task spec are met
- ALL verification evidence is captured
- A self-review pass has been performed (read the diff, look for obvious holes)
- The task's exit channel (PR, file, commit, message) has been produced
- Memory has been updated with what was learned

NOT when:
- "It feels done"
- The first run of the test suite passed
- The agent ran out of ideas (that's "stuck", not "done")

## Self-Review Pass (the last gate before "done")

A 60-second sanity check before declaring completion:

1. Re-read the task description. Does my output address every word?
2. Re-read my diff. Are there obvious bugs, typos, half-finished functions?
3. Did I leave any TODO / FIXME / XXX comments? If yes, are they justified?
4. Did I touch any file outside the task scope? Justify or revert.
5. Did I introduce any new dependencies? Are they in the manifest?
6. Did I add tests for new behavior? Did the tests actually fail on broken code first?
7. Did I update relevant documentation?

If any answer is "no, but I should have", go back. Do not declare done.

## Failure escalation

When stuck (3+ failed correction attempts), escalate gracefully:

```python
mem_save(
  title=f"AUTONOMY STUCK: {task_summary}",
  type="bugfix",
  topic_key="cases/autonomy",
  content=f"""
  Task: {task}
  Attempts: {attempts}
  Last hypothesis: {last_hypothesis}
  Last failure: {last_failure}
  Recommend: {recommended_action}
  """,
)
write_handoff_message(
  to=user,
  body=f"Autopilot stopped on {task}. Attempted 3 fixes. See memory for context.",
)
exit(code=2)  # NOT 0 — exit code reflects honest state
```

Exit code 0 means SUCCESS. Honest agents never lie about exit codes.

## Examples

### Example — autopilot building a feature

Task: "implement /humanizer command end-to-end".

1. Plan the steps (read spec → write tests → implement → verify)
2. For each step: do the work, then run verification
3. After each verification: capture exit code and a snippet of output
4. If a step fails: try fix attempt 1 → verify → try fix 2 → verify → try fix 3 → verify
5. After 3 fails: escalate, save state, exit code 2
6. After all steps pass: self-review pass; if clean, declare done with evidence bundle

### Example — autopilot encountering a destructive ambiguity

Task: "clean up the database — remove unused tables".

The agent must STOP. Cleaning a shared database is destructive and the
spec is ambiguous. Autonomous mode does not include destructive operations
on shared resources. Escalate to the user.

## Anti-patterns

- Marking "done" without evidence (the worst sin — it teaches the user not to trust autonomy)
- Catching exceptions and continuing as if nothing happened
- Modifying tests until they pass (the test was the spec; modifying it discards the spec)
- Overstating progress in user-facing messages
- Pushing forward when verification is failing — fix or escalate, never ignore

## Stopping criteria

- All three disciplines applied at every step
- Evidence captured for every claim
- Self-review completed before declaring done
- Honest exit (code 0 for true success, code 2+ for stuck)
- Memory updated with the run's outcome

## Provenance

OpenClaw's agent-autonomy-kit. Used by WOTANN's `wotann autopilot` mode and
by all `/schedule` recurring jobs. Designed to make autonomy something the
user can trust over thousands of runs.
