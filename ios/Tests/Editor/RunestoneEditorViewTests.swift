import XCTest
import SwiftUI
@testable import WOTANNCore

// MARK: - RunestoneEditorViewTests
//
// Structural smoke tests for `RunestoneEditorView` and the editor registry.
// These tests avoid instantiating Runestone's UIKit TextView (which needs
// a hosted view hierarchy and a real runtime) and instead exercise the
// pieces of the editor that are pure value-types + deterministic lookups.
//
// Deeper rendering assertions live in the `SmokeTests` UI-test target so
// the unit tests can stay hermetic and fast.

@MainActor
final class RunestoneEditorViewTests: XCTestCase {

    // MARK: - Language registry invariants

    func test_languageRegistry_hasAtLeast36Entries() {
        XCTAssertGreaterThanOrEqual(
            EditorLanguages.all.count, 36,
            "Tier 13 spec requires 36+ language packs"
        )
    }

    func test_languageRegistry_idsAreUnique() {
        let ids = EditorLanguages.all.map(\.id)
        XCTAssertEqual(ids.count, Set(ids).count, "Every language id must be unique")
    }

    func test_languageRegistry_resolvesCommonExtensions() {
        XCTAssertEqual(EditorLanguages.resolve(path: "foo/bar.ts").id, "typescript")
        XCTAssertEqual(EditorLanguages.resolve(path: "Main.swift").id, "swift")
        XCTAssertEqual(EditorLanguages.resolve(path: "script.py").id, "python")
        XCTAssertEqual(EditorLanguages.resolve(path: "app.js").id, "javascript")
        XCTAssertEqual(EditorLanguages.resolve(path: "data.json").id, "json")
    }

    func test_languageRegistry_resolvesFilenamesWithoutExtension() {
        XCTAssertEqual(EditorLanguages.resolve(path: "path/Dockerfile").id, "dockerfile")
        XCTAssertEqual(EditorLanguages.resolve(path: "Makefile").id, "makefile")
    }

    func test_languageRegistry_unknownPathFallsBackToPlainText() {
        XCTAssertEqual(EditorLanguages.resolve(path: "notes.weirdext").id, "plaintext")
        XCTAssertEqual(EditorLanguages.resolve(path: "no-extension").id, "plaintext")
    }

    // MARK: - Theme shape

    func test_themes_haveDistinctBackgrounds() {
        XCTAssertNotEqual(EditorThemes.light.backgroundColor, EditorThemes.dark.backgroundColor)
    }

    func test_themes_coverEverySyntaxColorKind() {
        for kind in EditorColorKind.allCases {
            XCTAssertNotNil(EditorThemes.light.syntaxColors[kind], "light missing \(kind)")
            XCTAssertNotNil(EditorThemes.dark.syntaxColors[kind], "dark missing \(kind)")
        }
    }

    // MARK: - View construction

    func test_runestoneEditorView_initialises_withFreshService() {
        // Smoke: the view must accept an injected @ObservedObject. If this
        // ever requires a @StateObject we've silently broken QB #7.
        let service = EditorService()
        service.loadInMemory(content: "print('hi')", languageId: "python")
        let view = RunestoneEditorView(service: service)
        XCTAssertNotNil(view.body)
    }
}
