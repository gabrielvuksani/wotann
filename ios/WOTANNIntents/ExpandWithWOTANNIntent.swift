import AppIntents
import Foundation

// MARK: - ExpandWithWOTANNIntent (T7.5)
//
// Ships an "Expand with WOTANN" entry in every text-selection context menu
// via AppShortcuts. Takes the selected text and returns a richer, more
// detailed version using the paired desktop.
//
// See `RewriteWithWOTANNIntent.swift` for the V9 rationale on using plain
// `AppIntent` today rather than the unstable `@AssistantIntent` schemas.

struct ExpandWithWOTANNIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Expand with WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Expand the selected text into a longer, more detailed version using WOTANN's paired desktop.",
        categoryName: "Writing"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Text", description: "The text to expand.")
    var text: String

    @Parameter(
        title: "Style",
        description: "Expansion style. Defaults to balanced.",
        default: .balanced
    )
    var style: ExpandStyle

    static var parameterSummary: some ParameterSummary {
        Summary("Expand \(\.$text)") {
            \.$style
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(value: text)
        }

        let prompt = "Expand the following text into a \(style.promptHint). Preserve the original intent and add supporting context. Reply with ONLY the expanded text, no preamble.\n\n\(trimmed)"
        // Omit the provider arg so the daemon picks the user's active provider —
        // hard-coding a vendor here would route every Apple Writing Tools "Expand"
        // through that vendor regardless of what the user actually configured.
        let expanded = await WOTANNIntentService.shared.sendPrompt(prompt)

        // On transport failure, echo the original so Writing Tools doesn't
        // stomp the user's selection with an error string.
        if expanded.contains("Not connected") || expanded.contains("Failed to reach") {
            return .result(value: text)
        }
        return .result(value: expanded)
    }
}

// MARK: - ExpandStyle

enum ExpandStyle: String, AppEnum {
    case balanced
    case detailed
    case narrative
    case examples

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Expansion Style"
    }

    static var caseDisplayRepresentations: [ExpandStyle: DisplayRepresentation] {
        [
            .balanced:  "Balanced",
            .detailed:  "Detailed (technical)",
            .narrative: "Narrative (prose)",
            .examples:  "With examples",
        ]
    }

    /// Prompt fragment used when building the LLM prompt.
    var promptHint: String {
        switch self {
        case .balanced:  return "balanced, natural-length version"
        case .detailed:  return "detailed, technically thorough version"
        case .narrative: return "narrative prose form with smooth transitions"
        case .examples:  return "richer version that includes concrete examples"
        }
    }
}

// MARK: - AppShortcut Registration
//
// iOS only allows ONE `AppShortcutsProvider` per app. The consolidated
// provider lives in `AskWOTANNIntent.swift` alongside the Ask shortcut;
// this file declares the intent + supporting enum only.
