import Foundation
import Combine

#if canImport(ActivityKit)
import ActivityKit
#endif

// MARK: - ProviderInfo

/// Describes a provider available on the desktop WOTANN instance.
/// Synced via the `providers.list` RPC and rendered in Settings → Providers.
struct ProviderInfo: Identifiable, Hashable {
    /// Stable provider identifier (e.g. "anthropic", "openai"). Used as the list key.
    let id: String
    /// User-facing display name (e.g. "Anthropic").
    let name: String
    /// Whether the provider has credentials configured on the desktop.
    let isConfigured: Bool
    /// Models exposed by this provider.
    let models: [String]
    /// The default model the desktop will use for this provider, if any.
    let defaultModel: String?
}

// MARK: - AppState

/// Global app state for the WOTANN iOS companion.
@MainActor
final class AppState: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var activeConversationId: UUID?
    @Published var agents: [AgentTask] = []
    @Published var costSnapshot: CostSnapshot = .empty
    @Published var availableProviders: [ProviderInfo] = []
    @Published var isLoading = false
    @Published var currentProvider = "anthropic"
    @Published var currentModel = "claude-opus-4-6"
    @Published var activeTab: Int = 0
    @Published var showMeetModeSheet = false
    @Published var deepLinkAgentId: UUID?
    @Published var deepLinkDestination: String?

    /// Observer for reconnect-triggered re-syncs.
    private var reconnectSubscription: AnyCancellable?

    #if canImport(ActivityKit)
    /// Tracks running Live Activities keyed by task ID.
    private var liveActivities: [UUID: Activity<TaskProgressAttributes>] = [:]
    #endif

    /// Shared UserDefaults for widget data exchange.
    private let sharedDefaults = UserDefaults(suiteName: "group.com.wotann.shared")

    var activeConversation: Conversation? {
        conversations.first { $0.id == activeConversationId }
    }

    var activeAgents: [AgentTask] {
        agents.filter { $0.status.isActive }
    }

    var todayCost: Double { costSnapshot.todayTotal }
    var sessionCost: Double { costSnapshot.sessionTotal }

    // MARK: - Conversation Mutations (Immutable-Style)

    func addConversation(_ conversation: Conversation) {
        var updated = conversations
        updated.insert(conversation, at: 0)
        conversations = updated
        activeConversationId = conversation.id
        writeRecentConversationsToSharedDefaults()
    }

    func updateConversation(_ id: UUID, transform: (inout Conversation) -> Void) {
        guard let index = conversations.firstIndex(where: { $0.id == id }) else { return }
        var updated = conversations
        var conv = updated[index]
        transform(&conv)
        updated[index] = conv
        conversations = updated
        writeRecentConversationsToSharedDefaults()
    }

    func removeConversation(_ id: UUID) {
        conversations = conversations.filter { $0.id != id }
        if activeConversationId == id {
            activeConversationId = conversations.first?.id
        }
        writeRecentConversationsToSharedDefaults()
    }

    // MARK: - Agent Mutations

    func updateAgent(_ id: UUID, transform: (inout AgentTask) -> Void) {
        guard let index = agents.firstIndex(where: { $0.id == id }) else { return }
        var updated = agents
        var agent = updated[index]
        let previousStatus = agent.status
        transform(&agent)
        updated[index] = agent
        agents = updated
        writeAgentStatusToSharedDefaults()

        // A4: fire push notifications when an agent transitions into a
        // terminal state so users don't have to keep the app in the
        // foreground to know the task is done.
        if previousStatus != agent.status {
            switch agent.status {
            case .completed:
                NotificationService.shared.notifyTaskComplete(title: agent.title, taskId: agent.id)
            case .failed:
                NotificationService.shared.notifyTaskFailed(
                    title: agent.title,
                    error: agent.errorMessage ?? "Unknown error",
                    taskId: agent.id
                )
            case .approvalRequired:
                NotificationService.shared.notifyApprovalRequired(title: agent.title, taskId: agent.id)
            default:
                break
            }
        }

        #if canImport(ActivityKit)
        // Update or end Live Activity based on agent state
        if agent.status == .completed || agent.status == .failed || agent.status == .cancelled {
            endTaskActivity(taskId: id)
        } else {
            updateTaskActivity(taskId: id, progress: agent.progress, status: agent.status.displayName)
        }
        #endif
    }

    func addAgent(_ agent: AgentTask) {
        var updated = agents
        updated.insert(agent, at: 0)
        agents = updated
        writeAgentStatusToSharedDefaults()

        #if canImport(ActivityKit)
        startTaskActivity(taskId: agent.id, taskName: agent.title)
        #endif
    }

    // MARK: - Sync

    func syncFromDesktop(using rpcClient: RPCClient) async {
        // On first call, subscribe to connection transitions so we re-sync
        // automatically whenever the underlying RPC connection comes back up
        // after a reconnect. The subscription is idempotent — re-invoking
        // `syncFromDesktop` is safe.
        if reconnectSubscription == nil {
            reconnectSubscription = rpcClient.$isConnected
                .removeDuplicates()
                .receive(on: DispatchQueue.main)
                .sink { [weak self, weak rpcClient] connected in
                    guard connected, let self, let client = rpcClient else { return }
                    Task { @MainActor in
                        await self.syncFromDesktop(using: client)
                    }
                }
        }

        isLoading = true
        defer { isLoading = false }

        async let convos = rpcClient.getConversations()
        async let tasks = rpcClient.getAgents()
        async let cost = rpcClient.getCost()
        async let providers = rpcClient.getProviders()

        do {
            let (c, t, cs, p) = try await (convos, tasks, cost, providers)
            conversations = c
            agents = t
            costSnapshot = cs
            availableProviders = Self.decodeProviders(p)
            writeAgentStatusToSharedDefaults()
            writeCostToSharedDefaults()
            writeRecentConversationsToSharedDefaults()
        } catch {
            // Sync failed - keep existing data
        }
    }

    /// Convert the providers.list RPC response (`[String: RPCValue]`) into a
    /// typed array. Accepts two shapes:
    ///
    /// 1. `{ "providers": [ { id, name, configured, models, defaultModel }, ... ] }`
    /// 2. `{ "<providerId>": { name, configured, models, defaultModel }, ... }`
    static func decodeProviders(_ payload: [String: RPCValue]) -> [ProviderInfo] {
        func parseModels(_ value: RPCValue?) -> [String] {
            guard let array = value?.arrayValue else { return [] }
            return array.compactMap { entry in
                if let s = entry.stringValue { return s }
                return entry.objectValue?["id"]?.stringValue
                    ?? entry.objectValue?["name"]?.stringValue
            }
        }

        // Shape 1: { "providers": [...] }
        if let array = payload["providers"]?.arrayValue {
            return array.compactMap { value -> ProviderInfo? in
                guard let obj = value.objectValue else { return nil }
                let id = obj["id"]?.stringValue
                    ?? obj["name"]?.stringValue?.lowercased()
                    ?? ""
                guard !id.isEmpty else { return nil }
                let name = obj["name"]?.stringValue ?? id.capitalized
                let configured = obj["configured"]?.boolValue
                    ?? obj["isConfigured"]?.boolValue
                    ?? false
                let models = parseModels(obj["models"])
                let defaultModel = obj["defaultModel"]?.stringValue
                    ?? obj["default"]?.stringValue
                return ProviderInfo(
                    id: id,
                    name: name,
                    isConfigured: configured,
                    models: models,
                    defaultModel: defaultModel
                )
            }
        }

        // Shape 2: top-level dictionary keyed by provider id
        var out: [ProviderInfo] = []
        for (key, value) in payload {
            guard let obj = value.objectValue else { continue }
            let name = obj["name"]?.stringValue ?? key.capitalized
            let configured = obj["configured"]?.boolValue
                ?? obj["isConfigured"]?.boolValue
                ?? false
            let models = parseModels(obj["models"])
            let defaultModel = obj["defaultModel"]?.stringValue
                ?? obj["default"]?.stringValue
            out.append(ProviderInfo(
                id: key,
                name: name,
                isConfigured: configured,
                models: models,
                defaultModel: defaultModel
            ))
        }
        return out.sorted { $0.name.lowercased() < $1.name.lowercased() }
    }

    // MARK: - Live Activity

    #if canImport(ActivityKit)

    /// Start a Live Activity for a running task.
    /// Shows progress in Dynamic Island and on the Lock Screen.
    func startTaskActivity(taskId: UUID, taskName: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }

        let attributes = TaskProgressAttributes(
            taskId: taskId.uuidString,
            provider: currentProvider,
            model: currentModel
        )
        let initialState = TaskProgressAttributes.ContentState(
            taskTitle: taskName,
            progress: 0,
            status: "Starting",
            cost: 0,
            elapsedSeconds: 0
        )

        do {
            let activity = try Activity<TaskProgressAttributes>.request(
                attributes: attributes,
                content: .init(state: initialState, staleDate: nil),
                pushType: nil
            )
            liveActivities[taskId] = activity
        } catch {
            // Activity request failed -- non-fatal.
        }
    }

    /// Update a running Live Activity with new progress and status.
    func updateTaskActivity(taskId: UUID, progress: Double, status: String) {
        guard let activity = liveActivities[taskId] else { return }

        let agent = agents.first { $0.id == taskId }
        let updatedState = TaskProgressAttributes.ContentState(
            taskTitle: agent?.title ?? "Task",
            progress: progress,
            status: status,
            cost: agent?.cost ?? 0,
            elapsedSeconds: Int(agent?.duration ?? 0)
        )

        Task {
            await activity.update(.init(state: updatedState, staleDate: nil))
        }
    }

    /// End a Live Activity for a completed or cancelled task.
    func endTaskActivity(taskId: UUID) {
        guard let activity = liveActivities.removeValue(forKey: taskId) else { return }

        let agent = agents.first { $0.id == taskId }
        let finalState = TaskProgressAttributes.ContentState(
            taskTitle: agent?.title ?? "Task",
            progress: agent?.progress ?? 1.0,
            status: agent?.status.displayName ?? "Completed",
            cost: agent?.cost ?? 0,
            elapsedSeconds: Int(agent?.duration ?? 0)
        )

        Task {
            await activity.end(.init(state: finalState, staleDate: nil), dismissalPolicy: .default)
        }
    }

    #endif

    // MARK: - Widget Shared Defaults

    /// Write current cost data to shared UserDefaults so the CostWidget can read it.
    func writeCostToSharedDefaults() {
        guard let defaults = sharedDefaults else { return }
        defaults.set(costSnapshot.todayTotal, forKey: "widget.todayCost")
        defaults.set(costSnapshot.weekTotal, forKey: "widget.weekCost")
        defaults.set(costSnapshot.weeklyBudget, forKey: "widget.budget")
        defaults.set(currentProvider, forKey: "widget.provider")
    }

    /// Write the 10 most recent conversation titles to shared UserDefaults
    /// so the Share Extension can show real conversation names.
    func writeRecentConversationsToSharedDefaults() {
        guard let defaults = sharedDefaults else { return }

        let recentTitles = conversations
            .filter { !$0.isArchived }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(10)
            .map(\.title)

        defaults.set(Array(recentTitles), forKey: "recentConversations")
    }

    /// Write current agent status to shared UserDefaults so the AgentStatusWidget can read it.
    func writeAgentStatusToSharedDefaults() {
        guard let defaults = sharedDefaults else { return }

        let agentData: [[String: Any]] = agents.map { agent in
            [
                "id": agent.id.uuidString,
                "name": agent.title,
                "status": agent.status.rawValue,
                "progress": agent.progress,
                "cost": agent.cost,
            ]
        }

        if let jsonData = try? JSONSerialization.data(withJSONObject: agentData),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            defaults.set(jsonString, forKey: "agentStatus")
        }
    }
}
