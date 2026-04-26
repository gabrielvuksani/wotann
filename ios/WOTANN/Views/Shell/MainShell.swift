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
        // V9 T5 — three nested layers, in z-order from back to front:
        //   1. The 4-tab `TabView` (Home / Chat / Work / You).
        //   2. `HandoffView` banner — top-pinned overlay that listens to
        //      `session.handoff.subscribe`. Only renders when a candidate
        //      is advertised by the desktop.
        //   3. `ApprovalSheetView` overlay — listens to
        //      `approval.queue.subscribe` and slides up a modal whenever
        //      the desktop requests approval for a destructive tool call.
        //
        // The two overlays must live above the TabView so a request can
        // appear regardless of which tab is selected. They're not tabs —
        // they're cross-cutting modals.
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
            // T7.3 — Tab bar background. On iOS 18 we use
            // `.ultraThinMaterial` for fidelity with every other OS-level
            // bar. On iOS 26 the OS upgrades the `.toolbarBackground`
            // material to native Liquid Glass automatically when the
            // matching SDK is present and the `WOTANN_HAS_LIQUID_GLASS`
            // flag is set, so the only iOS-26-specific work happens behind
            // the same xcconfig flag the `wLiquidGlass` modifier uses.
            // `.wLiquidGlass()` is also applied to the bottom safe-area
            // sliver under the tab bar so the floating Ask button sits
            // over a glass surface rather than a hard `.ultraThinMaterial`
            // edge — same Phase C visual on iOS 18, native glass on iOS 26.
            .toolbarBackground(.ultraThinMaterial, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                // 0pt-tall liquid-glass shim under the tab bar. Renders
                // the iOS 26 Liquid Glass surface for the floating Ask
                // halo on iOS 26 + falls back to invisible on iOS 18 so
                // the existing `.toolbarBackground` keeps the look.
                Color.clear
                    .frame(height: 0)
                    .wLiquidGlass(in: Rectangle())
                    .accessibilityHidden(true)
            }
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
            // V9 Wave 2-M (R-08) — ApprovalQueueView route. Push-notification
            // deep links (`approvals.notify` → APNs → tap on phone) set
            // `appState.deepLinkDestination = "approvals"`. We surface the
            // queue as a sheet so the user can land on the durable list
            // regardless of which tab is active. Clearing the destination on
            // dismiss prevents the sheet from re-firing on the next render.
            .sheet(isPresented: approvalsSheetBinding) {
                ApprovalQueueView()
                    .environmentObject(connectionManager)
                    .environmentObject(appState)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }

            // V9 T5.11 (F14) — Handoff banner. Top-pinned, only visible
            // when the desktop advertises a candidate. The HandoffView's
            // own ZStack with a Spacer keeps it at the top of the screen
            // regardless of which tab is active.
            HandoffView(onAccept: handleHandoffAccept)
                .environmentObject(connectionManager)
                .allowsHitTesting(true)
                .accessibilityIdentifier("MainShell.HandoffBanner")

            // V9 T5.5 (F6) — Approval sheet. Always-on listener; it only
            // renders content when a request is in its queue. Sits above
            // every tab so the user gets the modal even mid-Chat / mid-Work.
            ApprovalSheetView()
                .environmentObject(connectionManager)
                .accessibilityIdentifier("MainShell.ApprovalSheet")
        }
    }

    // MARK: - Handoff acceptance

    /// Called when the user taps the Handoff banner. Routes to the tab
    /// that matches the candidate's surface ("chat" → 1, "workshop"/
    /// "exploit" → 2, anything else → leave on current tab). The actual
    /// `session.handoff.adopt` RPC fires inside the `HandoffViewModel`'s
    /// own task that runs alongside this callback.
    private func handleHandoffAccept(_ candidate: HandoffCandidate) {
        switch candidate.surface {
        case "chat":
            appState.activeTab = 1
        case "workshop", "exploit":
            appState.activeTab = 2
        default:
            break
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

    /// Derived binding that opens the `ApprovalQueueView` sheet when
    /// `appState.deepLinkDestination == "approvals"`. Setting the
    /// binding to `false` clears the destination so the sheet does not
    /// re-present on subsequent renders. Setting it to `true` is a
    /// no-op — the sheet is opened by mutating `deepLinkDestination`
    /// from the producer side (push handler / Settings entry).
    private var approvalsSheetBinding: Binding<Bool> {
        Binding(
            get: { appState.deepLinkDestination == "approvals" },
            set: { newValue in
                if !newValue && appState.deepLinkDestination == "approvals" {
                    appState.deepLinkDestination = nil
                }
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
