# SEA Build — Environmental Gate (2026-04-19) — RESOLVED 2026-04-20

## TL;DR — Current status: **WORKING**

SEA binary now builds end-to-end on this machine. Last passing artifact:

```
dist/release/wotann-0.4.0-macos-arm64     204 MB, Mach-O arm64
./dist/release/wotann-0.4.0-macos-arm64 --version → 0.4.0
./dist/release/wotann-0.4.0-macos-arm64 --help     → CLI usage prints
otool -L                                           → only system libs
```

`scripts/release/verify-binary.sh` passes every check: size, file type,
`--version`, `--help`, no dangling `@rpath` dylibs. The 95 MB SEA blob
at `dist/release/wotann.blob` was successfully injected via `postject`.

## How it was resolved

The Homebrew Node dylib-link problem is real and still blocks SEA on
default-PATH builds. The fix is build-only: download a statically-
linked Node 22 tarball from <https://nodejs.org/> and prepend it to
`PATH` only for the `sea-bundle.sh` invocation. No root, no install,
no changes to the developer's default Node.

```bash
# One-time: download static Node 22 portable
mkdir -p /tmp/node22-build && cd /tmp/node22-build
curl -sL https://nodejs.org/dist/v22.12.0/node-v22.12.0-darwin-arm64.tar.xz -o node22.tar.xz
tar xf node22.tar.xz
cd -

# Every build:
PATH=/tmp/node22-build/node-v22.12.0-darwin-arm64/bin:$PATH \
  bash scripts/release/sea-bundle.sh
```

`otool -L` on the downloaded Node 22 binary lists only system libs
(CoreFoundation, libSystem, libc++), so the copied `$ART` binary has
no dangling `@rpath` references and runs anywhere on the same arch.

CI should bake this in:
- `runs-on: macos-14` (Apple Silicon) and `macos-13` (Intel) ship
  static Node preinstalled at `/usr/local/bin/node` — no download step
- `runs-on: ubuntu-24.04` and `windows-2022` also ship static Node
  preinstalled — again no download step

## History (preserved for context)

The Node Single Executable Application (SEA) binary pipeline in
`scripts/release/sea-bundle.sh` **correctly refuses** to ship a broken
binary on the current build machine. Root cause: Homebrew's Node.js on
macOS is dylib-linked against `@rpath/libnode.141.dylib`, so copying it
into the output produces a ~50 KB stub that SIGKILLs (exit 137) on any
user machine that lacks the dylib.

**Status**: Not a code bug. Environmental gate. Requires a statically-
linked Node.js (from <https://nodejs.org/>) to produce a shippable
binary. Everything up to the final `postject` injection step works:
the 95 MB SEA blob at `dist/release/wotann.blob` is valid.

---

## What works

- `esbuild-cjs.mjs` — ESM → CJS bundle, 53 MB, valid shebang
- Preflight: `node dist-cjs/index.cjs --version` prints `0.4.0`
- SEA blob generation via `node --experimental-sea-config` — 95 MB
- Detection of the dylib-link problem before shipping the broken stub

## What blocks

- `cp $(which node) $ART` step — Homebrew Node is a 68 KB launcher
  linked to `/opt/homebrew/Cellar/node/*/lib/libnode.*.dylib`. The
  copied binary's `otool -L` output shows:
  ```
  @rpath/libnode.141.dylib (compatibility version 0.0.0, current version 0.0.0)
  ```
- User machines don't have `/opt/homebrew/Cellar/node/.../libnode.*.dylib`,
  so the binary SIGKILLs on launch.

## Why sea-bundle.sh refuses

`scripts/release/sea-bundle.sh` lines ~201-211 implement the check:

```bash
DANGLING_DYLIBS=$(otool -L "$ART" 2>/dev/null | grep -E "^\s*@rpath/" | grep -v "^$ART:" || true)
if [ -n "$DANGLING_DYLIBS" ]; then
  rm -f "$ART"
  fail "BLOCKED-NEEDS-SEA-NODE: the copied Node binary has @rpath dylib dependencies that won't resolve on a user's machine" 3
fi
```

This is the correct behaviour — silent injection of a broken stub
would be the anti-pattern.

## Fixes (ranked by ease)

### 1. Install official Node.js (fastest, one-time)

Download the `.pkg` installer from <https://nodejs.org/>. Intel Macs
get a statically-linked binary at `/usr/local/bin/node`; Apple Silicon
Macs get `/opt/nodejs/bin/node`. Then adjust `PATH` so `which node`
resolves to the official binary:

```bash
# After installing the official .pkg
export PATH="/usr/local/bin:$PATH"   # Intel
export PATH="/opt/nodejs/bin:$PATH"  # arm64
which node  # must NOT be /opt/homebrew/bin/node
bash scripts/release/sea-bundle.sh
```

### 2. Use CI (GitHub Actions, etc.)

GitHub Actions' `macos-14` and `macos-14-arm64` runners ship with
official Node (static). Release CI matrix should run `sea-bundle.sh`
on those runners, not on the developer's machine.

### 3. Fallback: `scripts/release/pkg-bundle.sh`

Uses `@yao-pkg/pkg`, which bundles a static Node + CJS source into a
single binary without dylib dependency. Known limitation: fails on
`yoga-layout`'s TLA (top-level await) — may produce a partial bundle.

### 4. Fallback: `install.sh` (no binary, npm postinstall)

`install.sh` + `npm run build` + `postinstall` hooks ship the source
and build locally at install time. No binary to ship, but no dylib
issue either.

## Don't

- **Don't** `cp` the Homebrew dylib alongside the binary. The binary's
  `@rpath` resolution hunts in a narrow set of locations that won't
  include the user's installation directory, and relying on
  `DYLD_LIBRARY_PATH` is fragile.
- **Don't** strip the `otool` check from `sea-bundle.sh`. It exists
  specifically to prevent silent failure.
- **Don't** mark this as a code bug. The pipeline is correct.

## Current artifacts

```
dist/release/
  wotann.blob          95 MB  — valid SEA blob, ready for injection
  (wotann-<ver>-<target>)    — absent: only created after successful postject
```

Injection on a statically-linked Node host completes the pipeline in
~30 seconds and produces a ~110 MB self-contained binary that runs on
any same-architecture macOS/Linux/Windows user machine.
