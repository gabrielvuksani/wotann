---
name: skill-creator
description: Create, test, and evaluate new skills
context: fork
paths: []
---
# Skill Creator
## Skill Format
```yaml
---
name: my-skill
description: One-line description
context: fork | main
paths: ["**/*.ext"]
requires:
  bins: ["tool"]
---
[Skill instructions in markdown]
```
## Rules
- Keep skills focused (one domain, one concern).
- Include triggers (file patterns, keyword patterns).
- Include anti-patterns (what NOT to do).
- Test with at least 3 different prompts.
## Evaluation
- Relevance: Does it trigger for the right tasks?
- Quality: Does it improve output quality?
- Cost: How many tokens does it add?
