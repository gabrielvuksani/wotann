# WOTANN Build (Tier 9)

The `wotann build` command turns a free-form product spec into a structured emission plan — scaffold, database, auth, deploy manifests — and optionally writes it to disk. `wotann deploy --to=<target>` emits deployment manifests for an existing project.

## Architecture

```
wotann build [spec]
  └── scaffold-registry.selectScaffold(spec)
        4 scaffolds: nextjs-app-router | hono-react-edge | astro-static | expo
  └── db-provisioner.provisionDatabase(spec, runtime)
        3 providers: local-sqlite | turso | supabase
  └── auth-provisioner.provisionAuth(spec)
        5 providers: lucia (default) | clerk | supabase-auth | auth-js | workos
  └── deploy-adapter.adaptDeploy(runtime, projectName)
        4 targets: cloudflare-pages | vercel | fly | self-host
  └── composeFiles(...)
        emits full file manifest (plan-only unless --emit passed)

wotann deploy --to=<target>
  └── deploy-adapter.adaptDeploy(pick, projectName, customDomain)
  └── writes deploy manifests into existing project tree
```

## Routing matrix

| Spec keyword | Scaffold pick | DB pick (default) | Auth pick (default) | Deploy default |
|---|---|---|---|---|
| "server components + streaming" | nextjs-app-router | local-sqlite | lucia | cloudflare-pages |
| "edge + minimal" | hono-react-edge | turso (runtime=edge) | lucia | cloudflare-pages |
| "static content site" | astro-static | local-sqlite | lucia | cloudflare-pages |
| "iOS + Android" | expo | local-sqlite | lucia | fly |
| "Postgres + RLS + team collab" | nextjs-app-router | supabase | lucia | cloudflare-pages |
| "Clerk managed auth" | (spec-driven) | (spec-driven) | clerk | (runtime-driven) |

When no keywords match, `wotann build` falls through to the documented default (`nextjs-app-router` + `local-sqlite` + `lucia` + `cloudflare-pages`) and the result carries `matched: false` so the caller can surface the fallback reason.

## Flags

### `wotann build [spec]`

| Flag | Purpose | Default |
|---|---|---|
| `--variants=N` | Emit N variant plans for comparison | 1 |
| `--design-system=<path>` | Seed tokens from a Claude-Design handoff bundle | none |
| `--scaffold=<id>` | Force a specific scaffold | auto |
| `--db=<id>` | Force a specific DB provider | auto |
| `--auth=<id>` | Force a specific auth provider | auto |
| `--deploy=<id>` | Force a specific deploy target | auto |
| `--project-name=<n>` | Slug for manifests | first word of spec |
| `--out=<dir>` | Output directory; required with `--emit` | none |
| `--emit` | Actually write files | false (plan-only) |
| `--force` | Overwrite existing files | false |

### `wotann deploy --to=<target>`

| Flag | Purpose | Default |
|---|---|---|
| `--to=<target>` | Deploy target (required) | — |
| `--project=<dir>` | Project directory | cwd |
| `--project-name=<n>` | Manifest slug | from package.json or directory basename |
| `--custom-domain=<d>` | Include custom domain in manifests | none |
| `--emit` | Write manifest files | false (plan-only) |
| `--force` | Overwrite existing manifests | false |

## Quality bars

- **QB #6 honest failures**: every branch returns `{ ok: false, error }`. Empty spec, unknown pick, `--emit` without `--out`, pre-existing files without `--force` — all refused with typed errors.
- **QB #7 per-call state**: every entry point is a pure function over its arguments; no module-level caches.
- **QB #13 env guard**: zero `process.env` reads inside the primitives; credentials (Turso tokens, Supabase URLs, Vercel tokens) are referenced as env-var names in the emitted manifests but never read by the build primitives themselves.
- **QB #14 commit-claim verification**: the `emitted` array in the result contains only the files that were actually written. Tests stat each one.
- **QB #15 source-verified**: `tests/build/golden.test.ts` asserts the 8 blessed combos exist and their manifests match expected file sets — CI regression-checks every combination.

## Golden combos

The 8 blessed combos in `tests/build/golden.test.ts`:

1. Next.js + Cloudflare Pages + local-sqlite + Lucia (SaaS default)
2. Next.js + Vercel + Supabase + Clerk (team app)
3. Hono+React edge + Cloudflare + Turso + Lucia (edge API)
4. Hono+React edge + Fly + Supabase + WorkOS (enterprise edge)
5. Astro + Cloudflare Pages + local-sqlite + Lucia (content site)
6. Astro + Vercel + local-sqlite + Auth.js (blog)
7. Expo + Fly + Supabase + Supabase-Auth (mobile + team)
8. Expo + Self-host + local-sqlite + Lucia (mobile + self-host)

The remaining combinations ship with an "experimental" label in the CLI output; only the 8 above are CI-verified.

## Composition with existing infrastructure

`wotann build` composes (does not re-implement):

- `src/orchestration/phased-executor.ts` — used by the CLI shell to walk Research → Plan → Emit → Verify phases.
- `src/session/approval-queue.ts` — emits approval requests for destructive operations (`--emit` over existing trees).
- `src/daemon/kairos.ts` — handles long-running build jobs in the background.
- `src/orchestration/spec-to-ship.ts` — `wotann build` is the on-ramp for the spec-to-ship pipeline.
- `src/design/handoff-receiver.ts` — `--design-system=<path>` will thread tokens from a Claude-Design bundle once T8/T9 are cross-wired.

## Extending

Adding a new scaffold:

1. Append a `ScaffoldDescriptor` to `SCAFFOLDS` in `src/build/scaffold-registry.ts`.
2. Add the next-step hints in `buildNextSteps`.
3. Add a golden combo in `tests/build/golden.test.ts`.

Adding a new DB provider:

1. Add the id to `PROVIDER_IDS` in `src/build/db-provisioner.ts`.
2. Add emitters for Drizzle config, schema, env vars, and notes.
3. Cover the new path in `tests/build/db-provisioner.test.ts`.

Adding a new deploy target:

1. Add the id to `TARGET_IDS` in `src/build/deploy-adapter.ts`.
2. Add a `<target>Files(...)` emitter.
3. Add the commands / env vars / notes.
4. Extend `parseDeployTarget` narrowing.
5. Cover in `tests/build/deploy-adapter.test.ts`.
