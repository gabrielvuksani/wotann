import SwiftUI

// MARK: - DiagnosticsView

/// System diagnostics: doctor check, workers status, audit trail, and mode switching.
struct DiagnosticsView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var doctorResults: [String: RPCValue] = [:]
    @State private var workerStatus: [String: RPCValue] = [:]
    @State private var auditEntries: [[String: RPCValue]] = []
    @State private var currentMode = "agent"
    @State private var isRunningDoctor = false
    @State private var isLoadingWorkers = false

    var body: some View {
        NavigationStack {
            List {
                doctorSection
                modeSection
                workersSection
                auditSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("Diagnostics")
            .onAppear { loadAll() }
            .refreshable { loadAll() }
        }
    }

    // MARK: - Doctor

    private var doctorSection: some View {
        Section {
            Button {
                runDoctor()
            } label: {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "stethoscope")
                        .font(.system(size: 16))
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: 28)

                    VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                        Text("Run Health Check")
                            .font(WTheme.Typography.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Text("Check system status, dependencies, and configuration")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }

                    Spacer()

                    if isRunningDoctor {
                        ProgressView().scaleEffect(0.8)
                    }
                }
            }
            .disabled(isRunningDoctor)

            if !doctorResults.isEmpty {
                ForEach(Array(doctorResults.sorted(by: { $0.key < $1.key })), id: \.key) { key, value in
                    HStack {
                        Text(key)
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Spacer()
                        Text(value.stringValue ?? "\(value.doubleValue ?? 0)")
                            .font(WTheme.Typography.code)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                }
            }
        } header: {
            Text("Health Check")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Mode

    private var modeSection: some View {
        Section {
            ForEach(["agent", "chat", "build", "review", "research"], id: \.self) { mode in
                Button {
                    switchMode(mode)
                } label: {
                    HStack {
                        Image(systemName: modeIcon(mode))
                            .foregroundColor(mode == currentMode ? WTheme.Colors.primary : WTheme.Colors.textTertiary)
                            .frame(width: 28)
                        Text(mode.capitalized)
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Spacer()
                        if mode == currentMode {
                            Image(systemName: "checkmark")
                                .foregroundColor(WTheme.Colors.primary)
                                .font(.caption)
                        }
                    }
                }
            }
        } header: {
            Text("Mode")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Workers

    private var workersSection: some View {
        Section {
            if isLoadingWorkers {
                HStack {
                    Spacer()
                    ProgressView().scaleEffect(0.8)
                    Spacer()
                }
            } else if workerStatus.isEmpty {
                Text("No active workers")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
            } else {
                ForEach(Array(workerStatus.sorted(by: { $0.key < $1.key })), id: \.key) { key, value in
                    HStack {
                        Text(key)
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Spacer()
                        Text(value.stringValue ?? "\(Int(value.doubleValue ?? 0))")
                            .font(WTheme.Typography.code)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                }
            }
        } header: {
            Text("Workers")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Audit Trail

    private var auditSection: some View {
        Section {
            if auditEntries.isEmpty {
                Text("No audit entries")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
            } else {
                ForEach(Array(auditEntries.prefix(20).enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                        Text(entry["action"]?.stringValue ?? entry["type"]?.stringValue ?? "Action")
                            .font(WTheme.Typography.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        if let ts = entry["timestamp"]?.stringValue {
                            Text(ts)
                                .font(WTheme.Typography.caption2)
                                .fontDesign(.monospaced)
                                .foregroundColor(WTheme.Colors.textTertiary)
                        }
                    }
                }
            }
        } header: {
            Text("Audit Trail")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Helpers

    private func modeIcon(_ mode: String) -> String {
        switch mode {
        case "agent": return "cpu"
        case "chat": return "bubble.left.and.bubble.right"
        case "build": return "hammer"
        case "review": return "eye"
        case "research": return "magnifyingglass"
        default: return "questionmark.circle"
        }
    }

    private func loadAll() {
        loadWorkers()
        loadAudit()
    }

    private func runDoctor() {
        isRunningDoctor = true
        Task {
            do {
                let result = try await connectionManager.rpcClient.send("doctor")
                doctorResults = result.result?.objectValue ?? [:]
            } catch {
                doctorResults = ["error": .string(error.localizedDescription)]
            }
            isRunningDoctor = false
        }
    }

    private func switchMode(_ mode: String) {
        Task {
            do {
                try await connectionManager.rpcClient.setMode(mode)
                currentMode = mode
                HapticService.shared.trigger(.selection)
            } catch {}
        }
    }

    private func loadWorkers() {
        isLoadingWorkers = true
        Task {
            do {
                let response = try await connectionManager.rpcClient.send("workers.status")
                workerStatus = response.result?.objectValue ?? [:]
            } catch {}
            isLoadingWorkers = false
        }
    }

    private func loadAudit() {
        Task {
            do {
                let response = try await connectionManager.rpcClient.send("audit.query", params: [
                    "limit": .double(20),
                ])
                auditEntries = (response.result?.objectValue?["entries"]?.arrayValue ?? [])
                    .compactMap { $0.objectValue }
            } catch {}
        }
    }
}

#Preview {
    DiagnosticsView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
