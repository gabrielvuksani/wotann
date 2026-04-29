#!/bin/bash
# Verify AASA file at production URL returns JSON, not HTML (SB-N5).
#
# iOS universal links (`applinks:wotann.com` in WOTANN.entitlements)
# require https://wotann.com/.well-known/apple-app-site-association
# to serve `application/json`. Apple's `swcd` daemon fetches this URL
# and silently refuses to associate the domain if the response is
# `text/html` (the marketing-site default for unknown paths) — which
# breaks every conversation/share/pair handoff from Mail/Messages.
#
# Run as a post-publish smoke test. Must NOT block the build itself —
# AASA is server-side and may legitimately lag the build by minutes
# during deploy. Use it to mark a release as draft if the site is
# stale, not to fail the binary build.
set -euo pipefail

URL="${1:-https://wotann.com/.well-known/apple-app-site-association}"

# Use --fail to coerce non-2xx into a non-zero exit code so 404s are
# caught immediately rather than treated as "served HTML by error page".
ct=$(curl -sS --fail -o /dev/null -w "%{content_type}" "$URL")
if echo "$ct" | grep -qi "application/json"; then
  echo "AASA OK: $URL -> $ct"
else
  echo "AASA FAIL: $URL returns $ct (expected application/json)"
  exit 1
fi
