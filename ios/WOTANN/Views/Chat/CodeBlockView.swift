import SwiftUI

// MARK: - CodeBlockView

/// Phase C code block. Header row exposes the language badge (left) plus
/// a copy button with haptic feedback (right). Tapping anywhere inside
/// the body copies the snippet. Long-press opens a context menu with
/// Copy / Share / Open in editor options.
struct CodeBlockView: View {
    let code: String
    var language: String?
    var title: String?
    @State private var isCopied = false
    @State private var showShare = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            body_
        }
        .background(
            RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                .strokeBorder(WTheme.Colors.border.opacity(0.6), lineWidth: 0.5)
        )
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))
        .contextMenu {
            Button {
                copy()
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
            Button {
                showShare = true
            } label: {
                Label("Share", systemImage: "square.and.arrow.up")
            }
        }
        .sheet(isPresented: $showShare) {
            ShareSheet(activityItems: [code])
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            if let language, !language.isEmpty {
                Text(language.uppercased())
                    .font(.wotannScaled(size: 9, weight: .bold, design: .monospaced))
                    .tracking(0.5)
                    .foregroundColor(WTheme.Colors.primary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(
                        Capsule(style: .continuous)
                            .fill(WTheme.Colors.primary.opacity(0.12))
                    )
            } else if let title {
                Text(title)
                    .font(.wotannScaled(size: 11, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            Spacer()

            Button {
                copy()
            } label: {
                HStack(spacing: 3) {
                    Image(systemName: isCopied ? "checkmark" : "doc.on.doc")
                        .font(.wotannScaled(size: 10, weight: .semibold))
                    Text(isCopied ? "Copied" : "Copy")
                        .font(.wotannScaled(size: 10, weight: .semibold, design: .rounded))
                }
                .foregroundColor(isCopied ? WTheme.Colors.success : WTheme.Colors.textSecondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    Capsule(style: .continuous)
                        .fill(WTheme.Colors.surfaceAlt.opacity(0.4))
                )
            }
            .accessibilityLabel(isCopied ? "Code copied" : "Copy code")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(WTheme.Colors.surfaceAlt.opacity(0.35))
    }

    // MARK: - Body

    private var body_: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(highlightedCode)
                .font(WTheme.Typography.code)
                .textSelection(.enabled)
                .padding(WTheme.Spacing.sm)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            copy()
        }
    }

    // MARK: - Actions

    private func copy() {
        UIPasteboard.general.string = code
        withAnimation(WTheme.Animation.quick) {
            isCopied = true
        }
        Haptics.shared.buttonTap()
        HapticService.shared.trigger(.buttonTap)
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation(WTheme.Animation.quick) {
                isCopied = false
            }
        }
    }

    // MARK: - Syntax Highlighting

    /// Regex-based syntax highlighting for common code patterns.
    /// Applies keyword, string, comment, and number coloring via AttributedString.
    private var highlightedCode: AttributedString {
        var result = AttributedString(code)
        result.foregroundColor = UIColor(WTheme.Colors.textPrimary)

        let fullNS = NSRange(code.startIndex..., in: code)

        // Comments (// to end of line)
        if let commentRegex = try? NSRegularExpression(pattern: "//.*$", options: .anchorsMatchLines) {
            for match in commentRegex.matches(in: code, range: fullNS) {
                if let range = Range(match.range, in: code),
                   let attrRange = Range(range, in: result) {
                    result[attrRange].foregroundColor = UIColor(WTheme.Colors.textTertiary)
                }
            }
        }

        // Strings
        if let stringRegex = try? NSRegularExpression(pattern: #"("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')"#) {
            for match in stringRegex.matches(in: code, range: fullNS) {
                if let range = Range(match.range, in: code),
                   let attrRange = Range(range, in: result) {
                    result[attrRange].foregroundColor = UIColor(WTheme.Colors.success)
                }
            }
        }

        // Numbers
        if let numberRegex = try? NSRegularExpression(pattern: #"(?<![a-zA-Z_])\b\d+(\.\d+)?\b"#) {
            for match in numberRegex.matches(in: code, range: fullNS) {
                if let range = Range(match.range, in: code),
                   let attrRange = Range(range, in: result) {
                    result[attrRange].foregroundColor = UIColor(Color.wotannCyan)
                }
            }
        }

        // Keywords
        let keywords = [
            "func", "var", "let", "const", "import", "return", "if", "else", "for",
            "class", "struct", "enum", "protocol", "extension", "while", "switch",
            "case", "break", "continue", "default", "guard", "self", "Self",
            "async", "await", "try", "catch", "throw", "throws", "true", "false",
            "nil", "null", "undefined", "def", "fn", "pub", "mut", "impl", "trait",
            "type", "interface", "export", "from", "in", "of", "new", "static",
            "private", "public", "protected", "final", "override", "where",
        ]
        let keywordPattern = "\\b(" + keywords.joined(separator: "|") + ")\\b"
        if let keywordRegex = try? NSRegularExpression(pattern: keywordPattern) {
            for match in keywordRegex.matches(in: code, range: fullNS) {
                if let range = Range(match.range, in: code),
                   let attrRange = Range(range, in: result) {
                    result[attrRange].foregroundColor = UIColor(WTheme.Colors.syntaxKeyword)
                }
            }
        }

        return result
    }
}

// MARK: - ShareSheet

/// Minimal UIActivityViewController wrapper for sharing code or artifact text.
struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    var applicationActivities: [UIActivity]? = nil

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(
            activityItems: activityItems,
            applicationActivities: applicationActivities
        )
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

#Preview {
    CodeBlockView(
        code: """
        func hello() {
            print("Hello, WOTANN!")
        }
        """,
        language: "swift",
        title: "Example"
    )
    .padding()
    .background(Color.black)
    .preferredColorScheme(.dark)
}
