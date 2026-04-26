import SwiftUI

// MARK: - ConversationRow

/// Preview row showing title, last message, cost, provider badge, and timestamp.
struct ConversationRow: View {
    let conversation: Conversation

    private var providerColor: Color {
        WTheme.Colors.provider(conversation.provider)
    }

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            // Leading accent bar colored by provider
            if conversation.messageCount > 0 {
                RoundedRectangle(cornerRadius: 2)
                    .fill(
                        LinearGradient(
                            colors: [providerColor, providerColor.opacity(0.4)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(width: 3, height: 44)
            }

            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                // Top: title + timestamp
                HStack(alignment: .firstTextBaseline) {
                    if conversation.isStarred {
                        Image(systemName: "star.fill")
                            .font(.wotannScaled(size: 10))
                            .foregroundColor(WTheme.Colors.warning)
                    }

                    if conversation.isIncognito {
                        Image(systemName: "eye.slash.fill")
                            .font(.wotannScaled(size: 10))
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }

                    Text(conversation.title)
                        .font(WTheme.Typography.subheadline)
                        .fontWeight(.semibold)
                        .tracking(WTheme.Tracking.tight)
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .lineLimit(1)

                    Spacer()

                    // Refined time display with monospaced digits
                    Text(conversation.updatedAt, style: .relative)
                        .font(.wotannScaled(size: 11, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textTertiary)
                }

                // Middle: preview
                if !conversation.preview.isEmpty {
                    Text(conversation.preview)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .lineLimit(2)
                }

                // Bottom: provider badge, cost, message count
                HStack(spacing: WTheme.Spacing.sm) {
                    ProviderBadge(provider: conversation.provider, size: .small)

                    if conversation.cost > 0 {
                        CostLabel(amount: conversation.cost, style: .compact)
                    }

                    Spacer()

                    HStack(spacing: 2) {
                        Image(systemName: "bubble.left.fill")
                            .font(.wotannScaled(size: 8))
                        Text("\(conversation.messageCount)")
                            .font(WTheme.Typography.caption2)
                    }
                    .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
        }
        .padding(.vertical, WTheme.Spacing.sm)
        .contentShape(Rectangle())
        // Subtle shadow-ring for card depth (Vercel-style)
        .shadow(
            color: WTheme.Shadow.ring.color,
            radius: WTheme.Shadow.ring.radius,
            x: WTheme.Shadow.ring.x,
            y: WTheme.Shadow.ring.y
        )
    }
}

#Preview {
    List {
        ConversationRow(conversation: Conversation(
            title: "Debug WebSocket Issue",
            messages: [
                Message(role: .user, content: "Why is the WebSocket disconnecting after 30 seconds?"),
                Message(role: .assistant, content: "The heartbeat interval is set to 30s but the server expects pings every 15s...")
            ],
            // Sample data — pick a non-Anthropic vendor so the preview
            // doesn't bias the user's mental model. Also avoids the
            // stale claude-opus-4-6 ID (retires Jun 15 2026).
            provider: "ollama",
            model: "qwen3-coder:30b",
            isStarred: true,
            cost: 0.0234
        ))
        ConversationRow(conversation: Conversation(
            title: "React Component Review",
            provider: "openai",
            model: "gpt-4o",
            cost: 0.0089
        ))
    }
    .listStyle(.plain)
    .preferredColorScheme(.dark)
}
