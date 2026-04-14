import SwiftUI

// MARK: - MainShell

/// The primary 4-tab navigation for WOTANN after pairing.
/// Tabs: Home · Chat · Work · You.
/// A `FloatingAsk` button is pinned above the tab bar and opens the
/// `AskComposer` sheet on tap / voice sheet on long-press.
///
/// Deep-link compatibility: reuses `appState.activeTab` so existing
/// deep-link handlers in `WOTANNApp.swift` route correctly.
///
/// Tab → index map (matches prior MainTabView):
///   0 = Home (replaces Dashboard)
///   1 = Chat
///   2 = Work (reuses AgentListView until Phase D rebuilds it)
///   3 = You (reuses SettingsView for now)
///
/// Index 4 from legacy deep links (Settings) is normalized to 3.
struct MainShell: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    @State private var showAskComposer: Bool = false
    @State private var showVoiceSheet: Bool = false

    var body: some View {
        ZStack(alignment: .bottom) {
            TabView(selection: tabBinding) {
                HomeView()
                    .tabItem {
                        Label("Home", systemImage: "circle.grid.2x2.fill")
                    }
                    .tag(0)

                ConversationListView()
                    .tabItem {
                        Label("Chat", systemImage: "bubble.left.fill")
                    }
                    .tag(1)

                WorkView()
                    .tabItem {
                        Label("Work", systemImage: "hammer.fill")
                    }
                    .tag(2)
                    .badge(appState.activeAgents.count > 0 ? "\(appState.activeAgents.count)" : nil)

                SettingsView()
                    .tabItem {
                        Label("You", systemImage: "person.crop.circle.fill")
                    }
                    .tag(3)
            }
            .tint(WTheme.Colors.primary)
            .toolbarBackground(.ultraThinMaterial, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            // Floating Ask button, pinned 24pt above the tab bar area.
            .overlay(alignment: .bottom) {
                FloatingAsk(
                    showComposer: $showAskComposer,
                    showVoiceSheet: $showVoiceSheet
                )
                .padding(.bottom, 72)
                .allowsHitTesting(true)
            }
            .task {
                await appState.syncFromDesktop(using: connectionManager.rpcClient)
            }
            .sheet(isPresented: $showAskComposer) {
                AskComposer()
                    .environmentObject(appState)
                    .environmentObject(connectionManager)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .fullScreenCover(isPresented: $showVoiceSheet) {
                VoiceInputView(onSend: handleVoiceInput)
                    .environmentObject(appState)
            }
        }
    }

    // MARK: - Tab Binding (normalizes legacy index 4 → 3)

    /// `activeTab` is still an Int shared with deep-link handlers. We
    /// remap any legacy out-of-range values to 3 ("You") so pre-existing
    /// deep links like `wotann://settings` still land on the correct tab.
    private var tabBinding: Binding<Int> {
        Binding(
            get: {
                let v = appState.activeTab
                if v >= 0 && v <= 3 { return v }
                return 3 // legacy 4 (Settings) → new 3 (You)
            },
            set: { newValue in
                appState.activeTab = newValue
            }
        )
    }

    // MARK: - Voice Dispatch

    /// Called when the voice sheet returns a transcript. Appends to the
    /// active conversation or creates a new one, then switches to Chat.
    private func handleVoiceInput(_ transcript: String) {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            showVoiceSheet = false
            return
        }

        if let activeId = appState.activeConversationId,
           appState.conversations.contains(where: { $0.id == activeId }) {
            appState.updateConversation(activeId) { conv in
                conv.messages.append(Message(role: .user, content: trimmed))
                conv.updatedAt = .now
            }
        } else {
            let title = String(trimmed.prefix(48))
            appState.addConversation(
                Conversation(
                    title: title.isEmpty ? "Voice" : title,
                    messages: [Message(role: .user, content: trimmed)],
                    provider: appState.currentProvider,
                    model: appState.currentModel
                )
            )
        }

        appState.activeTab = 1
        showVoiceSheet = false
    }
}
