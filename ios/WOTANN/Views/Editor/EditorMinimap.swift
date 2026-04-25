import SwiftUI

// MARK: - EditorMinimap
//
// Right-edge minimap showing a compressed overview of document structure.
// Each line is rendered as a 1pt horizontal bar tinted by an indent-based
// hash so blocks visually group together. Tapping anywhere on the strip
// scrolls the editor to that line via `onScrollTo`.
//
//   ┌──┐
//   │▔▔│ <- toolbar bar
//   │▁▁│
//   │██│
//   │▆▆│
//   │▂▂│
//   │  │
//   │  │
//   └──┘
//
// We can't read Runestone's exact layout without owning its delegate, so the
// minimap reflects raw text content (split by '\n'). Visible-viewport
// indication is left to a future Runestone-aware iteration; currently we
// just show the document outline.

struct EditorMinimap: View {

    /// Full document content. Recomputed when the editor service publishes.
    let content: String

    /// 1-based current cursor line. Used to highlight the slider.
    let currentLine: Int

    /// Optional list of diff hunks to overlay on the minimap.
    let diffHunks: [EditorDiffHunk]

    /// Theme tokens for backdrop and text accent.
    let backgroundColor: UIColor
    let accentColor: UIColor

    /// Tap callback — receives the 1-based line the user tapped.
    var onScrollTo: ((Int) -> Void)?

    // MARK: - Internal precomputed state

    private var lines: [Substring] {
        content.split(separator: "\n", omittingEmptySubsequences: false)
    }

    // MARK: - Body

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                Color(backgroundColor)
                Canvas { context, size in
                    drawLines(into: context, size: size)
                    drawDiffHunks(into: context, size: size)
                    drawCurrentLineCursor(into: context, size: size)
                }
                .accessibilityHidden(true)

                // Tap region — sits above the canvas to capture taps
                // without forcing the canvas into a tappable mode.
                Color.clear
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onEnded { value in
                                let yRatio = value.location.y / max(1, proxy.size.height)
                                let line = max(1, Int(yRatio * CGFloat(lines.count)) + 1)
                                onScrollTo?(line)
                            }
                    )
            }
        }
        .frame(width: 60)
        .clipped()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Minimap overview")
        .accessibilityHint("Tap to scroll the editor to that location")
    }

    // MARK: - Drawing

    private func drawLines(into context: GraphicsContext, size: CGSize) {
        let lineCount = max(1, lines.count)
        let lineHeight = size.height / CGFloat(lineCount)
        let leading: CGFloat = 4
        for (idx, line) in lines.enumerated() {
            let trimmed = line.drop(while: { $0 == " " || $0 == "\t" })
            let indent = CGFloat(line.count - trimmed.count)
            let length = min(size.width - leading - 4, max(2, CGFloat(trimmed.count) * 0.7))
            let x = leading + min(indent * 0.4, 8)
            let y = CGFloat(idx) * lineHeight + lineHeight * 0.5 - 0.5
            let rect = CGRect(
                x: x,
                y: y,
                width: max(1, length),
                height: max(1, min(2, lineHeight))
            )
            let alpha = trimmed.isEmpty ? 0.0 : tintForIndent(indent)
            context.fill(
                Path(rect),
                with: .color(Color(accentColor).opacity(alpha))
            )
        }
    }

    private func drawDiffHunks(into context: GraphicsContext, size: CGSize) {
        let lineCount = max(1, lines.count)
        let lineHeight = size.height / CGFloat(lineCount)
        for hunk in diffHunks {
            let startY = CGFloat(max(0, hunk.startLine - 1)) * lineHeight
            let endY = CGFloat(min(lineCount, hunk.endLine)) * lineHeight
            let rect = CGRect(
                x: 0,
                y: startY,
                width: 2,
                height: max(1, endY - startY)
            )
            context.fill(
                Path(rect),
                with: .color(diffColor(for: hunk.kind))
            )
        }
    }

    private func drawCurrentLineCursor(into context: GraphicsContext, size: CGSize) {
        let lineCount = max(1, lines.count)
        let lineHeight = size.height / CGFloat(lineCount)
        let y = CGFloat(max(0, currentLine - 1)) * lineHeight
        let rect = CGRect(
            x: 0,
            y: y,
            width: size.width,
            height: max(1, lineHeight + 1)
        )
        context.fill(
            Path(rect),
            with: .color(Color(accentColor).opacity(0.18))
        )
    }

    private func tintForIndent(_ indent: CGFloat) -> Double {
        // Lighter for top-level statements, darker for nested code so the
        // minimap reads like a "topographic" overview.
        let normalized = max(0.0, min(1.0, Double(indent) / 16.0))
        return 0.28 + (1.0 - normalized) * 0.42
    }

    private func diffColor(for kind: EditorDiffHunk.Kind) -> Color {
        switch kind {
        case .added:    return WTheme.Colors.success.opacity(0.85)
        case .removed:  return WTheme.Colors.error.opacity(0.85)
        case .modified: return WTheme.Colors.warning.opacity(0.85)
        }
    }
}

#if DEBUG
#Preview {
    EditorMinimap(
        content: """
        import Foundation

        struct Foo {
            let bar: Int
            func baz() -> String {
                return "hi"
            }
        }

        extension Foo {
            static let zero = Foo(bar: 0)
        }
        """,
        currentLine: 5,
        diffHunks: [EditorDiffHunk(kind: .added, startLine: 4, endLine: 7)],
        backgroundColor: UIColor(white: 0.07, alpha: 1.0),
        accentColor: UIColor.white
    )
    .frame(width: 60, height: 600)
    .preferredColorScheme(.dark)
}
#endif
