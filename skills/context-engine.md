---
name: context-engine
description: Meta-skill for assembling the optimal context window — memory, skills, recent files, spec, tests.
type: cognitive-framework
source: openclaw
---

# Context Engine — Optimal Context Assembly

A meta-skill for deciding what goes into the agent's context window for a
given task. Context is finite; what fills it determines how well the agent
performs. This skill encodes the rules for assembly: what to include,
what to exclude, in what order, and at what budget.

The Context Engine is the orchestrator that turns "do this task" into a
carefully composed prompt + working set + memory hits + relevant skills.

## When to invoke

- Starting any non-trivial task (3+ steps OR involves project knowledge)
- Resuming after a compaction (rebuild context from WAL state + memory)
- Switching between tasks (clear stale context, assemble fresh)
- After a context-budget warning (re-evaluate what's worth keeping)
- When delegating to a sub-agent (curate a focused context for the child)

## The Five Sources

```
1. SPEC          — what the user asked for, verbatim and structured
2. MEMORY        — relevant past decisions, cases, patterns
3. WORKING SET   — files the task will read or modify
4. SKILLS        — cognitive frameworks the task will need
5. EVIDENCE      — recent test runs, build output, error logs
```

The Context Engine assembles from these five sources, in this order, under
a token budget.

## Process

### Step 1 — Read the spec

The spec is the source of truth. If the user said "fix the build", the
spec is "fix the build" — not "do whatever I think is best".

Extract:
- Goal (one sentence)
- Acceptance criteria (bullet list)
- Constraints (allowed/forbidden actions)
- Done condition (how the user will know)

### Step 2 — Query memory

Search Engram + claude-mem for entries relevant to the spec:

```
relevant_memories = mem_search(
  query=goal_string,
  filters=["cases", "decisions", "patterns"],
  k=10,
)
```

Filter to top-N by confidence. Include the highest-signal entries; exclude
near-duplicates.

### Step 3 — Resolve the working set

Identify the files the task will likely read or modify. Sources:

- Files mentioned in the spec
- Files referenced from those files (1-hop, depth-limited)
- Test files for the named modules
- Config files relevant to the affected feature

Cap the working set at a token budget — typically 30% of available context.

### Step 4 — Select relevant skills

Walk the skill index and select skills whose `description` matches the
task. Default to including:

- `turing-pyramid` — for any debugging or capability-design task
- `capability-evolver` — for any failed-task follow-up
- `governance` — for any potentially-destructive task
- Plus task-specific skills (e.g., `code-review` if reviewing, `test-driven-development` if implementing)

Cap at 5 skills loaded into context. More dilutes attention.

### Step 5 — Attach evidence

If the task is "fix" or "investigate", attach:

- The most recent error message verbatim
- The relevant log lines (last 50 around the failure)
- The output of any test that's failing
- The diff under review (if reviewing)

Evidence is small but decisive. A 10-line stack trace beats a 1000-line code-tour.

### Step 6 — Compose

Assemble the final context in this order:

```
[SYSTEM PROMPT]
  + SKILLS (relevant skill content)
  + GOVERNANCE (active guards)

[USER PROMPT]
  ## Task
  <spec>

  ## Acceptance criteria
  <criteria>

  ## Memory context
  <relevant past decisions / cases>

  ## Working set
  <file paths + summaries; full content for files <500 lines>

  ## Evidence
  <error log / test output / diff>

  ## Now do it.
```

Token budget guideline (Claude Sonnet 4.6, 200K context):
- System: 5K
- Skills: 15K
- Memory: 10K
- Working set: 50K
- Evidence: 20K
- Conversation buffer: 100K (the rest)

These are rough; tune per project.

## Examples

### Example — "fix the failing build"

- Spec: "fix the failing build"
- Memory: top hits = `cases/build-errors`, `decisions/tsconfig-strict-mode`
- Working set: `tsconfig.json`, the file that fails to compile, files that import it
- Skills: `turing-pyramid`, `systematic-debugging`, `governance`
- Evidence: full output of `npx tsc --noEmit`

The agent now has a focused, highly relevant context — not a tour of the
whole codebase, not a tour of unrelated cases, just what's needed.

### Example — delegating a sub-agent for code review

Task: review a 400-line PR.

The Context Engine assembles a child-agent prompt with:
- The PR diff (full, evidence)
- The `code-review` skill (skills)
- The `governance` skill (skills)
- Recent memory entries with `topic_key="reviews/*"` (memory, last 5)
- The acceptance criteria from the PR description (spec)

The child-agent's context is curated — no clutter from the parent's
session.

## Anti-patterns

- Dumping the entire repo into context "to be safe" — dilutes attention
- Skipping memory because "it's already in the prompt somewhere" — explicit beats implicit
- Treating skills as static (always the same 5) — relevance is task-specific
- Forgetting evidence on debugging tasks — without the error, the agent must guess
- Over-stuffing the working set — files-by-relevance, capped, not files-by-vibe

## Stopping criteria

- All five sources have been consulted
- Token budget is respected
- Composition is in canonical order (spec → memory → working set → skills → evidence)
- A child sub-agent could read the assembled prompt and start work immediately

## Provenance

OpenClaw's context-engine skill. Used by WOTANN's session bootstrap, by
each `/compact` resume, and by every sub-agent delegation. Pairs with
elite-longterm-memory (memory step) and compaction-ui-enhancements
(post-compact recap).
