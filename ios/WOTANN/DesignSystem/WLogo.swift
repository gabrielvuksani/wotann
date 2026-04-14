import SwiftUI

// MARK: - WLogoShape

/// Custom SwiftUI Shape that draws the WOTANN "W" lettermark.
/// Matches the desktop SVG path for visual consistency across platforms.
struct WLogoShape: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width
        let h = rect.height
        var path = Path()

        let points: [(CGFloat, CGFloat)] = [
            (0.167, 0.375), (0.278, 0.958), (0.319, 0.958),
            (0.403, 0.583), (0.458, 0.958), (0.500, 0.958),
            (0.583, 0.583), (0.639, 0.958), (0.681, 0.958),
            (0.806, 0.375), (0.722, 0.375), (0.653, 0.792),
            (0.583, 0.375), (0.528, 0.375), (0.458, 0.792),
            (0.389, 0.375), (0.333, 0.375), (0.264, 0.792),
            (0.194, 0.375),
        ]

        if let first = points.first {
            path.move(to: CGPoint(x: first.0 * w, y: first.1 * h))
        }
        for point in points.dropFirst() {
            path.addLine(to: CGPoint(x: point.0 * w, y: point.1 * h))
        }
        path.closeSubpath()

        return path
    }
}

// MARK: - WLogo View

/// Reusable WOTANN "W" logo view with gradient fill and optional glow.
/// Replaces all former `bolt.shield.fill` SF Symbol usage.
struct WLogo: View {
    let size: CGFloat
    var glowRadius: CGFloat = 0

    /// Standard gradient matching Apple system blue -> indigo.
    private var logoGradient: LinearGradient {
        LinearGradient(
            colors: [WTheme.Colors.primary, Color(hex: 0x5856D6)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        WLogoShape()
            .fill(logoGradient)
            .frame(width: size, height: size)
            .modifier(GlowModifier(color: WTheme.Colors.primary, radius: glowRadius))
    }
}

// MARK: - Glow Modifier (conditional)

/// Applies a glow only when radius > 0, avoiding empty shadow layers.
private struct GlowModifier: ViewModifier {
    let color: Color
    let radius: CGFloat

    func body(content: Content) -> some View {
        if radius > 0 {
            content
                .shadow(color: color.opacity(0.5), radius: radius)
                .shadow(color: color.opacity(0.25), radius: radius * 0.5)
        } else {
            content
        }
    }
}

// MARK: - Preview

#Preview("W Logo Sizes") {
    HStack(spacing: 32) {
        WLogo(size: 32)
        WLogo(size: 48, glowRadius: 12)
        WLogo(size: 72, glowRadius: 20)
        WLogo(size: 88, glowRadius: 30)
    }
    .padding(40)
    .background(Color.black)
    .preferredColorScheme(.dark)
}
