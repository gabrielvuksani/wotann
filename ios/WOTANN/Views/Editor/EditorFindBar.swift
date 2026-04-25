import SwiftUI

// MARK: - EditorFindBar
//
// Floating find/replace bar that pins to the top of the editor. Two modes:
//
//   ┌──────────────────────────────────────────────────┐
//   │ 🔍  [Find...]  ⓘ  ⓡ  ⓐ      [<][>]  3 of 12  ✕ │
//   └──────────────────────────────────────────────────┘
//
//   ┌──────────────────────────────────────────────────┐
//   │ 🔍  [Find...]  ⓘ  ⓡ  ⓐ      [<][>]  3 of 12  ✕ │
//   │ ↳   [Replace...]    [Replace]  [Replace All]    │
//   └──────────────────────────────────────────────────┘
//
// Toggles:
//   ⓘ  case-sensitive
//   ⓡ  regex mode
//   ↳  show/hide replace row
//
// Shortcuts (wired via UIKeyCommand from EditorView):
//   cmd+F   -> show
//   cmd+G   -> next
//   cmd+shift+G -> prev
//   esc     -> hide
//
// The view doesn't own search state — every binding flows from the
// EditorViewModel so query history survives across show/hide cycles.

struct EditorFindBar: View {

    @ObservedObject var viewModel: EditorViewModel

    @State private var showReplace: Bool = false
    @FocusState private var findFieldFocused: Bool

    // MARK: - Body

    var body: some View {
        VStack(spacing: 6) {
            findRow
            if showReplace {
                replaceRow
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, WTheme.Spacing.sm)
        .padding(.vertical, WTheme.Spacing.xs)
        .background(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .strokeBorder(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .onAppear {
            // Defer focus until the layout settles so the keyboard transition
            // doesn't snap.
            Task {
                try? await Task.sleep(nanoseconds: 120_000_000)
                if viewModel.isReady {
                    findFieldFocused = true
                }
            }
        }
        .animation(WTheme.Animation.quick, value: showReplace)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Find and replace")
    }

    // MARK: - Find row

    private var findRow: some View {
        HStack(spacing: WTheme.Spacing.xs) {
            Image(systemName: "magnifyingglass")
                .font(.wotannScaled(size: 13))
                .foregroundColor(WTheme.Colors.textTertiary)
                .frame(width: 18)

            TextField("Find", text: $viewModel.findQuery)
                .font(.wotannScaled(size: 14, weight: .regular, design: .monospaced))
                .textFieldStyle(.plain)
                .focused($findFieldFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .foregroundColor(WTheme.Colors.textPrimary)
                .onChange(of: viewModel.findQuery) { _, _ in
                    viewModel.recomputeFindMatches()
                }
                .onSubmit {
                    viewModel.gotoNextMatch()
                }

            // Toggle: replace row
            iconToggle(
                systemName: "text.append",
                isOn: showReplace,
                tip: showReplace ? "Hide replace" : "Show replace"
            ) {
                showReplace.toggle()
            }

            // Toggle: case-sensitive
            iconToggle(
                systemName: "textformat.alt",
                isOn: viewModel.findIsCaseSensitive,
                tip: "Case sensitive"
            ) {
                viewModel.findIsCaseSensitive.toggle()
                viewModel.recomputeFindMatches()
            }

            // Toggle: regex
            iconToggle(
                systemName: "asterisk",
                isOn: viewModel.findIsRegex,
                tip: "Regex"
            ) {
                viewModel.findIsRegex.toggle()
                viewModel.recomputeFindMatches()
            }

            navButton(systemName: "chevron.up") {
                viewModel.gotoPreviousMatch()
            }
            navButton(systemName: "chevron.down") {
                viewModel.gotoNextMatch()
            }

            matchCounter

            Button {
                viewModel.showFindBar = false
                viewModel.findQuery = ""
                viewModel.recomputeFindMatches()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.wotannScaled(size: 16))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            .accessibilityLabel("Close find bar")
        }
    }

    // MARK: - Replace row

    private var replaceRow: some View {
        HStack(spacing: WTheme.Spacing.xs) {
            Image(systemName: "arrow.turn.down.right")
                .font(.wotannScaled(size: 13))
                .foregroundColor(WTheme.Colors.textTertiary)
                .frame(width: 18)

            TextField("Replace", text: $viewModel.replaceText)
                .font(.wotannScaled(size: 14, weight: .regular, design: .monospaced))
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .foregroundColor(WTheme.Colors.textPrimary)

            Button("Replace") {
                viewModel.replaceCurrent()
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(viewModel.findMatches.isEmpty)

            Button("All") {
                viewModel.replaceAll()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(viewModel.findMatches.isEmpty)
        }
    }

    // MARK: - Sub-controls

    private var matchCounter: some View {
        let total = viewModel.findMatches.count
        let current = total == 0 ? 0 : viewModel.findCurrentIndex + 1
        return Text("\(current) of \(total)")
            .font(.wotannScaled(size: 11, weight: .medium, design: .monospaced))
            .foregroundColor(total == 0 ? WTheme.Colors.textQuaternary : WTheme.Colors.textTertiary)
            .frame(minWidth: 56, alignment: .trailing)
            .accessibilityLabel(total == 0 ? "No matches" : "Match \(current) of \(total)")
    }

    private func iconToggle(
        systemName: String,
        isOn: Bool,
        tip: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.wotannScaled(size: 12, weight: .medium))
                .foregroundColor(isOn ? .white : WTheme.Colors.textSecondary)
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                        .fill(isOn ? WTheme.Colors.primary : WTheme.Colors.surfaceAlt.opacity(0.5))
                )
        }
        .accessibilityLabel(tip)
        .accessibilityValue(isOn ? "On" : "Off")
    }

    private func navButton(systemName: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.wotannScaled(size: 11, weight: .semibold))
                .foregroundColor(WTheme.Colors.textSecondary)
                .frame(width: 24, height: 24)
        }
        .disabled(viewModel.findMatches.isEmpty)
        .accessibilityLabel(systemName == "chevron.up" ? "Previous match" : "Next match")
    }
}
