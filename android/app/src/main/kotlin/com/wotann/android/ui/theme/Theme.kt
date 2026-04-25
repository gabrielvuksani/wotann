/*
 * Theme.kt — WOTANN Material 3 theme wrapper.
 *
 * WHAT: The top-level Composable that wraps every screen with the
 *   WOTANN MaterialTheme — color scheme + typography + shapes. Picks
 *   between light, dark, and dynamic-color schemes based on system
 *   settings.
 *
 * WHY: V9 §FT.3.3 mandates Material 3 with a brand override on top
 *   of Android 12+ dynamic color. Wrapping every screen in
 *   WotannTheme guarantees the brand cyan shows through where it
 *   should without us having to remember per-screen.
 *
 * WHERE: Called from MainActivity.setContent { WotannTheme { ... } }
 *   and from individual @Preview composables.
 *
 * HOW:
 *   - On Android 12+ with dynamic colors enabled, derive the color
 *     scheme from the user's wallpaper (`dynamicLightColorScheme`).
 *   - Otherwise, fall back to a hand-tuned static scheme built from
 *     the WOTANN brand palette in Color.kt.
 *   - Typography always comes from Type.kt (no dynamic typography).
 *
 * Honest stub: status-bar / nav-bar tinting is a TODO — Compose 1.7
 * deprecated `WindowCompat.setStatusBarColor`, so we'll need to use
 * the M3 expressive `Surface` color contract once it stabilises.
 */
package com.wotann.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

/**
 * Hand-tuned dark-mode color scheme. Used on Android < 12 OR when
 * dynamic color is disabled in Settings.
 */
private val WotannDarkColorScheme = darkColorScheme(
    primary = WotannCyan,
    onPrimary = NorseSlate900,
    primaryContainer = WotannCyanDark,
    onPrimaryContainer = NorseSlate50,
    secondary = AuroraGreen,
    onSecondary = NorseSlate900,
    tertiary = AuroraOrange,
    onTertiary = NorseSlate900,
    background = NorseSlate900,
    onBackground = NorseSlate100,
    surface = NorseSlate800,
    onSurface = NorseSlate100,
    surfaceVariant = NorseSlate700,
    onSurfaceVariant = NorseSlate200,
    error = ErrorRed,
    onError = OnError,
    errorContainer = ErrorContainer,
    onErrorContainer = OnErrorContainer,
)

/**
 * Hand-tuned light-mode color scheme. Used on Android < 12 OR when
 * dynamic color is disabled in Settings.
 */
private val WotannLightColorScheme = lightColorScheme(
    primary = WotannCyan,
    onPrimary = NorseSlate50,
    primaryContainer = WotannCyanLight,
    onPrimaryContainer = NorseSlate900,
    secondary = AuroraGreen,
    onSecondary = NorseSlate900,
    tertiary = AuroraOrange,
    onTertiary = NorseSlate900,
    background = NorseSlate50,
    onBackground = NorseSlate900,
    surface = NorseSlate100,
    onSurface = NorseSlate900,
    surfaceVariant = NorseSlate200,
    onSurfaceVariant = NorseSlate700,
    error = ErrorRed,
    onError = OnError,
    errorContainer = ErrorContainer,
    onErrorContainer = OnErrorContainer,
)

/**
 * Top-level theme. Every screen composes inside this.
 *
 * @param darkTheme Whether dark mode should be used. Defaults to the
 *   system value via `isSystemInDarkTheme()`.
 * @param dynamicColor Whether to use Android 12+'s wallpaper-derived
 *   color scheme. Defaults to true; user can override in Settings.
 * @param content The Composable subtree to theme.
 */
@Composable
fun WotannTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> WotannDarkColorScheme
        else -> WotannLightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = WotannTypography,
        // shapes left as M3 default for now; the 12-week impl will
        // bring in the WOTANN-specific corner radii from design tokens.
        content = content,
    )
}
