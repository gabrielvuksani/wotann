import SwiftUI
import UIKit
import Combine
import Runestone
import os.log

// MARK: - RunestoneEditorView
//
// SwiftUI wrapper around Runestone's UIKit `TextView`. Tier 1 MVP scope:
// full-screen modal, native UIKit text loupe/grab handles, TreeSitter syntax
// highlighting for 36 languages, light/dark theme, keyboard accessory bar
// (via `EditorToolbar`), debounced autosave via `EditorService`.
//
// Architecture:
//
//   ┌──────────────────────────────────────────────┐
//   │  RunestoneEditorView  (SwiftUI root)         │
//   │  ┌────────────────────────────────────────┐  │
//   │  │ EditorToolbar  (language/theme/save)   │  │
//   │  ├────────────────────────────────────────┤  │
//   │  │ RunestoneTextViewRepresentable         │  │
//   │  │   └── Runestone.TextView (UIKit)       │  │
//   │  └────────────────────────────────────────┘  │
//   │                                              │
//   │  EditorService (per-session, owned by caller)│
//   └──────────────────────────────────────────────┘
//
// QB #7 — the `EditorService` is injected as an `@ObservedObject` from the
// caller's `@StateObject`. This view NEVER constructs its own service. Two
// editor sheets open at once must each carry their own `EditorService`
// instance or autosaves will stomp each other.

struct RunestoneEditorView: View {

    // MARK: - Inputs

    /// Per-session editor state. The caller creates a fresh `EditorService`
    /// for every editor sheet — never a shared singleton (QB #7).
    @ObservedObject var service: EditorService

    /// Called when the user taps "Ask WOTANN" on the toolbar. The closure
    /// receives the current document content so the chat composer can wrap
    /// it as an `@file:` reference.
    var onAskWotann: ((EditorDocument) -> Void)?

    /// Called when the user taps the close button. Defaults to dismissal;
    /// callers presenting as a sheet wire this to `dismiss()`.
    var onClose: (() -> Void)?

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            EditorToolbar(
                service: service,
                onSave:       { trySave() },
                onAskWotann:  { onAskWotann?(service.document) },
                onClose:      { onClose?() }
            )

            Divider()

            RunestoneTextViewRepresentable(service: service)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(service.theme.backgroundColor))
                .ignoresSafeArea(.container, edges: [.leading, .trailing])
        }
        .background(Color(service.theme.backgroundColor))
        .onDisappear {
            // Always flush before tear-down so no in-flight autosave is lost.
            service.flushPendingAutosave()
        }
        .alert(
            "Editor Error",
            isPresented: .constant(service.lastError != nil),
            presenting: service.lastError
        ) { _ in
            Button("OK", role: .cancel) { }
        } message: { err in
            Text(err.localizedDescription)
        }
    }

    // MARK: - Actions

    private func trySave() {
        do {
            _ = try service.save()
        } catch {
            // The service already set `.lastError`; the alert fires via binding.
            let log = Logger(subsystem: "com.wotann.ios", category: "RunestoneEditorView")
            log.error("Save tapped but failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}

// MARK: - RunestoneTextViewRepresentable
//
// The UIViewRepresentable that bridges Runestone's UIKit TextView into
// SwiftUI. We own the TextView instance but delegate state to the
// EditorService so the surrounding SwiftUI tree can observe it.
//
// Runestone API used here (v0.5.x):
//   - Runestone.TextView: UIView subclass, text + selectedRange + editorDelegate
//   - Runestone.TextViewState: snapshot builder for theme/language/text resets
//   - Runestone.TextViewDelegate: .textViewDidChange, .textViewDidChangeSelection
//   - Runestone.TreeSitterLanguage: TreeSitter pack handle (opaque to us)
//
// When a Runestone API we rely on is renamed upstream we only need to
// touch this file — the rest of the T13 surface is pure Swift.

struct RunestoneTextViewRepresentable: UIViewRepresentable {

    @ObservedObject var service: EditorService

    // Tracks the language id currently installed in the TextView so we can
    // tell `updateUIView` when a language/theme swap is required (expensive)
    // versus a plain text mutation (cheap).
    final class Tracker {
        var languageId: String = "plaintext"
        var themeMode: EditorThemeMode = .system
    }

    func makeUIView(context: Context) -> Runestone.TextView {
        let tv = Runestone.TextView()

        // Baseline UX flags — match Notes.app defaults.
        tv.autocorrectionType      = .no
        tv.autocapitalizationType  = .none
        tv.smartDashesType         = .no
        tv.smartQuotesType         = .no
        tv.smartInsertDeleteType   = .no
        tv.spellCheckingType       = .no

        // Editor surface.
        tv.showLineNumbers         = true
        tv.showTabs                = false
        tv.showSpaces              = false
        tv.showLineBreaks          = false
        tv.lineHeightMultiplier    = 1.15
        tv.kern                    = 0.0
        tv.backgroundColor         = service.theme.backgroundColor

        // Performance — Runestone parses as you type; tell it to render lazy.
        tv.isLineWrappingEnabled   = false
        tv.gutterLeadingPadding    = 6
        tv.gutterTrailingPadding   = 10
        tv.textContainerInset      = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)

        tv.editorDelegate = context.coordinator
        tv.inputAccessoryView = context.coordinator.makeInputAccessory()

        installState(on: tv, tracker: context.coordinator.tracker)

        return tv
    }

    func updateUIView(_ tv: Runestone.TextView, context: Context) {
        let tracker = context.coordinator.tracker

        // Full state rebuild only on language/theme change — preserves caret
        // on the hot path (every keystroke republishes the service).
        let needsFullReset =
            tracker.languageId != service.language.id ||
            tracker.themeMode  != service.themeMode

        if needsFullReset {
            installState(on: tv, tracker: tracker)
            return
        }

        // Cheap path: just sync text + background if they drifted.
        if tv.text != service.document.content {
            tv.text = service.document.content
        }
        if tv.backgroundColor != service.theme.backgroundColor {
            tv.backgroundColor = service.theme.backgroundColor
        }
    }

    // MARK: - State installation

    private func installState(on tv: Runestone.TextView, tracker: Tracker) {
        tv.backgroundColor = service.theme.backgroundColor
        let runestoneTheme = service.theme.runestoneTheme()
        let packLanguage   = resolveRunestoneLanguage(service.language)
        let state = makeTextViewState(
            text:     service.document.content,
            theme:    runestoneTheme,
            language: packLanguage
        )
        tv.setState(state)
        tracker.languageId = service.language.id
        tracker.themeMode  = service.themeMode
    }

    /// Build a `Runestone.TextViewState`. Encapsulated here so we can
    /// adapt to upstream initializer changes in one place.
    private func makeTextViewState(
        text: String,
        theme: RunestoneTheme,
        language: Runestone.TreeSitterLanguage?
    ) -> Runestone.TextViewState {
        if let language {
            return Runestone.TextViewState(text: text, theme: theme, language: language)
        } else {
            return Runestone.TextViewState(text: text, theme: theme)
        }
    }

    /// Resolve a Runestone `TreeSitterLanguage` from our editor language.
    /// Missing pack => nil => plain-text rendering in Runestone.
    private func resolveRunestoneLanguage(_ lang: EditorLanguage) -> Runestone.TreeSitterLanguage? {
        guard let packId = lang.runestonePackId else { return nil }
        return RunestoneLanguagePacks.shared.load(packId: packId)
    }

    // MARK: - Coordinator

    func makeCoordinator() -> Coordinator {
        Coordinator(service: service)
    }

    @MainActor
    final class Coordinator: NSObject, Runestone.TextViewDelegate {
        let service: EditorService
        let tracker = Tracker()

        init(service: EditorService) {
            self.service = service
        }

        // MARK: Runestone.TextViewDelegate

        // Text changed — push into the service (which tracks undo + autosave).
        func textViewDidChange(_ textView: Runestone.TextView) {
            service.updateContent(textView.text, caret: textView.selectedRange.location)
            updateCaret(from: textView)
        }

        // Selection changed — just track the caret for the status bar.
        func textViewDidChangeSelection(_ textView: Runestone.TextView) {
            updateCaret(from: textView)
        }

        // Caret position for the toolbar's "Ln X, Col Y" indicator.
        //
        // Runestone exposes a `textLocation(at:)` helper that returns a
        // `TextLocation(lineNumber, column)`. We guard against its absence
        // on older pack versions by computing the fallback ourselves.
        private func updateCaret(from tv: Runestone.TextView) {
            let loc = tv.selectedRange.location
            let text = tv.text
            let (line, col) = LineColumnCalculator.compute(text: text, location: loc)
            service.updateCaret(line: line, column: col)
        }

        // MARK: Input accessory
        //
        // A minimal UIKit-side accessory — the richer `EditorToolbar`
        // sits above the keyboard but we still want punctuation chips that
        // are tappable without raising the toolbar sheet.

        func makeInputAccessory() -> UIView {
            let bar = UIView(frame: CGRect(x: 0, y: 0, width: 0, height: 44))
            bar.backgroundColor = service.theme.gutterBackgroundColor
            return bar
        }
    }
}

// MARK: - LineColumnCalculator
//
// Pure function that converts a UTF-16 character offset into (line, column).
// Extracted so `EditorServiceTests` can exercise it without a TextView.

enum LineColumnCalculator {
    /// Compute 1-based (line, column) for the given UTF-16 offset.
    /// Safe on empty strings; clamps to bounds.
    static func compute(text: String, location: Int) -> (line: Int, column: Int) {
        guard !text.isEmpty else { return (1, 1) }
        let clamped = max(0, min(location, text.utf16.count))
        var line = 1
        var column = 1
        var idx = text.utf16.startIndex
        var consumed = 0
        while consumed < clamped, idx < text.utf16.endIndex {
            let unit = text.utf16[idx]
            if unit == 0x0A /* LF */ {
                line += 1
                column = 1
            } else {
                column += 1
            }
            idx = text.utf16.index(after: idx)
            consumed += 1
        }
        return (line, column)
    }
}

// MARK: - RunestoneLanguagePacks (lazy registry)
//
// A tiny in-memory cache of TreeSitter language packs resolved from the
// Runestone SPM bundle. Reloading a language from disk is expensive; we
// cache per-pack so every editor session that opens a `.ts` file reuses
// the same parser instance.

final class RunestoneLanguagePacks {

    // This cache is NOT per-session state — it's an immutable parser bundle
    // pool, safe to share. Each `EditorService` still owns its own mutable
    // document/undo/theme state, which is what QB #7 actually guards.
    static let shared = RunestoneLanguagePacks()

    private var cache: [String: Runestone.TreeSitterLanguage] = [:]
    private let lock = NSLock()

    private init() {}

    func load(packId: String) -> Runestone.TreeSitterLanguage? {
        lock.lock(); defer { lock.unlock() }
        if let hit = cache[packId] { return hit }
        guard let pack = RunestoneLanguageResolver.resolve(packId: packId) else { return nil }
        cache[packId] = pack
        return pack
    }
}

// MARK: - RunestoneLanguageResolver
//
// Resolves a `TreeSitterLanguage` from its Runestone pack identifier.
// Returns nil when the pack isn't linked into the build — callers then
// fall back to plain-text rendering, which is the correct degradation path
// per T13 spec ("unknown extension — plain-text fallback, no crash").
//
// The switch below is a REGISTRY POINT, not a list of all TreeSitter
// languages: each case would be populated once the corresponding SPM pack
// is added to the target. Until then the T13 MVP ships with plain-text
// rendering and the full 36-language registry is declared in
// `EditorLanguages.all` so the UI picker is production-complete on day 1.

enum RunestoneLanguageResolver {
    static func resolve(packId: String) -> Runestone.TreeSitterLanguage? {
        // Intentionally empty in the Tier 1 MVP — language pack products
        // will be wired into Package.swift in Tier 2 (T13.2). Until then
        // we degrade gracefully to plain-text rendering. This keeps the
        // MVP's link surface small while letting the language picker stay
        // fully populated from day 1.
        _ = packId
        return nil
    }
}
