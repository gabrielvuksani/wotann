import Foundation

// MARK: - ConversationStore

/// UserDefaults-based offline cache for conversations.
/// Provides persistence between sessions when the desktop is unreachable.
final class ConversationStore {
    static let shared = ConversationStore()

    private let defaults = UserDefaults.standard
    private let conversationsKey = "wotann.cached.conversations"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    private init() {
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    // MARK: - Read

    func loadConversations() -> [Conversation] {
        guard let data = defaults.data(forKey: conversationsKey) else { return [] }
        return (try? decoder.decode([Conversation].self, from: data)) ?? []
    }

    func loadConversation(id: UUID) -> Conversation? {
        loadConversations().first { $0.id == id }
    }

    // MARK: - Write

    func saveConversations(_ conversations: [Conversation]) {
        guard let data = try? encoder.encode(conversations) else { return }
        defaults.set(data, forKey: conversationsKey)
    }

    func saveConversation(_ conversation: Conversation) {
        var all = loadConversations()
        if let index = all.firstIndex(where: { $0.id == conversation.id }) {
            all[index] = conversation
        } else {
            all.insert(conversation, at: 0)
        }
        saveConversations(all)
    }

    func removeConversation(id: UUID) {
        let filtered = loadConversations().filter { $0.id != id }
        saveConversations(filtered)
    }

    // MARK: - Utilities

    func clearAll() {
        defaults.removeObject(forKey: conversationsKey)
    }

    func approximateSize() -> Int {
        guard let data = defaults.data(forKey: conversationsKey) else { return 0 }
        return data.count
    }
}
