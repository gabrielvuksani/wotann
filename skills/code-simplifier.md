---
name: code-simplifier
description: Reduce complexity while preserving exact behavior
context: fork
paths: []
---

# Code Simplifier

## Process
1. Read the full file to understand context.
2. Identify complexity hotspots (deep nesting, long functions, many parameters).
3. Apply simplifications one at a time.
4. Run tests after EACH change to confirm behavior is preserved.

## Techniques
- **Extract function**: Long function → smaller named functions.
- **Early return**: Deep nesting → guard clauses at the top.
- **Inline variable**: Variable used once → inline it.
- **Remove dead code**: Code that can never execute → delete it.
- **Simplify conditional**: Complex boolean → named predicate function.
- **Replace loop with functional**: map/filter/reduce where clearer.

## Rules
- NEVER change behavior. The simplification must be a pure refactor.
- NEVER add features during simplification.
- Run tests after every change (regression = rollback).
- If a simplification makes the code less readable, don't do it.
- Three similar lines of code is better than a premature abstraction.

## Metrics
- Cognitive complexity (SonarQube): aim for <15 per function.
- Lines per function: aim for <50.
- Parameters per function: aim for <5.
- Nesting depth: aim for <4.
