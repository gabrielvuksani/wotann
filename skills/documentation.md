---
name: documentation
description: Technical writing, API docs, ADRs, READMEs, runbooks
context: fork
paths: ["**/*.md", "**/docs/**", "**/README*"]
---

# Documentation

## When to Use
- Writing or updating a README, getting-started guide, or tutorial.
- Authoring an ADR (Architectural Decision Record) for a meaningful choice.
- Producing reference docs from code (JSDoc, TSDoc, Sphinx, Rustdoc).
- Creating a runbook for an on-call incident pattern.
- Reviewing docs for clarity, accuracy, and freshness.

## Rules
- Write for the reader who knows nothing about the project.
- Lead with the "why" before the "how".
- Every code block must be runnable, copyable, and self-contained.
- Prefer a diagram when words would take more than three paragraphs.
- Stale docs are worse than no docs — if you can't maintain it, don't write it.
- Link, don't duplicate — one source of truth per fact.

## Patterns
- **Diataxis framework**: Tutorials, How-to guides, Reference, Explanation.
- **ADR**: Title, Status, Context, Decision, Consequences, Alternatives.
- **Runbook**: Symptom → Diagnosis → Mitigation → Root cause → Owner.
- **README spine**: Elevator pitch → Quickstart → Install → Usage → Links.
- **Inline docstrings** with typed examples that double as doctests.

## Example
```markdown
# Installing WOTANN

> One-liner of what you get.

## Prerequisites
- Node 20+
- An API key from any provider (optional for local-only mode)

## Install
```bash
npm i -g wotann
wotann init
```

## Next
- [Quickstart tutorial](./tutorial.md)
- [Configuration reference](./reference/config.md)
```

## Checklist
- [ ] A first-time reader can finish the quickstart in under five minutes.
- [ ] Code blocks include language tags for syntax highlighting.
- [ ] Every link works — no 404s, no stale URLs.
- [ ] Docs live next to the code they describe when possible.
- [ ] Breaking changes trigger a doc update in the same PR.

## Common Pitfalls
- **Reference material where tutorials belong** — learners bounce.
- **"Simply" and "just"** — words that gaslight readers.
- **Untested code samples** that drift from the API they describe.
- **Overloaded READMEs** being tutorial + reference + changelog.
- **Undated content** so readers can't tell what's current.
