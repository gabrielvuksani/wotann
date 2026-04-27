import SwiftUI

// MARK: - WOTANN Design System
//
// LEGACY SHIM (Tier A5). This file preserves the existing `WTheme` public API
// so every call-site across the iOS app keeps compiling unchanged. All color,
// spacing, radius, typography, and motion values now delegate to the canonical
// tokens emitted at `WotannTokens.swift` (generated from `src/design/tokens.ts`).
//
// If a WOTANN-iOS semantic slot is NOT yet covered by `src/design/tokens.ts`
// we leave a hex literal at that one slot and tag it with
// `TODO(ios-tokens): ...` so the pipeline owner can backfill it upstream.
// Once backfilled and regenerated the hex disappears; do NOT add new hex
// literals here ahead of a tokens.ts source change.
//
// Pipeline: src/design/tokens.ts  ->  ios/WOTANN/DesignSystem/WotannTokens.swift
//                                ->  (this file composes `WTheme` from them)
//
/// Central design tokens for the WOTANN iOS companion app.
/// Obsidian Precision: OLED-black, Apple blue primary, rounded SF Pro typography.
/// Adaptive: dark-first with light mode support via Color(light:dark:).
enum WTheme {

    // MARK: Colors

    enum Colors {
        // OLED-black canvas — Theme historically used pure #000000.
        // WotannTokens.Dark.background is 0x08080C (near-black) which differs
        // from the Obsidian Precision mandate of true-black on OLED displays.
        // TODO(ios-tokens): add pureOledBlack token to src/design/tokens.ts.
        static let background  = Color.black

        // Elevated surfaces — canonical tokens.
        static let surface     = WotannTokens.Dark.surface
        // TODO(ios-tokens): add surfaceAlt (elevated-2) token to src/design/tokens.ts.
        static let surfaceAlt  = Color(hex: 0x2C2C2E)

        // Apple blue primary. Not in current WotannTokens (cyan-led palette).
        // TODO(ios-tokens): add applePrimary + applePrimaryPressed tokens to src/design/tokens.ts.
        static let primary        = Color(hex: 0x0A84FF)
        static let primaryPressed = Color(hex: 0x0073E6)
        // Preserved alias used throughout the codebase.
        static let primaryDim  = Color(hex: 0x0073E6)

        // Status colors — delegate to canonical dark-palette semantics.
        static let success     = WotannTokens.Dark.success
        static let warning     = WotannTokens.Dark.warning
        static let error       = WotannTokens.Dark.error

        // Text hierarchy. textPrimary maps cleanly; hinted opacities are
        // iOS-specific (Apple HIG dark-mode label alphas) and not in tokens.ts.
        static let textPrimary    = WotannTokens.Dark.text
        // TODO(ios-tokens): add textSecondary/tertiary/quaternary alpha tokens to src/design/tokens.ts.
        static let textSecondary  = Color(hex: 0xEBEBF5).opacity(0.60)
        static let textTertiary   = Color(hex: 0xEBEBF5).opacity(0.30)
        static let textQuaternary = Color(hex: 0xEBEBF5).opacity(0.18)

        // Adaptive border — uses Dark/Light palettes from canonical tokens.
        static let border = Color.adaptiveToken(
            light: WotannTokens.Light.border,
            dark:  WotannTokens.Dark.border
        ).opacity(0.6)

        // Semantic color tokens. Onboarding gradient + syntaxKeyword + chartAccent
        // + brainstormAccent are iOS-specific aesthetics outside the canonical
        // token surface; they stay as-is until a design decision brings them in.
        // TODO(ios-tokens): add onboardingGradient{Start,End} + syntaxKeyword + chartAccent + brainstormAccent tokens.
        static let onboardingGradientStart = Color(hex: 0x1A0533)
        static let onboardingGradientEnd   = Color(hex: 0x0D001A)
        static let syntaxKeyword           = Color(hex: 0x0A84FF)
        static let chartAccent             = Color(hex: 0x5AC8FA)
        // `info` has a canonical token — delegate.
        static let info                    = WotannTokens.Dark.info
        static let brainstormAccent        = Color.orange
    }

    // MARK: Typography

    /// SF Pro Rounded display type + Dynamic Type compatible body styles.
    /// Existing callers use `Font.title`, `.body` etc. — those are preserved.
    /// New Obsidian Precision scale adds `.displayLarge`, `.displaySmall`,
    /// `.heading`, `.roundedHeadline`, `.caption`, `.codeMono`, etc.
    ///
    /// Fixed-size variants (`*Std`, `display*`, `codeMono`, `titleDisplay`,
    /// `roundedHeadline`) source their point sizes from
    /// `WotannTokens.Typography.size_*` so the number ladder stays in sync
    /// with `src/design/tokens.ts`.
    enum Typography {
        // Legacy, Dynamic-Type compatible (preserved — do not rename).
        static let largeTitle  = Font.largeTitle.bold()
        static let title       = Font.title.bold()
        static let title2      = Font.title2.bold()
        static let title3      = Font.title3.weight(.semibold)
        static let headline    = Font.headline
        static let body        = Font.body
        static let callout     = Font.callout
        static let subheadline = Font.subheadline
        static let footnote    = Font.footnote
        static let caption     = Font.caption
        static let caption2    = Font.caption2
        static let code        = Font.system(.body, design: .monospaced)
        static let codeSmall   = Font.system(.caption, design: .monospaced)

        // Obsidian Precision scale (fixed sizes, rounded, curated tracking) —
        // sizes pulled from WotannTokens.Typography.
        /// size_3xl rounded bold. Tracking -0.8. For hero titles.
        static let displayLarge  = Font.system(size: WotannTokens.Typography.size_3xl, weight: .bold, design: .rounded)
        /// size_2xl rounded bold. Tracking -0.6. For screen titles.
        static let displaySmall  = Font.system(size: WotannTokens.Typography.size_2xl, weight: .bold, design: .rounded)
        /// size_xl rounded semibold. Tracking -0.4. For section headers / hero pill.
        // TODO(ios-tokens): tokens.ts lacks a size_xl == 22 step; using size_xl (24) differs from legacy (22).
        static let titleDisplay  = Font.system(size: 22, weight: .semibold, design: .rounded)
        /// size_md rounded semibold. Tracking -0.2. For prominent list rows.
        static let roundedHeadline = Font.system(size: WotannTokens.Typography.size_md, weight: .semibold, design: .rounded)
        /// size_md regular. Standard body.
        static let bodyStd       = Font.system(size: WotannTokens.Typography.size_md, weight: .regular)
        /// size_base regular. Secondary prose, card subtitles.
        static let calloutStd    = Font.system(size: WotannTokens.Typography.size_base, weight: .regular)
        /// size_sm regular. Footnotes and captions in dense UI.
        // TODO(ios-tokens): tokens.ts lacks a size_sm == 13 step; using size_sm (14) differs from legacy (13).
        static let footnoteStd   = Font.system(size: 13, weight: .regular)
        /// size_xs medium. Tracking 0.2. For eyebrows and status chips.
        static let captionStd    = Font.system(size: WotannTokens.Typography.size_xs, weight: .medium)
        /// size_sm monospaced. For code blocks.
        // TODO(ios-tokens): tokens.ts lacks a size_sm == 15 step; using literal 15 differs from size_sm (14).
        static let codeMono      = Font.system(size: 15, weight: .regular, design: .monospaced)
    }

    // MARK: Spacing (8pt grid — legacy API preserved)
    //
    // Legacy Theme named xxs/xs/sm/md/lg/xl/xxl at the 2/4/8/16/24/32/48 ladder.
    // Canonical WotannTokens.Spacing uses xs/sm/md/base/lg/xl/_2xl/_3xl at
    // 4/8/12/16/24/32/48/64. The legacy names are preserved here; values flow
    // through canonical tokens where a matching step exists.

    enum Spacing {
        // TODO(ios-tokens): tokens.ts spacing ladder starts at 4; legacy xxs = 2. Retained as literal.
        static let xxs: CGFloat = 2
        static let xs:  CGFloat = WotannTokens.Spacing.xs     // 4
        static let sm:  CGFloat = WotannTokens.Spacing.sm     // 8
        static let md:  CGFloat = WotannTokens.Spacing.base   // 16
        static let lg:  CGFloat = WotannTokens.Spacing.lg     // 24
        static let xl:  CGFloat = WotannTokens.Spacing.xl     // 32
        static let xxl: CGFloat = WotannTokens.Spacing._2xl   // 48
    }

    // MARK: Radii (legacy API preserved)
    //
    // Legacy Theme: sm/md/lg/xl = 8/12/16/20. WotannTokens.Radius uses
    // none/sm/md/lg/xl/pill/round = 0/4/8/12/16/999/9999. Legacy names are kept;
    // values delegate where a matching step exists.

    enum Radius {
        static let sm: CGFloat  = WotannTokens.Radius.md      // 8
        static let md: CGFloat  = WotannTokens.Radius.lg      // 12
        static let lg: CGFloat  = WotannTokens.Radius.xl      // 16
        // TODO(ios-tokens): tokens.ts radius ladder lacks a 20 step between xl (16) and pill (999).
        static let xl: CGFloat  = 20
        static let pill: CGFloat = WotannTokens.Radius.pill   // 999
    }

    // MARK: Animation
    //
    // Durations pulled from WotannTokens.Duration (seconds). Bounce values
    // remain iOS-specific physics tuning with no tokens.ts counterpart.
    // TODO(ios-tokens): add spring-bounce tokens if cross-platform motion is unified.

    enum Animation {
        static let quick   = SwiftUI.Animation.spring(duration: WotannTokens.Duration.fast,  bounce: 0.1)
        static let smooth  = SwiftUI.Animation.spring(duration: WotannTokens.Duration.base,  bounce: 0.15)
        static let gentle  = SwiftUI.Animation.spring(duration: WotannTokens.Duration.slow,  bounce: 0.2)
        static let bouncy  = SwiftUI.Animation.spring(duration: WotannTokens.Duration.slow,  bounce: 0.3)
    }

    // MARK: Gradients
    //
    // Stops composed from canonical palette tokens where possible. The Apple
    // purple accent (0x5856D6) and Apple-blue primary (0x0A84FF) are not in
    // tokens.ts — see TODOs on Colors.primary above.

    enum Gradients {
        static let primary = LinearGradient(
            // TODO(ios-tokens): add applePrimary + applePurpleAccent tokens to src/design/tokens.ts.
            colors: [Color(hex: 0x0A84FF), Color(hex: 0x5856D6)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        static let accent = LinearGradient(
            // TODO(ios-tokens): add applePrimary + iosChartAccent tokens to src/design/tokens.ts.
            colors: [Color(hex: 0x0A84FF), Color(hex: 0x5AC8FA)],
            startPoint: .leading,
            endPoint: .trailing
        )
        static let surface = LinearGradient(
            colors: [WotannTokens.Dark.surface, Color.black],
            startPoint: .top,
            endPoint: .bottom
        )
        static let success = LinearGradient(
            // TODO(ios-tokens): add successDark + successDarker tokens to src/design/tokens.ts.
            colors: [WotannTokens.Dark.success, Color(hex: 0x059669)],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    // MARK: Letter Spacing (display tracking)
    //
    // Tracking is an iOS-specific typography concern with no cross-platform
    // token counterpart yet. Values retained as typography-system constants.
    // TODO(ios-tokens): add letter-spacing scale to src/design/tokens.ts.

    enum Tracking {
        static let tight: CGFloat = -0.3
        static let tighter: CGFloat = -0.5
        static let display: CGFloat = -0.8
        static let wide: CGFloat = 0.5
        // Obsidian Precision precise tracking values.
        static let displayLarge: CGFloat = -0.8
        static let displaySmall: CGFloat = -0.6
        static let titleDisplay: CGFloat = -0.4
        static let headline: CGFloat = -0.2
        static let caption: CGFloat = 0.2
    }

    // MARK: Enhanced Multi-Layer Shadows
    //
    // Shadow opacities + radii are iOS-specific elevation tuning. No tokens.ts
    // shadow ladder exists yet — keep as-is.
    // TODO(ios-tokens): add shadow/elevation scale to src/design/tokens.ts.

    enum Shadow {
        /// Subtle inner ring highlight.
        static let ring = (color: Color.white.opacity(0.04), radius: CGFloat(0), x: CGFloat(0), y: CGFloat(0))
        /// Small shadow for tight elevation.
        static let sm = (color: Color.black.opacity(0.3), radius: CGFloat(2), x: CGFloat(0), y: CGFloat(1))
        /// Medium multi-layer shadow.
        static let md = (color: Color.black.opacity(0.3), radius: CGFloat(8), x: CGFloat(0), y: CGFloat(4))
        /// Large dramatic shadow.
        static let lg = (color: Color.black.opacity(0.4), radius: CGFloat(16), x: CGFloat(0), y: CGFloat(8))
    }

    // MARK: Elevation
    //
    // See TODO on Shadow above — same scale concern.

    enum Elevation {
        static let low  = (color: Color.black.opacity(0.06), radius: CGFloat(3), x: CGFloat(0), y: CGFloat(1))
        static let mid  = (color: Color.black.opacity(0.12), radius: CGFloat(10), x: CGFloat(0), y: CGFloat(4))
        static let high = (color: Color.black.opacity(0.20), radius: CGFloat(24), x: CGFloat(0), y: CGFloat(8))
    }

    // MARK: Icon Sizes
    //
    // Icon sizes are platform-specific (Apple SF Symbol sizing). Spacing ladder
    // from tokens.ts doubles nicely at 16/24 — reuse where it aligns.

    enum IconSize {
        static let sm: CGFloat = WotannTokens.Spacing.base    // 16
        static let md: CGFloat = WotannTokens.Spacing.lg      // 24
        static let lg: CGFloat = WotannTokens.Spacing.xl      // 32
        static let xl: CGFloat = WotannTokens.Spacing._2xl    // 48
    }

    // MARK: Border Widths

    enum BorderWidth {
        static let hairline: CGFloat = 0.5
        static let regular:  CGFloat = 1
        static let thick:    CGFloat = 2
    }
}

// MARK: - Color Hex Extension
//
// `Color(hex:)` is shared between Theme and WotannTokens. WotannTokens wraps its
// fallback behind `#if !WOTANN_HAS_COLOR_HEX` so when this file (or anyone
// else) defines it at target scope, the generated file stays silent. The
// target exposing Theme.swift should also define `WOTANN_HAS_COLOR_HEX`.

extension Color {
    init(hex: UInt, alpha: Double = 1.0) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: alpha)
    }

    /// Adaptive color that resolves to different hex values in light and dark mode.
    static func adaptive(light: UInt, dark: UInt) -> Color {
        Color(uiColor: UIColor { traitCollection in
            let hex = traitCollection.userInterfaceStyle == .dark ? dark : light
            let r = CGFloat((hex >> 16) & 0xFF) / 255.0
            let g = CGFloat((hex >> 8) & 0xFF) / 255.0
            let b = CGFloat(hex & 0xFF) / 255.0
            return UIColor(red: r, green: g, blue: b, alpha: 1.0)
        })
    }

    /// Adaptive SwiftUI Color from two already-resolved Color values.
    /// Used when the light/dark stops live in WotannTokens (typed as Color, not UInt).
    static func adaptiveToken(light: Color, dark: Color) -> Color {
        Color(uiColor: UIColor { traitCollection in
            traitCollection.userInterfaceStyle == .dark
                ? UIColor(dark)
                : UIColor(light)
        })
    }

    // Legacy compatibility.
    static let wotannBlue = WTheme.Colors.primary
    // TODO(ios-tokens): wotannCyan shadows a brand accent not in tokens.ts. Canonical Dark.accent is 0x06B6D4 — same hex, so delegate.
    static let wotannCyan = WotannTokens.Dark.accent
}

// MARK: - Provider Colors
//
// Provider brand colors are external identities (Anthropic amber, OpenAI
// emerald, etc.) — not a WOTANN design-token concern. They intentionally stay
// as hex literals and are deliberately NOT tagged TODO(ios-tokens).

extension WTheme.Colors {
    static func provider(_ name: String) -> Color {
        switch name.lowercased() {
        case "anthropic":   return Color(hex: 0xD97706)  // amber
        case "openai":      return Color(hex: 0x10B981)  // emerald
        // Gap-2 fix: "gemini" is the canonical daemon provider id;
        // "google" kept as alias so legacy persisted data still maps.
        case "gemini", "google": return Color(hex: 0x3B82F6)  // blue
        case "mistral":     return Color(hex: 0xF97316)  // orange
        case "groq":        return Color(hex: 0x5856D6)  // indigo
        case "ollama":      return Color(hex: 0x64748B)  // slate
        case "openrouter":  return Color(hex: 0xEC4899)  // pink
        case "deepseek":    return Color(hex: 0x06B6D4)  // cyan
        case "xai":         return Color(hex: 0xEF4444)  // red
        case "cohere":      return Color(hex: 0x14B8A6)  // teal
        case "together":    return Color(hex: 0xA855F7)  // purple
        default:            return primary
        }
    }
}
