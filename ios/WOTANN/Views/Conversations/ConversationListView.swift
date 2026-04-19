import SwiftUI

// MARK: - ConversationListView

/// List of conversations synced from the desktop.
struct ConversationListView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    // S4-25: shared singleton so the ChatViewModel built for a chat
    // destination hangs off the same on-device model instance as the rest of
    // the app.
    @EnvironmentObject var onDeviceModelService: OnDeviceModelService
    @AppStorage("lastBriefingDate") private var lastBriefingDate = ""
    @State private var searchText = ""
    @State private var filterMode: ConversationListVM.FilterMode = .all
    @State private var navigateToChat: NavigationTarget?

    var filteredConversations: [Conversation] {
        var result = appState.conversations.filter { !$0.isArchived }

        switch filterMode {
        case .all:       break
        case .starred:   result = result.filter(\.isStarred)
        case .incognito: result = result.filter(\.isIncognito)
        }

        if !searchText.isEmpty {
            result = result.filter {
                $0.title.localizedCaseInsensitiveContains(searchText) ||
                $0.preview.localizedCaseInsensitiveContains(searchText)
            }
        }

        return result.sorted { $0.updatedAt > $1.updatedAt }
    }

    private var shouldShowBriefing: Bool {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        return lastBriefingDate != today && connectionManager.isConnected
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if shouldShowBriefing {
                    MorningBriefingView()
                }

                Group {
                    if appState.conversations.filter({ !$0.isArchived }).isEmpty {
                        EmptyState(
                            icon: "bubble.left.and.bubble.right",
                            title: "No conversations yet",
                            subtitle: "Start a chat on your desktop or tap + to begin from your phone.",
                            action: { createNewChat() },
                            actionTitle: "New Chat"
                        )
                    } else {
                        conversationList
                    }
                }
                .frame(maxHeight: .infinity)
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Chat")
            .searchable(text: $searchText, prompt: "Search conversations...")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { createNewChat() } label: {
                        Image(systemName: "plus.bubble.fill")
                            .foregroundColor(WTheme.Colors.primary)
                    }
                }
                ToolbarItem(placement: .topBarLeading) {
                    filterMenu
                }
            }
            .navigationDestination(item: $navigateToChat) { target in
                ChatViewContent(
                    viewModel: ChatViewModel(
                        conversationId: target.id,
                        appState: appState,
                        connectionManager: connectionManager,
                        onDeviceModelService: onDeviceModelService
                    )
                )
            }
        }
    }

    // MARK: - Filter Menu (extracted for type-checker)

    private var filterMenu: some View {
        Menu {
            ForEach(ConversationListVM.FilterMode.allCases, id: \.self) { mode in
                Button {
                    filterMode = mode
                } label: {
                    Label(
                        mode.rawValue,
                        systemImage: filterMode == mode ? "checkmark" : ""
                    )
                }
            }
        } label: {
            let color: Color = filterMode != .all ? WTheme.Colors.primary : WTheme.Colors.textSecondary
            Image(systemName: "line.3.horizontal.decrease.circle")
                .foregroundColor(color)
        }
    }

    // MARK: - Conversation List

    private var conversationList: some View {
        List {
            ForEach(filteredConversations) { conversation in
                Button {
                    navigateToChat = NavigationTarget(id: conversation.id)
                } label: {
                    ConversationRow(conversation: conversation)
                }
                .listRowBackground(WTheme.Colors.background)
                .listRowSeparatorTint(WTheme.Colors.border)
                .swipeActions(edge: .leading) {
                    Button {
                        appState.updateConversation(conversation.id) { $0.isStarred.toggle() }
                        HapticService.shared.trigger(.selection)
                    } label: {
                        Label("Star", systemImage: conversation.isStarred ? "star.slash" : "star.fill")
                    }
                    .tint(WTheme.Colors.warning)
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        appState.updateConversation(conversation.id) { $0.isArchived = true }
                        HapticService.shared.trigger(.swipe)
                    } label: {
                        Label("Archive", systemImage: "archivebox.fill")
                    }
                }
            }
        }
        .listStyle(.plain)
    }

    private func createNewChat() {
        let conv = Conversation(
            title: "New Chat",
            provider: appState.currentProvider,
            model: appState.currentModel
        )
        appState.addConversation(conv)
        navigateToChat = NavigationTarget(id: conv.id)
        HapticService.shared.trigger(.buttonTap)
    }
}

// MARK: - NavigationTarget

/// Wrapper to avoid retroactive Identifiable conformance on UUID.
struct NavigationTarget: Identifiable, Hashable {
    let id: UUID
}
