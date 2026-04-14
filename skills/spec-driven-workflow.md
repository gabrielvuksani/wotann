---
name: spec-driven-workflow
description: Write specs before code, define acceptance criteria
context: main
paths: []
---
# Spec-Driven Workflow
## Process
1. **Spec**: Write feature spec with acceptance criteria BEFORE coding.
2. **Review**: Get spec reviewed (even by yourself).
3. **Implement**: Code to the spec, not to assumptions.
4. **Verify**: Each acceptance criterion is tested.
## Spec Format
```markdown
## Feature: [Name]
### User Story
As a [role], I want [action] so that [benefit].
### Acceptance Criteria
- [ ] Given [context], when [action], then [result].
- [ ] Given [context], when [action], then [result].
### Out of Scope
- [What this feature does NOT do]
```
