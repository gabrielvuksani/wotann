#!/usr/bin/env bash
# install-termux.sh — V9 FT.3.1 Termux CLI installer.
#
# WHAT: Installs WOTANN inside Termux on Android.
#
# WHY: Pure `npm install -g wotann` fails on Termux because better-sqlite3
#   tries to compile a native module against bionic libc and fails. We
#   need a guided installer that:
#     1. Detects the Termux environment
#     2. Installs the right system packages
#     3. Hints at termux-wake-lock for long-running sessions
#     4. Documents Termux:API integration for clipboard / TTS / notifications
#
# WHERE: Shipped as `scripts/install-termux.sh`. Users curl-pipe it after
#   installing F-Droid Termux:
#     curl -fsSL https://wotann.com/install-termux.sh | bash
#
# HOW: Bash script. POSIX-where-possible. Honest stubs throughout — we
#   bail out with a clear error rather than silently continuing on
#   non-Termux platforms.
#
# Honest-stub policy: if `$PREFIX` doesn't point at Termux, we exit 1
# with a message telling the user to use the regular `npm install -g
# wotann` path.

set -euo pipefail

# ── Constants ──────────────────────────────────────────────────────

readonly TERMUX_PREFIX_MARKER="/data/data/com.termux/files/usr"
readonly REQUIRED_TERMUX_PACKAGES=(
  "nodejs-lts"
  "git"
  "sqlite"
  "openssl"
)
readonly OPTIONAL_TERMUX_PACKAGES=(
  "termux-api"   # clipboard, TTS, notifications, share intent
  "termux-tools" # termux-wake-lock, termux-setup-storage
)

# ── Logging helpers ────────────────────────────────────────────────

# Print a timestamped info line to stderr. Stdout is reserved for
# data the caller might want to capture (currently nothing — all
# output is informational).
log_info() {
  printf '\033[36m[install-termux]\033[0m %s\n' "$*" >&2
}

log_warn() {
  printf '\033[33m[install-termux:WARN]\033[0m %s\n' "$*" >&2
}

log_error() {
  printf '\033[31m[install-termux:ERROR]\033[0m %s\n' "$*" >&2
}

log_success() {
  printf '\033[32m[install-termux:OK]\033[0m %s\n' "$*" >&2
}

# ── Environment detection ──────────────────────────────────────────

# Detect whether we are running inside Termux.
#
# Termux sets `$PREFIX` to its installation root and that root contains
# a `termux` directory. We check both — the env var alone can be
# spoofed by a hostile shell, but the directory check requires actual
# Termux installation.
is_termux_environment() {
  if [[ -z "${PREFIX:-}" ]]; then
    return 1
  fi
  if [[ "${PREFIX}" != "${TERMUX_PREFIX_MARKER}" ]]; then
    return 1
  fi
  if [[ ! -d "${PREFIX}/lib/termux" && ! -d "${PREFIX}/etc/termux" ]]; then
    return 1
  fi
  return 0
}

# Sanity check before installing anything. If we're not on Termux we
# bail out with a clear message — silently running `pkg install`
# elsewhere would either fail loudly (no `pkg` command) or wreck a
# regular Linux box.
require_termux() {
  if ! is_termux_environment; then
    log_error "This installer is for Termux on Android only."
    log_error "Detected environment: PREFIX='${PREFIX:-<unset>}'"
    log_error ""
    log_error "If you're on macOS or Linux, run:"
    log_error "    npm install -g wotann"
    log_error ""
    log_error "If you ARE on Android: install Termux from F-Droid first."
    log_error "    https://f-droid.org/en/packages/com.termux/"
    log_error ""
    log_error "(The Play Store version of Termux is abandoned and ships"
    log_error " a Node 12 base — it WILL break WOTANN.)"
    exit 1
  fi
  log_info "Termux environment confirmed at ${PREFIX}"
}

# ── Package installation ───────────────────────────────────────────

# Run `pkg update && pkg upgrade -y` to make sure the package index
# and existing packages are current. We do not skip this — Termux's
# package mirrors rotate, and stale indexes are the #1 cause of
# install failures.
update_termux_packages() {
  log_info "Updating Termux package index (pkg update)..."
  if ! pkg update -y; then
    log_error "pkg update failed. Common causes:"
    log_error "  - No network connectivity"
    log_error "  - Mirror outage (try: termux-change-repo)"
    log_error "  - Out of storage"
    exit 1
  fi
  log_info "Upgrading existing packages (pkg upgrade)..."
  if ! pkg upgrade -y; then
    log_warn "pkg upgrade reported errors. Continuing — the install"
    log_warn "may still succeed if no required package is broken."
  fi
}

# Install the required system packages. We intentionally do NOT
# install better-sqlite3 here — it's expected to fail on Termux ARM64
# and we let WOTANN's storage-adapter fall through to node-sqlite3.
install_required_packages() {
  log_info "Installing required Termux packages..."
  local pkg_name
  for pkg_name in "${REQUIRED_TERMUX_PACKAGES[@]}"; do
    log_info "  - Installing ${pkg_name}"
    if ! pkg install -y "${pkg_name}"; then
      log_error "Failed to install '${pkg_name}'."
      log_error "Try: pkg install ${pkg_name}"
      log_error "If that fails, check 'pkg search ${pkg_name}' to see"
      log_error "whether the package was renamed in your Termux release."
      exit 1
    fi
  done
  log_success "Required packages installed."
}

# Install the optional packages. Failure is non-fatal — WOTANN will
# still work without termux-api / termux-tools, just with degraded
# capability (no clipboard, no TTS, etc.).
install_optional_packages() {
  log_info "Installing optional Termux packages (failures are OK)..."
  local pkg_name
  for pkg_name in "${OPTIONAL_TERMUX_PACKAGES[@]}"; do
    log_info "  - Trying optional package: ${pkg_name}"
    if ! pkg install -y "${pkg_name}"; then
      log_warn "Skipping ${pkg_name} (install failed). WOTANN will run"
      log_warn "without the capability this package provides."
    fi
  done
}

# ── WOTANN installation ────────────────────────────────────────────

# Install WOTANN itself via npm. This is where better-sqlite3 might
# fail to compile — that's expected and the storage adapter handles
# the fallback.
install_wotann_package() {
  log_info "Installing WOTANN via npm..."
  log_info "(This may take a few minutes; better-sqlite3 will probably"
  log_info " fail to compile on Termux ARM64 — that's expected and"
  log_info " the storage-adapter will fall back to node-sqlite3.)"

  if ! npm install -g wotann; then
    log_warn "npm install -g wotann reported errors."
    log_warn "Verifying that the wotann binary is on PATH..."
  fi

  if ! command -v wotann >/dev/null 2>&1; then
    log_error "wotann is not on PATH after installation."
    log_error "Try: npm config get prefix"
    log_error "and add \$prefix/bin to your PATH."
    exit 1
  fi

  log_success "WOTANN installed: $(command -v wotann)"
}

# Install the optional sqlite3 npm package as the Termux storage
# fallback. Done AFTER `npm install -g wotann` so the user knows the
# main install succeeded even if sqlite3 has issues.
install_storage_fallback() {
  log_info "Installing the Termux storage fallback (sqlite3 npm package)..."
  log_info "(This is the async sqlite3 driver, distinct from the"
  log_info " 'sqlite' system package installed earlier.)"

  if ! npm install -g sqlite3; then
    log_warn "sqlite3 npm install failed. WOTANN will run with the"
    log_warn "JSON-fallback storage backend, which has reduced"
    log_warn "capability. To retry: 'npm install -g sqlite3'."
    return 0
  fi
  log_success "sqlite3 storage fallback installed."
}

# ── Post-install hints ─────────────────────────────────────────────

# Print recommendations for long-running sessions. The OEM wake-lock
# whitelist is the single biggest gotcha for Android users, so we
# call it out explicitly with the exact phone brands that need it.
print_wake_lock_hint() {
  cat >&2 <<'EOF'

──── Long-Running Sessions ────

Android aggressively suspends background processes. For autonomous
agent runs that may last hours, you SHOULD acquire a wake-lock:

    termux-wake-lock     # before starting `wotann engine`
    termux-wake-unlock   # after the run is done

OEM-specific gotcha: Xiaomi, Oppo, Vivo, and Huawei phones run
EXTRA-aggressive battery managers that ignore standard wake-locks.
You also need to:

  1. Open Settings → Apps → Termux → Battery
  2. Disable battery optimization
  3. Allow background activity
  4. (Xiaomi / MIUI) Enable "auto-start" in Security app
  5. (Oppo / ColorOS) Disable "deep sleep" in Power Manager

Without the OEM whitelist, your agent will be killed within minutes
of locking the screen, regardless of wake-lock state.

EOF
}

# Document the Termux:API integration.
print_termux_api_hint() {
  cat >&2 <<'EOF'

──── Termux:API Integration ────

If you installed `termux-api`, you also need the Termux:API APK from
F-Droid (separate from the Termux app itself):

    https://f-droid.org/en/packages/com.termux.api/

With both installed, WOTANN can:

  - Read/write the system clipboard (termux-clipboard-{get,set})
  - Show toast notifications (termux-notification)
  - Read battery state (termux-battery-status)
  - Speak text (termux-tts-speak)         — used by `wotann voice`
  - Vibrate the phone (termux-vibrate)
  - Trigger camera (termux-camera-photo)  — for visual context
  - Read SMS (termux-sms-list)            — opt-in only

WOTANN auto-detects which Termux:API commands are available and
gracefully degrades capabilities that need missing commands.

EOF
}

# Document the storage-adapter situation so the user understands
# WHY the install took this many steps.
print_storage_explanation() {
  cat >&2 <<'EOF'

──── Storage Backends ────

WOTANN auto-selects the best SQLite driver at startup:

  1. better-sqlite3   — fastest, native, but won't build on Termux
                        ARM64 (gyp/python toolchain mismatch).
  2. node-sqlite3     — async fallback. Currently honest-stubbed
                        until the synchronous-to-async memory store
                        port lands (V9 FT.3.1.4).
  3. sql.js           — pure-JS WASM. Future tier.
  4. JSON file        — last-resort persistent fallback.

Run `wotann doctor` to see which backend was selected and why.

EOF
}

# ── Main flow ──────────────────────────────────────────────────────

main() {
  log_info "WOTANN Termux installer v0.5.0-rc.1"
  log_info "(See docs/ANDROID_TERMUX.md for full documentation.)"
  log_info ""

  require_termux
  update_termux_packages
  install_required_packages
  install_optional_packages
  install_wotann_package
  install_storage_fallback

  print_wake_lock_hint
  print_termux_api_hint
  print_storage_explanation

  log_success "Install complete. Try: wotann start"
}

main "$@"
