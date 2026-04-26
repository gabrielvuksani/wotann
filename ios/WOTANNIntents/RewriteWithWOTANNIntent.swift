import AppIntents
import Foundation

// MARK: - RewriteWithWOTANNIntent (T7.5)
//
// Ships a "Rewrite with WOTANN" entry in every text-selection context menu
// via AppShortcuts. The intent takes the selected text, sends it to the
// paired desktop through the same `WOTANNIntentService` RPC channel used
// by `AskWOTANNIntent`, and returns the rewritten string so iOS can swap
// it in place.
//
// V9 note: WWDC 2026 is expected to ship a generic `@AssistantIntent`
// schema for Writing Tools; until then we ship plain `AppIntent`s with
// `categoryName: "Writing"` + `AppShortcut` so they surface in the
// Apple Intelligence Writing Tools menu alongside iOS built-ins. The
// protocol signature here deliberately matches the eventual schema
// shape — `ProvidesRewrittenText` style — so the WWDC 2026 migration
// is a rename, not a rewrite.

struct RewriteWithWOTANNIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Rewrite with WOTANN"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Rewrite the selected text using WOTANN's paired desktop. Superior to on-device rewrites for code and technical prose.",
        categoryName: "Writing"
    )
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Text", description: "The text to rewrite.")
    var text: String

    @Parameter(
        title: "Tone",
        description: "Rewrite tone. Defaults to neutral.",
        default: .neutral
    )
    var tone: RewriteTone

    static var parameterSummary: some ParameterSummary {
        Summary("Rewrite \(\.$text)") {
            \.$tone
        }
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(value: text)
        }

        // Route through the existing intent service. The service transparently
        // handles pairing, ECDH key rehydration, and RPC — keeping all
        // Writing Tools traffic on the same encrypted bridge as Ask / Enhance.
        let prompt = "Rewrite the following text. Tone: \(tone.rawValue). Preserve meaning and code semantics. Reply with ONLY the rewritten text, no preamble.\n\n\(trimmed)"
        // Omit provider so the daemon uses the user's active provider —
        // see WOTANNIntentService.sendPrompt for the rationale.
        let rewritten = await WOTANNIntentService.shared.sendPrompt(prompt)

        // If the service returned a human-readable error, echo the original
        // text so the Writing Tools flow doesn't corrupt the user's buffer.
        if rewritten.contains("Not connected") || rewritten.contains("Failed to reach") {
            return .result(value: text)
        }
        return .result(value: rewritten)
    }
}

// MARK: - RewriteTone

enum RewriteTone: String, AppEnum {
    case neutral
    case professional
    case friendly
    case concise
    case technical

    static var typeDisplayRepresentation: TypeDisplayRepresentation {
        "Rewrite Tone"
    }

    static var caseDisplayRepresentations: [RewriteTone: DisplayRepresentation] {
        [
            .neutral:      "Neutral",
            .professional: "Professional",
            .friendly:     "Friendly",
            .concise:      "Concise",
            .technical:    "Technical",
        ]
    }
}

// MARK: - AppShortcut Registration
//
// iOS only allows ONE `AppShortcutsProvider` per app. The consolidated
// provider lives in `AskWOTANNIntent.swift` alongside the Ask shortcut;
// this file declares the intent + supporting enum only.
