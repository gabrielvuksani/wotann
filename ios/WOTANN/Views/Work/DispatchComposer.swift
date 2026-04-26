import SwiftUI

// MARK: - DispatchComposer

/// Bottom-docked 56pt composer for dispatching a new agent task.
/// Shows a single-line "Dispatch a task…" input, an inline model chip (tap
/// to cycle to the next available model), and a send button. On send it
/// creates a new `AgentTask`, appends it via `appState.addAgent`, and fires
/// the desktop's `task.dispatch` RPC (the spec calls this "agents.spawn" —
/// the existing RPC surface is `task.dispatch`).
struct DispatchComposer: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    @State private var promptText: String = ""
    @State private var isDispatching: Bool = false
    @State private var selectedModel: String?
    @FocusState private var isFocused: Bool

    /// Provider neutrality fix: was hardcoded ["claude-opus-4-6", ...] —
    /// Ollama-only / Gemini-only users got Anthropic suggestions they
    /// couldn't use. Now empty until AppState reports the active provider's
    /// actual model list (resolved at view appear via .task).
    private static let fallbackModels: [String] = []

    /// Resolved ordered list of models the chip can cycle through. Prefers
    /// the active provider's model list from `AppState`, falling back to a
    /// curated default when nothing is available.
    private var availableModels: [String] {
        if let provider = appState.availableProviders.first(where: { $0.id == appState.currentProvider }),
           !provider.models.isEmpty {
            return provider.models
        }
        return Self.fallbackModels
    }

    private var currentModel: String {
        selectedModel ?? appState.currentModel
    }

    private var canSend: Bool {
        !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isDispatching
    }

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            // Input + inline model chip
            HStack(spacing: WTheme.Spacing.sm) {
                TextField("Dispatch a task…", text: $promptText)
                    .textFieldStyle(.plain)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .font(.wotannScaled(size: 15))
                    .focused($isFocused)
                    .submitLabel(.send)
                    .onSubmit { send() }

                Button {
                    cycleModel()
                } label: {
                    Text(modelChipLabel)
                        .font(.wotannScaled(size: 11, weight: .semibold, design: .rounded))
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(
                            Capsule().fill(WTheme.Colors.surfaceAlt)
                        )
                        .overlay(
                            Capsule().stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
                        )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Model: \(modelChipLabel). Tap to change.")
            }
            .padding(.horizontal, WTheme.Spacing.sm)
            .frame(height: 40)
            .background(
                RoundedRectangle(cornerRadius: WTheme.Radius.md)
                    .fill(WTheme.Colors.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: WTheme.Radius.md)
                    .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
            )

            // Send button
            Button {
                send()
            } label: {
                Group {
                    if isDispatching {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                    } else {
                        Image(systemName: "arrow.up")
                            .font(.wotannScaled(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                    }
                }
                .frame(width: 40, height: 40)
                .background(
                    Circle().fill(canSend ? WTheme.Colors.primary : WTheme.Colors.surfaceAlt)
                )
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel("Send task")
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        .frame(height: 56)
        .background(
            Rectangle()
                .fill(WTheme.Colors.background)
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(WTheme.Colors.border)
                        .frame(height: WTheme.BorderWidth.hairline)
                }
        )
    }

    // MARK: - Actions

    private var modelChipLabel: String {
        let model = currentModel
        switch model.lowercased() {
        case let m where m.contains("opus"):    return "Opus"
        case let m where m.contains("sonnet"):  return "Sonnet"
        case let m where m.contains("haiku"):   return "Haiku"
        case let m where m.contains("gpt-4o"):  return "GPT-4o"
        case let m where m.contains("gpt-4"):   return "GPT-4"
        case let m where m.contains("o1"):      return "o1"
        case "auto":                            return "Auto"
        default:
            // Shorten very long model ids (e.g. claude-opus-4-6 → opus-4-6).
            let parts = model.split(separator: "-")
            if parts.count > 2 {
                return parts.suffix(3).joined(separator: "-")
            }
            return model
        }
    }

    private func cycleModel() {
        HapticService.shared.trigger(.selection)
        let models = availableModels
        guard !models.isEmpty else { return }
        let current = currentModel
        if let index = models.firstIndex(of: current) {
            let next = models[(index + 1) % models.count]
            selectedModel = next
        } else {
            selectedModel = models.first
        }
    }

    private func send() {
        let trimmed = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isDispatching else { return }

        HapticService.shared.trigger(.messageSent)
        let provider = appState.currentProvider
        let model = currentModel

        // Optimistically create and insert the agent so the list updates now.
        let optimistic = AgentTask(
            title: trimmed,
            status: .queued,
            progress: 0,
            provider: provider,
            model: model,
            cost: 0
        )
        appState.addAgent(optimistic)

        isDispatching = true
        promptText = ""

        let request = DispatchRequest(
            prompt: trimmed,
            provider: provider,
            model: model,
            template: nil
        )

        Task { @MainActor in
            defer { isDispatching = false }
            do {
                let dispatched = try await connectionManager.rpcClient.dispatchTask(request)
                // Replace the optimistic entry with the backend's canonical task.
                if let index = appState.agents.firstIndex(where: { $0.id == optimistic.id }) {
                    var updated = appState.agents
                    updated[index] = dispatched
                    appState.agents = updated
                }
            } catch {
                // Mark the optimistic agent as failed so the user sees what happened.
                appState.updateAgent(optimistic.id) { agent in
                    agent.status = .failed
                    agent.errorMessage = error.localizedDescription
                    agent.completedAt = .now
                }
                HapticService.shared.trigger(.error)
            }
        }
    }
}
