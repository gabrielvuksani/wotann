# Tier 1 Commit-Race Errata — 2026-04-20

## TL;DR

During parallel Tier 1 P0 dispatch two commits landed with **message/content mismatches**.
No code was lost. No tree corruption. Only the commit messages are misleading; future
archaeologists using `git log --oneline` without reading the file lists will see wrong claims.

## Affected commits

| SHA | Message says | Actually contains |
|---|---|---|
| `4e8ad73` | "security(connectors): wire guardedFetch into 6 connector surfaces" | **P0-3 plugin-scanner rename only** (kairos.ts + lib.ts + plugin-sandbox→plugin-scanner rename + test rename). **Zero connector files.** |
| `01207ee` | "security(connectors): wire guardedFetch into 6 connector surfaces" | **P0-2 connector rewrite** (6 connector files + 7 new test files). Message is correct. |
| `107dd54` | "refactor(sandbox): rename plugin-sandbox → plugin-scanner, remove fake execute()" | **P0-3 plugin-scanner rename.** Message correct, but **commit is ORPHANED** (not reachable from main; alive only in reflog until gc). |

## Root cause

Agent D used `git commit --amend` to fix its own commit message. During the amend window
(HEAD rewind + rewrite), P0-3 had already committed `107dd54` and P0-2 had staged its files
with a placeholder commit message drawn from P0-2's dispatch prompt. The race let P0-2's
pending commit inherit P0-3's content (rename still staged from P0-3's committed-then-reset
state), producing `4e8ad73` with P0-2's message but P0-3's tree. P0-2 agent noticed the mis-
scope and retried, producing `01207ee` with the correct content AND correct message.

## Why no data loss

- Final HEAD tree state correctly contains: plugin-scanner.ts + plugin-scanner.test.ts +
  updated kairos.ts/lib.ts + all 6 rewritten connector files + 7 new connector test files.
- Every claim P0-3 and P0-2 made in their reports is verifiable by reading HEAD.
- The orphan `107dd54` is redundant (its files are all in `4e8ad73` already).

## Git-notes annotation (non-destructive fix)

We're attaching git-notes to the two misleading commits so `git log --show-notes` reveals
the truth without rewriting history (which would break in-flight Agents P0-4a + P0-4b who
are rooted on this branch).

```
git notes add -m "ERRATA 2026-04-20: commit message describes P0-2 guardedFetch work,
but actual diff is P0-3 plugin-scanner rename. See docs/internal/
TIER1_COMMIT_RACE_ERRATA.md." 4e8ad73

git notes add -m "ERRATA 2026-04-20: orphan commit, not reachable from main. P0-3
work ended up in 4e8ad73 due to an amend-race. See
docs/internal/TIER1_COMMIT_RACE_ERRATA.md." 107dd54
```

The orphan note is advisory; if the SHA is GC'd, the note will vanish with it.

## Why we are NOT rewriting history

- Rewriting would force Agents P0-4a + P0-4b (still in flight) to rebase mid-run, risking
  their work.
- The disk state is correct; downstream work depends only on the tree, not the log.
- Git-notes is the canonical non-destructive annotation mechanism for exactly this case.

## Lessons for future dispatch prompts

1. **Forbid `git commit --amend` in parallel-agent contexts.** Add to future prompt
   templates: "If your commit lands with a wrong message, make a new commit with a
   `fix(commit-message): re-describe <SHA>` message; NEVER use --amend."
2. **Stage-to-patch-files pattern.** Parallel agents should produce a patch file
   (`git format-patch`) and the coordinator applies it atomically; the agent never
   commits to the shared branch.
3. **Worktree isolation.** Dispatch agents to separate `git worktree add` directories
   so each agent has its own HEAD. The coordinator cherry-picks from worktrees into
   the shared branch.
4. **Sanity check after agent report.** Coordinator should `git show --stat <SHA>` on
   every claimed commit and verify the file list matches the agent's claimed scope
   BEFORE marking the task complete. Applies Quality Bar #13 to agent-produced commits.

## Quality Bars implicated

- **#13 commit messages are claims**: `4e8ad73`'s message is a false claim about content.
  Errata + git-notes repair the claim without destroying the commit.
- **#14 verify before destroying**: rewriting history to fix the message would have
  "destroyed" the commit SHA that other agents are rooted on. We verified the cost
  before acting.
