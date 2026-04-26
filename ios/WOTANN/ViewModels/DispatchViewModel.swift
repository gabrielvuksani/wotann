import Foundation
import Observation

// MARK: - DispatchViewModel
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. The view-model has no current consumers in production
// SwiftUI; no `@StateObject`/`@ObservedObject` reference exists today, so the
// migration costs nothing on the consumer side. When a Dispatch surface is
// wired in, it should adopt:
//   `@State private var vm = DispatchViewModel(appState: ..., connectionManager: ...)`
//   `@Bindable var vm: DispatchViewModel` (when forwarding two-way bindings).

/// Manages task dispatch from phone to desktop.
@MainActor
@Observable
final class DispatchViewModel {
    var promptText = ""
    var selectedTemplate: DispatchTemplate?
    // Empty sentinels — populated from AppState.activeProvider /
    // activeModel when the view appears. Hard-coding "anthropic" /
    // "claude-opus-4-6" here would route every Dispatch through that
    // vendor regardless of the user's actual configuration, AND the
    // 4-6 model retires June 15, 2026 (so the default would also be
    // stale). Keep empty until we read the user's real selection.
    var selectedProvider: String = ""
    var selectedModel: String = ""
    var isDispatching = false
    var lastDispatched: AgentTask?
    var errorMessage: String?
    var showConfirmation = false

    @ObservationIgnored
    private let appState: AppState
    @ObservationIgnored
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
