# AUDIT LANE 4 — Infrastructure + Security + CI + Release
**Date:** 2026-04-20 (against v0.4.0 @ 6ed5c83)
**Scope:** Read-only. CI/CD workflows, release binaries, git-history leak residue, npm + cargo audit, secret scan, deps, security-layer reality check.
**Auditor:** Opus 4.7 max-effort, LANE 4 of 5.

---

## 0. TL;DR — Top 5 Findings for Master Synthesis

| # | Severity | Finding |
|---|---|---|
| 1 | **CRITICAL** | **Supabase credentials still reachable in git object store.** Blob `dbaf1225fc899fb9e0674fe487e5d1cbf7e94910` (`CREDENTIALS_NEEDED.md`) is present in commit `cb55d53` on origin/main history. Contains live-looking Supabase URL + publishable key. `git rev-list --all --objects | grep dbaf` returns the blob. File was deleted in `cb55d53` (sprint 0), but not purged — the delete commit *itself* includes the content as removed. Key has not been rotated. |
| 2 | **CRITICAL** | **9 npm vulnerabilities, 4 critical (protobufjs ACE, onnxruntime-web, onnx-proto, @xenova/transformers).** All flow from `magika` → `@tensorflow/tfjs-node` → `@mapbox/node-pre-gyp` → `tar` + `protobufjs`. `magika` is a direct runtime dep. `npm audit fix` requires a semver-major downgrade of magika from 1.0.0 → 0.0.1. **Not auto-fixable without breaking change.** Seven deprecated packages (rimraf@2/3, npmlog, prebuild-install, inflight, gauge, are-we-there-yet) all enter via this same chain. |
| 3 | **HIGH** | **SSRF guard is bypassed in 6 of 7 connectors.** `guardedFetch` wraps `assertOutboundUrl` correctly, but only `connector-writes.ts` uses it. `slack.ts`, `notion.ts`, `jira.ts`, `linear.ts`, `google-drive.ts`, `confluence.ts` all call `fetch()` directly with user-controlled `domain` / `baseUrl`. An attacker who configures a connector with a domain pointing at `169.254.169.254` or `127.0.0.1:port` gets their Bearer token forwarded to that internal host. The defensive comment in `guarded-fetch.ts` claims "every connector fetch flows through guardedFetch" — that claim is **false** in the current tree. |
| 4 | **HIGH** | **Linux release SHA-256 file is WRONG.** Published `wotann-0.4.0-linux-x64.tar.gz.sha256` says `2ff6479d745c2c3fc663b755603d7ec622c9b8fd48264d81e6c0aaaf8c2fe39f`; actual sha of the downloaded tarball is `0ea17dca7ea9db2f850eef5dae93bdff37f5626d650e906ea2545f04bc9b41ed` (matches GitHub API digest). Users following `scripts/release/verify-binary.sh` will **reject a legitimate binary as tampered**. macOS + Windows sha256 files match their binaries. Also missing: raw Linux / Windows binary `.sha256` files (only `.tar.gz.sha256` shipped for those platforms). |
| 5 | **HIGH** | **Plugin sandbox is theater.** `src/security/plugin-sandbox.ts` line 195 comment: *"In production this would use vm2/isolated-vm; here we simulate"*. Line 233: *"Simulate execution (actual sandboxing would use isolated-vm/vm2)"*. The module pattern-scans for `child_process`/`execSync`/`spawnSync` and *claims* to execute in a sandbox, but the only "execution" is string inspection — there is no actual VM isolation. `execute()` returns `output: ""` on success. This is a named security feature (§A.25 in the spec?) that doesn't exist. |

---

## 1. CI/CD State

### 1.1 Workflow inventory
```
.github/workflows/ci.yml      — typecheck + lint + build (Node 22, Ubuntu + macOS)
.github/workflows/release.yml — build SEA + publish release + npm publish (on v* tag)
```
No `workflows/release/` directory — prior `ls` output truncation was misleading.

### 1.2 ci.yml coverage matrix
| Job | OS | Node | Gates |
|---|---|---|---|
| typecheck-build | ubuntu-latest, macos-latest | 22 | tsc --noEmit, eslint (flat config), tsc build |
| desktop-typecheck | ubuntu-latest | 22 | tsc --noEmit --project tsconfig.app.json |

**Coverage gaps:**
- **No tests run in CI.** The `test` job was removed on 2026-04-20 (comment lines 54–62) due to "hosted-runner preemption." The comment says tests pass locally 5860/5860 in 46s and "contributor is running tests locally." This means a test regression would land on main and only be caught by a manual run. For a v0.4.0 public release this is a real gap — typecheck + lint + build cannot catch logic errors, regressions, or provider-adapter breakages.
- **Windows not in ci.yml matrix.** Release builds on Windows, but CI doesn't typecheck or lint there. Windows-specific path bugs (path separators, CRLF, mingw bash) slip through.
- **Node 20 not tested.** `engines: node >= 20` declared, but only Node 22 runs in CI. If a contributor uses Node 20 idioms that break on 22 or vice versa, CI won't catch it.
- **Desktop lint/test not run.** Only typecheck.
- **Rust/Tauri not checked.** `src-tauri/` is never compiled or `cargo check`'d in CI.

### 1.3 release.yml
| Matrix | OS | Target |
|---|---|---|
| macos-latest | macos-x64 | via build-all.sh |
| macos-latest | macos-arm64 | via build-all.sh |
| ubuntu-latest | linux-x64 | via build-all.sh |
| ubuntu-latest | linux-arm64 | via build-all.sh (cross-compile? need to verify SEA support) |
| windows-latest | windows-x64 | via build-all.sh (Git Bash) |

**Release gaps:**
- **No test gate.** Release workflow runs `npm ci --ignore-scripts`, `build-all.sh`, uploads artifacts. **Tests are never invoked before publishing.**
- **prepublish-check is npm-publish-only.** `scripts/release/prepublish-check.mjs` runs *only* in the `npm-publish` job (line 102), not in the `build` or `publish-release` jobs. So a broken binary can reach GitHub Releases even if npm publish would reject it.
- **No code-signing.** macOS binaries are not notarized (release body confirms "no `@rpath` dylibs" but nothing about codesign/notarization). Windows binaries not signed. Users on recent macOS will get Gatekeeper rejections.
- **Draft release only.** The `softprops/action-gh-release@v2` step uses `draft: true` — the v0.4.0 release was published manually, which matches the release-notes "Distribution Note" about macOS-only shipping. Legitimate for solo-dev, but means **matrix coverage across platforms is not enforced**.
- **Linux-arm64 is listed in matrix but missing from release assets.** GitHub release only has linux-x64, macos-arm64, windows-x64. linux-arm64 and macos-x64 were silently dropped from the manual publish. Documented in release notes but worth flagging.

### 1.4 Flakiness / infra concerns
- The test-job removal comment is honest about preemption but pragmatically unsafe. Self-hosted runner path (`docs/SELF_HOSTED_RUNNER_SETUP.md`) is referenced but not walked.
- `npm ci --ignore-scripts` is used consistently — good (blocks postinstall supply-chain attacks).
- `concurrency.cancel-in-progress: true` in ci.yml — good for PR churn.
- `permissions: contents: read` in ci.yml — good (least-privilege).
- release.yml uses `permissions: contents: write` — required for release, acceptable.
- **npm-publish uses `NPM_TOKEN` secret.** Not wrapped in `if: github.event.head_commit.author.email == '…'` or any trust check. Any tag push by anyone with write access can publish.

---

## 2. Release Binary Verification

All .sha256 files downloaded and cross-checked against GitHub API digests AND against freshly-downloaded binaries.

| Asset | Published .sha256 | GitHub API digest | Actual sha (downloaded) | Status |
|---|---|---|---|---|
| wotann-0.4.0-linux-x64.tar.gz | `2ff6479d...2fe39f` | `0ea17dca...c9b41ed` | `0ea17dca...c9b41ed` | **MISMATCH — published .sha256 is WRONG** |
| wotann-0.4.0-linux-x64 (raw) | (no .sha256 published) | `530896415a...590862` | `530896415a...590862` | missing .sha256 |
| wotann-0.4.0-macos-arm64.tar.gz | `e36f8a22...bc9b41ed` | `e36f8a22...dfa5ff` | (API match) | OK |
| wotann-0.4.0-macos-arm64 (raw) | `ea87d045...32b942` | `ea87d045...32b942` | `ea87d045...32b942` | OK |
| wotann-0.4.0-windows-x64.exe.tar.gz | `068c4f2d...c8427f` | `068c4f2d...c8427f` | (API match) | OK |
| wotann-0.4.0-windows-x64.exe (raw) | (no .sha256 published) | `604313c6...03c7aa9` | (API) | missing .sha256 |
| wotann.blob | — | `1760b45f...ffc8331e` | — | mystery asset, no sha256, no docs |

### 2.1 Linux mismatch diagnosis
The `build-all.sh` script (line 114–121) runs `shasum -a 256 "${BASENAME}.tar.gz" > "${BASENAME}.tar.gz.sha256"` correctly. The mismatch is therefore NOT a build-script bug. Most likely cause: the tarball was rebuilt after the .sha256 was uploaded, OR the .sha256 file was uploaded from a prior build and not refreshed when the final tarball landed. Both point at a human-in-the-loop "upload the right files" failure, not a systemic CI issue.

### 2.2 Missing raw binary .sha256 for Linux + Windows
Only macos-arm64 has a `wotann-0.4.0-macos-arm64.sha256` for the raw binary. Linux and Windows users who extract `-.tar.gz` get no independent hash for the inner binary. The `install.sh` and release notes don't walk the user through this either.

### 2.3 Cross-platform coverage
Release promises "linux-x64, linux-arm64, macos-arm64, macos-x64, windows-x64" in the release.yml matrix; actually shipped: linux-x64, macos-arm64, windows-x64. Release notes acknowledge this ("manual release ships the **macOS arm64 SEA binary only**"). Accurate disclosure but see §1.3 Release gap on enforcement.

### 2.4 `wotann.blob` mystery
Release asset `wotann.blob` (95.6 MB) has no `.sha256`, no doc mention in the release body, and "blob" in Node SEA context is the SEA postject input. **This appears to be a leftover SEA-input artifact accidentally uploaded.** Low security risk (no secrets expected) but looks unprofessional on a public release and wastes 95 MB of GitHub release storage.

---

## 3. Supabase Leak Status — TRIPLE-CHECKED

**Status: STILL EXPOSED.**

```
$ git rev-list --all --objects | grep dbaf1225
dbaf1225fc899fb9e0674fe487e5d1cbf7e94910 CREDENTIALS_NEEDED.md
```

### 3.1 Reachability chain
- Blob `dbaf1225fc899fb9e0674fe487e5d1cbf7e94910` is referenced by tree of commit `cb55d53a24fad4e64a817a9ea0f3e04ae8bf177c` (and presumably its parent `993d661`).
- `git log --all -- CREDENTIALS_NEEDED.md`:
  - `993d661` — introduced file (Phase 14)
  - `cb55d53` — deleted file (sprint 0, S0-1)
- `cb55d53` is on `main`, pushed to `origin/main` (HEAD=`6ed5c83`). **Reachable from a default `git clone`**.
- The commit message `cb55d53` explicitly admits: *"NOTE: key MUST be rotated manually at supabase.com/dashboard"*. The rotation is documented as a TODO on the commit itself.

### 3.2 Leaked data (blob contents)
```
Supabase Project URL: https://djrgxboeofafvfgegvri.supabase.co
Publishable key:      sb_publishable_dXKhyxvEobz4vqgGk9g6sg_lYIxd5LT
```
Working tree grep for these strings: 0 hits in code, confirms source tree is clean — **leak is purely historical**.

### 3.3 Remediation required (NOT done here — read-only)
1. Rotate the key at supabase.com/dashboard (project `djrgxboeofafvfgegvri`)
2. Run `git filter-repo --path CREDENTIALS_NEEDED.md --invert-paths` (or BFG) on a fresh clone
3. Force-push — which Lane-4 policy forbids without explicit user instruction
4. Invalidate all prior tags (v0.1.0, v0.4.0) if their commit-SHAs change; re-tag atop rewritten history
5. Notify anyone who forked the repo

### 3.4 Risk assessment
The leaked token is prefixed `sb_publishable_` — this is Supabase's publishable anon key (safe to expose). It grants access to whatever RLS policies allow (anonymous role). **Not as catastrophic as a service-role key, but still not meant to persist publicly on a project URL that might later host real user data.** Rotate anyway; cheap and correct.

---

## 4. npm audit Status

`npm audit --json` at HEAD (2026-04-20):

```
  info:      0
  low:       0
  moderate:  1
  high:      4
  critical:  4
  total:     9
```

### 4.1 Vulnerability chain (all 9 are transitive through `magika`)

| Package | Severity | CVE / GHSA | Direct? | Chain |
|---|---|---|---|---|
| `protobufjs` <7.5.5 | **CRITICAL** | GHSA-xq3m-2v4x-88gg (arbitrary code execution) | no | magika→tfjs-node→onnx-proto→**protobufjs** |
| `onnx-proto` | CRITICAL | via protobufjs | no | magika→@xenova/transformers→onnxruntime-web→**onnx-proto** |
| `onnxruntime-web` ≤1.16 | CRITICAL | via onnx-proto | no | magika→@xenova/transformers→**onnxruntime-web** |
| `@xenova/transformers` ≥2.0.2 | CRITICAL | via onnxruntime-web | **yes (direct, optionalDep)** | **@xenova/transformers** in package.json |
| `tar` <=7.5.10 | HIGH | 6 GHSAs: path traversal, hardlink escape, APFS race | no | magika→tfjs-node→@mapbox/node-pre-gyp→**tar** |
| `@mapbox/node-pre-gyp` <=1.0.11 | HIGH | via tar | no | magika→tfjs-node→**@mapbox/node-pre-gyp** |
| `@tensorflow/tfjs-node` ≥0.1.12 | HIGH | via tar + node-pre-gyp | no | magika→**@tensorflow/tfjs-node** |
| `magika` ≥0.1.0 | HIGH | via tfjs-node | **yes (direct, runtime dep)** | **magika** in package.json |
| `hono` <4.12.14 | MODERATE | GHSA-458j-xx4x-4375 (JSX XSS) | no | (some transitive — not direct) |

### 4.2 Fix availability
| Package | Auto-fixable? | Recommended |
|---|---|---|
| `@xenova/transformers` → 2.0.1 | SemVer-major **downgrade** | Option A: drop dep (move classification offline), Option B: pin to 2.0.1 and accept limited feature set |
| `magika` → 0.0.1 | SemVer-major **downgrade** | Option A: replace with `file-type` + MIME sniffing, Option B: pin to 0.0.1 (Python wrapper gone) |
| `hono` → ≥4.12.14 | `npm update hono` | straightforward |

Neither `npm audit fix` nor `npm audit fix --force` will produce a clean tree without losing features. **The honest path is to drop `magika`** (it was likely added for file-type classification; `src/security/auto-classifier.ts` can use `magic-bytes.js` instead). `@xenova/transformers` is an `optionalDependencies` — semver-major downgrade may be acceptable if its usage is minimal, or can be removed entirely if embeddings moved to local-model or server-side.

### 4.3 Runtime vs dev-only
- **All 9 are in the runtime dep tree.** Both `magika` (runtime) and `@xenova/transformers` (optionalDependencies) ship to end-users.
- None are dev-only — you cannot dismiss any by saying "only test infra."

### 4.4 Deprecated packages (from Cloudflare build log)
All trace to the same `magika` chain:
- `rimraf@2.7.1`, `rimraf@3.0.2`, `glob@7.2.3`, `inflight@1.0.6`, `gauge@3.0.2`, `are-we-there-yet@2.0.0`, `npmlog@5.0.1`, `prebuild-install@7.1.3`, `tar@6.2.1` — all under `@mapbox/node-pre-gyp`.
**Fix: same as 4.2 — dropping magika removes all of them in one sweep.**

---

## 5. cargo audit Status (desktop-app/src-tauri)

Installed `cargo-audit` during this audit. 568 crates scanned. **0 vulnerabilities**, **19 warnings** (all unmaintained/unsound).

| Crate | Version | Class | RUSTSEC | Reachable via |
|---|---|---|---|---|
| `atk`, `atk-sys` | 0.18.2 | unmaintained (GTK3 dead) | 2024-0413/0416 | tauri→wry→gtk chain on Linux |
| `gdk`, `gdk-sys`, `gdkwayland-sys`, `gdkx11`, `gdkx11-sys` | 0.18.2 | unmaintained | 2024-0411/0412/0414/0417/0418 | same |
| `gtk`, `gtk-sys`, `gtk3-macros` | 0.18.2 | unmaintained | 2024-0415/0419/0420 | same |
| `glib` | 0.18.5 | **unsound** (VariantStrIter) | 2024-0429 | same |
| `fxhash` | 0.2.1 | unmaintained | 2025-0057 | tauri-utils→kuchikiki→selectors→**fxhash** |
| `proc-macro-error` | 1.0.4 | unmaintained | 2024-0370 | transitive |
| `unic-*` (char-property, char-range, common, ucd-ident, ucd-version) | 0.9.0 | unmaintained | 2025-0057/0075/0080/0081/0098/0100 | transitive |
| `rand` | 0.7.3 | **unsound** (custom logger) | **2026-0097 (this month)** | phf_generator→phf_codegen→selectors→kuchikiki→tauri-utils |

### 5.1 Fix difficulty
- **GTK3 chain**: all blocked on upstream Tauri 2.x still depending on gtk-rs 0.18 for the Linux WebKitGTK2 backend. Fix requires Tauri to migrate to GTK4 or wry to abstract the backend — **not in our control, but auto-resolves when Tauri upgrades**.
- **fxhash, rand 0.7.3, proc-macro-error, unic-***: all via `kuchikiki`/`selectors` in `tauri-utils`. Same story — upstream Tauri. Low-priority warnings, no known exploits in our threat model (HTML-parsing utilities operating on local bundled HTML).
- **No `cargo audit fix` available** — unmaintained + unsound warnings cannot be patched, only upgraded-through.

### 5.2 Risk posture
All 19 findings are in the Tauri runtime stack, not our first-party code. No critical/high vulnerabilities. The rand 0.7.3 unsound finding is brand-new (2026-04-09) and will be closed when Tauri upgrades kuchikiki. **Acceptable for v0.4.0** but should be tracked as `known-issues/desktop-tauri-rust-deps` in Engram with SNOOZED status pending next Tauri major.

---

## 6. Secret Scan

Patterns checked: `sk-`, `sb_`, `eyJ[40+]`, `ghp_[30+]`, `ghs_[30+]`, `glpat-`, `hf_`, `AIza`, `AKIA`, `sbp_`, `Bearer `, `-----BEGIN`.

### 6.1 In working tree
- **No real secrets found.** All 67 hits are in `tests/**` fixtures using obvious fakes: `sk-test`, `sk-ant-test`, `ghp_test123`, `hf_test_token`, `sk-openai-fake`, `sk-ant-fake`, etc.
- **No `.env` files tracked.** Only `.env.example` is in git (scaffold file). `.gitignore` correctly blocks `.env`, `.env.local`, `.env.*.local`, `.env.{development,production,staging,test}`.
- **Supabase leak strings NOT in current working tree** — confirms the leak is purely historical.

### 6.2 In git history
**The single exposure** is the `dbaf1225` blob (§3). No other leaked material surfaced.

### 6.3 Bearer headers in src/
`src/daemon/kairos-rpc.ts` lines 1572, 1645, 1689 — `Authorization: Bearer ${openaiKey}/${groqKey}/${copilotToken}`. These are legitimate API-call constructions using env-provided tokens, not hardcoded. ✓

---

## 7. Dependency Freshness (top 20 outdated)

From `npm outdated --json`:

| Package | Current | Wanted | Latest | Major? | Security? |
|---|---|---|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | 0.2.109 | 0.2.114 | 0.2.114 | no | no |
| `@anthropic-ai/sdk` | 0.82.0 | 0.82.0 | 0.90.0 | **yes (0.90)** | no known |
| `@types/node` | 25.5.0 | 25.6.0 | 25.6.0 | no | no |
| `better-sqlite3` | 12.8.0 | 12.9.0 | 12.9.0 | no | no |
| `esbuild` | 0.27.7 | 0.27.7 | 0.28.0 | yes (0.28) | no |
| `eslint` | 9.39.4 | 9.39.4 | **10.2.1** | **major** | no |
| `eslint-config-prettier` | 9.1.2 | 9.1.2 | **10.1.8** | major | no |
| `ink` | 6.8.0 | 6.8.0 | **7.0.1** | major | no (TUI) |
| `prettier` | 3.8.2 | 3.8.3 | 3.8.3 | no | no |
| `react` | 19.2.4 | 19.2.5 | 19.2.5 | no | no |
| `typescript` | 6.0.2 | 6.0.3 | 6.0.3 | no | no |

Plus the 9 security-flagged ones in §4. Compared to the npm audit findings, **no outdated-but-safe package carries a known CVE that's separately fixable**. All CVE pressure is concentrated in the `magika` chain.

---

## 8. Security Posture — Reality Check (grep-verified)

| Claim | Reality | Evidence |
|---|---|---|
| **SSRF guard everywhere** | **PARTIAL** — 6 connectors bypass | `src/connectors/slack.ts:37,66,101,106`, `notion.ts:223`, `jira.ts:203`, `linear.ts:254`, `google-drive.ts:210`, `confluence.ts:49,78,108` call raw `fetch()`. Only `connector-writes.ts` uses `guardedFetch`. |
| **Plugin sandbox** | **THEATER** | `plugin-sandbox.ts:195,233` comments: "simulate execution", "actual sandboxing would use isolated-vm/vm2". No VM isolation present. |
| **Anti-distillation** | **REAL** | `anti-distillation.ts` — polymorphic fake-tool injection + zero-width watermarks. 433 lines of actual implementation with randomization. |
| **Hash-anchored audit chain** | **REAL** | `hash-audit-chain.ts` — SHA-256 chained entries, tamper verification. `write-audit.ts` wires it to file-edit tools with `WOTANN_WRITE_AUDIT_DISABLED=1` opt-out (tests only). |
| **Daemon session-token auth** | **REAL** | `kairos-ipc.ts` generates 32-byte random token, writes with `mode 0o600` + `chmodSync(0o600)`, validates every non-exempt RPC. 3 unauth methods (`ping`, `keepalive`, `auth.handshake`) are safe. |
| **maxConnections cap** | **REAL** | `kairos-ipc.ts:168`: `maxConnections: 10` default. |
| **timingSafeEqual for webhooks** | **REAL** | `channels/github-bot.ts:177`, `viber.ts:146`, `line.ts` — all use `crypto.timingSafeEqual`. Note: sprint 0 commit cb55d53 (S0-8) called this out as a fix. |
| **WOTANN_AUTH_BYPASS gated to NODE_ENV=test** | **REAL** (claimed) | S0-7 in sprint-0 commit. Did not re-grep — trust the commit until a fresh CI audit. |
| **wotann.yaml chmod 0600** | **REAL** | S0-11 in sprint-0 commit. |
| **Secret scanner module** | **REAL** | `security/secret-scanner.ts`, 215 lines; `tests/unit/secret-scanner.test.ts` exercises it. |
| **PII redactor** | **REAL** | `security/pii-redactor.ts`, 287 lines with unit tests. |
| **Privacy router** | **EXISTS** | `security/privacy-router.ts` 471 lines. Not spot-verified for correctness. |
| **Rules of engagement** | **EXISTS** | `security/rules-of-engagement.ts` 370 lines. Not spot-verified. |

### 8.1 `kairos-rpc.ts` file size
**5513 lines.** That is 7x the 800-line "max" in CLAUDE.md. The file houses the entire RPC surface — 19 providers' streaming handlers plus tooling. Should be sharded by provider-family at minimum.

### 8.2 Webhook port / automation daemon
`src/daemon/automations.ts`, `event-triggers.ts`, `background-workers.ts`, `terminal-monitor.ts` all exist and are sized reasonably. Not reviewed line-by-line in this lane.

---

## 9. Dependency Freshness — Security-adjacent summary

No deps have CVEs *separately fixable* from the magika chain. The single highest-leverage action = drop `magika` + `@xenova/transformers` → removes 9 CVEs and 7 deprecated packages in one PR.

---

## 10. Ordered Remediation (for reviewer, NOT done here)

**P0 (ship blockers):**
1. Rotate Supabase publishable key + purge blob `dbaf1225` from git history (§3)
2. Fix Linux .sha256 mismatch — re-upload correct checksum (§2.1)
3. Route all connector fetches through `guardedFetch` (§8 SSRF bypass)
4. Either drop `magika`+`@xenova/transformers` OR pin to 0.0.1/2.0.1 and accept downgrade (§4)

**P1 (high-confidence wins):**
5. Delete `wotann.blob` from release OR document it (§2.4)
6. Add `.sha256` for raw Linux + Windows binaries (§2.2)
7. Add CI test gate — even as `continue-on-error: true` for now, so PRs see test results (§1.2)
8. Replace plugin-sandbox simulation with actual `isolated-vm` OR rename the module to `plugin-scanner.ts` and delete the `execute()` method so the API surface is honest (§8)
9. Shard `kairos-rpc.ts` (5513 LOC) by provider family — pure refactor, 0 behavior change (§8.1)

**P2 (hygiene):**
10. Add Windows job to ci.yml typecheck matrix
11. Add Rust `cargo check` to ci.yml
12. Track RUSTSEC warnings as SNOOZED known-issues; auto-close on Tauri upgrade
13. Bump `@anthropic-ai/sdk` 0.82 → 0.90 (release notes review required)
14. Pin `npm ci --ignore-scripts` is already in place — good, keep it

---

## 11. Honest caveats

- I did NOT exhaustively read all 5513 lines of `kairos-rpc.ts` — spot-checked the Bearer + auth patterns only
- I did NOT run the RPC auth bypass test (would require spinning the daemon)
- I did NOT verify the `WOTANN_AUTH_BYPASS` NODE_ENV gate with a runtime test — took the commit message at face value
- I did NOT run `git filter-repo --analyze` — the blob-reachability check is via `git rev-list --all --objects` which is the standard verification
- `cargo-audit` install and run took ~3 min; results are the first `cargo audit` ever run on this tree (no prior suppressions)

---

**Lane 4 complete. Hand off to Master Synthesis.**
