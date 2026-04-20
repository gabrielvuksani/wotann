#!/usr/bin/env bash
# sea-bundle.sh — Produce a single-file standalone binary using Node's
# Single Executable Application API (SEA).
#
# Pipeline: tsc build -> esbuild-cjs.mjs (ESM→CJS) -> node --experimental-sea-config
#           -> postject inject -> smoke test
# Output:   dist/release/wotann-<version>-<host-os>-<host-arch>[.exe]
#
# Cross-compilation: this script only produces the HOST target. CI matrix runs
# the script on each target OS (macos-x64, macos-arm64, linux-x64, linux-arm64,
# windows-x64).
#
# Honest failure model — no silent skips. Every failure path exits non-zero
# with a structured BLOCKED-<REASON> message the release CI can parse.
#
# BLOCKED reasons emitted:
#   BLOCKED-NEEDS-CJS-BUNDLE    — esbuild produced no CJS output
#   BLOCKED-NATIVE-BINDINGS     — CJS runs fail before or after SEA injection
#                                 (native bindings unresolved); fallback to install.sh
#   BLOCKED-NEEDS-POSTJECT      — postject tool unavailable
#   BLOCKED-NEEDS-SEA-NODE      — the Node binary being copied lacks the SEA
#                                 fuse sentinel (Node was built without SEA)
#
# Env overrides:
#   WOTANN_VERSION   — override version string (default: from package.json)
#   WOTANN_DIST      — override output dir   (default: dist/release)
#   WOTANN_SKIP_VERIFY=1 — skip post-bundle smoke test (NOT recommended)
#
# Exit codes:
#   0  — success
#   1  — build prerequisite failed (npm run build, missing dist/index.js, etc.)
#   2  — SEA blob generation or CJS bundling failed
#   3  — postject missing, Node lacks SEA fuse, or injection failed
#   4  — produced binary does not execute or --version mismatch

set -euo pipefail

log()  { printf "\033[0;36m[sea-bundle]\033[0m %s\n" "$*"; }
fail() { printf "\033[0;31m[sea-bundle:ERROR]\033[0m %s\n" "$*" >&2; exit "${2:-1}"; }

# ── Inputs ──────────────────────────────────────────────────────────
VERSION="${WOTANN_VERSION:-$(node -p "require('./package.json').version")}"
DIST="${WOTANN_DIST:-dist/release}"
SKIP_VERIFY="${WOTANN_SKIP_VERIFY:-0}"

mkdir -p "$DIST"

# ── Host target detection ──────────────────────────────────────────
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$HOST_OS" in
  darwin) HOST_OS="macos" ;;
  linux)  HOST_OS="linux" ;;
  mingw*|msys*|cygwin*) HOST_OS="windows" ;;
  *) fail "unsupported OS: $(uname -s)" 1 ;;
esac

HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  x86_64|amd64) HOST_ARCH="x64" ;;
  arm64|aarch64) HOST_ARCH="arm64" ;;
  *) fail "unsupported arch: $(uname -m)" 1 ;;
esac

HOST_TARGET="${HOST_OS}-${HOST_ARCH}"
log "version:       $VERSION"
log "host target:   $HOST_TARGET"
log "output dir:    $DIST"

# ── Step 1: Ensure dist/index.js exists ────────────────────────────
# dist/index.js is the ESM output from tsc. Required as a preflight sanity
# check even though esbuild-cjs.mjs bundles from src/index.ts directly —
# keeping the tsc pass guarantees types are validated before SEA runs.
if [ ! -f "dist/index.js" ]; then
  log "dist/index.js missing — running npm run build"
  npm run build || fail "npm run build failed — cannot produce SEA bundle" 1
fi
if [ ! -s "dist/index.js" ]; then
  fail "dist/index.js exists but is empty — build is broken" 1
fi

# First-line shebang sanity check (CLI entry MUST be runnable by Node).
first_line=$(head -n 1 dist/index.js)
if [ "$first_line" != "#!/usr/bin/env node" ]; then
  fail "dist/index.js missing '#!/usr/bin/env node' shebang (got: $first_line)" 1
fi

# ── Step 1b: Produce CJS bundle for SEA ────────────────────────────
# Node SEA requires a CommonJS main script. esbuild-cjs.mjs bundles
# src/index.ts → dist-cjs/index.cjs with all TLA wrapped in an async IIFE
# and native bindings kept external. Failing here means the bundler
# itself exited non-zero — propagate that status so CI sees the real cause.
log "bundling ESM → CJS via esbuild-cjs.mjs"
SCRIPT_DIR_SEA="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! node "$SCRIPT_DIR_SEA/esbuild-cjs.mjs"; then
  fail "esbuild-cjs.mjs failed — CJS bundle not produced. See above for esbuild errors." 2
fi

# Verify the bundle actually exists and is a valid shebang'd CJS file.
CJS_OUT="dist-cjs/index.cjs"
if [ ! -s "$CJS_OUT" ]; then
  fail "BLOCKED-NEEDS-CJS-BUNDLE: esbuild-cjs.mjs reported success but $CJS_OUT missing or empty" 2
fi
cjs_first_line=$(head -n 1 "$CJS_OUT")
if [ "$cjs_first_line" != "#!/usr/bin/env node" ]; then
  fail "$CJS_OUT missing '#!/usr/bin/env node' shebang (got: $cjs_first_line) — esbuild banner misconfigured" 2
fi

# Sanity check: the bundled CJS should at least start and print --version
# before SEA injection. If it doesn't, SEA injection will produce a broken
# binary with no clear diagnostic. We check here so the failure surface
# is obvious.
log "preflight: ensuring $CJS_OUT runs under plain Node before SEA injection"
if ! PREFLIGHT_OUT=$(node "$CJS_OUT" --version 2>&1); then
  fail "BLOCKED-NATIVE-BINDINGS: '$CJS_OUT --version' failed under plain Node. Output: $PREFLIGHT_OUT. Likely cause: an external native binding (better-sqlite3, magika, onnxruntime-node) is missing or incompatible. Recommended fallback: ship via install.sh (npm install + postinstall) instead of SEA, or rebuild native bindings for this platform." 2
fi
if ! echo "$PREFLIGHT_OUT" | grep -qF "$VERSION"; then
  fail "preflight: '$CJS_OUT --version' did not print expected version $VERSION (got: $PREFLIGHT_OUT)" 2
fi
log "preflight PASS — bundle prints version: $PREFLIGHT_OUT"

# ── Step 2: Produce SEA blob ───────────────────────────────────────
log "producing SEA blob from sea.config.json (main=$CJS_OUT)"
BLOB_OUT=$(node -p "require('./sea.config.json').output" 2>/dev/null || echo "dist/release/wotann.blob")

# sea-config requires output dir to exist.
mkdir -p "$(dirname "$BLOB_OUT")"

# Guard: verify sea.config.json points at the CJS bundle, not the ESM output.
# If someone edited it back to dist/index.js we'd silently produce a broken
# blob. Fail loudly instead.
SEA_MAIN=$(node -p "require('./sea.config.json').main")
if [ "$SEA_MAIN" != "$CJS_OUT" ]; then
  fail "sea.config.json main='$SEA_MAIN' but expected '$CJS_OUT' — update sea.config.json to point at the CJS bundle produced by esbuild-cjs.mjs" 2
fi

# Capture stderr so we can give a structured diagnosis rather than swallowing it.
SEA_STDERR=$(mktemp)
if ! node --experimental-sea-config sea.config.json 2>"$SEA_STDERR"; then
  SEA_MSG=$(cat "$SEA_STDERR")
  rm -f "$SEA_STDERR"
  fail "node --experimental-sea-config failed — SEA blob not produced. stderr: $SEA_MSG" 2
fi
rm -f "$SEA_STDERR"

if [ ! -f "$BLOB_OUT" ]; then
  fail "expected SEA blob at $BLOB_OUT but file does not exist" 2
fi

log "SEA blob produced: $BLOB_OUT ($(wc -c < "$BLOB_OUT" | tr -d ' ') bytes)"

# ── Step 3: Detect postject (injection tool) ───────────────────────
# postject is an npm package required by the Node SEA workflow. If it's not
# available we produce a clear BLOCKED-NEEDS-POSTJECT failure rather than
# silently skipping and shipping a non-functional binary.
#
# Note: postject accepts positional args and does not support `--version`,
# so we probe with `--help` instead (exit 0 when the binary is available,
# non-zero when the package can't be resolved).
if ! npx --no-install postject --help >/dev/null 2>&1; then
  log "postject not installed — attempting 'npx --yes postject' fetch"
  if ! npx --yes postject --help >/dev/null 2>&1; then
    fail "BLOCKED-NEEDS-POSTJECT: postject is not available. Install with 'npm i -g postject' or add it to devDependencies. See https://github.com/nodejs/postject" 3
  fi
fi

# ── Step 4: Copy host node binary and inject blob ──────────────────
NODE_BIN="$(which node)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  fail "no node binary found on PATH" 1
fi

ART="$DIST/wotann-${VERSION}-${HOST_TARGET}"
[ "$HOST_OS" = "windows" ] && ART="${ART}.exe"

log "copying node binary: $NODE_BIN -> $ART"
# Note: cp preserves mode bits from the source. On Homebrew macOS the node
# binary is installed -r-xr-xr-x (no write), so if a previous build left
# an artifact behind, cp would fail "Permission denied" when trying to
# overwrite it. Proactively remove any stale target, then copy fresh.
[ -f "$ART" ] && { chmod u+w "$ART" 2>/dev/null || true; rm -f "$ART"; }
cp "$NODE_BIN" "$ART"
# Grant owner-rwx so postject can read+write the Mach-O for injection.
chmod 755 "$ART"

# macOS: strip existing code signature so postject can modify the Mach-O.
if [ "$HOST_OS" = "macos" ]; then
  if command -v codesign >/dev/null 2>&1; then
    codesign --remove-signature "$ART" 2>/dev/null || true
  fi
fi

# Preflight 1: a self-contained SEA binary must NOT have @rpath dylib
# dependencies on a dylib that ships only on the build machine. Homebrew's
# Node on macOS is a 68-KB shim linking to @rpath/libnode.141.dylib — if
# we ship a copy of that as the artifact, the user's machine won't have
# libnode and the binary SIGKILLs (exit 137). Detect before postject runs.
#
# Allowlist: /usr/lib/* and /System/Library/* are always present on macOS
# targets, so references to those are fine. Also allow self-references
# (the binary's own install-name line, which starts with its own path).
if [ "$HOST_OS" = "macos" ] && command -v otool >/dev/null 2>&1; then
  DANGLING_DYLIBS=$(otool -L "$ART" 2>/dev/null | grep -E "^\s*@rpath/" | grep -v "^$ART:" || true)
  if [ -n "$DANGLING_DYLIBS" ]; then
    # Clean up the stub we just copied so it doesn't linger and mislead
    # downstream tools (tar, verify, CI upload) into thinking we succeeded.
    rm -f "$ART"
    fail "BLOCKED-NEEDS-SEA-NODE: the copied Node binary ($NODE_BIN) has @rpath dylib dependencies that won't resolve on a user's machine:
$DANGLING_DYLIBS
Root cause: this Node was built as a dylib-linked launcher (typical of Homebrew Node 22+), not a statically-linked executable. Shipping a copy produces a binary that SIGKILLs (exit 137) anywhere that lacks the dylib. Fix: install an official Node.js release from https://nodejs.org/ (the .pkg installer ships a statically-linked \`node\` at /usr/local/bin/node on Intel or /opt/nodejs/bin/node on arm64), then re-run with PATH adjusted so \`which node\` resolves to the official binary. Recommended fallback: run scripts/release/pkg-bundle.sh instead of SEA." 3
  fi
fi

# Preflight 2: the Node binary we copied must contain the SEA fuse sentinel.
# Some distributions ship Node without SEA support compiled in (the fuse lives
# in libnode.*.dylib instead of the launcher), which would cause postject to
# fail with "Could not find the sentinel NODE_SEA_FUSE_...". Detect up front.
#
# Note: `grep -q` exits early after finding a match, which makes `strings`
# receive SIGPIPE. Under `set -o pipefail` that registers as a pipeline
# failure even when the grep match succeeded. Count matches instead so
# the pipeline always runs to completion.
SEA_FUSE="NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
FUSE_HITS=$(strings "$ART" 2>/dev/null | grep -cF "$SEA_FUSE" || true)
if [ "${FUSE_HITS:-0}" = "0" ]; then
  # Clean up the stub so no stale 50-KB file remains after the failure.
  rm -f "$ART"
  fail "BLOCKED-NEEDS-SEA-NODE: the copied Node binary ($NODE_BIN) does not contain the SEA fuse sentinel ($SEA_FUSE). This Node was built without Single Executable Application support, or the fuse lives in a dylib and not the executable. Use an official Node.js release from https://nodejs.org/ (v20+ includes SEA, statically-linked), or rebuild Node from source with --enable-sea. Recommended fallback: run scripts/release/pkg-bundle.sh (uses @yao-pkg/pkg, static bundle, no dylib dependency)." 3
fi

# Build postject argv. macho-segment-name flag only on macOS.
POSTJECT_ARGS=(
  "$ART" NODE_SEA_BLOB "$BLOB_OUT"
  --sentinel-fuse "$SEA_FUSE"
)
if [ "$HOST_OS" = "macos" ]; then
  POSTJECT_ARGS+=(--macho-segment-name NODE_SEA)
fi

log "injecting SEA blob via postject"
# --overwrite tells postject it's OK to replace an existing segment of the
# same name (NODE_SEA_BLOB). Without it a second injection into the same
# file would fail. We wipe the file above anyway, but including --overwrite
# makes the behaviour idempotent and guards against partial-state races.
POSTJECT_ARGS+=(--overwrite)
if ! npx --yes postject "${POSTJECT_ARGS[@]}"; then
  # Clean up so no half-injected binary lingers and deceives CI.
  rm -f "$ART"
  fail "postject injection failed — binary removed to prevent shipping a stub. Check output above for the exact postject error." 3
fi

# Sanity check: the blob must actually have been injected into the binary.
# Postject can exit 0 even when injection is a no-op (for example, if the
# fuse sentinel scan happens to match zero bytes in a stripped binary).
# Verify the injected segment is present and has expected size.
POST_SIZE=$(wc -c < "$ART" | tr -d ' ')
BLOB_SIZE=$(wc -c < "$BLOB_OUT" | tr -d ' ')
# The final binary should be at least (node size) + (blob size) - overhead.
# If it's smaller than the blob alone, something's wrong.
if [ "$POST_SIZE" -lt "$BLOB_SIZE" ]; then
  rm -f "$ART"
  fail "post-injection binary ($POST_SIZE bytes) is smaller than the SEA blob ($BLOB_SIZE bytes) — injection didn't actually embed the bundle. This usually means the fuse sentinel wasn't found in the copied Node binary (see preflight warnings above)." 3
fi

# macOS: re-sign ad-hoc so the binary launches without quarantine prompts.
# Must happen AFTER postject so codesign sees the final byte stream and
# generates a signature that matches.
if [ "$HOST_OS" = "macos" ]; then
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$ART" 2>/dev/null || log "WARN: ad-hoc codesign failed (non-fatal for development builds)"
  fi
fi

# ── Step 5: Smoke-test the binary via verify-binary.sh ─────────────
# Delegates to the standalone verifier so CI, manual downloads, and this
# script all exercise the same contract (size ≥ 1 MB, file type matches
# platform, --version prints expected, --help runs, no dangling @rpath).
if [ "$SKIP_VERIFY" = "1" ]; then
  log "WARN: WOTANN_SKIP_VERIFY=1 — skipping binary smoke test"
else
  log "smoke-testing binary via scripts/release/verify-binary.sh"
  if ! bash "$SCRIPT_DIR_SEA/verify-binary.sh" "$ART" "$VERSION"; then
    # Clean up so no broken binary remains on disk to be tarred/uploaded.
    rm -f "$ART"
    fail "BLOCKED-NATIVE-BINDINGS: binary failed smoke test. Preflight under plain Node passed, so the native bindings (better-sqlite3, magika, onnxruntime-node, sharp) likely cannot resolve from the SEA binary's working directory — or the injection didn't actually embed the blob. Recommended fallback: run scripts/release/pkg-bundle.sh or ship via install.sh." 4
  fi
  log "smoke-test PASS"
fi

# ── Step 6: Summary ────────────────────────────────────────────────
BIN_SIZE=$(wc -c < "$ART" | tr -d ' ')
log "SUCCESS"
log "  artifact:   $ART"
log "  size:       $BIN_SIZE bytes"
log "  target:     $HOST_TARGET"
log "  version:    $VERSION"
