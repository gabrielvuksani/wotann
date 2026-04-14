import SwiftUI

// MARK: - AskComposer

/// Full-screen sheet for composing a new prompt.
/// Layout:
/// - Top: multi-line text area (autosizes)
/// - Middle: model / provider pickers + Compare / Council toggles
/// - Bottom: prominent primary send button
///
/// Behavior:
/// - If `appState.activeConversationId` exists, the prompt is appended to it.
/// - Otherwise, a new `Conversation` is created and becomes active.
/// - After dispatch, the sheet dismisses and focus moves to the Chat tab.
struct AskComposer: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @Environment(\.dismiss) private var dismiss

    @State private var promptText: String = ""
    @State private var compareMode: Bool = false
    @State private var councilMode: Bool = false
    @FocusState private var promptFocused: Bool

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ZStack {
                WTheme.Colors.background.ignoresSafeArea()

                VStack(spacing: 0) {
                    editor
                    controlsRow
                    sendBar
                }
            }
            .navigationTitle("Ask")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
            }
            .onAppear {
                // Autofocus the text editor as soon as the sheet appears.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    promptFocused = true
                }
            }
        }
    }

    // MARK: - Editor

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if promptText.isEmpty {
                Text("What do you want to build?")
                    .font(WTheme.Typography.titleDisplay)
                    .tracking(WTheme.Tracking.titleDisplay)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .padding(.horizontal, WTheme.Spacing.md + 4)
                    .padding(.top, WTheme.Spacing.md + 8)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $promptText)
                .font(WTheme.Typography.titleDisplay)
                .tracking(WTheme.Tracking.titleDisplay)
                .foregroundColor(WTheme.Colors.textPrimary)
                .scrollContentBackground(.hidden)
                .padding(WTheme.Spacing.md)
                .focused($promptFocused)
                .accessibilityLabel("Prompt")
                .accessibilityHint("Enter your request. Send with the button below.")
        }
        .frame(maxHeight: .infinity)
    }

    // MARK: - Controls Row

    private var controlsRow: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            providerChip
            modelChip
            Spacer()
            Toggle(isOn: $compareMode) { Text("Compare") }
                .toggleStyle(CompactToggleStyle())
                .wotannAccessible(label: "Compare mode", hint: "Run prompt on multiple models side by side")
            Toggle(isOn: $councilMode) { Text("Council") }
                .toggleStyle(CompactToggleStyle())
                .wotannAccessible(label: "Council mode", hint: "Have multiple models deliberate together")
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        .background(WTheme.Colors.surface)
        .overlay(
            Rectangle()
                .fill(WTheme.Colors.border)
                .frame(height: WTheme.BorderWidth.hairline),
            alignment: .top
        )
    }

    private var providerChip: some View {
        Text(appState.currentProvider.capitalized)
            .font(WTheme.Typography.captionStd)
            .tracking(WTheme.Tracking.caption)
            .foregroundColor(WTheme.Colors.primary)
            .padding(.horizontal, WTheme.Spacing.sm)
            .padding(.vertical, WTheme.Spacing.xxs)
            .background(WTheme.Colors.primary.opacity(0.12))
            .clipShape(Capsule())
            .accessibilityLabel("Provider: \(appState.currentProvider)")
    }

    private var modelChip: some View {
        Text(appState.currentModel)
            .font(WTheme.Typography.captionStd)
            .tracking(WTheme.Tracking.caption)
            .foregroundColor(WTheme.Colors.textSecondary)
            .padding(.horizontal, WTheme.Spacing.sm)
            .padding(.vertical, WTheme.Spacing.xxs)
            .background(WTheme.Colors.surfaceAlt)
            .clipShape(Capsule())
            .lineLimit(1)
            .accessibilityLabel("Model: \(appState.currentModel)")
    }

    // MARK: - Send Bar

    private var sendBar: some View {
        HStack {
            Button {
                Haptics.shared.buttonTap()
                dispatchPrompt()
            } label: {
                HStack(spacing: WTheme.Spacing.sm) {
                    Text(compareMode || councilMode ? "Dispatch" : "Send")
                        .font(WTheme.Typography.roundedHeadline)
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                }
                .foregroundColor(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(isSendEnabled ? WTheme.Colors.primary : WTheme.Colors.surfaceAlt)
                .clipShape(Capsule())
            }
            .disabled(!isSendEnabled)
            .animation(WTheme.Animation.quick, value: isSendEnabled)
        }
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.background)
    }

    private var isSendEnabled: Bool {
        !promptText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - Dispatch

    private func dispatchPrompt() {
        let trimmed = promptText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Append to active conversation if present, else create a new one.
        if let activeId = appState.activeConversationId,
           appState.conversations.contains(where: { $0.id == activeId }) {
            appState.updateConversation(activeId) { conv in
                conv.messages.append(Message(role: .user, content: trimmed))
                conv.updatedAt = .now
            }
        } else {
            let title = String(trimmed.prefix(48))
            let conversation = Conversation(
                title: title.isEmpty ? "New Chat" : title,
                messages: [Message(role: .user, content: trimmed)],
                provider: appState.currentProvider,
                model: appState.currentModel
            )
            appState.addConversation(conversation)
        }

        // Switch focus to Chat tab so the user sees the response stream in.
        appState.activeTab = 1
        Haptics.shared.success()
        dismiss()
    }
}

// MARK: - CompactToggleStyle

/// A minimal toggle styled as a small capsule. Used in the composer footer.
private struct CompactToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            Haptics.shared.buttonTap()
            configuration.isOn.toggle()
        } label: {
            configuration.label
                .font(WTheme.Typography.captionStd)
                .foregroundColor(configuration.isOn ? .white : WTheme.Colors.textSecondary)
                .padding(.horizontal, WTheme.Spacing.sm)
                .padding(.vertical, WTheme.Spacing.xxs)
                .background(configuration.isOn ? WTheme.Colors.primary : WTheme.Colors.surfaceAlt)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}
