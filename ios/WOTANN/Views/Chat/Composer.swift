import SwiftUI

// MARK: - Composer

/// Phase C chat composer: 44pt pill that expands to 160pt when typing.
/// Leading `+` action, trailing 56pt mic (idle) that morphs into a 32pt
/// arrow send button when text is present. Above the pill: current model
/// chip, cost estimate, and Autopilot toggle. Below: contextual accessory
/// row for slash commands, @mentions, #skills, and a Stop button while
/// streaming.
///
/// All visual logic is immutable — each render returns fresh views. The
/// composer owns no chat state beyond the text binding; send / cancel /
/// voice callbacks are supplied by the parent view.
struct Composer: View {
    @Binding var text: String
    var isStreaming: Bool
    var isEnhancing: Bool
    var currentModel: String
    var currentProvider: String
    var estimatedCost: Double
    var autopilotOn: Bool
    var onSend: () -> Void
    var onEnhance: () -> Void
    var onCancel: () -> Void
    var onVoicePressHold: () -> Void
    var onPlus: () -> Void
    var onToggleAutopilot: () -> Void
    var onSlashCommand: (() -> Void)? = nil
    var onMention: (() -> Void)? = nil
    var onSkill: (() -> Void)? = nil
    var quotedReply: String?
    var onClearQuote: (() -> Void)? = nil

    @FocusState private var isFocused: Bool
    @State private var isPressingMic = false

    private var hasText: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var isExpanded: Bool { isFocused || hasText }

    var body: some View {
        VStack(spacing: 8) {
            statusRow
            if let quoted = quotedReply, !quoted.isEmpty {
                quoteCard(quoted)
            }
            pill
            accessoryRow
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.black)
    }

    // MARK: - Status Row (model chip + cost + autopilot)

    private var statusRow: some View {
        HStack(spacing: 8) {
            modelChip
            costPill
            Spacer(minLength: 4)
            autopilotToggle
        }
        .frame(height: 26)
    }

    private var modelChip: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(WTheme.Colors.provider(currentProvider))
                .frame(width: 6, height: 6)
            Text(currentModel)
                .font(.wotannScaled(size: 11, weight: .medium, design: .rounded))
                .foregroundColor(WTheme.Colors.textSecondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            Capsule(style: .continuous)
                .fill(WTheme.Colors.surface)
        )
    }

    private var costPill: some View {
        HStack(spacing: 3) {
            Image(systemName: "creditcard.fill")
                .font(.wotannScaled(size: 9))
                .foregroundColor(WTheme.Colors.textTertiary)
            Text(estimatedCost == 0 ? "~$0.00" : String(format: "~$%.3f", estimatedCost))
                .font(.wotannScaled(size: 10, weight: .medium, design: .monospaced))
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .padding(.horizontal, 7)
        .padding(.vertical, 4)
        .background(
            Capsule(style: .continuous)
                .fill(WTheme.Colors.surface.opacity(0.7))
        )
    }

    private var autopilotToggle: some View {
        Button(action: onToggleAutopilot) {
            HStack(spacing: 4) {
                Image(systemName: autopilotOn ? "airplane" : "airplane.circle")
                    .font(.wotannScaled(size: 11))
                Text("Autopilot")
                    .font(.wotannScaled(size: 11, weight: .semibold, design: .rounded))
            }
            .foregroundColor(autopilotOn ? .white : WTheme.Colors.textSecondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(autopilotOn ? WTheme.Colors.primary : WTheme.Colors.surface)
            )
        }
        .accessibilityLabel(autopilotOn ? "Autopilot on" : "Autopilot off")
    }

    // MARK: - Quote Card

    private func quoteCard(_ quoted: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Rectangle()
                .fill(WTheme.Colors.primary)
                .frame(width: 2)
            VStack(alignment: .leading, spacing: 2) {
                Text("Replying to")
                    .font(.wotannScaled(size: 10, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.primary)
                Text(quoted)
                    .font(.wotannScaled(size: 12))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 4)
            if let onClearQuote {
                Button(action: onClearQuote) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.wotannScaled(size: 14))
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
                .accessibilityLabel("Clear reply")
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
    }

    // MARK: - Main Pill

    private var pill: some View {
        HStack(alignment: .bottom, spacing: 8) {
            plusButton

            TextField("Message WOTANN...", text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.wotannScaled(size: 16))
                .foregroundColor(WTheme.Colors.textPrimary)
                .tint(WTheme.Colors.primary)
                .focused($isFocused)
                .lineLimit(1...6)
                .submitLabel(.send)
                .onSubmit {
                    if hasText && !isStreaming { onSend() }
                }
                // T7.2 — Opt into Apple Intelligence Writing Tools with full
                // behaviour (Rewrite / Proofread / Summarize). Wrapped in a
                // helper so iOS 17 compiles cleanly.
                .wotannWritingToolsComplete()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)

            trailingControl
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(minHeight: 44)
        .frame(maxHeight: isExpanded ? 160 : 44, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(
                    isFocused ? WTheme.Colors.primary.opacity(0.45) : Color.clear,
                    lineWidth: 1
                )
        )
        .animation(.spring(duration: 0.28, bounce: 0.15), value: isExpanded)
        .animation(.spring(duration: 0.2, bounce: 0.1), value: isFocused)
    }

    private var plusButton: some View {
        Button(action: {
            Haptics.shared.buttonTap()
            onPlus()
        }) {
            Image(systemName: "plus")
                .font(.wotannScaled(size: 18, weight: .medium))
                .foregroundColor(WTheme.Colors.textSecondary)
                .frame(width: 32, height: 32)
                .background(Circle().fill(WTheme.Colors.surfaceAlt.opacity(0.4)))
                .contentShape(Circle())
        }
        .accessibilityLabel("Add attachment")
    }

    @ViewBuilder
    private var trailingControl: some View {
        if isStreaming {
            Button(action: onCancel) {
                Image(systemName: "stop.fill")
                    .font(.wotannScaled(size: 14, weight: .bold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(WTheme.Colors.error))
            }
            .accessibilityLabel("Stop streaming")
        } else if hasText {
            Button(action: {
                Haptics.shared.buttonTap()
                onSend()
            }) {
                Image(systemName: "arrow.up")
                    .font(.wotannScaled(size: 16, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(WTheme.Colors.primary))
            }
            .accessibilityLabel("Send message")
        } else {
            micButton
        }
    }

    private var micButton: some View {
        Button(action: {
            // Tap triggers voice sheet immediately (also opens on long-press).
            onVoicePressHold()
        }) {
            Image(systemName: "mic.fill")
                .font(.wotannScaled(size: 22, weight: .medium))
                .foregroundColor(.white)
                .frame(width: 56, height: 56)
                .background(Circle().fill(WTheme.Colors.primary))
                .scaleEffect(isPressingMic ? 1.08 : 1.0)
        }
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.25)
                .onChanged { _ in
                    if !isPressingMic {
                        isPressingMic = true
                        Haptics.shared.longPressStart()
                    }
                }
                .onEnded { _ in
                    isPressingMic = false
                    onVoicePressHold()
                }
        )
        .accessibilityLabel("Voice input")
        .accessibilityHint("Tap or long-press for voice mode")
    }

    // MARK: - Accessory Row

    private var accessoryRow: some View {
        HStack(spacing: 8) {
            accessoryButton(title: "/", systemIcon: "slash.circle") {
                onSlashCommand?()
            }
            accessoryButton(title: "@", systemIcon: "at") {
                onMention?()
            }
            accessoryButton(title: "#", systemIcon: "number") {
                onSkill?()
            }
            accessoryButton(title: "Enhance", systemIcon: "sparkles") {
                onEnhance()
            }
            .opacity(hasText ? 1 : 0.5)
            .disabled(!hasText || isEnhancing)

            Spacer()

            if isStreaming {
                Button(action: onCancel) {
                    HStack(spacing: 4) {
                        Image(systemName: "stop.fill")
                            .font(.wotannScaled(size: 10))
                        Text("Stop")
                            .font(.wotannScaled(size: 11, weight: .semibold, design: .rounded))
                    }
                    .foregroundColor(WTheme.Colors.error)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(
                        Capsule(style: .continuous)
                            .fill(WTheme.Colors.error.opacity(0.15))
                    )
                }
                .accessibilityLabel("Stop streaming")
            }
        }
        .frame(height: 28)
    }

    private func accessoryButton(
        title: String,
        systemIcon: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: {
            Haptics.shared.buttonTap()
            action()
        }) {
            HStack(spacing: 3) {
                Image(systemName: systemIcon)
                    .font(.wotannScaled(size: 10, weight: .semibold))
                Text(title)
                    .font(.wotannScaled(size: 11, weight: .semibold, design: .rounded))
            }
            .foregroundColor(WTheme.Colors.textSecondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(
                Capsule(style: .continuous)
                    .fill(WTheme.Colors.surface.opacity(0.6))
            )
        }
        .accessibilityLabel(title)
    }
}

#Preview {
    VStack {
        Spacer()
        Composer(
            text: .constant(""),
            isStreaming: false,
            isEnhancing: false,
            currentModel: "claude-opus-4-6",
            currentProvider: "anthropic",
            estimatedCost: 0.003,
            autopilotOn: false,
            onSend: {},
            onEnhance: {},
            onCancel: {},
            onVoicePressHold: {},
            onPlus: {},
            onToggleAutopilot: {}
        )
    }
    .background(Color.black)
    .preferredColorScheme(.dark)
}
