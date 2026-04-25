# Tauri Mobile Android — Developer Setup

> **V9 FT.3.2** — One-time toolchain setup for building WOTANN's Android AAB.
> Required before `npx tauri android init` will succeed inside `desktop-app/`.

## Why this is documentation only

`tauri android init` generates ~200 files of Gradle / Kotlin / project scaffolding under
`desktop-app/src-tauri/gen/android/`. Faking those artifacts in-repo is worse than absent —
they would drift from the toolchain version and silently break real builds. Instead we ship:

1. The `bundle.android` block in `desktop-app/src-tauri/tauri.conf.json` (committed)
2. This setup checklist for the developer (committed)
3. The expectation that the developer runs `npx tauri android init` once locally
   and commits the resulting `gen/android/` tree

## Prerequisites checklist

### 1. Install Java 17+ JDK

Tauri Mobile's Gradle build requires JDK 17 or later. macOS (recommended via Homebrew):

```bash
brew install --cask zulu@17
java -version  # expect: openjdk version "17.x.x"
```

### 2. Install Android Studio + SDK + NDK

Download Android Studio (https://developer.android.com/studio), then via
**Settings -> Languages & Frameworks -> Android SDK**:

- **SDK Platforms tab**: check `Android 14 (API 34)` (required) and `Android 7 (API 24)`
  (matches our `minSdkVersion`)
- **SDK Tools tab**: check `Android SDK Build-Tools`, `NDK (Side by side)` r25c+,
  `Android SDK Command-line Tools (latest)`, `Android SDK Platform-Tools`

### 3. Set environment variables (zsh / bash)

Add to `~/.zshrc` (or `~/.bashrc`):

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"             # macOS default
export NDK_HOME="$ANDROID_HOME/ndk/$(ls -1 $ANDROID_HOME/ndk | tail -1)"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"
```

Reload: `source ~/.zshrc`. Verify with `echo $ANDROID_HOME` and `echo $NDK_HOME`.

### 4. Initialize the Android target (one-time)

```bash
cd desktop-app
npx tauri android init
```

This creates `src-tauri/gen/android/` with Gradle wrapper, Kotlin entry, and resource folders.
Commit the entire generated tree.

### 5. Daily dev cycle (emulator)

```bash
cd desktop-app
npx tauri android dev          # starts an emulator session with hot reload
```

Requires at least one Android Virtual Device created via Android Studio's **Device Manager**.

### 6. Release artifact for Play Store

```bash
cd desktop-app
npx tauri android build --aab   # produces .aab under gen/android/app/build/outputs/bundle/
npx tauri android build --apk   # produces signed APK for sideloading testing
```

Signing keys come from the GitHub secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEY_ALIAS`,
and `ANDROID_KEYSTORE_PASSWORD` — see `docs/internal/ANDROID_SIDELOADING_COMPLIANCE.md`.

## Expected `gen/android/` files (after init)

After `tauri android init`, `desktop-app/src-tauri/gen/android/` will contain (high-level):

- `build.gradle.kts`, `settings.gradle.kts` — root Gradle config
- `gradle/wrapper/gradle-wrapper.{jar,properties}` — Gradle wrapper
- `gradlew`, `gradlew.bat` — wrapper launchers
- `app/build.gradle.kts`, `app/proguard-rules.pro` — app module
- `app/src/main/AndroidManifest.xml` — manifest (permissions / activity)
- `app/src/main/java/com/wotann/desktop/MainActivity.kt` — Tauri entry
- `app/src/main/res/` — drawable, mipmap (icons), strings, values, xml
- `buildSrc/` — Gradle build logic (Kotlin)
- `tauri.properties` — Tauri-managed Android config (versionCode tracking)

These files MUST be committed to the repo so CI can build without re-running init.

## Configuration knobs (already in `tauri.conf.json`)

```json
"bundle": {
  "android": {
    "minSdkVersion": 24,
    "autoIncrementVersionCode": false
  }
}
```

- `minSdkVersion: 24` -> Android 7.0+ (Tauri default; covers 96%+ of active devices)
- `autoIncrementVersionCode: false` -> derive `versionCode` from semver `version`. Flip
  to `true` for Play Store production releases (and remove `tauri.properties` from the
  generated `.gitignore` so the counter is committed).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Android SDK not found at ~/Library/Android/sdk` | Open Android Studio once and let it install the SDK |
| `NDK version not detected` | Install NDK r25c+ via SDK Manager, re-export `NDK_HOME` |
| `Could not determine Java version` | Install JDK 17+, set `JAVA_HOME` |
| Gradle daemon hangs | Run `cd desktop-app/src-tauri/gen/android && ./gradlew --stop` |
| `tauri android dev` fails with "no devices" | Start an emulator from Android Studio Device Manager first |
