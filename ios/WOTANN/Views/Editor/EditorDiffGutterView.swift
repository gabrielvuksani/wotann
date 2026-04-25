import SwiftUI

// MARK: - EditorDiffGutterView
//
// Thin vertical strip that decorates lines with diff state from the desktop
// shadow-git. Sits between Runestone's native gutter and the text body so
// the user gets at-a-glance change indicators.
//
// Symbols:
//   +    line added (green)
//   −    line removed (red)
//   ~    line modified (amber)
//
// Source: `EditorViewModel.diffHunks`, populated by `git.diff` RPC. The
// gutter is purely presentational — no editing affordances.
//
// Implementation: We can't reach into Runestone's internal layout to overlay
// per-line markers reliably across versions, so the gutter renders as a
// fixed-width column that sums hunk markers in display order. Each marker
// shows a tooltip with the line range. This deliberately trades the exact
// per-line alignment for compatibility — when Runestone exposes a
// `gutterDelegate` we can re-pin to the underlying line geometry.

struct EditorDiffGutterView: View {

    /// The diff hunks to render, ordered by `startLine`.
    let hunks: [EditorDiffHunk]

    /// Total visible line count of the document. Used to scale the strip so
    /// the markers visually match their line positions.
    let totalLines: Int

    /// Theme tokens piped from the active Runestone theme. Keeps the strip's
    /// background flush with the gutter.
    let backgroundColor: UIColor
    let textColor: UIColor

    /// Tap callback — receives the start line of the tapped hunk so the
    /// parent view can scroll the editor to that location.
    var onTapHunk: ((EditorDiffHunk) -> Void)?

    // MARK: - Body

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .top) {
                Color(backgroundColor)
                ForEach(hunks) { hunk in
                    markerView(for: hunk, in: proxy.size)
                }
            }
        }
        .frame(width: 14)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Diff gutter")
    }

    // MARK: - Marker

    private func markerView(for hunk: EditorDiffHunk, in size: CGSize) -> some View {
        let visibleLines = max(1, totalLines)
        let lineHeight = size.height / CGFloat(visibleLines)
        let startY = lineHeight * CGFloat(max(0, hunk.startLine - 1))
        let height = max(2, CGFloat(hunk.endLine - hunk.startLine + 1) * lineHeight)
        return Button {
            onTapHunk?(hunk)
        } label: {
            ZStack {
                Rectangle()
                    .fill(color(for: hunk.kind))
                    .frame(width: 3, height: height)
                Text(symbol(for: hunk.kind))
                    .font(.system(size: 9, weight: .bold))
                    .foregroundColor(.white)
                    .padding(2)
                    .background(
                        Circle().fill(color(for: hunk.kind))
                    )
                    .opacity(height >= 18 ? 1 : 0)
            }
        }
        .buttonStyle(.plain)
        .frame(width: 14, alignment: .center)
        .position(x: 7, y: startY + height / 2)
        .accessibilityLabel(label(for: hunk))
        .accessibilityHint("Tap to scroll to lines \(hunk.startLine)–\(hunk.endLine)")
    }

    // MARK: - Tokens

    private func color(for kind: EditorDiffHunk.Kind) -> Color {
        switch kind {
        case .added:    return WTheme.Colors.success
        case .removed:  return WTheme.Colors.error
        case .modified: return WTheme.Colors.warning
        }
    }

    private func symbol(for kind: EditorDiffHunk.Kind) -> String {
        switch kind {
        case .added:    return "+"
        case .removed:  return "−"
        case .modified: return "~"
        }
    }

    private func label(for hunk: EditorDiffHunk) -> String {
        let verb: String
        switch hunk.kind {
        case .added:    verb = "Added"
        case .removed:  verb = "Removed"
        case .modified: verb = "Modified"
        }
        return "\(verb) lines \(hunk.startLine) to \(hunk.endLine)"
    }
}

// MARK: - Empty-state preview

#if DEBUG
private struct EditorDiffGutterPreview: View {
    var body: some View {
        EditorDiffGutterView(
            hunks: [
                EditorDiffHunk(kind: .added,    startLine: 1,  endLine: 3),
                EditorDiffHunk(kind: .modified, startLine: 8,  endLine: 8),
                EditorDiffHunk(kind: .removed,  startLine: 14, endLine: 16),
            ],
            totalLines: 30,
            backgroundColor: UIColor(white: 0.07, alpha: 1.0),
            textColor: UIColor.white
        )
        .frame(width: 14, height: 480)
    }
}

#Preview {
    EditorDiffGutterPreview()
        .preferredColorScheme(.dark)
        .background(Color.black)
}
#endif
