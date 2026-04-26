import SwiftUI

// MARK: - UndoView
//
// Surfaces the daemon's shadow-git checkpoint ring buffer so the user can
// inspect what's recoverable and roll back individual edits or whole turns.
// Without this view the GitPreCheckpointHook ring was write-only on iOS —
// every prior edit was preserved in shadow git but unreachable.
//
// Daemon RPCs (verified against src/daemon/kairos-rpc.ts:5459-5578):
//   shadow.checkpoints                 -> { ok, checkpoints: [{hash,label,timestamp,toolName}] }
//   shadow.undo       { toolName }     -> { ok, restored, recent: [...] }
//   shadow.undo-turn  { turnsBack? }   -> { ok, restored, turnsBack, checkpoint, available }
//
// Note: the spec asks for `shadow.undo { steps }` but the daemon handler
// actually requires `{ toolName }` — see kairos-rpc.ts:5464. Per-step undo
// is exposed via shadow.undo-turn { turnsBack }, so this view uses
// turnsBack for the stepper-driven flow. Logged in the report.

// MARK: - Domain

struct ShadowCheckpoint: Identifiable, Hashable {
    let id: String
    let hash: String
    let label: String
    let timestamp: Date
    let toolName: String?

    init(hash: String, label: String, timestamp: Date, toolName: String?) {
        // The hash is unique per checkpoint; use it as the SwiftUI identity.
        self.id = hash
        self.hash = hash
        self.label = label
        self.timestamp = timestamp
        self.toolName = toolName
    }
}

// MARK: - View

struct UndoView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var checkpoints: [ShadowCheckpoint] = []
    @State private var isLoading = false
    @State private var isUndoing = false
    @State private var errorMessage: String?
    @State private var statusMessage: String?
    @State private var stepsToUndo: Int = 1

    var body: some View {
        VStack(spacing: 0) {
            if let error = errorMessage {
                ErrorBanner(message: error)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .padding(.top, WTheme.Spacing.sm)
            } else if let status = statusMessage {
                ErrorBanner(message: status, type: .warning)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .padding(.top, WTheme.Spacing.sm)
            }

            List {
                actionsSection
                checkpointsSection
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
        }
        .background(WTheme.Colors.background)
        .navigationTitle("Undo & Checkpoints")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(isLoading || isUndoing)
                .accessibilityLabel("Refresh checkpoints")
            }
        }
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    // MARK: - Action section (undo last turn + N steps)

    private var actionsSection: some View {
        Section {
            Button {
                Task { await undoLastTurn() }
            } label: {
                HStack {
                    Image(systemName: "arrow.uturn.backward.circle.fill")
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: WTheme.IconSize.md)
                    Text("Undo last turn")
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Spacer()
                    if isUndoing {
                        ProgressView().controlSize(.small)
                    }
                }
                .frame(minHeight: 44)
            }
            .disabled(isUndoing || checkpoints.isEmpty)
            .accessibilityLabel("Undo the most recent conversation turn")

            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                Stepper(value: $stepsToUndo, in: 1...max(1, checkpoints.count)) {
                    HStack {
                        Text("Steps to undo")
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Spacer()
                        Text("\(stepsToUndo)")
                            .font(.wotannScaled(size: 16, weight: .semibold, design: .monospaced))
                            .foregroundColor(WTheme.Colors.primary)
                    }
                }

                Button {
                    Task { await undoSteps(stepsToUndo) }
                } label: {
                    HStack {
                        Spacer()
                        Image(systemName: "arrow.uturn.backward")
                        Text("Undo \(stepsToUndo) step\(stepsToUndo == 1 ? "" : "s")")
                            .fontWeight(.semibold)
                        Spacer()
                    }
                    .frame(minHeight: 44)
                    .foregroundColor(.white)
                    .background(WTheme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                }
                .buttonStyle(.plain)
                .disabled(isUndoing || checkpoints.isEmpty)
                .accessibilityLabel("Undo \(stepsToUndo) steps")
            }
            .padding(.vertical, WTheme.Spacing.xs)
        } header: {
            Text("Actions")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        } footer: {
            Text("Each undo restores the most recent shadow-git checkpoint that was created before the corresponding tool ran. The desktop daemon owns the checkpoint ring — the iOS app cannot create new ones.")
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Checkpoint list

    @ViewBuilder
    private var checkpointsSection: some View {
        if isLoading && checkpoints.isEmpty {
            Section {
                HStack {
                    Spacer()
                    ProgressView().tint(WTheme.Colors.primary)
                    Spacer()
                }
                .frame(minHeight: 80)
                .listRowBackground(WTheme.Colors.surface)
            }
        } else if checkpoints.isEmpty {
            Section {
                EmptyState(
                    icon: "clock.arrow.circlepath",
                    title: "No checkpoints",
                    subtitle: "Shadow-git records a checkpoint before each Write/Edit/NotebookEdit on the desktop. Run a tool there, then refresh."
                )
                .frame(minHeight: 200)
                .listRowBackground(WTheme.Colors.surface)
                .listRowInsets(EdgeInsets())
            }
        } else {
            Section {
                ForEach(checkpoints) { checkpoint in
                    CheckpointRow(checkpoint: checkpoint)
                        .listRowBackground(WTheme.Colors.surface)
                }
            } header: {
                Text("\(checkpoints.count) recent")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
            } footer: {
                Text("Newest first. Tap Refresh to pull the latest from the desktop.")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
    }

    // MARK: - Loading

    @MainActor
    private func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await connectionManager.rpcClient.send("shadow.checkpoints")
            let result = response.result?.objectValue ?? [:]
            // Honest failure path — when the runtime isn't initialized the
            // daemon returns ok:false with an error string. Surface it
            // instead of silently rendering an empty list.
            if let ok = result["ok"]?.boolValue, !ok {
                let detail = result["error"]?.stringValue ?? "Unknown daemon error"
                errorMessage = "shadow.checkpoints failed: \(detail)"
                checkpoints = []
                return
            }
            let list = result["checkpoints"]?.arrayValue ?? []
            checkpoints = list.compactMap { decodeCheckpoint($0) }
            // Cap stepsToUndo so the stepper bounds stay valid as the list shrinks.
            stepsToUndo = min(stepsToUndo, max(1, checkpoints.count))
        } catch {
            errorMessage = "Failed to load checkpoints: \(error.localizedDescription)"
        }
    }

    private func decodeCheckpoint(_ value: RPCValue) -> ShadowCheckpoint? {
        guard let obj = value.objectValue,
              let hash = obj["hash"]?.stringValue else { return nil }
        let label = obj["label"]?.stringValue ?? "(no label)"
        let toolName = obj["toolName"]?.stringValue
        let timestamp: Date = {
            // Daemon emits unix milliseconds. Handle both int and double
            // since JSON-RPC may round-trip the number either way.
            if let ms = obj["timestamp"]?.intValue {
                return Date(timeIntervalSince1970: Double(ms) / 1000.0)
            }
            if let ms = obj["timestamp"]?.doubleValue {
                return Date(timeIntervalSince1970: ms / 1000.0)
            }
            return Date()
        }()
        return ShadowCheckpoint(hash: hash, label: label, timestamp: timestamp, toolName: toolName)
    }

    // MARK: - Undo actions

    @MainActor
    private func undoLastTurn() async {
        isUndoing = true
        statusMessage = nil
        errorMessage = nil
        defer { isUndoing = false }

        do {
            let response = try await connectionManager.rpcClient.send("shadow.undo-turn")
            let result = response.result?.objectValue ?? [:]
            if result["ok"]?.boolValue == true {
                let restoredHash = result["checkpoint"]?.objectValue?["hash"]?.stringValue ?? "?"
                statusMessage = "Restored to \(String(restoredHash.prefix(8)))"
                HapticService.shared.trigger(.taskComplete)
            } else {
                let detail = result["error"]?.stringValue ?? "Unknown daemon error"
                errorMessage = "Undo failed: \(detail)"
            }
            await refresh()
        } catch {
            errorMessage = "Undo failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func undoSteps(_ steps: Int) async {
        isUndoing = true
        statusMessage = nil
        errorMessage = nil
        defer { isUndoing = false }

        do {
            // The daemon's shadow.undo handler takes `{ toolName }`, not
            // `{ steps }`. For multi-step undo we use shadow.undo-turn with
            // turnsBack=N which walks the ring backwards by N turns. This
            // matches how the macOS undo path works.
            let response = try await connectionManager.rpcClient.send("shadow.undo-turn", params: [
                "turnsBack": .int(steps),
            ])
            let result = response.result?.objectValue ?? [:]
            if result["ok"]?.boolValue == true {
                let actual = result["turnsBack"]?.intValue ?? steps
                statusMessage = "Rewound \(actual) step\(actual == 1 ? "" : "s")"
                HapticService.shared.trigger(.taskComplete)
            } else {
                let detail = result["error"]?.stringValue ?? "Unknown daemon error"
                errorMessage = "Undo failed: \(detail)"
            }
            await refresh()
        } catch {
            errorMessage = "Undo failed: \(error.localizedDescription)"
        }
    }
}

// MARK: - Row

private struct CheckpointRow: View {
    let checkpoint: ShadowCheckpoint

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: iconForTool(checkpoint.toolName))
                    .foregroundColor(WTheme.Colors.primary)
                    .frame(width: WTheme.IconSize.md)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(checkpoint.label)
                        .font(WTheme.Typography.body)
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .lineLimit(2)

                    HStack(spacing: WTheme.Spacing.sm) {
                        if let toolName = checkpoint.toolName, !toolName.isEmpty {
                            Text(toolName)
                                .font(.wotannScaled(size: 11, weight: .medium))
                                .padding(.horizontal, WTheme.Spacing.xs)
                                .padding(.vertical, 2)
                                .background(WTheme.Colors.primary.opacity(0.15))
                                .foregroundColor(WTheme.Colors.primary)
                                .clipShape(Capsule())
                        }
                        Text(checkpoint.timestamp.formatted(date: .abbreviated, time: .standard))
                            .font(WTheme.Typography.caption2)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }

                Spacer()

                Text(String(checkpoint.hash.prefix(8)))
                    .font(.wotannScaled(size: 11, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }

    private func iconForTool(_ toolName: String?) -> String {
        switch toolName {
        case "Write":         return "doc.fill.badge.plus"
        case "Edit":          return "pencil"
        case "NotebookEdit":  return "book"
        case "MultiEdit":     return "square.stack.3d.up.fill"
        default:              return "clock.arrow.circlepath"
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    NavigationStack {
        UndoView()
            .environmentObject(ConnectionManager())
    }
    .preferredColorScheme(.dark)
}
#endif
