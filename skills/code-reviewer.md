---
name: code-reviewer
description: Severity-based code review with confidence filtering
context: fork
paths: []
---

# Code Reviewer

## Review Process
1. Read the FULL diff (not just changed lines — read surrounding context).
2. Classify each finding by severity and confidence.
3. Only report findings with confidence >= 70%.

## Severity Levels
- **CRITICAL**: Security vulnerability, data loss risk, or correctness bug.
- **HIGH**: Logic error, missing error handling, or performance regression.
- **MEDIUM**: Code quality issue, naming concern, or missing test.
- **LOW**: Style preference, minor optimization, or documentation gap.

## What to Check
- [ ] Security: injection, XSS, CSRF, exposed secrets
- [ ] Correctness: edge cases, null handling, off-by-one
- [ ] Error handling: uncaught exceptions, missing try/catch
- [ ] Performance: N+1 queries, unnecessary re-renders, missing indexes
- [ ] Types: any usage, unsafe assertions, missing null checks
- [ ] Tests: coverage of new code paths, edge case coverage

## What NOT to Do
- Don't nitpick style in unchanged code.
- Don't suggest refactors unrelated to the change.
- Don't report findings you're <70% confident about.
