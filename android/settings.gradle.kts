/*
 * WOTANN Android settings.gradle.kts — V9 FT.3.3 scaffold.
 *
 * WHAT: Top-level Gradle settings for the WOTANN Android app. Declares
 *   the plugin management repositories and includes the `:app` module.
 *
 * WHY: §FT.3.3 of the V9 spec ships a 12-week native Android build.
 *   Step zero of any 12-week build is a clean Gradle settings file
 *   with explicit version-catalog repositories (Google + Maven Central
 *   + Gradle Plugin Portal) — we do this once so future modules drop
 *   in without reconfiguration.
 *
 * WHERE: Sits at android/settings.gradle.kts. Gradle reads this file
 *   first when `./gradlew` runs in this directory.
 *
 * HOW: We use the modern declarative `pluginManagement {}` + `dependencyResolutionManagement {}`
 *   blocks instead of the old root-build.gradle.kts plugin block. This
 *   matches AGP 8.7+ recommendations and works with Gradle 8.10+.
 *
 * Build tooling versions are declared inline rather than in a version
 * catalog because this is a one-module scaffold; once the second
 * Android module lands, migrate to libs.versions.toml.
 */

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Compose snapshots — needed for Material 3 Expressive and
        // Haze (glass) experimental APIs ahead of stable.
        maven { url = uri("https://androidx.dev/storage/compose-compiler/repository/") }
    }
}

rootProject.name = "wotann"

include(":app")
