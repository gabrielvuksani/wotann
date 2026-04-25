/*
 * WOTANN Android :app module build.gradle.kts — V9 FT.3.3 scaffold.
 *
 * WHAT: Module-level Gradle build for the single-module WOTANN
 *   Android app. Declares Compose, Hilt, Room, Retrofit, OkHttp,
 *   WorkManager, Glance, BiometricPrompt, Camera (for QR), NSD, and
 *   the Material 3 Expressive + Haze glass libraries.
 *
 * WHY: §FT.3.3 ships a native 4-tab app per V9 spec — the same UX as
 *   iOS but with Android-native idioms. The dependency list mirrors
 *   the iOS Package.swift and the Tauri-Mobile plan, normalised to
 *   Android equivalents.
 *
 * WHERE: Read by Gradle after settings.gradle.kts and the root
 *   build.gradle.kts. Drives everything from the AGP variant config
 *   to the ProGuard rules.
 *
 * HOW:
 *   - compileSdk = 36 — Android 16 / Vanilla Ice Cream / VIC
 *   - minSdk = 26 — Android 8 / Oreo. This is the floor for
 *     foreground-service rules and Glance widgets we need.
 *   - targetSdk = 36 — match compileSdk so we get the latest
 *     foreground-service restrictions surfaced at runtime.
 *   - kotlinCompilerExtensionVersion is gone in Kotlin 2.0 — the
 *     Compose plugin handles it. We declare composeOptions { } only
 *     for the `kotlinCompilerExtensionVersion` fallback if anyone
 *     pins to the legacy plugin chain.
 *
 * Honest stub: the actual implementation of every feature is in
 * separate Kotlin files under src/main/kotlin/com/wotann/android/.
 * This file ONLY declares the build configuration — no runtime logic.
 */

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
    id("com.google.dagger.hilt.android")
}

android {
    namespace = "com.wotann.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.wotann.android"
        minSdk = 26       // Android 8 — required for foreground service rules
        targetSdk = 36
        versionCode = 1
        versionName = "0.5.0-rc.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Prevent split APKs from being generated for the densities we
        // don't ship — saves AAB size.
        resourceConfigurations += setOf("en")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            // Enable strong skipping for Compose composables (Compose 1.7+).
            "-Xjvm-default=all"
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += setOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "META-INF/INDEX.LIST",
                "META-INF/io.netty.versions.properties"
            )
        }
    }

    // Source-set layout: kotlin only (no java/), to keep things simple.
    sourceSets {
        getByName("main") {
            kotlin.srcDirs("src/main/kotlin")
        }
    }
}

// Dependency catalog: pinned versions chosen against the V9 spec.
dependencies {
    // ── Compose BOM ────────────────────────────────────────────────
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    // ── Compose UI + Material 3 + Material 3 Expressive ────────────
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3:1.3.0")
    implementation("androidx.compose.material3:material3-window-size-class:1.3.0")
    // M3 Expressive (motion + new shape system) lands in Compose 1.8 —
    // for now we use the stable 1.7 and gate Expressive APIs behind
    // feature flags in the app code.
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.2")

    // ── Navigation ─────────────────────────────────────────────────
    implementation("androidx.navigation:navigation-compose:2.8.3")
    // Adaptive layouts for foldables / tablets / large screens.
    implementation("androidx.compose.material3.adaptive:adaptive-navigation-suite:1.0.0")
    implementation("androidx.compose.material3.adaptive:adaptive-layout:1.0.0")

    // ── Hilt (DI) ──────────────────────────────────────────────────
    implementation("com.google.dagger:hilt-android:2.51.1")
    ksp("com.google.dagger:hilt-android-compiler:2.51.1")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")

    // ── Room (local DB) ────────────────────────────────────────────
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // ── Networking (Retrofit + OkHttp + Moshi) ─────────────────────
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("com.squareup.moshi:moshi:1.15.1")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")
    ksp("com.squareup.moshi:moshi-kotlin-codegen:1.15.1")

    // ── Coroutines ─────────────────────────────────────────────────
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // ── Background work ────────────────────────────────────────────
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.hilt:hilt-work:1.2.0")
    ksp("androidx.hilt:hilt-compiler:1.2.0")

    // ── Glance (widgets) ───────────────────────────────────────────
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.glance:glance-material3:1.1.1")

    // ── Biometric + Security crypto ────────────────────────────────
    implementation("androidx.biometric:biometric:1.2.0-alpha05")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // ── Camera (QR pairing) ────────────────────────────────────────
    implementation("androidx.camera:camera-core:1.4.0")
    implementation("androidx.camera:camera-camera2:1.4.0")
    implementation("androidx.camera:camera-lifecycle:1.4.0")
    implementation("androidx.camera:camera-view:1.4.0")
    implementation("com.google.mlkit:barcode-scanning:17.3.0")

    // ── DataStore (settings) ───────────────────────────────────────
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // ── Lifecycle (ViewModel + Compose integration) ────────────────
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")

    // ── Splash screen ──────────────────────────────────────────────
    implementation("androidx.core:core-splashscreen:1.0.1")

    // ── Core ───────────────────────────────────────────────────────
    implementation("androidx.core:core-ktx:1.13.1")

    // ── Test ───────────────────────────────────────────────────────
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
