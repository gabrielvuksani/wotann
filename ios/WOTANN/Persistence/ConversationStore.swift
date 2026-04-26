import Foundation
#if canImport(CoreSpotlight)
import CoreSpotlight
#endif
#if canImport(MobileCoreServices)
import MobileCoreServices
#endif
import UniformTypeIdentifiers

// MARK: - ConversationStore

/// UserDefaults-based offline cache for conversations.
/// Provides persistence between sessions when the desktop is unreachable.
final class ConversationStore {
    static let shared = ConversationStore()

    private let defaults = UserDefaults.standard
    private let conversationsKey = "wotann.cached.conversations"
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    /// SB-N5 fix: Spotlight domain identifier so `CSSearchableIndex.default()`
    /// can scope index/delete operations to WOTANN's conversation surface
    /// without touching other indexed content (e.g. messages or skills).
    private let spotlightDomain = "com.wotann.conversation"

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
        indexInSpotlight(conversation)
    }

    func removeConversation(id: UUID) {
        let filtered = loadConversations().filter { $0.id != id }
        saveConversations(filtered)
        deindexFromSpotlight(id: id)
    }

    // MARK: - Spotlight (SB-N5 fix)

    /// Index a conversation in CoreSpotlight so users can find it via
    /// the system search bar. Each entry is a CSSearchableItem with the
    /// conversation title + message preview as text content, scoped to
    /// our `spotlightDomain` so it can be wiped on logout/clear without
    /// touching other indexed content.
    ///
    /// Honest no-op (QB#6) if CoreSpotlight is unavailable. Failures are
    /// logged at debug level — Spotlight indexing is not critical-path.
    func indexInSpotlight(_ conversation: Conversation) {
        #if canImport(CoreSpotlight)
        let attrs = CSSearchableItemAttributeSet(contentType: UTType.text)
        attrs.title = conversation.title
        attrs.contentDescription = conversation.preview
        attrs.contentCreationDate = conversation.createdAt
        attrs.contentModificationDate = conversation.updatedAt
        let item = CSSearchableItem(
            uniqueIdentifier: conversation.id.uuidString,
            domainIdentifier: spotlightDomain,
            attributeSet: attrs
        )
        CSSearchableIndex.default().indexSearchableItems([item]) { _ in
            // Indexing is best-effort. Failures don't block save.
        }
        #endif
    }

    func deindexFromSpotlight(id: UUID) {
        #if canImport(CoreSpotlight)
        CSSearchableIndex.default().deleteSearchableItems(
            withIdentifiers: [id.uuidString]
        ) { _ in }
        #endif
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
