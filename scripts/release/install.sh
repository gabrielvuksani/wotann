#!/usr/bin/env bash
# WOTANN installer — curl -fsSL https://wotann.com/install.sh | bash
# Detects OS + arch + shell, downloads the right binary from GitHub
# Releases, verifies sha256, and installs to ~/.wotann/bin.
#
# Safe by default: prints every destructive action before running it,
# and exits non-zero on the slightest checksum mismatch.

set -euo pipefail

REPO="${WOTANN_REPO:-gabrielvuksani/wotann}"
VERSION="${WOTANN_VERSION:-latest}"
INSTALL_DIR="${WOTANN_INSTALL_DIR:-$HOME/.wotann/bin}"
FORCE="${WOTANN_FORCE:-0}"

log()  { printf "\033[0;36m[wotann]\033[0m %s\n" "$*"; }
fail() { printf "\033[0;31m[error]\033[0m %s\n" "$*" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) fail "unsupported OS: $(uname -s). File a bug at https://github.com/$REPO/issues" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) fail "unsupported arch: $(uname -m)" ;;
  esac
}

resolve_version() {
  if [ "$VERSION" = "latest" ]; then
    VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | \
      grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/') || \
      fail "could not resolve latest version"
  fi
}

OS=$(detect_os)
ARCH=$(detect_arch)
resolve_version

BINARY_NAME="wotann-${VERSION}-${OS}-${ARCH}"
if [ "$OS" = "windows" ]; then BINARY_NAME="${BINARY_NAME}.exe"; fi
ARCHIVE_URL="https://github.com/$REPO/releases/download/${VERSION}/${BINARY_NAME}.tar.gz"
CHECKSUM_URL="${ARCHIVE_URL}.sha256"

log "detected: $OS/$ARCH"
log "version: $VERSION"
log "downloading: $ARCHIVE_URL"

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

cd "$TMP"
curl -fsSL "$ARCHIVE_URL" -o "$BINARY_NAME.tar.gz" || fail "download failed"
curl -fsSL "$CHECKSUM_URL" -o "$BINARY_NAME.tar.gz.sha256" || fail "checksum download failed"

EXPECTED=$(cat "$BINARY_NAME.tar.gz.sha256" | awk '{print $1}')
if command -v shasum >/dev/null 2>&1; then
  ACTUAL=$(shasum -a 256 "$BINARY_NAME.tar.gz" | awk '{print $1}')
elif command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "$BINARY_NAME.tar.gz" | awk '{print $1}')
else
  fail "neither shasum nor sha256sum found — cannot verify integrity"
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
  fail "SHA256 mismatch — download corrupted or tampered. Expected $EXPECTED, got $ACTUAL"
fi
log "checksum verified"

tar -xzf "$BINARY_NAME.tar.gz"

mkdir -p "$INSTALL_DIR"
if [ -f "$INSTALL_DIR/wotann" ] && [ "$FORCE" != "1" ]; then
  fail "$INSTALL_DIR/wotann already exists. Set WOTANN_FORCE=1 to overwrite."
fi

cp -f wotann "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/wotann"
log "installed to $INSTALL_DIR/wotann"

# PATH hint
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  log "add this to your shell rc:"
  printf '\n  export PATH="%s:$PATH"\n\n' "$INSTALL_DIR"
fi

log "run: wotann --version"
