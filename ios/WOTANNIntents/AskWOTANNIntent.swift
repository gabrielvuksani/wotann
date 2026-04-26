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

    @Parameter(title: "Provider", description: "AI provider to use (leave empty for the active one)", default: "")
    var provider: String

    static var parameterSummary: some ParameterSummary {
        Summary("Ask WOTANN \(\.$prompt)") {
            \.$provider
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        // Empty provider means "use the active provider configured in the
        // app." Routing every Siri request to a hard-coded vendor would
        // bias every voice interaction back toward one provider — instead,
        // WOTANNIntentService picks the active provider from AppState.
        let providerArg = provider.isEmpty ? nil : provider
        let response = await WOTANNIntentService.shared.sendPrompt(
            prompt,
            provider: providerArg
        )
        return .result(value: response)
    }
}

// MARK: - SB-N4 fix: AskWOTANNShortcuts DELETED
//
// iOS only allows a single `AppShortcutsProvider` per app target. The
// previous `AskWOTANNShortcuts` here was a SHADOW DUPLICATE — iOS picked
// the main-app `WOTANNControlAppShortcuts` and silently ignored this one,
// so the four shortcut entries (Ask/Rewrite/Summarize/Expand) never
// surfaced in Siri/Spotlight/App Library.
//
// The fix lives in `ios/WOTANN/Models/ControlWidgetIntents.swift`:
// the canonical provider now includes deep-link variants of all 7
// shortcuts that route into the main app via App Group UserDefaults,
// mirroring the existing OpenCostDialogIntent pattern. The intents in
// THIS file (AskWOTANNIntent + RewriteWithWOTANNIntent + ...) remain
// reachable via the App Intents API and Apple Intelligence Writing Tools
// menu (registered via IntentsSupported in WOTANNIntents/Info.plist).
