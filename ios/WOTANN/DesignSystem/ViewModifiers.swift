import SwiftUI

// MARK: - Card Modifier (Enhanced with subtle shadow)

struct WCardModifier: ViewModifier {
    var padding: CGFloat = WTheme.Spacing.md
    var radius: CGFloat = WTheme.Radius.lg

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(WTheme.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
            )
            .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 2)
    }
}

// MARK: - Glass Card Modifier (Frosted glass effect)

struct WGlassCardModifier: ViewModifier {
    var radius: CGFloat = WTheme.Radius.lg

    func body(content: Content) -> some View {
        content
            .padding(WTheme.Spacing.md)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(WTheme.Colors.border, lineWidth: 0.5)
            )
    }
}

// MARK: - Surface Modifier

struct WSurfaceModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(WTheme.Colors.background)
    }
}

// MARK: - Gradient Border Modifier

struct WGradientBorderModifier: ViewModifier {
    let colors: [Color]
    let lineWidth: CGFloat
    let radius: CGFloat

    func body(content: Content) -> some View {
        content
            .overlay(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .stroke(
                        LinearGradient(
                            colors: colors,
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        ),
                        lineWidth: lineWidth
                    )
            )
    }
}

// MARK: - Glow Effect

struct WGlowModifier: ViewModifier {
    let color: Color
    let radius: CGFloat

    func body(content: Content) -> some View {
        content
            .shadow(color: color.opacity(0.4), radius: radius, x: 0, y: 0)
    }
}

// MARK: - Shimmer Loading Effect

struct WShimmerModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        if reduceMotion {
            content
                .overlay(Color.white.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
        } else {
            content
                .overlay(
                    GeometryReader { geometry in
                        LinearGradient(
                            colors: [
                                .clear,
                                Color.white.opacity(0.1),
                                .clear,
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geometry.size.width * 0.6)
                        .offset(x: -geometry.size.width + phase * geometry.size.width * 2)
                    }
                )
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                .onAppear {
                    withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                        phase = 1
                    }
                }
        }
    }
}

// MARK: - Pulse Animation

struct WPulseModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var isPulsing = false

    func body(content: Content) -> some View {
        if reduceMotion {
            content
        } else {
            content
                .scaleEffect(isPulsing ? 1.05 : 1.0)
                .opacity(isPulsing ? 0.7 : 1.0)
                .onAppear {
                    withAnimation(.easeInOut(duration: 1.2).repeatForever(autoreverses: true)) {
                        isPulsing = true
                    }
                }
        }
    }
}

// MARK: - Slide-In From Bottom

struct WSlideUpModifier: ViewModifier {
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var appeared = false

    func body(content: Content) -> some View {
        if reduceMotion {
            content
                .onAppear { appeared = true }
        } else {
            content
                .offset(y: appeared ? 0 : 20)
                .opacity(appeared ? 1 : 0)
                .onAppear {
                    withAnimation(WTheme.Animation.smooth) {
                        appeared = true
                    }
                }
        }
    }
}

// MARK: - Staggered Fade In

struct WStaggeredFadeModifier: ViewModifier {
    let index: Int
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var appeared = false

    func body(content: Content) -> some View {
        if reduceMotion {
            content
                .onAppear { appeared = true }
        } else {
            content
                .opacity(appeared ? 1 : 0)
                .offset(y: appeared ? 0 : 12)
                .onAppear {
                    withAnimation(WTheme.Animation.smooth.delay(Double(index) * 0.08)) {
                        appeared = true
                    }
                }
        }
    }
}

// MARK: - Gradient Text

struct WGradientTextModifier: ViewModifier {
    let colors: [Color]

    func body(content: Content) -> some View {
        content
            .foregroundStyle(
                LinearGradient(
                    colors: colors,
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
    }
}

// MARK: - View Extensions

extension View {
    func wCard(padding: CGFloat = WTheme.Spacing.md, radius: CGFloat = WTheme.Radius.lg) -> some View {
        modifier(WCardModifier(padding: padding, radius: radius))
    }

    func wGlassCard(radius: CGFloat = WTheme.Radius.lg) -> some View {
        modifier(WGlassCardModifier(radius: radius))
    }

    func wSurface() -> some View {
        modifier(WSurfaceModifier())
    }

    func wGradientBorder(
        colors: [Color] = [WTheme.Colors.primary, Color(hex: 0x5856D6)],
        lineWidth: CGFloat = 1,
        radius: CGFloat = WTheme.Radius.lg
    ) -> some View {
        modifier(WGradientBorderModifier(colors: colors, lineWidth: lineWidth, radius: radius))
    }

    func wGlow(_ color: Color = WTheme.Colors.primary, radius: CGFloat = 8) -> some View {
        modifier(WGlowModifier(color: color, radius: radius))
    }

    func wShimmer() -> some View {
        modifier(WShimmerModifier())
    }

    func wPulse() -> some View {
        modifier(WPulseModifier())
    }

    func wSlideUp() -> some View {
        modifier(WSlideUpModifier())
    }

    func wStaggered(index: Int) -> some View {
        modifier(WStaggeredFadeModifier(index: index))
    }

    func wGradientText(colors: [Color] = [WTheme.Colors.primary, Color(hex: 0x5856D6)]) -> some View {
        modifier(WGradientTextModifier(colors: colors))
    }
}
