import SwiftUI

// MARK: - DashboardView

/// Dashboard Hub -- the Home tab of the WOTANN iOS app.
/// Provides a glanceable overview: greeting, quick stats, actions, and recent conversations.
struct DashboardView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showRemoteDesktop = false
    @State private var showPromptLibrary = false
    @State private var showMorningBriefing = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                    greetingHeader
                        .wStaggered(index: 0)

                    quickStatsRow
                        .wStaggered(index: 1)

                    quickActionsGrid
                        .wStaggered(index: 2)

                    recentConversationsSection
                        .wStaggered(index: 3)
                }
                .padding(WTheme.Spacing.lg)
            }
            .background(WTheme.Colors.background)
            .navigationBarHidden(true)
            .fullScreenCover(isPresented: $showRemoteDesktop) {
                RemoteDesktopView()
            }
            .sheet(isPresented: $showPromptLibrary) {
                PromptLibraryView()
                    .environmentObject(appState)
                    .environmentObject(connectionManager)
            }
            .sheet(isPresented: $showMorningBriefing) {
                MorningBriefingView()
                    .environmentObject(appState)
                    .environmentObject(connectionManager)
            }
        }
    }
}

// MARK: - Greeting Header

private extension DashboardView {

    var greetingHeader: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                Text(timeBasedGreeting)
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textSecondary)

                Text(userName)
                    .font(WTheme.Typography.title2)
                    .tracking(WTheme.Tracking.tighter)
                    .foregroundColor(WTheme.Colors.textPrimary)
            }

            Spacer()

            // Connection quality pill
            HStack(spacing: WTheme.Spacing.xs) {
                Circle()
                    .fill(connectionStatusColor)
                    .frame(width: 7, height: 7)
                    .shadow(color: connectionStatusColor.opacity(0.5), radius: 3, x: 0, y: 0)
                Text(connectionLabel)
                    .font(WTheme.Typography.caption2)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.textTertiary)
                if connectionManager.latencyMs > 0 {
                    Text("\(Int(connectionManager.latencyMs))ms")
                        .font(WTheme.Typography.caption2)
                        .fontDesign(.monospaced)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
            .padding(.horizontal, WTheme.Spacing.sm)
            .padding(.vertical, WTheme.Spacing.xs)
            .background(WTheme.Colors.surface)
            .clipShape(Capsule())
            .padding(.trailing, WTheme.Spacing.xs)

            NavigationLink {
                settingsDestination
            } label: {
                Image(systemName: "gearshape.fill")
                    .font(.wotannScaled(size: 20))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .frame(width: 44, height: 44)
                    .background(WTheme.Colors.surface)
                    .clipShape(Circle())
            }
            .accessibilityLabel("Settings")
        }
    }

    /// Resolves a time-based greeting string.
    var timeBasedGreeting: String {
        let hour = Calendar.current.component(.hour, from: .now)
        switch hour {
        case 5..<12:  return "Good morning"
        case 12..<17: return "Good afternoon"
        case 17..<21: return "Good evening"
        default:      return "Good night"
        }
    }

    /// User display name from UserDefaults, falling back to "there".
    var userName: String {
        UserDefaults.standard.string(forKey: "userName") ?? "there"
    }

    /// Connection status color for the dashboard pill.
    var connectionStatusColor: Color {
        switch connectionManager.connectionStatus {
        case .connected: return WTheme.Colors.success
        case .relay: return WTheme.Colors.warning
        case .connecting, .reconnecting, .pairing: return WTheme.Colors.warning
        case .disconnected, .error: return WTheme.Colors.error
        }
    }

    /// Human-readable connection label.
    var connectionLabel: String {
        switch connectionManager.connectionMode {
        case .local: return "Local"
        case .relay: return "Remote"
        case .offline: return "Offline"
        case .queued: return "Queued"
        }
    }

    @ViewBuilder
    var settingsDestination: some View {
        SettingsView()
    }
}

// MARK: - Quick Stats Row

private extension DashboardView {

    var quickStatsRow: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            StatCard(
                label: "Workers",
                value: "\(appState.activeAgents.count)",
                subtitle: activeWorkersSubtitle,
                tintColor: WTheme.Colors.success,
                iconName: "gearshape.2.fill"
            )

            StatCard(
                label: "Cost",
                value: formattedTodayCost,
                subtitle: "today",
                tintColor: WTheme.Colors.primary,
                iconName: "dollarsign.circle.fill"
            )

            StatCard(
                label: "Chats",
                value: "\(appState.conversations.count)",
                subtitle: nil,
                tintColor: WTheme.Colors.textSecondary,
                iconName: "bubble.left.and.bubble.right.fill"
            )
        }
    }

    var activeWorkersSubtitle: String {
        let count = appState.activeAgents.count
        return count == 1 ? "worker running" : "running"
    }

    var formattedTodayCost: String {
        let cost = appState.todayCost
        if cost < 0.01 && cost > 0 {
            return "<$0.01"
        }
        return String(format: "$%.2f", cost)
    }
}

// MARK: - StatCard

/// A compact stat card for the quick stats row.
/// Uses multi-layer shadow depth (Stripe-inspired) instead of flat background.
private struct StatCard: View {
    let label: String
    let value: String
    let subtitle: String?
    let tintColor: Color
    let iconName: String

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            Image(systemName: iconName)
                .font(WTheme.Typography.footnote)
                .foregroundColor(tintColor)

            Text(value)
                .font(WTheme.Typography.title3)
                .tracking(WTheme.Tracking.tighter)
                .foregroundColor(WTheme.Colors.textPrimary)

            HStack(spacing: WTheme.Spacing.xxs) {
                Text(label)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textSecondary)

                if let subtitle {
                    Text(subtitle)
                        .font(WTheme.Typography.caption2)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(WTheme.Spacing.md)
        .background(tintColor.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .stroke(tintColor.opacity(0.12), lineWidth: WTheme.BorderWidth.regular)
        )
        .shadow(
            color: WTheme.Shadow.sm.color,
            radius: WTheme.Shadow.sm.radius,
            x: WTheme.Shadow.sm.x,
            y: WTheme.Shadow.sm.y
        )
        .shadow(
            color: WTheme.Shadow.ring.color,
            radius: WTheme.Shadow.ring.radius,
            x: WTheme.Shadow.ring.x,
            y: WTheme.Shadow.ring.y
        )
    }
}

// MARK: - Quick Actions Grid

private extension DashboardView {

    var quickActionsGrid: some View {
        LazyVGrid(
            columns: [GridItem(.flexible()), GridItem(.flexible())],
            spacing: WTheme.Spacing.sm
        ) {
            DashboardActionCard(
                icon: "hammer.fill",
                label: "Start coding",
                description: "New build task",
                color: WTheme.Colors.primary,
                index: 0
            ) {
                navigateToNewChat(prompt: QuickActionPrompts.build)
            }

            DashboardActionCard(
                icon: "testtube.2",
                label: "Run tests",
                description: "Execute test suite",
                color: WTheme.Colors.success,
                index: 1
            ) {
                navigateToNewChat(prompt: "Run all tests and report the results. Fix any failures.")
            }

            DashboardActionCard(
                icon: "eye.fill",
                label: "Review code",
                description: "Quality check",
                color: WTheme.Colors.warning,
                index: 2
            ) {
                navigateToNewChat(prompt: QuickActionPrompts.review)
            }

            DashboardActionCard(
                icon: "magnifyingglass",
                label: "Research topic",
                description: "Deep dive",
                color: .wotannCyan,
                index: 3
            ) {
                navigateToNewChat(prompt: "Help me research a topic in depth. What would you like to explore?")
            }

            DashboardActionCard(
                icon: "desktopcomputer",
                label: "Remote Desktop",
                description: "Control your Mac",
                color: WTheme.Colors.primary,
                index: 4
            ) {
                showRemoteDesktop = true
            }

            DashboardActionCard(
                icon: "text.book.closed.fill",
                label: "Prompt Library",
                description: "Saved templates",
                color: WTheme.Colors.warning,
                index: 5
            ) {
                showPromptLibrary = true
            }

            DashboardActionCard(
                icon: "sun.and.horizon.fill",
                label: "Morning Briefing",
                description: "Daily digest",
                color: .wotannCyan,
                index: 6
            ) {
                HapticService.shared.trigger(.buttonTap)
                showMorningBriefing = true
            }
        }
    }

    /// Creates a new conversation, injects the prompt as a user message, and switches to Chat.
    func navigateToNewChat(prompt: String) {
        HapticService.shared.trigger(.buttonTap)
        let conversation = Conversation(
            title: "New Chat",
            provider: appState.currentProvider,
            model: appState.currentModel
        )
        appState.addConversation(conversation)

        if !prompt.isEmpty {
            let userMsg = Message(role: .user, content: prompt)
            appState.updateConversation(conversation.id) { conv in
                conv.messages.append(userMsg)
            }
        }

        // Switch to Chat tab
        appState.activeTab = 1
    }
}

// MARK: - DashboardActionCard

/// A quick action card tailored for the Dashboard grid.
/// Uses surface background with icon container and multi-layer shadow (Vercel-inspired).
private struct DashboardActionCard: View {
    let icon: String
    let label: String
    let description: String
    let color: Color
    let index: Int
    let onTap: () -> Void

    var body: some View {
        Button {
            HapticService.shared.trigger(.buttonTap)
            onTap()
        } label: {
            HStack(spacing: WTheme.Spacing.sm) {
                // Icon container with tinted background
                Image(systemName: icon)
                    .font(.wotannScaled(size: 16, weight: .semibold))
                    .foregroundColor(color)
                    .frame(width: 36, height: 36)
                    .background(color.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))

                VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                    Text(label)
                        .font(WTheme.Typography.subheadline)
                        .fontWeight(.semibold)
                        .tracking(WTheme.Tracking.tight)
                        .foregroundColor(WTheme.Colors.textPrimary)

                    Text(description)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(WTheme.Spacing.md)
            .background(WTheme.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                    .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
            )
            .shadow(
                color: WTheme.Shadow.sm.color,
                radius: WTheme.Shadow.sm.radius,
                x: WTheme.Shadow.sm.x,
                y: WTheme.Shadow.sm.y
            )
        }
        .buttonStyle(ScaleButtonStyle())
    }
}

/// A subtle press-in button style for interactive cards.
private struct ScaleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1.0)
            .opacity(configuration.isPressed ? 0.9 : 1.0)
            .animation(WTheme.Animation.quick, value: configuration.isPressed)
    }
}

// MARK: - Recent Conversations Section

private extension DashboardView {

    var recentConversationsSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("RECENT CONVERSATIONS")
                .font(WTheme.Typography.caption2)
                .fontWeight(.semibold)
                .foregroundColor(WTheme.Colors.textSecondary)
                .tracking(WTheme.Tracking.wide)
                .padding(.top, WTheme.Spacing.xs)

            if recentConversations.isEmpty {
                emptyConversationsPlaceholder
            } else {
                ForEach(Array(recentConversations.enumerated()), id: \.element.id) { index, conversation in
                    Button {
                        HapticService.shared.trigger(.buttonTap)
                        appState.activeConversationId = conversation.id
                        appState.activeTab = 1
                    } label: {
                        RecentConversationRow(
                            conversation: conversation,
                            index: index
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    /// Last 5 non-archived conversations sorted by most recent update.
    var recentConversations: [Conversation] {
        Array(
            appState.conversations
                .filter { !$0.isArchived }
                .sorted { $0.updatedAt > $1.updatedAt }
                .prefix(5)
        )
    }

    var emptyConversationsPlaceholder: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Image(systemName: "bubble.left.and.bubble.right")
                .font(.wotannScaled(size: 20))
                .foregroundColor(WTheme.Colors.textTertiary)

            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                Text("No conversations yet")
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(WTheme.Colors.textSecondary)

                Text("Start a chat or dispatch a task")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }

            Spacer()
        }
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
    }
}

// MARK: - RecentConversationRow

/// A single row in the recent conversations list with status dot, title, and time ago.
/// Enhanced with glow-on-active status dots and tighter headings (Cursor-inspired).
private struct RecentConversationRow: View {
    let conversation: Conversation
    let index: Int

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            statusDot

            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                Text(conversation.title)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .tracking(WTheme.Tracking.tight)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)

                Text(subtitleText)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(1)
            }

            Spacer()

            // Relative time in monospaced for alignment
            Text(relativeTime(from: conversation.updatedAt))
                .font(WTheme.Typography.caption2)
                .fontDesign(.monospaced)
                .foregroundColor(WTheme.Colors.textTertiary)

            if conversation.isStarred {
                Image(systemName: "star.fill")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.warning)
            }
        }
        .frame(minHeight: 44)
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .shadow(
            color: WTheme.Shadow.sm.color,
            radius: WTheme.Shadow.sm.radius,
            x: WTheme.Shadow.sm.x,
            y: WTheme.Shadow.sm.y
        )
    }

    // MARK: - Status Dot

    /// Color-coded dot with glow effect for active conversations.
    private var statusDot: some View {
        Circle()
            .fill(statusColor)
            .frame(width: 8, height: 8)
            .shadow(
                color: isRecentlyActive ? statusColor.opacity(0.6) : .clear,
                radius: isRecentlyActive ? 4 : 0,
                x: 0,
                y: 0
            )
    }

    private var isRecentlyActive: Bool {
        let timeSince = Date.now.timeIntervalSince(conversation.updatedAt)
        return timeSince < 3600 && !conversation.messages.isEmpty
    }

    private var statusColor: Color {
        let timeSince = Date.now.timeIntervalSince(conversation.updatedAt)
        if conversation.messages.isEmpty {
            return WTheme.Colors.warning // amber -- pending/empty
        } else if timeSince < 3600 {
            return WTheme.Colors.primary // blue -- recently active ("Working")
        } else {
            return WTheme.Colors.success // green -- done/idle
        }
    }

    // MARK: - Subtitle

    private var subtitleText: String {
        // Time is now shown separately in monospaced font; subtitle is status only
        return statusLabel
    }

    private var statusLabel: String {
        let timeSince = Date.now.timeIntervalSince(conversation.updatedAt)
        if conversation.messages.isEmpty {
            return "Pending..."
        } else if timeSince < 3600 {
            return "Working..."
        } else {
            return "Done"
        }
    }

    /// Formats a date into a human-readable relative string.
    private func relativeTime(from date: Date) -> String {
        let interval = Date.now.timeIntervalSince(date)
        let minutes = Int(interval) / 60
        let hours = minutes / 60
        let days = hours / 24

        if minutes < 1 {
            return "just now"
        } else if minutes < 60 {
            return "\(minutes)m ago"
        } else if hours < 24 {
            return "\(hours)h ago"
        } else if days == 1 {
            return "yesterday"
        } else {
            return "\(days)d ago"
        }
    }
}

// MARK: - Previews

#Preview("Dashboard - Dark") {
    DashboardView()
        .environmentObject(previewAppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}

#Preview("Dashboard - Light") {
    DashboardView()
        .environmentObject(previewAppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.light)
}

#Preview("Dashboard - Empty") {
    DashboardView()
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}

/// Creates a populated AppState for SwiftUI previews.
@MainActor
private func previewAppState() -> AppState {
    let state = AppState()

    // Sample conversations
    // Sample data rotates providers so the dashboard preview doesn't
    // bias the user's mental model toward Anthropic. v9 META-AUDIT.
    let conv1 = Conversation(
        title: "Auth flow refactor",
        messages: [
            Message(role: .user, content: "Help me refactor the auth flow"),
            Message(role: .assistant, content: "Sure, let me review the current implementation...")
        ],
        provider: "ollama",
        updatedAt: Date.now.addingTimeInterval(-7200)
    )
    let conv2 = Conversation(
        title: "Fix failing CI tests",
        messages: [
            Message(role: .user, content: "Tests are failing in CI"),
            Message(role: .assistant, content: "Looking into it...")
        ],
        provider: "openai",
        isStarred: true,
        updatedAt: Date.now.addingTimeInterval(-1800)
    )
    let conv3 = Conversation(
        title: "API design review",
        provider: "anthropic",
        updatedAt: Date.now.addingTimeInterval(-86400)
    )

    state.conversations = [conv1, conv2, conv3]

    // Sample agents — rotate providers in deterministic order.
    let agent1 = AgentTask(
        title: "Running tests",
        status: .running,
        progress: 0.65,
        provider: "google"
    )
    let agent2 = AgentTask(
        title: "Code review",
        status: .running,
        progress: 0.3,
        provider: "openai"
    )
    let agent3 = AgentTask(
        title: "Security scan",
        status: .queued,
        progress: 0,
        provider: "anthropic"
    )

    state.agents = [agent1, agent2, agent3]

    // Sample cost
    state.costSnapshot = CostSnapshot(
        todayTotal: 1.47,
        weekTotal: 8.23,
        monthTotal: 24.50,
        sessionTotal: 0.83,
        weeklyBudget: 50.0,
        byProvider: [],
        byDay: [],
        updatedAt: .now
    )

    return state
}
