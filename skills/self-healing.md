---
name: self-healing
description: Autonomous diagnosis and repair of build, test, and runtime errors. Use when an agent hits a failure it must recover from without human intervention (CI failures, flaky tests, dependency drift).
---

# Self-Healing Pipeline

Use when: autonomous agent encounters build failures, test failures, or runtime errors
and needs to automatically diagnose and fix them without human intervention.

## Pipeline Stages

### Stage 1: Error Classification
- Parse error output (compiler, test runner, linter)
- Classify as: syntax, type, import, runtime, test, config, dependency
- Map to fix strategy

### Stage 2: Fix Strategy Selection
| Error Type | Strategy |
|-----------|----------|
| Syntax error | LSP auto-fix or direct edit at error location |
| Type error | Add/fix type annotations, update interfaces |
| Import error | Fix import path, add missing dependency |
| Runtime error | Add error handling, fix logic |
| Test failure | Read test expectation vs actual, fix implementation |
| Config error | Validate against schema, fix invalid keys |
| Dependency error | npm install / version bump / peer dep resolution |

### Stage 3: Automated Fix
1. Read the error output and source file
2. Apply the fix strategy
3. Run verification (build + test)
4. If still failing: escalate to next strategy

### Stage 4: Escalation
If 3 sequential fix attempts fail:
1. Try a different approach (decompose the problem)
2. Use a different model to analyze the error
3. Search codebase for similar patterns that work
4. If all else fails: generate a detailed error report for human

## Self-Healing Hooks
Wire into the autonomous mode's verification step:
- After each cycle, if tests fail, enter self-healing pipeline
- Pipeline runs as a sub-loop (max 3 attempts per error)
- Each fix is shadow-committed for safe rollback

## Hive-Inspired Features (from competitor analysis)
- Process tree monitoring: restart crashed worker agents
- Deadlock detection: kill and re-spawn stuck tasks
- Resource monitoring: scale down when memory/CPU limits approached
- Heartbeat health checks: verify all sub-agents are responsive
