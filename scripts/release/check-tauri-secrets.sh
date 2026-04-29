#!/bin/bash
# Pre-release CI gate: ensure Tauri secrets are real (SB-N7 + SB-N8).
#
# Fails the release if either:
#   - desktop-app/src-tauri/tauri.conf.json still contains the
#     `TODO-USER-ACTION-…` updater pubkey placeholder, OR
#   - `signingIdentity` is null (i.e. binaries would ship adhoc-signed
#     and Gatekeeper would reject them on Sequoia+ macOS).
#
# Both values require a USER-ACTION outside this repo (generate updater
# keypair via `tauri signer generate`; obtain Developer ID cert from
# Apple). Wiring this gate as the first job of release.yml means a
# tag push with placeholders fails immediately rather than producing
# a broken DMG that ships to users.
set -euo pipefail

CONF="desktop-app/src-tauri/tauri.conf.json"

if [ ! -f "$CONF" ]; then
  echo "CI GATE FAIL: $CONF does not exist."
  exit 1
fi

if grep -q "TODO-USER-ACTION" "$CONF"; then
  echo "CI GATE FAIL: $CONF still contains TODO-USER-ACTION placeholder."
  echo "Run: cd desktop-app/src-tauri && npx tauri signer generate"
  echo "Then paste the public key into tauri.conf.json plugins.updater.pubkey"
  exit 1
fi

if grep -E '"signingIdentity"\s*:\s*null' "$CONF" >/dev/null; then
  echo "CI GATE FAIL: $CONF has signingIdentity: null."
  echo "Set to: \"signingIdentity\": \"Developer ID Application: <NAME> (<TEAMID>)\""
  echo "Find your identity: security find-identity -v -p codesigning"
  exit 1
fi

echo "Tauri secrets OK."
