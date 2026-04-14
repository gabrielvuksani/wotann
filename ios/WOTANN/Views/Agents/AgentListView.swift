import SwiftUI

// MARK: - AgentListView

/// All running and completed agents with progress and cost.
struct AgentListView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var filterState: TaskState?
    @State private var selectedAgent: AgentTask?
    @State private var isRefreshing = false
    @State private var showAllTasks = false

    var filteredAgents: [AgentTask] {
        guard let filter = filterState else { return appState.agents }
        return appState.agents.filter { $0.status == filter }
    }

    var activeCount: Int {
        appState.agents.filter { $0.status.isActive }.count
    }

    var body: some View {
        NavigationStack {
            Group {
                if appState.agents.isEmpty {
                    EmptyState(
                        icon: "square.grid.2x2",
                        title: "No Workers Active",
                        subtitle: "Dispatch a task from your phone or start one from your desktop."
                    )
                } else {
                    agentList
                }
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Agents")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if activeCount > 0 {
                        Text("\(activeCount) active")
                            .font(WTheme.Typography.caption)
                            .fontWeight(.medium)
                            .foregroundColor(WTheme.Colors.success)
                            .padding(.horizontal, WTheme.Spacing.sm)
                            .padding(.vertical, WTheme.Spacing.xs)
                            .background(WTheme.Colors.success.opacity(0.15))
                            .clipShape(Capsule())
                    }
                }
                ToolbarItem(placement: .secondaryAction) {
                    Button {
                        showAllTasks = true
                    } label: {
                        Label("All Tasks", systemImage: "checklist")
                    }
                    .accessibilityLabel("All Tasks")
                    .accessibilityHint("View all tasks with filtering and details")
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            filterState = nil
                        } label: {
                            HStack {
                                Text("All")
                                if filterState == nil {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                        ForEach([TaskState.running, .queued, .completed, .failed], id: \.self) { state in
                            Button {
                                filterState = state
                            } label: {
                                HStack {
                                    Label(state.displayName, systemImage: state.iconName)
                                    if filterState == state {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                            .foregroundColor(
                                filterState != nil ? WTheme.Colors.primary : WTheme.Colors.textSecondary
                            )
                    }
                    .accessibilityLabel("Filter agents")
                    .accessibilityHint("Filter agents by status such as running, queued, or completed")
                }
            }
            .refreshable {
                isRefreshing = true
                do {
                    appState.agents = try await connectionManager.rpcClient.getAgents()
                } catch {
                    // Keep existing
                }
                isRefreshing = false
            }
            .sheet(item: $selectedAgent) { agent in
                AgentDetailView(agent: agent)
            }
            .sheet(isPresented: $showAllTasks) {
                TaskListView()
            }
            .onAppear {
                if let agentId = appState.deepLinkAgentId,
                   let agent = appState.agents.first(where: { $0.id == agentId }) {
                    selectedAgent = agent
                    appState.deepLinkAgentId = nil
                }
            }
        }
    }

    private var agentList: some View {
        List {
            ForEach(filteredAgents) { agent in
                Button {
                    selectedAgent = agent
                } label: {
                    AgentRow(agent: agent)
                }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) {
                        Task {
                            try? await connectionManager.rpcClient.cancelTask(taskId: agent.id)
                        }
                    } label: {
                        Label("Cancel", systemImage: "xmark.circle")
                    }

                    Button {
                        Task {
                            try? await connectionManager.rpcClient.rejectAction(taskId: agent.id)
                        }
                    } label: {
                        Label("Reject", systemImage: "hand.thumbsdown")
                    }
                    .tint(WTheme.Colors.warning)
                }
                .swipeActions(edge: .leading, allowsFullSwipe: true) {
                    Button {
                        Task {
                            try? await connectionManager.rpcClient.approveAction(taskId: agent.id)
                        }
                    } label: {
                        Label("Approve", systemImage: "checkmark.circle")
                    }
                    .tint(WTheme.Colors.success)
                }
                .listRowBackground(WTheme.Colors.background)
            }
        }
        .listStyle(.plain)
    }
}

// MARK: - AgentRow

/// Row showing agent title, status, progress, and cost.
struct AgentRow: View {
    let agent: AgentTask

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            // Top: title + status
            HStack {
                Text(agent.title)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)

                Spacer()

                statusBadge
            }

            // Progress bar (if running)
            if agent.status == .running {
                ProgressView(value: agent.progress)
                    .tint(WTheme.Colors.primary)
                    .scaleEffect(y: 1.5)
                    .animation(WTheme.Animation.smooth, value: agent.progress)
            }

            // Bottom: provider, cost, duration
            HStack(spacing: WTheme.Spacing.sm) {
                ProviderBadge(provider: agent.provider, size: .small)

                CostLabel(amount: agent.cost, style: .compact)

                Spacer()

                Text(agent.formattedDuration)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .padding(.vertical, WTheme.Spacing.sm)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.title), \(agent.status.displayName), \(Int(agent.progress * 100)) percent")
        .accessibilityHint("Double tap to view agent details")
    }

    private var statusBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: agent.status.iconName)
                .font(.caption)
            Text(agent.status.displayName)
                .font(WTheme.Typography.caption2)
                .fontWeight(.medium)
        }
        .foregroundColor(statusColor)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(statusColor.opacity(0.15))
        .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch agent.status {
        case .running:          return WTheme.Colors.primary
        case .queued:           return WTheme.Colors.warning
        case .paused:           return WTheme.Colors.warning
        case .completed:        return WTheme.Colors.success
        case .failed:           return WTheme.Colors.error
        case .cancelled:        return WTheme.Colors.textTertiary
        case .approvalRequired: return WTheme.Colors.warning
        }
    }
}

