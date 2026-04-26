# RELEASE_INFRA — User-action checklist for WOTANN release infrastructure

This doc lists the **manual GitHub-side configuration** that the WOTANN
release pipeline depends on. Code-side hardening (SHA-pinned actions,
job timeouts, hard test gate, exit-code propagation) is enforced
automatically by `.github/workflows/release.yml` and `ci.yml`. The items
below cannot be set from a workflow file and must be configured by a
repo admin in the GitHub UI.

> **Status legend**
>
> - **REQUIRED** — release breaks (or silently misbehaves) without it.
> - **STRONGLY RECOMMENDED** — release works but is materially less safe.
> - **OPTIONAL** — improves DX, no impact on correctness.

---

## 1. Branch protection on `main` (REQUIRED)

Currently `main` has **no protection rule** — anyone with push access can
land directly to `main`, force-push, or delete the branch (audit
finding SB-15 followup, 2026-04-25). Configure as follows:

1. Open `https://github.com/gabrielvuksani/wotann/settings/branches`
2. Click **Add branch protection rule**
3. **Branch name pattern**: `main`
4. Enable the following:
   - [x] **Require a pull request before merging**
     - [x] Require approvals: **1**
     - [x] Dismiss stale pull request approvals when new commits are pushed
     - [x] Require review from Code Owners (only if `CODEOWNERS` exists)
   - [x] **Require status checks to pass before merging**
     - [x] Require branches to be up to date before merging
     - **Required status checks** (search and add each one):
       - `Typecheck + Build (Node 22 / ubuntu-latest)`
       - `Typecheck + Build (Node 22 / macos-latest)`
       - `Tests (hard gate)`
       - `Desktop typecheck`
       - `Run WOTANN PR Checks`
       - `Adversarial prompt-injection eval (strict)` (only if the PR
         touches the 4 P0 guards or the eval harness — gate is path-
         filtered, do not mark unconditionally required)
   - [x] **Require conversation resolution before merging**
   - [x] **Require linear history** (rebase/squash only, no merge
         commits — keeps the changelog readable)
   - [ ] **Require signed commits** — OPTIONAL; enable once all
         contributors have a verified GPG/SSH signing key configured
   - [x] **Do not allow bypassing the above settings**
   - [x] **Restrict who can push to matching branches** → leave empty
         to enforce PR-only flow even for admins
   - [x] **Allow force pushes** → **OFF**
   - [x] **Allow deletions** → **OFF**
5. Click **Create**.

Verify by attempting to push directly to `main` from a clean clone — the
push should be rejected with "protected branch hook declined".

---

## 2. Apple code-signing secrets for `release.yml` (STRONGLY RECOMMENDED)

Without these, the macOS GUI DMG ships with an ad-hoc signature, so users
see a Gatekeeper "cannot verify developer" warning on first open. With
them, the DMG is Developer-ID signed and notarized — no warning.

Set at `https://github.com/gabrielvuksani/wotann/settings/secrets/actions`.
Names match the env block at `.github/workflows/release.yml` lines
161-169 exactly:

| Secret name                  | Source                                                                                                                       | Format                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `APPLE_SIGNING_IDENTITY`     | Keychain Access on a Mac with the Developer ID cert installed; right-click the cert → "Get Info" → "Common Name"             | Plain string, e.g. `Developer ID Application: Acme Inc (ABCDE12345)`                    |
| `APPLE_ID`                   | Your Apple ID email used for App Store Connect                                                                               | `you@example.com`                                                                       |
| `APPLE_TEAM_ID`              | App Store Connect → Membership → Team ID                                                                                     | 10-char alphanumeric, e.g. `ABCDE12345`                                                 |
| `APPLE_PASSWORD`             | Generate at `https://appleid.apple.com` → Sign-In and Security → App-Specific Passwords (label it "WOTANN GitHub Actions")   | 19 chars in `xxxx-xxxx-xxxx-xxxx` format                                                |
| `APPLE_CERTIFICATE`          | Export the Developer ID Application cert + private key from Keychain Access as a `.p12` file, then base64-encode the file    | `base64 -w 0 cert.p12` on Linux or `base64 -i cert.p12 \| pbcopy` on macOS              |
| `APPLE_CERTIFICATE_PASSWORD` | The passphrase you set when exporting the `.p12`                                                                             | Plain string                                                                            |

**Test path**: tag a prerelease (`git tag v0.5.0-rc.99 && git push origin v0.5.0-rc.99`)
and watch `release.yml` complete. The `Sign and notarize the app
(Developer ID path)` step should fire instead of the Ad-hoc fallback.
Delete the tag (`git push origin :v0.5.0-rc.99` then `git tag -d
v0.5.0-rc.99`) and the GitHub Release that gets created if you don't
want to publish.

If any of these secrets are unset, the workflow gracefully falls back to
ad-hoc signing — `HAS_APPLE_CERT == 'true'` is computed from
`APPLE_SIGNING_IDENTITY != ''`. The fallback path is intentional (the
release still ships) but is marked as a quality regression.

---

## 3. NPM_TOKEN secret for `npm publish` job (REQUIRED for npm releases)

`release.yml`'s `npm-publish` job will fail with "ENEEDAUTH" without
this. The failure is intentional (broken publishes should be loud), but
the secret must be set before the first stable release.

1. Go to `https://www.npmjs.com/settings/<your-username>/tokens` (must
   be logged in with the npm account that owns the `wotann` package).
2. Click **Generate New Token** → **Granular Access Token** (preferred)
   or **Classic Token** with `Automation` type.
3. Granular config:
   - **Token name**: `wotann-github-actions-release`
   - **Expiration**: 90 days (rotate quarterly)
   - **Packages and scopes**: select the `wotann` package, grant
     **Read and write**
   - **Organizations**: leave default
   - **IP allowlist**: leave empty (GitHub Actions IPs aren't fixed)
4. Copy the token (you only see it once).
5. At `https://github.com/gabrielvuksani/wotann/settings/secrets/actions`,
   click **New repository secret**:
   - **Name**: `NPM_TOKEN`
   - **Value**: the token from step 4
6. Test by tagging a prerelease (`git tag v0.5.0-rc.99 && git push
   origin v0.5.0-rc.99`) — the `npm-publish` job is gated on
   `!contains(github.ref_name, '-')` so prerelease tags **skip** npm
   publish but the rest of the release runs. To actually exercise the
   npm publish path you must tag a stable release.

**Calendar reminder**: rotate the token every 90 days. A stale or
revoked token causes the `npm publish` step to fail with `403 Forbidden`
which is hard to distinguish from a registry outage.

---

## 4. Required status checks list (reference)

The branch-protection rule above references status check names by
exact match. If you rename a job in `ci.yml`, `pr-checks.yml`, or
`agentic-browser-security.yml`, the old name in branch protection
becomes orphaned (impossible to satisfy) and the check stays "expected"
forever. The current canonical list as of 2026-04-25:

| Workflow file                          | Job name (status check)                                       | When required                                |
| -------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `ci.yml`                               | `Typecheck + Build (Node 22 / ubuntu-latest)`                 | Every PR + every push to main                |
| `ci.yml`                               | `Typecheck + Build (Node 22 / macos-latest)`                  | Every PR + every push to main                |
| `ci.yml`                               | `Tests (hard gate)`                                           | Every PR + every push to main                |
| `ci.yml`                               | `Desktop typecheck`                                           | Every PR + every push to main                |
| `pr-checks.yml`                        | `Run WOTANN PR Checks`                                        | Every PR (path-agnostic)                     |
| `agentic-browser-security.yml`         | `Adversarial prompt-injection eval (strict)`                  | PRs touching the 4 P0 guards or eval harness |
| `release.yml`                          | none — release.yml fires only on tag pushes, not PR events    | n/a                                          |

When updating this list:
1. Edit the workflow first.
2. Push to a throwaway branch and open a PR so the new check name
   becomes a registered status on at least one PR.
3. Then update branch protection — GitHub's status-check picker only
   shows checks that have run at least once.

---

## 5. Workflow file changes that need a `name:` bump

If you change the body of `release.yml` materially without touching the
top-level `name:` field, GitHub's workflow registry sometimes pins the
previous parse result, causing every subsequent run to show
`startup_failure` (root cause of audit finding SB-14, 2026-04-25). To
force a fresh parse:

1. Bump the `name:` field — e.g. `name: WOTANN Release v2` → `name: WOTANN Release v3`.
2. Commit and push.
3. The next push event re-parses and clears the cached failure state.

This is a workaround for a known GitHub Actions registry-cache
behavior; if the GitHub team ships a fix, this section can be removed.

---

## 6. SB-N7 — Tauri auto-updater pubkey (REQUIRED for self-update flow)

`desktop-app/src-tauri/tauri.conf.json:61` currently has:

```json
"pubkey": "TODO-USER-ACTION-GENERATE-VIA-tauri-signer-generate"
```

This placeholder makes the Tauri auto-updater REJECT every update because
no signature can verify against a non-PEM public key. End users see "Update
failed" indefinitely.

### Fix
```bash
cd desktop-app/src-tauri
npx @tauri-apps/cli signer generate
# Outputs:
#   ~/.tauri/wotann.key       (private — STORE IN 1PASSWORD, NEVER COMMIT)
#   ~/.tauri/wotann.key.pub   (public  — paste content into pubkey below)
```

Open `~/.tauri/wotann.key.pub`, copy the entire base64 content (it starts
with `untrusted comment: minisign public key:` followed by the key string),
and paste **only the key string** into `tauri.conf.json:61`. Per Tauri 2.x
docs, the `pubkey` field MUST contain the literal PEM/minisign content,
NOT a file path.

The private key (`~/.tauri/wotann.key`) is used by `npm run release` /
the `tauri-action` CI step to sign each new release artifact. Store it
in the project's secrets manager (1Password, Bitwarden, GitHub Actions
Secret as `TAURI_SIGNING_PRIVATE_KEY`). Apple App Notary Service is a
separate concern — see SB-N10 below.

## 7. SB-N8 — macOS code signing identity (REQUIRED for DMG distribution)

`desktop-app/src-tauri/tauri.conf.json:44` currently has:

```json
"signingIdentity": null
```

With `null`, Tauri produces an unsigned `.app` / `.dmg`. Gatekeeper rejects
unsigned binaries with the "WOTANN can't be opened because it's from an
unidentified developer" warning. Notarization (SB-N10) requires a signed
binary as input.

### Fix
```bash
# 1. List your Developer ID Application certificates:
security find-identity -v -p codesigning
# Look for an entry like:
#   "Developer ID Application: Gabriel Vuksani (TEAMID12)"

# 2. Edit desktop-app/src-tauri/tauri.conf.json:
#    "signingIdentity": "Developer ID Application: Gabriel Vuksani (TEAMID12)"
#                                                                   ^^^^^^^^^^
#                                                                   your team ID
```

If you do NOT have a Developer ID Application certificate yet:
1. Go to https://developer.apple.com/account/resources/certificates/list
2. Apple Developer Program membership ($99/year) required
3. Click `+`, choose "Developer ID Application", follow the CSR upload flow
4. Download the .cer + double-click to install in Keychain Access
5. Re-run `security find-identity -v -p codesigning` to confirm

The corresponding `Entitlements.mac.plist` (created in TIER 0 fix) declares
the Hardened Runtime entitlements required for notarization. Do NOT remove
it — `xcrun notarytool` rejects DMG submissions without Hardened Runtime.

## 8. SB-N10 — macOS notarization workflow (REQUIRED before TestFlight/distribution)

After SB-N7 + SB-N8 are configured, every release DMG must additionally
be submitted to Apple's App Notary Service:

```bash
# Set env vars (use 1Password / GitHub Secrets for these):
export APPLE_ID="you@apple.example.com"
export APPLE_TEAM_ID="TEAMID12"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"  # app-specific from appleid.apple.com

# After tauri build, submit + staple:
scripts/release/notarize-macos.sh \
  desktop-app/src-tauri/target/release/bundle/dmg/WOTANN_*.dmg
```

The script (created in TIER 0 fix) wraps `xcrun notarytool submit --wait`
+ `xcrun stapler staple` + `xcrun stapler validate`. Submission typically
takes 1-15 minutes. After success the .dmg has a stapled ticket so
Gatekeeper accepts it offline.

Notarization is REQUIRED since macOS 10.15 (Catalina) for binaries
distributed outside the Mac App Store. Without it, every download triggers
a "macOS cannot verify that this app is free of malware" prompt that can't
be dismissed by right-click-Open since macOS Sonoma (14.0).

## 9. Secret rotation calendar

| Secret                       | Cadence  | Reminder source                           |
| ---------------------------- | -------- | ----------------------------------------- |
| `NPM_TOKEN`                  | 90 days  | npmjs.com expiration on the token itself  |
| `APPLE_CERTIFICATE` (.p12)   | Annually | Apple Developer cert valid for 1 year     |
| `APPLE_PASSWORD` (app-spec)  | 90 days  | Apple ID app-specific password best-prac  |
| `APPLE_SIGNING_IDENTITY`     | Annually | Tied to APPLE_CERTIFICATE — rotate together |

Set a recurring calendar event for the 90-day items. Apple cert renewal
notifications come from `developer@apple.com` ~30 days before expiry.
