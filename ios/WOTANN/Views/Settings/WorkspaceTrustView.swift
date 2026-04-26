import SwiftUI

// MARK: - WorkspaceTrustView (PHASE C — SB-N1 lift to UI)

/// iOS UI for managing trusted workspaces. Without trust, the daemon
/// silently drops CLAUDE.md / AGENTS.md / .cursorrules from untrusted
/// workspace dirs — this view surfaces the trust ledger so users can
/// add/remove workspaces from their phone after pairing.
///
/// Wires to daemon RPC handlers `workspace.trust`, `workspace.untrust`,
/// `workspace.trust.list` (added in kairos-rpc.ts in this same change).
struct WorkspaceTrustView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var trustedHashes: [String] = []
    @State private var newPath: String = ""
    @State private var statusMessage: String?
    @State private var isLoading = false

    var body: some View {
        Form {
            Section {
                if isLoading {
                    ProgressView()
                } else if trustedHashes.isEmpty {
                    Text("No trusted workspaces yet.")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)
                } else {
                    ForEach(trustedHashes, id: \.self) { hash in
                        HStack {
                            Image(systemName: "checkmark.shield.fill")
                                .foregroundColor(WTheme.Colors.success)
                            Text(hash)
                                .font(.system(.caption, design: .monospaced))
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                }
            } header: {
                Text("Trusted Workspaces (\(trustedHashes.count))")
            } footer: {
                Text("Workspaces listed here load CLAUDE.md, AGENTS.md, and .cursorrules. Untrusted workspaces silently drop these files.")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            Section {
                TextField("Workspace path (e.g. /Users/me/projects/foo)", text: $newPath)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.system(.body, design: .monospaced))

                Button {
                    Task { @MainActor in
                        await trustWorkspace()
                    }
                } label: {
                    Label("Trust This Workspace", systemImage: "plus.shield")
                        .frame(maxWidth: .infinity)
                }
                .disabled(newPath.trimmingCharacters(in: .whitespaces).isEmpty || isLoading)

                if let msg = statusMessage {
                    Text(msg)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(
                            msg.starts(with: "Error") ? WTheme.Colors.danger : WTheme.Colors.success
                        )
                }
            } header: {
                Text("Add Workspace")
            }
        }
        .navigationTitle("Trusted Workspaces")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await loadTrusted()
        }
    }

    @MainActor
    private func loadTrusted() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await connectionManager.rpcClient.send(
                "workspace.trust.list", params: [:]
            )
            if let arr = response.result?.objectValue?["hashes"]?.arrayValue {
                trustedHashes = arr.compactMap { $0.stringValue }.sorted()
            }
        } catch {
            statusMessage = "Error loading list: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func trustWorkspace() async {
        let path = newPath.trimmingCharacters(in: .whitespaces)
        guard !path.isEmpty else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await connectionManager.rpcClient.send(
                "workspace.trust", params: ["path": .string(path)]
            )
            if response.result?.objectValue?["ok"]?.boolValue == true {
                let added = response.result?.objectValue?["added"]?.boolValue ?? false
                statusMessage = added ? "Trusted: \(path)" : "Already trusted: \(path)"
                newPath = ""
                await loadTrusted()
            } else {
                statusMessage = "Error: trust handler did not return ok"
            }
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }
}

#Preview {
    NavigationStack {
        WorkspaceTrustView()
    }
    .preferredColorScheme(.dark)
}
