import Foundation
import Observation

// MARK: - CostViewModel
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. Every stored property is automatically tracked, so the
// `@Published` wrappers are dropped. SwiftUI views invalidate per-property
// instead of per-publish, eliminating Combine fan-out on every refresh.
//
// Consumer migration (when this VM gets wired into a Cost view):
//   - `@StateObject private var vm = CostViewModel(...)`
//       → `@State private var vm = CostViewModel(...)`
//   - `@ObservedObject var vm: CostViewModel`
//       → `var vm: CostViewModel` (read-only) or
//         `@Bindable var vm: CostViewModel` (two-way bindings, e.g.
//         `Picker(selection: $vm.selectedPeriod)`).

/// Manages cost data with daily/weekly/monthly breakdowns.
@MainActor
@Observable
final class CostViewModel {
    var snapshot: CostSnapshot = .empty
    var isLoading = false
    var selectedPeriod: CostPeriod = .week
    var weeklyBudget: Double = 50.0
    var showBudgetEditor = false

    @ObservationIgnored
    private let appState: AppState
    @ObservationIgnored
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
