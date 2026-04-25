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

    // MARK: - Voice Conversation State (T5.10)
    //
    // The daemon exposes a `carplay.voice.subscribe` RPC stream so the
    // car-side surface can mirror the active voice conversation's state
    // (current transcript, agent response, "speaking" indicator) without
    // round-tripping through the iPhone UI. We capture the latest payload
    // so the voice tab list-template can re-render with fresh status when
    // a daemon update arrives.

    /// Last reported active voice conversation id (per daemon push).
    /// `nil` means no voice session is in progress.
    private var activeVoiceConversationId: String?
    /// Last reported transcript for the active voice session.
    private var activeVoiceTranscript: String = ""
    /// Last reported agent reply for the active voice session.
    private var activeVoiceReply: String = ""
    /// Whether the daemon thinks the agent is currently "speaking" (TTS in
    /// flight). Drives the `Voice` tab list item title.
    private var activeVoiceSpeaking: Bool = false
    /// Last error encountered while wiring the voice subscription. Held so
    /// a status-screen can render it without leaking into the foreground UI.
    /// (Honest stubs — quality bar #6.)
    private var voiceSubscribeError: String?
    /// True once we have wired the carplay.voice.subscribe RPC against
    /// `rpcClient`. Idempotent so reconnects do not double-subscribe
    /// (quality bar #11 — single sibling site for `carplay.voice.*`).
    private var voiceSubscribed = false

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
        subscribeToCarPlayVoice()

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

    // MARK: - Voice Subscription (T5.10)

    /// Wire `carplay.voice.subscribe` so the daemon can push live voice-
    /// conversation state (transcript, agent reply, speaking flag) into
    /// the CarPlay templates without round-tripping through the iPhone
    /// UI. Idempotent so a re-connect (driver leaves/returns the car)
    /// does not double-subscribe.
    ///
    /// QUALITY BARS:
    /// - #6 (honest stubs): seed-RPC errors surface via `voiceSubscribeError`.
    /// - #7 (per-session state): subscription state lives on the scene
    ///   delegate instance, not on a module-global.
    /// - #11 (sibling-site scan): this is the SINGLE site on iOS
    ///   subscribing to `carplay.voice.*`.
    private func subscribeToCarPlayVoice() {
        guard !voiceSubscribed, let client = rpcClient else { return }
        voiceSubscribed = true

        Task { [weak self, weak client] in
            guard let client else { return }
            do {
                _ = try await client.send("carplay.voice.subscribe")
                await MainActor.run { self?.voiceSubscribeError = nil }
            } catch {
                await MainActor.run {
                    self?.voiceSubscribeError =
                        "carplay.voice.subscribe failed: \(error.localizedDescription)"
                }
            }
        }

        client.subscribe("carplay.voice") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleVoiceEvent(event)
            }
        }
    }

    /// Translate a daemon `carplay.voice` push payload into local state +
    /// (when relevant) a refreshed Voice tab template.
    ///
    /// Schema (best-effort decode):
    ///
    ///   { conversationId: String?,
    ///     transcript:     String?,
    ///     reply:          String?,
    ///     speaking:       Bool?,
    ///     done:           Bool? }
    ///
    /// `done == true` clears the active state; otherwise we patch the
    /// fields the daemon sent and re-render the Voice tab so the driver
    /// sees the latest transcription / agent reply.
    private func handleVoiceEvent(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }

        let done = obj["done"]?.boolValue ?? false
        if done {
            activeVoiceConversationId = nil
            activeVoiceTranscript = ""
            activeVoiceReply = ""
            activeVoiceSpeaking = false
        } else {
            if let id = obj["conversationId"]?.stringValue {
                activeVoiceConversationId = id
            }
            if let transcript = obj["transcript"]?.stringValue {
                activeVoiceTranscript = transcript
            }
            if let reply = obj["reply"]?.stringValue {
                activeVoiceReply = reply
            }
            if let speaking = obj["speaking"]?.boolValue {
                activeVoiceSpeaking = speaking
            }
        }

        refreshVoiceTabIfActive()
    }

    /// Replace the Voice tab's sections with a fresh snapshot of the
    /// active voice conversation state. Only fires when the Voice tab is
    /// currently the active tab — otherwise we wait until the next render.
    private func refreshVoiceTabIfActive() {
        guard let tabBar = interfaceController?.rootTemplate as? CPTabBarTemplate else { return }
        guard let voiceTemplate = tabBar.selectedTemplate as? CPListTemplate else { return }
        // Heuristic: only refresh the Voice tab. The Voice list-template
        // we built has its `tabImage` set to `mic`. The other tabs use
        // `message` and `chart.bar`, so checking the tab image is a
        // cheaper-than-tagging discriminator.
        guard voiceTemplate.tabImage == UIImage(systemName: "mic") else { return }

        let voiceItem = CPListItem(
            text: activeVoiceSpeaking ? "Speaking..." : "Voice Input",
            detailText: activeVoiceTranscript.isEmpty
                ? "Tap to speak to WOTANN"
                : String(activeVoiceTranscript.prefix(120))
        )
        voiceItem.handler = { [weak self] _, completion in
            self?.startVoiceInput()
            completion()
        }

        let replyItems: [CPListItem]
        if !activeVoiceReply.isEmpty {
            replyItems = [
                CPListItem(
                    text: "WOTANN",
                    detailText: String(activeVoiceReply.prefix(140))
                ),
            ]
        } else {
            replyItems = []
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

        var sections: [CPListSection] = [
            CPListSection(items: [voiceItem], header: "Voice", sectionIndexTitle: nil),
        ]
        if !replyItems.isEmpty {
            sections.append(
                CPListSection(items: replyItems, header: "Reply", sectionIndexTitle: nil)
            )
        }
        sections.append(
            CPListSection(items: quickActions, header: "Quick Actions", sectionIndexTitle: nil)
        )

        voiceTemplate.updateSections(sections)
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
