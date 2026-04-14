import SwiftUI

// MARK: - Skeleton

/// Two thin grey lines representing "text is about to appear".
/// Used in chat for the pre-first-token streaming state and anywhere
/// that text is being fetched. The two lines animate their opacity so
/// the view communicates "working" rather than "stuck".
struct Skeleton: View {
    /// Width of the wider (top) line, as a fraction of container width.
    var topWidthFraction: CGFloat = 0.60
    /// Width of the narrower (bottom) line, as a fraction of container width.
    var bottomWidthFraction: CGFloat = 0.40
    /// Height of each line.
    var lineHeight: CGFloat = 10
    /// Vertical spacing between the two lines.
    var lineSpacing: CGFloat = 8

    @Environment(\.accessibilityReduceMotion) var reduceMotion

    var body: some View {
        GeometryReader { geo in
            VStack(alignment: .leading, spacing: lineSpacing) {
                line(width: geo.size.width * topWidthFraction)
                line(width: geo.size.width * bottomWidthFraction)
            }
        }
        .frame(height: lineHeight * 2 + lineSpacing)
        .accessibilityHidden(true) // decorative
    }

    @ViewBuilder
    private func line(width: CGFloat) -> some View {
        if reduceMotion {
            Capsule()
                .fill(WTheme.Colors.surface)
                .frame(width: width, height: lineHeight)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { context in
                Capsule()
                    .fill(WTheme.Colors.surface)
                    .opacity(opacity(at: context.date))
                    .frame(width: width, height: lineHeight)
            }
        }
    }

    /// Opacity cycles 0.3 → 0.6 → 0.3 over 1.2s, same cadence as ShimmerList.
    private func opacity(at date: Date) -> Double {
        let cycle: TimeInterval = 1.2
        let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle
        let triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2
        return 0.3 + Double(triangle) * 0.3
    }
}
