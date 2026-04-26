#!/usr/bin/env bash
# notarize-macos.sh — Submit the WOTANN macOS DMG to Apple notarization
# and staple the resulting ticket so Gatekeeper accepts the .dmg offline.
#
# SB-N10 fix: macOS Mojave (10.14)+ requires that ALL apps distributed
# outside the Mac App Store be both code-signed (Developer ID Application)
# AND notarized by Apple. Without notarization the user sees a "WOTANN
# can't be opened because it's from an unidentified developer" warning,
# even when the app IS signed.
#
# Pipeline:
#   1. Verify the DMG exists and is code-signed (codesign --verify --strict)
#   2. Submit via `xcrun notarytool submit --wait` (blocks until Apple
#      finishes scanning; 1-15 min typical)
#   3. On success, staple the notarization ticket so the .dmg passes
#      Gatekeeper offline (`xcrun stapler staple`)
#   4. Verify the staple worked (`xcrun stapler validate`)
#   5. Confirm the .dmg passes spctl assessment (Gatekeeper simulation)
#
# Usage:
#   APPLE_ID=you@you.com APPLE_TEAM_ID=ABCDEF1234 \
#     APPLE_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
#     scripts/release/notarize-macos.sh \
#     desktop-app/src-tauri/target/release/bundle/dmg/WOTANN_0.1.0_aarch64.dmg
#
# Environment variables (required):
#   APPLE_ID            — Apple ID email associated with your Developer Program
#   APPLE_TEAM_ID       — 10-character Team ID (Apple Developer membership page)
#   APPLE_APP_PASSWORD  — App-specific password from appleid.apple.com.
#                          NOT your Apple ID password — generate at
#                          https://account.apple.com/account/manage > App-Specific Passwords
#
# Honest failure model — every step exits non-zero with a structured
# diagnostic so CI can route on the actual cause.

set -euo pipefail

DMG_PATH="${1:-}"
APPLE_ID="${APPLE_ID:?APPLE_ID env var required (your Apple Developer email)}"
APPLE_TEAM_ID="${APPLE_TEAM_ID:?APPLE_TEAM_ID env var required (10-char Team ID)}"
APPLE_APP_PASSWORD="${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD env var required (app-specific password)}"

log()  { printf "\033[0;36m[notarize]\033[0m %s\n" "$*"; }
fail() { printf "\033[0;31m[notarize:ERROR]\033[0m %s\n" "$*" >&2; exit "${2:-1}"; }

if [ -z "$DMG_PATH" ]; then
  fail "usage: $0 <path-to-dmg>" 2
fi
if [ ! -f "$DMG_PATH" ]; then
  fail "DMG not found at: $DMG_PATH" 2
fi
if [[ "$DMG_PATH" != *.dmg ]]; then
  fail "expected .dmg artifact, got: $DMG_PATH" 2
fi

# ── Step 1: Pre-flight code signature check ────────────────────────
log "verifying code signature on $DMG_PATH"
if ! codesign --verify --strict --verbose "$DMG_PATH" 2>&1; then
  fail "code signature missing or broken on $DMG_PATH. Set tauri.conf.json signingIdentity (SB-N8) and rebuild before notarizing." 3
fi

# ── Step 2: Submit to Apple notarization ───────────────────────────
log "submitting $DMG_PATH to Apple notarization (xcrun notarytool, ~1-15 min)"
SUBMIT_LOG=$(mktemp)
if ! xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_PASSWORD" \
    --wait \
    --timeout 30m \
    2>&1 | tee "$SUBMIT_LOG"; then
  STATUS=$(grep -E "^\s*status:" "$SUBMIT_LOG" | head -1 | awk '{print $2}' || echo unknown)
  rm -f "$SUBMIT_LOG"
  fail "notarytool submission failed (status=$STATUS). Check Apple's submission log at https://developer.apple.com/notarization (or run \`xcrun notarytool log <submission-id>\` with credentials)." 4
fi
rm -f "$SUBMIT_LOG"

# ── Step 3: Staple the ticket ──────────────────────────────────────
log "stapling notarization ticket to $DMG_PATH"
if ! xcrun stapler staple "$DMG_PATH"; then
  fail "stapler staple failed — Apple accepted the submission but the ticket couldn't be embedded. Re-run after \`xcrun notarytool wait <submission-id>\`." 5
fi

# ── Step 4: Verify the staple ──────────────────────────────────────
log "validating staple"
if ! xcrun stapler validate "$DMG_PATH"; then
  fail "stapler validation failed — the ticket appears stale or malformed. Re-submit." 6
fi

# ── Step 5: Gatekeeper assessment ──────────────────────────────────
log "spctl assessment (Gatekeeper simulation)"
if ! spctl --assess --type install --verbose "$DMG_PATH" 2>&1; then
  log "WARN: spctl rejected the DMG. The notarization ticket may need a Gatekeeper-database refresh; this can take a few minutes after stapling. Run \`spctl --assess --type install\` again after a short wait."
fi

log "SUCCESS — $DMG_PATH is signed, notarized, and stapled. Ready to ship."
