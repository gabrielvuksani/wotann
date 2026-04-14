import SwiftUI

// MARK: - RecentConversationsStrip

/// 3 rows of the most recent conversations + a "See all" link.
/// Tapping a row opens that conversation in the Chat tab.
/// If no conversations exist, renders an EmptyState.
struct RecentConversationsStrip: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack {
                Text("RECENT")
                    .font(WTheme.Typography.captionStd)
                    .tracking(WTheme.Tracking.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
                Spacer()
                if !appState.conversations.isEmpty {
                    Button("See all") {
                        Haptics.shared.buttonTap()
                        appState.activeTab = 1
                    }
                    .font(WTheme.Typography.captionStd)
                    .foregroundColor(WTheme.Colors.primary)
                }
            }

            if recent.isEmpty {
                EmptyState(
                    icon: "bubble.left.and.bubble.right",
                    title: "No conversations yet",
                    subtitle: "Start a chat or dispatch a task from your desktop."
                )
                .frame(height: 140)
            } else {
                VStack(spacing: WTheme.Spacing.xs) {
                    ForEach(recent) { conv in
                        Button {
                            Haptics.shared.buttonTap()
                            appState.activeConversationId = conv.id
                            appState.activeTab = 1
                        } label: {
                            RecentRow(conversation: conv)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Recent Slice

    /// Top 3 non-archived conversations, sorted by last update.
    private var recent: [Conversation] {
        Array(
            appState.conversations
                .filter { !$0.isArchived }
                .sorted { $0.updatedAt > $1.updatedAt }
                .prefix(3)
        )
    }
}

// MARK: - RecentRow

/// A single row: status glyph + title + subtitle + monospaced relative time.
private struct RecentRow: View {
    let conversation: Conversation

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            glyph
                .frame(width: 14, height: 14)
            VStack(alignment: .leading, spacing: 2) {
                Text(conversation.title)
                    .font(WTheme.Typography.roundedHeadline)
                    .tracking(WTheme.Tracking.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)
                Text(subtitle)
                    .font(WTheme.Typography.footnoteStd)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: WTheme.Spacing.sm)
            Text(relativeTime)
                .font(.system(size: 11, weight: .regular, design: .monospaced))
                .foregroundColor(WTheme.Colors.textTertiary)
            if conversation.isStarred {
                Image(systemName: "star.fill")
                    .font(.system(size: 10))
                    .foregroundColor(WTheme.Colors.warning)
            }
        }
        .frame(minHeight: 56)
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(conversation.title). \(subtitle). Updated \(relativeTime)")
    }

    // MARK: - Derived

    /// Color + shape pairing for conversation state so color-blind users
    /// can still distinguish "working", "done", and "pending".
    private var glyph: some View {
        let state = derivedState
        return statusGlyph(for: state)
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(statusColor(for: state))
    }

    /// Derives a `TaskState` from conversation timing/content for reuse of
    /// the StatusShape tokens without inventing a new enum.
    private var derivedState: TaskState {
        let timeSince = Date.now.timeIntervalSince(conversation.updatedAt)
        if conversation.messages.isEmpty {
            return .queued
        } else if timeSince < 3600 {
            return .running
        } else {
            return .completed
        }
    }

    private var subtitle: String {
        if conversation.messages.isEmpty { return "Pending" }
        let preview = conversation.preview
        return preview.isEmpty ? conversation.provider.capitalized : preview
    }

    private var relativeTime: String {
        let interval = Date.now.timeIntervalSince(conversation.updatedAt)
        let minutes = Int(interval) / 60
        let hours = minutes / 60
        let days = hours / 24
        if minutes < 1 { return "now" }
        if minutes < 60 { return "\(minutes)m" }
        if hours < 24  { return "\(hours)h" }
        if days == 1   { return "1d" }
        return "\(days)d"
    }
}
