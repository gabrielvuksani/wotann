import SwiftUI

// MARK: - EditorHoverCard
//
// Popover-style card that renders an LSP hover response. The desktop daemon
// returns markdown (per the LSP spec); we render it via SwiftUI's native
// `Text(markdown:)` so links, inline code, and bold all show correctly.
//
//   ┌──────────────────────────────────────┐
//   │ func makeRequest(url: URL) -> ...    │
//   │                                      │
//   │ Returns a configured URLRequest      │
//   │ for the supplied URL.                │
//   └──────────────────────────────────────┘
//
// Sized to fit without overflowing on iPhone Mini (320pt). Caller manages
// presentation (popover, sheet, or inline anchor) — the card itself is just
// content.

struct EditorHoverCard: View {

    /// Markdown body returned by the language server.
    let content: String

    /// Optional dismiss callback for the close button.
    var onDismiss: (() -> Void)?

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack {
                Image(systemName: "info.circle.fill")
                    .foregroundColor(WTheme.Colors.primary)
                Text("Hover")
                    .font(.wotannScaled(size: 12, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textSecondary)
                Spacer()
                if let onDismiss {
                    Button {
                        onDismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.wotannScaled(size: 14))
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                    .accessibilityLabel("Close hover")
                }
            }
            Divider()
                .background(WTheme.Colors.border.opacity(0.4))

            ScrollView {
                renderedMarkdown
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 280)
        }
        .padding(WTheme.Spacing.sm)
        .frame(width: 320)
        .background(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .strokeBorder(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .shadow(color: WTheme.Shadow.lg.color, radius: WTheme.Shadow.lg.radius, x: WTheme.Shadow.lg.x, y: WTheme.Shadow.lg.y)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("LSP hover information")
    }

    // MARK: - Markdown rendering

    /// Convert `content` to a SwiftUI Text via AttributedString. iOS 18 has
    /// excellent inline-markdown support (`init(markdown:)`); fenced code
    /// blocks gracefully fall through to monospaced text.
    private var renderedMarkdown: some View {
        let attributed = parseMarkdown(content)
        return Text(attributed)
            .font(.wotannScaled(size: 13, design: .monospaced))
            .foregroundColor(WTheme.Colors.textPrimary)
            .textSelection(.enabled)
            .multilineTextAlignment(.leading)
    }

    private func parseMarkdown(_ raw: String) -> AttributedString {
        // First try the full markdown parser. If the response isn't valid
        // markdown (rare but possible), fall back to a plain string.
        do {
            return try AttributedString(
                markdown: raw,
                options: AttributedString.MarkdownParsingOptions(
                    interpretedSyntax: .inlineOnlyPreservingWhitespace
                )
            )
        } catch {
            return AttributedString(raw)
        }
    }
}

#if DEBUG
#Preview {
    EditorHoverCard(
        content: """
        **`func makeRequest(url: URL) -> URLRequest`**

        Returns a configured `URLRequest` for the supplied URL.
        Includes the auth token header when one is set.
        """,
        onDismiss: { }
    )
    .preferredColorScheme(.dark)
    .padding()
    .background(Color.black)
}
#endif
