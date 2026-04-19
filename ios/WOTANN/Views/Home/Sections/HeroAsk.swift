import SwiftUI

// MARK: - HeroAsk

/// A 120pt rounded pill CTA reading "What do you want to build?".
/// - Tap: opens the AskComposer sheet.
/// - Long-press (0.5s, heavy haptic): opens the voice-first sheet.
/// Layout: leading mic glyph, centered title, trailing arrow.
struct HeroAsk: View {
    let onTap: () -> Void
    let onLongPress: () -> Void

    @State private var isPressed: Bool = false
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    var body: some View {
        Button(action: {
            Haptics.shared.buttonTap()
            onTap()
        }) {
            HStack(spacing: WTheme.Spacing.md) {
                Image(systemName: "mic.fill")
                    .font(.wotannScaled(size: 22, weight: .semibold))
                    .foregroundColor(WTheme.Colors.primary)
                    .frame(width: 40, height: 40)
                    .background(WTheme.Colors.primary.opacity(0.15))
                    .clipShape(Circle())
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                    Text("What do you want to build?")
                        .font(WTheme.Typography.titleDisplay)
                        .tracking(WTheme.Tracking.titleDisplay)
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    Text("Tap to ask · Hold to speak")
                        .font(WTheme.Typography.captionStd)
                        .tracking(WTheme.Tracking.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }

                Spacer(minLength: 0)

                Image(systemName: "arrow.up.right")
                    .font(.wotannScaled(size: 20, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 40, height: 40)
                    .background(WTheme.Colors.primary)
                    .clipShape(Circle())
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.md)
            .frame(height: 120)
            .frame(maxWidth: .infinity)
            .background(heroBackground)
            .overlay(heroStroke)
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.xl, style: .continuous))
            .scaleEffect(isPressed ? 0.98 : 1.0)
            .shadow(
                color: WTheme.Colors.primary.opacity(0.15),
                radius: 20,
                x: 0,
                y: 8
            )
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.5)
                .onEnded { _ in
                    Haptics.shared.longPressStart()
                    onLongPress()
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    if !isPressed {
                        withAnimation(reduceMotion ? .easeInOut(duration: 0.15) : .spring(duration: 0.2, bounce: 0.2)) {
                            isPressed = true
                        }
                    }
                }
                .onEnded { _ in
                    withAnimation(reduceMotion ? .easeInOut(duration: 0.15) : .spring(duration: 0.25, bounce: 0.25)) {
                        isPressed = false
                    }
                }
        )
        .wotannAccessible(
            label: "Ask WOTANN. What do you want to build?",
            hint: "Tap to type. Long-press to speak."
        )
    }

    // MARK: - Styling

    private var heroBackground: some View {
        LinearGradient(
            colors: [
                WTheme.Colors.surface,
                WTheme.Colors.surfaceAlt.opacity(0.8),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var heroStroke: some View {
        RoundedRectangle(cornerRadius: WTheme.Radius.xl, style: .continuous)
            .stroke(WTheme.Colors.primary.opacity(0.25), lineWidth: 1)
    }
}
