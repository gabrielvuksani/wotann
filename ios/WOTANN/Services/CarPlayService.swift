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

    // MARK: - Continuous Voice Stream State (V9 Wave 6-PP)
    //
    // The audit flagged the original `startVoiceInput` /
    // `startVoiceReply` as single-shot: each tap captured one utterance
    // and stopped. In a car the driver wants a back-and-forth
    // conversation without re-tapping the screen. We layer a
    // per-instance continuous loop on top of the existing
    // `VoiceService` (kept single-shot for the iPhone Voice tab) so
    // each finalized utterance is forwarded to the daemon and the
    // mic re-arms automatically until the driver explicitly stops.
    //
    // QUALITY BARS:
    // - #6 (honest stubs): the loop bails out cleanly if the
    //   recognizer reports `noTranscription`; it never silently keeps
    //   spinning while the engine is dead.
    // - #7 (per-session state): `continuousVoiceTask`,
    //   `continuousVoiceActive`, and `continuousVoiceConversationId`
    //   live on the scene-delegate instance — not on a module-global —
    //   so a second CarPlay scene attaching at runtime gets its own
    //   loop without stepping on this one.
    // - #11 (sibling-site scan): the only call sites that drive the
    //   continuous loop are `startVoiceInput` and `startVoiceReply`
    //   below. `executeQuickAction` deliberately stays single-shot
    //   because it sends a canned prompt with no follow-up turn.

    /// Whether the continuous voice loop is currently running. Set to
    /// `true` when a continuous turn starts; cleared by `stopContinuousVoice`.
    private var continuousVoiceActive = false
    /// Background task driving the continuous loop. Cancelling this
    /// task tears the loop down at the next await point.
    private var continuousVoiceTask: Task<Void, Never>?
    /// Conversation the continuous loop is feeding. `nil` means the
    /// generic `quickAction` channel (no specific conversation).
    private var continuousVoiceConversationId: UUID?
    /// Maximum consecutive empty utterances before the loop self-stops.
    /// Prevents the mic from staying hot if the driver leaves the car.
    private let continuousVoiceMaxEmptyTurns = 3

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
        // Tear down the continuous loop FIRST so the cancellation
        // races the audio-engine teardown rather than the other way
        // around (a half-cancelled task could otherwise re-arm the
        // mic after we just deactivated the audio session).
        stopContinuousVoice()
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

    /// Start a continuous voice conversation pinned to the given
    /// conversation id. Each finalized utterance is forwarded to the
    /// daemon via `chat.send`; the mic re-arms automatically until
    /// the driver taps the Voice tab again (which calls
    /// `stopContinuousVoice`) or the scene disconnects.
    private func startVoiceReply(conversationId: UUID) {
        startContinuousVoice(conversationId: conversationId)
    }

    /// Start a continuous voice session not pinned to any specific
    /// conversation. Each utterance is dispatched through the generic
    /// `quickAction` RPC so the daemon can route it to the active or
    /// most-recent context. Same continuous semantics as
    /// `startVoiceReply` — the loop keeps running until explicitly
    /// stopped.
    private func startVoiceInput() {
        startContinuousVoice(conversationId: nil)
    }

    // MARK: - Continuous Voice Loop (V9 Wave 6-PP)

    /// Drive a back-and-forth voice conversation in CarPlay without
    /// requiring the driver to re-tap the screen for each turn.
    ///
    /// Behaviour:
    /// 1. If a continuous loop is already active, treat the call as
    ///    a "stop" (toggle semantics — the same UI affordance starts
    ///    and stops the conversation, matching CPListItem ergonomics).
    /// 2. Otherwise spin up a Task that loops: arm the mic via the
    ///    existing `VoiceService` (single-shot per turn), wait for
    ///    the recognizer to finalize, ship the transcript, then
    ///    immediately re-arm for the next turn.
    /// 3. While the daemon reports `activeVoiceSpeaking == true` (TTS
    ///    in flight) the loop holds the mic OFF so the agent's voice
    ///    does not echo back into STT. Re-arms once `speaking` flips
    ///    to false.
    /// 4. After `continuousVoiceMaxEmptyTurns` consecutive empty
    ///    transcriptions, the loop auto-stops to keep the mic from
    ///    staying hot if the driver walked away.
    private func startContinuousVoice(conversationId: UUID?) {
        if continuousVoiceActive {
            stopContinuousVoice()
            return
        }
        guard voiceService != nil else { return }

        continuousVoiceActive = true
        continuousVoiceConversationId = conversationId

        continuousVoiceTask = Task { @MainActor [weak self] in
            await self?.runContinuousVoiceLoop()
            // Always clear the active flag on exit so a tap can start
            // a fresh loop. Done in a single place so a thrown
            // CancellationError takes the same exit path as a clean
            // self-stop.
            self?.continuousVoiceActive = false
            self?.continuousVoiceTask = nil
        }
    }

    /// Tear down the continuous loop. Idempotent so disconnect +
    /// user-toggle can both call it without coordinating.
    private func stopContinuousVoice() {
        guard continuousVoiceActive || continuousVoiceTask != nil else { return }
        continuousVoiceActive = false
        continuousVoiceTask?.cancel()
        continuousVoiceTask = nil
        continuousVoiceConversationId = nil
        voiceService?.stopRecording()
    }

    /// Body of the continuous loop. Runs on the main actor because
    /// `VoiceService` is `@MainActor` and the published flags
    /// (`isRecording`, `transcription`) need ordered reads.
    @MainActor
    private func runContinuousVoiceLoop() async {
        guard let voiceService else { return }
        var emptyTurns = 0

        while continuousVoiceActive && !Task.isCancelled {
            // 1. Pause while the agent is speaking — re-checked every
            // 200ms. Using a small poll keeps the loop reactive
            // without subscribing to yet another publisher.
            while activeVoiceSpeaking && continuousVoiceActive && !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 200_000_000)
                } catch {
                    return
                }
            }
            if !continuousVoiceActive || Task.isCancelled { return }

            // 2. Arm the mic for one turn.
            do {
                try await voiceService.startRecording()
            } catch {
                // Permission/audio-engine failure — surface via the
                // same error channel the iPhone Voice tab uses, then
                // bail out (we cannot recover by retrying).
                voiceSubscribeError =
                    "carplay.voice continuous start failed: \(error.localizedDescription)"
                return
            }

            // 3. Wait for the recognizer to finalize. `VoiceService`
            // flips `isRecording` to false when the result is final
            // OR when the speech framework times out the utterance.
            while voiceService.isRecording && continuousVoiceActive && !Task.isCancelled {
                do {
                    try await Task.sleep(nanoseconds: 250_000_000)
                } catch {
                    voiceService.stopRecording()
                    return
                }
            }
            if !continuousVoiceActive || Task.isCancelled {
                voiceService.stopRecording()
                return
            }

            // 4. Capture and dispatch the transcript.
            let transcript = voiceService.transcription
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if transcript.isEmpty {
                emptyTurns += 1
                if emptyTurns >= continuousVoiceMaxEmptyTurns { return }
                continue
            }
            emptyTurns = 0

            await dispatchContinuousVoiceTurn(transcript: transcript)
        }
    }

    /// Forward a single transcribed utterance to the daemon.
    /// Routes through `chat.send` when a conversation id is pinned,
    /// otherwise falls back to the generic `quickAction` channel.
    @MainActor
    private func dispatchContinuousVoiceTurn(transcript: String) async {
        guard let rpc = rpcClient else { return }
        if let conversationId = continuousVoiceConversationId {
            _ = try? await rpc.sendMessage(
                conversationId: conversationId,
                prompt: transcript
            )
        } else {
            _ = try? await rpc.send(
                "quickAction",
                params: ["action": .string(transcript)]
            )
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
