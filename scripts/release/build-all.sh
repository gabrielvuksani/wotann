#!/usr/bin/env bash
# build-all.sh — Orchestrator that builds, SEA-bundles, and archives
# release artifacts for the HOST target. CI invokes this on each matrix
# runner so we get a full platform fan-out.
#
# Responsibilities:
#   1. Run TypeScript build (`npm run build`)
#   2. Delegate SEA binary production to `sea-bundle.sh` (fails loudly if
#      postject is missing — no silent skip)
#   3. Archive + checksum the produced binary
#
# Inputs (args or env):
#   $1 / WOTANN_VERSION — version string (default: from package.json)
#
# Exit codes:
#   0   — success
#   1   — prerequisite missing or build failure
#   2-4 — propagated from sea-bundle.sh

set -euo pipefail

log()  { printf "\033[0;36m[build-all]\033[0m %s\n" "$*"; }
fail() { printf "\033[0;31m[build-all:ERROR]\033[0m %s\n" "$*" >&2; exit "${2:-1}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION="${1:-${WOTANN_VERSION:-$(node -p "require('./package.json').version")}}"
export WOTANN_VERSION="$VERSION"
DIST="${WOTANN_DIST:-dist/release}"
export WOTANN_DIST="$DIST"

mkdir -p "$DIST"
log "version: $VERSION"
log "output:  $DIST"

# ── Step 1: TypeScript build ──────────────────────────────────────
# tsc validates types and emits dist/index.js (ESM). Needed as a preflight
# even though the SEA input is produced by esbuild-cjs directly from the
# TypeScript source — tsc catches type errors before we spend time bundling.
log "step 1/4: TypeScript build (npm run build)"
npm run build || fail "npm run build failed" 1

# ── Step 2: ESM → CJS bundle via esbuild ──────────────────────────
# Node SEA requires a CommonJS main script. esbuild-cjs.mjs bundles
# src/index.ts into dist-cjs/index.cjs with TLA wrapped in an async IIFE.
# sea-bundle.sh also runs this step defensively, but invoking it here
# explicitly keeps the pipeline stages readable in CI logs and surfaces
# bundling failures before the heavier SEA step kicks in.
log "step 2/4: ESM → CJS bundle (esbuild-cjs.mjs)"
if [ ! -f "$SCRIPT_DIR/esbuild-cjs.mjs" ]; then
  fail "missing: $SCRIPT_DIR/esbuild-cjs.mjs" 1
fi
node "$SCRIPT_DIR/esbuild-cjs.mjs" || fail "esbuild-cjs.mjs failed — CJS bundle not produced" $?

# ── Step 3: SEA bundle ────────────────────────────────────────────
log "step 3/4: SEA bundle via sea-bundle.sh"
if [ ! -x "$SCRIPT_DIR/sea-bundle.sh" ]; then
  fail "missing or non-executable: $SCRIPT_DIR/sea-bundle.sh" 1
fi
# Propagate non-zero exit so CI fails rather than silently shipping half-built binary.
bash "$SCRIPT_DIR/sea-bundle.sh" || fail "SEA bundling failed — see above" $?

# ── Host target detection (for archive naming) ────────────────────
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$HOST_OS" in
  darwin) HOST_OS="macos" ;;
  mingw*|msys*|cygwin*) HOST_OS="windows" ;;
esac
HOST_ARCH="$(uname -m)"
case "$HOST_ARCH" in
  x86_64|amd64) HOST_ARCH="x64" ;;
  arm64|aarch64) HOST_ARCH="arm64" ;;
esac
HOST_TARGET="${HOST_OS}-${HOST_ARCH}"

ART="$DIST/wotann-${VERSION}-${HOST_TARGET}"
[ "$HOST_OS" = "windows" ] && ART="${ART}.exe"

if [ ! -f "$ART" ]; then
  fail "expected SEA binary missing after sea-bundle: $ART" 1
fi

# ── Step 4: Archive + checksum ────────────────────────────────────
log "step 4/4: archive + checksum"
(
  cd "$DIST"
  BASENAME="$(basename "$ART")"
  tar -czf "${BASENAME}.tar.gz" "$BASENAME"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${BASENAME}.tar.gz" > "${BASENAME}.tar.gz.sha256"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${BASENAME}.tar.gz" > "${BASENAME}.tar.gz.sha256"
  else
    fail "neither shasum nor sha256sum available — cannot compute checksum" 1
  fi
)

log "DONE — artifacts in $DIST:"
ls -la "$DIST"
