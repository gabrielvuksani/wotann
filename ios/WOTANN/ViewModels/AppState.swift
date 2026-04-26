import Foundation
import Combine
import os.log

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
    // Provider neutrality fix: empty string is the "not configured" sentinel.
    // First-pair onboarding populates these from the user's actual configured
    // provider/model. No implicit anthropic / claude-opus-4-6 bias.
    @Published var currentProvider = ""
    @Published var currentModel = ""
    @Published var activeTab: Int = 0
    @Published var showMeetModeSheet = false
    @Published var deepLinkAgentId: UUID?
    @Published var deepLinkDestination: String?
    /// User's selected text payload for Writing Tools (rewrite/summarize/expand)
    /// + Ask intents. Set by `processControlIntentRequests` (WOTANNApp.swift)
    /// from the @Parameter the iOS Writing Tools host passes through. Cleared
    /// by the receiving view once it consumes the payload.
    @Published var deepLinkPayload: String?

    /// Observer for reconnect-triggered re-syncs.
    private var reconnectSubscription: AnyCancellable?

    // S5-11: Live Activities are managed by `LiveActivityManager.shared`.
    // Keeping a thin reference on AppState avoids threading it through every
    // call site while preserving the single source of truth in the manager.
    private let liveActivities = LiveActivityManager.shared

    // MARK: - Debounce State (S4-22)
    //
    // High-frequency streaming updates (per-token deltas from the daemon) fan
    // into `updateConversation`. Without coalescing, every token publishes a
    // new `conversations` array, re-rendering every ConversationRow. We batch
    // the writes for each conversation on a 300 ms trailing window so SwiftUI
    // receives one publish per window instead of one per token.
    //
    // Structural edits (add/remove) bypass debouncing so they remain visible
    // immediately — only repeated in-place mutations on a single conversation
    // are coalesced.

    /// Pending transforms keyed by conversation id. Applied in arrival order
    /// when the debounce task fires.
    private var pendingConversationTransforms: [UUID: [(inout Conversation) -> Void]] = [:]

    /// Per-conversation debounce task. Cancelled and replaced on each call so
    /// only the last-scheduled task fires.
    private var debounceTasks: [UUID: Task<Void, Never>] = [:]

    /// 300 ms trailing window. Tuned so a sub-second stream produces at most
    /// ~3 re-renders/sec while keeping the apparent latency well under one
    /// screen refresh at 60 Hz.
    private static let conversationDebounceNanos: UInt64 = 300_000_000

    private static let appStateLog = Logger(subsystem: "com.wotann.ios", category: "AppState")

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

    /// Synchronously mutate a conversation. Publishes `conversations`
    /// immediately. Use for structural changes (title renames, archive toggles)
    /// where the user expects an immediate UI response.
    func updateConversation(_ id: UUID, transform: (inout Conversation) -> Void) {
        guard let index = conversations.firstIndex(where: { $0.id == id }) else { return }
        var updated = conversations
        var conv = updated[index]
        transform(&conv)
        updated[index] = conv
        conversations = updated
        writeRecentConversationsToSharedDefaults()
    }

    /// Debounced conversation mutation. Queues the transform on a 300 ms
    /// trailing window keyed by conversation id so high-frequency stream deltas
    /// coalesce into a single publish. The closure must be `@Sendable` so it
    /// can cross the await suspension point safely.
    ///
    /// Ordering is preserved: queued transforms are replayed in arrival order
    /// against whatever the current conversation happens to be when the window
    /// fires. Callers that need immediate UI feedback should call
    /// `updateConversation(_:transform:)` directly.
    func updateConversationDebounced(
        _ id: UUID,
        transform: @escaping @Sendable (inout Conversation) -> Void
    ) {
        pendingConversationTransforms[id, default: []].append(transform)

        debounceTasks[id]?.cancel()
        debounceTasks[id] = Task { @MainActor [weak self] in
            // Sleep for the trailing window. If cancelled mid-sleep the
            // CancellationError short-circuits before we apply anything.
            do {
                try await Task.sleep(nanoseconds: Self.conversationDebounceNanos)
            } catch {
                return
            }
            guard let self else { return }
            self.flushPendingConversationUpdates(id: id)
        }
    }

    /// Apply every queued transform for `id` in arrival order with a single
    /// publish on `conversations`. Public so the UI can force a flush on view
    /// disappearance or on force-close paths.
    func flushPendingConversationUpdates(id: UUID) {
        guard let transforms = pendingConversationTransforms.removeValue(forKey: id),
              !transforms.isEmpty,
              let index = conversations.firstIndex(where: { $0.id == id }) else {
            debounceTasks.removeValue(forKey: id)
            return
        }
        debounceTasks.removeValue(forKey: id)

        var updated = conversations
        var conv = updated[index]
        for transform in transforms {
            transform(&conv)
        }
        updated[index] = conv
        conversations = updated
        writeRecentConversationsToSharedDefaults()
    }

    /// Flush every pending conversation window. Call on backgrounding or before
    /// destructive operations (archive, delete) so no streamed content is lost.
    func flushAllPendingConversationUpdates() {
        for id in Array(pendingConversationTransforms.keys) {
            flushPendingConversationUpdates(id: id)
        }
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

        // S5-11: Live Activity lifecycle mirrors agent status transitions.
        // LiveActivityManager.shared is the owner; AppState just forwards
        // state. Unknown ids are no-ops so dispatching from non-started
        // paths is safe.
        if agent.status == .completed || agent.status == .failed || agent.status == .cancelled {
            liveActivities.end(
                id: id,
                outcome: LiveActivityOutcome(
                    progress: agent.progress,
                    status: agent.status.displayName,
                    cost: agent.cost,
                    elapsedSeconds: Int(agent.duration)
                )
            )
        } else {
            liveActivities.updateTaskRun(
                id: id,
                title: agent.title,
                progress: agent.progress,
                status: agent.status.displayName,
                cost: agent.cost,
                elapsedSeconds: Int(agent.duration)
            )
        }
    }

    func addAgent(_ agent: AgentTask) {
        var updated = agents
        updated.insert(agent, at: 0)
        agents = updated
        writeAgentStatusToSharedDefaults()

        // S5-11: surface the new task in Dynamic Island + Lock Screen so the
        // user sees progress without returning to the app.
        liveActivities.startTaskRun(
            id: agent.id,
            title: agent.title,
            provider: agent.provider,
            model: agent.model
        )
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
    //
    // S5-11: the concrete `Activity<TaskProgressAttributes>` surface lives in
    // `LiveActivityManager`. The forwarding paths in `updateAgent` / `addAgent`
    // are the only integration points on AppState.

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
