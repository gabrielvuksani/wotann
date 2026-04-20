#!/usr/bin/env bash
# verify-release-assets.sh — Enforce the canonical 8-asset manifest.
#
# Release Pipeline v2 produces EXACTLY these eight files per release:
#
#   wotann-<VER>-macos-arm64.dmg              Tauri GUI, drag-to-Applications
#   wotann-<VER>-macos-arm64.dmg.sha256
#   wotann-<VER>-macos-arm64.tar.gz           CLI SEA binary (power users)
#   wotann-<VER>-macos-arm64.tar.gz.sha256
#   wotann-<VER>-linux-x64.tar.gz             CLI SEA binary
#   wotann-<VER>-linux-x64.tar.gz.sha256
#   wotann-<VER>-windows-x64.exe              CLI SEA single-file
#   wotann-<VER>-windows-x64.exe.sha256
#
# This script fails the release if:
#   - any of the 8 files is missing
#   - any extra file is present (noise)
#   - any sha256 file is malformed (not "<64-hex-hash>  <filename>")
#   - any file is unexpectedly small (catches stub artifacts)
#
# Usage: verify-release-assets.sh <VERSION> <DIR>
#
# Exit codes:
#   0 — all 8 files present, each sha256 well-formed, each file above
#       its size floor
#   1 — usage error / input validation
#   2 — one or more files missing
#   3 — extra files present (manifest violation)
#   4 — malformed sha256 file
#   5 — file size below sanity floor

set -euo pipefail

log()  { printf "\033[0;36m[verify-release-assets]\033[0m %s\n" "$*"; }
fail() { printf "\033[0;31m[verify-release-assets:ERROR]\033[0m %s\n" "$*" >&2; exit "${2:-1}"; }
pass() { printf "\033[0;32m[verify-release-assets:OK]\033[0m %s\n" "$*"; }

VERSION="${1:-}"
DIR="${2:-}"
if [ -z "$VERSION" ] || [ -z "$DIR" ]; then
  fail "usage: verify-release-assets.sh <VERSION> <DIR>" 1
fi
if [ ! -d "$DIR" ]; then
  fail "not a directory: $DIR" 1
fi

# Minimum size floors per asset type (bytes).
#
# Rationale: SEA binaries are typically ~70 MB (linux) / ~60 MB (macos);
# Tauri DMG is ~10 MB compressed. A stub / mis-built artifact would be
# well under 1 MB. SHA256 files are always 97 bytes: 64 hex + 2 spaces
# + filename (variable) + 1 newline. Use 80-byte floor as a cheap sanity.
FLOOR_BINARY=$((1 * 1024 * 1024))   # 1 MB
FLOOR_SHA256=64                     # at minimum 64 hex chars

EXPECTED=(
  "wotann-${VERSION}-macos-arm64.dmg"
  "wotann-${VERSION}-macos-arm64.dmg.sha256"
  "wotann-${VERSION}-macos-arm64.tar.gz"
  "wotann-${VERSION}-macos-arm64.tar.gz.sha256"
  "wotann-${VERSION}-linux-x64.tar.gz"
  "wotann-${VERSION}-linux-x64.tar.gz.sha256"
  "wotann-${VERSION}-windows-x64.exe"
  "wotann-${VERSION}-windows-x64.exe.sha256"
)

log "version: $VERSION"
log "dir:     $DIR"

# ── Check 1: each expected file exists ───────────────────────────────
MISSING=()
for f in "${EXPECTED[@]}"; do
  if [ ! -f "$DIR/$f" ]; then
    MISSING+=("$f")
  fi
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  fail "missing files: ${MISSING[*]}" 2
fi
pass "all 8 expected files present"

# ── Check 2: no extra files present ──────────────────────────────────
# Use basename listing; ignore hidden dotfiles and directories.
ACTUAL_LIST=$(cd "$DIR" && find . -maxdepth 1 -type f ! -name '.*' -print | sed 's|^\./||' | LC_ALL=C sort)
EXPECTED_LIST=$(printf '%s\n' "${EXPECTED[@]}" | LC_ALL=C sort)
EXTRA=$(comm -23 <(echo "$ACTUAL_LIST") <(echo "$EXPECTED_LIST"))
if [ -n "$EXTRA" ]; then
  fail "unexpected files present (manifest violation):
$EXTRA
Remove these before publishing. The canonical 8-asset set is enforced to keep the release page clean." 3
fi
pass "no extra files beyond the canonical 8"

# ── Check 3: each sha256 file is well-formed ─────────────────────────
# Format must be "<64-hex-hash>  <filename>\n" (two spaces, POSIX style).
# The checksum file must reference its sibling artifact, not some random
# filename that happened to be hashed on a different runner.
for f in "${EXPECTED[@]}"; do
  case "$f" in
    *.sha256)
      CONTENT=$(cat "$DIR/$f")
      HASH=$(echo "$CONTENT" | awk '{print $1}')
      REFERENCED=$(echo "$CONTENT" | awk '{print $2}')
      if [ "${#HASH}" -lt "$FLOOR_SHA256" ]; then
        fail "$f: hash is ${#HASH} chars (expected $FLOOR_SHA256 hex chars). Got: '$CONTENT'" 4
      fi
      # Strip any "*" that sha256sum prepends in binary mode.
      REFERENCED="${REFERENCED#\*}"
      EXPECTED_SIBLING="${f%.sha256}"
      if [ "$REFERENCED" != "$EXPECTED_SIBLING" ]; then
        fail "$f: checksum references '$REFERENCED' but sibling file is '$EXPECTED_SIBLING'. Were the sha files generated on a runner with a different filename?" 4
      fi
      ;;
  esac
done
pass "all sha256 files well-formed and reference the correct sibling"

# ── Check 4: each binary artifact is at least 1 MB ───────────────────
for f in "${EXPECTED[@]}"; do
  case "$f" in
    *.sha256) continue ;;
  esac
  SIZE=$(wc -c < "$DIR/$f" | tr -d ' ')
  if [ "$SIZE" -lt "$FLOOR_BINARY" ]; then
    fail "$f is only $SIZE bytes (floor: $FLOOR_BINARY). Likely a stub from a failed build — do NOT ship." 5
  fi
done
pass "all binary artifacts above 1 MB floor"

# ── Summary ──────────────────────────────────────────────────────────
log "MANIFEST VERIFIED"
log "  8 files, all present, all checksums well-formed, all binaries sized."
exit 0
