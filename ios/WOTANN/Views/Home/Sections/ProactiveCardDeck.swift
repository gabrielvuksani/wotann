import SwiftUI

// MARK: - ProactiveCardDeck

/// Up to 3 swipeable cards surfaced from live state. NO placeholder data —
/// every card is derived from `appState` or `connectionManager`:
/// - Cost spike      → when `todayCost / weeklyBudget` exceeds a threshold
/// - Agent attention → when any agent needs approval
/// - Agent completed → when the most recent agent just finished
/// If no cards apply, the deck renders nothing (section collapses).
struct ProactiveCardDeck: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    @State private var currentIndex: Int = 0

    var body: some View {
        let cards = generateCards()
        if cards.isEmpty {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                Text("FOR YOU")
                    .font(WTheme.Typography.captionStd)
                    .tracking(WTheme.Tracking.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)

                TabView(selection: $currentIndex) {
                    ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                        ProactiveCardView(card: card)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: cards.count > 1 ? .automatic : .never))
                .indexViewStyle(.page(backgroundDisplayMode: .never))
                .frame(height: 130)
            }
        }
    }

    // MARK: - Live Card Derivation

    /// Derives up to 3 cards from live state. The card count and ordering
    /// is a pure function of current state, so UI never shows stale data.
    private func generateCards() -> [ProactiveCard] {
        var cards: [ProactiveCard] = []

        // Card 1: cost budget check
        let snapshot = appState.costSnapshot
        if snapshot.weeklyBudget > 0 {
            let pct = snapshot.budgetPercent
            if pct >= 0.8 {
                cards.append(
                    ProactiveCard(
                        id: "cost-alert",
                        icon: "dollarsign.circle.fill",
                        color: WTheme.Colors.warning,
                        title: "Cost alert",
                        body: String(
                            format: "You've used %d%% of this week's $%.0f budget.",
                            Int(pct * 100),
                            snapshot.weeklyBudget
                        ),
                        ctaLabel: "Review spending",
                        action: .openSettings
                    )
                )
            }
        }

        // Card 2: any agent needs approval
        if let pending = appState.agents.first(where: { $0.status == .approvalRequired }) {
            cards.append(
                ProactiveCard(
                    id: "approval-\(pending.id.uuidString)",
                    icon: "hand.raised.fill",
                    color: WTheme.Colors.warning,
                    title: "Needs your approval",
                    body: pending.title,
                    ctaLabel: "Review",
                    action: .openAgent(pending.id)
                )
            )
        }

        // Card 3: most recent completion
        if let recentDone = appState.agents
            .filter({ $0.status == .completed })
            .sorted(by: { ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast) })
            .first,
           let completedAt = recentDone.completedAt,
           Date.now.timeIntervalSince(completedAt) < 3600 * 6 {
            cards.append(
                ProactiveCard(
                    id: "done-\(recentDone.id.uuidString)",
                    icon: "checkmark.circle.fill",
                    color: WTheme.Colors.success,
                    title: "Just finished",
                    body: recentDone.title,
                    ctaLabel: "View results",
                    action: .openAgent(recentDone.id)
                )
            )
        }

        return Array(cards.prefix(3))
    }
}

// MARK: - ProactiveCard Model

/// A purely data-driven proactive card. No mock content — every field is
/// filled from live state by `generateCards()`.
private struct ProactiveCard: Identifiable, Equatable {
    let id: String
    let icon: String
    let color: Color
    let title: String
    let body: String
    let ctaLabel: String
    let action: Action

    enum Action: Equatable {
        case openAgent(UUID)
        case openSettings
    }
}

// MARK: - ProactiveCardView

/// The actual card rendering: icon + title/body + CTA button.
private struct ProactiveCardView: View {
    @EnvironmentObject var appState: AppState
    let card: ProactiveCard

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            Image(systemName: card.icon)
                .font(.wotannScaled(size: 22, weight: .semibold))
                .foregroundColor(card.color)
                .frame(width: 40, height: 40)
                .background(card.color.opacity(0.15))
                .clipShape(Circle())
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                Text(card.title)
                    .font(WTheme.Typography.roundedHeadline)
                    .tracking(WTheme.Tracking.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)
                Text(card.body)
                    .font(WTheme.Typography.footnoteStd)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            Button {
                Haptics.shared.buttonTap()
                fire(card.action)
            } label: {
                Text(card.ctaLabel)
                    .font(WTheme.Typography.captionStd)
                    .foregroundColor(.white)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .frame(minHeight: 36)
                    .background(card.color)
                    .clipShape(Capsule())
            }
            .buttonStyle(.plain)
        }
        .padding(WTheme.Spacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous)
                .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .padding(.horizontal, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.title). \(card.body)")
    }

    private func fire(_ action: ProactiveCard.Action) {
        switch action {
        case .openAgent(let id):
            appState.activeTab = 2
            appState.deepLinkAgentId = id
        case .openSettings:
            appState.activeTab = 3
        }
    }
}
