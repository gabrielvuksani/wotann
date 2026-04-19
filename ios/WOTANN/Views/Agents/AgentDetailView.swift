import SwiftUI

// MARK: - AgentDetailView

/// Detailed view of a single agent task with logs and actions.
struct AgentDetailView: View {
    let agent: AgentTask
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showCancelConfirmation = false
    @State private var showReplay = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                    // Status header
                    statusHeader

                    // Progress
                    if agent.status == .running {
                        progressSection
                    }

                    // Details
                    detailsSection

                    // Actions
                    if agent.status.isActive {
                        actionsSection
                    }

                    // Replay (for completed/failed agents with logs)
                    if !agent.status.isActive && !agent.logs.isEmpty {
                        replaySection
                    }

                    // Logs
                    logsSection
                }
                .padding()
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Agent Detail")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showReplay) {
                AgentReplayView(
                    taskTitle: agent.title,
                    steps: replayStepsFromLogs(agent.logs)
                )
            }
            .alert("Cancel Task?", isPresented: $showCancelConfirmation) {
                Button("Cancel Task", role: .destructive) {
                    Task {
                        try? await connectionManager.rpcClient.cancelTask(taskId: agent.id)
                        appState.updateAgent(agent.id) { $0.status = .cancelled }
                        dismiss()
                    }
                }
                Button("Keep Running", role: .cancel) {}
            } message: {
                Text("This will stop the agent and any work in progress.")
            }
        }
    }

    // MARK: - Sections

    private var statusHeader: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Image(systemName: agent.status.iconName)
                .font(.wotannScaled(size: 40))
                .foregroundColor(statusColor)

            Text(agent.title)
                .font(WTheme.Typography.title3)
                .foregroundColor(WTheme.Colors.textPrimary)
                .multilineTextAlignment(.center)

            HStack(spacing: WTheme.Spacing.sm) {
                statusBadge
                ProviderBadge(provider: agent.provider)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack {
                Text("Progress")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Spacer()
                Text("\(Int(agent.progress * 100))%")
                    .font(WTheme.Typography.subheadline)
                    .fontDesign(.monospaced)
                    .foregroundColor(WTheme.Colors.primary)
            }

            ProgressView(value: agent.progress)
                .tint(WTheme.Colors.primary)
                .scaleEffect(y: 2)
                .animation(WTheme.Animation.smooth, value: agent.progress)
        }
        .wCard()
    }

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Details")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)

            DetailRow(label: "Provider", value: agent.provider.capitalized)
            DetailRow(label: "Model", value: agent.model)
            DetailRow(label: "Started", value: agent.startedAt.formatted(.dateTime.month().day().hour().minute()))
            DetailRow(label: "Duration", value: agent.formattedDuration)
            DetailRow(label: "Cost", value: "$\(String(format: "%.4f", agent.cost))")

            if let completedAt = agent.completedAt {
                DetailRow(label: "Completed", value: completedAt.formatted(.dateTime.month().day().hour().minute()))
            }
        }
        .wCard()
    }

    private var actionsSection: some View {
        VStack(spacing: WTheme.Spacing.sm) {
            if agent.status == .paused {
                TaskApprovalView(
                    title: "Action Required",
                    description: "The agent is waiting for your approval to proceed.",
                    onApprove: {
                        Task {
                            try? await connectionManager.rpcClient.approveAction(taskId: agent.id)
                            HapticService.shared.trigger(.taskComplete)
                        }
                    },
                    onReject: {
                        Task {
                            try? await connectionManager.rpcClient.rejectAction(taskId: agent.id)
                            HapticService.shared.trigger(.selection)
                        }
                    }
                )
            }

            Button(role: .destructive) {
                showCancelConfirmation = true
            } label: {
                HStack {
                    Image(systemName: "stop.circle.fill")
                    Text("Cancel Task")
                }
                .font(WTheme.Typography.headline)
                .frame(maxWidth: .infinity, minHeight: 44)
                .padding(.vertical, WTheme.Spacing.sm)
                .background(WTheme.Colors.error.opacity(0.1))
                .foregroundColor(WTheme.Colors.error)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
            }
        }
    }

    private var logsSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Logs")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)

            if agent.logs.isEmpty {
                Text("No logs yet")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .padding(.vertical, WTheme.Spacing.md)
            } else {
                ForEach(agent.logs) { log in
                    logRow(log)
                }
            }
        }
        .wCard()
    }

    private func logRow(_ log: TaskLog) -> some View {
        HStack(alignment: .top, spacing: WTheme.Spacing.sm) {
            Image(systemName: log.level.iconName)
                .font(.caption)
                .foregroundColor(logColor(log.level))
                .frame(width: 16)

            VStack(alignment: .leading, spacing: 2) {
                Text(log.message)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(log.timestamp, style: .time)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
    }

    private var replaySection: some View {
        Button {
            showReplay = true
        } label: {
            HStack {
                Image(systemName: "play.rectangle.fill")
                    .foregroundColor(WTheme.Colors.primary)
                Text("View Replay")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.primary)
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            .frame(minHeight: 44)
            .padding(.vertical, WTheme.Spacing.sm)
            .padding(.horizontal, WTheme.Spacing.md)
            .background(WTheme.Colors.primary.opacity(0.08))
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("View task replay")
        .accessibilityHint("Opens a step-by-step replay of the agent's actions")
    }

    /// Convert TaskLog entries into ReplayStep entries for AgentReplayView.
    private func replayStepsFromLogs(_ logs: [TaskLog]) -> [ReplayStep] {
        logs.enumerated().map { index, log in
            let stepStatus: ReplayStep.StepStatus = {
                switch log.level {
                case .error:   return .error
                case .warning: return .success
                case .info:    return .success
                case .debug:   return .success
                }
            }()

            let duration: TimeInterval? = {
                if index + 1 < logs.count {
                    return logs[index + 1].timestamp.timeIntervalSince(log.timestamp)
                }
                return nil
            }()

            return ReplayStep(
                index: index,
                action: log.message,
                timestamp: log.timestamp,
                status: stepStatus,
                duration: duration
            )
        }
    }

    // MARK: - Helpers

    private var statusBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: agent.status.iconName)
                .font(.caption)
            Text(agent.status.displayName)
                .font(WTheme.Typography.caption)
                .fontWeight(.medium)
        }
        .foregroundColor(statusColor)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
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

    private func logColor(_ level: LogLevel) -> Color {
        switch level {
        case .debug:   return WTheme.Colors.textTertiary
        case .info:    return WTheme.Colors.primary
        case .warning: return WTheme.Colors.warning
        case .error:   return WTheme.Colors.error
        }
    }
}

// MARK: - DetailRow

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
            Spacer()
            Text(value)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
        }
    }
}
