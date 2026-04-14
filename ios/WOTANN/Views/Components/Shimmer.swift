import SwiftUI

// MARK: - ShimmerList

/// A 3-row shimmering list used for "loading collection" states.
/// Uses TimelineView to drive opacity 0.3 → 0.6 → 0.3 over a 1.2s cycle —
/// cheaper than a spring animation because it runs on the render thread
/// and does not cause SwiftUI view diffing.
struct ShimmerList: View {
    /// Number of rows to render. Defaults to 3.
    var rowCount: Int = 3
    /// Row height. Matches our standard list row at 44pt + 12pt padding.
    var height: CGFloat = 56
    /// Row corner radius.
    var radius: CGFloat = WTheme.Radius.md
    /// Row horizontal inset.
    var horizontalPadding: CGFloat = WTheme.Spacing.md
    /// Vertical spacing between rows.
    var spacing: CGFloat = WTheme.Spacing.sm

    @Environment(\.accessibilityReduceMotion) var reduceMotion

    var body: some View {
        VStack(spacing: spacing) {
            ForEach(0..<rowCount, id: \.self) { _ in
                shimmerRow
            }
        }
        .padding(.horizontal, horizontalPadding)
        .accessibilityHidden(true) // decorative
    }

    @ViewBuilder
    private var shimmerRow: some View {
        if reduceMotion {
            // Flat surface for reduce motion — no opacity cycling.
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(WTheme.Colors.surface)
                .frame(height: height)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { context in
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(WTheme.Colors.surface)
                    .opacity(opacity(at: context.date))
                    .frame(height: height)
            }
        }
    }

    /// Opacity cycles 0.3 → 0.6 → 0.3 over 1.2 seconds.
    private func opacity(at date: Date) -> Double {
        let cycle: TimeInterval = 1.2
        let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle
        // Triangle wave 0 → 1 → 0 over a full cycle.
        let triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2
        return 0.3 + Double(triangle) * 0.3
    }
}
