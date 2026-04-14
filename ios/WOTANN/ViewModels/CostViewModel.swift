import Foundation
import Combine

// MARK: - CostViewModel

/// Manages cost data with daily/weekly/monthly breakdowns.
@MainActor
final class CostViewModel: ObservableObject {
    @Published var snapshot: CostSnapshot = .empty
    @Published var isLoading = false
    @Published var selectedPeriod: CostPeriod = .week
    @Published var weeklyBudget: Double = 50.0
    @Published var showBudgetEditor = false

    private let appState: AppState
    private let connectionManager: ConnectionManager

    enum CostPeriod: String, CaseIterable {
        case day   = "Today"
        case week  = "Week"
        case month = "Month"
    }

    init(appState: AppState, connectionManager: ConnectionManager) {
        self.appState = appState
        self.connectionManager = connectionManager
        self.snapshot = appState.costSnapshot
    }

    var displayAmount: Double {
        switch selectedPeriod {
        case .day:   return snapshot.todayTotal
        case .week:  return snapshot.weekTotal
        case .month: return snapshot.monthTotal
        }
    }

    var budgetRemaining: Double {
        snapshot.budgetRemaining
    }

    var budgetPercent: Double {
        snapshot.budgetPercent
    }

    var topProviders: [ProviderCost] {
        snapshot.byProvider.sorted { $0.amount > $1.amount }
    }

    var dailyCosts: [DayCost] {
        snapshot.byDay
    }

    // MARK: - Actions

    func refresh() async {
        isLoading = true
        do {
            snapshot = try await connectionManager.rpcClient.getCost()
            appState.costSnapshot = snapshot
        } catch {
            // Keep existing data
        }
        isLoading = false
    }

    func setBudget(_ amount: Double) {
        weeklyBudget = amount
        showBudgetEditor = false
    }
}
