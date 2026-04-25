/*
 * WOTANN Android root build.gradle.kts — V9 FT.3.3 scaffold.
 *
 * WHAT: Root Gradle build script. Declares the plugins used by the
 *   `:app` module (without applying them at the root level).
 *
 * WHY: With AGP 8+ the recommended pattern is "declare at root, apply
 *   in modules". This keeps dependency resolution centralised while
 *   letting modules opt in to plugins selectively.
 *
 * WHERE: Sits at android/build.gradle.kts. Read by Gradle after
 *   settings.gradle.kts.
 *
 * HOW: Plugin versions are declared once here. The `apply false`
 *   keyword tells Gradle "load this plugin's classpath but don't
 *   actually apply it at the root level — modules will apply".
 *
 * Version pin rationale:
 * - AGP 8.7+ — required for compileSdk 36, predictive back-gesture,
 *   and the new R8 mode that handles Compose 1.7+ correctly.
 * - Kotlin 2.0+ — required for the new K2 compiler that Compose 1.7
 *   targets.
 * - KSP 2.0+ — Hilt and Room annotation processors run via KSP, not
 *   KAPT (faster, no shading issues).
 * - Compose Compiler 2.0+ — released as a Kotlin plugin (not a
 *   gradle plugin) starting with Kotlin 2.0.
 * - Hilt 2.51+ — first version that supports Kotlin 2.0.
 * - Room 2.6+ — adds KSP support without the workarounds 2.5 needed.
 */

plugins {
    id("com.android.application") version "8.7.0" apply false
    id("com.android.library") version "8.7.0" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    id("com.google.devtools.ksp") version "2.0.21-1.0.27" apply false
    id("com.google.dagger.hilt.android") version "2.51.1" apply false
}

// Version-clean task so CI can wipe build caches before a release.
tasks.register("clean", Delete::class) {
    delete(rootProject.layout.buildDirectory)
}
