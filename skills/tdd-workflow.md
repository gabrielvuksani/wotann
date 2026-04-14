---
name: tdd-workflow
description: RED-GREEN-REFACTOR test-driven development enforcement
context: main
paths: ["**/*.test.ts", "**/*.spec.ts"]
---

# TDD Workflow

## The Cycle (MANDATORY for new features)
1. **RED** — Write a failing test first. Run it. Confirm it fails.
2. **GREEN** — Write the MINIMUM implementation to make the test pass.
3. **REFACTOR** — Clean up the code while keeping tests green.
4. **REPEAT** — Next test case.

## Test Quality
- Test behavior, not implementation details.
- Each test should test ONE thing.
- Tests should be independent (no shared mutable state).
- Use descriptive test names: `it("returns error when email is invalid")`.
- Arrange-Act-Assert structure.

## Coverage
- 80% minimum coverage for new code.
- Critical paths: 100% coverage (auth, payments, data mutations).
- Use `vitest --coverage` to verify.

## Rules
- NEVER write implementation before the test exists.
- NEVER modify tests to make them pass (fix the implementation).
- NEVER skip the RED step (confirming the test fails first).
- Mock external dependencies, not internal modules.
