# WOTANN Release Pipeline v2

Status: canonical pipeline (supersedes v1 that shipped with v0.4.0)
Owner: Gabriel Vuksani (gabrielvuksani@github)
Last updated: 2026-04-20

## TL;DR

One tag push. Eight files. No manual uploads. No `install.command`. No noise.

```bash
git tag v0.4.1 && git push origin v0.4.1
```

GitHub Actions produces the canonical 8-asset release, verifies checksums, and publishes the release on the `v0.4.1` tag.

## Canonical asset set

Every release produces exactly these 8 files. The `verify-release-assets.sh` gate in the `publish-release` job fails the build if any file is missing OR any extra file sneaks in.

| Filename | Purpose | Size (approx) | Consumer |
|---|---|---|---|
| `wotann-<VER>-macos-arm64.dmg` | Tauri 2 GUI app (drag-to-Applications) | 10-20 MB | Mac users — the 95% path |
| `wotann-<VER>-macos-arm64.dmg.sha256` | Checksum for the DMG | 100 B | Integrity verification |
| `wotann-<VER>-macos-arm64.tar.gz` | SEA CLI binary, tarballed | 55-70 MB | CLI power users / `install.sh` |
| `wotann-<VER>-macos-arm64.tar.gz.sha256` | Checksum for the CLI tarball | 100 B | Integrity verification + Homebrew |
| `wotann-<VER>-linux-x64.tar.gz` | SEA CLI binary, tarballed | 65-80 MB | Linux users, Homebrew-on-Linux |
| `wotann-<VER>-linux-x64.tar.gz.sha256` | Checksum for the Linux tarball | 100 B | Integrity + Homebrew |
| `wotann-<VER>-windows-x64.exe` | SEA single-file `.exe` | 65-80 MB | Windows users (double-click) |
| `wotann-<VER>-windows-x64.exe.sha256` | Checksum for the .exe | 100 B | Integrity verification |

Each sha256 file is literally `<64-hex-hash>  <filename>\n` — the output of `shasum -a 256` / `sha256sum`. Users verify with `shasum -a 256 -c <file>.sha256` (macOS) or `sha256sum -c <file>.sha256` (Linux).

### What we deliberately DO NOT ship

| Dropped asset | Why |
|---|---|
| `wotann-<VER>-macos-arm64` (raw binary) | Users don't know what to do with a bare binary. Ship tarball instead. |
| `wotann-<VER>-macos-arm64.sha256` (raw-binary hash) | No underlying binary, no checksum. |
| `wotann-<VER>-macos-arm64-installer.zip` | Redundant once the DMG is the Tauri GUI app. |
| `wotann-<VER>-linux-x64` (raw binary) | Same as macOS — tarball only. |
| `wotann-<VER>-windows-x64.exe.tar.gz` | Absurd to tar a `.exe`. Windows users expect the bare executable. |
| `macos-x64` | Apple Silicon only. Homebrew's `on_intel` block needs removal. |
| `linux-arm64` | Not in v0.4.0 either. Revisit when we have an arm64 Linux user demand signal. |

## Workflow graph

```
┌─────────────────────────────┐      ┌─────────────────────────────┐
│ macos-gui-dmg               │      │ macos-cli-tarball           │
│ runs-on: macos-latest       │      │ runs-on: macos-latest       │
│ Tauri 2 build → .dmg        │      │ npm run build → SEA bundle  │
│ rename + sha256             │      │ tar.gz + sha256             │
└──────────────┬──────────────┘      └──────────────┬──────────────┘
               │                                    │
               │    ┌─────────────────────────────┐ │
               │    │ linux-cli-tarball           │ │
               │    │ runs-on: ubuntu-latest      │ │
               │    │ SEA bundle → tar.gz + sha   │ │
               │    └──────────────┬──────────────┘ │
               │                   │                │
               │                   │    ┌───────────┴──────────────┐
               │                   │    │ windows-cli-exe          │
               │                   │    │ runs-on: windows-latest  │
               │                   │    │ SEA bundle → .exe + sha  │
               │                   │    └───────────┬──────────────┘
               │                   │                │
               └───────────────────┴────────────────┘
                                   │
                                   ▼
                   ┌─────────────────────────────────┐
                   │ publish-release                 │
                   │ runs-on: ubuntu-latest          │
                   │ 1. download all 8 artifacts     │
                   │ 2. verify-release-assets.sh     │
                   │ 3. sha256sum -c all             │
                   │ 4. softprops/action-gh-release  │
                   └─────────────────────────────────┘

(optional) ┌──────────────────┐
           │ npm-publish      │ fires only on stable (non-rc) tags
           │ ubuntu-latest    │ requires NPM_TOKEN secret
           └──────────────────┘
```

## Trigger

Any git tag matching `v*.*.*` or `v*.*.*-*`:

```bash
# Stable release
git tag v0.4.1
git push origin v0.4.1

# Release candidate (skips npm publish, marked as prerelease on GitHub)
git tag v0.4.1-rc1
git push origin v0.4.1-rc1
```

The `concurrency: release-${{ github.ref }}` group cancels duplicate runs when the same tag is repushed.

## Files involved

### Workflow

- `.github/workflows/release.yml` — 6 jobs (4 builders + publish + optional npm-publish). Full rewrite of v1.

### Release scripts (under `scripts/release/`)

| Script | Role in v2 | Kept? |
|---|---|---|
| `build-all.sh` | Orchestrator invoked by 3 of 4 build jobs (macos-cli, linux-cli, windows-cli). Runs tsc → esbuild-cjs → sea-bundle.sh → tar+sha256. | YES |
| `sea-bundle.sh` | Produces the SEA binary. Fails loudly on SEA fuse / dylib issues. | YES |
| `esbuild-cjs.mjs` | ESM → CJS bundler for SEA input. Handles TLA wrap + `import.meta` shim. | YES |
| `verify-binary.sh` | Post-bundle smoke test (size, file type, --version, --help, no @rpath). Called from sea-bundle.sh and pkg-bundle.sh. | YES |
| `verify-release-assets.sh` | NEW. Enforces the canonical 8-asset manifest at the publish stage. | YES (new) |
| `pkg-bundle.sh` | Fallback bundler using @yao-pkg/pkg when SEA is blocked. Not wired into the CI workflow by default, but opt-in via `WOTANN_ALLOW_PKG_FALLBACK=1`. | KEEP (resurrect path) |
| `prepublish-check.mjs` | 8 bundle-health gates before npm publish. Still used by `npm-publish` job. | YES |
| `postpublish-verify.mjs` | Post-publish registry smoke test. Not wired in v2 but available for manual use. | KEEP (manual tool) |
| `install.sh` (root + scripts/release/) | curl-to-bash installer for end users. Still referenced by Homebrew and wotann.com site. | YES |

Resurrect-before-delete policy: `pkg-bundle.sh` and `postpublish-verify.mjs` are NOT currently wired into the v2 happy path. They remain as known-good fallbacks. Delete only after two releases confirm no regression needing them.

## Local reproduction

Gabriel can produce any of the 8 assets locally:

### macOS CLI tarball

```bash
cd /Users/gabrielvuksani/Desktop/agent-harness/wotann
# Ensure PATH has official nodejs.org Node first (not Homebrew arm64 Node).
# On arm64 Macs, Homebrew Node lacks the SEA fuse sentinel and sea-bundle.sh
# will fail with BLOCKED-NEEDS-SEA-NODE.
which node   # should NOT resolve to /opt/homebrew/bin/node
node --version

bash scripts/release/build-all.sh 0.4.1
# Outputs:
#   dist/release/wotann-0.4.1-macos-arm64
#   dist/release/wotann-0.4.1-macos-arm64.tar.gz
#   dist/release/wotann-0.4.1-macos-arm64.tar.gz.sha256
```

### macOS GUI DMG (Tauri)

```bash
cd desktop-app
npm ci
npm run tauri -- build --target aarch64-apple-darwin
# Output at:
#   src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/WOTANN_0.1.0_aarch64.dmg
# Rename + sha256:
VER=0.4.1
cd ../
mkdir -p dist/release
cp desktop-app/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/WOTANN_*.dmg \
   dist/release/wotann-${VER}-macos-arm64.dmg
(cd dist/release && shasum -a 256 wotann-${VER}-macos-arm64.dmg > wotann-${VER}-macos-arm64.dmg.sha256)
```

Local ad-hoc signing is identical to what the workflow does:

```bash
codesign --force --deep --sign - \
  desktop-app/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/WOTANN.app
```

DO NOT run `codesign --sign -` against the `.dmg` itself — Sequoia will reject it as damaged.

### Local full-pipeline rehearsal

To simulate the full workflow locally before pushing a tag:

```bash
# 1. Build all 4 binaries (only the local host runs; others skip with warnings)
VER=0.4.1-rc1
bash scripts/release/build-all.sh "$VER"   # produces local-host tarball

# 2. Manually assemble the 8-asset directory (usually only possible in CI)
# 3. Run the canonical-manifest verifier
bash scripts/release/verify-release-assets.sh "$VER" dist/release
```

## Notarization path (when $99 Apple Developer ID is in place)

The current workflow produces an ad-hoc-signed `.app` inside an unsigned `.dmg`. Users will still see the first-launch "unknown developer" Gatekeeper prompt. To make the Tauri DMG a zero-friction experience:

1. **Create a Developer ID Application certificate** in Apple Developer portal. Download the `.p12` and export the full certificate chain.

2. **Add GitHub secrets** to the wotann repo:
   - `APPLE_CERTIFICATE` — base64 of the `.p12` file
   - `APPLE_CERTIFICATE_PASSWORD` — password set when exporting the `.p12`
   - `APPLE_SIGNING_IDENTITY` — the certificate's Common Name (e.g. "Developer ID Application: Gabriel Vuksani (ABC123XYZ)")
   - `APPLE_ID` — your Apple Developer account email
   - `APPLE_PASSWORD` — an app-specific password from appleid.apple.com (NOT your account password)
   - `APPLE_TEAM_ID` — the 10-char Team ID from your developer account

3. **Replace the "Ad-hoc sign" step** in `macos-gui-dmg` with the official Tauri action that reads these secrets and performs full `codesign` + `notarytool submit --wait` in one go. Tauri-action v0 (`tauri-apps/tauri-action@v0`) has built-in support.

4. **Verify**: after a tagged release, the downloaded DMG should open without any Gatekeeper prompt, and `spctl --assess --type execute WOTANN.app` should print "accepted".

Until this is in place, the user-facing flow is still "drag-to-Applications" but with a one-time "Open anyway" right-click on first launch.

## Homebrew tap update flow

After a release lands:

1. **Read sha256 values** from the published release's `.sha256` assets.
2. **Update `Formula/wotann.rb`**: bump `version`, rewrite both `sha256` values (macos-arm64 and linux-x64). v2 canonical asset set drops `macos-x64` and `linux-arm64`, so the formula's `on_intel` (mac) and `on_arm` (linux) blocks must be removed or marked as unsupported with a clear fallback message.
3. **Test locally**: `brew install --build-from-source Formula/wotann.rb && wotann --version`
4. **Push to tap**: the tap repo is `gabrielvuksani/homebrew-wotann`. Tap-repo layout mirrors the `Formula/` dir here. A future enhancement is to automate this via a follow-up job (`brew-publish`) that patches the tap repo on release. Not wired in v2.

Path to automation: add a `brew-publish` job to `release.yml` that:
- Checks out `gabrielvuksani/homebrew-wotann`
- Patches `Formula/wotann.rb` with new version + sha256 values
- Commits and pushes
- Requires secret `BREW_TAP_TOKEN` (fine-grained PAT scoped to the tap repo only)

## Known constraints

1. **Apple Silicon-only macOS CLI binary (macos-arm64).** We dropped macos-x64 because:
   - macos-latest runner migrated to Apple Silicon in late 2024.
   - Cross-compiling the SEA binary from arm64 → x64 requires running a separate ubuntu-latest + `--arch x64` invocation of setup-node, which roughly doubles runner cost. Not worth it for <5% of the user base.
   - Intel Mac users can run the linux-x64 tarball under Rosetta 2, or use the npm-published package.

2. **The CLI .exe MUST be built on windows-latest.** postject embeds the SEA blob into a PE32+ container; running the injection on Linux/macOS produces a malformed executable that Windows refuses to launch.

3. **macOS static Node on Actions runners.** setup-node@v4 installs the official nodejs.org build. Homebrew arm64 Node on a local dev machine does NOT have the SEA fuse sentinel in the launcher (it lives in `libnode.141.dylib` instead). sea-bundle.sh detects this via `strings | grep -c NODE_SEA_FUSE_...` and exits with BLOCKED-NEEDS-SEA-NODE.

4. **Tauri DMG filename uses Cargo.toml version.** Tauri generates `WOTANN_<cargo-version>_aarch64.dmg`. The `desktop-app/src-tauri/Cargo.toml` version is `0.1.0` independent of the release tag. We glob-match in the rename step rather than hardcode, so Tauri version drift doesn't break the pipeline.

5. **No ad-hoc signing on the .dmg.** macOS Sequoia (15.x) rejects ad-hoc-signed DMGs as "damaged" or "incomplete." We sign only the binary inside the `.app`. The DMG itself ships unsigned.

6. **npm publish is gated on `NPM_TOKEN` secret.** If unset, the `npm-publish` job fails noisily — intentional, so a broken publish blocks the release visibly. If we ever want npm publish to be fully optional, change the `if:` guard to `&& secrets.NPM_TOKEN != ''`.

7. **action-gh-release creates a non-draft release on first publish.** The current workflow sets `draft: false`. To inspect assets before they go public, temporarily flip to `draft: true`, verify on GitHub, then re-run with the flag toggled. For prerelease tags (`vX.Y.Z-rcN`), the `prerelease: true` flag is set automatically.

8. **Tauri build cold-boot is ~8 min; warm cache is ~2-3 min.** The `actions/cache@v4` step caches `~/.cargo/registry`, `~/.cargo/git`, and `desktop-app/src-tauri/target`. First release after a Cargo.lock change invalidates the cache.

## Expected timings (empirical, based on similar SEA-based Tauri projects)

| Job | Cold | Warm |
|---|---|---|
| `macos-gui-dmg` | ~8 min | ~3 min |
| `macos-cli-tarball` | ~4 min | ~2 min |
| `linux-cli-tarball` | ~3 min | ~2 min |
| `windows-cli-exe` | ~4 min | ~2 min |
| `publish-release` | ~45 sec | same |
| `npm-publish` (stable only) | ~1.5 min | same |
| **Total (critical path)** | **~9 min** | **~4 min** |

## Triggering a test release

To rehearse the pipeline without touching the user-facing `v0.4.1` namespace:

```bash
# From wotann root:
git tag v0.4.1-rc1
git push origin v0.4.1-rc1
```

The workflow will fire, produce the 8 assets, mark the GitHub release as a prerelease (because the tag contains `-`), and skip `npm-publish` (the `if: !contains(...)` guard). Assets land on the `v0.4.1-rc1` release page for manual inspection.

If the DMG looks wrong, adjust and retag:

```bash
git tag -d v0.4.1-rc1
git push origin :v0.4.1-rc1          # delete remote tag
git tag v0.4.1-rc2
git push origin v0.4.1-rc2
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `BLOCKED-NEEDS-SEA-NODE` in `sea-bundle.sh` on a macOS runner | Homebrew Node got onto PATH instead of setup-node's Node | Runner config broken. Check `which node` output in the job. |
| `verify-release-assets.sh` says "unexpected files present" | A build job leaked an extra artifact into dist/release/ | The `Prune non-canonical artifacts` step in the offending job isn't catching all cases. Add the leaked file pattern to the find command. |
| Release created but DMG says "damaged" on user machine | Someone accidentally ad-hoc-signed the DMG itself | Remove any `codesign ... *.dmg` call. We only sign the `.app` bundle inside. |
| `sha256sum -c` fails in publish-release but builds succeeded | Artifact upload corrupted a file | Re-run the workflow. If it recurs, upload artifacts with `compression-level: 0` to avoid transcoding. |
| Tauri build succeeds but no `.dmg` output | Bundle target `dmg` missing from `tauri.conf.json` | Confirm `"targets": ["dmg", "app"]` (we already do). |
| Windows .exe refuses to launch on user machine | postject didn't inject (or injected wrong format) | `scripts/release/verify-binary.sh` should have caught this. Check the windows-cli-exe job log for the preflight failure. |
| Tauri build hangs for 15+ min | Cargo cache got wedged / stale registry | Manually invalidate the cache: bump the key prefix in `actions/cache@v4` from `cargo-macos-arm64-` to `cargo-macos-arm64-v2-`. |

## Migration from v1

v0.4.0 (the v1 pipeline) uploaded 16 assets in a single draft release, including raw binaries, tarballs, sha256 files for everything, an installer.zip, and a `.exe.tar.gz`. The first release cut on v2 should:

1. Push the v2 tag (e.g. `v0.4.1`)
2. Wait for the workflow to succeed
3. Verify the 8 assets appear on the release page
4. Manually clean up the v0.4.0 release (the caller is doing this — not part of this pipeline)

After v2 is stable, update `install.sh` (both root-level and wotann.com-served copies) to verify it still works — it already matches v2's filename convention (`wotann-<VER>-<os>-<arch>.tar.gz`), so no change needed for macOS/Linux. Windows installer logic would need a separate update if we add one (currently manual `.exe` download).

## Scope — what this pipeline explicitly does NOT do

- **iOS**: the `ios/` Swift app is built+signed in Xcode and distributed via TestFlight / App Store Connect. Out of scope for the GitHub release pipeline.
- **Changelog generation**: `softprops/action-gh-release@v2` runs with `generate_release_notes: true`, which uses GitHub's built-in changelog generator. No hand-written CHANGELOG entries. If we want handwritten entries, add a `body:` param reading `CHANGELOG.md`'s top section.
- **Code signing with Developer ID**: gated on the $99 Apple account. See "Notarization path" above.
- **Linux arm64 / macOS x64**: intentionally dropped. Revisit when user demand signal appears.
- **Homebrew tap auto-update**: manual for now. See "Homebrew tap update flow."

## References

- v1 pipeline it replaces: previous `.github/workflows/release.yml` (now superseded in-place)
- Node SEA docs: https://nodejs.org/api/single-executable-applications.html
- postject: https://github.com/nodejs/postject
- Tauri 2 bundler: https://v2.tauri.app/distribute/
- softprops/action-gh-release: https://github.com/softprops/action-gh-release
- Related WOTANN docs:
  - `docs/SEA_BUILD_ENVIRONMENTAL_GATE.md` — why Homebrew Node fails SEA
  - `docs/SELF_HOSTED_RUNNER_SETUP.md` — path to self-hosted runners if CI time becomes a bottleneck
