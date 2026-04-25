/*
 * Type.kt — WOTANN typography scale.
 *
 * WHAT: Defines the Compose Typography object passed into MaterialTheme.
 *   Maps WOTANN's design-system type roles (display / headline / title
 *   / body / label) to specific font sizes, weights, line heights,
 *   and tracking values.
 *
 * WHY: V9 §FT.3.3 mandates Material 3 Expressive type scale. M3's
 *   default Typography is a good baseline but doesn't match the
 *   WOTANN design tokens — we need an explicit override to keep
 *   visual parity with desktop and iOS.
 *
 * WHERE: Used by Theme.kt; consumed by every Compose surface via
 *   `MaterialTheme.typography.bodyLarge` etc.
 *
 * HOW: Currently uses the system default font family. The 12-week
 *   implementation will load a custom font family (likely Inter or
 *   Pretendard, matching iOS) via Compose's `Font(R.font.inter,...)`.
 *
 * Honest stub: we ship the scale with FontFamily.Default. Loading
 * a real font requires shipping the font file under res/font/, which
 * is out of scope for the scaffold — but the scale itself is
 * production-shaped.
 */
package com.wotann.android.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val WotannFontFamily = FontFamily.Default

/**
 * The full M3 type scale, tuned for WOTANN. Values track the M3
 * spec defaults but with slightly tighter line-heights for a more
 * compact information-dense feel, matching the desktop client.
 */
val WotannTypography = Typography(
    // ── Display (rare; large hero text) ──────────────────────────
    displayLarge = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Light,
        fontSize = 57.sp,
        lineHeight = 64.sp,
        letterSpacing = (-0.25).sp,
    ),
    displayMedium = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Light,
        fontSize = 45.sp,
        lineHeight = 52.sp,
    ),
    displaySmall = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 36.sp,
        lineHeight = 44.sp,
    ),

    // ── Headline (section heads, modal titles) ───────────────────
    headlineLarge = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 32.sp,
        lineHeight = 40.sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 28.sp,
        lineHeight = 36.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 24.sp,
        lineHeight = 32.sp,
    ),

    // ── Title (top app bar, card titles) ─────────────────────────
    titleLarge = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 22.sp,
        lineHeight = 28.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.15.sp,
    ),
    titleSmall = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),

    // ── Body (the workhorse) ─────────────────────────────────────
    bodyLarge = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.25.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
    ),

    // ── Label (buttons, chips, badges) ───────────────────────────
    labelLarge = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = WotannFontFamily,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
    ),
)
