# WOTANN on Android — Tier 2: Tauri Mobile

**Status**: Planned (V9 FT.3.2)
**Effort**: 4-6 weeks
**Audience**: Mainstream Android users who want a polished WOTANN
client without waiting 12 weeks for the native build.

This document is the *implementation plan* for the Tauri Mobile
tier. Tier 1 (Termux CLI) is shipping today — see
`ANDROID_TERMUX.md`. Tier 3 (native Kotlin) is planned in
`ANDROID_NATIVE.md`.

## Why Tauri

The desktop client at `desktop-app/` is already a Tauri 2 app
(see `desktop-app/src-tauri/`). Tauri 2 added Android support in
late 2024. If we can get the existing desktop UI to compile cleanly
into an Android APK / AAB, we get Android in 4-6 weeks instead of
12, with the same React + TypeScript + Tailwind codebase.

The risk is the WebView. Android WebView has long-standing IME
(input method editor) bugs that affect text input on certain OEMs,
particularly Samsung. If those bugs block our chat input UX, we
pivot to the native Kotlin tier — the pivot decision is documented
under "Pivot decision criteria" below.

## High-level plan (6 weeks)

```
Week 1: Bake-off
  - Does `tauri android init` work cleanly on the existing desktop-app?
  - Build a debug APK, install on a real device, smoke-test the chat tab
  - GO/NO-GO decision: continue or pivot to native

Week 2: Core shell
  - 4-tab NavigationSuiteScaffold (Chat / Editor / Workshop / You)
  - Chat tab end-to-end (input → bridge → response render)
  - Cold-start under 2s on a 2022-era device

Week 3: Pairing wizard
  - QR pairing (camera permission + ZXing decode)
  - Manual PIN fallback
  - NSD discovery for desktop on the same network
  - WebSocket bridge wired through Tauri's `window` API
  - BiometricPrompt for unlocking the cached pairing token
  - Android Keychain integration for the token itself

Week 4: Cost dashboard + widgets
  - Cost-preview screen mirroring the desktop one
  - 3 Glance widgets:
      - Cost widget (today / month spend)
      - Agent status widget (running / idle / error)
      - Quick-launch widget (1-tap to open Chat)
  - QS Tile (drag down → tap → opens to Workshop)
  - Share intent target (share text from any app → opens in Chat)

Week 5: Offline + Settings
  - Room-backed offline queue (commands queued when offline → drained on reconnect)
  - WorkManager-backed background sync
  - Settings screen: provider keys, cost caps, theme, voice on/off

Week 6: Polish + Play Store
  - Material 3 Expressive theming (M3 colors, dynamic color)
  - Haze glass on the bottom nav and modals
  - Internal-test track on Play Store
  - Privacy-policy + data-safety form filled out
```

## Verification commands

```bash
# Initial Android scaffold (one-time, in desktop-app/)
cd desktop-app/src-tauri
tauri android init

# Run on a connected device or emulator
tauri android dev

# Build a release AAB for Play Store
tauri android build --aab

# Build a debug APK for sideload
tauri android build --apk --debug
```

If `tauri android init` fails, common causes:

- Android SDK not installed (need `ANDROID_HOME` set)
- NDK version mismatch (Tauri 2 requires NDK 26+)
- Cargo target not installed (`rustup target add aarch64-linux-android`)

## Pivot decision criteria

We pivot from Tauri Mobile to the native Kotlin tier (FT.3.3) if:

1. **Week 1 GO/NO-GO fails:** the existing desktop-app fails to
   compile to Android in week 1 with non-trivial effort. "Non-trivial"
   = more than 3 days of dependency wrangling.

2. **WebView IME bugs block text input:** if Samsung or Xiaomi WebView
   loses keystrokes during the chat input UX in week 2. Mitigation:
   try the alternative WebView (CrosWalk) before pivoting, but that
   adds 50MB to the APK and is a hack.

3. **Cold-start slower than 4 seconds on a 2022-era mid-range device.**
   Mainstream users will not adopt a 4-second cold start, and Tauri's
   webview cold-start is bounded by Android's WebView init time —
   there's not much we can do beyond preloading.

4. **Glance widgets can't be implemented cleanly.** Glance is
   Compose-based; we'd need a Kotlin shim for the widget itself even
   in the Tauri tier. If the shim grows beyond ~500 LOC of duplicated
   logic, the cost-benefit favours pivoting.

5. **Background sync (WorkManager) is unreliable through Tauri.**
   Tauri's plugin model has a bridge between JS and native, but
   WorkManager runs in a different process — message passing across
   process boundaries during low-memory conditions has historically
   been flaky.

If we pivot, **we keep the Termux tier** as the power-user fallback.
We do not abandon Termux just because we're going native.

## Architecture sketch

```
┌──────────────────────────────────────────────────────┐
│ Android APK (Tauri 2)                                │
├──────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────┐   │
│ │ Tauri WebView                                  │   │
│ │ ┌─────────────────────────────────────────┐    │   │
│ │ │ React + TypeScript (shared with desktop)│    │   │
│ │ │ ┌────────┐ ┌────────┐ ┌─────────┐ ┌───┐ │    │   │
│ │ │ │ Chat   │ │ Editor │ │Workshop │ │You│ │    │   │
│ │ │ └────────┘ └────────┘ └─────────┘ └───┘ │    │   │
│ │ └─────────────────────────────────────────┘    │   │
│ └────────────────────────────────────────────────┘   │
│ ┌────────────────────────────────────────────────┐   │
│ │ Tauri Bridge (Rust)                            │   │
│ │ - WebSocket to desktop                          │   │
│ │ - Keychain (via tauri-plugin-keychain)          │   │
│ │ - BiometricPrompt (via tauri-plugin-biometric)  │   │
│ │ - NSD discovery (via tauri-plugin-mdns)         │   │
│ │ - Notifications (via tauri-plugin-notification) │   │
│ └────────────────────────────────────────────────┘   │
│ ┌────────────────────────────────────────────────┐   │
│ │ Native Kotlin shims (minimal)                   │   │
│ │ - Glance widgets (Cost, Status, QuickLaunch)    │   │
│ │ - QS Tile                                        │   │
│ │ - Share intent receiver                          │   │
│ │ - Room-backed offline queue + WorkManager        │   │
│ └────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
                       │
                       │ WebSocket over LAN / Tailscale / Cloudflare Tunnel
                       ▼
┌──────────────────────────────────────────────────────┐
│ Desktop WOTANN Engine (existing)                     │
└──────────────────────────────────────────────────────┘
```

The Kotlin shims are kept small (<500 LOC each) because Tauri has no
direct Glance / QS Tile bridge. We accept this duplication in
exchange for a 6-week schedule.

## Storage approach

The Android app does NOT carry a local SQLite database for the agent
memory store. Instead:

- **Bridge mode (default):** memory lives on the desktop. The phone is
  a thin client over WebSocket. This is the same model the iOS app
  uses today.
- **Offline queue:** the *only* on-device storage is the offline queue
  (commands typed while disconnected, drained on reconnect). This is
  Room-backed.
- **Pairing token:** stored in Android Keychain.
- **Settings cache:** Tauri's settings plugin (PreferenceManager-backed).

This means the storage-adapter from FT.3.1 is NOT used in the Tauri
tier. The adapter is only relevant for the Termux tier (where WOTANN
runs locally) and possibly for the future "offline-first" mode where
the phone can run a full agent loop without a desktop.

## Performance targets

| Metric                              | Target              |
|-------------------------------------|---------------------|
| Cold-start (Pixel 7)                | < 1.5s              |
| Cold-start (Galaxy A52)             | < 2.5s              |
| First-message latency (LAN)         | < 200ms             |
| First-message latency (Cloudflare)  | < 800ms             |
| Memory footprint (idle)             | < 200MB             |
| Memory footprint (active chat)      | < 350MB             |
| APK size (universal)                | < 30MB              |
| AAB size (per-arch)                 | < 12MB              |
| Battery (1h continuous chat)        | < 8%                |
| Battery (idle, paired, 24h)         | < 3%                |

If we miss any of these by >50% in week 4, we re-evaluate the pivot
criteria.

## Privacy / security

- **No telemetry by default.** All telemetry is opt-in via Settings.
- **Data Safety form** (Play Store) declares: location no, contacts
  no, microphone yes-for-voice, camera yes-for-QR, files
  yes-for-shared-docs.
- **Pairing token** stored in Android Keychain, ECDH-derived per
  session.
- **WebSocket TLS only** — no plaintext fallback even on LAN. Use
  self-signed cert with cert pinning.
- **Biometric unlock** required to access pairing token.

## Open questions

1. Does Tauri 2's `tauri android dev` HMR work over USB, over
   wireless ADB, or both?
2. Can we share the same React Router as desktop, or do we need a
   mobile-specific router that integrates with Android's back-stack?
3. What's the cleanest way to expose the WebSocket connection to the
   Glance widget process? (Workmanager + Shared Preferences?
   Database write+read? Bound service?)
4. Does Tauri's biometric plugin support the new Android 14
   `BIOMETRIC_STRONG` requirement, or do we need a JNI shim?
5. Can we enable predictive back-gesture (Android 14+) without losing
   compatibility with Android 8?

These get answered in Week 1 during the bake-off.

## See also

- `ANDROID_TERMUX.md` — Tier 1 (shipping)
- `ANDROID_NATIVE.md` — Tier 3 (12-week plan)
- `desktop-app/src-tauri/tauri.conf.json` — current Tauri config
  (will need an `android` section added)
