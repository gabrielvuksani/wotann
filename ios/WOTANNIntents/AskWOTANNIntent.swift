import AppIntents

// MARK: - AskWOTANNIntent

/// Siri intent to send a prompt to WOTANN and receive a response.
struct AskWOTANNIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Ask WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Send a prompt to WOTANN and get an AI response.",
        categoryName: "Chat"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Prompt", description: "The question or instruction to send to WOTANN")
    var prompt: String

    @Parameter(title: "Provider", description: "AI provider to use", default: "anthropic")
    var provider: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask WOTANN \(\.$prompt)") {
            \.$provider
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        // In production, this would use the shared RPCClient to communicate
        // with the desktop WOTANN instance via the paired connection.
        let response = await WOTANNIntentService.shared.sendPrompt(
            prompt,
            provider: provider
        )
        return .result(value: response)
    }
}

// MARK: - AskWOTANN Shortcuts Provider

struct AskWOTANNShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AskWOTANNIntent(),
            phrases: [
                "Ask \(.applicationName) a question",
                "Send a message to \(.applicationName)",
                "Query \(.applicationName)",
            ],
            shortTitle: "Ask WOTANN",
            systemImageName: "w.circle.fill"
        )
    }
}
