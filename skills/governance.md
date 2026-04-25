---
name: governance
description: Operational policy enforcement — sandbox audit, intent gate, approval queue. These guards are HARD, not advisory.
type: cognitive-framework
source: openclaw
---

# Governance — Operational Policy Enforcement

The hard policies that keep an autonomous agent from doing damage. Unlike
prompts (advisory) and rules (advisory + reminded), governance guards are
HARD: the runtime enforces them, the agent cannot opt out, and a violation
attempt is logged.

This skill describes the THREE GUARDS that gate every potentially-destructive
agent action: the sandbox audit, the intent gate, and the approval queue.

## When to invoke

- Before any file operation outside the project root
- Before any shell command with destructive semantics (rm, drop, delete, force)
- Before any network call that could exfiltrate data
- Before any commit/push/merge action on a branch the user did not name
- Before any spend (paid API call, billable resource)
- Before invoking any tool that requires user approval per project policy

## The Three Guards

```
GUARD 1: SANDBOX AUDIT    — does this action stay within the user's allowlist?
GUARD 2: INTENT GATE      — does this action match the user's stated intent?
GUARD 3: APPROVAL QUEUE   — has the user explicitly approved this kind of action?
```

A potentially-destructive action passes ONLY if all three guards return YES.
Failing any guard halts the action and surfaces it to the user.

## Process

### Guard 1 — Sandbox Audit

Every file/network/process operation is checked against the allowlist:

| Resource | Default allowlist | Override |
|---|---|---|
| File writes | `<project_root>/**` | `wotann.yaml: allow_writes` |
| File reads | `<project_root>/**` + `~/.claude/**` | `wotann.yaml: allow_reads` |
| Shell exec | safe-list (`ls`, `cat`, `grep`, ...) | `wotann.yaml: allow_shell` |
| Network out | localhost + named domains | `wotann.yaml: allow_network` |
| Process spawn | none | `wotann.yaml: allow_spawn` |

Operations outside the allowlist HALT and emit an event:

```
SANDBOX_VIOLATION
  action: write
  target: /etc/passwd
  reason: "outside project root"
  decision: blocked
```

The agent receives the block as a tool error, NOT silently. This means the
agent's plan must adapt — pretending the action succeeded is a violation
of the agent-autonomy-kit's self-verify discipline.

### Guard 2 — Intent Gate

For every action, the agent checks: "is this part of the task the user
actually asked for?" If the action is outside the stated task, it must
be justified or skipped.

Heuristic: if the user asked for X and the action does Y where Y is not
strictly needed to achieve X, the action fails the intent gate.

Examples:
- User asked for: "fix the failing test"
- Action attempted: "refactor 5 unrelated files" → FAILS intent gate
- User asked for: "set up auth"
- Action attempted: "delete all existing user records" → FAILS intent gate (destructive AND outside scope)

A failed intent gate does NOT mean the action is wrong — it means the agent
must SURFACE the proposed action to the user before doing it.

### Guard 3 — Approval Queue

Some actions require explicit user approval per project policy. The
approval queue is a list of pending actions the agent has proposed but not
yet executed. Each entry includes:

```
id: <uuid>
proposed_at: <timestamp>
action: <description>
risk_class: low | medium | high | critical
diff: <if applicable>
why: <agent's reasoning>
```

The user can approve, reject, or modify each entry. The agent BLOCKS on
critical actions until the queue is processed.

Risk classification (canonical):

| Class | Examples | Default policy |
|---|---|---|
| low | read-only ops, scratch-file writes | auto-approve |
| medium | edits to project files, test runs | auto-approve in autopilot, prompt in interactive |
| high | git push, db writes, paid API calls | always prompt |
| critical | rm -rf, force push, drop table, delete user | always prompt + 2-step confirm |

## Configuration

The default governance posture is `strict`. Configurable in `wotann.yaml`:

```yaml
governance:
  posture: strict | balanced | permissive
  sandbox:
    allow_writes: ["<project>/**"]
    allow_reads: ["<project>/**", "~/.claude/**"]
    allow_shell: ["ls", "cat", "grep", "rg", "find", "git", "npm"]
    allow_network: ["api.anthropic.com", "github.com"]
  approval:
    auto_approve_below: medium
    require_2step: critical
    queue_persist: ".wotann/approval-queue.json"
```

`strict` is the default and recommended for autonomous mode.

## Examples

### Example — agent attempts to push a branch

Action: `git push origin HEAD`.

- Guard 1 (sandbox): shell exec, `git push` is on allowlist → pass
- Guard 2 (intent): user asked for "fix the bug and commit" — push was NOT mentioned. The agent's plan went past the user's request. → FAIL.
- Outcome: action is queued for approval, not executed. Agent surfaces to user: "ready to commit; do you also want me to push?"

### Example — agent attempts to delete files

Action: `rm -rf node_modules`.

- Guard 1 (sandbox): `rm` is on safe-list, target is inside project root → pass
- Guard 2 (intent): user asked for "clean up" — `node_modules` cleanup is plausible interpretation. Agent flags as ambiguous.
- Guard 3 (approval): `rm -rf` is high-risk → queue for approval
- Outcome: queued; user can approve.

### Example — agent attempts to modify the host's /etc/hosts

Action: write to `/etc/hosts`.

- Guard 1 (sandbox): outside project root, NOT on allowlist → FAIL.
- Outcome: action is blocked with a `SANDBOX_VIOLATION` event. Agent receives the block, must adapt plan.

## Anti-patterns

- Treating governance as advisory (it must be enforced by the runtime, not the agent)
- Bypassing guards "just this once" — the precedent destroys all future trust
- Hiding governance failures from the user — every block must surface
- Permissive defaults — start strict; loosen per-project only with explicit user approval
- Lumping all guards into one decision — they must each independently approve

## Stopping criteria

- The action has passed all three guards (or has been explicitly approved)
- The action is logged with the guard decisions
- A failure path exists for each block type (action denied → adapt plan)

## Provenance

OpenClaw's governance skill, ported into WOTANN as the operating contract
for the sandbox + approval queue + intent classifier subsystems. The three
guards are independently testable and independently configurable.
