---
name: branch-management
description: Branching strategy, cleanup, merge vs rebase, protection
context: main
paths: []
---

# Branch Management

## When to Use
- Starting a new feature, fix, or release line.
- Cleaning up merged or stale branches (local and remote).
- Setting up or auditing branch protection rules.
- Deciding between merge, squash, or rebase for integration.
- Resolving a long-running branch that has diverged from `main`.

## Rules
- `main` (or `trunk`) is always deployable and always protected.
- Feature branches are short-lived (< 1 week). If they age, split them.
- Branch names are typed and hyphenated: `feat/<area>-<slug>`, `fix/<slug>`, `chore/<slug>`.
- Never force-push `main` or any shared branch without explicit approval.
- Stash for context switches; don't pollute history with WIP commits.
- Delete local and remote branches after merge — a fresh `git branch` is a happy branch.

## Patterns
- **Trunk-based development** with feature flags for long-running work.
- **GitHub Flow** for web apps, **Release Flow** for shipped products with support branches.
- **Squash and merge** keeps `main` history tidy; **rebase and merge** preserves every commit.
- **Stacked PRs** for large features — each PR reviewable in isolation.
- **Protected branches**: required status checks, review count, linear history, signed commits.

## Example
```bash
# Start, push, merge, clean up.
git switch -c feat/skill-validate main
# ... work ...
git push -u origin feat/skill-validate
gh pr create --fill
# After merge:
git switch main && git pull --ff-only
git branch -d feat/skill-validate
git fetch --prune
```

## Checklist
- [ ] `main` has required status checks and required reviews.
- [ ] Branch names follow the `<type>/<slug>` convention.
- [ ] Feature branches are rebased onto `main` before merge if linear history matters.
- [ ] Merged branches deleted locally and remotely.
- [ ] `git fetch --prune` run routinely to remove stale tracking refs.

## Common Pitfalls
- **Long-running branches** that accumulate conflicts.
- **Force-push to `main`** or a release branch.
- **"WIP" commits in history** that never get cleaned up.
- **Forgetting to delete merged branches** — pollutes branch list.
- **Merging `main` into feature** repeatedly instead of rebasing — noisy history.
