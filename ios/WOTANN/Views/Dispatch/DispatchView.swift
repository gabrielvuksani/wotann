import SwiftUI

// MARK: - DispatchView

/// Compose and send tasks from phone to desktop.
struct DispatchView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var promptText = ""
    @State private var selectedTemplate: DispatchTemplate?
    @State private var isDispatching = false
    @State private var showConfirmation = false
    @State private var errorMessage: String?

    var canDispatch: Bool {
        !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !isDispatching &&
        connectionManager.isConnected
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: WTheme.Spacing.lg) {
                    // Header
                    headerSection
                        .wStaggered(index: 0)

                    // Templates
                    templateGrid
                        .wStaggered(index: 1)

                    // Prompt input
                    promptSection
                        .wStaggered(index: 2)

                    // Dispatch button
                    dispatchButton
                        .wStaggered(index: 3)
                }
                .padding()
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Dispatch")
            .alert("Task Dispatched", isPresented: $showConfirmation) {
                Button("OK") { showConfirmation = false }
            } message: {
                Text("Your task has been sent to the desktop. Check the Agents tab for progress.")
            }
        }
    }

    // MARK: - Sections

    private var headerSection: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Image(systemName: "paperplane.fill")
                .font(.wotannScaled(size: 40))
                .foregroundStyle(WTheme.Gradients.accent)
                .wSlideUp()

            Text("Dispatch a Task")
                .font(WTheme.Typography.title2)
                .tracking(WTheme.Tracking.tighter)
                .foregroundColor(WTheme.Colors.textPrimary)

            Text("Send a task to your desktop WOTANN.\nIt will execute with full Desktop Control.")
                .multilineTextAlignment(.center)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)

            if !connectionManager.isConnected {
                HStack(spacing: WTheme.Spacing.xs) {
                    Image(systemName: "wifi.slash")
                        .font(.caption)
                    Text("Not connected to desktop")
                        .font(WTheme.Typography.caption)
                }
                .foregroundColor(WTheme.Colors.error)
                .padding(.top, WTheme.Spacing.xs)
            }
        }
    }

    private var templateGrid: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Quick Templates")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)

            TaskTemplateList(
                selectedTemplate: $selectedTemplate,
                onSelect: { template in
                    selectedTemplate = template
                    if template != .custom {
                        promptText = template.defaultPrompt
                    }
                    HapticService.shared.trigger(.selection)
                }
            )
        }
    }

    private var promptSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Task Description")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)

            TextField("Describe what you want WOTANN to do...", text: $promptText, axis: .vertical)
                .font(WTheme.Typography.body)
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(4...10)
                .padding(WTheme.Spacing.md)
                .background(WTheme.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: WTheme.Radius.md)
                        .strokeBorder(WTheme.Colors.border, lineWidth: 1)
                )

            if let error = errorMessage {
                Text(error)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.error)
            }
        }
    }

    private var dispatchButton: some View {
        Button {
            Task { await dispatch() }
        } label: {
            HStack(spacing: WTheme.Spacing.sm) {
                if isDispatching {
                    ProgressView()
                        .tint(.white)
                } else {
                    Image(systemName: "paperplane.fill")
                }
                Text(isDispatching ? "Dispatching..." : "Send to Desktop")
                    .font(WTheme.Typography.headline)
            }
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, WTheme.Spacing.md)
            .background(canDispatch ? WTheme.Colors.primary : WTheme.Colors.surfaceAlt)
            .foregroundColor(canDispatch ? .white : WTheme.Colors.textTertiary)
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
            .shadow(
                color: canDispatch ? WTheme.Colors.primary.opacity(0.3) : .clear,
                radius: canDispatch ? 8 : 0,
                x: 0,
                y: 4
            )
        }
        .disabled(!canDispatch)
        .animation(WTheme.Animation.smooth, value: canDispatch)
        .accessibilityLabel(isDispatching ? "Dispatching task" : "Send to Desktop")
        .accessibilityHint(canDispatch ? "Send the task to your desktop WOTANN" : "Enter a task description and connect to desktop first")
    }

    // MARK: - Actions

    private func dispatch() async {
        let prompt = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }

        isDispatching = true
        errorMessage = nil

        let request = DispatchRequest(
            prompt: prompt,
            provider: appState.currentProvider,
            model: appState.currentModel,
            template: selectedTemplate
        )

        do {
            let task = try await connectionManager.rpcClient.dispatchTask(request)
            appState.addAgent(task)
            showConfirmation = true
            promptText = ""
            selectedTemplate = nil
            HapticService.shared.trigger(.taskComplete)
        } catch {
            errorMessage = "Dispatch failed: \(error.localizedDescription)"
            HapticService.shared.trigger(.error)
        }

        isDispatching = false
    }
}
