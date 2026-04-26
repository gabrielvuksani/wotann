import SwiftUI

// MARK: - EditorCompletionList
//
// Ghost-text style completion list rendered above the editor at the cursor
// caret. Each item shows kind icon + label + optional detail string. Tapping
// commits the completion via `onApply`; swipe/escape dismisses.
//
//   ┌──────────────────────────────────────┐
//   │ ƒ  makeRequest                URLReq │
//   │ ƒ  makeResponse              Response │
//   │ ν  maxLength                  Int    │
//   │ τ  MakefileTarget                    │
//   └──────────────────────────────────────┘
//
// Renderer is plain SwiftUI — fits in a popover or trailing-edge anchor.

struct EditorCompletionList: View {

    /// Items to render, in order of relevance from the language server.
    let items: [LSPCompletionItem]

    /// Index of the currently-highlighted item. Bound so keyboard arrow keys
    /// in EditorView can step through.
    @Binding var selectedIndex: Int

    /// Callback invoked with the chosen item.
    var onApply: (LSPCompletionItem) -> Void

    /// Called when the user dismisses (esc / tap outside).
    var onDismiss: () -> Void

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if items.isEmpty {
                emptyState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(items.indices, id: \.self) { idx in
                                row(items[idx], isSelected: idx == selectedIndex)
                                    .id(idx)
                                    .onTapGesture {
                                        selectedIndex = idx
                                        onApply(items[idx])
                                    }
                                if idx < items.count - 1 {
                                    Divider()
                                        .background(WTheme.Colors.border.opacity(0.3))
                                }
                            }
                        }
                    }
                    .onChange(of: selectedIndex) { _, newValue in
                        withAnimation(WTheme.Animation.quick) {
                            proxy.scrollTo(newValue, anchor: .center)
                        }
                    }
                    .frame(maxHeight: 220)
                }
            }
        }
        .frame(width: 280)
        .background(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .strokeBorder(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .shadow(color: WTheme.Shadow.md.color, radius: WTheme.Shadow.md.radius, x: WTheme.Shadow.md.x, y: WTheme.Shadow.md.y)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Code completions")
        // `.onExitCommand` is macOS/Catalyst-only — on iOS, dismissal is
        // handled by the parent Editor via tap-outside or the hardware
        // Esc key on iPad keyboards.
        #if targetEnvironment(macCatalyst)
        .onExitCommand(perform: onDismiss)
        #endif
    }

    // MARK: - Row

    private func row(_ item: LSPCompletionItem, isSelected: Bool) -> some View {
        HStack(spacing: WTheme.Spacing.sm) {
            kindBadge(item.kind)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.label)
                    .font(.wotannScaled(size: 13, weight: .medium, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.wotannScaled(size: 11, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, WTheme.Spacing.sm)
        .padding(.vertical, WTheme.Spacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            isSelected ? WTheme.Colors.primary.opacity(0.18) : Color.clear
        )
        .accessibilityLabel("\(item.label), \(item.kind)")
        .accessibilityHint(item.detail ?? "")
    }

    // MARK: - Kind badge

    private func kindBadge(_ kind: String) -> some View {
        let (icon, tint) = visual(forKind: kind)
        return Image(systemName: icon)
            .font(.system(size: 11, weight: .bold))
            .foregroundColor(tint)
            .frame(width: 18, height: 18)
            .background(
                RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                    .fill(tint.opacity(0.15))
            )
    }

    private func visual(forKind kind: String) -> (icon: String, tint: Color) {
        // Coarse mapping from LSP `CompletionItemKind` (lower-cased strings)
        // to SF Symbols. Anything unknown falls back to "tag.fill".
        switch kind.lowercased() {
        case "function", "method":            return ("function", WTheme.Colors.primary)
        case "variable", "field", "property": return ("v.square.fill", WTheme.Colors.info)
        case "class", "type", "struct":       return ("t.square.fill", WTheme.Colors.warning)
        case "enum", "enummember":            return ("e.square.fill", WTheme.Colors.success)
        case "keyword":                       return ("k.square.fill", WTheme.Colors.error)
        case "module", "namespace":           return ("cube.fill", WTheme.Colors.brainstormAccent)
        case "constant":                      return ("c.square.fill", WTheme.Colors.chartAccent)
        case "snippet":                       return ("text.aligncenter", WTheme.Colors.textTertiary)
        default:                              return ("tag.fill", WTheme.Colors.textTertiary)
        }
    }

    // MARK: - Empty state

    private var emptyState: some View {
        Text("No completions")
            .font(.wotannScaled(size: 12))
            .foregroundColor(WTheme.Colors.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(WTheme.Spacing.sm)
    }
}
