import SwiftUI

// MARK: - StatusRibbon

/// A 64pt edge-to-edge ribbon at the top of Home.
/// Left: connection dot + "Engine · Xms"
/// Right: today's cost + current provider chiclet
/// Tap: opens the Engine health sheet via `onTap`.
struct StatusRibbon: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    let onTap: () -> Void

    var body: some View {
        Button {
            Haptics.shared.buttonTap()
            onTap()
        } label: {
            HStack(spacing: WTheme.Spacing.sm) {
                left
                Spacer(minLength: WTheme.Spacing.sm)
                right
            }
            .frame(height: 64)
            .padding(.horizontal, WTheme.Spacing.md)
            // T7.3 — Liquid Glass ribbon under the gradient. On iOS 18 the
            // layered `ultraThinMaterial` is invisible beneath the opaque
            // gradient but preserves the shape for clipping; on iOS 26 the
            // gradient sits on top of true Liquid Glass.
            .background(ribbonBackground)
            .wLiquidGlass(
                in: RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous)
            )
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
        }
        .buttonStyle(.plain)
        .wotannAccessible(
            label: "Engine status: \(engineLabel), latency \(latencyLabel), cost today \(costLabel)",
            hint: "Opens engine health sheet"
        )
    }

    // MARK: - Left

    private var left: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            ZStack {
                Circle()
                    .fill(dotColor.opacity(0.2))
                    .frame(width: 18, height: 18)
                Circle()
                    .fill(dotColor)
                    .frame(width: 8, height: 8)
                    .shadow(color: dotColor.opacity(0.6), radius: 4, x: 0, y: 0)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(engineLabel)
                    .font(WTheme.Typography.roundedHeadline)
                    .tracking(WTheme.Tracking.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(latencyLabel)
                    .font(WTheme.Typography.captionStd)
                    .tracking(WTheme.Tracking.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .fontDesign(.monospaced)
            }
        }
    }

    // MARK: - Right

    private var right: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            VStack(alignment: .trailing, spacing: 2) {
                Text(costLabel)
                    .font(WTheme.Typography.roundedHeadline)
                    .tracking(WTheme.Tracking.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text("today")
                    .font(WTheme.Typography.captionStd)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            Text(appState.currentProvider.capitalized)
                .font(WTheme.Typography.captionStd)
                .tracking(WTheme.Tracking.caption)
                .foregroundColor(WTheme.Colors.provider(appState.currentProvider))
                .padding(.horizontal, WTheme.Spacing.sm)
                .padding(.vertical, WTheme.Spacing.xxs)
                .background(WTheme.Colors.provider(appState.currentProvider).opacity(0.14))
                .clipShape(Capsule())
        }
    }

    // MARK: - Background

    private var ribbonBackground: some View {
        LinearGradient(
            colors: [
                WTheme.Colors.surface,
                WTheme.Colors.surfaceAlt.opacity(0.6),
            ],
            startPoint: .leading,
            endPoint: .trailing
        )
    }

    // MARK: - Derived Labels

    private var engineLabel: String {
        switch connectionManager.connectionStatus {
        case .connected:    return "Engine"
        case .relay:        return "Engine · Remote"
        case .connecting:   return "Engine · Connecting"
        case .reconnecting: return "Engine · Reconnecting"
        case .pairing:      return "Engine · Pairing"
        case .disconnected: return "Engine · Offline"
        case .error:        return "Engine · Error"
        }
    }

    private var latencyLabel: String {
        let ms = connectionManager.latencyMs
        if ms <= 0 { return "—" }
        return "\(Int(ms))ms"
    }

    private var costLabel: String {
        let cost = appState.todayCost
        if cost == 0 { return "$0.00" }
        if cost < 0.01 { return "<$0.01" }
        return String(format: "$%.2f", cost)
    }

    private var dotColor: Color {
        switch connectionManager.connectionStatus {
        case .connected:            return WTheme.Colors.success
        case .relay:                return WTheme.Colors.primary
        case .connecting, .reconnecting, .pairing: return WTheme.Colors.warning
        case .disconnected, .error: return WTheme.Colors.error
        }
    }
}
