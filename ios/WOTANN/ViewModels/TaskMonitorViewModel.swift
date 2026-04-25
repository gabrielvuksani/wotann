import Foundation
import Observation

// MARK: - TaskMonitorViewModel
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. No current `@StateObject`/`@ObservedObject` consumer
// references this view-model; it is a forward-compatible scaffold that, when
// wired into a TaskMonitorView, should be adopted as:
//   `@State private var vm = TaskMonitorViewModel(...)`
//   `@Bindable var vm: TaskMonitorViewModel` (for `Picker(selection: $vm.filterState)`).

/// Monitors running agent tasks and provides actions.
@MainActor
@Observable
final class TaskMonitorViewModel {
    var agents: [AgentTask] = []
    var selectedAgent: AgentTask?
    var isLoading = false
    var filterState: TaskState?

    @ObservationIgnored
    private let appState: AppState
    @ObservationIgnored
    private let connectionManager: ConnectionManager

    init(appState: AppState, connectionManager: ConnectionManager) {
        self.appState = appState
        self.connectionManager = connectionManager
        self.agents = appState.agents
    }

    var filteredAgents: [AgentTask] {
        guard let filter = filterState else { return agents }
        return agents.filter { $0.status == filter }
    }

    var activeCount: Int {
        agents.filter { $0.status.isActive }.count
    }

    var totalCost: Double {
        agents.reduce(0) { $0 + $1.cost }
    }

    // MARK: - Actions

    func refresh() async {
        isLoading = true
        do {
            agents = try await connectionManager.rpcClient.getAgents()
            appState.agents = agents
        } catch {
            // Keep existing
        }
        isLoading = false
    }

    func approveAction(for taskId: UUID) async {
        do {
            try await connectionManager.rpcClient.approveAction(taskId: taskId)
            HapticService.shared.trigger(.taskComplete)
        } catch {
            HapticService.shared.trigger(.error)
        }
    }

    func rejectAction(for taskId: UUID) async {
        do {
            try await connectionManager.rpcClient.rejectAction(taskId: taskId)
            HapticService.shared.trigger(.selection)
        } catch {
            HapticService.shared.trigger(.error)
        }
    }

    func cancelTask(_ taskId: UUID) async {
        do {
            try await connectionManager.rpcClient.cancelTask(taskId: taskId)
            appState.updateAgent(taskId) { $0.status = .cancelled }
            HapticService.shared.trigger(.selection)
        } catch {
            HapticService.shared.trigger(.error)
        }
    }
}
