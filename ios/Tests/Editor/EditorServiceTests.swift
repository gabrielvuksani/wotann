import XCTest
@testable import WOTANNCore

// MARK: - EditorServiceTests
//
// Unit tests for `EditorService` — the per-session editor state container.
// Every test instantiates a **fresh** EditorService to enforce Quality Bar
// #7 (per-session state, NOT module-global). If any test begins relying on
// shared state, the contract is broken.

@MainActor
final class EditorServiceTests: XCTestCase {

    // MARK: - Helpers

    /// Write a temp file, return its URL. The XCTestCase auto-cleans the
    /// temp dir after the class tears down.
    private func tempFile(_ name: String, contents: String) throws -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("wotann-editor-tests", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name)
        try contents.write(to: url, atomically: true, encoding: .utf8)
        return url
    }

    // MARK: - Per-session state (QB #7)

    func test_twoServices_areIndependent_noSharedState() {
        let a = EditorService()
        let b = EditorService()
        a.loadInMemory(content: "hello-a", languageId: "swift")
        b.loadInMemory(content: "hello-b", languageId: "typescript")
        XCTAssertEqual(a.document.content, "hello-a")
        XCTAssertEqual(b.document.content, "hello-b")
        XCTAssertEqual(a.language.id, "swift")
        XCTAssertEqual(b.language.id, "typescript")
        XCTAssertNotEqual(a.document, b.document, "Services must never share document state")
    }

    // MARK: - Load / save round-trip

    func test_load_resolvesLanguageFromExtension() throws {
        let service = EditorService()
        let url = try tempFile("demo.ts", contents: "const x = 1;\n")
        try service.load(url: url)
        XCTAssertEqual(service.language.id, "typescript")
        XCTAssertEqual(service.document.content, "const x = 1;\n")
        XCTAssertFalse(service.document.isDirty)
    }

    func test_load_unknownExtension_fallsBackToPlainText() throws {
        let service = EditorService()
        let url = try tempFile("mystery.weirdext", contents: "abc")
        try service.load(url: url)
        XCTAssertEqual(service.language.id, "plaintext")
    }

    func test_save_writesContentBackToDisk() throws {
        let service = EditorService()
        let url = try tempFile("note.md", contents: "# before")
        try service.load(url: url)
        service.updateContent("# after")
        _ = try service.save()
        let read = try String(contentsOf: url, encoding: .utf8)
        XCTAssertEqual(read, "# after")
        XCTAssertFalse(service.document.isDirty)
    }

    func test_save_withoutLoadedDocument_throws() {
        let service = EditorService()
        XCTAssertThrowsError(try service.save()) { err in
            XCTAssertEqual(err as? EditorError, .notLoaded)
        }
    }

    // MARK: - Undo / redo

    func test_updateContent_pushesUndo_undoRestores_redoRestores() {
        let service = EditorService()
        service.loadInMemory(content: "v1")
        service.updateContent("v2")
        service.updateContent("v3")
        XCTAssertEqual(service.document.content, "v3")
        XCTAssertEqual(service.undoStack.count, 2)

        XCTAssertEqual(service.undo(), "v2")
        XCTAssertEqual(service.document.content, "v2")
        XCTAssertEqual(service.undo(), "v1")
        XCTAssertEqual(service.document.content, "v1")

        XCTAssertEqual(service.redo(), "v2")
        XCTAssertEqual(service.document.content, "v2")
    }

    func test_undo_onEmptyStack_returnsNil() {
        let service = EditorService()
        service.loadInMemory(content: "x")
        XCTAssertNil(service.undo())
    }

    func test_undoStack_cappedAtMaxDepth() {
        let service = EditorService(maxUndoDepth: 3)
        service.loadInMemory(content: "0")
        service.updateContent("1")
        service.updateContent("2")
        service.updateContent("3")
        service.updateContent("4")
        XCTAssertLessThanOrEqual(service.undoStack.count, 3, "undo stack must respect maxUndoDepth")
    }

    // MARK: - Theme / language switching

    func test_setThemeMode_updatesBackgroundColor() {
        let service = EditorService()
        service.setThemeMode(.light)
        XCTAssertEqual(service.theme.mode, .light)
        service.setThemeMode(.dark)
        XCTAssertEqual(service.theme.mode, .dark)
    }

    func test_setLanguage_unknownIdIsIgnored() {
        let service = EditorService()
        service.loadInMemory(content: "", languageId: "swift")
        service.setLanguage(id: "does-not-exist")
        XCTAssertEqual(service.language.id, "swift", "Unknown language ids must be a no-op, not a fallback")
    }

    // MARK: - Caret tracking

    func test_updateCaret_clampsToMinimumOne() {
        let service = EditorService()
        service.updateCaret(line: -5, column: -10)
        XCTAssertEqual(service.caretLine, 1)
        XCTAssertEqual(service.caretColumn, 1)
    }

    // MARK: - Error surface

    func test_load_nonexistentFile_surfacesError() {
        let service = EditorService()
        let url = URL(fileURLWithPath: "/tmp/definitely-does-not-exist-\(UUID().uuidString).txt")
        XCTAssertThrowsError(try service.load(url: url))
        XCTAssertNotNil(service.lastError)
    }
}
