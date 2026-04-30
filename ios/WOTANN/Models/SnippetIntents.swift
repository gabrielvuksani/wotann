import Foundation

#if canImport(AppIntents)
import AppIntents
#endif

// MARK: - Run Snippet Intent (Round 8)
//
// Lets users fire a saved snippet via Siri or the iOS Shortcuts app:
// "Hey Siri, run code review snippet" → daemon renders the snippet's
// body (with any saved default variable values) and returns it as
// the intent's spoken/printed result. From Shortcuts, users can
// chain it into other actions (e.g., paste-into-Notes, send-as-message).
//
// **Why a String parameter and not a Snippet entity**: Apple's
// `AppEntity` would let users pick a snippet from a Spotlight-style
// picker, which is the better long-term UX. But that requires an
// `EntityQuery` implementation that talks to the daemon, which adds
// complexity. v1 takes the snippet *name* as a string — Siri's
// fuzzy matcher handles "code review prompt" → "Code Review" cleanly,
// and Shortcuts users can type the title directly.
//
// **Donation flow**: every successful snippet use in
// `PromptLibraryView` calls `IntentDonationService.shared.donateSnippet`
// which donates *this* intent type pre-populated with the title.
// Apple's heuristics then surface the most-used snippets in:
//   - Siri Suggestions / Spotlight Top Hits
//   - Action Button suggestions on iPhone 15 Pro+
//   - Lock Screen predictive Shortcuts row
//
// All `AppIntent` types live under `Models/` so they compile into
// both the WOTANN main-app target AND the WOTANNIntents extension
// (mirrors the ControlWidgetIntents pattern).

@available(iOS 18.0, *)
struct RunSnippetIntent: AppIntent {
    nonisolated(unsafe) static var title: LocalizedStringResource = "Run Snippet"
    nonisolated(unsafe) static var description: IntentDescription = IntentDescription(
        "Render a saved WOTANN snippet — \"Hey Siri, run code review snippet\".",
        categoryName: "Snippets"
    )

    /// `openAppWhenRun = false` so Siri/Shortcuts can render and return
    /// the snippet text in-place without yanking the user out of their
    /// current context. Apps that consume the result (Notes, Messages,
    /// Mail) chain it as their input.
    nonisolated(unsafe) static var openAppWhenRun: Bool = false

    @Parameter(title: "Snippet name", description: "The title of the snippet to render")
    var snippetTitle: String

    init() {
        self.snippetTitle = ""
    }

    init(snippetTitle: String) {
        self.snippetTitle = snippetTitle
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ReturnsValue<String> {
        // First-class fallback: if the user invokes the intent without
        // a paired daemon, surface a clean spoken error rather than
        // silently failing. Real implementation will use the runtime's
        // RPC client once the AppIntent is wired into the dependency
        // graph (deferred — needs `IntentDependencyResolver`).
        return .result(
            value: "(snippet runner not yet wired into AppIntent — open WOTANN to use)",
            dialog: "Open WOTANN to run the snippet."
        )
    }
}

// MARK: - App Shortcuts Provider
//
// iOS only allows ONE `AppShortcutsProvider` per app target. The
// existing `WOTANNControlAppShortcuts` in `Models/ControlWidgetIntents.swift`
// is the consolidated provider. The snippet shortcut declaration lives
// THERE, NOT here — defining a second provider triggers
// "Only 1 AppShortcutsProvider conformance is allowed per app" at the
// AppIntents metadata processor stage and breaks the build. Round 8
// fix in 30ad0f1 follow-up.
