import Foundation

// MARK: - Team Coordination Types
//
// Mirrors src/orchestration/team-templates.ts + file-transport.ts.
// ClawTeam-style multi-agent coordination via TOML templates + file
// inbox transport.

struct TeamTemplateSummary: Identifiable, Equatable {
    var id: String { name }
    let name: String
    let description: String
    let source: String
    let leaderName: String
    let agentNames: [String]
}

struct InboxMessage: Identifiable, Equatable {
    let id: String
    let from: String
    let to: String
    let body: String
    let enqueuedAt: String
}

struct TeamBoardEntry: Identifiable, Equatable {
    var id: String { agent }
    let agent: String
    let pending: Int
    let consumed: Int
    let done: Int
}
