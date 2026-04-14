import SwiftUI

// MARK: - HomeView

/// The Home tab. A scroll-driven vertical composition of section views.
/// Replaces the legacy `DashboardView` as the Tab 0 root.
///
/// Sections (from top, in order):
///   1. StatusRibbon           — engine latency + cost + provider chiclet
///   2. HeroAsk                — 120pt rounded-pill CTA
///   3. Where you left off     — first item of `appState.conversations`
///   4. LiveAgentsStrip        — only when `activeAgents.count > 0`
///   5. ProactiveCardDeck      — up to 3 swipeable cards (real-data only)
///   6. AmbientCrossDeviceView — paired-device avatars row
///   7. RecentConversationsStrip — 3 rows + "See all"
struct HomeView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    @State private var showAskComposer: Bool = false
    @State private var showVoiceSheet: Bool = false
    @State private var showEngineHealth: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                    StatusRibbon(onTap: { showEngineHealth = true })

                    HeroAsk(
                        onTap: { showAskComposer = true },
                        onLongPress: { showVoiceSheet = true }
                    )

                    whereYouLeftOffSection

                    if !appState.activeAgents.isEmpty {
                        LiveAgentsStrip()
                    }

                    ProactiveCardDeck()

                    AmbientCrossDeviceView()

                    RecentConversationsStrip()
                }
                .padding(.horizontal, WTheme.Spacing.md)
                .padding(.bottom, 120) // leave space for floating Ask button
            }
            .background(WTheme.Colors.background)
            .navigationBarHidden(true)
            .refreshable {
                Haptics.shared.pullToRefresh()
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
                VoiceInputView(onSend: handleVoiceTranscript)
                    .environmentObject(appState)
            }
            .sheet(isPresented: $showEngineHealth) {
                EngineHealthSheet()
                    .environmentObject(connectionManager)
                    .environmentObject(appState)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    // MARK: - Where-you-left-off Section

    @ViewBuilder
    private var whereYouLeftOffSection: some View {
        if let conv = appState.conversations.sorted(by: { $0.updatedAt > $1.updatedAt }).first {
            Button {
                Haptics.shared.buttonTap()
                appState.activeConversationId = conv.id
                appState.activeTab = 1
            } label: {
                WhereYouLeftOffCard(conversation: conv)
            }
            .buttonStyle(.plain)
        }
    }

    // MARK: - Voice Transcript Handler

    private func handleVoiceTranscript(_ transcript: String) {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            showVoiceSheet = false
            return
        }
        appState.addConversation(
            Conversation(
                title: String(trimmed.prefix(48)),
                messages: [Message(role: .user, content: trimmed)],
                provider: appState.currentProvider,
                model: appState.currentModel
            )
        )
        appState.activeTab = 1
        showVoiceSheet = false
    }
}

// MARK: - WhereYouLeftOffCard

/// A 96pt card showing the last-updated conversation as a quick resume hook.
private struct WhereYouLeftOffCard: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                Text("Where you left off")
                    .font(WTheme.Typography.captionStd)
                    .tracking(WTheme.Tracking.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
                Text(conversation.title)
                    .font(WTheme.Typography.roundedHeadline)
                    .tracking(WTheme.Tracking.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)
                if !conversation.preview.isEmpty {
                    Text(conversation.preview)
                        .font(WTheme.Typography.footnoteStd)
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer()
            Image(systemName: "arrow.forward.circle.fill")
                .font(.system(size: 28))
                .foregroundColor(WTheme.Colors.primary)
        }
        .padding(WTheme.Spacing.md)
        .frame(height: 96)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous)
                .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Resume conversation: \(conversation.title)")
        .accessibilityHint("Opens the last conversation in Chat")
    }
}

// MARK: - Engine Health Sheet

/// A minimal engine-health drill-down. Populated entirely from live values
/// on `connectionManager`; no placeholder data.
private struct EngineHealthSheet: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Engine") {
                    row(label: "Status", value: connectionManager.connectionStatus.rawValue)
                    row(label: "Mode", value: connectionManager.connectionMode.rawValue)
                    row(label: "Latency", value: latencyText)
                    row(label: "Encryption", value: connectionManager.connectionSecurity.rawValue)
                }
                Section("Session") {
                    row(label: "Provider", value: appState.currentProvider.capitalized)
                    row(label: "Model", value: appState.currentModel)
                    row(label: "Reconnects", value: "\(connectionManager.reconnectCount)")
                }
                if let device = connectionManager.pairedDevice {
                    Section("Paired Desktop") {
                        row(label: "Name", value: device.name)
                        row(label: "Host", value: "\(device.host):\(device.port)")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("Engine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private var latencyText: String {
        let ms = connectionManager.latencyMs
        if ms <= 0 { return "—" }
        return "\(Int(ms)) ms"
    }

    private func row(label: String, value: String) -> some View {
        HStack {
            Text(label)
                .foregroundColor(WTheme.Colors.textSecondary)
            Spacer()
            Text(value)
                .foregroundColor(WTheme.Colors.textPrimary)
        }
    }
}
