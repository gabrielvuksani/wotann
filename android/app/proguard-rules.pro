# WOTANN Android ProGuard rules — V9 FT.3.3 scaffold.
#
# WHAT: R8 / ProGuard rules for the release build. Keeps the classes
#   that R8 cannot prove are reachable from the manifest, plus the
#   classes that runtime reflection relies on (Moshi adapters, Hilt
#   generated factories, Room generated DAOs, etc.).
#
# WHY: §FT.3.3 mandates `isMinifyEnabled = true` for release. Without
#   these rules, R8 strips classes that Moshi and Hilt try to load
#   reflectively, and the app crashes on first use.
#
# WHERE: Referenced from app/build.gradle.kts buildTypes.release
#   block. Combined with proguard-android-optimize.txt at build time.
#
# HOW: Each rule documents the underlying library so future
#   maintainers can drop a rule when the library version no longer
#   needs it.

# ── Kotlin metadata ──────────────────────────────────────────────
# Required for Kotlin reflection (used by Moshi codegen + serialization).
-keep class kotlin.Metadata { *; }
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes EnclosingMethod
-keepattributes InnerClasses

# ── Coroutines ───────────────────────────────────────────────────
# kotlinx-coroutines uses a service loader that R8 may strip.
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keep class kotlinx.coroutines.android.AndroidExceptionPreHandler { *; }

# ── Moshi (JSON) ─────────────────────────────────────────────────
# Moshi codegen produces classes named *JsonAdapter — keep them.
-keep class com.squareup.moshi.JsonAdapter
-keep class **JsonAdapter { *; }
-keepnames @kotlin.Metadata class com.wotann.android.**
-keep class com.wotann.android.data.network.dto.** { *; }
-keep class com.wotann.android.domain.** { *; }

# ── Retrofit ────────────────────────────────────────────────────
# Retrofit needs the parameterized return types of service methods.
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response

# ── OkHttp ───────────────────────────────────────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**

# ── Room ─────────────────────────────────────────────────────────
# Room generates *_Impl classes that DI references.
-keep class androidx.room.RoomDatabase { *; }
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class *
-dontwarn androidx.room.paging.**

# ── Hilt / Dagger ────────────────────────────────────────────────
-keep class dagger.hilt.android.internal.managers.** { *; }
-keep class dagger.hilt.android.internal.modules.** { *; }
-keep class dagger.hilt.android.internal.lifecycle.** { *; }
-keep,allowobfuscation @interface dagger.hilt.android.lifecycle.HiltViewModel

# ── Glance widgets ──────────────────────────────────────────────
# Glance widgets are loaded via reflection from the manifest.
-keep class * extends androidx.glance.appwidget.GlanceAppWidgetReceiver
-keep class * extends androidx.glance.appwidget.GlanceAppWidget

# ── Compose ──────────────────────────────────────────────────────
-keepclassmembers class * {
    @androidx.compose.runtime.Composable <methods>;
}

# ── BuildConfig / R generated code ───────────────────────────────
# Both the BuildConfig and R class are referenced by name in the
# manifest and (R) by resource references; never minify their members.
-keep class com.wotann.android.BuildConfig { *; }
-keep class com.wotann.android.R { *; }
-keep class com.wotann.android.R$* { *; }

# ── Keep a sane stack trace ──────────────────────────────────────
-keepattributes SourceFile, LineNumberTable
# Don't expose the original source file names in release.
-renamesourcefileattribute SourceFile
