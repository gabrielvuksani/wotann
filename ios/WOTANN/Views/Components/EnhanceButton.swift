import SwiftUI

// MARK: - EnhanceButton

/// Sparkles button for prompt enhancement -- matches desktop's Enhance button.
struct EnhanceButton: View {
    @Binding var text: String
    let onEnhance: () -> Void
    var isEnhancing: Bool = false

    var body: some View {
        Button(action: onEnhance) {
            HStack(spacing: 4) {
                Image(systemName: "sparkles")
                if isEnhancing {
                    ProgressView()
                        .scaleEffect(0.6)
                        .tint(WTheme.Colors.primary)
                }
            }
            .foregroundColor(
                text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? WTheme.Colors.textTertiary
                    : WTheme.Colors.primary
            )
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
        }
        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isEnhancing)
        .accessibilityLabel("Enhance prompt")
        .accessibilityHint("Improve your prompt with AI suggestions")
    }
}

// MARK: - EnhancedPromptSheet

/// Sheet comparing original and enhanced prompts.
struct EnhancedPromptSheet: View {
    let original: String
    let enhanced: String
    let improvements: [String]
    let onAccept: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                    // Original
                    promptSection(
                        label: "Original",
                        icon: nil,
                        text: original,
                        bgColor: WTheme.Colors.surface,
                        accentColor: WTheme.Colors.textSecondary
                    )

                    // Enhanced
                    promptSection(
                        label: "Enhanced",
                        icon: "sparkles",
                        text: enhanced,
                        bgColor: WTheme.Colors.primary.opacity(0.1),
                        accentColor: WTheme.Colors.primary,
                        bordered: true
                    )

                    // Improvements
                    if !improvements.isEmpty {
                        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                            Text("Improvements")
                                .font(WTheme.Typography.caption)
                                .fontWeight(.bold)
                                .foregroundColor(WTheme.Colors.textSecondary)

                            ForEach(improvements, id: \.self) { improvement in
                                HStack(alignment: .top, spacing: 6) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.caption)
                                        .foregroundColor(WTheme.Colors.success)
                                    Text(improvement)
                                        .font(WTheme.Typography.caption)
                                        .foregroundColor(WTheme.Colors.textSecondary)
                                }
                            }
                        }
                    }
                }
                .padding()
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Enhance Prompt")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use Enhanced", action: onAccept)
                        .fontWeight(.bold)
                }
            }
        }
    }

    @ViewBuilder
    private func promptSection(
        label: String,
        icon: String?,
        text: String,
        bgColor: Color,
        accentColor: Color,
        bordered: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .foregroundColor(accentColor)
                }
                Text(label)
                    .font(WTheme.Typography.caption)
                    .fontWeight(.bold)
                    .foregroundColor(accentColor)
            }

            Text(text)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(bgColor)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                .overlay(
                    Group {
                        if bordered {
                            RoundedRectangle(cornerRadius: WTheme.Radius.md)
                                .strokeBorder(accentColor.opacity(0.3))
                        }
                    }
                )
        }
    }
}
