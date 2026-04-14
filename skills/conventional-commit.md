---
name: conventional-commit
description: Conventional commit format with semantic versioning
context: main
paths: []
---

# Conventional Commits

## Format
```
<type>(<scope>): <subject>

<body>

<footer>
```

## Types
- **feat**: New feature (MINOR version bump)
- **fix**: Bug fix (PATCH version bump)
- **docs**: Documentation only
- **style**: Formatting, semicolons (no code change)
- **refactor**: Code change that neither fixes nor adds
- **perf**: Performance improvement
- **test**: Adding or fixing tests
- **chore**: Build process, dependencies, tooling

## Rules
- Subject line: imperative mood, lowercase, no period, max 72 chars.
- Body: explain WHY, not WHAT (the diff shows what).
- Breaking changes: add `BREAKING CHANGE:` in footer or `!` after type.
- Reference issues: `Closes #123` or `Fixes #456` in footer.

## Examples
```
feat(auth): add OAuth2 provider rotation

Support automatic rotation between multiple OAuth tokens
when rate limits are hit on the primary account.

Closes #42
```
