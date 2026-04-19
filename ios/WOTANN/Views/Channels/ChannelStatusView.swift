import SwiftUI

// MARK: - ChannelStatusView

/// Shows connected messaging channels (Telegram, Slack, Discord, etc.)
struct ChannelStatusView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var channels: [ChannelInfo] = []
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if isLoading {
                    Spacer()
                    ProgressView()
                        .tint(WTheme.Colors.primary)
                    Spacer()
                } else if channels.isEmpty {
                    Spacer()
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "bubble.left.and.bubble.right")
                            .font(.wotannScaled(size: 40))
                            .foregroundColor(WTheme.Colors.textTertiary)
                        Text("No channels connected")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                        Text("Connect Telegram, Slack, or Discord from your desktop to receive messages here.")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textTertiary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, WTheme.Spacing.xl)
                    }
                    Spacer()
                } else {
                    List(channels) { channel in
                        ChannelRow(channel: channel)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Channels")
            .navigationBarTitleDisplayMode(.large)
            .onAppear { loadChannels() }
        }
    }

    private func loadChannels() {
        guard connectionManager.isPaired else { return }
        isLoading = true
        Task {
            do {
                let result = try await connectionManager.rpcClient.getChannelStatus()
                await MainActor.run {
                    channels = result.compactMap { dict in
                        guard let name = dict["name"]?.stringValue else { return nil }
                        let connected = dict["connected"]?.boolValue ?? true
                        return ChannelInfo(name: name, connected: connected)
                    }
                    isLoading = false
                }
            } catch {
                await MainActor.run { isLoading = false }
            }
        }
    }
}

// MARK: - ChannelInfo

struct ChannelInfo: Identifiable {
    let id = UUID()
    let name: String
    let connected: Bool
}

// MARK: - ChannelRow

struct ChannelRow: View {
    let channel: ChannelInfo

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            Image(systemName: channelIcon)
                .font(.wotannScaled(size: 16))
                .foregroundColor(WTheme.Colors.primary)
                .frame(width: 32, height: 32)
                .background(WTheme.Colors.primary.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            VStack(alignment: .leading, spacing: 2) {
                Text(channel.name)
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(channel.connected ? "Connected" : "Disconnected")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(channel.connected ? WTheme.Colors.success : WTheme.Colors.textTertiary)
            }
            Spacer()
            Circle()
                .fill(channel.connected ? WTheme.Colors.success : WTheme.Colors.textTertiary)
                .frame(width: 8, height: 8)
        }
        .padding(.vertical, WTheme.Spacing.xs)
    }

    private var channelIcon: String {
        let lower = channel.name.lowercased()
        if lower.contains("telegram") { return "paperplane.fill" }
        if lower.contains("slack") { return "number" }
        if lower.contains("discord") { return "gamecontroller.fill" }
        if lower.contains("email") { return "envelope.fill" }
        return "bubble.left.fill"
    }
}

#Preview {
    ChannelStatusView()
        .preferredColorScheme(.dark)
}
