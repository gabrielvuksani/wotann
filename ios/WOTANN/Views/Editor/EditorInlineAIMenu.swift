import SwiftUI

// MARK: - EditorInlineAIMenu
//
// Popover menu shown when the user has a non-empty selection. Offers four
// canned WOTANN actions:
//
//   ┌─────────────────────────────┐
//   │ ✨ Explain                  │
//   │ ↻  Refactor                 │
//   │ 🧪 Add tests                │
//   │ 📝 Docstring                │
//   ├─────────────────────────────┤
//   │ Ask WOTANN…                 │
//   └─────────────────────────────┘
//
// Tapping any option dispatches the selection back to the chat composer
// pre-wrapped in the appropriate prompt template. The actual chat sheet is
// surfaced by the parent EditorView via the `onSendToChat` closure — this
// view doesn't know about ChatView at all.
//
// Pure SwiftUI; no state owned. The selection text and "selected file path"
// are passed in. Quality bar #7: the parent owns lifecycle.

struct EditorInlineAIMenu: View {

    /// The currently-selected text. The renderer is allowed to truncate for
    /// display but the closure receives the full string verbatim.
    let selection: String

    /// Optional remote path so prompts can reference `@file:`.
    let remotePath: String?

    /// Display language id (e.g. "swift", "typescript") for prompt fences.
    let languageId: String

    /// Callback invoked with the fully-formatted prompt that should be
    /// piped into the chat composer.
    var onSendToChat: (String) -> Void

    /// Callback invoked when the user taps "Ask WOTANN..." for a free-form
    /// prompt seeded with the selection.
    var onAskCustom: (String) -> Void

    /// Dismiss callback for popover hosts.
    var onDismiss: () -> Void

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(InlineAIAction.allCases, id: \.self) { action in
                actionRow(action)
                if action != InlineAIAction.allCases.last {
                    Divider()
                        .background(WTheme.Colors.border.opacity(0.4))
                }
            }

            Divider()
                .background(WTheme.Colors.border.opacity(0.6))

            Button {
                onAskCustom(seedPrompt())
                onDismiss()
            } label: {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "w.circle.fill")
                        .foregroundColor(WTheme.Colors.primary)
                    Text("Ask WOTANN…")
                        .font(.wotannScaled(size: 14, weight: .semibold, design: .rounded))
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Spacer()
                }
                .contentShape(Rectangle())
                .padding(.horizontal, WTheme.Spacing.md)
                .padding(.vertical, WTheme.Spacing.sm)
            }
            .buttonStyle(.plain)
        }
        .frame(width: 240)
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
        .accessibilityLabel("Inline WOTANN actions")
    }

    // MARK: - Action row

    private func actionRow(_ action: InlineAIAction) -> some View {
        Button {
            let prompt = format(action: action, selection: selection)
            onSendToChat(prompt)
            onDismiss()
        } label: {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: action.systemIcon)
                    .foregroundColor(action.tint)
                    .frame(width: 18)
                Text(action.title)
                    .font(.wotannScaled(size: 14, weight: .medium, design: .rounded))
                    .foregroundColor(WTheme.Colors.textPrimary)
                Spacer()
            }
            .contentShape(Rectangle())
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(action.title)
        .accessibilityHint(action.subtitle)
    }

    // MARK: - Prompt formatting

    /// Build the chat prompt for the given action. Wraps selection in a
    /// fenced code block tagged with the file's language for syntax cues.
    private func format(action: InlineAIAction, selection: String) -> String {
        var lines: [String] = []
        if let path = remotePath {
            lines.append("@file:\(path)")
            lines.append("")
        }
        lines.append(action.promptTemplate)
        lines.append("")
        lines.append("```\(languageId)")
        lines.append(selection)
        lines.append("```")
        return lines.joined(separator: "\n")
    }

    /// A selection-only prompt (no canned template) used by "Ask WOTANN…".
    private func seedPrompt() -> String {
        var lines: [String] = []
        if let path = remotePath {
            lines.append("@file:\(path)")
            lines.append("")
        }
        lines.append("```\(languageId)")
        lines.append(selection)
        lines.append("```")
        return lines.joined(separator: "\n")
    }
}

// MARK: - InlineAIAction

/// The four canned actions plus their prompt templates.
enum InlineAIAction: CaseIterable {
    case explain
    case refactor
    case addTests
    case docstring

    var title: String {
        switch self {
        case .explain:   return "Explain"
        case .refactor:  return "Refactor"
        case .addTests:  return "Add tests"
        case .docstring: return "Docstring"
        }
    }

    var subtitle: String {
        switch self {
        case .explain:   return "Walk through what this code does."
        case .refactor:  return "Suggest a cleaner version."
        case .addTests:  return "Generate tests for the selection."
        case .docstring: return "Add a documentation comment."
        }
    }

    var systemIcon: String {
        switch self {
        case .explain:   return "sparkles"
        case .refactor:  return "arrow.triangle.2.circlepath"
        case .addTests:  return "checkmark.seal"
        case .docstring: return "text.alignleft"
        }
    }

    var tint: Color {
        switch self {
        case .explain:   return WTheme.Colors.primary
        case .refactor:  return WTheme.Colors.warning
        case .addTests:  return WTheme.Colors.success
        case .docstring: return WTheme.Colors.info
        }
    }

    /// Canonical prompt template prepended to the selection.
    var promptTemplate: String {
        switch self {
        case .explain:
            return "Explain what the following code does, focusing on intent and any non-obvious mechanics:"
        case .refactor:
            return "Refactor the following code for clarity, immutability, and idiomatic style. Return the new version plus a short rationale:"
        case .addTests:
            return "Write a small set of focused tests for the following code. Cover normal behaviour, edge cases, and failure modes:"
        case .docstring:
            return "Write a concise documentation comment for the following code. Match the language's idiomatic doc style:"
        }
    }
}
