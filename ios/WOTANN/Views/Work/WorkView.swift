import SwiftUI

// MARK: - WorkView

/// The unified Work tab: filter pills + active strip + agent list + docked
/// composer. Replaces the legacy AgentListView reference in `MainShell`.
///
/// Layout (top → bottom):
///   1. Nav title "Work"
///   2. `FilterPillBar`   (segmented Running / Pending / Approval / Done / Failed)
///   3. `ActiveWorkStrip` (only when there are active agents)
///   4. List of `WorkAgentRow` filtered by the selected pill
///   5. `DispatchComposer` docked above the system tab bar
struct WorkView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    @State private var selectedFilter: WorkFilter = .running
    @State private var selectedAgent: AgentTask?
    @State private var archivedIds: Set<UUID> = []

    // MARK: - Derived

    private var visibleAgents: [AgentTask] {
        appState.agents
            .filter { !archivedIds.contains($0.id) }
    }

    private func count(for filter: WorkFilter) -> Int {
        visibleAgents.filter { filter.matches($0.status) }.count
    }

    private var filteredAgents: [AgentTask] {
        visibleAgents.filter { selectedFilter.matches($0.status) }
    }

    private var activeAgents: [AgentTask] {
        visibleAgents.filter { $0.status.isActive }
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                VStack(spacing: 0) {
                    FilterPillBar(
                        selection: $selectedFilter,
                        counts: { count(for: $0) }
                    )

                    if !activeAgents.isEmpty {
                        ActiveWorkStrip(
                            activeAgents: activeAgents,
                            onKillAll: killAll,
                            onApproveAll: approveAll
                        )
                    }

                    listContent
                }

                // Composer dock — pushed up so it floats above the tab bar.
                DispatchComposer()
                    .padding(.bottom, 60)
            }
            .background(WTheme.Colors.background.ignoresSafeArea())
            .navigationTitle("Work")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    if appState.activeAgents.count > 0 {
                        Text("\(appState.activeAgents.count) active")
                            .font(WTheme.Typography.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(WTheme.Colors.primary)
                            .padding(.horizontal, WTheme.Spacing.sm)
                            .padding(.vertical, 3)
                            .background(
                                Capsule().fill(WTheme.Colors.primary.opacity(0.15))
                            )
                    }
                }
                // V9 T5 — surface the three "Workshop-adjacent" views from
                // a single Workshop menu in the toolbar instead of adding
                // three separate tabs (the tab bar is already at its
                // 4-item iOS limit). Council / Exploit / Creations each
                // push onto the Work navigation stack.
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        NavigationLink(destination: CouncilView()
                            .environmentObject(connectionManager)
                        ) {
                            Label("Council", systemImage: "person.3.fill")
                        }
                        NavigationLink(destination: ExploitView()
                            .environmentObject(connectionManager)
                        ) {
                            Label("Exploit", systemImage: "shield.lefthalf.filled")
                        }
                        NavigationLink(destination: CreationsView()
                            .environmentObject(connectionManager)
                        ) {
                            Label("Creations", systemImage: "sparkles.rectangle.stack.fill")
                        }
                    } label: {
                        Image(systemName: "square.grid.2x2.fill")
                            .accessibilityLabel("Workshop menu")
                    }
                }
            }
            .refreshable {
                await refresh()
            }
            .sheet(item: $selectedAgent) { agent in
                AgentDetailView(agent: agent)
            }
            .onAppear {
                // Pick the most useful default filter based on what the user
                // actually has: approvals are urgent, then running, then done.
                if count(for: .approval) > 0 {
                    selectedFilter = .approval
                } else if count(for: .running) > 0 {
                    selectedFilter = .running
                } else if count(for: .done) > 0 {
                    selectedFilter = .done
                }

                if let agentId = appState.deepLinkAgentId,
                   let agent = appState.agents.first(where: { $0.id == agentId }) {
                    selectedAgent = agent
                    appState.deepLinkAgentId = nil
                }
            }
            .animation(WTheme.Animation.smooth, value: activeAgents.count)
            .animation(WTheme.Animation.smooth, value: filteredAgents.count)
        }
    }

    // MARK: - List

    @ViewBuilder
    private var listContent: some View {
        if visibleAgents.isEmpty {
            EmptyState(
                icon: "hammer",
                title: "No Work Yet",
                subtitle: "Dispatch a task below and it will appear here."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if filteredAgents.isEmpty {
            EmptyState(
                icon: "line.3.horizontal.decrease.circle",
                title: "Nothing here",
                subtitle: "Try a different filter to see other work."
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            List {
                ForEach(filteredAgents) { agent in
                    WorkAgentRow(
                        agent: agent,
                        onTap: { selectedAgent = agent },
                        onApprove: { approve(agent) },
                        onReject: { reject(agent) },
                        onArchive: { archive(agent) },
                        onCancel: { cancel(agent) },
                        onDuplicate: { duplicate(agent) },
                        onRerunDifferentModel: { rerunDifferentModel(agent) },
                        onConvertToWorkflow: { convertToWorkflow(agent) },
                        onPin: { pin(agent) }
                    )
                }
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            // Leave room for the docked composer (56pt) + tab bar spacing.
            .safeAreaInset(edge: .bottom) {
                Color.clear.frame(height: 120)
            }
        }
    }

    // MARK: - Actions

    private func refresh() async {
        do {
            let agents = try await connectionManager.rpcClient.getAgents()
            appState.agents = agents
        } catch {
            // Leave existing data in place.
        }
    }

    private func approve(_ agent: AgentTask) {
        Task { @MainActor in
            do {
                try await connectionManager.rpcClient.approveAction(taskId: agent.id)
                appState.updateAgent(agent.id) { $0.status = .running }
            } catch {
                HapticService.shared.trigger(.error)
            }
        }
    }

    private func reject(_ agent: AgentTask) {
        Task { @MainActor in
            do {
                try await connectionManager.rpcClient.rejectAction(taskId: agent.id)
                appState.updateAgent(agent.id) {
                    $0.status = .cancelled
                    $0.completedAt = .now
                }
            } catch {
                HapticService.shared.trigger(.error)
            }
        }
    }

    private func cancel(_ agent: AgentTask) {
        Task { @MainActor in
            do {
                try await connectionManager.rpcClient.cancelTask(taskId: agent.id)
                appState.updateAgent(agent.id) {
                    $0.status = .cancelled
                    $0.completedAt = .now
                }
            } catch {
                HapticService.shared.trigger(.error)
            }
        }
    }

    private func archive(_ agent: AgentTask) {
        archivedIds.insert(agent.id)
    }

    private func duplicate(_ agent: AgentTask) {
        let clone = AgentTask(
            title: agent.title,
            status: .queued,
            progress: 0,
            provider: agent.provider,
            model: agent.model
        )
        appState.addAgent(clone)
        Task { @MainActor in
            let request = DispatchRequest(
                prompt: agent.title,
                provider: agent.provider,
                model: agent.model,
                template: nil
            )
            _ = try? await connectionManager.rpcClient.dispatchTask(request)
        }
    }

    private func rerunDifferentModel(_ agent: AgentTask) {
        // Pick the next known model from the active provider, falling back to
        // Opus if the provider has no models exposed.
        let provider = appState.availableProviders.first { $0.id == agent.provider }
        let models = provider?.models ?? []
        let next: String = {
            if let idx = models.firstIndex(of: agent.model) {
                return models[(idx + 1) % models.count]
            }
            // Provider neutrality fix: empty fallback (no claude-opus-4-6 bias).
            // Empty model defers to daemon session default for that provider.
            return models.first ?? ""
        }()

        let clone = AgentTask(
            title: agent.title,
            status: .queued,
            progress: 0,
            provider: agent.provider,
            model: next
        )
        appState.addAgent(clone)
        Task { @MainActor in
            let request = DispatchRequest(
                prompt: agent.title,
                provider: agent.provider,
                model: next,
                template: nil
            )
            _ = try? await connectionManager.rpcClient.dispatchTask(request)
        }
    }

    private func convertToWorkflow(_ agent: AgentTask) {
        // Future: open the workflow builder pre-populated with this agent's
        // prompt. For now route to the dispatch tab via deep-link marker so
        // the action is always visible but not lossy.
        appState.deepLinkDestination = "workflow.build?prompt=\(agent.title)"
    }

    private func pin(_ agent: AgentTask) {
        // Future: persist pinned status via appState. For now we simply log
        // a haptic — the menu remains visible so the gesture is discoverable.
        _ = agent
    }

    // MARK: - Bulk

    private func killAll() {
        let active = visibleAgents.filter { $0.status.isActive }
        for agent in active {
            cancel(agent)
        }
    }

    private func approveAll() {
        let pending = visibleAgents.filter { $0.status == .approvalRequired }
        for agent in pending {
            approve(agent)
        }
    }
}
