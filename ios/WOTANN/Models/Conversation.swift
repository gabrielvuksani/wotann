import Foundation

// MARK: - Conversation

/// A conversation synced from the desktop WOTANN instance.
struct Conversation: Identifiable, Codable, Hashable {
    let id: UUID
    var title: String
    var messages: [Message]
    var provider: String
    var model: String
    var isIncognito: Bool
    var isStarred: Bool
    var isArchived: Bool
    var cost: Double
    let createdAt: Date
    var updatedAt: Date

    var preview: String {
        messages.last?.content.prefix(120).description ?? ""
    }

    var messageCount: Int { messages.count }

    init(
        id: UUID = UUID(),
        title: String,
        messages: [Message] = [],
        provider: String = "anthropic",
        model: String = "claude-opus-4-6",
        isIncognito: Bool = false,
        isStarred: Bool = false,
        isArchived: Bool = false,
        cost: Double = 0,
        createdAt: Date = .now,
        updatedAt: Date = .now
    ) {
        self.id = id
        self.title = title
        self.messages = messages
        self.provider = provider
        self.model = model
        self.isIncognito = isIncognito
        self.isStarred = isStarred
        self.isArchived = isArchived
        self.cost = cost
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

// MARK: - Message

/// A single message in a conversation.
struct Message: Identifiable, Codable, Hashable {
    let id: UUID
    let role: MessageRole
    var content: String
    var provider: String?
    var model: String?
    var tokensUsed: Int?
    var cost: Double?
    let timestamp: Date
    var artifacts: [Artifact]
    var isStreaming: Bool

    init(
        id: UUID = UUID(),
        role: MessageRole,
        content: String,
        provider: String? = nil,
        model: String? = nil,
        tokensUsed: Int? = nil,
        cost: Double? = nil,
        timestamp: Date = .now,
        artifacts: [Artifact] = [],
        isStreaming: Bool = false
    ) {
        self.id = id
        self.role = role
        self.content = content
        self.provider = provider
        self.model = model
        self.tokensUsed = tokensUsed
        self.cost = cost
        self.timestamp = timestamp
        self.artifacts = artifacts
        self.isStreaming = isStreaming
    }
}

// MARK: - MessageRole

enum MessageRole: String, Codable, Hashable {
    case user
    case assistant
    case system
}

// MARK: - Artifact

/// An inline artifact embedded within a message (code, diff, diagram, etc).
struct Artifact: Identifiable, Codable, Hashable {
    let id: UUID
    let type: ArtifactType
    var content: String
    var language: String?
    var title: String?

    init(
        id: UUID = UUID(),
        type: ArtifactType,
        content: String,
        language: String? = nil,
        title: String? = nil
    ) {
        self.id = id
        self.type = type
        self.content = content
        self.language = language
        self.title = title
    }
}

enum ArtifactType: String, Codable, Hashable {
    case code
    case diff
    case diagram
    case table
    case chart
    case document
}
