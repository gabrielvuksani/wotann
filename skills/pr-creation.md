---
name: pr-creation
description: Write high-signal pull requests with a clear test plan
context: main
paths: []
---

# PR Creation

## When to Use
- Opening a new pull request.
- Updating an existing PR's title / description / test plan.
- Reviewing your own diff before requesting review from others.
- Preparing a backport or hotfix PR.

## Rules
- Title under 70 characters with a type prefix (`feat:`, `fix:`, `refactor:`).
- Body starts with a 1-3 bullet summary — the "why", not the "what".
- Explicit test plan: how the reviewer can verify this works.
- Keep PRs under ~400 lines changed when possible.
- One concern per PR — don't mix refactor with feature.
- Link the issue / ticket / design doc.
- Self-review the diff before hitting "Request review".

## Patterns
- **Template**: Summary → Motivation → Test plan → Screenshots → Risk / Rollback.
- **Draft first**: open as draft, mark ready only when CI is green.
- **Screenshots or screencasts** for UI changes (before / after).
- **Migration note** called out explicitly if the PR touches schema or config.
- **"Why this over alternatives"** paragraph for architectural PRs.

## Example
```markdown
## Summary
- Add `wotann skill validate` CLI for local skill lint
- Route it through `SkillLoader.validate()` to mirror runtime checks
- Print a JSON report when `--json` is passed

## Motivation
Skill authors currently only learn about broken frontmatter when running the
full daemon. This PR adds a fast pre-flight validator.

## Test plan
- [ ] `wotann skill validate skills/example.md` reports errors on malformed input
- [ ] `wotann skill validate --json` emits parseable JSON
- [ ] `npm test -- skill-loader` passes

## Risk / Rollback
Additive-only. Revert = remove the CLI subcommand.
```

## Checklist
- [ ] Title has a type prefix and is under 70 chars.
- [ ] Body has Summary, Motivation, Test Plan, Risk.
- [ ] CI is green before requesting review.
- [ ] Diff is < 400 lines (or explain why not).
- [ ] Linked issue/ticket is open and current.

## Common Pitfalls
- **Vague titles** like "improvements" or "fixes".
- **Mixed PRs** combining unrelated changes.
- **Test plan missing** — reviewer has to invent how to verify.
- **Screenshots-only** for PRs that also touch backend contracts.
- **Force-pushing mid-review** and wiping reviewer comments' anchors.
