import SwiftUI

// MARK: - CostDashboardView

/// Cost tracking dashboard with period selectors and breakdowns.
struct CostDashboardView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var selectedPeriod: CostPeriod = .week
    @State private var isRefreshing = false

    enum CostPeriod: String, CaseIterable {
        case day   = "Today"
        case week  = "Week"
        case month = "Month"
    }

    var displayAmount: Double {
        switch selectedPeriod {
        case .day:   return appState.costSnapshot.todayTotal
        case .week:  return appState.costSnapshot.weekTotal
        case .month: return appState.costSnapshot.monthTotal
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: WTheme.Spacing.lg) {
                    // Period selector
                    periodSelector

                    // Main amount
                    mainCostDisplay

                    // Session cost
                    sessionCostCard

                    // Provider breakdown
                    providerBreakdown

                    // Daily chart
                    dailyChart

                    // Budget
                    budgetSection
                }
                .padding()
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Cost")
            .refreshable {
                isRefreshing = true
                do {
                    appState.costSnapshot = try await connectionManager.rpcClient.getCost()
                } catch {
                    // Keep existing
                }
                isRefreshing = false
            }
        }
    }

    // MARK: - Sections

    private var periodSelector: some View {
        HStack(spacing: 0) {
            ForEach(CostPeriod.allCases, id: \.self) { period in
                Button {
                    withAnimation(WTheme.Animation.quick) {
                        selectedPeriod = period
                    }
                    HapticService.shared.trigger(.selection)
                } label: {
                    Text(period.rawValue)
                        .font(WTheme.Typography.subheadline)
                        .fontWeight(selectedPeriod == period ? .bold : .regular)
                        .foregroundColor(
                            selectedPeriod == period
                                ? WTheme.Colors.textPrimary
                                : WTheme.Colors.textTertiary
                        )
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, WTheme.Spacing.sm)
                        .background(
                            selectedPeriod == period
                                ? WTheme.Colors.primary.opacity(0.15)
                                : Color.clear
                        )
                }
                .accessibilityLabel("\(period.rawValue) cost period")
                .accessibilityHint("Show costs for \(period.rawValue.lowercased())")
                .accessibilityAddTraits(selectedPeriod == period ? .isSelected : [])
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
    }

    private var mainCostDisplay: some View {
        VStack(spacing: WTheme.Spacing.sm) {
            Text(selectedPeriod.rawValue)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)

            CostLabel(amount: displayAmount, style: .large)

            if appState.costSnapshot.byProvider.isEmpty {
                Text("No cost data available")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .frame(maxWidth: .infinity)
        .wCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(selectedPeriod.rawValue) cost: $\(String(format: "%.2f", displayAmount))")
    }

    private var sessionCostCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text("Current Session")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textSecondary)
                CostLabel(amount: appState.costSnapshot.sessionTotal, style: .large)
            }
            Spacer()
            Image(systemName: "bolt.fill")
                .font(.title)
                .foregroundColor(.wotannCyan)
        }
        .wCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Current session cost: $\(String(format: "%.2f", appState.costSnapshot.sessionTotal))")
    }

    private var providerBreakdown: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
            Text("By Provider")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)

            if appState.costSnapshot.byProvider.isEmpty {
                HStack {
                    Text("No provider data")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textTertiary)
                    Spacer()
                }
            } else {
                ForEach(appState.costSnapshot.byProvider.sorted(by: { $0.amount > $1.amount })) { provider in
                    providerRow(provider)
                }
            }
        }
        .wCard()
    }

    private func providerRow(_ provider: ProviderCost) -> some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Circle()
                .fill(WTheme.Colors.provider(provider.name))
                .frame(width: 8, height: 8)

            Text(provider.name.capitalized)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                CostLabel(amount: provider.amount)
                Text("\(provider.requestCount) requests")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
    }

    private var dailyChart: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
            Text("Daily Costs")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)

            if appState.costSnapshot.byDay.isEmpty {
                Text("No daily data available")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .frame(height: 120)
                    .frame(maxWidth: .infinity)
            } else {
                CostBarChart(data: appState.costSnapshot.byDay)
                    .frame(height: 120)
            }
        }
        .wCard()
    }

    private var budgetSection: some View {
        BudgetView(
            spent: appState.costSnapshot.weekTotal,
            budget: appState.costSnapshot.weeklyBudget
        )
    }
}

// MARK: - CostBarChart

/// Simple bar chart for daily costs.
struct CostBarChart: View {
    let data: [DayCost]

    private var maxAmount: Double {
        data.map(\.amount).max() ?? 1
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 4) {
            ForEach(data) { day in
                VStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(WTheme.Colors.primary)
                        .frame(height: max(4, CGFloat(day.amount / maxAmount) * 100))

                    Text(shortDay(day.date))
                        .font(WTheme.Typography.caption2)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func shortDay(_ dateString: String) -> String {
        // Extract last 2 chars (day) from date strings like "2025-04-03"
        String(dateString.suffix(2))
    }
}
