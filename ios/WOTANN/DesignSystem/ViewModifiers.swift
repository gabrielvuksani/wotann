import SwiftUI

// MARK: - Liquid Glass (T7.3)
//
// `wLiquidGlass` is a forward-compatible wrapper for Apple's iOS 26 "Liquid
// Glass" surface while giving iOS 18 the correct `.ultraThinMaterial` + subtle
// white border treatment the app has used since Phase C.
//
// iOS 26 introduced `.glassEffect(in:)` on `View` which applies a translucent
// liquid-glass material that respects motion, tint, and depth. iOS 18 has no
// equivalent so we fall back to `.ultraThinMaterial` inside the caller-chosen
// shape plus a 0.5-point border at `.white.opacity(0.12)` — matching the
// pre-existing `WGlassCardModifier` look while letting each call site pick
// the shape (capsule, rounded rect, etc).
//
// Where NOT to use: message bubbles, cost charts, code blocks (legibility
// cost). OLED-intent black canvases (Home background) stay pure black.

extension View {

    /// Apply WOTANN's Liquid Glass treatment inside a caller-specified shape.
    ///
    /// iOS 26 ships `.glassEffect(in:)` for native Liquid Glass but the iOS
    /// 18 SDK that WOTANN builds against does not expose that symbol, so the
    /// iOS 26 branch has to live behind an SDK-availability compile guard.
    /// When built with the iOS 26 SDK, the preprocessor flag
    /// `WOTANN_HAS_LIQUID_GLASS` should be set in the xcconfig to enable the
    /// native path; without it the helper falls back to `.ultraThinMaterial`
    /// plus the 0.5pt `white.opacity(0.12)` border that matches the Phase C
    /// glass treatment used across the app.
    ///
    /// - Parameters:
    ///   - shape: The clipping + fill shape. Defaults to a 16pt rounded rect.
    ///   - interactive: Whether the glass reacts to pointer / gesture (iOS 26+).
    ///   - tint: Optional tint colour layered under the glass (iOS 26+).
    @ViewBuilder
    func wLiquidGlass<S: Shape>(
        in shape: S,
        interactive: Bool = false,
        tint: Color? = nil
    ) -> some View {
        #if WOTANN_HAS_LIQUID_GLASS
        if #available(iOS 26.0, *) {
            // `.glassEffect(_:in:)` is the iOS 26 native Liquid Glass API.
            // Only compiled when the xcconfig flag is set (i.e. building with
            // the iOS 26 SDK) so the iOS 18 builds below do not see the
            // unresolved symbol.
            self.glassEffect(
                .regular
                    .tint(tint)
                    .interactive(interactive),
                in: shape
            )
        } else {
            self
                .background(shape.fill(.ultraThinMaterial))
                .overlay(shape.stroke(.white.opacity(0.12), lineWidth: 0.5))
        }
        #else
        // iOS 18 SDK path — `.glassEffect` is not available. Suppress unused
        // warnings on the iOS 26-only parameters by binding them to `_`.
        let _ = (interactive, tint)
        self
            .background(shape.fill(.ultraThinMaterial))
            .overlay(shape.stroke(.white.opacity(0.12), lineWidth: 0.5))
        #endif
    }

    /// Convenience overload — defaults the shape to a 16pt continuous rounded
    /// rectangle, matching `WTheme.Radius.lg`.
    func wLiquidGlass(
        interactive: Bool = false,
        tint: Color? = nil
    ) -> some View {
        self.wLiquidGlass(
            in: RoundedRectangle(cornerRadius: 16, style: .continuous),
            interactive: interactive,
            tint: tint
        )
    }
}

// MARK: - Writing Tools (T7.2)
//
// `.writingToolsBehavior(.complete)` is iOS 18's opt-in for the full Apple
// Intelligence Writing Tools surface (Rewrite / Proofread / Summarize /
// Compose) on a text control. The modifier only exists on iOS 18+ so we wrap
// it in an availability check — earlier iOS simply gets the unmodified view.

extension View {

    /// Opt this text control into Apple Intelligence Writing Tools with the
    /// complete behaviour (Rewrite / Proofread / Summarize). No-op on iOS 17.
    @ViewBuilder
    func wotannWritingToolsComplete() -> some View {
        if #available(iOS 18.0, *) {
            self.writingToolsBehavior(.complete)
        } else {
            self
        }
    }
}

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
