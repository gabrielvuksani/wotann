import SwiftUI

/// Shown when the device is paired but the WOTANN Engine (KAIROS daemon) is unreachable.
///
/// Three scenarios handled:
/// 1. Desktop is off/asleep → "Wake Desktop" + "Try Again"
/// 2. Desktop is on but daemon crashed → "Start Engine" instructions
/// 3. User wants to work offline → "Use Offline Mode" (if on-device model downloaded)
///
/// This view replaces MainTabView in the navigation flow when paired but disconnected.
struct DaemonOfflineView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    // S4-25: read the singleton injected at app startup instead of allocating
    // a fresh service every time this view's body recomputes `canUseOffline`.
    @EnvironmentObject var onDeviceModelService: OnDeviceModelService

    @State private var isRetrying = false
    @State private var retryCount = 0
    @State private var showOfflineOption = false

    /// Check if on-device model is available for offline use.
    private var canUseOffline: Bool {
        onDeviceModelService.isModelDownloaded && onDeviceModelService.canRunOnDevice
    }

    /// Paired device info from keychain
    private var pairedDeviceName: String {
        connectionManager.pairedDevice?.name ?? "Desktop"
    }

    var body: some View {
        VStack(spacing: WTheme.Spacing.xl) {
            Spacer()

            // Status icon — pulsing when retrying
            ZStack {
                Circle()
                    .fill(WTheme.Colors.surface)
                    .frame(width: 96, height: 96)

                Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                    .font(.system(size: 36, weight: .light))
                    .foregroundStyle(WTheme.Colors.warning)
            }
            .padding(.bottom, WTheme.Spacing.sm)

            // Title
            Text("Engine Offline")
                .font(WTheme.Typography.title2)
                .foregroundStyle(WTheme.Colors.textPrimary)

            // Subtitle with device name
            Text("Your \(pairedDeviceName) isn't running the WOTANN Engine right now.")
                .font(WTheme.Typography.body)
                .foregroundStyle(WTheme.Colors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, WTheme.Spacing.xl)

            // Connection status pill
            HStack(spacing: WTheme.Spacing.xs) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 6, height: 6)
                Text(connectionManager.connectionStatus.rawValue)
                    .font(WTheme.Typography.caption)
                    .foregroundStyle(WTheme.Colors.textTertiary)
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.xs)
            .background(WTheme.Colors.surface)
            .clipShape(Capsule())

            Spacer()

            // Action buttons
            VStack(spacing: WTheme.Spacing.md) {
                // Primary: Try Again
                Button {
                    retryConnection()
                } label: {
                    HStack(spacing: WTheme.Spacing.sm) {
                        if isRetrying {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                        Text(isRetrying ? "Connecting..." : "Try Again")
                    }
                    .font(WTheme.Typography.headline)
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .padding(.vertical, WTheme.Spacing.md)
                    .background(WTheme.Colors.primary)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg))
                }
                .disabled(isRetrying)

                // Secondary: Use Offline Mode (if model available)
                if canUseOffline {
                    Button {
                        enterOfflineMode()
                    } label: {
                        HStack(spacing: WTheme.Spacing.sm) {
                            Image(systemName: "iphone.gen3")
                            Text("Use Offline Mode")
                        }
                        .font(WTheme.Typography.subheadline)
                        .foregroundStyle(WTheme.Colors.primary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.vertical, WTheme.Spacing.md)
                        .background(WTheme.Colors.primary.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg))
                    }
                }

                // Tertiary: Unpair and re-setup
                Button {
                    connectionManager.unpair()
                } label: {
                    Text("Unpair and Set Up Again")
                        .font(WTheme.Typography.footnote)
                        .foregroundStyle(WTheme.Colors.textTertiary)
                }
                .padding(.top, WTheme.Spacing.sm)
            }
            .padding(.horizontal, WTheme.Spacing.xl)

            // Help text
            VStack(spacing: WTheme.Spacing.xs) {
                Text("Make sure your Mac is on and run:")
                    .font(WTheme.Typography.caption2)
                    .foregroundStyle(WTheme.Colors.textTertiary)
                Text("wotann engine start")
                    .font(WTheme.Typography.codeSmall)
                    .foregroundStyle(WTheme.Colors.primary)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .padding(.vertical, WTheme.Spacing.xs)
                    .background(WTheme.Colors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
            .padding(.bottom, WTheme.Spacing.xl)
        }
        .background(WTheme.Colors.background)
        .onAppear {
            // Auto-retry once on appear
            retryConnection()
        }
    }

    // MARK: - Actions

    private func retryConnection() {
        guard !isRetrying else { return }
        isRetrying = true
        retryCount += 1

        HapticService.shared.trigger(.buttonTap)

        Task {
            // Try reconnecting through ConnectionManager
            await connectionManager.reconnect()

            // Wait briefly for connection to establish
            try? await Task.sleep(nanoseconds: 3_000_000_000) // 3 seconds

            await MainActor.run {
                isRetrying = false
            }
        }
    }

    private func enterOfflineMode() {
        HapticService.shared.trigger(.buttonTap)
        // Set a flag that tells the app to use on-device model
        connectionManager.forceOfflineMode = true
    }

    private var statusColor: Color {
        switch connectionManager.connectionStatus {
        case .connected, .relay:
            return WTheme.Colors.success
        case .connecting, .reconnecting, .pairing:
            return WTheme.Colors.warning
        case .disconnected, .error:
            return WTheme.Colors.error
        }
    }
}
