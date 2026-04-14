import SwiftUI

// MARK: - TaskDetailView

/// Detail view for a single agent task with progress ring, logs, and action buttons.
struct TaskDetailView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showCancelConfirm = false
    @State private var isPerformingAction = false

    let task: AgentTask

    private var liveTask: AgentTask {
        appState.agents.first { $0.id == task.id } ?? task
    }

    var body: some View {
        ScrollView {
            VStack(spacing: WTheme.Spacing.lg) {
                progressHeader
                proofBundleSummary
                actionButtons
                logSection
            }
            .padding(WTheme.Spacing.md)
        }
        .background(WTheme.Colors.background)
        .navigationTitle(liveTask.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 0) {
                    Text(liveTask.title)
                        .font(WTheme.Typography.headline)
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .lineLimit(1)
                    ProviderBadge(provider: liveTask.provider, size: .small)
                }
            }
        }
        .confirmationDialog(
            "Cancel this task?",
            isPresented: $showCancelConfirm,
            titleVisibility: .visible
        ) {
            Button("Cancel Task", role: .destructive) {
                Task { await cancelTask() }
            }
        }
    }

    // MARK: - Progress Header

    private var progressHeader: some View {
        VStack(spacing: WTheme.Spacing.md) {
            progressRing

            Text(liveTask.status.displayName)
                .font(WTheme.Typography.title3)
                .foregroundColor(statusColor)

            HStack(spacing: WTheme.Spacing.lg) {
                DetailStat(label: "Cost", value: String(format: "$%.4f", liveTask.cost))
                DetailStat(label: "Duration", value: liveTask.formattedDuration)
                DetailStat(label: "Model", value: liveTask.model)
            }
        }
        .frame(maxWidth: .infinity)
        .wCard()
    }

    private var progressRing: some View {
        ZStack {
            Circle()
                .stroke(WTheme.Colors.surfaceAlt, lineWidth: 8)
                .frame(width: 120, height: 120)

            Circle()
                .trim(from: 0, to: liveTask.progress)
                .stroke(
                    AngularGradient(
                        colors: [statusColor.opacity(0.6), statusColor],
                        center: .center,
                        startAngle: .zero,
                        endAngle: .degrees(360 * liveTask.progress)
                    ),
                    style: StrokeStyle(lineWidth: 8, lineCap: .round)
                )
                .frame(width: 120, height: 120)
                .rotationEffect(.degrees(-90))
                .animation(WTheme.Animation.smooth, value: liveTask.progress)

            VStack(spacing: WTheme.Spacing.xxs) {
                Text("\(Int(liveTask.progress * 100))%")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .contentTransition(.numericText())

                Image(systemName: liveTask.status.iconName)
                    .font(.system(size: 14))
                    .foregroundColor(statusColor)
            }
        }
    }

    // MARK: - Proof Bundle Summary

    private var proofBundleSummary: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack(spacing: WTheme.Spacing.xs) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.primary)
                Text("Proof Bundle")
                    .font(WTheme.Typography.caption)
                    .fontWeight(.bold)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            HStack(spacing: WTheme.Spacing.md) {
                ProofMetric(
                    icon: "checkmark.circle.fill",
                    label: "Tests Passed",
                    value: "\(testsPassed)",
                    color: WTheme.Colors.success
                )
                ProofMetric(
                    icon: "xmark.circle.fill",
                    label: "Tests Failed",
                    value: "\(testsFailed)",
                    color: testsFailed > 0 ? WTheme.Colors.error : WTheme.Colors.textTertiary
                )
                ProofMetric(
                    icon: "doc.text.fill",
                    label: "Files Changed",
                    value: "\(filesChanged)",
                    color: WTheme.Colors.warning
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .wCard()
    }

    private var testsPassed: Int {
        liveTask.logs.filter { $0.message.lowercased().contains("pass") }.count
    }

    private var testsFailed: Int {
        liveTask.logs.filter { $0.level == .error }.count
    }

    private var filesChanged: Int {
        max(1, liveTask.logs.filter { $0.message.lowercased().contains("file") }.count)
    }

    // MARK: - Action Buttons

    @ViewBuilder
    private var actionButtons: some View {
        if liveTask.status.isActive {
            HStack(spacing: WTheme.Spacing.sm) {
                ActionButton(
                    label: "Approve",
                    icon: "checkmark.circle.fill",
                    color: WTheme.Colors.success,
                    isLoading: isPerformingAction
                ) {
                    Task { await approveTask() }
                }

                ActionButton(
                    label: "Reject",
                    icon: "xmark.circle.fill",
                    color: WTheme.Colors.error,
                    isLoading: isPerformingAction
                ) {
                    Task { await rejectTask() }
                }

                ActionButton(
                    label: "Cancel",
                    icon: "stop.circle.fill",
                    color: WTheme.Colors.warning,
                    isLoading: isPerformingAction
                ) {
                    showCancelConfirm = true
                }
            }
        } else if liveTask.status == .completed {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: "checkmark.seal.fill")
                    .foregroundColor(WTheme.Colors.success)
                Text("Task completed successfully")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.success)
            }
            .frame(maxWidth: .infinity)
            .wCard()
        } else if liveTask.status == .failed {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundColor(WTheme.Colors.error)
                Text("Task failed")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.error)
            }
            .frame(maxWidth: .infinity)
            .wCard()
        }
    }

    // MARK: - Log Section

    private var logSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack {
                Image(systemName: "terminal.fill")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.primary)
                Text("Logs")
                    .font(WTheme.Typography.caption)
                    .fontWeight(.bold)
                    .foregroundColor(WTheme.Colors.textSecondary)
                Spacer()
                Text("\(liveTask.logs.count) entries")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }

            if liveTask.logs.isEmpty {
                Text("No log entries yet.")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, WTheme.Spacing.lg)
            } else {
                LazyVStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                    ForEach(liveTask.logs) { log in
                        LogRow(log: log)
                    }
                }
            }
        }
        .wCard()
    }

    // MARK: - Actions

    private func approveTask() async {
        isPerformingAction = true
        do {
            try await connectionManager.rpcClient.approveAction(taskId: liveTask.id)
            HapticService.shared.trigger(.taskComplete)
        } catch {
            HapticService.shared.trigger(.error)
        }
        isPerformingAction = false
    }

    private func rejectTask() async {
        isPerformingAction = true
        do {
            try await connectionManager.rpcClient.rejectAction(taskId: liveTask.id)
            HapticService.shared.trigger(.selection)
        } catch {
            HapticService.shared.trigger(.error)
        }
        isPerformingAction = false
    }

    private func cancelTask() async {
        isPerformingAction = true
        do {
            try await connectionManager.rpcClient.cancelTask(taskId: liveTask.id)
            appState.updateAgent(liveTask.id) { $0.status = .cancelled }
            HapticService.shared.trigger(.selection)
        } catch {
            HapticService.shared.trigger(.error)
        }
        isPerformingAction = false
    }

    private var statusColor: Color {
        switch liveTask.status {
        case .queued:           return WTheme.Colors.textSecondary
        case .running:          return WTheme.Colors.primary
        case .paused:           return WTheme.Colors.warning
        case .completed:        return WTheme.Colors.success
        case .failed:           return WTheme.Colors.error
        case .cancelled:        return WTheme.Colors.textTertiary
        case .approvalRequired: return WTheme.Colors.warning
        }
    }
}

// MARK: - DetailStat

private struct DetailStat: View {
    let label: String
    let value: String

    var body: some View {
        VStack(spacing: WTheme.Spacing.xxs) {
            Text(value)
                .font(WTheme.Typography.caption)
                .fontWeight(.semibold)
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(1)
            Text(label)
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - ProofMetric

private struct ProofMetric: View {
    let icon: String
    let label: String
    let value: String
    let color: Color

    var body: some View {
        VStack(spacing: WTheme.Spacing.xs) {
            HStack(spacing: WTheme.Spacing.xxs) {
                Image(systemName: icon)
                    .font(.system(size: 12))
                    .foregroundColor(color)
                Text(value)
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
            }
            Text(label)
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - ActionButton

private struct ActionButton: View {
    let label: String
    let icon: String
    let color: Color
    var isLoading: Bool = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: WTheme.Spacing.xs) {
                if isLoading {
                    ProgressView()
                        .tint(color)
                        .frame(width: 24, height: 24)
                } else {
                    Image(systemName: icon)
                        .font(.title3)
                        .foregroundColor(color)
                }
                Text(label)
                    .font(WTheme.Typography.caption)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, WTheme.Spacing.sm)
            .background(color.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
            .overlay(
                RoundedRectangle(cornerRadius: WTheme.Radius.md)
                    .strokeBorder(color.opacity(0.2), lineWidth: 1)
            )
        }
        .disabled(isLoading)
    }
}

// MARK: - LogRow

private struct LogRow: View {
    let log: TaskLog

    var body: some View {
        HStack(alignment: .top, spacing: WTheme.Spacing.sm) {
            Image(systemName: log.level.iconName)
                .font(.system(size: 10))
                .foregroundColor(logColor)
                .frame(width: 14, alignment: .center)

            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                Text(log.message)
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(3)

                Text(log.timestamp, style: .time)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }

    private var logColor: Color {
        switch log.level {
        case .debug:   return WTheme.Colors.textTertiary
        case .info:    return WTheme.Colors.primary
        case .warning: return WTheme.Colors.warning
        case .error:   return WTheme.Colors.error
        }
    }
}

// MARK: - Previews

#Preview("Task Detail - Running") {
    NavigationStack {
        TaskDetailView(task: AgentTask(
            title: "Fix integration test suite",
            status: .running,
            progress: 0.65,
            provider: "anthropic",
            model: "claude-opus-4-6",
            cost: 0.087,
            logs: [
                TaskLog(level: .info, message: "Analyzing test failures..."),
                TaskLog(level: .info, message: "Found 3 failing tests in auth module"),
                TaskLog(level: .warning, message: "Deprecated API usage in test helper"),
                TaskLog(level: .info, message: "Applying fix to auth.test.ts"),
                TaskLog(level: .info, message: "Test suite passed: 42/42"),
            ]
        ))
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
    }
    .preferredColorScheme(.dark)
}

#Preview("Task Detail - Completed") {
    NavigationStack {
        TaskDetailView(task: AgentTask(
            title: "Security audit",
            status: .completed,
            progress: 1.0,
            provider: "openai",
            model: "gpt-4o",
            cost: 0.23,
            completedAt: .now,
            logs: [
                TaskLog(level: .info, message: "Scan started"),
                TaskLog(level: .info, message: "No vulnerabilities found"),
            ]
        ))
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
    }
    .preferredColorScheme(.dark)
}
