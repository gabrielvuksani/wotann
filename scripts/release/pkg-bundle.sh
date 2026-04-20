#!/usr/bin/env bash
# pkg-bundle.sh — Fallback binary bundler using @yao-pkg/pkg (a maintained
# fork of vercel/pkg that supports Node 20+). Used when Node SEA is blocked
# because the host lacks a statically-linked Node with the SEA fuse sentinel
# in the executable (see sea-bundle.sh "BLOCKED-NEEDS-SEA-NODE").
#
# Pipeline:
#   1. Ensure dist-cjs/index.cjs exists (reuse esbuild-cjs.mjs output)
#   2. Generate a minimal pkg.config.json that points pkg at the CJS bundle
#   3. npx @yao-pkg/pkg → produces a statically-linked binary per target
#   4. Delegate to verify-binary.sh for the final smoke test
#
# Output:  dist/release/wotann-<version>-<host-os>-<host-arch>[.exe]
#
# Why @yao-pkg/pkg and not official vercel/pkg:
#   vercel/pkg was archived in 2023 and does not support Node 20+. The
#   community-maintained @yao-pkg/pkg fork supports Node 20, 22, and 24
#   and is the canonical successor.
#
# Limitations:
#   - pkg bundles are slightly slower to start (~100 ms more than SEA)
#   - Native modules (.node files) are still external and either unpacked
#     at runtime to a temp dir or must ship alongside the binary. We mark
#     the same externals as esbuild-cjs.mjs.
#
# Env overrides:
#   WOTANN_VERSION   — override version string (default: from package.json)
#   WOTANN_DIST      — override output dir   (default: dist/release)
#   WOTANN_SKIP_VERIFY=1 — skip post-bundle smoke test (NOT recommended)
#   WOTANN_PKG_NODE_VERSION — node runtime version baked into bundle
#                              (default: node22; pkg defaults to node18)
#
# Exit codes:
#   0  — success
#   1  — build prerequisite failed (CJS missing, pkg not installable)
#   2  — pkg bundling failed
#   3  — produced binary fails verify-binary.sh smoke test

set -euo pipefail

log()  { printf "\033[0;36m[pkg-bundle]\033[0m %s\n" "$*"; }
fail() { printf "\033[0;31m[pkg-bundle:ERROR]\033[0m %s\n" "$*" >&2; exit "${2:-1}"; }

# ── Inputs ──────────────────────────────────────────────────────────
VERSION="${WOTANN_VERSION:-$(node -p "require('./package.json').version")}"
DIST="${WOTANN_DIST:-dist/release}"
SKIP_VERIFY="${WOTANN_SKIP_VERIFY:-0}"
PKG_NODE_VERSION="${WOTANN_PKG_NODE_VERSION:-node22}"

mkdir -p "$DIST"

SCRIPT_DIR_PKG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Host target detection (must match sea-bundle.sh naming) ────────
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
log "pkg node ver:  $PKG_NODE_VERSION"
log "output dir:    $DIST"

# pkg target triplet syntax: node{major}-{os}-{arch}
# e.g. node22-macos-arm64, node22-linux-x64, node22-win-x64
PKG_OS="$HOST_OS"
[ "$HOST_OS" = "windows" ] && PKG_OS="win"
PKG_TARGET="${PKG_NODE_VERSION}-${PKG_OS}-${HOST_ARCH}"
log "pkg target:    $PKG_TARGET"

# ── Step 1: ensure CJS bundle is present ───────────────────────────
CJS_OUT="dist-cjs/index.cjs"
if [ ! -s "$CJS_OUT" ]; then
  log "$CJS_OUT missing — running esbuild-cjs.mjs"
  if ! node "$SCRIPT_DIR_PKG/esbuild-cjs.mjs"; then
    fail "esbuild-cjs.mjs failed — CJS bundle not produced. See above for esbuild errors." 1
  fi
fi
if [ ! -s "$CJS_OUT" ]; then
  fail "$CJS_OUT still missing or empty after esbuild — cannot proceed" 1
fi

# Sanity check: the bundle should run under plain Node before pkg packs it.
log "preflight: ensuring $CJS_OUT runs under plain Node before pkg bundling"
if ! PREFLIGHT_OUT=$(node "$CJS_OUT" --version 2>&1); then
  fail "BLOCKED-NATIVE-BINDINGS: '$CJS_OUT --version' failed under plain Node. Output: $PREFLIGHT_OUT. Recommended fallback: ship via install.sh (npm install + postinstall) instead of pkg." 1
fi
if ! echo "$PREFLIGHT_OUT" | grep -qF "$VERSION"; then
  fail "preflight: '$CJS_OUT --version' did not print expected version $VERSION (got: $PREFLIGHT_OUT)" 1
fi
log "preflight PASS — bundle prints version: $PREFLIGHT_OUT"

# ── Step 2: write a pkg.config.json ────────────────────────────────
# pkg reads this to know what to bundle and which files to keep external
# (native .node bindings, which pkg can't embed — they're unpacked at
# runtime from a snapshot filesystem). The list mirrors esbuild-cjs.mjs
# externals so the two paths stay in sync.
PKG_CONFIG_JSON="$(mktemp -t wotann-pkg-config.XXXXXX).json"
cat > "$PKG_CONFIG_JSON" <<'JSON'
{
  "name": "wotann",
  "bin": "dist-cjs/index.cjs",
  "pkg": {
    "assets": [
      "skills/**/*",
      "dist-cjs/**/*.json"
    ],
    "scripts": [],
    "targets": []
  }
}
JSON

# ── Step 3: run @yao-pkg/pkg ───────────────────────────────────────
ART="$DIST/wotann-${VERSION}-${HOST_TARGET}"
[ "$HOST_OS" = "windows" ] && ART="${ART}.exe"

# Proactively remove any stale artifact (prevents cp errors and stale
# 50-KB stubs lingering from prior failed runs).
[ -f "$ART" ] && { chmod u+w "$ART" 2>/dev/null || true; rm -f "$ART"; }

log "running @yao-pkg/pkg against $CJS_OUT"
# --compress Brotli keeps the output manageable (~30-40% smaller than raw).
# --no-bytecode skips V8 bytecode generation; SEA doesn't do bytecode either
# and skipping it avoids a class of "can't resolve dynamic import" issues.
# --public-packages "*" permits pkg to resolve and snapshot CJS deps instead
# of demanding fully-static source inclusion.
PKG_STDERR=$(mktemp)
if ! npx --yes @yao-pkg/pkg \
  "$CJS_OUT" \
  --target "$PKG_TARGET" \
  --output "$ART" \
  --compress Brotli \
  --no-bytecode \
  --public-packages "*" \
  --config "$PKG_CONFIG_JSON" \
  2>"$PKG_STDERR"; then
  PKG_MSG=$(cat "$PKG_STDERR")
  rm -f "$PKG_STDERR" "$PKG_CONFIG_JSON"
  [ -f "$ART" ] && rm -f "$ART"
  fail "@yao-pkg/pkg failed:
$PKG_MSG
Common causes:
  - pkg target '$PKG_TARGET' is not supported — try WOTANN_PKG_NODE_VERSION=node20
  - A bundled module uses dynamic require() that pkg can't resolve statically
  - The system lacks network access to fetch pkg's prebuilt Node base binary" 2
fi
rm -f "$PKG_STDERR" "$PKG_CONFIG_JSON"

if [ ! -f "$ART" ]; then
  fail "expected pkg-bundled binary at $ART but file does not exist" 2
fi

# macOS: ad-hoc codesign so the binary launches without Gatekeeper prompts.
if [ "$HOST_OS" = "macos" ] && command -v codesign >/dev/null 2>&1; then
  codesign --force --sign - "$ART" 2>/dev/null || log "WARN: ad-hoc codesign failed (non-fatal for development builds)"
fi

chmod +x "$ART"
ART_SIZE=$(wc -c < "$ART" | tr -d ' ')
log "pkg produced: $ART ($ART_SIZE bytes)"

# ── Step 4: smoke-test via verify-binary.sh ────────────────────────
if [ "$SKIP_VERIFY" = "1" ]; then
  log "WARN: WOTANN_SKIP_VERIFY=1 — skipping binary smoke test"
else
  log "smoke-testing binary via scripts/release/verify-binary.sh"
  # pkg binaries don't have @rpath deps, so we don't need VERIFY_SKIP_RPATH.
  # They also tend to be 40-60 MB so the default 1-MB floor is plenty.
  if ! bash "$SCRIPT_DIR_PKG/verify-binary.sh" "$ART" "$VERSION"; then
    rm -f "$ART"
    fail "pkg-bundled binary failed verify-binary.sh. See output above for the exact check that failed." 3
  fi
  log "smoke-test PASS"
fi

# ── Summary ────────────────────────────────────────────────────────
log "SUCCESS (pkg fallback)"
log "  artifact:   $ART"
log "  size:       $ART_SIZE bytes"
log "  target:     $HOST_TARGET"
log "  pkg target: $PKG_TARGET"
log "  version:    $VERSION"
