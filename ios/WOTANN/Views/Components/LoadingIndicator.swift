import SwiftUI

// MARK: - LoadingIndicator

/// Branded loading animation with a pulsing "W" glyph.
struct LoadingIndicator: View {
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var isAnimating = false
    var size: CGFloat = 48
    var color: Color = WTheme.Colors.primary

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.15))
                .frame(width: size * 1.5, height: size * 1.5)
                .scaleEffect(reduceMotion ? 1.0 : (isAnimating ? 1.2 : 0.8))
                .opacity(reduceMotion ? 0.3 : (isAnimating ? 0.0 : 0.6))

            Text("W")
                .font(.system(size: size * 0.6, weight: .black, design: .rounded))
                .foregroundColor(color)
                .scaleEffect(reduceMotion ? 1.0 : (isAnimating ? 1.05 : 0.95))
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                isAnimating = true
            }
        }
    }
}

// MARK: - StreamingDots

/// Animated three-dot indicator for streaming state.
struct StreamingDots: View {
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var phase = 0
    @State private var timer: Timer?

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(WTheme.Colors.primary)
                    .frame(width: 6, height: 6)
                    .scaleEffect(reduceMotion ? 1.0 : (phase == index ? 1.3 : 0.7))
                    .opacity(reduceMotion ? 0.6 : (phase == index ? 1.0 : 0.4))
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in
                withAnimation(WTheme.Animation.quick) {
                    phase = (phase + 1) % 3
                }
            }
        }
        .onDisappear {
            timer?.invalidate()
            timer = nil
        }
    }
}

// MARK: - FullScreenLoading

/// Full-screen centered loading overlay.
struct FullScreenLoading: View {
    var message: String = "Loading..."

    var body: some View {
        VStack(spacing: WTheme.Spacing.md) {
            LoadingIndicator()
            Text(message)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WTheme.Colors.background.opacity(0.9))
    }
}

#Preview {
    VStack(spacing: 40) {
        LoadingIndicator()
        StreamingDots()
        FullScreenLoading(message: "Connecting...")
    }
    .preferredColorScheme(.dark)
}
