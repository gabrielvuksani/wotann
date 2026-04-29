import Foundation

// MARK: - Block Memory Types
//
// Mirrors src/memory/block-memory.ts. Letta-style core memory the agent
// reads on every turn via the GuidanceWhisper hook.

struct BlockSummary: Identifiable, Equatable {
    var id: String { kind }
    let kind: String
    let bytes: Int
    let limit: Int
    let truncated: Bool
    let updatedAt: String
}

struct MemoryBlock: Equatable {
    let kind: String
    let content: String
    let updatedAt: String
    let truncatedAt: String?
}

struct BlockKindInfo: Identifiable, Equatable {
    var id: String { kind }
    let kind: String
    let limit: Int
}

extension BlockSummary {
    static let allKinds: [String] = [
        "persona", "human", "task", "project", "scratch", "issues",
        "decisions", "bindings", "custom1", "custom2", "custom3", "custom4",
    ]

    static let labels: [String: String] = [
        "persona": "Persona",
        "human": "About You",
        "task": "Current Task",
        "project": "Project Context",
        "scratch": "Scratchpad",
        "issues": "Known Issues",
        "decisions": "Decisions",
        "bindings": "Bindings",
        "custom1": "Custom 1",
        "custom2": "Custom 2",
        "custom3": "Custom 3",
        "custom4": "Custom 4",
    ]

    static let helps: [String: String] = [
        "persona": "How the agent should behave and sound (tone, voice, defaults).",
        "human": "Facts about you the agent should remember.",
        "task": "What you're working on right now.",
        "project": "Project-level conventions and constraints.",
        "scratch": "Short-lived notes for the current session.",
        "issues": "Known bugs or open problems to keep in mind.",
        "decisions": "Architectural decisions worth carrying forward.",
        "bindings": "Aliases for env vars, paths, or other shorthand.",
        "custom1": "User-defined slot.",
        "custom2": "User-defined slot.",
        "custom3": "User-defined slot.",
        "custom4": "User-defined slot.",
    ]
}
