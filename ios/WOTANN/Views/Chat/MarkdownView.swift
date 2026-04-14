import SwiftUI

// MARK: - MarkdownView

/// Renders markdown text with support for bold, italic, code, links, lists, and fenced code blocks.
/// Splits on triple-backtick fences so code blocks render via CodeBlockView
/// while inline markdown uses AttributedString.
struct MarkdownView: View {
    let text: String

    var body: some View {
        let segments = text.components(separatedBy: "```")

        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            ForEach(Array(segments.enumerated()), id: \.offset) { index, segment in
                if index % 2 == 1 {
                    // Odd segments are code blocks
                    codeBlock(from: segment)
                } else if !segment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    // Even segments are regular markdown
                    inlineMarkdown(segment)
                }
            }
        }
    }

    /// Parses a code fence segment, extracting an optional language hint from the first line.
    private func codeBlock(from raw: String) -> some View {
        let lines = raw.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
        let firstLine = lines.first.map(String.init)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let hasLanguage = !firstLine.isEmpty && !firstLine.contains(" ")
        let language = hasLanguage ? firstLine : nil
        let code: String
        if hasLanguage, lines.count > 1 {
            code = String(lines[1]).trimmingCharacters(in: .newlines)
        } else {
            code = raw.trimmingCharacters(in: .newlines)
        }
        return CodeBlockView(code: code, language: language)
    }

    /// Renders inline markdown (bold, italic, links, inline code) via AttributedString.
    private func inlineMarkdown(_ segment: String) -> some View {
        let trimmed = segment.trimmingCharacters(in: .newlines)
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: true,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        if let attributed = try? AttributedString(markdown: trimmed, options: options) {
            return AnyView(
                Text(attributed)
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .textSelection(.enabled)
                    .tint(WTheme.Colors.primary)
            )
        } else {
            return AnyView(
                Text(trimmed)
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .textSelection(.enabled)
            )
        }
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
