import SwiftUI

// MARK: - StreamingView

/// Phase C streaming indicator. Replaces the legacy three-dot bouncer
/// with a 2pt-tall "rune line" that fills horizontally as tokens arrive.
/// The bar pulses subtly during flow and emits a soft haptic tick every
/// 500ms via `Haptics.shared.streamingToken()`.
///
/// The view accepts an optional `progress` (0-1) from the caller when the
/// token count is known. When no progress is supplied it auto-animates
/// back-and-forth to communicate "thinking" without claiming a known
/// fraction.
struct StreamingView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Optional 0-1 progress driven by token arrival. `nil` = indeterminate.
    var progress: Double? = nil
    /// Whether to tick a haptic every 500ms while streaming.
    var emitHaptics: Bool = true

    @State private var indeterminateOffset: CGFloat = 0
    @State private var hapticTimer: Timer?

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                // Track
                Capsule()
                    .fill(WTheme.Colors.surface)
                    .frame(height: 2)

                // Fill
                if let progress {
                    Capsule()
                        .fill(WTheme.Colors.primary)
                        .frame(
                            width: max(4, CGFloat(min(max(progress, 0), 1)) * geo.size.width),
                            height: 2
                        )
                        .animation(.spring(duration: 0.35, bounce: 0.15), value: progress)
                } else {
                    let segmentWidth = geo.size.width * 0.4
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [
                                    WTheme.Colors.primary.opacity(0.0),
                                    WTheme.Colors.primary,
                                    WTheme.Colors.primary.opacity(0.0),
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: segmentWidth, height: 2)
                        .offset(x: indeterminateOffset)
                        .onAppear {
                            if !reduceMotion {
                                indeterminateOffset = -segmentWidth
                                withAnimation(
                                    .linear(duration: 1.25).repeatForever(autoreverses: false)
                                ) {
                                    indeterminateOffset = geo.size.width
                                }
                            } else {
                                indeterminateOffset = 0
                            }
                        }
                }
            }
        }
        .frame(height: 2)
        .onAppear(perform: startHaptics)
        .onDisappear(perform: stopHaptics)
        .accessibilityLabel("Streaming response")
    }

    // MARK: - Haptic Ticker

    private func startHaptics() {
        guard emitHaptics, !reduceMotion else { return }
        hapticTimer?.invalidate()
        hapticTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            Haptics.shared.streamingToken()
        }
    }

    private func stopHaptics() {
        hapticTimer?.invalidate()
        hapticTimer = nil
    }
}

// MARK: - StreamingBanner

/// Thin banner at the top of the chat input area showing streaming status.
struct StreamingBanner: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shimmerOffset: CGFloat = -200

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            StreamingDots()
            Text("WOTANN is thinking...")
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textSecondary)
            Spacer()
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        .background(
            WTheme.Colors.primary.opacity(0.08)
                .overlay(
                    Group {
                        if !reduceMotion {
                            LinearGradient(
                                colors: [.clear, WTheme.Colors.primary.opacity(0.05), .clear],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .offset(x: shimmerOffset)
                        }
                    }
                )
        )
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 2).repeatForever(autoreverses: false)) {
                shimmerOffset = 400
            }
        }
    }
}

#Preview {
    VStack(spacing: 24) {
        StreamingView()
            .padding(.horizontal)
        StreamingView(progress: 0.45)
            .padding(.horizontal)
        StreamingBanner()
    }
    .padding(.vertical)
    .background(Color.black)
    .preferredColorScheme(.dark)
}
