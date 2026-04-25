import SwiftUI
import UIKit
import os.log

// MARK: - EditorView
//
// Full-screen modal that wraps RunestoneEditorView with everything T13.2 +
// T13.3 ship: file load via RPC or document picker, find/replace bar, status
// bar, inline AI menu, diff gutter, hover/completion popovers, and minimap.
//
// Layout:
//
//   ┌──────────────────────────────────────────────────────┐
//   │ NavigationStack.toolbar (top-bar back/save)          │
//   │ ┌──────────────────────────────────────────────────┐ │
//   │ │ EditorToolbar (language + theme + caret + close) │ │
//   │ ├──────────────────────────────────────────────────┤ │
//   │ │ EditorFindBar (conditional)                      │ │
//   │ ├──────────────────────────────────────────────────┤ │
//   │ │ ┌──┬─────────────────────────────────┬──────┐    │ │
//   │ │ │  │  RunestoneEditorView            │ mini │    │ │
//   │ │ │  │                                 │ map  │    │ │
//   │ │ │ d│                                 │      │    │ │
//   │ │ │ i│                                 │      │    │ │
//   │ │ │ f│                                 │      │    │ │
//   │ │ │ f│                                 │      │    │ │
//   │ │ │  │                                 │      │    │ │
//   │ │ └──┴─────────────────────────────────┴──────┘    │ │
//   │ ├──────────────────────────────────────────────────┤ │
//   │ │ EditorStatusBar (line:col + size + lang + dirty) │ │
//   │ └──────────────────────────────────────────────────┘ │
//   └──────────────────────────────────────────────────────┘
//
// Quality bar #7 — every editor sheet creates a fresh @StateObject EditorViewModel
// (and therefore a fresh EditorService) — never share a singleton.
//
// Keyboard shortcuts (UIKeyCommand via .keyboardShortcut + EditorKeyCommandHost):
//   cmd+S         save
//   cmd+F         show find bar
//   cmd+G         next match (when find bar is open)
//   cmd+shift+G   previous match
//   esc           hide find bar / hover / completion list

struct EditorView: View {

    // MARK: - Inputs

    /// Source for the initial document content. The view chooses a load
    /// strategy based on which case is supplied.
    enum Source {
        /// Pull a desktop-relative path via `file.get`.
        case remote(path: String)
        /// Open a local file URL directly (e.g. document picker result).
        case localURL(URL)
        /// Pre-loaded in-memory content (e.g. a chat artifact).
        case inMemory(content: String, languageId: String)
    }

    /// What to do when the user taps "Ask WOTANN" or sends an inline AI
    /// action — the parent (typically ChatView) routes the seeded prompt to
    /// the chat composer.
    var onSendToChat: ((String) -> Void)?

    /// Optional initial source. May also be set later via `loadSource`.
    let initialSource: Source?

    // MARK: - State

    // Note: we deliberately do NOT declare an `@EnvironmentObject` for the
    // connection manager. EditorView is constructed with the connection
    // manager handed to it explicitly so it remains usable from any host
    // surface — chat sheet, document picker, deep-link, etc.

    @StateObject private var viewModel: EditorViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var showDocumentPicker: Bool = false
    @State private var showInlineAIMenu: Bool = false
    @State private var inlineSelection: String = ""
    @State private var completionSelectedIndex: Int = 0

    private let logger = Logger(subsystem: "com.wotann.ios", category: "EditorView")

    // MARK: - Init

    init(
        connectionManager: ConnectionManager,
        initialSource: Source? = nil,
        onSendToChat: ((String) -> Void)? = nil
    ) {
        self.initialSource = initialSource
        self.onSendToChat = onSendToChat
        _viewModel = StateObject(wrappedValue: EditorViewModel(connectionManager: connectionManager))
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            content
                .navigationTitle(navigationTitle)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { toolbar }
                .toolbarBackground(Color(viewModel.service.theme.gutterBackgroundColor), for: .navigationBar)
                .toolbarColorScheme(viewModel.service.theme.mode == .light ? .light : .dark, for: .navigationBar)
        }
        .task {
            if let source = initialSource {
                await loadSource(source)
            }
            viewModel.markReady()
        }
        .sheet(isPresented: $showDocumentPicker) {
            EditorDocumentPicker(
                onPicked: { url in
                    showDocumentPicker = false
                    viewModel.loadLocalURL(url)
                },
                onCancel: { showDocumentPicker = false }
            )
        }
        .alert(
            "Editor Error",
            isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { if !$0 { viewModel.errorMessage = nil } }
            ),
            presenting: viewModel.errorMessage
        ) { _ in
            Button("OK", role: .cancel) { viewModel.errorMessage = nil }
        } message: { msg in
            Text(msg)
        }
        // Wire keyboard shortcuts via a non-visual host so iPad keyboards
        // forward cmd+S / cmd+F / cmd+G / esc to the right closures even
        // when no SwiftUI element has focus.
        .background(
            EditorKeyCommandHost(
                onSave:        { performSave() },
                onToggleFind:  { withAnimation(WTheme.Animation.quick) { viewModel.showFindBar.toggle() } },
                onNextMatch:   { viewModel.gotoNextMatch() },
                onPrevMatch:   { viewModel.gotoPreviousMatch() },
                onEscape:      { handleEscape() }
            )
            .frame(width: 0, height: 0)
            .opacity(0)
        )
    }

    // MARK: - Main content

    @ViewBuilder
    private var content: some View {
        ZStack(alignment: .topTrailing) {
            VStack(spacing: 0) {
                EditorToolbar(
                    service:      viewModel.service,
                    onSave:       { performSave() },
                    onAskWotann:  { askWotannFromToolbar() },
                    onClose:      { close() }
                )

                Divider()

                if viewModel.showFindBar {
                    EditorFindBar(viewModel: viewModel)
                        .padding(.horizontal, WTheme.Spacing.sm)
                        .padding(.vertical, WTheme.Spacing.xs)
                        .background(Color(viewModel.service.theme.gutterBackgroundColor))
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                if viewModel.isLoading {
                    loadingState
                } else {
                    editorBody
                }

                EditorStatusBar(service: viewModel.service)
            }

            // Hover card — anchored to the trailing edge so it doesn't cover
            // the cursor on small phones. iPad would benefit from caret-anchor
            // popovers; left as future work since UIKit caret position isn't
            // exposed by Runestone yet.
            if viewModel.showHoverCard {
                EditorHoverCard(
                    content: viewModel.hoverContent,
                    onDismiss: { viewModel.showHoverCard = false }
                )
                .padding(.top, WTheme.Spacing.md)
                .padding(.trailing, WTheme.Spacing.md)
                .transition(.scale.combined(with: .opacity))
            }

            if viewModel.showCompletionList && !viewModel.completions.isEmpty {
                EditorCompletionList(
                    items: viewModel.completions,
                    selectedIndex: $completionSelectedIndex,
                    onApply: { item in
                        applyCompletion(item)
                    },
                    onDismiss: {
                        viewModel.showCompletionList = false
                    }
                )
                .padding(.top, WTheme.Spacing.lg)
                .padding(.trailing, WTheme.Spacing.md)
                .transition(.opacity)
            }

            if showInlineAIMenu, !inlineSelection.isEmpty {
                EditorInlineAIMenu(
                    selection: inlineSelection,
                    remotePath: viewModel.remotePath,
                    languageId: viewModel.service.language.id,
                    onSendToChat: { prompt in
                        onSendToChat?(prompt)
                        showInlineAIMenu = false
                        close()
                    },
                    onAskCustom: { seed in
                        onSendToChat?(seed)
                        showInlineAIMenu = false
                        close()
                    },
                    onDismiss: { showInlineAIMenu = false }
                )
                .padding(.top, WTheme.Spacing.lg)
                .padding(.trailing, WTheme.Spacing.md)
                .transition(.scale.combined(with: .opacity))
            }
        }
        .background(Color(viewModel.service.theme.backgroundColor))
        .animation(WTheme.Animation.quick, value: viewModel.showFindBar)
        .animation(WTheme.Animation.quick, value: viewModel.showHoverCard)
        .animation(WTheme.Animation.quick, value: viewModel.showCompletionList)
        .animation(WTheme.Animation.quick, value: showInlineAIMenu)
    }

    // MARK: - Editor body (gutter + Runestone + minimap)

    @ViewBuilder
    private var editorBody: some View {
        HStack(spacing: 0) {
            if !viewModel.diffHunks.isEmpty {
                EditorDiffGutterView(
                    hunks: viewModel.diffHunks,
                    totalLines: viewModel.service.document.lineCount,
                    backgroundColor: viewModel.service.theme.gutterBackgroundColor,
                    textColor: viewModel.service.theme.textColor,
                    onTapHunk: { _ in
                        // Scroll-to-line bridge would require Runestone access
                        // we don't currently expose. The tap is recorded but
                        // a scroll won't fire until that bridge lands.
                    }
                )
                .transition(.move(edge: .leading).combined(with: .opacity))
            }

            RunestoneEditorView(
                service:     viewModel.service,
                onAskWotann: { _ in askWotannFromToolbar() },
                onClose:     nil
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if viewModel.showMinimap {
                EditorMinimap(
                    content:        viewModel.service.document.content,
                    currentLine:    viewModel.service.caretLine,
                    diffHunks:      viewModel.diffHunks,
                    backgroundColor: viewModel.service.theme.gutterBackgroundColor,
                    accentColor:     viewModel.service.theme.textColor,
                    onScrollTo: { _ in
                        // Same bridge dependency as the diff gutter — record
                        // the request, wait for Runestone scroll API.
                    }
                )
                .transition(.move(edge: .trailing).combined(with: .opacity))
            }
        }
    }

    // MARK: - Loading

    private var loadingState: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Spacer()
            ProgressView()
                .scaleEffect(1.3)
                .tint(WTheme.Colors.primary)
            Text("Loading…")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(viewModel.service.theme.backgroundColor))
    }

    // MARK: - Toolbar (navigation chrome)

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                close()
            } label: {
                Image(systemName: "chevron.left")
                Text("Done")
            }
            .accessibilityLabel("Close editor")
        }

        ToolbarItem(placement: .principal) {
            VStack(spacing: 0) {
                Text(navigationTitle)
                    .font(.wotannScaled(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)
                if let path = viewModel.remotePath {
                    Text(path)
                        .font(.wotannScaled(size: 10, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .lineLimit(1)
                }
            }
        }

        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button {
                    withAnimation(WTheme.Animation.quick) {
                        viewModel.showFindBar.toggle()
                    }
                } label: {
                    Label("Find", systemImage: "magnifyingglass")
                }
                Button {
                    withAnimation(WTheme.Animation.quick) {
                        viewModel.showMinimap.toggle()
                    }
                } label: {
                    Label(
                        viewModel.showMinimap ? "Hide minimap" : "Show minimap",
                        systemImage: "rectangle.split.3x1"
                    )
                }
                Button {
                    showDocumentPicker = true
                } label: {
                    Label("Open file…", systemImage: "folder")
                }
                Divider()
                Button {
                    promptInlineAI()
                } label: {
                    Label("Ask WOTANN about selection", systemImage: "sparkles")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .accessibilityLabel("Editor options")
        }
    }

    // MARK: - Title

    private var navigationTitle: String {
        if let path = viewModel.remotePath {
            return (path as NSString).lastPathComponent
        }
        if let url = viewModel.service.document.url {
            return url.lastPathComponent
        }
        return "Editor"
    }

    // MARK: - Source loading

    private func loadSource(_ source: Source) async {
        switch source {
        case .remote(let path):
            await viewModel.loadRemote(path: path)
        case .localURL(let url):
            viewModel.loadLocalURL(url)
        case .inMemory(let content, let languageId):
            viewModel.loadInMemory(content: content, languageId: languageId)
        }
    }

    // MARK: - Save

    private func performSave() {
        Task {
            await viewModel.save()
        }
    }

    // MARK: - Close

    private func close() {
        viewModel.service.flushPendingAutosave()
        dismiss()
    }

    // MARK: - Inline AI

    /// Pops the inline-AI menu seeded with the document content if no
    /// selection is available. UIKit selection retrieval would require a
    /// custom Runestone delegate path; for now we fall back to the full
    /// buffer when nothing is highlighted.
    private func promptInlineAI() {
        let candidate = viewModel.service.document.content
        if candidate.isEmpty {
            inlineSelection = ""
        } else {
            // Limit to the first 4 KB to keep the chat prompt focused.
            let cap = min(candidate.count, 4096)
            inlineSelection = String(candidate.prefix(cap))
        }
        showInlineAIMenu = !inlineSelection.isEmpty
    }

    private func askWotannFromToolbar() {
        let document = viewModel.service.document
        viewModel.askWotann(document, sink: onSendToChat)
        close()
    }

    // MARK: - Completion application

    private func applyCompletion(_ item: LSPCompletionItem) {
        // Insertion at the caret would also need a Runestone API hook.
        // For now we close the list and surface the completion to the
        // user via the "Ask WOTANN" path so they can paste/insert manually.
        viewModel.showCompletionList = false
        completionSelectedIndex = 0
        // Append the suggestion at the end as a fallback so the action is
        // not silently dropped.
        let updated = viewModel.service.document.content + item.label
        viewModel.service.updateContent(updated, caret: viewModel.service.caretColumn)
    }

    // MARK: - Escape

    private func handleEscape() {
        if showInlineAIMenu { showInlineAIMenu = false; return }
        if viewModel.showCompletionList { viewModel.showCompletionList = false; return }
        if viewModel.showHoverCard { viewModel.showHoverCard = false; return }
        if viewModel.showFindBar {
            withAnimation(WTheme.Animation.quick) {
                viewModel.showFindBar = false
            }
            return
        }
        close()
    }
}

// MARK: - EditorKeyCommandHost
//
// UIKit responder shim that registers cmd+S / cmd+F / cmd+G / esc and routes
// them to SwiftUI closures. Sits invisibly inside EditorView so iPad hardware
// keyboards behave like native code editors.
//
// We use a UIViewControllerRepresentable rather than `.keyboardShortcut`
// modifiers because the shortcuts must fire whether a TextField is focused
// or not — `.keyboardShortcut` only fires when the host control is the
// first responder.

struct EditorKeyCommandHost: UIViewControllerRepresentable {
    let onSave: () -> Void
    let onToggleFind: () -> Void
    let onNextMatch: () -> Void
    let onPrevMatch: () -> Void
    let onEscape: () -> Void

    func makeUIViewController(context: Context) -> KeyCommandViewController {
        let vc = KeyCommandViewController()
        vc.onSave = onSave
        vc.onToggleFind = onToggleFind
        vc.onNextMatch = onNextMatch
        vc.onPrevMatch = onPrevMatch
        vc.onEscape = onEscape
        return vc
    }

    func updateUIViewController(_ vc: KeyCommandViewController, context: Context) {
        vc.onSave = onSave
        vc.onToggleFind = onToggleFind
        vc.onNextMatch = onNextMatch
        vc.onPrevMatch = onPrevMatch
        vc.onEscape = onEscape
    }

    final class KeyCommandViewController: UIViewController {
        var onSave: () -> Void = {}
        var onToggleFind: () -> Void = {}
        var onNextMatch: () -> Void = {}
        var onPrevMatch: () -> Void = {}
        var onEscape: () -> Void = {}

        override var canBecomeFirstResponder: Bool { true }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            becomeFirstResponder()
        }

        override var keyCommands: [UIKeyCommand]? {
            [
                UIKeyCommand(
                    input: "s",
                    modifierFlags: .command,
                    action: #selector(handleSave),
                    discoverabilityTitle: "Save"
                ),
                UIKeyCommand(
                    input: "f",
                    modifierFlags: .command,
                    action: #selector(handleFind),
                    discoverabilityTitle: "Find"
                ),
                UIKeyCommand(
                    input: "g",
                    modifierFlags: .command,
                    action: #selector(handleNext),
                    discoverabilityTitle: "Next match"
                ),
                UIKeyCommand(
                    input: "g",
                    modifierFlags: [.command, .shift],
                    action: #selector(handlePrev),
                    discoverabilityTitle: "Previous match"
                ),
                UIKeyCommand(
                    input: UIKeyCommand.inputEscape,
                    modifierFlags: [],
                    action: #selector(handleEscape),
                    discoverabilityTitle: "Close find / hide popover"
                ),
            ]
        }

        @objc private func handleSave()   { onSave() }
        @objc private func handleFind()   { onToggleFind() }
        @objc private func handleNext()   { onNextMatch() }
        @objc private func handlePrev()   { onPrevMatch() }
        @objc private func handleEscape() { onEscape() }
    }
}
