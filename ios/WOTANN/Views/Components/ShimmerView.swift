import SwiftUI

// MARK: - ShimmerView

/// Animated skeleton placeholder for loading states.
struct ShimmerView: View {
    var width: CGFloat? = nil
    var height: CGFloat = 16
    var cornerRadius: CGFloat = WTheme.Radius.sm

    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var phase: CGFloat = 0

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius)
            .fill(WTheme.Colors.surface)
            .overlay(
                Group {
                    if !reduceMotion {
                        GeometryReader { geometry in
                            LinearGradient(
                                colors: [
                                    WTheme.Colors.surface,
                                    WTheme.Colors.surfaceAlt.opacity(0.5),
                                    WTheme.Colors.surface,
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .frame(width: geometry.size.width * 0.6)
                            .offset(x: -geometry.size.width * 0.3 + geometry.size.width * 1.3 * phase)
                            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
                        }
                    }
                }
            )
            .frame(width: width, height: height)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 1.2).repeatForever(autoreverses: false)) {
                    phase = 1
                }
            }
    }
}

// MARK: - Message Skeleton

/// Skeleton for a message row in chat.
struct MessageSkeleton: View {
    var body: some View {
        HStack(alignment: .top, spacing: WTheme.Spacing.sm) {
            ShimmerView(width: 32, height: 32, cornerRadius: 16)
            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                ShimmerView(width: 100, height: 12)
                ShimmerView(height: 14)
                ShimmerView(width: 200, height: 14)
            }
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
    }
}

// MARK: - Conversation Skeleton

/// Skeleton for a conversation list row.
struct ConversationSkeleton: View {
    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            ShimmerView(width: 8, height: 8, cornerRadius: 4)
            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                ShimmerView(width: 160, height: 12)
                ShimmerView(height: 10)
            }
            Spacer()
            ShimmerView(width: 40, height: 10)
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
    }
}
