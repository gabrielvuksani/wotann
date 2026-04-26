import AppIntents
import Foundation

// MARK: - SummarizeWithWOTANNIntent (T7.5)
//
// Ships a "Summarize with WOTANN" entry in every text-selection context
// menu via AppShortcuts. Sends the selected text to the paired desktop
// and returns a concise summary that iOS can surface in the Writing Tools
// drawer.
//
// See `RewriteWithWOTANNIntent.swift` for the V9 rationale on using plain
// `AppIntent` today rather than the unstable `@AssistantIntent` schemas.

struct SummarizeWithWOTANNIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Summarize with WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Summarize the selected text using WOTANN's paired desktop. Better than on-device summaries for long articles, diffs, and transcripts.",
        categoryName: "Writing"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Text", description: "The text to summarize.")
    var text: String

    @Parameter(
        title: "Length",
        description: "Target summary length. Defaults to medium.",
        default: .medium
    )
    var length: SummaryLength

    static var parameterSummary: some ParameterSummary {
        Summary("Summarize \(\.$text)") {
            \.$length
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(value: text)
        }

        let prompt = "Summarize the following text in \(length.promptHint). Capture the key points without padding. Reply with ONLY the summary, no preamble.\n\n\(trimmed)"
        // Omit provider so the daemon uses the user's active provider —
        // see WOTANNIntentService.sendPrompt for the rationale.
        let summary = await WOTANNIntentService.shared.sendPrompt(prompt)

        // On transport failure, echo the original so Writing Tools doesn't
        // stomp the user's selection with an error string.
        if summary.contains("Not connected") || summary.contains("Failed to reach") {
            return .result(value: text)
        }
        return .result(value: summary)
    }
}

// MARK: - SummaryLength

enum SummaryLength: String, AppEnum {
    case short
    case medium
    case long
    case bullets

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Summary Length"
    }

    static var caseDisplayRepresentations: [SummaryLength: DisplayRepresentation] {
        [
            .short:   "Short (1 sentence)",
            .medium:  "Medium (1 paragraph)",
            .long:    "Long (multi-paragraph)",
            .bullets: "Bulleted list",
        ]
    }

    /// Prompt fragment used when building the LLM prompt. Kept inline with
    /// the enum so adding a case updates the prompt in lockstep.
    var promptHint: String {
        switch self {
        case .short:   return "one sentence"
        case .medium:  return "one paragraph"
        case .long:    return "multiple paragraphs, preserving structure"
        case .bullets: return "a bulleted list of the key points"
        }
    }
}

// MARK: - AppShortcut Registration
//
// iOS only allows ONE `AppShortcutsProvider` per app. The consolidated
// provider lives in `AskWOTANNIntent.swift` alongside the Ask shortcut;
// this file declares the intent + supporting enum only.
