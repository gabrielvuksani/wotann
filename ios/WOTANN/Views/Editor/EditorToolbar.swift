import SwiftUI
import UIKit

// MARK: - EditorToolbar
//
// Full-width SwiftUI toolbar shown above the Runestone TextView. Carries:
//
//   [ close ]  [ language picker ]  [ theme toggle ]  [ line:col ]  [ save ]
//
// Deliberately stateless — every control is wired to the `EditorService`
// so the toolbar can't drift out of sync with the editor. QB #7 still
// applies: this view observes a session-scoped EditorService passed in by
// the caller.
//
// The design mirrors the rest of the WOTANN iOS chrome (Apple-blue accent,
// OLED-black surface) but uses editor-scoped theme tokens so it works in
// both dark and light mode.

struct EditorToolbar: View {

    @ObservedObject var service: EditorService

    var onSave:       () -> Void
    var onAskWotann:  () -> Void
    var onClose:      () -> Void

    // MARK: - Body

    var body: some View {
        HStack(spacing: 10) {
            closeButton
            Divider()
                .frame(height: 22)
                .background(accent.opacity(0.20))

            languagePicker

            themeToggle

            Spacer(minLength: 4)

            caretLabel

            askWotannButton

            saveButton
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .background(Color(service.theme.gutterBackgroundColor))
        .foregroundColor(Color(service.theme.textColor))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Editor toolbar")
    }

    // MARK: - Inline tokens (match EditorThemes.accent)

    private var accent: Color {
        Color(UIColor(red: 0x0A / 255.0, green: 0x84 / 255.0, blue: 0xFF / 255.0, alpha: 1.0))
    }

    // MARK: - Close

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 22, weight: .regular))
                .foregroundColor(Color(service.theme.gutterTextColor))
        }
        .accessibilityLabel("Close editor")
    }

    // MARK: - Language picker

    private var languagePicker: some View {
        Menu {
            ForEach(EditorLanguages.all, id: \.id) { lang in
                Button {
                    service.setLanguage(id: lang.id)
                } label: {
                    HStack {
                        Text(lang.displayName)
                        if service.language.id == lang.id {
                            Spacer()
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.system(size: 11, weight: .medium))
                Text(service.language.displayName)
                    .font(.system(size: 13, weight: .medium))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(accent.opacity(0.10))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .foregroundColor(accent)
        }
        .accessibilityLabel("Language: \(service.language.displayName)")
        .accessibilityHint("Tap to pick a different syntax highlighting language")
    }

    // MARK: - Theme toggle

    private var themeToggle: some View {
        Menu {
            ForEach(EditorThemeMode.allCases) { mode in
                Button {
                    service.setThemeMode(mode)
                } label: {
                    HStack {
                        Text(mode.displayName)
                        if service.themeMode == mode {
                            Spacer()
                            Image(systemName: "checkmark")
                        }
                    }
                }
            }
        } label: {
            Image(systemName: themeIconName(for: service.themeMode))
                .font(.system(size: 15, weight: .regular))
                .foregroundColor(Color(service.theme.textColor))
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
        }
        .accessibilityLabel("Theme: \(service.themeMode.displayName)")
        .accessibilityHint("Tap to switch between light, dark, and system theme")
    }

    private func themeIconName(for mode: EditorThemeMode) -> String {
        switch mode {
        case .light:  return "sun.max"
        case .dark:   return "moon"
        case .system: return "circle.righthalf.filled"
        }
    }

    // MARK: - Caret / line:col indicator

    private var caretLabel: some View {
        HStack(spacing: 4) {
            Image(systemName: "text.alignleft")
                .font(.system(size: 10, weight: .regular))
            Text("Ln \(service.caretLine), Col \(service.caretColumn)")
                .font(.system(size: 11, weight: .regular, design: .monospaced))
        }
        .foregroundColor(Color(service.theme.gutterTextColor))
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Cursor at line \(service.caretLine), column \(service.caretColumn)")
    }

    // MARK: - Ask WOTANN

    private var askWotannButton: some View {
        Button(action: onAskWotann) {
            HStack(spacing: 4) {
                Image(systemName: "w.circle.fill")
                    .font(.system(size: 14, weight: .regular))
                Text("Ask WOTANN")
                    .font(.system(size: 12, weight: .semibold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(accent)
            .foregroundColor(.white)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .accessibilityLabel("Ask WOTANN")
        .accessibilityHint("Send the current document to WOTANN for review or edits")
    }

    // MARK: - Save

    private var saveButton: some View {
        Button(action: onSave) {
            ZStack {
                if service.isSaving {
                    ProgressView()
                        .scaleEffect(0.7)
                } else {
                    Image(systemName: service.document.isDirty ? "square.and.arrow.down.fill" : "square.and.arrow.down")
                        .font(.system(size: 15, weight: .regular))
                }
            }
            .frame(width: 28, height: 28)
        }
        .disabled(!service.document.isDirty || service.isSaving)
        .foregroundColor(service.document.isDirty ? accent : Color(service.theme.gutterTextColor))
        .accessibilityLabel(service.document.isDirty ? "Save document" : "No unsaved changes")
    }
}
