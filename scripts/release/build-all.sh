#!/usr/bin/env bash
# Build release artifacts for all platforms.
# Assumes: node, npm, rustup, cross-compile toolchains installed.
# Produces: dist/wotann-<version>-<os>-<arch>[.tar.gz|.dmg|.exe|.deb|.rpm|.AppImage]
#
# Run locally or via GitHub Actions. CI path skips DMG/MSI signing — those
# need Apple Developer ID + Windows code-signing certs.

set -euo pipefail

VERSION="${1:-$(node -p "require('./package.json').version")}"
DIST="dist/release"
mkdir -p "$DIST"

log() { printf "\033[0;36m[build-all]\033[0m %s\n" "$*"; }

# 1. TypeScript → JavaScript bundles
log "building JavaScript bundles"
npm run build

# 2. Produce the SEA blob (one per version, the same blob injects into
# the platform-specific node binary for each target).
log "producing SEA blob from sea.config.json"
node --experimental-sea-config sea.config.json

# 3. For each target, copy the local node binary + inject the blob.
# Cross-compilation for non-host targets requires downloading the Node
# binary for that platform; this script only produces the HOST target
# by default. CI handles the full matrix by running on each platform.

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

log "building for host target: $HOST_TARGET"

NODE_BIN="$(which node)"
ART="$DIST/wotann-${VERSION}-${HOST_TARGET}"
[ "$HOST_OS" = "windows" ] && ART="${ART}.exe"

# Copy node → our binary
cp "$NODE_BIN" "$ART"

# Strip code-signing on macOS so we can re-inject (resign after)
if [ "$HOST_OS" = "macos" ]; then
  codesign --remove-signature "$ART" 2>/dev/null || true
fi

# Inject the SEA blob
npx --yes postject "$ART" NODE_SEA_BLOB "$DIST/wotann.blob" \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  $([ "$HOST_OS" = "macos" ] && echo "--macho-segment-name NODE_SEA" || echo "")

# Re-sign macOS binary ad-hoc (unsigned distribution requires user
# right-click → open). Real release CI should notarize via Apple Dev ID.
if [ "$HOST_OS" = "macos" ]; then
  codesign --sign - "$ART" 2>/dev/null || true
fi

chmod +x "$ART"
log "  host artifact: $ART"

# Non-host targets — CI job on that platform runs the same script
log "NOTE: non-host targets require CI runner on that platform"

# 3. Archive + checksums
log "archiving + computing checksums"
cd "$DIST"
for bin in wotann-${VERSION}-*; do
  tar -czf "${bin}.tar.gz" "$bin"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${bin}.tar.gz" > "${bin}.tar.gz.sha256"
  else
    sha256sum "${bin}.tar.gz" > "${bin}.tar.gz.sha256"
  fi
done

log "done — artifacts in $DIST"
ls -la
