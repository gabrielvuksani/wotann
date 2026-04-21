# WOTANN v0.5.0-rc.1 — Pre-Release Readiness Sweep

**Sweep date**: 2026-04-21
**HEAD at sweep**: `8197865` (docs(release): v0.5.0-rc.1 scaffolding + autonomous sprint summary)
**Target tag**: `v0.5.0-rc.1`
**Purpose**: Evidence-bearing record of the final verification pass before the release decision.
**Policy**: Read + document only. No source edits in this sweep; anything found is noted, not
patched, so the human release captain decides whether to block or ship.

---

## 1. Build & Typecheck (green)

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | PASS (exit 0) | Clean. No diagnostics. |
| `npm run build` (`tsc && chmod +x dist/index.js`) | PASS (exit 0) | Produces `dist/index.js` (224,404 bytes, executable), `dist/lib.js` (31,386 bytes), and 57 top-level dist entries. |
| `node dist/index.js --version` smoke | EXIT 0 | Ran cleanly — see item (6) below for a version-string caveat. |

---

## 2. Package-lock consistency

| Check | Result |
|---|---|
| `package-lock.json` present | YES (217,309 bytes, lockfileVersion 3) |
| Every `dependencies` + `devDependencies` entry resolves to a `packages["node_modules/<dep>"]` entry in the lock | YES (0 missing) |
| Root package version in lockfile matches `package.json` | **NO** — lock root reports `0.4.0`; pkg is `0.5.0-rc.1`. Cosmetic-only (the lockfile's self-reported name/version field). Does NOT affect dependency resolution. Can be refreshed by a clean `npm install` at tag time; see item (6). |

---

## 3. `node_modules/` health

| Check | Result |
|---|---|
| Top-level install count | 320 direct entries under `node_modules/` |
| `require('yaml') / require('react') / require('undici')` | All three load without error (probe run) |
| `npm ls --depth=0` | Clean, exit 0, no `UNMET` / `invalid` / `extraneous` markers |

---

## 4. `.wotann/` config / `.env.example`

| Item | Status |
|---|---|
| `.env.example` (user-facing) | PRESENT at repo root, 1,231 bytes, lists all 19 provider env vars as optional |
| Project-level `.wotann/` runtime directory | PRESENT at repo root; 43 entries incl. `memory.db`, `plans.db`, `sessions/`, `threads/`, `dreams/` — this is the developer's live state, not a shipped sample. The runtime **creates** `.wotann/` on first run; no separate "sample" file is expected to ship. |
| `dist/index.js` exports `main` + `lib` paths that match `package.json.exports` | YES |

---

## 5. Security

| Check | Result |
|---|---|
| `npm audit` | **1 moderate advisory** (`hono <4.12.14`, GHSA-458j-xx4x-4375, JSX SSR HTML injection). Transitive through `@anthropic-ai/claude-agent-sdk → @modelcontextprotocol/sdk → hono@4.12.12`. Not a direct dependency. No auto-fix attempted (per scope). Mitigation: SSR path is not reached by WOTANN's server; exposure is limited unless an MCP server renders untrusted JSX via hono. |
| Direct-deps audit | CLEAN (hono is transitive only) |
| Secrets in working tree | None observed; `.env.example` is template-only with empty values |

---

## 6. Release-polish findings (document-only; NOT patched in this sweep)

These are minor items surfaced by the sweep. Each is strictly release-cosmetic or quality-of-life,
none is a functional blocker. The release captain decides whether to patch before tagging `rc.1`
or defer to `rc.2` / GA.

1. **`src/index.ts:30` hard-codes `const VERSION = "0.4.0";`** — `wotann --version` will print `0.4.0`
   against the built binary even though `package.json` is `0.5.0-rc.1`. Related stale hits:
   `src/marketplace/acp-agent-registry.ts:245` (hard-coded `"0.4.0"`), `src/core/schema-migration.ts:119,141,149,169`
   (schema-migration "to-version" target — may be intentional as a migration anchor, NOT necessarily stale).
   Fix would require src/ edit (DENY-LISTED in this task). Expected fix: read `version` from `package.json`
   or bump the string + unit test. Severity: LOW (cosmetic; does not affect functionality).

2. **Lockfile root-version string is stale** (`0.4.0` vs `0.5.0-rc.1`). Cosmetic lockfile self-reference.
   A clean `npm install` (no `--dry-run`) at tag time rewrites it. Severity: LOW.

3. **hono transitive CVE** (see §5). Waiting on `@modelcontextprotocol/sdk` release. Severity: LOW-MODERATE.

4. **Supabase history scrub still pending** (user-blocked, tracked separately). Severity: per user. Not in scope
   of this sweep.

5. **Working-tree edit to `site/assets/style.css`** exists at HEAD (6-line CSS transition polish). Pre-existing,
   unrelated to this sprint. Out of release scope. Severity: N/A.

6. **Disk capacity**: host filesystem at 96% used (20 GiB free of 460 GiB). Adequate for CI/builds; worth
   monitoring before the final `npm pack`/binary signing pass if that moves large artifacts.

7. **Known benign flakes**: 1 LSP-related test occasionally runs 7366 vs 7367 per release notes. Documented
   in `docs/RELEASE_v0.5.0_NOTES.md` §Summary table. Not a blocker; CI treats it as informational.

---

## 7. Suite counts (reported upstream, unchanged by this sweep)

| Metric | Value |
|---|---|
| Passing tests (full suite) | 7367 / 7374 (per HEAD commit message; 7 skipped) |
| `tsc --noEmit` | exit 0 |
| `npm run build` | exit 0 |
| `docs/RELEASE_v0.5.0_NOTES.md` | Present, describes retrieval-surface math and sprint delta |
| `CHANGELOG.md` | Has `[Unreleased]` placeholder ready to be promoted to `[0.5.0]` |

---

## 8. Ship / defer recommendation

**Recommendation: ship `v0.5.0-rc.1` now.**

Rationale:
- Build and typecheck are both green.
- No direct-dep CVEs; the one transitive advisory is gated behind an MCP server JSX-SSR path
  that WOTANN does not expose.
- Dependency resolution is fully consistent; the lockfile root-version mismatch is cosmetic.
- The three polish items (§6.1–§6.3) are LOW severity and appropriate to defer to `rc.2` or GA.
  In particular, the `src/index.ts` VERSION constant is a known pattern fix (read from
  `package.json`) that deserves a small targeted PR with tests, not a last-minute patch.
- `rc.1` is, by definition, the candidate to shake out exactly these kinds of cosmetic items via
  wider testing before GA. Tagging now unblocks external verification.

**Pre-tag checklist for the release captain (human-gated):**

- [ ] Decide whether to patch §6.1 (`src/index.ts` VERSION) before or after tagging. If before, expect
      one focused src/ commit + test, then re-run sweep.
- [ ] Decide whether to refresh the lockfile root-version via clean `npm install` (§6.2). Trivial.
- [ ] Confirm Supabase history scrub status (§6.4) — unblock or accept as post-release item.
- [ ] Tag `v0.5.0-rc.1` on `main` at the SHA captured above (or the patched SHA if §6.1/§6.2 are addressed).
- [ ] Promote the `[Unreleased]` block in `CHANGELOG.md` to `[0.5.0-rc.1] - 2026-04-21`.
- [ ] Run the `Release` GH workflow to produce the SEA binary matrix.
- [ ] Verify the `--version` output on the produced binary matches the tag (or accept §6.1 as known-stale).

---

**Signed**: automated pre-release sweep (docs-only).
**See also**: `docs/RELEASE_v0.5.0_NOTES.md`, `docs/AUTONOMOUS_SPRINT_SUMMARY.md`, `CHANGELOG.md`.
