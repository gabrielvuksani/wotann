import Foundation
import Combine

// MARK: - ChatViewModel

/// Manages the active chat conversation, streaming, and message dispatch.
@MainActor
final class ChatViewModel: ObservableObject {
    @Published var inputText = ""
    @Published var isStreaming = false
    @Published var streamingText = ""
    @Published var errorMessage: String?
    @Published var isEnhancing = false
    @Published var showEnhanceSheet = false
    @Published var enhancedText = ""
    @Published var enhanceImprovements: [String] = []

    let conversationId: UUID

    private let appState: AppState
    private let connectionManager: ConnectionManager
    private let streamHandler = StreamHandler()
    private let offlineQueue = OfflineQueueService()
    private var cancellables = Set<AnyCancellable>()

    init(conversationId: UUID, appState: AppState, connectionManager: ConnectionManager) {
        self.conversationId = conversationId
        self.appState = appState
        self.connectionManager = connectionManager

        // Subscribe to streaming events, filtering by conversation ID
        connectionManager.rpcClient.subscribe("stream.text") { [weak self] event in
            Task { @MainActor [weak self] in
                guard let self, self.matchesConversation(event) else { return }
                self.streamHandler.handleEvent(event)
            }
        }
        connectionManager.rpcClient.subscribe("stream.done") { [weak self] event in
            Task { @MainActor [weak self] in
                guard let self, self.matchesConversation(event) else { return }
                self.streamHandler.handleEvent(event)
            }
        }
        connectionManager.rpcClient.subscribe("stream.error") { [weak self] event in
            Task { @MainActor [weak self] in
                guard let self, self.matchesConversation(event) else { return }
                self.streamHandler.handleEvent(event)
            }
        }

        // When connection is restored, flush the offline queue
        connectionManager.$isConnected
            .dropFirst()
            .filter { $0 }
            .sink { [weak self] _ in
                guard let self else { return }
                Task { @MainActor in
                    await self.flushOfflineQueue()
                }
            }
            .store(in: &cancellables)
    }

    /// Check if a stream event belongs to this conversation.
    private func matchesConversation(_ event: RPCEvent) -> Bool {
        guard case .object(let obj) = event.params,
              let eventConvId = obj["conversationId"]?.stringValue else {
            // If no conversationId in the event, accept it (backward compat)
            return true
        }
        return eventConvId == conversationId.uuidString
    }

    var conversation: Conversation? {
        appState.conversations.first { $0.id == conversationId }
    }

    var messages: [Message] {
        conversation?.messages ?? []
    }

    // MARK: - Send Message

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }

        HapticService.shared.trigger(.messageSent)

        // Add user message
        let userMessage = Message(role: .user, content: text)
        appState.updateConversation(conversationId) { conv in
            conv.messages.append(userMessage)
            conv.updatedAt = .now
        }

        inputText = ""

        // If disconnected, try on-device inference or queue for later
        guard connectionManager.isConnected else {
            let enableOnDevice = UserDefaults.standard.bool(forKey: "enableOnDeviceInference")
            if enableOnDevice {
                // Try on-device inference
                let onDeviceService = OnDeviceModelService()
                isStreaming = true
                let offlineAssistantId = UUID()
                let offlinePlaceholder = Message(
                    id: offlineAssistantId,
                    role: .assistant,
                    content: "",
                    provider: "on-device",
                    model: "gemma-4",
                    isStreaming: true
                )
                appState.updateConversation(conversationId) { conv in
                    conv.messages.append(offlinePlaceholder)
                }
                Task {
                    let result = await onDeviceService.generate(
                        prompt: text,
                        enableOnDeviceInference: true
                    )
                    appState.updateConversation(conversationId) { conv in
                        if let idx = conv.messages.firstIndex(where: { $0.id == offlineAssistantId }) {
                            conv.messages[idx] = Message(
                                id: offlineAssistantId,
                                role: .assistant,
                                content: result,
                                provider: "on-device",
                                model: "gemma-4",
                                isStreaming: false
                            )
                        }
                    }
                    isStreaming = false
                    HapticService.shared.trigger(.responseComplete)
                }
            } else {
                offlineQueue.enqueue(prompt: text, provider: appState.currentProvider)
                connectionManager.markQueued()
                let queuedMessage = Message(
                    role: .assistant,
                    content: "Queued for sending when connection is restored.",
                    isStreaming: false
                )
                appState.updateConversation(conversationId) { conv in
                    conv.messages.append(queuedMessage)
                }
            }
            return
        }

        isStreaming = true
        streamingText = ""
        errorMessage = nil

        // Add placeholder assistant message
        let assistantId = UUID()
        let placeholder = Message(
            id: assistantId,
            role: .assistant,
            content: "",
            provider: appState.currentProvider,
            model: appState.currentModel,
            isStreaming: true
        )
        appState.updateConversation(conversationId) { conv in
            conv.messages.append(placeholder)
        }

        // Send via RPC
        Task {
            do {
                streamHandler.startStream(
                    onText: { [weak self] chunk in
                        guard let self else { return }
                        self.streamingText += chunk
                        self.appState.updateConversation(self.conversationId) { conv in
                            if let idx = conv.messages.firstIndex(where: { $0.id == assistantId }) {
                                conv.messages[idx].content = self.streamingText
                            }
                        }
                    },
                    onComplete: { [weak self] tokens, cost in
                        guard let self else { return }
                        self.appState.updateConversation(self.conversationId) { conv in
                            if let idx = conv.messages.firstIndex(where: { $0.id == assistantId }) {
                                conv.messages[idx].isStreaming = false
                                conv.messages[idx].tokensUsed = tokens
                                conv.messages[idx].cost = cost
                                conv.messages[idx].artifacts = self.streamHandler.artifacts
                            }
                            conv.cost += cost
                            conv.updatedAt = .now
                        }
                        self.isStreaming = false
                        HapticService.shared.trigger(.responseComplete)
                    },
                    onError: { [weak self] error in
                        self?.errorMessage = error
                        self?.isStreaming = false
                        HapticService.shared.trigger(.error)
                    }
                )

                _ = try await connectionManager.rpcClient.sendMessage(
                    conversationId: conversationId,
                    prompt: text
                )
            } catch {
                // If send fails, update the placeholder with error
                appState.updateConversation(conversationId) { conv in
                    if let idx = conv.messages.firstIndex(where: { $0.id == assistantId }) {
                        conv.messages[idx].content = "Failed to send: \(error.localizedDescription)"
                        conv.messages[idx].isStreaming = false
                    }
                }
                isStreaming = false
                errorMessage = error.localizedDescription
                HapticService.shared.trigger(.error)
            }
        }
    }

    // MARK: - Enhance

    func enhancePrompt() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        isEnhancing = true
        HapticService.shared.trigger(.buttonTap)

        Task {
            do {
                let response = try await connectionManager.rpcClient.send("enhance", params: [
                    "prompt": .string(text),
                    "style": .string("detailed"),
                ])

                // Try to parse structured response with improvements
                if let obj = response.result?.objectValue {
                    enhancedText = obj["enhanced"]?.stringValue ?? obj["text"]?.stringValue ?? text
                    if let improvementsArray = obj["improvements"]?.arrayValue {
                        enhanceImprovements = improvementsArray.compactMap { $0.stringValue }
                    } else {
                        enhanceImprovements = ["Improved clarity", "Added specificity", "Better structure"]
                    }
                } else {
                    // Fallback: result is a plain string
                    enhancedText = response.result?.stringValue ?? text
                    enhanceImprovements = ["Improved clarity", "Added specificity", "Better structure"]
                }
                showEnhanceSheet = true
            } catch {
                errorMessage = "Enhancement failed"
            }
            isEnhancing = false
        }
    }

    func acceptEnhancement() {
        inputText = enhancedText
        showEnhanceSheet = false
        HapticService.shared.trigger(.enhanceComplete)
    }

    // MARK: - Clear Chat

    func clearChat() {
        appState.updateConversation(conversationId) { conv in
            conv.messages = []
            conv.updatedAt = .now
        }
    }

    // MARK: - Star Toggle

    func toggleStar() {
        appState.updateConversation(conversationId) { $0.isStarred.toggle() }
    }

    // MARK: - Regenerate

    func regenerateMessage(id: UUID) {
        guard let conv = conversation,
              let msgIndex = conv.messages.firstIndex(where: { $0.id == id }),
              conv.messages[msgIndex].role == .assistant else { return }

        // Find the preceding user message to re-send
        let preceding = conv.messages[..<msgIndex].reversed()
        guard let userMessage = preceding.first(where: { $0.role == .user }) else { return }

        // Remove the old assistant message
        appState.updateConversation(conversationId) { conv in
            conv.messages.removeAll { $0.id == id }
        }

        // Re-send the user's prompt
        inputText = userMessage.content
        sendMessage()
    }

    // MARK: - Delete Message

    func deleteMessage(id: UUID) {
        appState.updateConversation(conversationId) { conv in
            conv.messages.removeAll { $0.id == id }
            conv.updatedAt = .now
        }
    }

    // MARK: - Cancel

    func cancelStreaming() {
        streamHandler.cancelStream()
        isStreaming = false
    }

    // MARK: - Offline Queue

    /// Flush any queued messages through the RPC client now that we are connected.
    private func flushOfflineQueue() async {
        await offlineQueue.executeAll { [weak self] prompt in
            guard let self else { return }
            _ = try await self.connectionManager.rpcClient.sendMessage(
                conversationId: self.conversationId,
                prompt: prompt
            )
        }
    }
}
