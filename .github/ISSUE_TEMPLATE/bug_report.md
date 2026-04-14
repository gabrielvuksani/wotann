---
name: Bug report
about: Something broken? Help us reproduce and fix it.
title: "[bug] "
labels: bug
assignees: ''
---

## Describe the bug

A clear and concise description of what's broken.

## Repro steps

```bash
# Minimum command sequence that reproduces the bug
wotann ...
```

## Expected vs actual

- **Expected**: ...
- **Actual**: ...

## Environment

- WOTANN version: `wotann --version`
- Node version: `node --version`
- OS: macOS 13 / Ubuntu 22 / Windows 11
- Surface: CLI / TUI / Desktop app / iOS
- Provider: anthropic / openai / ollama / ...

## Debug share output

Run `wotann debug share` and paste the (PII-scrubbed) summary here:

```
...
```

## Logs

If the daemon is involved, `~/.wotann/logs/<today>.jsonl` may have details. Paste relevant lines (redact secrets):

```jsonl
...
```

## Additional context

Anything else — screenshots, related issues, recent config changes.
