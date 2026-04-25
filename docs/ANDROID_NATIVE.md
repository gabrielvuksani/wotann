# WOTANN on Android — Tier 3: Native Kotlin + Jetpack Compose

**Status**: Scaffolded (V9 FT.3.3) — entry-points exist, full impl
is a 12-week effort tracked separately.
**Effort**: 12 weeks
**Audience**: All Android users — power, mainstream, and pro.

This document is the *implementation plan* for the most ambitious
Android tier: a fully native Kotlin + Compose app. Tier 1 (Termux)
ships today. Tier 2 (Tauri Mobile) is a 4-6 week intermediate plan.
This is the long game.

## Why native eventually

Even if Tier 2 (Tauri) succeeds, certain features are easier (or
*only* possible) with a native build:

- **Material 3 Expressive motion** — the Compose-only motion system
  isn't fully exposed through web rendering. The new "spring-based"
  navigation transitions, predictive back gesture, and shared-element
  transitions render flat in a WebView.
- **Glance widgets** — Glance is Compose-on-the-homescreen. There's
  no equivalent in WebView, so any tier that runs in WebView still
  needs Kotlin shims for widgets. Going fully native eliminates the
  cross-process bridge.
- **Quick Settings tile** — `TileService` is Java/Kotlin only.
- **Foreground service for sustained agent runs** — works in any
  tier, but Tier 2's bridge between WebView and the Kotlin service
  has cross-process latency.
- **Health Connect** — Kotlin-only API.
- **NFC tap-to-pair** — Kotlin-only API.
- **Predictive back-gesture** — Compose 1.7+ feature, not exposed
  through Tauri.
- **Live Updates (Android 14+)** — Notification-as-live-activity
  requires the new `ProgressStyle` API, native only.
- **Battery/performance** — native Compose has lower memory and
  faster cold-start than WebView-based UI.

## What's in this scaffold

The `android/` directory tree at the repo root contains:

```
android/
├── settings.gradle.kts        # Plugin management + module include
├── build.gradle.kts           # Plugin versions
└── app/
    ├── build.gradle.kts       # Compose / Hilt / Room / Retrofit deps
    ├── proguard-rules.pro     # R8 keep rules
    └── src/main/
        ├── AndroidManifest.xml
        ├── res/
        │   ├── values/strings.xml
        │   ├── values/themes.xml
        │   └── xml/
        │       ├── data_extraction_rules.xml
        │       ├── backup_rules.xml
        │       ├── widget_cost_info.xml
        │       ├── widget_agent_status_info.xml
        │       └── widget_quicklaunch_info.xml
        └── kotlin/com/wotann/android/
            ├── WotannApplication.kt    @HiltAndroidApp
            ├── MainActivity.kt          ComponentActivity + Compose
            ├── ui/
            │   ├── theme/{Theme.kt, Color.kt, Type.kt}
            │   ├── shell/MainShell.kt   4-tab NavigationSuiteScaffold
            │   ├── chat/ChatScreen.kt
            │   ├── editor/EditorScreen.kt
            │   ├── workshop/WorkshopScreen.kt
            │   ├── settings/SettingsScreen.kt
            │   ├── pairing/PairingScreen.kt
            │   ├── cost/CostScreen.kt
            │   └── components/StatusBar.kt
            ├── domain/
            │   ├── agents/AgentRepository.kt
            │   ├── providers/ProviderLadder.kt
            │   ├── conversations/ConversationRepository.kt
            │   └── offline/OfflineQueue.kt
            ├── data/
            │   ├── db/WotannDatabase.kt
            │   ├── network/RpcClient.kt
            │   ├── security/{KeychainManager.kt, ECDHManager.kt}
            │   └── discovery/NsdDiscovery.kt
            ├── services/
            │   ├── AgentForegroundService.kt
            │   ├── LiveUpdateManager.kt
            │   ├── VoiceService.kt
            │   ├── HealthConnectService.kt
            │   └── NfcService.kt
            ├── widgets/
            │   ├── CostWidget.kt
            │   ├── AgentStatusWidget.kt
            │   └── QuickLaunchWidget.kt
            ├── tile/WotannTileService.kt
            └── di/AppModule.kt
```

Every Kotlin file is annotated with `WHAT / WHY / WHERE / HOW` and
contains `TODO (V9 FT.3.3 implementation phase)` markers documenting
exactly what the 12-week build needs to fill in.

The scaffold compiles in concept (Kotlin syntax is valid) but
**does not actually compile against Gradle** because:

1. There's no `gradle/wrapper/` checked in
2. There's no `mipmap/` icon assets
3. `glance_default_loading_layout` is a Glance-provided resource we
   reference but don't ship

These are deliberate omissions — supplying the gradle wrapper, app
icons, and asset packs is the first checklist item of the 12-week
implementation phase.

## 12-week implementation roadmap

### Phase 1 — Build & boot (Weeks 1-2)
- [ ] Add gradle wrapper (`gradle/wrapper/gradle-wrapper.jar`)
- [ ] Generate app icons via Android Studio's Asset Studio
- [ ] Run `./gradlew :app:build` clean
- [ ] Boot the app on a Pixel emulator: lands on MainShell with
      placeholder text in each tab
- [ ] Wire up CI: GitHub Actions workflow that runs
      `./gradlew :app:assembleDebug :app:lint :app:testDebug`
- [ ] Resolve any deprecation warnings

### Phase 2 — Pairing & Bridge (Weeks 3-4)
- [ ] Real `OkHttpRpcClient` against the desktop bridge
- [ ] Real `NsdDiscovery` over `NsdManager`
- [ ] Real `ECDHManager` (X25519 / P-256)
- [ ] Real `KeychainManager` (EncryptedSharedPreferences)
- [ ] PairingScreen: NSD list → QR scanner → handshake → biometric
- [ ] Reconnect logic with exponential backoff
- [ ] Cert pinning for the desktop's self-signed cert

### Phase 3 — Chat (Weeks 5-6)
- [ ] `ChatViewModel` + `ChatUiState`
- [ ] LazyColumn message rendering
- [ ] Markdown via dev.snipme:highlights
- [ ] Code-block syntax highlighting
- [ ] Streaming token rendering with smooth animation
- [ ] Long-press → copy / regenerate / share
- [ ] Image attachment (camera + gallery)
- [ ] Tool-call card rendering (collapsed by default, expandable)

### Phase 4 — Workshop & Editor (Weeks 7-8)
- [ ] Workshop list of in-flight tasks (Flow-driven)
- [ ] Quick-launch FAB → start new task
- [ ] File browser inside Workshop
- [ ] Editor surface: Monaco WebView OR native CodeView (decision
      gated on Samsung WebView IME testing)
- [ ] LSP diagnostics overlay
- [ ] Agent diff rendering

### Phase 5 — Cost & Widgets (Weeks 9-10)
- [ ] CostScreen with Compose Canvas line chart
- [ ] Per-provider breakdown
- [ ] Cost cap dialog
- [ ] CostWidget Glance impl
- [ ] AgentStatusWidget Glance impl
- [ ] QuickLaunchWidget Glance impl
- [ ] WotannTileService impl

### Phase 6 — Voice & Live (Weeks 11)
- [ ] VoiceService impl (AudioRecord + AudioTrack)
- [ ] On-device wake-word detection
- [ ] STT/TTS bridge to desktop
- [ ] Bluetooth headset routing
- [ ] LiveUpdateManager → Live Updates on Android 14+
- [ ] Foreground service notifications

### Phase 7 — Polish & Play Store (Week 12)
- [ ] Material 3 Expressive theming pass
- [ ] Haze glass effect on bottom nav + modals
- [ ] Predictive back-gesture
- [ ] Adaptive layouts for foldables / tablets
- [ ] Internal-test track on Play Store
- [ ] Data-safety form completion
- [ ] Privacy policy URL
- [ ] Localisation pass (en-US, es, de, fr — match desktop)

## Why this order

1. **Build & boot first** — without a clean Gradle build, every
   downstream task is speculative. Get the smoke test green.
2. **Pairing & bridge second** — the entire app depends on this. A
   working chat depends on a working bridge.
3. **Chat third** — the most-used surface. Get the highest-leverage
   feature done early.
4. **Workshop & Editor fourth** — second most-used. Editor decision
   (Monaco vs native) gates on Samsung WebView testing.
5. **Cost & widgets fifth** — the homescreen widgets are visible
   before the user opens the app, so they need cost data flowing.
6. **Voice & Live sixth** — battery-heavy, save for after the basic
   surfaces are stable.
7. **Polish & Play Store seventh** — once the app is usable, polish
   for distribution.

## Library version pins

Documented in `app/build.gradle.kts`. Summary:

| Library                              | Version      | Why this version |
|--------------------------------------|--------------|------------------|
| AGP                                  | 8.7.0        | compileSdk 36 + R8 Compose support |
| Kotlin                               | 2.0.21       | K2 compiler + Compose plugin |
| KSP                                  | 2.0.21-1.0.27 | Hilt + Room codegen |
| Compose BOM                          | 2024.10.01   | Material 3 1.3 + ui 1.7 |
| Material 3                           | 1.3.0        | NavigationSuiteScaffold stable |
| Material 3 Adaptive                  | 1.0.0        | Adaptive layouts stable |
| Hilt                                 | 2.51.1       | Kotlin 2.0 support |
| Room                                 | 2.6.1        | KSP support |
| Retrofit                             | 2.11.0       | Latest stable |
| OkHttp                               | 4.12.0       | Latest stable, supports HTTP/2 |
| Moshi                                | 1.15.1       | Latest stable, KSP codegen |
| Coroutines                           | 1.9.0        | Compose collectAsStateWithLifecycle |
| WorkManager                          | 2.9.1        | Hilt integration |
| Glance                               | 1.1.1        | Material3 + AppWidget support |
| Biometric                            | 1.2.0-alpha05 | Android 14 BIOMETRIC_STRONG |
| Security crypto                      | 1.1.0-alpha06 | StrongBox + MasterKey API |
| CameraX                              | 1.4.0        | Latest stable |
| ML Kit barcode-scanning              | 17.3.0       | Latest, no Google Play deps |
| DataStore                            | 1.1.1        | Latest stable |
| Lifecycle                            | 2.8.6        | Compose collectAsStateWithLifecycle |
| Splash screen                        | 1.0.1        | Latest stable |
| Core KTX                             | 1.13.1       | Latest stable |

These pins are all current as of 2026-04. They get refreshed every
quarter via `./gradlew dependencyUpdates`.

## Storage approach

Same as Tier 2 (Tauri):
- **Bridge mode** is the default — memory store lives on the desktop.
- **On-device storage** is for offline queue + pairing token + cached
  ladder + cached cost rollups, NOT for the agent memory store.
- **Future "phone-only" mode**: if we ever ship an offline-first build
  where the phone runs the agent loop without a desktop, THAT mode
  uses the storage-adapter from FT.3.1 — but with the JSON fallback
  rather than SQLite (Termux has SQLite; sandboxed Android apps
  technically also have it, but the V9 spec doesn't require it).

## Pivot relationship with Tier 2

If Tier 2 (Tauri) ships and works well, Tier 3 still has unique
value:

- Tier 2 = "ship to play store fast, cover 80% of users"
- Tier 3 = "the best Android client we can build, covers 100%"

Both ship. We don't pick one or the other. Tier 1 (Termux) ships
unconditionally as the power-user fallback.

If Tier 2 doesn't ship (one of the pivot criteria fires in
ANDROID_TAURI.md), Tier 3 IS the Android app.

## Handoff to the 12-week build

This scaffold deliberately leaves these as "first commit" tasks for
the implementation phase:

1. `gradle/wrapper/gradle-wrapper.jar` + `gradle/wrapper/gradle-wrapper.properties`
2. `gradlew` and `gradlew.bat` shell wrappers
3. App icon assets (`mipmap-mdpi/ic_launcher.png` etc., 5 densities)
4. Tile drawable (`drawable/ic_tile_wotann.xml`)
5. The actual Glance widget bodies (Compose for Glance lives in the
   `Content()` overrides — they're empty stubs today)
6. Per-screen ViewModels + UiState classes
7. Concrete `OkHttpRpcClient`, `RoomConversationRepository`, etc.
8. Real Room entities + DAOs (database is empty schema today)
9. Localisable strings beyond the few in `values/strings.xml`
10. ProGuard configuration for any final third-party dep
11. `.editorconfig` for Kotlin formatting
12. Android lint baseline file (`app/lint-baseline.xml`)

Each of these is a discrete checklist item — the 12-week build can
parallelise across multiple engineers because the scaffold defines
the file ownership boundaries already.

## See also

- `ANDROID_TERMUX.md` — Tier 1 (shipping)
- `ANDROID_TAURI.md` — Tier 2 (4-6 week plan)
- `src/storage/` — storage adapter scaffold from FT.3.1 (relevant
  if/when phone-only mode lands)
