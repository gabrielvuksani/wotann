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

# 2. Single-binary builds via pkg or similar
# (pkg is deprecated; we'll use Node 21's --experimental-sea instead,
# OR Bun compile, OR Deno compile. Pick one when implementing.)
log "creating Node SEA binaries (single-executable application)"

# Placeholder targets — real implementation wires node --experimental-sea-config
TARGETS=(
  "macos-x64"
  "macos-arm64"
  "linux-x64"
  "linux-arm64"
  "windows-x64"
)

for target in "${TARGETS[@]}"; do
  log "  target: $target (stub — add node-sea / bun / deno compile here)"
  # Stub artifact for now — replace with real packager invocation
  ART="$DIST/wotann-${VERSION}-${target}"
  [ "$target" = "windows-x64" ] && ART="${ART}.exe"
  echo "#!/bin/sh\necho 'wotann ${VERSION} (${target}) — release stub'\n" > "$ART"
  chmod +x "$ART"
done

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
