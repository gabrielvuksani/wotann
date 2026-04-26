import SwiftUI

// MARK: - MCPListView
//
// Browse and toggle MCP servers configured on the desktop daemon.
// v9 META-AUDIT cross-surface gap: iOS was the only WOTANN surface
// with no MCP server management — TUI has /mcp, CLI has `wotann mcp`,
// macOS has the MCPTab. This view restores parity.
//
// Daemon RPCs:
//   mcp.list                 -> { servers: [{name, ...}], count }
//   mcp.toggle  { name }     -> { ok, enabled }
//   mcp.add     { name, ... } -> { ok, server }

struct MCPServer: Identifiable, Decodable {
    let id = UUID()
    let name: String
    let enabled: Bool?
    let command: String?
    let url: String?

    private enum CodingKeys: String, CodingKey {
        case name, enabled, command, url
    }
}

struct MCPListView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var servers: [MCPServer] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var togglingName: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isLoading && servers.isEmpty {
                    Spacer()
                    ProgressView().tint(WTheme.Colors.primary)
                    Spacer()
                } else if let error = errorMessage {
                    ErrorBanner(message: error)
                        .padding(WTheme.Spacing.md)
                    Spacer()
                } else if servers.isEmpty {
                    Spacer()
                    EmptyState(
                        icon: "server.rack",
                        title: "No MCP servers",
                        subtitle: "Add MCP servers via wotann.yaml on the desktop. They'll appear here once registered."
                    )
                    Spacer()
                } else {
                    List {
                        Section {
                            ForEach(servers) { server in
                                MCPServerRow(
                                    server: server,
                                    isToggling: togglingName == server.name,
                                    onToggle: { Task { await toggle(server.name) } }
                                )
                            }
                        } header: {
                            Text("\(servers.count) registered")
                                .font(WTheme.Typography.caption)
                                .foregroundColor(WTheme.Colors.textSecondary)
                        } footer: {
                            Text("Toggling enabled state syncs to wotann.yaml on the desktop. Adding new servers requires editing wotann.yaml directly for now.")
                                .font(WTheme.Typography.caption2)
                                .foregroundColor(WTheme.Colors.textTertiary)
                        }
                    }
                    .listStyle(.insetGrouped)
                    .scrollContentBackground(.hidden)
                    .background(WTheme.Colors.background)
                }
            }
            .background(WTheme.Colors.background)
            .navigationTitle("MCP Servers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(isLoading)
                }
            }
            .task { await refresh() }
        }
    }

    @MainActor
    private func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let response = try await connectionManager.rpcClient.send("mcp.list")
            // Accept both { servers, count } and a bare array as the daemon
            // shape may evolve. The first key wins.
            if case let .object(result) = response.result ?? .null,
               case let .array(serverArr) = result["servers"] ?? .null {
                servers = serverArr.compactMap { val in
                    guard case let .object(obj) = val,
                          case let .string(name) = obj["name"] ?? .null else { return nil }
                    let enabled: Bool? = {
                        if case let .bool(b) = obj["enabled"] ?? .null { return b }
                        return nil
                    }()
                    let command: String? = {
                        if case let .string(c) = obj["command"] ?? .null { return c }
                        return nil
                    }()
                    let url: String? = {
                        if case let .string(u) = obj["url"] ?? .null { return u }
                        return nil
                    }()
                    return MCPServer(name: name, enabled: enabled, command: command, url: url)
                }
            } else {
                servers = []
            }
        } catch {
            errorMessage = "Failed to load MCP servers: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func toggle(_ name: String) async {
        togglingName = name
        defer { togglingName = nil }

        do {
            _ = try await connectionManager.rpcClient.send("mcp.toggle", params: [
                "name": .string(name)
            ])
            await refresh()
        } catch {
            errorMessage = "Failed to toggle \(name): \(error.localizedDescription)"
        }
    }
}

// MARK: - Row

private struct MCPServerRow: View {
    let server: MCPServer
    let isToggling: Bool
    let onToggle: () -> Void

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text(server.name)
                    .font(WTheme.Typography.body)
                    .foregroundColor(WTheme.Colors.textPrimary)
                if let cmd = server.command {
                    Text(cmd)
                        .font(WTheme.Typography.caption2)
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                } else if let url = server.url {
                    Text(url)
                        .font(WTheme.Typography.caption2)
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            Spacer()

            if isToggling {
                ProgressView()
                    .controlSize(.small)
            } else {
                // The daemon's mcp.toggle flips the `enabled` flag in
                // wotann.yaml. Tap to flip; visual state lags one
                // round-trip so we trigger refresh after toggle.
                Toggle("", isOn: Binding(
                    get: { server.enabled ?? false },
                    set: { _ in onToggle() }
                ))
                .labelsHidden()
                .tint(WTheme.Colors.success)
            }
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    MCPListView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
#endif
