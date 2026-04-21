#!/usr/bin/env bash
# install-terminal-bench.sh — opt-in install of the upstream TerminalBench CLI.
#
# This script is INTENTIONALLY opt-in (never auto-runs in CI). It installs
# the `terminal-bench` Python package from the Laude Institute via pip,
# then verifies the `tb` CLI is available on PATH.
#
# The real-mode dispatch in src/intelligence/benchmark-runners/terminal-bench.ts
# gracefully degrades to simple-mode when `tb` is missing — this script is
# the user-facing path to unblock real-mode.
#
# Usage:
#   bash scripts/install-terminal-bench.sh          # install + verify
#   bash scripts/install-terminal-bench.sh --check  # verify only (no install)
#
# Exit codes:
#   0 — success (CLI installed and `tb --version` exits 0)
#   1 — pip not available
#   2 — pip install failed
#   3 — tb CLI not on PATH after install

set -euo pipefail

MODE="install"
if [[ "${1-}" == "--check" ]]; then
  MODE="check"
fi

# ── Check mode ────────────────────────────────────────

if [[ "$MODE" == "check" ]]; then
  if command -v tb >/dev/null 2>&1; then
    echo "OK: tb CLI found at $(command -v tb)"
    tb --version || true
    exit 0
  else
    echo "NOT FOUND: tb CLI is not on PATH"
    exit 3
  fi
fi

# ── Install mode ──────────────────────────────────────

# Prefer pip3 over pip on macOS/Linux defaults.
PIP_CMD=""
if command -v pip3 >/dev/null 2>&1; then
  PIP_CMD="pip3"
elif command -v pip >/dev/null 2>&1; then
  PIP_CMD="pip"
else
  echo "ERROR: neither pip nor pip3 is on PATH."
  echo "       Install Python 3.10+ and pip first, e.g.:"
  echo "         brew install python@3.12"
  echo "         curl -LsSf https://astral.sh/uv/install.sh | sh   # alt: uv"
  exit 1
fi

echo "Installing terminal-bench via $PIP_CMD..."

# We install --user by default to avoid clobbering system Python. A user
# on a venv will already have it activated and --user gets ignored.
if ! "$PIP_CMD" install --user --upgrade terminal-bench; then
  echo "ERROR: pip install terminal-bench failed."
  echo "       Try: $PIP_CMD install --upgrade terminal-bench"
  echo "       Or:  uv pip install terminal-bench"
  exit 2
fi

# Re-scan PATH in case pip installed to ~/.local/bin which isn't yet in PATH.
USER_BIN="$HOME/.local/bin"
if [[ -d "$USER_BIN" && ":$PATH:" != *":$USER_BIN:"* ]]; then
  echo "NOTE: $USER_BIN is not on your PATH. Adding it for this check..."
  export PATH="$USER_BIN:$PATH"
fi

if command -v tb >/dev/null 2>&1; then
  echo "OK: tb CLI installed at $(command -v tb)"
  tb --version || true
  echo ""
  echo "Next steps:"
  echo "  1. Download the corpus: node scripts/download-terminal-bench-corpus.mjs --yes"
  echo "  2. Run: WOTANN_TB_REAL=1 npm run bench -- --benchmark terminal-bench"
  exit 0
else
  echo "WARN: tb CLI installed but not on PATH."
  echo "      Add this to your shell profile:"
  echo "        export PATH=\"\$HOME/.local/bin:\$PATH\""
  exit 3
fi
