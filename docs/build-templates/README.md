# Build templates — `wotann build` scaffold packs

`wotann build` turns a free-form product spec into a working project
tree. The pipeline picks a scaffold + DB + auth + deploy plan, then
emits files. Until T9 closure these files were placeholder stubs with a
"run `wotann skills load pack-<id>` to materialize" comment — but the
packs themselves did not exist. This directory + the four `pack-*.md`
files in `skills/` close that gap so the emit is functional.

## How `wotann build` connects to a skill pack

```
        ┌──────────────────────────────────────────────────────┐
        │  user invokes `wotann build "<spec>" --emit --out=…` │
        └──────────────┬───────────────────────────────────────┘
                       ▼
        src/cli/commands/build.ts → runBuildCommand(opts)
                       │
                       ▼
        src/build/scaffold-registry.ts → selectScaffold(spec)
                       │  picks one of:
                       │    nextjs-app-router | hono-react-edge
                       │    astro-static       | expo
                       ▼
        src/build/{db,auth,deploy}-*.ts → provision plans
                       │
                       ▼
        composeFiles() → unified file manifest
                       │  (today: placeholderFor(...) stubs)
                       ▼
        emitToDisk()  → writes files to --out=<dir>
                       │
                       ▼
        skill packs in `skills/pack-*.md` materialize the rest.
        Each pack lists every file from
        SCAFFOLDS[<id>].files plus any additive companions
        (e.g. expo-router's `app/` tree).
```

## The four canonical packs

Each pack is a single Markdown file with a `type: scaffold-pack`
frontmatter and a `materializes: <scaffold-id>` field linking it back
to the registry. The body is a sequence of `### path/to/file` headings,
each followed by a fenced code block whose contents are the file body.

| Scaffold ID | Pack file | Runtime | Use when the spec mentions… |
|---|---|---|---|
| `nextjs-app-router` | [pack-nextjs-app-router.md](../../skills/pack-nextjs-app-router.md) | Node 18+ | full-stack, SaaS, dashboard, admin, auth, Stripe, server components |
| `hono-react-edge` | [pack-hono-react-edge.md](../../skills/pack-hono-react-edge.md) | Cloudflare Workers / edge | edge runtime, minimal API, Hono, sub-10ms cold start |
| `astro-static` | [pack-astro-static.md](../../skills/pack-astro-static.md) | Static (Node build) | blog, marketing site, docs site, landing page, MDX, zero JS |
| `expo` | [pack-expo.md](../../skills/pack-expo.md) | React Native + Expo SDK 50+ | iOS, Android, mobile app, cross-platform, React Native |

## What "functional" means here

Each pack is a minimal but bootable project — not a feature-rich
template. After `wotann build … --emit` followed by `npm install`:

| Pack | First-run command | Expected outcome |
|---|---|---|
| `nextjs-app-router` | `npm run dev` | Next dev server on :3000, GET / + GET /api/health |
| `hono-react-edge` | `npm run dev` | Wrangler dev on :8787, SSR'd React, GET /api/health |
| `astro-static` | `npm run dev` | Astro dev on :4321, hot reload; `npm run build` produces `dist/` |
| `expo` | `npx expo start` | Metro bundler boots; iOS/Android/web all build |

No external secrets, no database migrations, no auth provider keys —
those land via the DB + auth provisioners on top of the scaffold.

## Editing rules

1. **File invariant.** The set of file paths in each pack must be a
   superset of `SCAFFOLDS[<id>].files` from
   `src/build/scaffold-registry.ts`. The build pipeline emits exactly
   those paths; if a pack drops one, that file falls back to the
   placeholder stub (and `wotann build`'s output regresses).
2. **Pin versions.** Use realistic minor versions (e.g. `next@14.2.x`,
   `astro@4.13.x`, `expo@~50.0.x`, `hono@4.5.x`). Avoid `latest`.
3. **No secrets.** Never embed API keys, tokens, or service-account
   JSON in a pack. The DB / auth provisioners surface those via env
   vars at run time.
4. **Keep it minimal.** Each pack is capped at ~400 LOC. If a feature
   needs more (Tailwind config, ORM client, marketing copy), put it
   behind a follow-on skill, not in the pack.
5. **Frontmatter must include both `name` and `materializes`.** `name`
   keeps the file loader-compatible (the WOTANN skill loader keys off
   `name`); `materializes` is the canonical link to the scaffold ID
   used by `wotann build`.

## Adding a fifth scaffold

1. Append a new entry to `SCAFFOLDS` in
   `src/build/scaffold-registry.ts` with `id`, `signals`, and `files`.
2. Update the union type `ScaffoldId` and the `buildNextSteps` switch.
3. Create `skills/pack-<new-id>.md` mirroring the four existing packs.
4. Add a row to the table above.
5. Add a test asserting (a) the registry now has 5 entries and (b) the
   pack file exists and lists every path from `SCAFFOLDS[<new-id>].files`.

## Provenance

Closes T9 (build pipeline placeholders → functional emit). Audit 3
flagged that `wotann build --emit` produced placeholder stubs because
no `pack-*` skills existed. This directory + the four packs ship the
missing artifacts.
