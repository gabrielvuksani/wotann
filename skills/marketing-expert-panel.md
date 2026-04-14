---
name: marketing-expert-panel
description: Multi-expert scoring loop for content, landing pages, and strategy until quality is genuinely strong
context: fork
paths: []
category: marketing
requires:
  anyBins: ["python3", "python"]
---

# Marketing Expert Panel

## When To Use
- Quality-gating copy, landing pages, nurture sequences, pricing pages, or strategy docs.
- Comparing multiple variants and choosing a winner with explicit reasons.
- Tightening content that feels weak, generic, or AI-written.

## Panel Construction
- Start with 5-7 reviewers matched to the artifact: copy, conversion, brand voice, offer clarity, and audience fit.
- Always include a humanizer lens and a brand-voice lens.
- Add 1-3 domain experts when the niche matters.
- Cap the panel at 10 reviewers; merge overlapping perspectives instead of padding.

## Review Loop
1. Score each variant from 0-100 with one-line rationale.
2. Weight humanizer and conversion more heavily than stylistic polish.
3. Identify the top 3 weaknesses, revise specifically, and rescore.
4. Stop at 90+ quality or after 3 rounds, then report the real ceiling.

## Output Rules
- Show the winner first, then the score table and revision history.
- Preserve the reasoning trail; the feedback history is part of the deliverable.
- If the artifact came from another skill, produce a brief explaining what the source workflow should change next time.
