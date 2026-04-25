# WOTANN on Android — Tier 1: Termux CLI

**Status**: Shipping (V9 FT.3.1)
**Effort**: 2 days (this is the simplest of the three Android tiers)
**Audience**: Power users who want a real terminal-driven WOTANN
experience on their phone.

This document is the user-facing guide to running WOTANN inside
Termux. For the implementation plan of the more ambitious tiers
(Tauri Mobile and a native Kotlin app) see `ANDROID_TAURI.md` and
`ANDROID_NATIVE.md`.

## Why Termux first

Termux gives us the same WOTANN binary that runs on macOS and Linux
desktops, just on ARM Android. No new code paths, no UI redesign —
the entire CLI/TUI experience works unchanged. This is the cheapest
way to get WOTANN onto Android phones, and it gives us a baseline
to measure the more polished tiers against.

The downsides are real:

- **No widgets, no QS Tile, no glassy Material 3 UI.** It's a terminal.
- **No background-safe daemon.** Android will kill `wotann engine`
  unless the user holds a wake-lock and whitelists Termux from
  battery optimization (see "OEM whitelist" below).
- **`better-sqlite3` won't build.** The Termux Node ships without the
  gyp toolchain pinned to bionic libc. We sidestep this with a
  storage-adapter that falls through to `sqlite3` (the async driver).

## Install (one-liner)

```bash
# 1. Install F-Droid Termux (NOT the Play Store version)
#    https://f-droid.org/en/packages/com.termux/
# 2. Open Termux on your phone, then run:
curl -fsSL https://wotann.com/install-termux.sh | bash
```

The installer is at `scripts/install-termux.sh` in the repo. It:

1. Detects Termux (refuses to run elsewhere)
2. Runs `pkg update && pkg upgrade -y`
3. Installs `nodejs-lts`, `git`, `sqlite`, `openssl`
4. Installs the optional `termux-api` and `termux-tools`
5. Runs `npm install -g wotann`
6. Installs the Termux storage fallback (`npm install -g sqlite3`)
7. Prints wake-lock and Termux:API hints

## Critical: F-Droid Termux only

The Play Store version of Termux is **abandoned** and ships a Node
12 base. WOTANN needs Node 20+ and will fail to start on Play Store
Termux with cryptic syntax errors.

**Always install Termux from F-Droid:**
[https://f-droid.org/en/packages/com.termux/](https://f-droid.org/en/packages/com.termux/)

If you previously installed Play Store Termux, uninstall it first —
the data directories conflict.

## Storage backend selection

WOTANN's storage layer is platform-agnostic via a `StorageAdapter`
interface (see `src/storage/storage-adapter.ts`). At startup,
`selectStorageAdapter()` probes each backend in priority order:

| Tier | Backend         | Termux behaviour |
|------|-----------------|------------------|
| 1    | better-sqlite3  | **Fails** (no toolchain). The probe catches the import error and falls through. |
| 2    | node-sqlite3    | Driver loads, but is honest-stubbed until the async memory store port lands (V9 FT.3.1.4). |
| 3    | sql.js          | Future scaffold (not yet implemented). |
| 4    | JSON fallback   | Future scaffold (not yet implemented). |

Run `wotann doctor` after installation to see which backend was
selected and why each rejected tier was rejected. Until the async
memory store port lands, you may see WOTANN report "no storage
backend available" — that's expected and is being fixed in
FT.3.1.4.

## OEM wake-lock whitelist (critical)

Android's stock battery optimization is aggressive. Xiaomi, Oppo,
Vivo, and Huawei phones are *extra* aggressive — they ignore the
standard wake-lock API entirely.

To run `wotann engine` for more than a few minutes after locking the
screen, you MUST do all of these:

### Standard Android (Pixel, Samsung, etc.)
1. Settings → Apps → Termux → Battery
2. Disable battery optimization
3. Allow background activity
4. In Termux, run `termux-wake-lock` before starting the engine

### Xiaomi / MIUI
1. All of the above, plus:
2. Security app → Permissions → Auto-start → Enable for Termux
3. Security app → Battery → Choose apps → Termux → No restrictions
4. Settings → Apps → Manage apps → Termux → Other permissions →
   Display pop-up windows while running in background → Allow

### Oppo / ColorOS
1. All of the standard steps, plus:
2. Settings → Battery → Power Manager → Termux → Allow background
   activity / Disable deep sleep / Disable smart background freeze

### Vivo / FunTouch
1. All of the standard steps, plus:
2. iManager → App Manager → Auto-start manager → Enable Termux
3. Settings → Battery → Background power consumption → Allow Termux

### Huawei / EMUI / HarmonyOS
1. All of the standard steps, plus:
2. Phone Manager → Protected apps → Enable Termux
3. Settings → Apps → Termux → Battery → Launch → Manage manually,
   enable all three (auto-launch / secondary launch / run in
   background)

If you skip these steps, your agent will be killed within minutes of
locking the screen, regardless of `termux-wake-lock` state. There
is no Android API that can override OEM battery optimization without
user action — this is an OEM lock-in pattern that affects every app.

## Termux:API capabilities

If you installed `termux-api` and the matching APK from F-Droid,
WOTANN auto-detects and uses these capabilities:

| Termux:API command          | WOTANN capability        |
|-----------------------------|---------------------------|
| `termux-clipboard-get/set`  | Clipboard sync             |
| `termux-notification`       | Toast / status notifications |
| `termux-battery-status`     | Cost-aware power management |
| `termux-tts-speak`          | `wotann voice` TTS output  |
| `termux-vibrate`            | Haptic feedback            |
| `termux-camera-photo`       | Visual context for vision-capable models |
| `termux-sms-list`           | SMS context (opt-in only)  |
| `termux-share`              | Share-target intent        |

Missing commands degrade gracefully — WOTANN logs `capability X is
unavailable` and skips the corresponding feature. No silent failure.

## Known gotchas

### 1. `better-sqlite3` build error during `npm install`
**Expected.** The storage adapter handles this. The error log will
look like:

```
gyp ERR! find Python
gyp ERR! configure error
node-gyp ERR! Failed to build
```

Don't worry — `npm install` continues, and at runtime the adapter
falls through to the next tier.

### 2. `Permission denied` when accessing storage
Termux can't read `/sdcard/` until you run `termux-setup-storage`
once. The installer prints a hint about this.

### 3. Engine survives `termux-wake-lock` but dies after screen-off
Almost certainly the OEM battery whitelist (see above). Verify by
running `wotann engine --foreground` and watching the logs as you
lock and unlock the screen — if the process exits within 30s of
screen-off without a kill signal in the journal, it's the OEM
killer.

### 4. `npm install -g wotann` reports global install failed
Check `npm config get prefix`. If it's pointing inside the Termux
prefix you'll need to add `$prefix/bin` to your `PATH`. Otherwise,
some Termux installs default to `/data/data/com.termux/files/home/.npm-global`
which isn't on PATH out of the box.

```bash
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 5. SSH keys need to live in Termux home, not /sdcard
Termux symlinks across the Android storage boundary lose
permissions. Generate keys directly in `~/.ssh/`.

## Comparison to other tiers

|                          | Termux (this tier) | Tauri Mobile | Native Kotlin |
|--------------------------|--------------------|--------------|---------------|
| Effort                   | 2 days             | 4-6 weeks    | 12 weeks      |
| App-store distribution   | No (F-Droid Termux) | Yes (Play)   | Yes (Play)     |
| Background reliability   | Poor (OEM-dep)     | Good         | Excellent     |
| Native widgets / QS Tile | No                 | Limited      | Full          |
| Glassy M3 UI             | No (terminal)      | Yes (web)    | Yes (native)  |
| Same code as desktop     | Yes (full)         | Mostly       | No (rewrite)  |
| Power-user friendly      | Yes                | Yes          | Yes           |
| Casual-user friendly     | No                 | Yes          | Yes           |

Termux exists for power users who want shell access. Tauri and
native exist for everyone else.

## Future work

- **V9 FT.3.1.4** — port `src/memory/store.ts` from synchronous
  better-sqlite3 to a Promise-based API so the node-sqlite3 backend
  can satisfy the contract.
- **V9 FT.3.1.5** — add `wotann doctor termux` subcommand that
  audits the OEM battery whitelist programmatically (where possible
  via `dumpsys deviceidle`).
- **V9 FT.3.1.6** — provide a Termux-native config init wizard that
  picks sensible defaults (smaller context windows, more aggressive
  cost caps) compared to desktop.

See `ANDROID_TAURI.md` for the implementation plan of the next
tier, and `ANDROID_NATIVE.md` for the most ambitious one.
