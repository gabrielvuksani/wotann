---
name: tree-search
description: Parallel hypothesis exploration for complex bugs (4+ causes)
context: fork
paths: []
---
# Tree Search (BFTS)
## When to Use
- Bug has 4+ possible root causes.
- Linear debugging has failed 3+ times.
- The fix requires exploring multiple code paths simultaneously.
## Process
1. Generate hypothesis tree (root = symptom, branches = possible causes).
2. Score each branch by likelihood (prior probability).
3. Explore highest-scored branch first (best-first search).
4. If branch is ruled out, backtrack and explore next.
5. Parallelize: assign each branch to a separate subagent.
## Rules
- Each branch gets its own fresh context (no pollution).
- Time-box each exploration (max 5 minutes per branch).
- Aggregate findings from all branches before deciding.
