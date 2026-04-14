import Foundation
import Combine

// MARK: - DispatchViewModel

/// Manages task dispatch from phone to desktop.
@MainActor
final class DispatchViewModel: ObservableObject {
    @Published var promptText = ""
    @Published var selectedTemplate: DispatchTemplate?
    @Published var selectedProvider: String = "anthropic"
    @Published var selectedModel: String = "claude-opus-4-6"
    @Published var isDispatching = false
    @Published var lastDispatched: AgentTask?
    @Published var errorMessage: String?
    @Published var showConfirmation = false

    private let appState: AppState
    private let connectionManager: ConnectionManager

    init(appState: AppState, connectionManager: ConnectionManager) {
        self.appState = appState
        self.connectionManager = connectionManager
    }

    var canDispatch: Bool {
        !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !isDispatching &&
        connectionManager.isConnected
    }

    // MARK: - Actions

    func selectTemplate(_ template: DispatchTemplate) {
        selectedTemplate = template
        if template != .custom {
            promptText = template.defaultPrompt
        }
        HapticService.shared.trigger(.selection)
    }

    func dispatch() async {
        let prompt = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }

        isDispatching = true
        errorMessage = nil

        let request = DispatchRequest(
            prompt: prompt,
            provider: selectedProvider,
            model: selectedModel,
            template: selectedTemplate
        )

        do {
            let task = try await connectionManager.rpcClient.dispatchTask(request)
            appState.addAgent(task)
            lastDispatched = task
            showConfirmation = true
            promptText = ""
            selectedTemplate = nil
            HapticService.shared.trigger(.taskComplete)
        } catch {
            errorMessage = "Dispatch failed: \(error.localizedDescription)"
            HapticService.shared.trigger(.error)
        }

        isDispatching = false
    }

    func clearConfirmation() {
        showConfirmation = false
        lastDispatched = nil
    }
}
