import SwiftUI

// MARK: - ChatInputBar

/// Bottom input bar with text field, enhance, voice, and send buttons.
struct ChatInputBar: View {
    @Binding var text: String
    var isStreaming: Bool
    var isEnhancing: Bool
    var onSend: () -> Void
    var onEnhance: () -> Void
    var onCancel: () -> Void
    var onVoice: (() -> Void)? = nil
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            if isStreaming {
                StreamingBanner()
            }

            HStack(alignment: .bottom, spacing: WTheme.Spacing.sm) {
                // Enhance button
                EnhanceButton(
                    text: $text,
                    onEnhance: onEnhance,
                    isEnhancing: isEnhancing
                )

                // Text input with ring shadow (Stripe-inspired) and focus glow
                TextField("Message WOTANN...", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1...6)
                    .focused($isFocused)
                    .submitLabel(.send)
                    .onSubmit {
                        if !text.isEmpty && !isStreaming {
                            onSend()
                        }
                    }
                    .padding(.horizontal, WTheme.Spacing.sm)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous)
                            .stroke(
                                isFocused ? WTheme.Colors.primary.opacity(0.5) : WTheme.Colors.border,
                                lineWidth: isFocused ? WTheme.BorderWidth.thick : WTheme.BorderWidth.hairline
                            )
                    )
                    .shadow(
                        color: isFocused
                            ? WTheme.Colors.primary.opacity(0.15)
                            : WTheme.Shadow.ring.color,
                        radius: isFocused ? 6 : WTheme.Shadow.ring.radius,
                        x: 0,
                        y: 0
                    )
                    .animation(WTheme.Animation.quick, value: isFocused)

                // Voice button
                if let onVoice, text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isStreaming {
                    Button(action: onVoice) {
                        Image(systemName: "mic.fill")
                            .font(.title3)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Voice input")
                    .accessibilityHint("Tap to dictate a message")
                }

                // Send / Cancel button
                if isStreaming {
                    Button(action: onCancel) {
                        Image(systemName: "stop.circle.fill")
                            .font(.title2)
                            .foregroundColor(WTheme.Colors.error)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .accessibilityLabel("Stop streaming")
                } else {
                    Button(action: onSend) {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                            .foregroundColor(
                                text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    ? WTheme.Colors.textTertiary
                                    : WTheme.Colors.primary
                            )
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("Send message")
                }
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
            .background(.ultraThinMaterial)
        }
    }
}

#Preview {
    VStack {
        Spacer()
        ChatInputBar(
            text: .constant("Hello WOTANN"),
            isStreaming: false,
            isEnhancing: false,
            onSend: {},
            onEnhance: {},
            onCancel: {}
        )
    }
    .background(WTheme.Colors.background)
    .preferredColorScheme(.dark)
}
