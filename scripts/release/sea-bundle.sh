#!/usr/bin/env bash
# sea-bundle.sh — Produce a single-file standalone binary using Node's
# Single Executable Application API (SEA).
#
# Pipeline: npm run build -> node --experimental-sea-config -> postject inject
# Output:   dist/release/wotann-<version>-<host-os>-<host-arch>[.exe]
#
# Cross-compilation: this script only produces the HOST target. CI matrix runs
# the script on each target OS (macos-x64, macos-arm64, linux-x64, linux-arm64,
# windows-x64).
#
# Honest failure model — no silent skips. Every failure path exits non-zero
# with a structured BLOCKED-<REASON> message the release CI can parse.
#
# Env overrides:
#   WOTANN_VERSION   — override version string (default: from package.json)
#   WOTANN_DIST      — override output dir   (default: dist/release)
#   WOTANN_SKIP_VERIFY=1 — skip post-bundle smoke test (NOT recommended)
#
# Exit codes:
#   0  — success
#   1  — build prerequisite failed (npm run build, missing dist/index.js, etc.)
#   2  — SEA blob generation failed
#   3  — postject missing or injection failed (BLOCKED-NEEDS-POSTJECT)
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

# ── Step 2: Produce SEA blob ───────────────────────────────────────
# Node SEA blobs require a CommonJS main script. If dist/index.js uses ESM
# `import`/`export`, SEA will fail with "Cannot use import statement outside
# a module". We preflight that condition and emit a structured
# BLOCKED-NEEDS-CJS-BUNDLE error so CI logs can parse the reason.
log "producing SEA blob from sea.config.json"
BLOB_OUT=$(node -p "require('./sea.config.json').output" 2>/dev/null || echo "dist/release/wotann.blob")

# sea-config requires output dir to exist.
mkdir -p "$(dirname "$BLOB_OUT")"

# Preflight: detect ESM source (heuristic — top-level `import ... from`).
# Node SEA currently only supports CJS main scripts. If the entry is ESM,
# downstream bundling (esbuild --format=cjs or similar) is required.
if grep -qE "^import .* from" dist/index.js; then
  fail "BLOCKED-NEEDS-CJS-BUNDLE: dist/index.js uses ESM imports but Node SEA requires a CommonJS main script. Add a bundler step (e.g. 'esbuild dist/index.js --bundle --format=cjs --platform=node --outfile=dist/index.cjs') and update sea.config.json main to point at the CJS bundle." 2
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
if ! npx --no-install postject --version >/dev/null 2>&1; then
  log "postject not installed — attempting 'npx --yes postject' fetch"
  if ! npx --yes postject --version >/dev/null 2>&1; then
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
cp "$NODE_BIN" "$ART"
chmod +x "$ART"

# macOS: strip existing code signature so postject can modify the Mach-O.
if [ "$HOST_OS" = "macos" ]; then
  if command -v codesign >/dev/null 2>&1; then
    codesign --remove-signature "$ART" 2>/dev/null || true
  fi
fi

# Build postject argv. macho-segment-name flag only on macOS.
POSTJECT_ARGS=(
  "$ART" NODE_SEA_BLOB "$BLOB_OUT"
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
)
if [ "$HOST_OS" = "macos" ]; then
  POSTJECT_ARGS+=(--macho-segment-name NODE_SEA)
fi

log "injecting SEA blob via postject"
if ! npx --yes postject "${POSTJECT_ARGS[@]}"; then
  fail "postject injection failed — binary may be partially modified" 3
fi

# macOS: re-sign ad-hoc so the binary launches without quarantine prompts.
if [ "$HOST_OS" = "macos" ]; then
  if command -v codesign >/dev/null 2>&1; then
    codesign --sign - "$ART" 2>/dev/null || log "WARN: ad-hoc codesign failed (non-fatal for development builds)"
  fi
fi

# ── Step 5: Smoke-test the binary ──────────────────────────────────
if [ "$SKIP_VERIFY" = "1" ]; then
  log "WARN: WOTANN_SKIP_VERIFY=1 — skipping binary smoke test"
else
  log "smoke-testing binary: $ART --version"
  # Capture output; fail hard if the binary doesn't run or version is wrong.
  if ! OUT=$("$ART" --version 2>&1); then
    fail "binary failed to execute: $OUT" 4
  fi
  if ! echo "$OUT" | grep -qF "$VERSION"; then
    fail "binary --version output ($OUT) does not contain expected version ($VERSION)" 4
  fi
  log "smoke-test PASS — binary reports version: $OUT"
fi

# ── Step 6: Summary ────────────────────────────────────────────────
BIN_SIZE=$(wc -c < "$ART" | tr -d ' ')
log "SUCCESS"
log "  artifact:   $ART"
log "  size:       $BIN_SIZE bytes"
log "  target:     $HOST_TARGET"
log "  version:    $VERSION"
