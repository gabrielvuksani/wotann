---
name: elite-longterm-memory
description: Meta-skill for memory governance — what to save, when to forget, how to consolidate. Used by /save-session and autoDream.
type: cognitive-framework
source: openclaw
---

# Elite Long-Term Memory — Governance for Persistent Knowledge

A meta-skill for managing the agent's long-term memory. Memory that grows
without governance becomes noise; memory that gets pruned blindly loses
durable context. This skill encodes the policies that keep memory useful
for years, not days.

Used by the `/save-session` flow at session end, and by the `autoDream`
nightly extraction process.

## When to invoke

- At session end — decide what to persist from this session
- During nightly `autoDream` — consolidate the day's observations into durable patterns
- When a memory query returns 50+ noisy hits — time to prune or consolidate
- When MEMORY.md crosses 200 lines — forced pruning trigger
- When a topic_key has 3+ near-duplicate entries — consolidation candidate
- When introducing a new memory type — decide its retention policy first

## Memory taxonomy (see also: rules/memory-taxonomy.md)

| Block | What it stores | Retention | Hard limit |
|---|---|---|---|
| user | Identity, preferences, knowledge level | indefinite | 10 entries |
| feedback | Confirmed corrections and approaches | indefinite | 15 entries |
| project | Active project state, decisions, deadlines | 30 days inactive → archive | 10 entries |
| reference | Pointers to external repos, docs | indefinite | 10 entries |
| cases | Failure + root cause + fix | indefinite | unlimited |
| patterns | Reusable techniques that worked | indefinite | unlimited |
| decisions | Architectural choices with reasoning | indefinite | unlimited |
| issues | Known bugs with OPEN/SNOOZED/RESOLVED lifecycle | until RESOLVED for 3 sessions | unlimited |

## Process

### Save Decisions (when to write to memory)

Save IMMEDIATELY when:
- A non-obvious decision is made → block: decisions
- A failure is fully understood → block: cases
- A reusable technique works → block: patterns
- A user correction is given → block: feedback
- A new known issue is discovered → block: issues
- A new external resource is bookmarked → block: reference

Do NOT save:
- Conversational pleasantries
- Code snippets that already exist in the repo (let the repo be the source of truth)
- Decisions that are trivially recoverable from the next read of the code
- Speculation unsupported by evidence

### Forget Decisions (when to prune)

Prune when:
- A `project` block entry has not been touched in 30 days
- An `issues` entry has been RESOLVED for 3 consecutive sessions
- A `feedback` entry has been superseded by a more specific feedback (replace, don't accumulate)
- An auto-memory file exceeds its hard limit — drop oldest first
- MEMORY.md exceeds 200 lines — truncate to the highest-value 200

### Consolidate Decisions (when to merge)

Consolidate when:
- 3+ entries share a `topic_key` and describe the same root concept
- A pattern has accumulated enough examples to abstract into a rule
- Multiple cases share a common root cause — promote to a single pattern
- A decision has been re-confirmed across 3+ sessions — promote to a stable convention

### Topic-key conventions

Use slash-prefixed keys to namespace:

```
cases/<domain>           — cases/hooks, cases/memory, cases/build
patterns/<domain>        — patterns/debugging, patterns/testing
decisions/<feature>      — decisions/auth, decisions/storage
known-issues/<area>      — known-issues/macos, known-issues/ci
project/<name>/<topic>   — project/wotann/audit-2026-04
```

This makes search predictable and consolidation tractable.

## Examples

### Example — saving a debug case

User and agent fixed an EPIPE-on-hook bug. Save:

```python
mem_save(
  title="EPIPE in pre-compact hook from undrained stdin",
  type="bugfix",
  topic_key="cases/hooks",
  content="""
  Trigger: pre-compact.js calling process.exit(0) without reading stdin.
  Symptom: EPIPE errors in stderr; hook treated as crashed.
  Root cause: hook STDIN pipe was filled by parent before child read.
  Fix: read stdin (or destroy() the readable) BEFORE process.exit.
  Regression test: tests/hooks/epipe.test.ts added.
  """,
)
```

### Example — consolidating duplicates

A search for `topic_key=cases/hooks` returns 4 entries: 3 are about EPIPE,
1 is about a different bug. Consolidate the 3 EPIPE entries into one
authoritative case with all reproduction steps + the regression test
filename. Delete the originals.

### Example — auto-resolving a known issue

A `known-issues/ci` entry has been in RESOLVED state for 3 consecutive
sessions. The autoDream cycle detects this and:
1. Moves the entry to `archive/issues/ci/<date>.md`
2. Removes it from the active issues query results
3. Leaves a stub: "RESOLVED on <date>; archived to <path>"

## Anti-patterns

- Saving everything "just in case" — noise drowns signal; future searches return junk
- Pruning by age alone without checking whether the entry is still cited
- Storing the same fact in 3 different topic_keys — searches return duplicates
- Using freeform titles instead of structured topic_keys — searches miss matches
- Treating MEMORY.md as a journal (chronological) instead of a curated knowledge base

## Stopping criteria

- Every save has a topic_key
- Every block has its retention policy applied
- MEMORY.md is under 200 lines
- A 6-month-old entry is still findable through a reasonable query

## Provenance

OpenClaw's elite-longterm-memory skill. Pairs with WOTANN's Engram + claude-mem +
auto-memory stack. The retention rules are tuned for an agent that runs daily,
generates 50-200 observations per day, and needs durable knowledge for years.
