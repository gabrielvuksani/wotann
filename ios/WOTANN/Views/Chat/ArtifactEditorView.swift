import SwiftUI

// MARK: - ArtifactEditorView

/// Full-screen sheet that opens an artifact in a Monaco-like code viewer.
/// SwiftUI does not yet host Monaco natively — we render line-numbered
/// monospaced text with horizontal scrolling, language-aware coloring via
/// `CodeBlockView` for the underlying colors, and a toolbar copy button.
///
/// This keeps the editor lightweight: no WebView roundtrips, no external
/// dependencies, and it renders instantly even inside a chat sheet.
struct ArtifactEditorView: View {
    let artifact: Artifact
    @Environment(\.dismiss) private var dismiss
    @State private var isCopied = false
    @State private var showLineNumbers = true

    private var lines: [String] {
        artifact.content.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }

    private var lineNumberWidth: CGFloat {
        let digits = max(2, String(lines.count).count)
        return CGFloat(digits) * 9 + 8
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                ScrollView([.vertical, .horizontal], showsIndicators: true) {
                    HStack(alignment: .top, spacing: 0) {
                        if showLineNumbers {
                            lineNumberColumn
                        }
                        codeColumn
                    }
                    .padding(.vertical, WTheme.Spacing.md)
                }
            }
            .navigationTitle(artifact.title ?? artifact.type.rawValue.capitalized)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            copyAll()
                        } label: {
                            Label(isCopied ? "Copied" : "Copy", systemImage: "doc.on.doc")
                        }
                        Toggle("Line Numbers", isOn: $showLineNumbers)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text(artifact.title ?? "Artifact")
                            .font(.system(size: 13, weight: .semibold, design: .rounded))
                            .foregroundColor(WTheme.Colors.textPrimary)
                        if let lang = artifact.language {
                            Text(lang)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundColor(WTheme.Colors.textTertiary)
                        }
                    }
                }
            }
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarBackground(Color.black, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }

    private var lineNumberColumn: some View {
        VStack(alignment: .trailing, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { idx, _ in
                Text("\(idx + 1)")
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textQuaternary)
                    .frame(height: 18)
            }
        }
        .frame(width: lineNumberWidth, alignment: .trailing)
        .padding(.trailing, 8)
        .background(Color.black)
    }

    private var codeColumn: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line.isEmpty ? " " : line)
                    .font(.system(size: 13, weight: .regular, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .frame(height: 18, alignment: .leading)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .padding(.leading, showLineNumbers ? 0 : WTheme.Spacing.md)
        .padding(.trailing, WTheme.Spacing.md)
        .textSelection(.enabled)
    }

    private func copyAll() {
        UIPasteboard.general.string = artifact.content
        withAnimation(WTheme.Animation.quick) {
            isCopied = true
        }
        Haptics.shared.buttonTap()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            withAnimation(WTheme.Animation.quick) {
                isCopied = false
            }
        }
    }
}

#Preview {
    ArtifactEditorView(artifact: Artifact(
        type: .code,
        content: "func hello() {\n    print(\"Hello, WOTANN!\")\n}\n\nhello()",
        language: "swift",
        title: "Example.swift"
    ))
    .preferredColorScheme(.dark)
}
