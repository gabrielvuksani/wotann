import Foundation
import Combine

// MARK: - TaskMonitorViewModel

/// Monitors running agent tasks and provides actions.
@MainActor
final class TaskMonitorViewModel: ObservableObject {
    @Published var agents: [AgentTask] = []
    @Published var selectedAgent: AgentTask?
    @Published var isLoading = false
    @Published var filterState: TaskState?

    private let appState: AppState
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
