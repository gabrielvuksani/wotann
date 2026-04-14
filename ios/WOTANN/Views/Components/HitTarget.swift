import SwiftUI

// MARK: - HitTargetButtonStyle

/// Apple HIG requires a minimum 44x44pt tap target. This ButtonStyle
/// enforces that floor while also providing a subtle press-in feedback
/// (scale 0.96 + opacity 0.9). Use this on interactive surfaces where the
/// visual footprint is smaller than 44pt (icons, chevrons, close X).
struct HitTargetButtonStyle: ButtonStyle {
    var pressedScale: CGFloat = 0.96

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? pressedScale : 1.0)
            .opacity(configuration.isPressed ? 0.9 : 1.0)
            .animation(WTheme.Animation.quick, value: configuration.isPressed)
    }
}

// MARK: - IconHitTarget

/// A reusable wrapper that guarantees the minimum 44x44 tap area around a
/// small decorative icon while firing a light haptic on tap.
struct IconHitTarget: View {
    let systemName: String
    let label: String
    let action: () -> Void
    var size: CGFloat = 20
    var tint: Color = WTheme.Colors.textSecondary

    var body: some View {
        Button {
            Haptics.shared.buttonTap()
            action()
        } label: {
            Image(systemName: systemName)
                .font(.system(size: size, weight: .regular))
                .foregroundColor(tint)
        }
        .buttonStyle(HitTargetButtonStyle())
        .wotannAccessible(label: label)
    }
}
