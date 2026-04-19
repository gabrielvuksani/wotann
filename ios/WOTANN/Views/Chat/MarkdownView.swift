import SwiftUI

// MARK: - MarkdownView

/// Renders markdown text with support for bold, italic, code, links, lists, and fenced code blocks.
///
/// Splits on triple-backtick fences so code blocks render via `CodeBlockView`
/// while inline markdown uses `AttributedString`. The parsed `AttributedString`
/// for each inline segment is cached via `MarkdownCache` so scrolling through a
/// long conversation does not re-parse every row on each SwiftUI redraw.
///
/// Implementation notes:
/// - No `AnyView` wrappers (S4-23). Every branch resolves to a concrete
///   `some View` type so SwiftUI preserves view identity and diffing.
/// - Parsing is keyed on the stable input hash, so repeated renders of the
///   same message body hit the cache regardless of the string's address.
struct MarkdownView: View {
    let text: String

    var body: some View {
        let segments = Self.splitSegments(text)

        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            ForEach(segments) { segment in
                MarkdownSegmentView(segment: segment)
            }
        }
    }

    /// Split the raw text on triple-backtick fences into a sequence of typed
    /// segments. Non-empty inline segments and code blocks are kept; empty
    /// whitespace-only inline segments are dropped so we don't render blank
    /// VStack rows.
    static func splitSegments(_ text: String) -> [MarkdownSegment] {
        let parts = text.components(separatedBy: "```")
        var out: [MarkdownSegment] = []
        out.reserveCapacity(parts.count)

        for (index, part) in parts.enumerated() {
            if index % 2 == 1 {
                // Odd segments are code blocks.
                out.append(MarkdownSegment(kind: .code, raw: part))
            } else if !part.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                out.append(MarkdownSegment(kind: .inline, raw: part))
            }
        }
        return out
    }
}

// MARK: - MarkdownSegment

/// A typed slice of the source text. `Identifiable` via a stable hash of the
/// raw contents so `ForEach` can diff segments correctly without relying on
/// enumeration offsets (which change every time the input changes).
struct MarkdownSegment: Identifiable, Hashable {
    enum Kind: Hashable {
        case inline
        case code
    }

    let kind: Kind
    let raw: String

    var id: Int { Self.stableHash(kind: kind, raw: raw) }

    /// Deterministic hash combining kind and raw text. Uses `Hasher` so the
    /// value is stable within a process lifetime.
    private static func stableHash(kind: Kind, raw: String) -> Int {
        var hasher = Hasher()
        hasher.combine(kind)
        hasher.combine(raw)
        return hasher.finalize()
    }
}

// MARK: - MarkdownSegmentView

/// Concrete-typed view for a single markdown segment. Returns a resolved
/// `some View` in every branch (no `AnyView`) so SwiftUI diffing is preserved.
private struct MarkdownSegmentView: View {
    let segment: MarkdownSegment

    var body: some View {
        switch segment.kind {
        case .code:
            codeBlock
        case .inline:
            inlineBody
        }
    }

    // MARK: Code Block

    /// Extract an optional language hint from the first line of a code fence.
    @ViewBuilder
    private var codeBlock: some View {
        let raw = segment.raw
        let lines = raw.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        let firstLine = lines.first.map(String.init)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hasLanguage = !firstLine.isEmpty && !firstLine.contains(" ")
        let language = hasLanguage ? firstLine : nil
        let code: String = {
            if hasLanguage, lines.count > 1 {
                return String(lines[1]).trimmingCharacters(in: .newlines)
            } else {
                return raw.trimmingCharacters(in: .newlines)
            }
        }()
        CodeBlockView(code: code, language: language)
    }

    // MARK: Inline Body

    /// Renders inline markdown. Looks up a cached `AttributedString` first;
    /// falls back to a plain `Text` view if the parser could not produce one.
    /// Both branches share the same `Font` / `foregroundColor` / selection
    /// modifiers so the rendered output only differs in attribution, and
    /// SwiftUI's view identity is stable between them because both return
    /// `Text`.
    @ViewBuilder
    private var inlineBody: some View {
        let trimmed = segment.raw.trimmingCharacters(in: .newlines)
        if let attributed = MarkdownCache.shared.attributedString(for: trimmed) {
            Text(attributed)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
                .textSelection(.enabled)
                .tint(WTheme.Colors.primary)
        } else {
            Text(trimmed)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
                .textSelection(.enabled)
        }
    }
}

// MARK: - MarkdownCache

/// Thread-safe LRU-ish cache for parsed `AttributedString` values. Keyed on
/// the stable `Hasher`-derived hash of the input, so the cache survives
/// string mutations as long as the final content is equal. Eviction is
/// simple count-based (oldest-first) which is sufficient for chat-scrolling
/// workloads where the working set is usually the visible viewport.
final class MarkdownCache: @unchecked Sendable {
    static let shared = MarkdownCache()

    /// Upper bound on cached entries. Chosen so a long conversation fits
    /// comfortably in memory (~150 messages × ~4 segments = 600 entries).
    private static let maxEntries = 512

    private let queue = DispatchQueue(label: "com.wotann.MarkdownCache", attributes: .concurrent)
    private var storage: [Int: AttributedString] = [:]
    private var insertionOrder: [Int] = []

    private init() {}

    /// Return the parsed AttributedString for `text`, parsing on miss. Returns
    /// `nil` if the markdown parser cannot produce anything at all (empty input
    /// after trimming or unrecoverable parse failure).
    func attributedString(for text: String) -> AttributedString? {
        let key = Self.hash(text)

        // Fast path: concurrent read.
        if let cached = queue.sync(execute: { storage[key] }) {
            return cached
        }

        // Parse outside the barrier so we don't serialize all parse work on
        // the cache queue.
        guard let parsed = Self.parse(text) else { return nil }

        queue.async(flags: .barrier) { [weak self] in
            guard let self else { return }
            // Double-check — another writer may have populated while we parsed.
            if self.storage[key] == nil {
                self.storage[key] = parsed
                self.insertionOrder.append(key)
                // Evict oldest entries beyond the capacity bound.
                while self.insertionOrder.count > Self.maxEntries {
                    let evict = self.insertionOrder.removeFirst()
                    self.storage.removeValue(forKey: evict)
                }
            }
        }

        return parsed
    }

    /// Drop every cached entry. Provided for memory pressure hooks and tests.
    func clear() {
        queue.async(flags: .barrier) { [weak self] in
            self?.storage.removeAll()
            self?.insertionOrder.removeAll()
        }
    }

    // MARK: Parsing

    private static func parse(_ text: String) -> AttributedString? {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: true,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        return try? AttributedString(markdown: text, options: options)
    }

    private static func hash(_ text: String) -> Int {
        var hasher = Hasher()
        hasher.combine(text)
        return hasher.finalize()
    }
}

// MARK: - InlineCode

/// Renders a short inline code snippet.
struct InlineCode: View {
    let text: String

    var body: some View {
        Text(text)
            .font(WTheme.Typography.codeSmall)
            .foregroundColor(WTheme.Colors.primary)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(WTheme.Colors.primary.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

#Preview {
    VStack(alignment: .leading, spacing: 16) {
        MarkdownView(text: "Hello **bold** and *italic* text.")
        MarkdownView(text: "Visit [wotann.com](https://wotann.com) for more info.")
        MarkdownView(text: "Use `wotann link` to pair devices.")
        InlineCode(text: "swift build")
    }
    .padding()
    .background(WTheme.Colors.background)
    .preferredColorScheme(.dark)
}
