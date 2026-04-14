---
name: golang-pro
description: Go idioms, goroutines, channels, error handling, modules
context: fork
paths: ["**/*.go", "**/go.mod"]
requires:
  bins: ["go"]
---
# Go Pro
## Rules
- Use `error` returns, not exceptions. Check every error.
- Use goroutines + channels for concurrency, not shared memory.
- Use `context.Context` for cancellation and deadlines.
- Use `interface{}` only at boundaries. Prefer concrete types.
- Use `go vet`, `staticcheck`, and `golangci-lint`.
- Organize by domain, not by type (no `models/`, `handlers/` packages).
## Patterns
- Table-driven tests with `t.Run()`.
- Functional options for configurable constructors.
- `defer` for cleanup (file handles, locks, connections).
- Struct embedding for composition (not inheritance).
## Anti-Patterns
- `init()` functions with side effects.
- Package-level mutable state.
- Ignoring errors with `_`.
- Channels where a mutex would be simpler.
