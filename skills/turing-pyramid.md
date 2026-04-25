---
name: turing-pyramid
description: Andrej Karpathy's 5-layer hierarchy of agent capabilities (sense, understand, plan, act, reflect). Use when designing a new agent capability or debugging why an agent cannot complete a task.
type: cognitive-framework
source: openclaw
---

# Turing Pyramid — Agent Capability Hierarchy

A diagnostic and design framework for agent capability. Inspired by Andrej Karpathy's
formulation of agent intelligence as a strict hierarchy of layered competencies. An
agent that fails at task X almost always fails at the LOWEST layer that is broken,
not the highest. Diagnose top-down; build bottom-up.

## The Five Layers

```
Layer 5: REFLECT  — "what did I learn from running this?"
Layer 4: ACT      — "carry out the chosen action"
Layer 3: PLAN     — "decide what to do next"
Layer 2: UNDERSTAND — "what does the input mean?"
Layer 1: SENSE    — "what raw signals are present?"
```

Each upper layer DEPENDS on the layer below it. A perfect Layer-3 planner with a
broken Layer-1 sensor produces confidently wrong plans. A perfect Layer-4 actor
with a broken Layer-3 planner produces fast nonsense.

## When to invoke

- Designing a new agent capability — walk down the pyramid to enumerate every layer the new feature requires
- Debugging "why can't the agent finish this task?" — walk UP the pyramid; the first broken layer is the answer
- Code-reviewing an autonomous agent — verify each layer is testable and tested
- Writing a behavioral spec — split the spec into 5 layer-scoped sub-specs
- Triaging a production failure — classify the failure by the layer it surfaced from

## Process

### Diagnostic Mode (debugging a broken agent)

1. Reproduce the failure with verbose tracing on
2. Inspect the trace top-down (most recent action first)
3. For each layer, ask the diagnostic question:
   - **Layer 5 — Reflect**: did the agent record what just happened?
   - **Layer 4 — Act**: did the action match what was planned?
   - **Layer 3 — Plan**: was the plan reasonable given the understanding?
   - **Layer 2 — Understand**: did the agent correctly interpret the input?
   - **Layer 1 — Sense**: did the right raw signals reach the agent at all?
4. The first NO is the bug. Fix that layer. Re-run.
5. NEVER fix a higher layer when a lower layer is broken — the fix will leak.

### Design Mode (building a new capability)

1. Write a one-line capability statement: "the agent can do X"
2. For each layer, write the layer-scoped sub-requirement:
   - Layer 1: which inputs/files/streams must be sensed?
   - Layer 2: what schema/structure must be parsed from those inputs?
   - Layer 3: what decision rule chooses an action from the parsed input?
   - Layer 4: what action surface (file edits, shell calls, API calls) must be reachable?
   - Layer 5: what gets recorded so the next iteration can improve?
3. Build BOTTOM-UP. Layer 1 first. Each layer ships with a test before moving up.
4. Reject any feature that skips a layer — skipping = future bug.

## Examples

### Example 1 — debugging a stuck agent

User report: "the agent says it ran the tests but the test file wasn't even imported."

Walk up the pyramid:
- Layer 5: trace shows "tests passed". Reflect layer says success.
- Layer 4: the bash invocation in the trace is `vitest run nonexistent.test.ts`. Action ran fine.
- Layer 3: plan picked the wrong test file. Plan layer is buggy.
- Layer 2: understand layer parsed user request as "run tests for the new feature".
- Layer 1: but the new feature's test file is in a sibling directory the agent never sensed.

Conclusion: Layer 1 (sense) failed. The agent's working-set didn't include the sibling
directory, so its understand and plan layers couldn't possibly know about the right
test file. Fix the SENSE layer (broaden the file walker), not the PLAN layer.

### Example 2 — designing the Editor capability

Capability: "the agent can edit a TSX file in the IDE-style Editor pane".

- Sense: tail the file's bytes from disk; subscribe to filesystem events
- Understand: parse the TSX into an AST, locate the symbol the user named
- Plan: choose between insert / replace / delete based on the user's intent
- Act: emit the edit through the Editor's text-buffer API; assert the resulting AST is valid
- Reflect: log the diff + LSP diagnostics; if compilation broke, surface for review

This decomposition reveals you cannot ship the Editor feature without an LSP integration
(needed by both Understand and Reflect). That's a useful constraint to surface BEFORE
you start coding the edit-applying code in isolation.

## Anti-patterns

- "Polishing the prompt" when the actual bug is at Layer 1 (the right file isn't in context)
- Adding more reflection logic when the agent's understand layer is producing wrong parses
- Designing top-down ("first I'll plan how the agent decides") and discovering at integration time that the sense layer is missing entirely
- Treating the layers as parallel — they are STRICTLY hierarchical

## Stopping criteria

- Every layer is testable in isolation
- Every layer has at least one passing test that proves it works
- A failure at any layer is observable in the trace (no silent failures)
- The capability ships with a runbook that maps user-visible failures to layer-scoped checks

## Provenance

Karpathy framing of agent intelligence as layered hierarchy. Ported into WOTANN as a
reusable diagnostic skill so any agent debugging session can ask "what layer broke?"
before guessing.
