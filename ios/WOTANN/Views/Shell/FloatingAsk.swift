import SwiftUI

// MARK: - FloatingAsk

/// A 56pt floating capsule button centered above the tab bar.
/// Tap: presents the `AskComposer` sheet.
/// Long-press (0.5s, heavy haptic): presents a voice-first composer.
///
/// Visual: Apple-blue linear gradient fill, ultra-thin material backdrop ring,
/// + a soft blue glow shadow at 0.5 opacity. Spring scale on press.
struct FloatingAsk: View {
    /// Bound by `MainShell`. When true, Ask composer presents.
    @Binding var showComposer: Bool
    /// Bound by `MainShell`. When true, the voice-first sheet presents.
    @Binding var showVoiceSheet: Bool
    /// Extra vertical offset (e.g. when scroll direction changes).
    var extraOffset: CGFloat = 0

    @State private var isPressed: Bool = false
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    var body: some View {
        Button {
            Haptics.shared.buttonTap()
            showComposer = true
        } label: {
            label
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.5)
                .onEnded { _ in
                    Haptics.shared.longPressStart()
                    showVoiceSheet = true
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
        .offset(y: extraOffset)
        .animation(WTheme.Animation.smooth, value: extraOffset)
        .wotannAccessible(label: "Ask WOTANN", hint: "Tap to compose a prompt. Long-press for voice input.")
    }

    // MARK: - Label

    private var label: some View {
        ZStack {
            // Glow shadow (Apple blue at 0.5 opacity).
            Circle()
                .fill(WTheme.Colors.primary)
                .frame(width: 56, height: 56)
                .shadow(color: WTheme.Colors.primary.opacity(0.5), radius: 16, x: 0, y: 4)

            // Material backdrop ring under the gradient for subtle depth.
            Circle()
                .stroke(Color.white.opacity(0.18), lineWidth: 0.75)
                .frame(width: 56, height: 56)

            // Apple blue gradient overlay.
            Circle()
                .fill(
                    LinearGradient(
                        colors: [
                            WTheme.Colors.primary,
                            WTheme.Colors.primaryPressed,
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: 56, height: 56)

            Image(systemName: "sparkles")
                .font(.system(size: 24, weight: .semibold))
                .foregroundColor(.white)
                .accessibilityHidden(true)
        }
        .scaleEffect(isPressed ? 0.92 : 1.0)
    }
}
