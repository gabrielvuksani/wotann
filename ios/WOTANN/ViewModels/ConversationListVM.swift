import Foundation
import Combine

// MARK: - ConversationListVM

/// Manages conversation list filtering, searching, and actions.
@MainActor
final class ConversationListVM: ObservableObject {
    @Published var searchText = ""
    @Published var filterMode: FilterMode = .all
    @Published var sortOrder: SortOrder = .updated

    private let appState: AppState

    init(appState: AppState) {
        self.appState = appState
    }

    enum FilterMode: String, CaseIterable {
        case all      = "All"
        case starred  = "Starred"
        case incognito = "Incognito"
    }

    enum SortOrder: String, CaseIterable {
        case updated  = "Recent"
        case created  = "Created"
        case cost     = "Cost"
        case messages = "Messages"
    }

    var filteredConversations: [Conversation] {
        var result = appState.conversations.filter { !$0.isArchived }

        // Apply filter
        switch filterMode {
        case .all:       break
        case .starred:   result = result.filter(\.isStarred)
        case .incognito: result = result.filter(\.isIncognito)
        }

        // Apply search
        if !searchText.isEmpty {
            result = result.filter {
                $0.title.localizedCaseInsensitiveContains(searchText) ||
                $0.preview.localizedCaseInsensitiveContains(searchText) ||
                $0.provider.localizedCaseInsensitiveContains(searchText)
            }
        }

        // Apply sort
        switch sortOrder {
        case .updated:  result.sort { $0.updatedAt > $1.updatedAt }
        case .created:  result.sort { $0.createdAt > $1.createdAt }
        case .cost:     result.sort { $0.cost > $1.cost }
        case .messages: result.sort { $0.messageCount > $1.messageCount }
        }

        return result
    }

    var isEmpty: Bool {
        appState.conversations.filter { !$0.isArchived }.isEmpty
    }

    // MARK: - Actions

    func createConversation() -> Conversation {
        let conv = Conversation(
            title: "New Chat",
            provider: appState.currentProvider,
            model: appState.currentModel
        )
        appState.addConversation(conv)
        return conv
    }

    func toggleStar(_ id: UUID) {
        appState.updateConversation(id) { $0.isStarred.toggle() }
        HapticService.shared.trigger(.selection)
    }

    func archive(_ id: UUID) {
        appState.updateConversation(id) { $0.isArchived = true }
        HapticService.shared.trigger(.swipe)
    }

    func delete(_ id: UUID) {
        appState.removeConversation(id)
        HapticService.shared.trigger(.swipe)
    }
}
