import SwiftUI

// MARK: - TaskListView

/// Lists all autonomous agent tasks with filtering, pull-to-refresh, and navigation.
struct TaskListView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var filterState: TaskState?
    @State private var isRefreshing = false

    private var tasks: [AgentTask] {
        guard let filter = filterState else { return appState.agents }
        return appState.agents.filter { $0.status == filter }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                WTheme.Colors.background.ignoresSafeArea()

                if appState.agents.isEmpty && !isRefreshing {
                    emptyState
                } else {
                    taskList
                }
            }
            .navigationTitle("Tasks")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    summaryBadge
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        EmptyState(
            icon: "checklist",
            title: "No Tasks",
            subtitle: "Dispatch a task from your phone or desktop to see it here.",
            action: { Task { await refresh() } },
            actionTitle: "Refresh"
        )
    }

    // MARK: - Task List

    private var taskList: some View {
        VStack(spacing: 0) {
            filterBar
            Divider().background(WTheme.Colors.border)

            ScrollView {
                LazyVStack(spacing: WTheme.Spacing.sm) {
                    if tasks.isEmpty {
                        noResultsView
                    } else {
                        ForEach(tasks) { task in
                            NavigationLink(destination: TaskDetailView(task: task)) {
                                TaskRow(task: task)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(WTheme.Spacing.md)
            }
            .refreshable { await refresh() }

            if isRefreshing {
                ProgressView()
                    .tint(WTheme.Colors.primary)
                    .padding(WTheme.Spacing.sm)
            }
        }
    }

    // MARK: - Filter Bar

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: WTheme.Spacing.sm) {
                FilterChip(label: "All", isActive: filterState == nil) {
                    withAnimation(WTheme.Animation.quick) { filterState = nil }
                }
                FilterChip(
                    label: "Running",
                    count: countFor(.running),
                    isActive: filterState == .running
                ) {
                    withAnimation(WTheme.Animation.quick) { filterState = .running }
                }
                FilterChip(
                    label: "Completed",
                    count: countFor(.completed),
                    isActive: filterState == .completed
                ) {
                    withAnimation(WTheme.Animation.quick) { filterState = .completed }
                }
                FilterChip(
                    label: "Failed",
                    count: countFor(.failed),
                    isActive: filterState == .failed
                ) {
                    withAnimation(WTheme.Animation.quick) { filterState = .failed }
                }
                FilterChip(
                    label: "Queued",
                    count: countFor(.queued),
                    isActive: filterState == .queued
                ) {
                    withAnimation(WTheme.Animation.quick) { filterState = .queued }
                }
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
        }
    }

    private var noResultsView: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(.system(size: 36))
                .foregroundColor(WTheme.Colors.textTertiary)
            Text("No \(filterState?.displayName.lowercased() ?? "") tasks")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, WTheme.Spacing.xxl)
    }

    // MARK: - Summary Badge

    private var summaryBadge: some View {
        let activeCount = appState.agents.filter { $0.status.isActive }.count
        return Group {
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
    }

    // MARK: - Helpers

    private func countFor(_ state: TaskState) -> Int {
        appState.agents.filter { $0.status == state }.count
    }

    private func refresh() async {
        isRefreshing = true
        do {
            let updated = try await connectionManager.rpcClient.getAgents()
            appState.agents = updated
        } catch {
            // Keep existing data on failure
        }
        isRefreshing = false
    }
}

// MARK: - FilterChip

private struct FilterChip: View {
    let label: String
    var count: Int = 0
    let isActive: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: WTheme.Spacing.xs) {
                Text(label)
                    .font(WTheme.Typography.caption)
                    .fontWeight(.medium)
                if count > 0 {
                    Text("\(count)")
                        .font(WTheme.Typography.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(
                            isActive
                                ? WTheme.Colors.textPrimary
                                : WTheme.Colors.textTertiary
                        )
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(
                            isActive
                                ? WTheme.Colors.primary.opacity(0.3)
                                : WTheme.Colors.surfaceAlt
                        )
                        .clipShape(Capsule())
                }
            }
            .foregroundColor(
                isActive ? WTheme.Colors.textPrimary : WTheme.Colors.textSecondary
            )
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
            .background(
                isActive ? WTheme.Colors.primary.opacity(0.2) : WTheme.Colors.surface
            )
            .clipShape(Capsule())
            .overlay(
                Capsule().strokeBorder(
                    isActive ? WTheme.Colors.primary.opacity(0.4) : Color.clear,
                    lineWidth: 1
                )
            )
        }
    }
}

// MARK: - TaskRow

struct TaskRow: View {
    let task: AgentTask

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack {
                Text(task.title)
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)

                Spacer()

                statusBadge
            }

            ProgressView(value: task.progress)
                .tint(progressColor)
                .background(WTheme.Colors.surfaceAlt.clipShape(Capsule()))

            HStack(spacing: WTheme.Spacing.md) {
                ProviderBadge(provider: task.provider, size: .small)

                CostLabel(amount: task.cost, style: .compact)

                Spacer()

                HStack(spacing: WTheme.Spacing.xxs) {
                    Image(systemName: "clock")
                        .font(.system(size: 10))
                    Text(task.formattedDuration)
                        .font(WTheme.Typography.caption2)
                }
                .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .wCard()
    }

    private var statusBadge: some View {
        HStack(spacing: WTheme.Spacing.xxs) {
            Image(systemName: task.status.iconName)
                .font(.system(size: 10))
            Text(task.status.displayName)
                .font(WTheme.Typography.caption2)
                .fontWeight(.medium)
        }
        .foregroundColor(statusColor)
        .padding(.horizontal, WTheme.Spacing.sm)
        .padding(.vertical, WTheme.Spacing.xxs)
        .background(statusColor.opacity(0.15))
        .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch task.status {
        case .queued:           return WTheme.Colors.textSecondary
        case .running:          return WTheme.Colors.primary
        case .paused:           return WTheme.Colors.warning
        case .completed:        return WTheme.Colors.success
        case .failed:           return WTheme.Colors.error
        case .cancelled:        return WTheme.Colors.textTertiary
        case .approvalRequired: return WTheme.Colors.warning
        }
    }

    private var progressColor: Color {
        switch task.status {
        case .failed:    return WTheme.Colors.error
        case .completed: return WTheme.Colors.success
        case .running:   return WTheme.Colors.primary
        default:         return WTheme.Colors.textTertiary
        }
    }
}

// MARK: - Previews

#Preview("Task List - Empty") {
    TaskListView()
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}

#Preview("Task Row") {
    TaskRow(task: AgentTask(
        title: "Fix all failing integration tests",
        status: .running,
        progress: 0.65,
        provider: "anthropic",
        model: "claude-opus-4-6",
        cost: 0.087
    ))
    .padding()
    .background(WTheme.Colors.background)
    .preferredColorScheme(.dark)
}
