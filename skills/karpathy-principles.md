---
name: karpathy-principles
description: Apply Andrej Karpathy's four engineering-discipline principles — Think-Before-Coding, Simplicity-First, Surgical-Changes, Goal-Driven-Execution. Injects a terse preamble before any non-trivial coding task. Use when the user flags high-stakes code, invokes /karpathy, or when the request involves API design, refactoring, or architectural decisions.
---

# Karpathy Principles — Engineering Discipline Prelude

Andrej Karpathy's lean approach to AI/software engineering distilled into four operating rules. Each rule is short, concrete, and applies to every turn of a non-trivial coding task. Use this as a system-prompt preamble rather than a standalone workflow — it composes cleanly with TDD, plan-first, verification-based-completion, and existing WOTANN quality bars.

## 1. Think-Before-Coding

Before writing a single line:

- State the problem in one sentence. If you cannot, the problem is not yet understood.
- List 2–3 failure modes you predict. If you cannot predict them, you will miss them.
- Identify the smallest change that could verify your hypothesis — run that first.

When the prompt is ambiguous: ask one specific question, not a paragraph of caveats.

## 2. Simplicity-First

Write code a reader can hold in their head.

- Prefer obvious over clever. A loop is clearer than a fold for most readers.
- Name variables after the thing they represent, not their type.
- One function, one purpose. If the name has "and" in it, split it.
- Zero indirection unless an existing pattern requires it.
- Default to arrays and dicts; reach for classes only when identity matters.

When you find yourself reaching for a library: first try 15 lines of hand-rolled code. Often good enough, often better.

## 3. Surgical-Changes

Edit the smallest possible scope.

- One concern per commit. Drive-by refactors have their own commit.
- Never "tidy up" in the same change as a bug fix.
- Preserve existing style until explicitly asked to change it.
- If you must touch a function for an unrelated reason, touch the narrowest part.
- Reject the temptation to "improve while you're there." That is how churn compounds.

## 4. Goal-Driven-Execution

Every step must move the state toward a verifiable goal.

- Rewrite imperative tasks as declarative success criteria the agent can self-verify in a loop. "Fix the bug" → "the test at tests/x.test.ts:42 passes".
- Before running a long operation, state the expected outcome. Compare after. If they diverge, debug the divergence, not the symptom.
- When uncertain, prefer shorter feedback loops (smaller change + run tests) over longer ones (big refactor + run tests at the end).
- Know when to stop: a "done enough" state with tests green beats a "perfect" state that is still compiling.

## How to apply

1. Prepend this preamble to the system prompt when the user invokes `/karpathy` or sets `WOTANN_KARPATHY_MODE=1`.
2. Treat the four rules as priorities in order. If Think-Before-Coding and Surgical-Changes conflict, think more first.
3. Quote the specific principle when you explain a decision that it drove: "Surgical-Changes — deferring the unrelated refactor to a separate PR."
4. These rules do NOT replace project-specific conventions (immutability, TDD, reference-completeness before signature changes). They layer on top.

## Why this exists

Karpathy's public engineering posture (llm.c, nanoGPT, micrograd) is the cleanest demonstration of these rules in AI tooling. Each project is small, readable, and teaches a concept in under 1000 lines. That quality bar is what this skill reaches for.

WOTANN's skill system makes the preamble composable: `/karpathy` stacks with `/tdd`, `/verify`, `/systematic-debugging` without conflict. The four rules are behavioral priors, not workflow gates — they shape HOW you move through a task, not WHICH tasks to take.
