import SwiftUI

// MARK: - EditorStatusBar
//
// Compact bottom strip beneath the editor surface. Mirrors the toolbar's
// caret/language indicators but adds file size, encoding, line endings, and
// dirty/clean state. Pure presentation — every value is read from the
// EditorService snapshot.
//
//   ┌────────────────────────────────────────────────────────────────┐
//   │ ● Modified   Ln 42, Col 17   Spaces:4   UTF-8   LF   2.4 KB    │
//   └────────────────────────────────────────────────────────────────┘
//
// All tokens come from `WTheme.*` so light/dark + Dynamic Type behave.

struct EditorStatusBar: View {

    @ObservedObject var service: EditorService

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            dirtyDot
            caretChip
            Spacer(minLength: WTheme.Spacing.xs)
            fileSizeChip
            encodingChip
            languageChip
        }
        .padding(.horizontal, WTheme.Spacing.sm)
        .padding(.vertical, WTheme.Spacing.xs)
        .frame(minHeight: 24)
        .background(
            Color(service.theme.gutterBackgroundColor)
                .overlay(
                    Rectangle()
                        .fill(WTheme.Colors.border.opacity(0.4))
                        .frame(height: WTheme.BorderWidth.hairline),
                    alignment: .top
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Editor status")
    }

    // MARK: - Sub-views

    private var dirtyDot: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(service.document.isDirty ? WTheme.Colors.warning : WTheme.Colors.success)
                .frame(width: 6, height: 6)
            Text(service.document.isDirty ? "Modified" : "Saved")
                .font(.wotannScaled(size: 10, weight: .medium, design: .rounded))
                .foregroundColor(Color(service.theme.gutterTextColor))
        }
        .accessibilityLabel(service.document.isDirty ? "Document modified" : "Document saved")
    }

    private var caretChip: some View {
        Text("Ln \(service.caretLine), Col \(service.caretColumn)")
            .font(.wotannScaled(size: 10, weight: .regular, design: .monospaced))
            .foregroundColor(Color(service.theme.gutterTextColor))
            .accessibilityLabel("Cursor at line \(service.caretLine), column \(service.caretColumn)")
    }

    private var fileSizeChip: some View {
        Text(formattedSize)
            .font(.wotannScaled(size: 10, weight: .regular, design: .monospaced))
            .foregroundColor(Color(service.theme.gutterTextColor))
            .accessibilityLabel("File size \(formattedSize)")
    }

    private var encodingChip: some View {
        Text("UTF-8")
            .font(.wotannScaled(size: 10, weight: .regular, design: .monospaced))
            .foregroundColor(Color(service.theme.gutterTextColor))
    }

    private var languageChip: some View {
        Text(service.language.displayName)
            .font(.wotannScaled(size: 10, weight: .medium, design: .rounded))
            .foregroundColor(Color(service.theme.textColor))
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                Capsule(style: .continuous)
                    .fill(Color(service.theme.gutterBackgroundColor))
                    .overlay(
                        Capsule(style: .continuous)
                            .strokeBorder(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
                    )
            )
            .accessibilityLabel("Language \(service.language.displayName)")
    }

    // MARK: - Formatters

    /// Approximate UTF-8 byte size of the current document content.
    private var formattedSize: String {
        let byteCount = service.document.content.lengthOfBytes(using: .utf8)
        let kb = Double(byteCount) / 1024.0
        if byteCount < 1024 {
            return "\(byteCount) B"
        } else if kb < 1024 {
            return String(format: "%.1f KB", kb)
        } else {
            return String(format: "%.2f MB", kb / 1024.0)
        }
    }
}
