/*
 * Color.kt — WOTANN brand palette + Material 3 token mapping.
 *
 * WHAT: Defines the WOTANN brand colors as Compose `Color` values
 *   and maps them into Material 3's role-based color scheme (primary,
 *   secondary, tertiary, etc.) for both light and dark themes.
 *
 * WHY: V9 §FT.3.3 specifies the WOTANN cyan (#06B6D4) as the
 *   primary brand color. Material 3 derives 13+ derived roles from
 *   the primary, so we need an explicit hand-tuned mapping rather
 *   than letting `dynamicColorScheme()` derive everything from the
 *   wallpaper.
 *
 * WHERE: Used by Theme.kt to construct ColorScheme objects passed
 *   into MaterialTheme. Individual screens read color tokens via
 *   `MaterialTheme.colorScheme.primary` etc., NOT from this file
 *   directly.
 *
 * HOW: We define the brand color and a hand-tuned set of
 *   complementary tones. Material 3 in production typically uses
 *   `dynamicColorScheme()` on Android 12+ (pulls from wallpaper),
 *   but for brand consistency we ship a static scheme as the
 *   fallback and let the user opt into dynamic colors via Settings.
 *
 * Honest stub: the color tokens are deliberately minimal — the
 * 12-week implementation will fill out the full M3 spec including
 * tonal palettes (each at neutral / neutral-variant / primary /
 * secondary / tertiary / error roles).
 */
package com.wotann.android.ui.theme

import androidx.compose.ui.graphics.Color

// ── WOTANN brand color ───────────────────────────────────────────
// Cyan-500 from Tailwind; matches the desktop and iOS brand spec.
val WotannCyan = Color(0xFF06B6D4)
val WotannCyanDark = Color(0xFF0891B2)
val WotannCyanLight = Color(0xFF67E8F9)

// ── Neutral tokens (Norse grey) ──────────────────────────────────
// Slightly cool grey to complement the cyan. These match the
// design tokens shipped at `design-brief/` in the repo.
val NorseSlate900 = Color(0xFF0F1419)
val NorseSlate800 = Color(0xFF1B2532)
val NorseSlate700 = Color(0xFF334155)
val NorseSlate200 = Color(0xFFE2E8F0)
val NorseSlate100 = Color(0xFFF1F5F9)
val NorseSlate50 = Color(0xFFF8FAFC)

// ── Accent (Aurora) ──────────────────────────────────────────────
// A warm complementary accent for Workshop/Editor highlights.
val AuroraGreen = Color(0xFF34D399)
val AuroraOrange = Color(0xFFFB923C)

// ── Error palette (M3 spec) ──────────────────────────────────────
val ErrorRed = Color(0xFFEF4444)
val OnError = Color(0xFFFFFFFF)
val ErrorContainer = Color(0xFFFEE2E2)
val OnErrorContainer = Color(0xFF7F1D1D)
