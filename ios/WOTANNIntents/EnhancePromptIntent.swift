import AppIntents

// MARK: - EnhancePromptIntent

/// Siri intent to enhance/improve a prompt using WOTANN's prompt engine.
struct EnhancePromptIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Enhance Prompt"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Improve a prompt to get better AI responses using WOTANN's Enhance feature.",
        categoryName: "Utilities"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Prompt", description: "The prompt to enhance")
    var prompt: String

    @Parameter(
        title: "Style",
        description: "Enhancement style",
        default: .detailed
    )
    var style: EnhanceStyle

    static var parameterSummary: some ParameterSummary {
        Summary("Enhance \(\.$prompt)") {
            \.$style
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let enhanced = await WOTANNIntentService.shared.enhancePrompt(
            prompt,
            style: style.rawValue
        )
        return .result(value: enhanced)
    }
}

// MARK: - EnhanceStyle

enum EnhanceStyle: String, AppEnum {
    case concise
    case detailed
    case technical
    case creative

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Enhancement Style"
    }

    static var caseDisplayRepresentations: [EnhanceStyle: DisplayRepresentation] {
        [
            .concise: "Concise",
            .detailed: "Detailed",
            .technical: "Technical",
            .creative: "Creative",
        ]
    }
}
