import SwiftUI

// MARK: - TeamsView
//
// Multi-agent team templates + inbox transport (ClawTeam port).
// Mirrors the desktop TeamsPanel.

struct TeamsView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var templates: [TeamTemplateSummary] = []
    @State private var team = "alpha"
    @State private var agent = "builder"
    @State private var body_ = "hello team"
    @State private var board: [TeamBoardEntry] = []
    @State private var received: [InboxMessage] = []
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
                    description
                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundColor(WTheme.Colors.warning)
                            .font(.callout)
                            .padding(WTheme.Spacing.sm)
                            .background(WTheme.Colors.warning.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                    }
                    templatesSection
                    inboxSection
                }
                .padding(WTheme.Spacing.md)
            }
            .navigationTitle("Teams")
            .navigationBarTitleDisplayMode(.large)
            .task { await refresh() }
            .refreshable { await refresh() }
        }
    }

    private var description: some View {
        Text("Multi-agent team templates and inbox transport. Templates spawn coordinated agent teams; the inbox lets agents (or you) hand off work between them.")
            .font(.callout)
            .foregroundColor(WTheme.Colors.textSecondary)
    }

    private var templatesSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Available templates").font(.headline)
            if templates.isEmpty {
                Text("Loading…").font(.callout).foregroundColor(WTheme.Colors.textSecondary)
            } else {
                ForEach(templates) { tpl in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(tpl.name).font(.headline)
                            Spacer()
                            Text(tpl.source)
                                .font(.caption2)
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(WTheme.Colors.surfaceAlt)
                                .clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                        Text(tpl.description).font(.callout).foregroundColor(WTheme.Colors.textSecondary)
                        Text("leader: \(tpl.leaderName) | agents: \(tpl.agentNames.joined(separator: ", "))")
                            .font(.caption)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                    .padding(WTheme.Spacing.md)
                    .background(WTheme.Colors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                }
            }
        }
    }

    private var inboxSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Inbox").font(.headline)
            HStack {
                TextField("Team", text: $team).textFieldStyle(.roundedBorder)
                TextField("Agent", text: $agent).textFieldStyle(.roundedBorder)
            }
            TextField("Message body", text: $body_).textFieldStyle(.roundedBorder)
            HStack {
                Button("Send") { Task { await send() } }.buttonStyle(.bordered)
                Button("Receive") { Task { await receive() } }.buttonStyle(.bordered)
                Button("Refresh board") { Task { await refreshBoard() } }.buttonStyle(.bordered)
            }
            if !received.isEmpty {
                Text("Received").font(.subheadline).padding(.top, 4)
                ForEach(received) { m in
                    HStack {
                        Text("\(m.from) → \(m.to)").font(.caption.bold())
                        Spacer()
                        Text(m.body).font(.callout)
                    }
                }
            }
            if !board.isEmpty {
                Text("Board").font(.subheadline).padding(.top, 4)
                ForEach(board) { entry in
                    HStack {
                        Text(entry.agent).font(.callout.monospaced()).frame(maxWidth: .infinity, alignment: .leading)
                        Text("p:\(entry.pending) c:\(entry.consumed) d:\(entry.done)").font(.caption.monospaced())
                    }
                }
            }
        }
    }

    private func refresh() async {
        guard connectionManager.isPaired else { return }
        do {
            templates = try await connectionManager.rpcClient.teamsListTemplates()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func send() async {
        do {
            _ = try await connectionManager.rpcClient.teamsSend(team: team, to: agent, body: body_)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func receive() async {
        do {
            received = try await connectionManager.rpcClient.teamsReceive(team: team, agent: agent)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshBoard() async {
        do {
            board = try await connectionManager.rpcClient.teamsBoard(team: team, agents: ["lead", "builder", "verifier"])
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
