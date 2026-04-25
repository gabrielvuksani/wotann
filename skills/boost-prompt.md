---
name: boost-prompt
description: Prompt amplification helpers — clarify intent, add structure, surface examples. Used by /enhance.
type: cognitive-framework
source: openclaw
---

# Boost Prompt — Amplifying Vague Prompts

A skill that turns underspecified prompts into well-structured ones.
Used by the `/enhance` command and by any place WOTANN takes raw user
input and forwards it to a model. The premise: most "the model didn't do
what I wanted" failures trace back to an under-specified prompt, not to
the model's reasoning.

This skill defines THREE BOOSTERS that, applied in order, take a vague
prompt and produce a clearer one — without changing the user's intent.

## When to invoke

- The user invokes `/enhance <prompt>`
- The CLI receives a prompt that is < 10 words AND not a magic command
- A sub-agent is about to be dispatched and the parent prompt is vague
- A scheduled task runs with a prompt that needs to be self-explanatory hours later

## The Three Boosters

```
1. CLARIFY INTENT     — what is the user actually trying to achieve?
2. ADD STRUCTURE      — what's the goal, the constraints, the acceptance criteria?
3. SURFACE EXAMPLES   — provide a concrete example of good output
```

Apply in that order. Each booster is independent; you can apply any subset.

## Process

### Booster 1 — Clarify Intent

Original prompt: `"fix this"`

Heuristics for clarifying:
- What is "this"? Look at the recent context to identify the referent.
- What does "fix" mean here? Cosmetic, behavioral, performance, security?
- Who is the consumer of the fix? Production users, the test suite, a coworker?

Boosted prompt: `"Fix the test failure in <file>:<line>. The test asserts <X> but the code returns <Y>. Identify the root cause and propose the smallest patch that makes the test pass without modifying the test itself."`

The boosted version is longer but the model now has a fighting chance.

### Booster 2 — Add Structure

Most prompts benefit from explicit structure:

```
GOAL: <one sentence — what we're trying to achieve>
CONTEXT: <what's relevant; cite files/symbols when you can>
CONSTRAINTS: <what must NOT change; performance / API / data>
ACCEPTANCE: <what will signal "done"; tests passing, output matches, etc.>
```

Even a one-sentence answer per field beats a paragraph of free-form prose.

### Booster 3 — Surface Examples

When the desired output shape is non-obvious, attach an example:

```
Bad output: "The function returns the value." (too vague)
Good output: "The function returns a Promise<UserRecord | null>; null means
not found, never throws on missing user."
```

Examples disambiguate intent in 3 lines what 30 lines of prose can't.

## Boosting Algorithm

```python
def boost(raw_prompt, context):
    # Pass 1: clarify intent
    referents = resolve_referents(raw_prompt, context)  # what is "this", "the bug", etc.
    intent = identify_intent_verb(raw_prompt)            # fix, explain, generate, refactor
    boosted = clarify(raw_prompt, referents, intent)

    # Pass 2: add structure (only if the prompt is requesting a non-trivial output)
    if needs_structure(boosted):
        boosted = add_goal_context_constraints_acceptance(boosted)

    # Pass 3: surface examples (only if the output shape is non-obvious)
    if output_shape_is_ambiguous(boosted):
        boosted = attach_example(boosted)

    return boosted
```

The key is restraint: don't over-boost a 2-line "format this JSON" prompt
into a 200-line spec. Boost proportionally.

## Examples

### Example 1 — minimal boost

Raw: `"explain this"`
Context: cursor on a 30-line function in a file the user just opened.

Boosted: `"Explain how the function on line 42 of <file> works. Cover the
algorithm, the inputs, the outputs, and any subtle edge cases. Skip the
obvious."`

(One booster applied: clarify intent. Skipped structure + examples; not
needed for a simple explanation.)

### Example 2 — fuller boost

Raw: `"add auth"`
Context: project is a Next.js app with no current authentication.

Boosted:
```
GOAL: Add user authentication to the Next.js app.
CONTEXT: This is a Next.js 14 App Router project. No auth exists yet.
The user database is Postgres via Drizzle.
CONSTRAINTS: Use a free auth library (NextAuth, Lucia, or Clerk's free
tier). Do NOT add new infra (Auth0, Cognito).
ACCEPTANCE:
  - Users can sign up with email/password
  - Sessions persist across page refreshes
  - Protected routes redirect to /login
  - Auth tests in tests/auth/*.test.ts pass

Example of expected work: a PR that adds /login, /signup, /logout pages
plus middleware that gates /dashboard and /settings.
```

(All three boosters applied — the original was too vague to act on.)

### Example 3 — DON'T over-boost

Raw: `"format this JSON"`

Boosted: `"format this JSON"` (no change).

The original is unambiguous. Boosting would add noise.

## Detection of "needs structure"

Heuristic: a prompt needs structure if any of the following apply:
- The verb is one of: build, design, create, refactor, migrate, port
- The noun involves multiple files or systems
- The expected output is multi-step (not a single-line answer)
- The desired behavior has constraints (must / must-not)

Otherwise, skip Booster 2.

## Detection of "ambiguous output shape"

Heuristic: the output shape is ambiguous if:
- The user said "summarize" without specifying length
- The user said "list" without specifying format
- The user said "diagram" without specifying notation
- The desired structure could differ between two reasonable readers

Otherwise, skip Booster 3.

## Anti-patterns

- Over-boosting trivial prompts (a 2-word task should not become a 50-line spec)
- Adding constraints the user didn't imply (turning "fix this" into "fix this AND refactor everything")
- Inventing requirements (`MUST be backwards-compatible to v0.1`) when the user said nothing about compatibility
- Asking the user clarifying questions when the boost itself can resolve the ambiguity

## Stopping criteria

- The boosted prompt is no longer ambiguous to a competent reader
- The boost added at most 3-5 sentences (proportional to the original)
- The user's intent is preserved (they would recognize the boosted prompt as theirs)

## Provenance

OpenClaw's boost-prompt skill. Pairs with the `/enhance` command and the
deep-interview skill (when the boost reveals the prompt is too ambiguous
even for boosting and the user must answer questions first).
