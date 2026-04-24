# Design Bridge

Internal reference for WOTANN's Design Bridge — the round-trippable
translation layer between a local codebase and Anthropic's Claude
Design handoff format. See Master Plan V9 Tier 8 (`docs/MASTER_PLAN_V9.md`
lines 1256-1332) for the authoritative spec.

## What it is

Claude Design (Anthropic Labs, 2026-04-17) ships design systems in a
standards-track format: a zip containing a `manifest.json`, a
W3C DTCG v6.3 `design-system.json`, an optional `components.json`,
and optional `code-scaffold/` + `assets/` trees. The Design Bridge
is WOTANN's full two-way port: point it at a codebase and it produces
the same bundle Claude Design would produce; point it at a Claude
Design bundle and it ingests it into the local repo without losing
structure.

The goal is parity. Any bundle that survives a Claude Design →
WOTANN → Claude Design round trip must land in the same shape.

## Pipeline

The pipeline is a stack of five primitives. Each tier from the V9
plan closes one link:

- **T8.1** `src/design/dtcg-emitter.ts` — `emitDtcg(system)` converts
  the extractor's `DesignSystem` into a W3C DTCG v6.3 tree. Pure
  function, byte-stable output via `serializeDtcg`.
- **T8.2** `src/design/bundle-writer.ts` — `writeHandoffBundle(input, dir)`
  writes a typed bundle to disk as a plain directory. Matching pair
  with the receiver: the bundle layout is documented there.
- **T8.3** `src/design/bundle-diff.ts` — `diffBundles(before, after)`
  tree-diffs two DTCG bundles and returns the added/removed/changed
  tokens with source-location trails. Used by the T8.7 GHA for PR
  drift comments.
- **T8.4** `src/cli/commands/design-*.ts` — the four user-facing
  commands: `export`, `verify`, `apply`, `preview`. `apply` goes
  through the ApprovalHandler so token writes are never silent.
- **T8.5** `src/ui/components/DesignPreview.tsx` + round-trip tests
  + this doc. Closes the user-facing and QA loops.

## User-facing surface

Users interact with the Design Bridge through four CLI commands:

- `wotann design export --format=dtcg --out ./design-system/` —
  extract + emit + write a Claude-Design-compatible bundle.
- `wotann design verify --against bundle.zip` — diff a local
  extraction against a reference bundle; exits non-zero on drift.
- `wotann design apply <bundle.zip>` — ingest a Claude Design
  bundle, routing every file write through the approval queue.
- `wotann design preview` — render a compact terminal preview of
  the local design system using `DesignPreview` (T8.5).

The preview component is also exposed inside the Workshop tab as a
secondary panel, so agents inspecting a change set see token diffs
inline.

## Round-trip contract

The contract is a single identity:

```
parse(write(emit(system))) ≡ emit(system)
```

Stated in prose: extracting a system, emitting DTCG, writing the
bundle, and re-parsing it must produce a representation that
`diffBundles` reports as empty. `tests/design/bridge.test.ts` pins
this invariant with eight test groups covering manifest fields,
color counts, targeted mutations, serialization stability, optional
fields, components, and a 500+ token stress system.

Cosmetic serialization drift (key order, whitespace) is eliminated
by `serializeDtcg`'s sorted replacer — two emits of the same
system produce byte-identical JSON.

## Bundle format

The authoritative shape is in `src/design/handoff-receiver.ts`.
In brief: `manifest.json` uses snake_case field names
(`bundle_version`, `exported_from`, `created_at`) so it wire-matches
Claude Design's own output. `design-system.json` is a W3C DTCG v6.3
tree whose leaves carry `$type`, `$value`, and optional
`$description`. `components.json` (optional) is an array of
component descriptors normalized by `component-importer.ts`.

## Security notes

`design apply` is the only mutating command, and every file it
writes goes through the ApprovalHandler introduced in T8.4's
`design-apply.ts`. There is no "silent apply" mode — token writes
are visible, approvable, and auditable by the same machinery that
governs agent-authored code changes.

Bundles from untrusted sources should be `verify`-ed first; the
verify command compares without writing and exits non-zero on any
drift, giving reviewers a chance to read the diff before the apply
step.

## Extension points

Future tiers that build on the Design Bridge:

- **T8.6** — MCP server at `src/mcp/servers/design-bridge.ts` exposes
  the four CLI commands as MCP tools so external agents (Claude
  Code, Cursor, Zed) can invoke WOTANN's bridge as a first-class
  tool surface.
- **T8.7** — GitHub Action (`.github/actions/wotann-design-verify/`)
  that posts a diff comment on every PR that touches design files.
  Zero-UX team adoption.
- **Custom emitters** — the DTCG emitter is pure and one-shot, so
  adding non-DTCG target formats (Figma Tokens, Style Dictionary,
  Tailwind config) is a matter of writing a new emitter alongside
  `dtcg-emitter.ts` and re-using the writer + receiver primitives.
