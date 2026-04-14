import SwiftUI

// MARK: - AutopilotView

/// Launch autonomous agent tasks that run until completion on the desktop.
struct AutopilotView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var prompt = ""
    @State private var isRunning = false
    @State private var status: String?
    @State private var progress: Double = 0
    @State private var logs: [String] = []
    @State private var taskId: String?
    @State private var showCostPreview = false
    @State private var estimatedCost: Double?

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
                    .font(.system(size: 28))
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

        Task {
            do {
                let response = try await connectionManager.rpcClient.send("autonomous.run", params: [
                    "prompt": .string(prompt),
                ])
                if let obj = response.result?.objectValue {
                    taskId = obj["taskId"]?.stringValue
                    status = obj["status"]?.stringValue ?? "Running"
                }
            } catch {
                status = "Failed: \(error.localizedDescription)"
                isRunning = false
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
        }
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
