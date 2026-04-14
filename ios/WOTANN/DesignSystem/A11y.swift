import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Lightweight Tap Haptic (extension-safe)

/// Inline light-impact helper so this file compiles in widget/share
/// extensions that don't include the main app's `Haptics` singleton.
/// Respects the "hapticFeedback" user default just like `Haptics`.
private enum A11yTapHaptic {
    static func buttonTap() {
        #if canImport(UIKit)
        if UserDefaults.standard.object(forKey: "hapticFeedback") != nil,
           UserDefaults.standard.bool(forKey: "hapticFeedback") == false {
            return
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }
}

// MARK: - Reusable Accessibility Modifiers

/// Applies an accessibility label (and optional hint) with a semantic role of button.
private struct WotannAccessibleModifier: ViewModifier {
    let label: String
    let hint: String?

    func body(content: Content) -> some View {
        if let hint {
            content
                .accessibilityLabel(Text(label))
                .accessibilityHint(Text(hint))
        } else {
            content.accessibilityLabel(Text(label))
        }
    }
}

/// Replaces spring animations with easeInOut when the user has
/// "Reduce Motion" enabled in Accessibility settings.
private struct RespectReduceMotionModifier<V: Equatable>: ViewModifier {
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    let spring: SwiftUI.Animation
    let value: V

    func body(content: Content) -> some View {
        content.animation(reduceMotion ? .easeInOut(duration: 0.2) : spring, value: value)
    }
}

/// Ensures a tap surface is at least 44x44pt (Apple HIG minimum) and
/// uses Rectangle hit shape so the entire frame is tappable. Fires a
/// light haptic on tap; the onTap closure is invoked after the haptic.
private struct HitTargetModifier: ViewModifier {
    let onTap: (() -> Void)?

    func body(content: Content) -> some View {
        let shaped = content
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())

        if let onTap {
            return AnyView(
                shaped.onTapGesture {
                    A11yTapHaptic.buttonTap()
                    onTap()
                }
            )
        } else {
            return AnyView(shaped)
        }
    }
}

// MARK: - View Extensions

extension View {
    /// Marks this view as accessible with a VoiceOver label and optional hint.
    /// Callers should pass plain strings already localized.
    func wotannAccessible(label: String, hint: String? = nil) -> some View {
        modifier(WotannAccessibleModifier(label: label, hint: hint))
    }

    /// Swaps the given spring animation for a gentle ease-in-out when
    /// Reduce Motion is enabled. Use on animated state transitions.
    func respectsReduceMotion<V: Equatable>(
        _ spring: SwiftUI.Animation = WTheme.Animation.smooth,
        value: V
    ) -> some View {
        modifier(RespectReduceMotionModifier(spring: spring, value: value))
    }

    /// Ensures a minimum 44x44pt hit target with Rectangle content shape.
    /// Pass an optional `onTap` to attach a light-haptic-backed tap.
    func hitTarget(onTap: (() -> Void)? = nil) -> some View {
        modifier(HitTargetModifier(onTap: onTap))
    }
}
