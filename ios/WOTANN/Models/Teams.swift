import Foundation

// MARK: - Team Coordination Types
//
// Mirrors src/orchestration/team-templates.ts + file-transport.ts.
// ClawTeam-style multi-agent coordination via TOML templates + file
// inbox transport.

/// One agent in a team template (leader OR follower). The `type` field
/// is what 799b870 commit-body called the "deferred agent type" — it
/// travels through the daemon and shapes how the team-spawn shell
/// treats this agent (subagent vs builtin vs forge'd skill).
struct TeamAgent: Identifiable, Equatable {
    var id: String { name }
    let name: String
    let type: String
    let task: String?
    let model: String?
}

/// Listing-shape returned by `teams.listTemplates`. Now carries the
/// full per-agent type so iOS panels can show the team composition
/// (e.g. "1 leader, 2 reviewers, 1 verifier") without a follow-up
/// `teams.showTemplate` round-trip.
struct TeamTemplateSummary: Identifiable, Equatable {
    var id: String { name }
    let name: String
    let description: String
    let source: String
    let leader: TeamAgent
    let agents: [TeamAgent]

    var leaderName: String { leader.name }
    var leaderType: String { leader.type }
    var agentNames: [String] { agents.map(\.name) }
    var agentTypes: [String] { agents.map(\.type) }
}

/// Rendered template — full shape returned by `teams.showTemplate`
/// after `{goal}` / `{team_name}` / `{agent_name}` substitution.
/// Includes the orchestration metadata (`invokeArgs`, `backend`,
/// `source`, `path`, per-agent `model`) that the prior `[String:
/// RPCValue]` return type silently dropped.
struct RenderedTeamTemplate: Identifiable, Equatable {
    var id: String { name }
    let name: String
    let description: String
    let invokeArgs: [String]
    let backend: String
    let source: String
    let path: String?
    let leader: TeamAgent
    let agents: [TeamAgent]
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

/// Typed result for `attest.genkey`. The daemon at
/// `src/daemon/kairos-rpc.ts:8702` returns either a freshly-generated
/// key (`existed=false`) or hands back the existing one (`existed=true`).
/// iOS panels need to distinguish the two so the UI can show "Created
/// new key for id=X" vs "Loaded existing key" — without `existed`,
/// every call looks identical and the user can't tell whether they
/// just rotated their audit identity.
struct AttestKeyResult: Equatable {
    let id: String
    let publicPem: String
    let existed: Bool
}
