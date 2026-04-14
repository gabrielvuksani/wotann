import SwiftUI

// MARK: - ShareView

/// SwiftUI view for the WOTANN share extension.
struct ShareView: View {
    let sharedText: String
    let onSend: (String, String) -> Void
    let onCancel: () -> Void

    @State private var additionalText = ""
    @State private var selectedConversation = "New Conversation"
    @State private var isSending = false

    /// Conversation options loaded from the shared app group UserDefaults.
    /// Falls back to a static list if no recent conversations are available.
    private var conversationOptions: [String] {
        var options = ["New Conversation"]
        if let defaults = UserDefaults(suiteName: "group.com.wotann.shared"),
           let recent = defaults.stringArray(forKey: "recentConversations"),
           !recent.isEmpty {
            options.append(contentsOf: recent)
        } else {
            options.append("Last Active Chat")
        }
        return options
    }

    var body: some View {
        ZStack {
            ShareTheme.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Divider().background(ShareTheme.border)
                ScrollView {
                    VStack(spacing: ShareTheme.spacingMd) {
                        sharedContentCard
                        additionalPromptField
                        conversationPicker
                    }
                    .padding(ShareTheme.spacingMd)
                }
                Divider().background(ShareTheme.border)
                footer
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button("Cancel", action: onCancel)
                .font(.system(size: 17, weight: .regular))
                .foregroundColor(ShareTheme.textSecondary)

            Spacer()

            HStack(spacing: 6) {
                Image(systemName: "w.circle.fill")
                    .font(.system(size: 14))
                    .foregroundColor(ShareTheme.primary)
                Text("Send to WOTANN")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundColor(ShareTheme.textPrimary)
            }

            Spacer()

            // Balance width
            Text("Cancel")
                .font(.system(size: 17))
                .hidden()
        }
        .padding(.horizontal, ShareTheme.spacingMd)
        .padding(.vertical, ShareTheme.spacingSm)
    }

    // MARK: - Shared Content Card

    private var sharedContentCard: some View {
        VStack(alignment: .leading, spacing: ShareTheme.spacingSm) {
            HStack(spacing: 4) {
                Image(systemName: "doc.on.clipboard")
                    .font(.system(size: 10))
                    .foregroundColor(ShareTheme.primary)
                Text("Shared Content")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(ShareTheme.textSecondary)
            }

            if sharedText.isEmpty {
                Text("No text content shared.")
                    .font(.system(size: 15))
                    .foregroundColor(ShareTheme.textTertiary)
                    .italic()
            } else {
                Text(sharedText)
                    .font(.system(size: 15))
                    .foregroundColor(ShareTheme.textPrimary)
                    .lineLimit(8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(ShareTheme.spacingMd)
        .background(ShareTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    // MARK: - Additional Prompt

    private var additionalPromptField: some View {
        VStack(alignment: .leading, spacing: ShareTheme.spacingSm) {
            Text("Add instructions (optional)")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(ShareTheme.textSecondary)

            TextField("e.g. Summarize this, explain the key points...", text: $additionalText, axis: .vertical)
                .textFieldStyle(.plain)
                .font(.system(size: 15))
                .foregroundColor(ShareTheme.textPrimary)
                .lineLimit(2...5)
                .padding(ShareTheme.spacingSm)
                .background(ShareTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    // MARK: - Conversation Picker

    private var conversationPicker: some View {
        VStack(alignment: .leading, spacing: ShareTheme.spacingSm) {
            Text("Destination")
                .font(.system(size: 12, weight: .bold))
                .foregroundColor(ShareTheme.textSecondary)

            ForEach(conversationOptions, id: \.self) { option in
                Button {
                    selectedConversation = option
                } label: {
                    HStack {
                        Image(systemName: option == "New Conversation" ? "plus.bubble" : "bubble.left")
                            .font(.system(size: 14))
                            .foregroundColor(ShareTheme.primary)
                            .frame(width: 24)

                        Text(option)
                            .font(.system(size: 15))
                            .foregroundColor(ShareTheme.textPrimary)

                        Spacer()

                        if selectedConversation == option {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 18))
                                .foregroundColor(ShareTheme.primary)
                        } else {
                            Image(systemName: "circle")
                                .font(.system(size: 18))
                                .foregroundColor(ShareTheme.textTertiary)
                        }
                    }
                    .padding(ShareTheme.spacingSm)
                    .background(ShareTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }

    // MARK: - Footer

    private var footer: some View {
        Button(action: send) {
            HStack(spacing: 8) {
                if isSending {
                    ProgressView()
                        .tint(.white)
                        .scaleEffect(0.8)
                } else {
                    Image(systemName: "paperplane.fill")
                        .font(.system(size: 14))
                }
                Text(isSending ? "Sending..." : "Send to WOTANN")
                    .font(.system(size: 17, weight: .semibold))
            }
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                canSend
                    ? ShareTheme.primary
                    : ShareTheme.primary.opacity(0.4)
            )
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .disabled(!canSend || isSending)
        .padding(ShareTheme.spacingMd)
    }

    private var canSend: Bool {
        !sharedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !additionalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func send() {
        isSending = true
        let content: String
        if additionalText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            content = sharedText
        } else {
            content = "\(additionalText)\n\n---\n\(sharedText)"
        }
        onSend(selectedConversation, content)
    }
}

// MARK: - ShareTheme

/// Uses WTheme tokens since share extension is in the same compilation unit.
private enum ShareTheme {
    static let background    = WTheme.Colors.background
    static let surface       = WTheme.Colors.surface
    static let primary       = WTheme.Colors.primary
    static let textPrimary   = WTheme.Colors.textPrimary
    static let textSecondary = WTheme.Colors.textSecondary
    static let textTertiary  = WTheme.Colors.textTertiary
    static let border        = WTheme.Colors.border

    static let spacingSm     = WTheme.Spacing.sm
    static let spacingMd     = WTheme.Spacing.md
}

// MARK: - Previews

#Preview("Share View - With Text") {
    ShareView(
        sharedText: "Here is an interesting article about SwiftUI performance optimizations and how to avoid common pitfalls when building complex view hierarchies.",
        onSend: { _, _ in },
        onCancel: {}
    )
    .preferredColorScheme(.dark)
}

#Preview("Share View - Empty") {
    ShareView(
        sharedText: "",
        onSend: { _, _ in },
        onCancel: {}
    )
    .preferredColorScheme(.dark)
}
