---
name: marketing-growth-engine
description: Growth experimentation workflow with playbook reuse, hypothesis tracking, and weekly scorecards
context: fork
paths: []
category: marketing
requires:
  anyBins: ["python3", "python"]
---

# Marketing Growth Engine

## Core Pattern
- Treat marketing as an experiment system, not a stream of one-off assets.
- Check the current playbook before proposing a new variant.
- Every test needs a hypothesis, a primary metric, a time window, and a minimum sample rule.

## Operating Loop
1. Define the variable being tested, not just the asset being written.
2. Generate 2-10 variants only when the channel can support the sample size.
3. Log outcomes consistently across variants.
4. Promote only statistically credible winners into the playbook.
5. Turn the winner into the next baseline before creating new work.

## Scorecard Expectations
- Weekly view should show channel health, pacing, current winners, and next experiments.
- Flag channels that are under target before suggesting new creative.
- Separate trends from confirmed winners; do not confuse early uplift with proof.

## Guardrails
- Do not run batch testing when distribution volume is too low.
- Do not recommend new variants until the prior experiment has enough data or is explicitly abandoned.
- Every suggestion must end with the next metric to inspect.
