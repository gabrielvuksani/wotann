#!/usr/bin/env bash
# verify-binary.sh — Post-bundle smoke test for the SEA (or pkg-fallback) binary.
#
# Purpose: catch regressions where the produced binary is a stub, is mis-sized,
# links to local-only dylibs, or otherwise doesn't run end-to-end. Sea-bundle.sh
# and pkg-bundle.sh both call this at the end; CI can also invoke it standalone
# against a downloaded release asset.
#
# Checks (all must pass or exit non-zero):
#   1. File exists + is a regular file (not a symlink / directory)
#   2. File type is Mach-O / ELF / PE executable for the target triple
#   3. Size > MIN_SIZE (default: 1 MB — catches 50-KB stubs and 0-byte files)
#   4. `binary --version` exits 0 and contains the expected version
#   5. `binary --help` exits 0 and prints something that looks like CLI help
#   6. On macOS: no dangling @rpath dylib references that would SIGKILL (137)
#      the binary on a fresh machine. Skipped if otool is unavailable.
#
# Inputs:
#   $1                — path to the binary to verify (required)
#   $2 / VERIFY_VERSION — expected version string (required; the binary must
#                         print this via `--version`)
#   VERIFY_MIN_SIZE=N — override minimum-size floor in bytes (default 1048576)
#   VERIFY_SKIP_RPATH=1 — skip the macOS @rpath dylib liveness check
#
# Exit codes:
#   0 — all checks passed
#   1 — input validation or prerequisite failure
#   2 — file type / size / magic-bytes check failed (stub or wrong platform)
#   3 — `binary --version` failed or printed the wrong version
#   4 — `binary --help` failed
#   5 — dangling @rpath dependency on macOS (binary will SIGKILL off this host)

set -euo pipefail

log()  { printf "\033[0;36m[verify-binary]\033[0m %s\n" "$*"; }
fail() { printf "\033[0;31m[verify-binary:ERROR]\033[0m %s\n" "$*" >&2; exit "${2:-1}"; }
pass() { printf "\033[0;32m[verify-binary:OK]\033[0m %s\n" "$*"; }

# ── Inputs ──────────────────────────────────────────────────────────
BIN="${1:-}"
if [ -z "$BIN" ]; then
  fail "usage: verify-binary.sh <path-to-binary> [expected-version]" 1
fi

EXPECTED_VERSION="${2:-${VERIFY_VERSION:-}}"
if [ -z "$EXPECTED_VERSION" ]; then
  fail "expected version not supplied (arg 2 or VERIFY_VERSION env)" 1
fi

MIN_SIZE="${VERIFY_MIN_SIZE:-1048576}"
SKIP_RPATH="${VERIFY_SKIP_RPATH:-0}"

log "binary:          $BIN"
log "expected ver:    $EXPECTED_VERSION"
log "min size:        $MIN_SIZE bytes"

# ── Check 1: file exists ────────────────────────────────────────────
if [ ! -f "$BIN" ]; then
  fail "binary does not exist or is not a regular file: $BIN" 2
fi
if [ ! -x "$BIN" ]; then
  fail "binary is not executable (mode): $BIN" 2
fi
pass "exists + executable"

# ── Check 2: file type ──────────────────────────────────────────────
HOST_OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
FILE_OUT=$(file -b "$BIN" 2>/dev/null || echo "unknown")
log "file type:       $FILE_OUT"

case "$HOST_OS" in
  darwin)
    echo "$FILE_OUT" | grep -qE "Mach-O (64-bit |universal )?executable" || \
      fail "expected Mach-O executable, got: $FILE_OUT" 2
    ;;
  linux)
    echo "$FILE_OUT" | grep -qE "ELF (64|32)-bit .+ executable" || \
      fail "expected ELF executable, got: $FILE_OUT" 2
    ;;
  mingw*|msys*|cygwin*)
    echo "$FILE_OUT" | grep -qE "(PE32|PE32\+)" || \
      fail "expected PE executable, got: $FILE_OUT" 2
    ;;
esac
pass "file type matches host platform"

# ── Check 3: size > MIN_SIZE ───────────────────────────────────────
SIZE=$(wc -c < "$BIN" | tr -d ' ')
log "actual size:     $SIZE bytes"
if [ "$SIZE" -lt "$MIN_SIZE" ]; then
  fail "binary size ($SIZE) below minimum ($MIN_SIZE) — likely a stub from failed SEA injection. Expected ~50+ MB for a bundled Node SEA binary." 2
fi
pass "size above minimum floor"

# ── Check 4: --version runs and matches ────────────────────────────
log "running: $BIN --version"
# Use `|| true` so we can capture exit code + output separately without
# the pipeline killing us on failure.
VERSION_OUT=""
VERSION_CODE=0
if ! VERSION_OUT=$("$BIN" --version 2>&1); then
  VERSION_CODE=$?
fi

if [ "$VERSION_CODE" -eq 137 ]; then
  fail "binary exited 137 (SIGKILL) — typical symptom of missing @rpath dylib or SEA blob not injected. Output: $VERSION_OUT" 3
fi
if [ "$VERSION_CODE" -ne 0 ]; then
  fail "'$BIN --version' exited $VERSION_CODE. Output: $VERSION_OUT" 3
fi
if ! echo "$VERSION_OUT" | grep -qF "$EXPECTED_VERSION"; then
  fail "'$BIN --version' output did not contain expected version '$EXPECTED_VERSION'. Got: $VERSION_OUT" 3
fi
pass "--version returned 0 and printed expected version"
log "  version output: $VERSION_OUT"

# ── Check 5: --help runs ────────────────────────────────────────────
log "running: $BIN --help"
HELP_OUT=""
HELP_CODE=0
if ! HELP_OUT=$("$BIN" --help 2>&1); then
  HELP_CODE=$?
fi

if [ "$HELP_CODE" -ne 0 ]; then
  fail "'$BIN --help' exited $HELP_CODE. Output: $HELP_OUT" 4
fi

# Heuristic: commander-style CLIs print "Usage:" or at least "Commands:" / "Options:".
if ! echo "$HELP_OUT" | grep -qiE "(usage|commands|options|wotann)"; then
  fail "'$BIN --help' output does not look like CLI help. Got first 200 chars: $(echo "$HELP_OUT" | head -c 200)" 4
fi
pass "--help returned 0 and printed CLI help"

# ── Check 6 (macOS only): dangling @rpath dylibs ──────────────────
# The 50-KB stub bug on macOS was caused by Homebrew Node being a dylib
# launcher — copying it produced a binary that referenced a local-only
# @rpath/libnode.141.dylib, then SIGKILL'd on any user machine without
# that library. Fail the verification if the binary has unresolved
# @rpath dependencies.
if [ "$HOST_OS" = "darwin" ] && [ "$SKIP_RPATH" != "1" ] && command -v otool >/dev/null 2>&1; then
  log "checking dylib dependencies via otool"
  OTOOL_OUT=$(otool -L "$BIN" 2>/dev/null || true)
  # Flag any @rpath/… reference — a properly self-contained SEA binary
  # has no @rpath dependencies (only /usr/lib + /System, which macOS always
  # provides). The pkg fallback compiles statically and also has none.
  RPATH_DEPS=$(echo "$OTOOL_OUT" | grep -E "^\s*@rpath/" | grep -v "^$BIN:" || true)
  if [ -n "$RPATH_DEPS" ]; then
    fail "binary has @rpath dylib dependencies that won't resolve on a fresh machine:
$RPATH_DEPS
Root cause: the Node binary copied into the artifact is a shim (e.g. Homebrew Node) that dynamically links to libnode.*.dylib. The user's machine won't have that dylib, so the binary will SIGKILL (exit 137). Fix: use an official statically-linked Node.js release from nodejs.org, or switch to the pkg fallback path." 5
  fi
  pass "no dangling @rpath dylibs"
fi

# ── Summary ────────────────────────────────────────────────────────
log "ALL CHECKS PASS"
log "  binary:    $BIN"
log "  size:      $SIZE bytes"
log "  version:   $VERSION_OUT"
log "  platform:  $HOST_OS"
exit 0
