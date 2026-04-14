import SwiftUI

// MARK: - LiveAgentsStrip

/// Horizontal strip of 120x88 cards showing active agents.
/// Each card has a pulsing status dot + progress ring + title + provider.
/// Only rendered by HomeView when `appState.activeAgents.count > 0`.
/// Tapping a card switches to the Work tab.
struct LiveAgentsStrip: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack {
                Text("LIVE")
                    .font(WTheme.Typography.captionStd)
                    .tracking(WTheme.Tracking.caption)
                    .foregroundColor(WTheme.Colors.success)
                Text("·")
                    .foregroundColor(WTheme.Colors.textTertiary)
                Text("\(appState.activeAgents.count) active")
                    .font(WTheme.Typography.captionStd)
                    .foregroundColor(WTheme.Colors.textSecondary)
                Spacer()
                Button("See all") {
                    Haptics.shared.buttonTap()
                    appState.activeTab = 2
                }
                .font(WTheme.Typography.captionStd)
                .foregroundColor(WTheme.Colors.primary)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: WTheme.Spacing.sm) {
                    ForEach(appState.activeAgents) { agent in
                        Button {
                            Haptics.shared.buttonTap()
                            appState.activeTab = 2
                            appState.deepLinkAgentId = agent.id
                        } label: {
                            AgentCard(agent: agent)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 2)
            }
        }
    }
}

// MARK: - AgentCard

/// A compact 120x88 live-agent card used in LiveAgentsStrip.
private struct AgentCard: View {
    let agent: AgentTask

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack(spacing: WTheme.Spacing.xs) {
                PulsingDot(color: statusColor(for: agent.status))
                Text(agent.status.displayName)
                    .font(WTheme.Typography.captionStd)
                    .foregroundColor(WTheme.Colors.textSecondary)
                Spacer()
                ZStack {
                    Circle()
                        .stroke(WTheme.Colors.surfaceAlt, lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: CGFloat(max(0, min(1, agent.progress))))
                        .stroke(
                            statusColor(for: agent.status),
                            style: StrokeStyle(lineWidth: 2, lineCap: .round)
                        )
                        .rotationEffect(.degrees(-90))
                }
                .frame(width: 16, height: 16)
            }

            Text(agent.title)
                .font(WTheme.Typography.captionStd)
                .fontWeight(.semibold)
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(2)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)

            Text(agent.provider.capitalized)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(WTheme.Colors.provider(agent.provider))
        }
        .padding(WTheme.Spacing.sm)
        .frame(width: 120, height: 88, alignment: .topLeading)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.title), \(agent.status.displayName), \(Int(agent.progress * 100)) percent")
    }
}

// MARK: - PulsingDot

/// A small pulsing dot that uses TimelineView for cheap opacity cycling.
private struct PulsingDot: View {
    let color: Color
    @Environment(\.accessibilityReduceMotion) var reduceMotion

    var body: some View {
        if reduceMotion {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { context in
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                    .opacity(opacity(at: context.date))
            }
        }
    }

    private func opacity(at date: Date) -> Double {
        let cycle: TimeInterval = 1.4
        let phase = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle
        let triangle = phase < 0.5 ? phase * 2 : (1 - phase) * 2
        return 0.4 + Double(triangle) * 0.6
    }
}
