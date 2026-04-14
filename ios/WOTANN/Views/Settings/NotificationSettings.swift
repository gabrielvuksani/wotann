import SwiftUI

// MARK: - NotificationSettings

/// Per-type notification toggle panel.
/// When toggles change, registers/unregisters notification categories with
/// NotificationService and notifies the desktop via RPC so it knows which
/// notification types to send.
struct NotificationSettings: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @AppStorage("notificationsEnabled") private var notificationsEnabled = true
    @AppStorage("notifyTaskComplete") private var notifyTaskComplete = true
    @AppStorage("notifyErrors") private var notifyErrors = true
    @AppStorage("notifyBudgetAlerts") private var notifyBudgetAlerts = true
    @AppStorage("notifyApprovalRequests") private var notifyApprovalRequests = true

    var body: some View {
        List {
            Section {
                Toggle(isOn: $notificationsEnabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Push Notifications")
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Text("Receive alerts for important events")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }
                .tint(WTheme.Colors.primary)
            }
            .listRowBackground(WTheme.Colors.surface)

            if notificationsEnabled {
                Section("Event Types") {
                    notificationToggle(
                        "Task Completion",
                        icon: "checkmark.circle.fill",
                        color: WTheme.Colors.success,
                        description: "When an agent task finishes",
                        isOn: $notifyTaskComplete
                    )

                    notificationToggle(
                        "Errors",
                        icon: "exclamationmark.triangle.fill",
                        color: WTheme.Colors.error,
                        description: "When something goes wrong",
                        isOn: $notifyErrors
                    )

                    notificationToggle(
                        "Budget Alerts",
                        icon: "chart.bar.fill",
                        color: WTheme.Colors.warning,
                        description: "When nearing budget limits",
                        isOn: $notifyBudgetAlerts
                    )

                    notificationToggle(
                        "Approval Requests",
                        icon: "exclamationmark.shield.fill",
                        color: WTheme.Colors.primary,
                        description: "When an agent needs your approval",
                        isOn: $notifyApprovalRequests
                    )
                }
                .listRowBackground(WTheme.Colors.surface)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WTheme.Colors.background)
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: notificationsEnabled) { _, _ in syncNotificationPreferences() }
        .onChange(of: notifyTaskComplete) { _, _ in syncNotificationPreferences() }
        .onChange(of: notifyErrors) { _, _ in syncNotificationPreferences() }
        .onChange(of: notifyBudgetAlerts) { _, _ in syncNotificationPreferences() }
        .onChange(of: notifyApprovalRequests) { _, _ in syncNotificationPreferences() }
    }

    private func notificationToggle(
        _ title: String,
        icon: String,
        color: Color,
        description: String,
        isOn: Binding<Bool>
    ) -> some View {
        Toggle(isOn: isOn) {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: icon)
                    .foregroundColor(color)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Text(description)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
        }
        .tint(WTheme.Colors.primary)
    }

    // MARK: - Sync Preferences

    /// Register notification categories locally and notify the desktop about
    /// which notification types are enabled.
    private func syncNotificationPreferences() {
        let taskComplete = notificationsEnabled && notifyTaskComplete
        let errors = notificationsEnabled && notifyErrors
        let budget = notificationsEnabled && notifyBudgetAlerts
        let approvals = notificationsEnabled && notifyApprovalRequests

        // Update local notification categories
        NotificationService.shared.updateCategories(
            taskComplete: taskComplete,
            errors: errors,
            budgetAlerts: budget,
            approvalRequests: approvals
        )

        // Inform the desktop which types to send
        Task {
            _ = try? await connectionManager.rpcClient.send("notifications.configure", params: [
                "taskComplete": .bool(taskComplete),
                "errors": .bool(errors),
                "budgetAlerts": .bool(budget),
                "approvalRequests": .bool(approvals),
            ])
        }
    }
}

#Preview {
    NavigationStack {
        NotificationSettings()
    }
    .preferredColorScheme(.dark)
}
