import SwiftUI

// MARK: - FirstRunSuccessView

/// Celebratory screen shown after the first successful pairing.
/// Animated green checkmark scales 0 -> 1 with a springy bounce, then
/// three large action cards offer smart first prompts. Tapping a card
/// seeds the composer text, sets the deep-link destination to "chat",
/// and transitions into MainShell.
///
/// An "Explore on my own" link gives the user a silent exit.
struct FirstRunSuccessView: View {
    let onDone: () -> Void

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var connectionManager: ConnectionManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var checkScale: CGFloat = 0
    @State private var checkOpacity: Double = 0
    @State private var textOpacity: Double = 0
    @State private var cardsOpacity: Double = 0

    /// Smart starter prompts surfaced as large action cards.
    private let suggestions: [Suggestion] = [
        Suggestion(
            icon: "tray.and.arrow.down.fill",
            title: "Summarize this morning's inbox",
            prompt: "Summarize this morning's inbox and highlight anything that needs my attention today."
        ),
        Suggestion(
            icon: "testtube.2",
            title: "Run tests on a repo",
            prompt: "Run the full test suite on my current repo and report any failures."
        ),
        Suggestion(
            icon: "rectangle.split.2x1.fill",
            title: "Compare Claude vs GPT-5 on [prompt]",
            prompt: "Compare Claude and GPT-5 side by side on: "
        ),
    ]

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: WTheme.Spacing.xl) {
                Spacer()

                // Animated checkmark
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 96, weight: .regular))
                    .foregroundStyle(WTheme.Colors.success)
                    .shadow(color: WTheme.Colors.success.opacity(0.6), radius: 24)
                    .scaleEffect(checkScale)
                    .opacity(checkOpacity)

                VStack(spacing: WTheme.Spacing.sm) {
                    Text("You're linked.")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .tracking(WTheme.Tracking.displayLarge)
                        .foregroundStyle(.white)

                    Text("Try one of these to get started.")
                        .font(.system(size: 15, weight: .regular, design: .rounded))
                        .foregroundStyle(WTheme.Colors.textSecondary)
                }
                .opacity(textOpacity)

                // Action cards
                VStack(spacing: WTheme.Spacing.md) {
                    ForEach(suggestions) { suggestion in
                        SuggestionCard(
                            suggestion: suggestion,
                            onTap: { seed(suggestion.prompt) }
                        )
                    }
                }
                .padding(.horizontal, WTheme.Spacing.lg)
                .opacity(cardsOpacity)

                Spacer()

                Button(action: onDone) {
                    Text("Explore on my own")
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(WTheme.Colors.textTertiary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .padding(.horizontal, WTheme.Spacing.xl)
                .padding(.bottom, WTheme.Spacing.lg)
                .opacity(cardsOpacity)
            }
        }
        .onAppear(perform: animateIn)
    }

    // MARK: - Animation

    private func animateIn() {
        if reduceMotion {
            checkScale = 1.0
            checkOpacity = 1.0
            textOpacity = 1.0
            cardsOpacity = 1.0
            return
        }

        withAnimation(.spring(duration: 0.6, bounce: 0.4)) {
            checkScale = 1.0
            checkOpacity = 1.0
        }
        withAnimation(.easeOut(duration: 0.4).delay(0.4)) {
            textOpacity = 1.0
        }
        withAnimation(.easeOut(duration: 0.5).delay(0.7)) {
            cardsOpacity = 1.0
        }
    }

    // MARK: - Seed + Transition

    /// Seeds the chat composer with the prompt and routes into MainShell.
    /// Creates a fresh conversation with the prompt as the first user message
    /// so the transition feels immediate even before the desktop streams a reply.
    private func seed(_ prompt: String) {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            let title = String(trimmed.prefix(48))
            appState.addConversation(
                Conversation(
                    title: title,
                    messages: [Message(role: .user, content: trimmed)],
                    provider: appState.currentProvider,
                    model: appState.currentModel
                )
            )
        }
        appState.activeTab = 1
        appState.deepLinkDestination = "chat"
        onDone()
    }
}

// MARK: - Suggestion

private struct Suggestion: Identifiable {
    let id = UUID()
    let icon: String
    let title: String
    let prompt: String
}

// MARK: - SuggestionCard

private struct SuggestionCard: View {
    let suggestion: Suggestion
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: WTheme.Spacing.md) {
                Image(systemName: suggestion.icon)
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(WTheme.Colors.primary)
                    .frame(width: 44, height: 44)
                    .background(WTheme.Colors.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))

                Text(suggestion.title)
                    .font(.system(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)

                Spacer()

                Image(systemName: "arrow.up.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WTheme.Colors.primary)
            }
            .padding(WTheme.Spacing.md)
            .frame(minHeight: 72)
            .background(Color(hex: 0x1C1C1E))
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous)
                    .stroke(WTheme.Colors.primary.opacity(0.15), lineWidth: 1)
            )
        }
    }
}

// MARK: - Preview

#Preview("FirstRunSuccess") {
    FirstRunSuccessView(onDone: {})
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
