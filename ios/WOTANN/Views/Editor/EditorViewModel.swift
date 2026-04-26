import SwiftUI
import Combine
import os.log

// MARK: - EditorViewModel
//
// Per-session view-model that owns an `EditorService` and bridges its state
// to RPC operations on the desktop daemon. This is the "outer ring" around
// the existing `EditorService` (which only knows about local file IO):
//
//   ┌────────────────────────────────────────────────────┐
//   │ EditorView (SwiftUI)                               │
//   │ ┌──────────────────────────────────────────────┐  │
//   │ │ EditorViewModel  (RPC + presentation state)  │  │
//   │ │   ▲                                          │  │
//   │ │   │ owns                                     │  │
//   │ │ EditorService  (local document + autosave)   │  │
//   │ └──────────────────────────────────────────────┘  │
//   └────────────────────────────────────────────────────┘
//
// QUALITY BAR #7 (per-instance, NEVER module-global):
// Every editor sheet creates a fresh `EditorViewModel` via `@StateObject`.
// There is deliberately no `.shared` singleton. Two concurrent editor sheets
// must each carry their own VM — autosave, find/replace state, hover/
// completion caches, and pending RPCs must not bleed between sessions.
//
// ASSUMED RPC METHODS (kept honest — return null on failure, never silent):
//   file.get        params: { path: string }                returns: { content: string, language?: string }
//   file.write      params: { path: string, content: string } returns: { ok: bool }
//   git.diff        params: { path: string }                returns: { hunks: [{ kind: "added"|"removed"|"modified", startLine: int, endLine: int }] }
//   lsp.hover       params: { path, line, column }          returns: { contents: string }                       (T13.3)
//   lsp.completion  params: { path, line, column, prefix? } returns: { items: [{ label, kind, detail }] }      (T13.3)
//   lsp.definition  params: { path, line, column }          returns: { uri, line, column }                     (T13.3)
//
// The desktop owner is responsible for wiring these. If any are missing the
// VM degrades gracefully (no crash; `errorMessage` surfaces a concise note).

@MainActor
final class EditorViewModel: ObservableObject {

    // MARK: - Embedded services (per-instance, NOT shared)

    /// Underlying document/undo/autosave service. Owned 1:1 with this VM.
    let service: EditorService

    /// LSP debounce/cancel adapter. Owned 1:1 to keep request lifetimes
    /// scoped to this editor session.
    let lspBridge: EditorLSPBridge

    // MARK: - Published presentation state

    /// User-visible error string. Set by RPC failures; cleared by retry/dismiss.
    @Published var errorMessage: String?

    /// True while a `file.get` is fetching desktop content.
    @Published var isLoading: Bool = false

    /// True while a `file.write` is in flight (in addition to local autosave).
    @Published var isWritingRemote: Bool = false

    /// True while initial layout is settling. Used to suppress the find bar
    /// from auto-focusing under the Apple Intelligence keyboard transition.
    @Published var isReady: Bool = false

    /// Find bar visibility — toggled by cmd+F or the toolbar menu.
    @Published var showFindBar: Bool = false

    /// Find bar query text. Empty = no active search.
    @Published var findQuery: String = ""

    /// Replace text for the find bar's optional replace field.
    @Published var replaceText: String = ""

    /// Whether the find bar treats `findQuery` as a regular expression.
    @Published var findIsRegex: Bool = false

    /// Whether the find bar matches case-sensitively.
    @Published var findIsCaseSensitive: Bool = false

    /// Found ranges (UTF-16 offset, length) into the current document content.
    /// Recomputed on every keystroke or query change.
    @Published var findMatches: [NSRange] = []

    /// Index into `findMatches` of the currently-highlighted match.
    @Published var findCurrentIndex: Int = 0

    /// Hover card visibility (LSP).
    @Published var showHoverCard: Bool = false

    /// Hover card markdown content (rendered by `EditorHoverCard`).
    @Published var hoverContent: String = ""

    /// Completion list visibility (LSP ghost-text).
    @Published var showCompletionList: Bool = false

    /// Most recent completion items.
    @Published var completions: [LSPCompletionItem] = []

    /// Diff gutter hunks for the current file. Empty = no diff (clean tree).
    @Published var diffHunks: [EditorDiffHunk] = []

    /// Whether the minimap is visible. Default off so it doesn't crowd small
    /// iPhones; user can toggle from the toolbar overflow menu.
    @Published var showMinimap: Bool = false

    // MARK: - Loaded source

    /// The desktop-relative path that this editor is currently displaying,
    /// when sourced via `@file:` mention. Local-only files use a URL only.
    @Published private(set) var remotePath: String?

    // MARK: - Internals

    /// Exposed (read-only) so the EditorView toolbar can hand the same
    /// connection to child sheets like UndoView and ComposerSheet without
    /// requiring callers to thread the ConnectionManager through twice.
    let connectionManager: ConnectionManager
    private let logger = Logger(subsystem: "com.wotann.ios", category: "EditorViewModel")
    private var cancellables = Set<AnyCancellable>()
    private var diffRefreshTask: Task<Void, Never>?

    // MARK: - Init

    init(connectionManager: ConnectionManager) {
        self.connectionManager = connectionManager
        let service = EditorService()
        self.service = service
        self.lspBridge = EditorLSPBridge(rpcClient: connectionManager.rpcClient)

        // Re-run the search on every content/query change. Cheap because
        // `findMatches` is just NSRange enumeration over the in-memory string.
        service.$document
            .removeDuplicates(by: { $0.content == $1.content })
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.recomputeFindMatches() }
            .store(in: &cancellables)
    }

    deinit {
        diffRefreshTask?.cancel()
    }

    // MARK: - Lifecycle

    /// Mark the VM ready after a single layout pass — cosmetic state used
    /// to delay find-bar focus under the keyboard transition.
    func markReady() {
        isReady = true
    }

    // MARK: - Loading

    /// Load a desktop-relative path via RPC. Falls back to an in-memory empty
    /// document if `file.get` fails so the view still renders.
    func loadRemote(path: String) async {
        isLoading = true
        defer { isLoading = false }
        remotePath = path
        do {
            let response = try await connectionManager.rpcClient.send("file.get", params: [
                "path": .string(path),
            ])
            let content = response.result?.objectValue?["content"]?.stringValue
                ?? response.result?.stringValue
                ?? ""
            let langId = response.result?.objectValue?["language"]?.stringValue
            service.loadInMemory(
                content: content,
                languageId: langId ?? EditorLanguages.resolve(path: path).id
            )
            errorMessage = nil
            // Kick off a diff fetch in parallel — non-blocking.
            scheduleDiffRefresh()
        } catch {
            logger.error("file.get failed for \(path, privacy: .public): \(error.localizedDescription, privacy: .public)")
            // Honest failure (QB #2): surface the error AND give the user an
            // empty buffer so the editor renders rather than crashing.
            errorMessage = "Couldn't load \(path): \(error.localizedDescription)"
            service.loadInMemory(content: "", languageId: EditorLanguages.resolve(path: path).id)
        }
    }

    /// Load a local file URL (e.g. picked via UIDocumentPickerViewController).
    func loadLocalURL(_ url: URL) {
        do {
            try service.load(url: url)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Load arbitrary in-memory content (e.g. an artifact pasted from chat).
    func loadInMemory(content: String, languageId: String = "plaintext") {
        service.loadInMemory(content: content, languageId: languageId)
        errorMessage = nil
    }

    // MARK: - Saving

    /// Save back to the desktop via RPC if loaded remotely; otherwise to disk.
    func save() async {
        if let path = remotePath {
            await saveRemote(path: path)
        } else {
            do {
                try service.save()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func saveRemote(path: String) async {
        isWritingRemote = true
        defer { isWritingRemote = false }
        do {
            let response = try await connectionManager.rpcClient.send("file.write", params: [
                "path": .string(path),
                "content": .string(service.document.content),
            ])
            let ok = response.result?.objectValue?["ok"]?.boolValue
                ?? response.result?.boolValue
                ?? true
            if !ok {
                errorMessage = "Desktop refused write for \(path)."
                return
            }
            // Mark the in-memory document as saved (clears the dirty flag).
            // We do this via a roundtrip through the service — the local
            // file URL is nil for remote-loaded files, so service.save()
            // would error. Instead reload the same content marked clean.
            service.loadInMemory(
                content: service.document.content,
                languageId: service.language.id
            )
            errorMessage = nil
            scheduleDiffRefresh()
        } catch {
            logger.error("file.write failed for \(path, privacy: .public): \(error.localizedDescription, privacy: .public)")
            errorMessage = "Couldn't save \(path): \(error.localizedDescription)"
        }
    }

    // MARK: - Find / Replace

    /// Recompute the list of match ranges for the current `findQuery`.
    /// O(N) over document length per search; debounced by SwiftUI binding flush.
    func recomputeFindMatches() {
        let text = service.document.content
        guard !findQuery.isEmpty, !text.isEmpty else {
            findMatches = []
            findCurrentIndex = 0
            return
        }
        let options: NSRegularExpression.Options = findIsCaseSensitive ? [] : [.caseInsensitive]
        let pattern: String
        if findIsRegex {
            pattern = findQuery
        } else {
            pattern = NSRegularExpression.escapedPattern(for: findQuery)
        }
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else {
            findMatches = []
            findCurrentIndex = 0
            return
        }
        let nsText = text as NSString
        let range = NSRange(location: 0, length: nsText.length)
        let matches = regex.matches(in: text, options: [], range: range).map { $0.range }
        findMatches = matches
        if findCurrentIndex >= matches.count {
            findCurrentIndex = 0
        }
    }

    /// Step to the next match (wraps).
    func gotoNextMatch() {
        guard !findMatches.isEmpty else { return }
        findCurrentIndex = (findCurrentIndex + 1) % findMatches.count
    }

    /// Step to the previous match (wraps).
    func gotoPreviousMatch() {
        guard !findMatches.isEmpty else { return }
        findCurrentIndex = (findCurrentIndex - 1 + findMatches.count) % findMatches.count
    }

    /// Replace the current match with `replaceText`.
    func replaceCurrent() {
        guard !findMatches.isEmpty,
              findCurrentIndex < findMatches.count else { return }
        let range = findMatches[findCurrentIndex]
        let nsText = service.document.content as NSString
        guard range.location + range.length <= nsText.length else { return }
        let updated = nsText.replacingCharacters(in: range, with: replaceText)
        service.updateContent(updated, caret: range.location)
        recomputeFindMatches()
    }

    /// Replace every match with `replaceText`.
    func replaceAll() {
        guard !findMatches.isEmpty else { return }
        var text = service.document.content
        // Walk in reverse so earlier ranges aren't invalidated.
        for range in findMatches.reversed() {
            let ns = text as NSString
            guard range.location + range.length <= ns.length else { continue }
            text = ns.replacingCharacters(in: range, with: replaceText)
        }
        service.updateContent(text, caret: 0)
        recomputeFindMatches()
    }

    // MARK: - Diff gutter

    /// Schedule a `git.diff` fetch for the current remote path. Coalesces
    /// rapid edits via a 750ms debounce to avoid hammering the daemon.
    func scheduleDiffRefresh() {
        diffRefreshTask?.cancel()
        guard let path = remotePath else {
            diffHunks = []
            return
        }
        let task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 750_000_000)
            guard !Task.isCancelled else { return }
            await self?.fetchDiff(path: path)
        }
        diffRefreshTask = task
    }

    private func fetchDiff(path: String) async {
        do {
            let response = try await connectionManager.rpcClient.send("git.diff", params: [
                "path": .string(path),
            ])
            let hunksRaw = response.result?.objectValue?["hunks"]?.arrayValue ?? []
            let hunks: [EditorDiffHunk] = hunksRaw.compactMap { value in
                guard let obj = value.objectValue else { return nil }
                let kindStr = obj["kind"]?.stringValue ?? "modified"
                let kind = EditorDiffHunk.Kind(rawValue: kindStr) ?? .modified
                let start = obj["startLine"]?.intValue ?? 1
                let end = obj["endLine"]?.intValue ?? start
                return EditorDiffHunk(kind: kind, startLine: start, endLine: end)
            }
            diffHunks = hunks
        } catch {
            // Gutter is non-critical — log but don't surface to user.
            logger.debug("git.diff failed: \(error.localizedDescription, privacy: .public)")
            diffHunks = []
        }
    }

    // MARK: - LSP wiring

    /// Trigger an LSP hover at the given (line, column). Result lands in
    /// `hoverContent` and `showHoverCard` toggles to true on success.
    func requestHover(line: Int, column: Int) {
        guard let path = remotePath else { return }
        Task { [weak self] in
            guard let self else { return }
            let result = await self.lspBridge.hover(path: path, line: line, column: column)
            await MainActor.run {
                if let content = result, !content.isEmpty {
                    self.hoverContent = content
                    self.showHoverCard = true
                } else {
                    self.showHoverCard = false
                }
            }
        }
    }

    /// Trigger an LSP completion request. Populates `completions` and toggles
    /// `showCompletionList` on success.
    func requestCompletion(line: Int, column: Int, prefix: String?) {
        guard let path = remotePath else { return }
        Task { [weak self] in
            guard let self else { return }
            let items = await self.lspBridge.completion(
                path: path,
                line: line,
                column: column,
                prefix: prefix
            )
            await MainActor.run {
                self.completions = items
                self.showCompletionList = !items.isEmpty
            }
        }
    }

    /// Cancel any in-flight LSP request; called on text mutation.
    func cancelLSP() {
        lspBridge.cancelAll()
        showCompletionList = false
        showHoverCard = false
    }

    // MARK: - Toolbar / UI bridges

    /// Hook called by `RunestoneEditorView`'s onAskWotann to send the buffer
    /// back to the chat composer. The actual chat-side wiring lives in
    /// `EditorView` which captures the closure.
    func askWotann(_ document: EditorDocument, sink: ((String) -> Void)?) {
        if let path = remotePath {
            sink?("@file:\(path)")
        } else if let url = document.url {
            sink?("@file:\(url.lastPathComponent)")
        } else {
            sink?(document.content.prefix(200).description)
        }
    }
}

// MARK: - EditorDiffHunk

/// A single diff hunk for the gutter strip. Pure value type.
struct EditorDiffHunk: Equatable, Hashable, Identifiable {
    enum Kind: String, Equatable, Hashable {
        case added
        case removed
        case modified
    }

    let kind: Kind
    /// 1-based start line of the hunk.
    let startLine: Int
    /// 1-based end line (inclusive).
    let endLine: Int

    var id: String { "\(kind.rawValue)-\(startLine)-\(endLine)" }
}

// MARK: - LSPCompletionItem (re-exported from EditorLSPBridge)

// `LSPCompletionItem` is defined in EditorLSPBridge.swift to keep all LSP
// shapes in one place. We only re-export the symbol via `import` proximity
// because the @Published property above references it.
