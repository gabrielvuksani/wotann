import Foundation
#if canImport(CarPlay)
import CarPlay

/// CarPlay Voice Interface — hands-free WOTANN in the car.
///
/// Features:
/// - Voice-only agent interaction via CPVoiceControlTemplate
/// - "Hey WOTANN, did my build pass?" → TTS response
/// - Resume voice conversations from phone
/// - Task status announcements via TTS
/// - CPListTemplate for conversation history
/// - Conversation detail with message list and voice reply

@available(iOS 14.0, *)
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {

    private var interfaceController: CPInterfaceController?
    private var voiceService: VoiceService?
    /// Direct reference to RPCClient for executing quick actions without
    /// traversing PhoneWCSessionDelegate -> ConnectionManager chain.
    private var rpcClient: RPCClient?

    /// ID of the conversation currently shown in the detail template.
    /// Used to route incoming message updates to the correct detail view.
    private var activeConversationId: UUID?

    /// Maximum number of messages shown in the CarPlay conversation detail.
    private let maxDetailMessages = 8

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        self.voiceService = VoiceService()

        // Capture the RPCClient directly from PhoneWCSessionDelegate at connect time.
        if let delegate = PhoneWCSessionDelegate.shared {
            self.rpcClient = delegate.connectionManager?.rpcClient
        }

        subscribeToConversationUpdates()

        let rootTemplate = buildRootTemplate()
        interfaceController.setRootTemplate(rootTemplate, animated: true, completion: nil)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        self.interfaceController = nil
        self.activeConversationId = nil
        voiceService?.stopRecording()
    }

    // MARK: - Templates

    private func buildRootTemplate() -> CPTabBarTemplate {
        let chatTab = buildChatListTemplate()
        let voiceTab = buildVoiceTemplate()
        let statusTab = buildStatusTemplate()

        return CPTabBarTemplate(templates: [chatTab, voiceTab, statusTab])
    }

    private func buildChatListTemplate() -> CPListTemplate {
        let conversations = ConversationStore.shared.loadConversations()
            .filter { !$0.isArchived }
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(10)

        let items: [CPListItem]
        if conversations.isEmpty {
            let placeholderItem = CPListItem(
                text: "No Conversations",
                detailText: "Start a chat on your desktop or phone"
            )
            items = [placeholderItem]
        } else {
            items = conversations.map { conversation in
                let preview = conversation.preview.isEmpty ? "No messages yet" : String(conversation.preview.prefix(80))
                let item = CPListItem(text: conversation.title, detailText: preview)
                item.handler = { [weak self] _, completion in
                    self?.openConversation(conversation)
                    completion()
                }
                return item
            }
        }

        let section = CPListSection(items: items, header: "Recent Conversations", sectionIndexTitle: nil)
        let template = CPListTemplate(title: "WOTANN", sections: [section])
        template.tabImage = UIImage(systemName: "message")
        return template
    }

    private func buildVoiceTemplate() -> CPListTemplate {
        let voiceItem = CPListItem(
            text: "Voice Input",
            detailText: "Tap to speak to WOTANN"
        )
        voiceItem.handler = { [weak self] _, completion in
            self?.startVoiceInput()
            completion()
        }

        let quickActions = [
            CPListItem(text: "Check Build Status", detailText: "Did my tests pass?"),
            CPListItem(text: "Summarize Changes", detailText: "What changed today?"),
            CPListItem(text: "Check Cost", detailText: "How much have I spent?"),
        ]

        for action in quickActions {
            action.handler = { [weak self] item, completion in
                self?.executeQuickAction(item.text ?? "")
                completion()
            }
        }

        let sections = [
            CPListSection(items: [voiceItem], header: "Voice", sectionIndexTitle: nil),
            CPListSection(items: quickActions, header: "Quick Actions", sectionIndexTitle: nil),
        ]

        let template = CPListTemplate(title: "Voice", sections: sections)
        template.tabImage = UIImage(systemName: "mic")
        return template
    }

    private func buildStatusTemplate() -> CPListTemplate {
        let defaults = UserDefaults(suiteName: "group.com.wotann.shared")

        // Read live status from shared UserDefaults written by AppState.
        let todayCost = defaults?.double(forKey: "widget.todayCost") ?? 0
        let provider = defaults?.string(forKey: "widget.provider") ?? "unknown"

        // Parse agent data to count active agents.
        var activeAgentCount = 0
        if let agentJSON = defaults?.string(forKey: "agentStatus"),
           let data = agentJSON.data(using: .utf8),
           let agents = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            activeAgentCount = agents.filter { agent in
                let status = agent["status"] as? String ?? ""
                return status == "running" || status == "waiting_approval"
            }.count
        }

        // Determine engine status from cached WCSession delegate state.
        let isConnected = PhoneWCSessionDelegate.shared?.connectionManager?.isConnected ?? false
        let engineStatus = isConnected ? "Connected" : "Disconnected"

        let items = [
            CPListItem(text: "Engine Status", detailText: engineStatus),
            CPListItem(text: "Active Agents", detailText: "\(activeAgentCount)"),
            CPListItem(text: "Today's Cost", detailText: String(format: "$%.2f", todayCost)),
            CPListItem(text: "Provider", detailText: provider.capitalized),
        ]

        let template = CPListTemplate(
            title: "Status",
            sections: [CPListSection(items: items)]
        )
        template.tabImage = UIImage(systemName: "chart.bar")
        return template
    }

    // MARK: - Actions

    private func openConversation(_ conversation: Conversation) {
        activeConversationId = conversation.id
        let detail = buildConversationDetailTemplate(for: conversation)
        interfaceController?.pushTemplate(detail, animated: true, completion: nil)
    }

    // MARK: - Conversation Detail

    /// Build a CPListTemplate showing the last few messages and a voice reply button.
    private func buildConversationDetailTemplate(for conversation: Conversation) -> CPListTemplate {
        let recentMessages = conversation.messages.suffix(maxDetailMessages)

        var messageItems: [CPListItem] = recentMessages.map { message in
            let roleLabel = message.role == .user ? "You" : "WOTANN"
            let truncated = String(message.content.prefix(100))
            return CPListItem(text: roleLabel, detailText: truncated)
        }

        if messageItems.isEmpty {
            messageItems = [CPListItem(text: "No Messages", detailText: "Start a conversation with voice")]
        }

        // Voice Reply button at the top of its own section.
        let voiceReplyItem = CPListItem(
            text: "Voice Reply",
            detailText: "Tap to speak your message"
        )
        voiceReplyItem.handler = { [weak self] _, completion in
            self?.startVoiceReply(conversationId: conversation.id)
            completion()
        }

        let voiceSection = CPListSection(
            items: [voiceReplyItem],
            header: "Actions",
            sectionIndexTitle: nil
        )
        let messagesSection = CPListSection(
            items: messageItems,
            header: "Recent Messages",
            sectionIndexTitle: nil
        )

        let template = CPListTemplate(
            title: conversation.title,
            sections: [voiceSection, messagesSection]
        )
        return template
    }

    // MARK: - Conversation Update Subscription

    /// Subscribe to RPC events for conversation changes.
    /// When the desktop pushes a "conversation.updated" event, refresh the
    /// detail template if the updated conversation matches the active one.
    private func subscribeToConversationUpdates() {
        rpcClient?.subscribe("conversation.updated") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleConversationUpdate(event)
            }
        }
    }

    private func handleConversationUpdate(_ event: RPCEvent) {
        guard let activeId = activeConversationId else { return }

        // Parse the conversation ID from the event to see if it matches.
        var updatedId: UUID?
        if case .object(let obj) = event.params,
           let idString = obj["conversationId"]?.stringValue {
            updatedId = UUID(uuidString: idString)
        }

        // If the event targets a different conversation, ignore it.
        if let updatedId, updatedId != activeId { return }

        // Reload the conversation from the store and refresh the detail template.
        guard let refreshed = ConversationStore.shared.loadConversation(id: activeId) else { return }
        refreshConversationDetail(with: refreshed)
    }

    /// Replace the sections in the currently-pushed detail template with fresh data.
    private func refreshConversationDetail(with conversation: Conversation) {
        guard let topTemplate = interfaceController?.topTemplate as? CPListTemplate else { return }

        let recentMessages = conversation.messages.suffix(maxDetailMessages)

        var messageItems: [CPListItem] = recentMessages.map { message in
            let roleLabel = message.role == .user ? "You" : "WOTANN"
            let truncated = String(message.content.prefix(100))
            return CPListItem(text: roleLabel, detailText: truncated)
        }

        if messageItems.isEmpty {
            messageItems = [CPListItem(text: "No Messages", detailText: "Start a conversation with voice")]
        }

        let voiceReplyItem = CPListItem(
            text: "Voice Reply",
            detailText: "Tap to speak your message"
        )
        voiceReplyItem.handler = { [weak self] _, completion in
            self?.startVoiceReply(conversationId: conversation.id)
            completion()
        }

        let voiceSection = CPListSection(
            items: [voiceReplyItem],
            header: "Actions",
            sectionIndexTitle: nil
        )
        let messagesSection = CPListSection(
            items: messageItems,
            header: "Recent Messages",
            sectionIndexTitle: nil
        )

        topTemplate.updateSections([voiceSection, messagesSection])
    }

    // MARK: - Voice Reply

    /// Start recording voice input for a specific conversation.
    /// When recording finishes, sends the transcription to the desktop via RPC.
    private func startVoiceReply(conversationId: UUID) {
        guard let voiceService else { return }
        Task { @MainActor in
            do {
                try await voiceService.startRecording()
                // Wait briefly for the user to speak (VoiceService will set
                // isRecording = false when speech is finalized or times out).
                while voiceService.isRecording {
                    try await Task.sleep(nanoseconds: 250_000_000) // 250ms poll
                }
                let transcription = voiceService.transcription
                guard !transcription.isEmpty else { return }
                // Send the transcribed text to the desktop via RPC.
                _ = try? await rpcClient?.sendMessage(
                    conversationId: conversationId,
                    prompt: transcription
                )
            } catch {
                // Voice input failed -- non-fatal in CarPlay context.
            }
        }
    }

    private func startVoiceInput() {
        guard let voiceService else { return }
        Task { @MainActor in
            do {
                try await voiceService.startRecording()
                // Voice transcription flows through VoiceService.
                // When recording stops, the transcription is available
                // via voiceService.transcription and can be sent to
                // the desktop via RPCClient.sendMessage().
            } catch {
                // Voice input failed -- non-fatal in CarPlay context.
            }
        }
    }

    private func executeQuickAction(_ action: String) {
        // Send quick action via RPC to the desktop agent.
        // The response will be spoken back via TTS through VoiceService.
        Task { @MainActor in
            guard let rpc = self.rpcClient else { return }
            _ = try? await rpc.send("quickAction", params: ["action": .string(action)])
        }
    }
}

#else
// CarPlay not available on this platform
final class CarPlaySceneDelegate {
    // Placeholder for non-CarPlay builds
}
#endif
