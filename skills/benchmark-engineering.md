---
name: benchmark-engineering
description: Run evaluations against SWE-bench, Terminal-Bench, Tau-bench, or custom eval sets. Use when tuning prompts for benchmark performance or tracking quality metrics across releases.
---

# Benchmark Engineering

Use when: running evaluations, tuning prompts for benchmark performance,
or tracking quality metrics over time.

## SWE-Bench Protocol
Automated evaluation against SWE-Bench-Verified:
1. Load problem from dataset
2. Apply WOTANN agent pipeline (plan → implement → verify)
3. Run test suite
4. Record pass/fail + metadata (tokens used, time, strategy)
5. Compare against baseline scores

## TerminalBench Strategy
WOTANN's own evaluation framework for terminal-based agent capabilities:
- **Navigation**: cd, ls, find, project structure comprehension
- **Editing**: file creation, multi-file edits, refactoring
- **Debugging**: error reading, log analysis, fix application
- **Git**: branching, merging, conflict resolution
- **Build**: dependency resolution, compilation, test running

## Prompt Tuning Pipeline
1. Define evaluation metric (e.g., SWE-Bench pass rate)
2. Parameterize the system prompt (mode instructions, skill merging)
3. Run A/B experiments: variant A vs variant B
4. Statistical significance test (bootstrap confidence intervals)
5. Promote winning variant to production

## Quality Tracking
- Store results in `.wotann/benchmarks/` as JSON
- Track trends over time (are we improving?)
- Regression alerts when scores drop >5%
- Leaderboard across providers/models

## Arena Mode (from arena.ts)
Head-to-head model comparison:
- Same prompt sent to 2 models simultaneously
- Outputs compared by a 3rd model (judge)
- ELO ratings updated after each round
- Statistical confidence before declaring a winner
