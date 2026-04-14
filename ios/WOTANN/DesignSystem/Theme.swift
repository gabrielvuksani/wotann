import SwiftUI

// MARK: - WOTANN Design System

/// Central design tokens for the WOTANN iOS companion app.
/// Obsidian Precision: OLED-black, Apple blue primary, rounded SF Pro typography.
/// Adaptive: dark-first with light mode support via Color(light:dark:).
enum WTheme {

    // MARK: Colors

    enum Colors {
        // OLED-black canvas. Pure #000000 for true black on OLED displays.
        static let background  = Color.black
        // Elevated surfaces.
        static let surface     = Color(hex: 0x1C1C1E)
        static let surfaceAlt  = Color(hex: 0x2C2C2E)

        // Apple blue primary.
        static let primary        = Color(hex: 0x0A84FF)
        static let primaryPressed = Color(hex: 0x0073E6)
        // Preserved alias used throughout the codebase.
        static let primaryDim  = Color(hex: 0x0073E6)

        // Status colors (iOS system dark variants).
        static let success     = Color(hex: 0x30D158)
        static let warning     = Color(hex: 0xFF9F0A)
        static let error       = Color(hex: 0xFF453A)

        // Text hierarchy (Apple HIG dark-mode label opacities).
        static let textPrimary    = Color.white
        static let textSecondary  = Color(hex: 0xEBEBF5).opacity(0.60)
        static let textTertiary   = Color(hex: 0xEBEBF5).opacity(0.30)
        static let textQuaternary = Color(hex: 0xEBEBF5).opacity(0.18)

        // Borders / separators. Uses adaptive so light mode still works.
        static let border = Color.adaptive(light: 0xE2E8F0, dark: 0x3A3A3C).opacity(0.6)

        // Semantic color tokens (preserved).
        static let onboardingGradientStart = Color(hex: 0x1A0533)
        static let onboardingGradientEnd   = Color(hex: 0x0D001A)
        static let syntaxKeyword           = Color(hex: 0x0A84FF)
        static let chartAccent             = Color(hex: 0x5AC8FA)
        static let info                    = Color(hex: 0x38BDF8)
        static let brainstormAccent        = Color.orange
    }

    // MARK: Typography

    /// SF Pro Rounded display type + Dynamic Type compatible body styles.
    /// Existing callers use `Font.title`, `.body` etc. — those are preserved.
    /// New Obsidian Precision scale adds `.displayLarge`, `.displaySmall`,
    /// `.heading`, `.roundedHeadline`, `.caption`, `.codeMono`, etc.
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

        // New Obsidian Precision scale (fixed sizes, rounded, curated tracking).
        /// 34pt rounded bold. Tracking -0.8. For hero titles.
        static let displayLarge  = Font.system(size: 34, weight: .bold, design: .rounded)
        /// 28pt rounded bold. Tracking -0.6. For screen titles.
        static let displaySmall  = Font.system(size: 28, weight: .bold, design: .rounded)
        /// 22pt rounded semibold. Tracking -0.4. For section headers / hero pill.
        static let titleDisplay  = Font.system(size: 22, weight: .semibold, design: .rounded)
        /// 17pt rounded semibold. Tracking -0.2. For prominent list rows.
        static let roundedHeadline = Font.system(size: 17, weight: .semibold, design: .rounded)
        /// 17pt regular. Standard body.
        static let bodyStd       = Font.system(size: 17, weight: .regular)
        /// 16pt regular. Secondary prose, card subtitles.
        static let calloutStd    = Font.system(size: 16, weight: .regular)
        /// 13pt regular. Footnotes and captions in dense UI.
        static let footnoteStd   = Font.system(size: 13, weight: .regular)
        /// 12pt medium. Tracking 0.2. For eyebrows and status chips.
        static let captionStd    = Font.system(size: 12, weight: .medium)
        /// 15pt monospaced. For code blocks.
        static let codeMono      = Font.system(size: 15, weight: .regular, design: .monospaced)
    }

    // MARK: Spacing (8pt grid)

    enum Spacing {
        static let xxs: CGFloat = 2
        static let xs:  CGFloat = 4
        static let sm:  CGFloat = 8
        static let md:  CGFloat = 16
        static let lg:  CGFloat = 24
        static let xl:  CGFloat = 32
        static let xxl: CGFloat = 48
    }

    // MARK: Radii

    enum Radius {
        static let sm: CGFloat  = 8
        static let md: CGFloat  = 12
        static let lg: CGFloat  = 16
        static let xl: CGFloat  = 20
        static let pill: CGFloat = 999
    }

    // MARK: Animation

    enum Animation {
        static let quick   = SwiftUI.Animation.spring(duration: 0.2, bounce: 0.1)
        static let smooth  = SwiftUI.Animation.spring(duration: 0.35, bounce: 0.15)
        static let gentle  = SwiftUI.Animation.spring(duration: 0.5, bounce: 0.2)
        static let bouncy  = SwiftUI.Animation.spring(duration: 0.4, bounce: 0.3)
    }

    // MARK: Gradients

    enum Gradients {
        static let primary = LinearGradient(
            colors: [Color(hex: 0x0A84FF), Color(hex: 0x5856D6)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        static let accent = LinearGradient(
            colors: [Color(hex: 0x0A84FF), Color(hex: 0x5AC8FA)],
            startPoint: .leading,
            endPoint: .trailing
        )
        static let surface = LinearGradient(
            colors: [Color(hex: 0x1C1C1E), Color.black],
            startPoint: .top,
            endPoint: .bottom
        )
        static let success = LinearGradient(
            colors: [Color(hex: 0x30D158), Color(hex: 0x059669)],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    // MARK: Letter Spacing (display tracking)

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

    enum Elevation {
        static let low  = (color: Color.black.opacity(0.06), radius: CGFloat(3), x: CGFloat(0), y: CGFloat(1))
        static let mid  = (color: Color.black.opacity(0.12), radius: CGFloat(10), x: CGFloat(0), y: CGFloat(4))
        static let high = (color: Color.black.opacity(0.20), radius: CGFloat(24), x: CGFloat(0), y: CGFloat(8))
    }

    // MARK: Icon Sizes

    enum IconSize {
        static let sm: CGFloat = 16
        static let md: CGFloat = 24
        static let lg: CGFloat = 32
        static let xl: CGFloat = 48
    }

    // MARK: Border Widths

    enum BorderWidth {
        static let hairline: CGFloat = 0.5
        static let regular:  CGFloat = 1
        static let thick:    CGFloat = 2
    }
}

// MARK: - Color Hex Extension

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

    // Legacy compatibility
    static let wotannBlue = WTheme.Colors.primary
    static let wotannCyan   = Color(hex: 0x06B6D4)
}

// MARK: - Provider Colors

extension WTheme.Colors {
    static func provider(_ name: String) -> Color {
        switch name.lowercased() {
        case "anthropic":   return Color(hex: 0xD97706)  // amber
        case "openai":      return Color(hex: 0x10B981)  // emerald
        case "google":      return Color(hex: 0x3B82F6)  // blue
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
