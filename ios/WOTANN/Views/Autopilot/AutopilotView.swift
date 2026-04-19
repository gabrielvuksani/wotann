import SwiftUI

// MARK: - AutopilotView

/// Launch autonomous agent tasks that run until completion on the desktop.
struct AutopilotView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @EnvironmentObject var appState: AppState
    @State private var prompt = ""
    @State private var isRunning = false
    @State private var status: String?
    @State private var progress: Double = 0
    @State private var logs: [String] = []
    @State private var taskId: String?
    @State private var showCostPreview = false
    @State private var estimatedCost: Double?

    // S5-11: stable ActivityKit id for the current run. Keyed separately from
    // the desktop taskId so we can surface a Live Activity before the daemon
    // replies with its own id.
    @State private var liveActivityId: UUID?
    /// Epoch of `startAutopilot` so elapsed seconds on the Live Activity
    /// reflect wall-clock duration.
    @State private var runStartedAt: Date?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                    headerSection
                    promptSection
                    if isRunning { progressSection }
                    if !logs.isEmpty { logsSection }
                }
                .padding(WTheme.Spacing.lg)
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Autopilot")
            .toolbar {
                if isRunning {
                    ToolbarItem(placement: .primaryAction) {
                        Button("Stop") { cancelTask() }
                            .foregroundColor(WTheme.Colors.error)
                    }
                }
            }
        }
    }

    // MARK: - Sections

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: "bolt.circle.fill")
                    .font(.wotannScaled(size: 28))
                    .foregroundStyle(WTheme.Gradients.primary)
                Text("Autonomous Execution")
                    .font(WTheme.Typography.title3)
                    .foregroundColor(WTheme.Colors.textPrimary)
            }
            Text("Describe a task and WOTANN will work on it autonomously until completion. You'll be notified when it finishes.")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
        }
    }

    private var promptSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            TextField("What should WOTANN build or fix?", text: $prompt, axis: .vertical)
                .font(WTheme.Typography.body)
                .lineLimit(3...8)
                .padding(WTheme.Spacing.md)
                .background(WTheme.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: WTheme.Radius.md)
                        .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
                )

            HStack(spacing: WTheme.Spacing.sm) {
                Button {
                    previewCost()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "dollarsign.circle")
                        Text("Preview Cost")
                    }
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .frame(minHeight: 36)
                    .background(WTheme.Colors.surface)
                    .clipShape(Capsule())
                }
                .disabled(prompt.isEmpty)

                if let cost = estimatedCost {
                    Text("~$\(String(format: "%.2f", cost))")
                        .font(WTheme.Typography.caption)
                        .fontDesign(.monospaced)
                        .foregroundColor(WTheme.Colors.warning)
                }

                Spacer()

                Button {
                    startAutopilot()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "play.fill")
                        Text("Start")
                    }
                    .font(WTheme.Typography.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, WTheme.Spacing.xl)
                    .frame(minHeight: 44)
                    .background(prompt.isEmpty || isRunning ? WTheme.Colors.textTertiary : WTheme.Colors.primary)
                    .clipShape(Capsule())
                }
                .disabled(prompt.isEmpty || isRunning)
            }
        }
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack {
                Text(status ?? "Running...")
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.primary)
                Spacer()
                Text("\(Int(progress * 100))%")
                    .font(WTheme.Typography.caption)
                    .fontDesign(.monospaced)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            ProgressView(value: progress)
                .tint(WTheme.Colors.primary)
        }
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
    }

    private var logsSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("ACTIVITY LOG")
                .font(WTheme.Typography.caption2)
                .fontWeight(.semibold)
                .foregroundColor(WTheme.Colors.textSecondary)
                .tracking(WTheme.Tracking.wide)

            ForEach(Array(logs.suffix(20).enumerated()), id: \.offset) { _, log in
                Text(log)
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .lineLimit(2)
            }
        }
    }

    // MARK: - Actions

    private func startAutopilot() {
        isRunning = true
        status = "Starting..."
        progress = 0
        logs = []

        // S5-11: request a Live Activity the instant we dispatch so the user
        // sees a Dynamic Island entry before the desktop replies. The
        // activity id is kept in local state so iteration updates and the
        // terminal `end` call route to the same activity.
        let activityId = UUID()
        liveActivityId = activityId
        runStartedAt = .now
        let title = prompt.prefix(60).trimmingCharacters(in: .whitespacesAndNewlines)
        LiveActivityManager.shared.startTaskRun(
            id: activityId,
            title: title.isEmpty ? "Autopilot" : String(title),
            provider: appState.currentProvider,
            model: appState.currentModel,
            initialStatus: "Starting"
        )

        subscribeToAutopilotStream(activityId: activityId)

        Task {
            do {
                let response = try await connectionManager.rpcClient.send("autonomous.run", params: [
                    "prompt": .string(prompt),
                ])
                if let obj = response.result?.objectValue {
                    taskId = obj["taskId"]?.stringValue
                    status = obj["status"]?.stringValue ?? "Running"
                    // Push the initial "Running" status through to the Live
                    // Activity so the lock screen reflects the daemon's ack.
                    LiveActivityManager.shared.updateTaskRun(
                        id: activityId,
                        title: title.isEmpty ? "Autopilot" : String(title),
                        progress: progress,
                        status: status ?? "Running",
                        cost: 0,
                        elapsedSeconds: elapsedSeconds()
                    )
                }
            } catch {
                status = "Failed: \(error.localizedDescription)"
                isRunning = false
                finishLiveActivity(finalStatus: "Failed")
            }
        }
    }

    private func cancelTask() {
        guard let taskId else { return }
        Task {
            _ = try? await connectionManager.rpcClient.send("autonomous.cancel", params: [
                "taskId": .string(taskId),
            ])
            isRunning = false
            status = "Cancelled"
            finishLiveActivity(finalStatus: "Cancelled")
        }
    }

    // MARK: - Live Activity Plumbing (S5-11)

    /// Subscribe to `autonomous.progress` / `autonomous.done` RPC events and
    /// mirror each iteration into the running Live Activity.
    ///
    /// The daemon emits one event per autopilot iteration with `progress`
    /// (0..1), a terse `status`, a running `cost`, and the `taskId` it was
    /// dispatched against. We filter on the taskId once the initial dispatch
    /// reply assigns one, so cross-run events never bleed into the wrong
    /// activity.
    private func subscribeToAutopilotStream(activityId: UUID) {
        connectionManager.rpcClient.subscribe("autonomous.progress") { event in
            guard case .object(let obj) = event.params else { return }

            // Route only events tagged with our run's taskId.
            if let selfTaskId = self.taskId,
               let evtTaskId = obj["taskId"]?.stringValue,
               evtTaskId != selfTaskId {
                return
            }

            Task { @MainActor in
                let prog = obj["progress"]?.doubleValue ?? obj["progress"]?.intValue.map(Double.init) ?? self.progress
                let newStatus = obj["status"]?.stringValue ?? self.status ?? "Running"
                let cost = obj["cost"]?.doubleValue ?? 0

                self.progress = max(min(prog, 1), 0)
                self.status = newStatus
                if let line = obj["log"]?.stringValue {
                    self.logs.append(line)
                }

                LiveActivityManager.shared.updateTaskRun(
                    id: activityId,
                    title: self.activityTitle,
                    progress: self.progress,
                    status: newStatus,
                    cost: cost,
                    elapsedSeconds: self.elapsedSeconds()
                )
            }
        }

        connectionManager.rpcClient.subscribe("autonomous.done") { event in
            guard case .object(let obj) = event.params else { return }
            if let selfTaskId = self.taskId,
               let evtTaskId = obj["taskId"]?.stringValue,
               evtTaskId != selfTaskId {
                return
            }

            Task { @MainActor in
                self.progress = 1
                self.status = "Completed"
                self.isRunning = false
                self.finishLiveActivity(finalStatus: "Completed")
            }
        }
    }

    private func finishLiveActivity(finalStatus: String) {
        guard let id = liveActivityId else { return }
        LiveActivityManager.shared.end(
            id: id,
            outcome: LiveActivityOutcome(
                progress: progress,
                status: finalStatus,
                cost: 0,
                elapsedSeconds: elapsedSeconds()
            )
        )
        liveActivityId = nil
        runStartedAt = nil
    }

    private func elapsedSeconds() -> Int {
        guard let started = runStartedAt else { return 0 }
        return Int(Date.now.timeIntervalSince(started))
    }

    /// Title passed through every Live Activity update so all three regions
    /// (compact, expanded, minimal) render the same truncation.
    private var activityTitle: String {
        let trimmed = prompt.prefix(60).trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Autopilot" : String(trimmed)
    }

    private func previewCost() {
        Task {
            do {
                let response = try await connectionManager.rpcClient.send("cost.predict", params: [
                    "prompt": .string(prompt),
                ])
                if let cost = response.result?.objectValue?["estimated"]?.doubleValue {
                    estimatedCost = cost
                }
            } catch {
                estimatedCost = nil
            }
        }
    }
}

#Preview {
    AutopilotView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
