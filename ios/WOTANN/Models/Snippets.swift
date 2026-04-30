import Foundation

// MARK: - Snippet Model
//
// Round 8: cross-surface prompt library. Mirrors src/snippets/
// snippet-store.ts. Stored on the desktop daemon's SQLite so a
// snippet authored on phone shows up on desktop and vice versa.
//
// `variables` is server-derived from the body via the daemon's
// `extractVariables()` helper and tells the UI which form fields
// to render in a "use snippet" dialog.

struct Snippet: Identifiable, Equatable, Hashable {
    let id: String
    let title: String
    let body: String
    let category: String?
    let tags: [String]
    let isFavorite: Bool
    let useCount: Int
    /// Unix-ms; nil when never used.
    let lastUsedAt: Int64?
    let createdAt: Int64
    let updatedAt: Int64
    /// Distinct {{var}} placeholders extracted from `body`.
    let variables: [String]

    /// Convenience: a short single-line preview suitable for list rows.
    /// Strips line breaks and clamps to ~120 chars so the list view
    /// stays scannable for users who paste multi-paragraph prompts.
    var preview: String {
        let single = body.replacingOccurrences(of: "\n", with: " ")
        if single.count <= 120 { return single }
        return String(single.prefix(120)) + "…"
    }

    /// Convenience: ISO-8601-style "1d ago" / "3h ago" / "just now"
    /// rendering of `lastUsedAt`. Returns "Unused" when nil.
    var lastUsedRelative: String {
        guard let lastUsedAt else { return "Unused" }
        let then = Date(timeIntervalSince1970: TimeInterval(lastUsedAt) / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: then, relativeTo: Date())
    }
}

/// Result envelope from `snippet.use` — the rendered prompt plus
/// any unfilled variables, so the UI can show a warning toast
/// instead of silently shipping a half-rendered prompt.
struct SnippetRenderOutcome: Equatable {
    let rendered: String
    let missingVars: [String]
    let snippet: Snippet
}
