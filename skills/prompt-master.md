---
name: prompt-master
description: Prompt engineering for any AI tool - Claude, GPT, Midjourney, Cursor, WOTANN Enhance
context: fork
paths: []
---

# Prompt Master

## When to Use

- Building system prompts for WOTANN's `src/prompt/` engine (provider-specific translations).
- Drafting prompts consumed by `wotann enhance` to clarify user intent.
- Writing skill-level prompts that must trigger reliably without over-triggering.
- Authoring few-shot examples for a new WOTANN provider adapter.
- Reviewing a prompt that fails in one provider but works in another.

## Rules

- Be specific: name constraints, output format, and success criteria explicitly.
- Show 2-3 diverse examples before asking the model to generalize.
- Separate instructions from data with consistent delimiters (XML tags, fences).
- Version every production prompt; never hot-edit without a diff log.
- Negative prompts describe what to avoid, not what to do; keep them short.
- Test against all target providers (Claude, GPT, Gemini) before shipping.

## Patterns

- **Structured output**: demand JSON with a schema; parse + validate downstream.
- **Chain of thought**: for reasoning-heavy tasks, request explicit steps before the answer.
- **Role priming**: "You are a senior Rust reviewer..." biases tone and depth.
- **Skill descriptions**: slightly "pushy" phrasing combats under-triggering in dispatchers.
- **Provider translation**: rewrite the same intent for each provider's strengths (Claude: XML, GPT: markdown).

## Example

```text
<role>WOTANN memory summarizer</role>
<input>{{observations_json}}</input>
<output_schema>
  { "patterns": string[], "corrections": string[], "decisions": string[] }
</output_schema>
<rules>
  - Deduplicate similar observations.
  - Promote only items with confidence >= 0.7.
  - Emit valid JSON only, no prose.
</rules>
```

## Checklist

- [ ] Instructions and data are clearly separated with delimiters.
- [ ] Output format is specified and validated against a schema.
- [ ] Prompt was tested on at least 2 providers.
- [ ] Version + changelog recorded alongside the prompt file.

## Common Pitfalls

- Vague verbs ("improve", "enhance") produce drifting output; use "rewrite to <50 tokens".
- Over-stuffing examples: 2-3 diverse ones beat 10 similar ones.
- Trusting a single provider's output without cross-checking; Claude-tuned prompts often fail on GPT.
