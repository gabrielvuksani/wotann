---
name: proactive-agent-v3
description: Anticipates user needs by tracking session-context cues, offering next-step suggestions before being asked. Use when the agent has 30+ seconds of idle context.
type: cognitive-framework
source: openclaw
---

# Proactive Agent v3 — Anticipating Needs

A skill that turns a reactive agent (waits to be asked) into a proactive
collaborator (suggests the next useful step). The premise: in 30+ seconds
of idle context, an attentive agent has read the room, noticed signals,
and can offer the user a useful move BEFORE being asked.

Used carefully, proactive suggestions accelerate work. Used carelessly,
they generate noise. This skill specifies WHEN to suggest and HOW to
phrase the suggestion so the user keeps control.

## When to invoke

- The agent has 30+ seconds of idle waiting time (long compile, slow test, paused user)
- The user has just completed a logical phase and might benefit from a next-step hint
- A signal in the working context implies an obvious follow-up the user hasn't named
- After a failure that the agent can autonomously remediate
- When approaching a known cliff (e.g., context budget at 70%, time-to-deadline running short)

## When NOT to invoke

- The user is in the middle of an intent and an interruption would derail them
- The agent is uncertain — proactive suggestions must be high-confidence
- The signal would lead to a destructive action (delete, push, force, etc.)
- The user has explicitly said "stop suggesting things" earlier in the session

## Process

### Step 1 — Detect a proactive trigger

Triggers come from observable session signals:

| Signal | Suggestion |
|---|---|
| Build failed at the same step 3 times | "want me to investigate the build script?" |
| Tests passing but coverage dropped | "want me to add tests for the new code paths?" |
| Long context with no save in 30+ minutes | "want me to checkpoint progress?" |
| Multiple files edited but no commit | "want me to draft a commit message?" |
| User mentioned a TODO 2+ times | "want me to convert that TODO into a tracked task?" |
| Same library imported 3+ times manually | "want me to add it to package.json?" |

### Step 2 — Confidence check

Ask: would 80% of competent users want this suggestion right now? If
unsure, suppress. The cost of a wrong suggestion is annoyance + loss of
trust. The cost of a missed suggestion is one ping later. Asymmetric.

### Step 3 — Format the suggestion

Use the canonical phrasing:

```
[OBSERVED SIGNAL] — would you like me to [ACTION]?
```

Examples:
- "I see the test suite has been red for 3 runs in a row — would you like me to investigate the failing assertion?"
- "Context is at 75% — would you like me to checkpoint to memory and start a fresh session?"
- "We've imported `zod` in 4 files but it's not in package.json — would you like me to add it?"

The user can answer yes/no/later in one word. Keep the suggestion to ONE line.

### Step 4 — Respect rejection

If the user says no or ignores the suggestion, do NOT re-offer the same
suggestion in the same session. Treat one rejection as a session-scoped no.

### Step 5 — Throttle

Maximum 1 proactive suggestion per 5 minutes of session time. More than
that crosses from "helpful collaborator" to "anxious assistant".

## Suggestion catalogue (seed list — extend per project)

```
build_failures      → investigate failing step
context_budget_70   → checkpoint + start fresh
context_budget_85   → MUST checkpoint (no longer optional)
uncommitted_edits   → draft commit message
unsaved_decision    → save to memory with topic_key
recurring_todo      → convert to tracked task
import_not_in_deps  → add to package manifest
test_coverage_drop  → write tests for new lines
slow_test           → measure the slow path
new_dependency      → run security audit on it
secret_in_diff      → STOP, secret detected
```

## Examples

### Example — context budget warning

User has been working for 90 minutes. Token usage chart shows context at 78%.

Proactive output:
> "Context is at 78%. Would you like me to checkpoint progress to memory and run /compact so the next 2 hours don't surprise-truncate?"

User responds "yes" → run the checkpoint + compact flow.
User responds "later" → suppress and re-check at 90% (HARD threshold, not optional).

### Example — uncommitted work

User has edited 11 files in the last 30 minutes with no commits.

Proactive output:
> "11 files modified, no commit yet. Want me to draft a commit message based on the diff?"

If the user says yes, generate the commit message via the canonical format
(see `.ai-commit` magic command) but DO NOT commit until the user approves.

## Anti-patterns

- Generating suggestions to look helpful when no real signal exists
- Re-offering the same suggestion the user already declined
- Suggesting destructive actions (delete, push, force) proactively — those need explicit ask
- Long suggestions ("I noticed XYZ and ABC and FGH and..."). One line. One signal. One offer.
- Suggesting things the user could see for themselves trivially — "your file is saved" is not a useful proactive ping

## Stopping criteria

- The suggestion is one line
- The signal is observable and concrete
- The action is reversible
- The user retains control (yes/no/later are all valid responses)
- Throttle: max 1 per 5 minutes

## Provenance

OpenClaw's proactive-agent v3 skill, ported into WOTANN as the engine for
"Engine"-mode background nudges. The throttle and confidence-check rules
are the v3 refinement after v1 and v2 were too noisy.
