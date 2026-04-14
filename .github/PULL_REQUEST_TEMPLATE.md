## Summary

<!-- One paragraph: what changed and why. Link the issue if applicable. -->

Closes #

## What changed

- ...
- ...

## Type of change

- [ ] Bug fix (non-breaking, fixes an issue)
- [ ] New feature (non-breaking, adds capability)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Refactor (no functional change)
- [ ] Docs / chore

## Surface(s) touched

- [ ] CLI / TUI (`src/cli/`, `src/ui/`, `src/index.ts`)
- [ ] Desktop app (`desktop-app/`)
- [ ] iOS app (`ios/`)
- [ ] Daemon (`src/daemon/`, `src/core/runtime.ts`)
- [ ] Provider adapter (`src/providers/`)
- [ ] Channel adapter (`src/channels/`)
- [ ] Memory layer (`src/memory/`)
- [ ] Middleware (`src/middleware/`)
- [ ] Tests / CI / docs only

## Verification

- [ ] `npm run typecheck` is clean
- [ ] `npm test` is green (or new tests added for new code)
- [ ] `npm run build` succeeds
- [ ] Desktop typecheck clean (if `desktop-app/` touched): `cd desktop-app && npx tsc --noEmit --project tsconfig.app.json`
- [ ] iOS still compiles (if `ios/` touched): `cd ios && xcodebuild -project WOTANN.xcodeproj -scheme WOTANN build`
- [ ] Manual test on the affected surface — describe what you did:

```
...
```

## Architectural decisions

If this PR introduces a new architectural commitment, append a numbered decision (`D40`, `D41`, ...) to [`DECISIONS.md`](../DECISIONS.md) with rationale and rejected alternatives.

## Screenshots / GIFs

(For UI changes — drag and drop here.)

## Free-tier check

WOTANN's first-class commitment is "every feature works on free models too." How does this PR behave on Ollama / Gemini free tier?

## Breaking changes

(If `Type` includes "Breaking change", document the migration path.)
