---
name: context-management
description: Token tracking and compaction strategy for WOTANN's 5-strategy context engine
context: main
paths: []
---

# Context Management

## When to Use

- Token usage exceeds 50% and the task still has significant work remaining.
- Before a planned compaction in `src/context/compaction/` to avoid mid-task cuts.
- Investigating why provider responses truncate or lose earlier task state.
- Tuning which zone (system, memory, tools, conversation) dominates the budget.
- After noticing WOTANN's TurboQuant extension is approaching its ceiling.

## Rules

- Compact proactively at 50%, not reactively at 95% — mid-task cuts break plans.
- WAL-save state (Engram `mem_save`) before any compaction, always.
- System prompts and the last 3 user turns are never compacted.
- Never evict active planning files (`task_plan.md`, `progress.md`).
- Report budget per zone; a single aggregate number hides which zone is bloated.
- Each compaction records a marker so recovery knows the last checkpoint.

## Patterns

- **Zone budgeting**: track system, memory, tools, conversation separately.
- **5 strategies in order**: (1) drop unused tool schemas, (2) evict old turns, (3) summarize tool outputs, (4) offload memory to disk, (5) aggressive conversation summarization.
- **Traffic light**: Green <50%, Yellow 50-70%, Orange 70-85%, Red 85-95%, Critical >95%.
- **Recovery**: `mem_context` call after compaction repopulates the working buffer.
- **TurboQuant**: WOTANN's context extension technique — pushes beyond the native window.

## Example

```
Budget check (capacity = 200k tokens):
  system      14k (7%)    OK
  memory      38k (19%)   OK
  tools       22k (11%)   OK (2 unused schemas -> drop saves 6k)
  conversation 112k (56%)  YELLOW -> summarize turns 1-20 before strategy 2

Action: strategy 1 (drop unused) + strategy 3 (summarize old turns).
Save WAL -> Engram topic_key='context/compact-2026-04-13-001'.
```

## Checklist

- [ ] Token budget split by zone, not aggregate.
- [ ] WAL-save executed before any compaction.
- [ ] Strategies applied in order (cheapest first).
- [ ] Recovery marker written for post-compact `mem_context` call.

## Common Pitfalls

- Waiting until Red (>85%) — provider responses get truncated mid-flow.
- Evicting the last planning file by mistake; work restarts from zero.
- Summarizing too aggressively; agent "forgets" its own earlier decisions.
