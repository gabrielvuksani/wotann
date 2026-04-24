import Foundation
import Combine
import UIKit
import os.log

// MARK: - EditorService
//
// Per-session, ObservableObject-based editor state. Owns the full lifecycle
// of a single editing session: the document on disk, in-memory content,
// undo stack, language, theme, autosave debounce timer.
//
// QUALITY BAR #7 (per-session state, NOT module-global):
// Every call site that opens an editor constructs a **fresh** EditorService
// via `EditorService()`. There is deliberately NO `.shared` singleton on
// this class. Two concurrently-open editor sheets must each hold their own
// instance — otherwise an unrelated document's autosave would clobber
// another. Violations of this rule cascade into hard-to-reproduce data loss.
//
// If you think you want a singleton here, read QB #7 in MEMORY.md first.

// MARK: - EditorDocument (immutable snapshot)

struct EditorDocument: Equatable {
    let url: URL?
    let content: String
    let languageId: String      // `EditorLanguages.resolve(id:)` key
    let isDirty: Bool
    let lineCount: Int
    let modifiedAt: Date

    static let empty = EditorDocument(
        url:        nil,
        content:    "",
        languageId: "plaintext",
        isDirty:    false,
        lineCount:  1,
        modifiedAt: Date(timeIntervalSince1970: 0)
    )

    /// Return a new snapshot with `newContent`; recomputes lineCount & dirty.
    func withContent(_ newContent: String) -> EditorDocument {
        EditorDocument(
            url:        url,
            content:    newContent,
            languageId: languageId,
            isDirty:    newContent != content || isDirty,
            lineCount:  max(1, newContent.components(separatedBy: "\n").count),
            modifiedAt: Date()
        )
    }

    func withLanguage(_ newId: String) -> EditorDocument {
        EditorDocument(
            url: url, content: content, languageId: newId,
            isDirty: isDirty, lineCount: lineCount, modifiedAt: modifiedAt
        )
    }

    func markSaved() -> EditorDocument {
        EditorDocument(
            url: url, content: content, languageId: languageId,
            isDirty: false, lineCount: lineCount, modifiedAt: modifiedAt
        )
    }
}

// MARK: - EditorUndoEntry

/// A single undo entry — full document snapshot. Runestone's built-in undo
/// is also in play for fine-grained typing; this coarser stack survives
/// `load(url:)` swaps and is what "Undo last AI edit" hangs off of.
struct EditorUndoEntry: Equatable {
    let snapshot: String
    let caretLocation: Int
    let timestamp: Date
}

// MARK: - EditorError

enum EditorError: Error, LocalizedError, Equatable {
    case readFailed(path: String, reason: String)
    case writeFailed(path: String, reason: String)
    case notLoaded
    case encodingUnsupported(path: String)

    var errorDescription: String? {
        switch self {
        case .readFailed(let p, let r):       return "Failed to open \(p): \(r)"
        case .writeFailed(let p, let r):      return "Failed to save \(p): \(r)"
        case .notLoaded:                      return "No document is currently loaded."
        case .encodingUnsupported(let p):     return "Unsupported text encoding in \(p)."
        }
    }
}

// MARK: - EditorService

@MainActor
final class EditorService: ObservableObject {

    // MARK: - Session-scoped state (NEVER module-global)

    @Published private(set) var document: EditorDocument = .empty
    @Published private(set) var language: EditorLanguage = .plainText
    @Published private(set) var theme: EditorTheme = EditorThemes.dark
    @Published private(set) var themeMode: EditorThemeMode = .system
    @Published private(set) var undoStack: [EditorUndoEntry] = []
    @Published private(set) var redoStack: [EditorUndoEntry] = []
    @Published private(set) var lastError: EditorError?
    @Published private(set) var isSaving: Bool = false
    @Published private(set) var caretLine: Int = 1
    @Published private(set) var caretColumn: Int = 1

    // MARK: - Debounced autosave
    //
    // A per-session DispatchWorkItem — cancelled and re-scheduled on every
    // keystroke so the write only happens `autosaveDebounce` seconds after
    // typing stops. Per-session ownership means two concurrent editor
    // sessions don't share (or cancel) each other's autosave timers.

    private var autosaveWorkItem: DispatchWorkItem?
    private let autosaveDebounce: TimeInterval
    private let maxUndoDepth: Int
    private let fileManager: FileManager
    private let logger = Logger(subsystem: "com.wotann.ios", category: "EditorService")

    // MARK: - Init

    init(
        autosaveDebounce: TimeInterval = 1.5,
        maxUndoDepth: Int = 64,
        fileManager: FileManager = .default
    ) {
        self.autosaveDebounce = autosaveDebounce
        self.maxUndoDepth = maxUndoDepth
        self.fileManager = fileManager
    }

    deinit {
        // Cancel any pending autosave when the session tears down so we
        // don't keep a write alive past view dismissal.
        autosaveWorkItem?.cancel()
    }

    // MARK: - Load / save

    /// Load a document from disk. Resolves the language from the path and
    /// resets undo/redo — undo history is per-document, not per-service.
    func load(url: URL) throws {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            let err = EditorError.readFailed(path: url.path, reason: error.localizedDescription)
            lastError = err
            logger.error("load(url:) failed — \(err.localizedDescription, privacy: .public)")
            throw err
        }
        guard let content = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
            let err = EditorError.encodingUnsupported(path: url.path)
            lastError = err
            throw err
        }
        let resolved = EditorLanguages.resolve(path: url.path)
        language = resolved
        document = EditorDocument(
            url:        url,
            content:    content,
            languageId: resolved.id,
            isDirty:    false,
            lineCount:  max(1, content.components(separatedBy: "\n").count),
            modifiedAt: Date()
        )
        undoStack.removeAll()
        redoStack.removeAll()
        lastError = nil
    }

    /// Load from an in-memory string (e.g. a ChatView artifact). No URL.
    func loadInMemory(content: String, languageId: String = "plaintext") {
        let resolved = EditorLanguages.resolve(id: languageId) ?? .plainText
        language = resolved
        document = EditorDocument(
            url:        nil,
            content:    content,
            languageId: resolved.id,
            isDirty:    false,
            lineCount:  max(1, content.components(separatedBy: "\n").count),
            modifiedAt: Date()
        )
        undoStack.removeAll()
        redoStack.removeAll()
        lastError = nil
    }

    /// Synchronous save — use `scheduleAutosave` for typing-triggered writes.
    @discardableResult
    func save() throws -> EditorDocument {
        guard let url = document.url else {
            throw EditorError.notLoaded
        }
        isSaving = true
        defer { isSaving = false }
        do {
            try document.content.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            let err = EditorError.writeFailed(path: url.path, reason: error.localizedDescription)
            lastError = err
            throw err
        }
        document = document.markSaved()
        autosaveWorkItem?.cancel()
        return document
    }

    // MARK: - Content updates (the hot path)

    /// Replace the in-memory content. Schedules an autosave and grows undo.
    /// Called from `RunestoneEditorView`'s delegate on every `textViewDidChange`.
    func updateContent(_ newContent: String, caret: Int = 0) {
        // Snapshot BEFORE the change for undo — match Xcode's behaviour.
        if document.content != newContent {
            pushUndo(snapshot: document.content, caret: caret)
        }
        document = document.withContent(newContent)
        scheduleAutosave()
    }

    func setLanguage(id: String) {
        guard let resolved = EditorLanguages.resolve(id: id) else { return }
        language = resolved
        document = document.withLanguage(resolved.id)
    }

    func setThemeMode(_ mode: EditorThemeMode, traits: UITraitCollection = .current) {
        themeMode = mode
        theme = EditorThemes.resolve(mode, traits: traits)
    }

    func updateCaret(line: Int, column: Int) {
        caretLine   = max(1, line)
        caretColumn = max(1, column)
    }

    // MARK: - Undo / redo

    private func pushUndo(snapshot: String, caret: Int) {
        redoStack.removeAll()
        undoStack.append(EditorUndoEntry(snapshot: snapshot, caretLocation: caret, timestamp: Date()))
        // Trim to maxUndoDepth — drop oldest entries.
        if undoStack.count > maxUndoDepth {
            undoStack.removeFirst(undoStack.count - maxUndoDepth)
        }
    }

    @discardableResult
    func undo() -> String? {
        guard let last = undoStack.popLast() else { return nil }
        redoStack.append(EditorUndoEntry(
            snapshot: document.content,
            caretLocation: last.caretLocation,
            timestamp: Date()
        ))
        document = document.withContent(last.snapshot)
        return last.snapshot
    }

    @discardableResult
    func redo() -> String? {
        guard let next = redoStack.popLast() else { return nil }
        undoStack.append(EditorUndoEntry(
            snapshot: document.content,
            caretLocation: next.caretLocation,
            timestamp: Date()
        ))
        document = document.withContent(next.snapshot)
        return next.snapshot
    }

    // MARK: - Debounced autosave

    /// Cancel any in-flight autosave and schedule a fresh one
    /// `autosaveDebounce` seconds from now. Only fires when the document
    /// has a URL (we never silently create files).
    private func scheduleAutosave() {
        autosaveWorkItem?.cancel()
        guard document.url != nil, document.isDirty else { return }
        let work = DispatchWorkItem { [weak self] in
            Task { @MainActor [weak self] in
                guard let self else { return }
                do {
                    try self.save()
                } catch {
                    self.logger.error("Autosave failed — \(error.localizedDescription, privacy: .public)")
                }
            }
        }
        autosaveWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + autosaveDebounce, execute: work)
    }

    /// Flush any pending autosave synchronously — used by view `onDisappear`.
    func flushPendingAutosave() {
        guard let work = autosaveWorkItem, !work.isCancelled else { return }
        work.cancel()
        do {
            try save()
        } catch {
            logger.error("Flush autosave failed — \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Debug helpers (test-only surface)

    #if DEBUG
    /// Expose the current pending autosave for tests. Never call from UI.
    var hasPendingAutosave: Bool { autosaveWorkItem != nil && !(autosaveWorkItem?.isCancelled ?? true) }
    #endif
}
