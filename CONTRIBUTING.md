# Contributing to WOTANN

Thanks for your interest in WOTANN. This document covers everything you need to make a contribution stick.

## Quick Setup

```bash
# Clone
git clone https://github.com/gabrielvuksani/wotann.git
cd wotann

# Install (Node 20+, ideally 22)
npm install

# Verify
npm run typecheck
npm test
npm run build

# Run the daemon (in another shell)
npx tsx src/index.ts daemon worker

# Run the desktop app (in yet another shell)
cd desktop-app
npm install
npx tauri dev
```

iOS development needs Xcode 16+ and `xcodegen`:

```bash
brew install xcodegen
cd ios
xcodegen generate
open WOTANN.xcodeproj
```

## Project Layout

See [`README.md`](README.md#project-structure) for the full tree. Key entry points:

| File | Purpose |
|---|---|
| `src/index.ts` | CLI entry — 78 commands via Commander |
| `src/lib.ts` | Public programmatic API (~90 exports) |
| `src/core/runtime.ts` | `WotannRuntime` composition root |
| `src/daemon/kairos.ts` | Always-on daemon (15s tick + cron + heartbeat) |
| `src/daemon/kairos-rpc.ts` | All RPC handlers (chat, providers, channels, MCP, ...) |
| `desktop-app/src/components/layout/AppShell.tsx` | Tauri React shell + view router |
| `desktop-app/src-tauri/src/commands.rs` | Tauri command surface (proxies daemon RPC) |
| `ios/WOTANN/WOTANNApp.swift` | iOS root scene + WCSession delegate |

## Coding Conventions

- **TypeScript strict, no `any`** — `tsconfig.json` enforces.
- **Immutable data** — return new objects, never mutate. Spec mandates.
- **File size** — 200-400 LOC typical, 800 max. A few god objects (`runtime.ts`, `kairos-rpc.ts`) are flagged for incremental extraction.
- **Many small files** — high cohesion, low coupling. Organize by feature/domain.
- **Error handling** — handle explicitly. Never silent `catch {}`.
- **Input validation** — validate at system boundaries (user input, external APIs).
- **Comments** — only when WHY is non-obvious. Identifiers should explain WHAT.
- **No emojis in source** unless explicitly part of UX.

## Workflow

WOTANN follows a planner → test-engineer → code-reviewer → verifier dispatch:

1. **Plan** — for non-trivial features, sketch the approach in an issue first.
2. **Branch** — `git checkout -b feat/short-description`.
3. **Test-first** — write the failing test (RED), then implement (GREEN), then refactor.
4. **Typecheck + test** — `npm run typecheck && npm test` must be exit 0.
5. **Conventional commit** — see below.
6. **PR** — fill out the template. CI must be green.

## Commit Style

[Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): short summary

Longer body if needed. Wrap at 80.

- Bullet points for what changed
- Why it changed (link an issue if applicable)

Co-Authored-By: Name <email>     # if pairing
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`.

## Testing

- **Unit tests** in `tests/unit/` — Vitest.
- **Integration tests** in `tests/integration/` — exercise full subsystem seams.
- **E2E tests** in `tests/e2e/` — boot a real daemon, run real CLI commands.
- iOS + Rust + React do not have first-class test suites yet — XCUITest, `cargo test`, and Vitest+jsdom contributions welcome.

```bash
npm test                          # full suite
npm test -- tests/unit/foo.test   # single file
npm test -- --watch               # watch mode
```

## Architecture Decisions

Major design choices live in [`DECISIONS.md`](DECISIONS.md). When a PR introduces a new architectural commitment, append a numbered decision (`D40`, `D41`, ...) with rationale, alternatives considered, and rejection reason.

## Skill Authoring

WOTANN's skill registry lives in `skills/`. A skill is one Markdown file with frontmatter:

```markdown
---
name: my-skill
description: Use when [specific trigger].
context: fork           # optional — runs in subagent context
paths: []               # optional — file path patterns to scope
---

# My Skill

## Trigger
When the user says "frobnicate" or pastes a `.frob` file...

## Procedure
1. Read the file.
2. ...
```

Trigger phrases starting with `Use when`, `Use PROACTIVELY`, or `Trigger when` are recognized by the skill router. Run `wotann skills lint` to validate.

## Provider Adapters

Adding a provider:

1. If it's OpenAI-compatible — add a case in `src/providers/registry.ts` (15 lines).
2. If it's Anthropic-shaped — extend `src/providers/anthropic-adapter.ts`.
3. Otherwise — implement the `ProviderAdapter` interface in a new `src/providers/<name>-adapter.ts`.
4. Append to `ProviderName` enum in `src/core/types.ts`.
5. Add a test fixture in `tests/providers/`.

The 17-provider router handles auth, rate limiting, format translation, fallback chaining, and capability augmentation automatically.

## Issue Reporting

Use the issue templates:
- **Bug report** — minimum repro + `wotann debug share` output (PII-scrubbed).
- **Feature request** — link to a competitor's implementation if applicable.

For security issues, see [`SECURITY.md`](SECURITY.md) — do **not** open a public issue.

## Code of Conduct

By contributing you agree to abide by the [Contributor Covenant](CODE_OF_CONDUCT.md).

## Releasing (maintainers)

```bash
npm version <patch|minor|major>
git push --follow-tags
gh release create v$(node -p "require('./package.json').version") --generate-notes
npm publish
```

CI tags trigger Tauri DMG build (when configured) and GitHub Release upload.

---

Questions? Open a discussion or DM `@gabrielvuksani` on GitHub.
