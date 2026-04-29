import SwiftUI

// MARK: - TeamsView
//
// Multi-agent team templates + inbox transport (ClawTeam port).

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
        ScrollView {
            VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
                Text("Multi-agent team templates and inbox transport.")
                    .font(.callout)
                    .foregroundColor(WTheme.Colors.textSecondary)

                if let errorMessage {
                    Text(errorMessage)
                        .foregroundColor(WTheme.Colors.warning)
                        .font(.callout)
                        .padding(WTheme.Spacing.sm)
                        .background(WTheme.Colors.warning.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                }

                Text("Templates").font(.headline)
                if templates.isEmpty {
                    Text("Loading…").font(.callout).foregroundColor(WTheme.Colors.textSecondary)
                } else {
                    ForEach(templates) { tpl in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(tpl.name).font(.headline)
                                Spacer()
                                Text(tpl.source).font(.caption2)
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

                Text("Inbox").font(.headline).padding(.top, 4)
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
                            Text(m.body).font(.callout).lineLimit(2)
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
            .padding(WTheme.Spacing.md)
        }
        .navigationTitle("Teams")
        .task { await refresh() }
        .refreshable { await refresh() }
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
