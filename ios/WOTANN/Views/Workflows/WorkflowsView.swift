import SwiftUI

// MARK: - WorkflowsView

/// Browse, trigger, and monitor workflow DAGs from the phone.
struct WorkflowsView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var workflows: [[String: RPCValue]] = []
    @State private var isLoading = false
    @State private var selectedWorkflow: [String: RPCValue]?

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().tint(WTheme.Colors.primary).frame(maxHeight: .infinity)
                } else if workflows.isEmpty {
                    EmptyState(
                        icon: "arrow.triangle.branch",
                        title: "No Workflows",
                        subtitle: "Create workflow DAGs on your desktop to see them here."
                    )
                } else {
                    workflowList
                }
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Workflows")
            .onAppear { loadWorkflows() }
            .refreshable { loadWorkflows() }
        }
    }

    private var workflowList: some View {
        List(Array(workflows.enumerated()), id: \.offset) { _, workflow in
            Button {
                selectedWorkflow = workflow
            } label: {
                HStack(spacing: WTheme.Spacing.md) {
                    Image(systemName: "arrow.triangle.branch")
                        .font(.system(size: 16))
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: 32, height: 32)
                        .background(WTheme.Colors.primary.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))

                    VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                        Text(workflow["name"]?.stringValue ?? "Workflow")
                            .font(WTheme.Typography.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(WTheme.Colors.textPrimary)

                        if let status = workflow["status"]?.stringValue {
                            Text(status.capitalized)
                                .font(WTheme.Typography.caption)
                                .foregroundColor(statusColor(status))
                        }
                    }
                    Spacer()
                    if let nodeCount = workflow["nodeCount"]?.intValue {
                        Text("\(nodeCount) nodes")
                            .font(WTheme.Typography.caption2)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }
            }
            .buttonStyle(.plain)
            .listRowBackground(WTheme.Colors.surface)
        }
        .listStyle(.plain)
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "running": return WTheme.Colors.primary
        case "completed": return WTheme.Colors.success
        case "failed": return WTheme.Colors.error
        default: return WTheme.Colors.textTertiary
        }
    }

    private func loadWorkflows() {
        isLoading = true
        Task {
            do {
                let response = try await connectionManager.rpcClient.send("workflow.list")
                let list = response.result?.objectValue?["workflows"]?.arrayValue ?? []
                workflows = list.compactMap { $0.objectValue }
            } catch {
                workflows = []
            }
            isLoading = false
        }
    }
}

#Preview {
    WorkflowsView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
