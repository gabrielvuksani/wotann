import SwiftUI

// MARK: - AmbientCrossDeviceView

/// 72pt horizontal row showing paired devices as stacked avatars with
/// presence dots. Renders only from live state:
/// - This device (iPhone)
/// - The paired desktop (when `connectionManager.pairedDevice` is non-nil)
/// - Apple Watch (when connected) — presence is derived from
///   `appState.currentProvider` reachability (no dedicated service exists yet,
///   so we conservatively hide the watch row until WCSession exposes state).
///
/// The view collapses to nothing if the only device is this phone and no
/// desktop is paired — we avoid rendering a lonely "you" avatar.
struct AmbientCrossDeviceView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager

    var body: some View {
        if devices.count < 2 {
            EmptyView()
        } else {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                Text("DEVICES")
                    .font(WTheme.Typography.captionStd)
                    .tracking(WTheme.Tracking.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)

                HStack(spacing: WTheme.Spacing.md) {
                    ForEach(devices) { device in
                        DeviceAvatar(device: device)
                    }
                    Spacer(minLength: 0)
                    summaryText
                }
                .frame(height: 72)
                .padding(.horizontal, WTheme.Spacing.md)
                .background(WTheme.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous)
                        .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
                )
            }
        }
    }

    // MARK: - Derived Devices

    private var devices: [DeviceEntry] {
        var entries: [DeviceEntry] = [
            DeviceEntry(
                id: "phone",
                icon: "iphone",
                label: "This iPhone",
                online: true
            ),
        ]
        if let desktop = connectionManager.pairedDevice {
            entries.append(
                DeviceEntry(
                    id: "desktop-\(desktop.id)",
                    icon: "desktopcomputer",
                    label: desktop.name,
                    online: connectionManager.isConnected
                )
            )
        }
        return entries
    }

    private var summaryText: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(connectionManager.isConnected ? "Synced" : "Offline")
                .font(WTheme.Typography.captionStd)
                .foregroundColor(connectionManager.isConnected ? WTheme.Colors.success : WTheme.Colors.textTertiary)
            Text("\(devices.count) devices")
                .font(.wotannScaled(size: 10))
                .foregroundColor(WTheme.Colors.textTertiary)
        }
    }
}

// MARK: - DeviceEntry Model

/// A pure-data representation of a device shown in the ambient row.
private struct DeviceEntry: Identifiable, Equatable {
    let id: String
    let icon: String
    let label: String
    let online: Bool
}

// MARK: - DeviceAvatar

private struct DeviceAvatar: View {
    let device: DeviceEntry

    var body: some View {
        VStack(spacing: WTheme.Spacing.xxs) {
            ZStack(alignment: .bottomTrailing) {
                ZStack {
                    Circle()
                        .fill(WTheme.Colors.surfaceAlt)
                        .frame(width: 40, height: 40)
                    Image(systemName: device.icon)
                        .font(.wotannScaled(size: 18, weight: .semibold))
                        .foregroundColor(WTheme.Colors.textPrimary)
                }
                Circle()
                    .fill(device.online ? WTheme.Colors.success : WTheme.Colors.textTertiary)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(WTheme.Colors.surface, lineWidth: 2))
                    .offset(x: 2, y: 2)
            }
            Text(device.label)
                .font(.wotannScaled(size: 10))
                .foregroundColor(WTheme.Colors.textSecondary)
                .lineLimit(1)
                .frame(maxWidth: 70)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(device.label), \(device.online ? "online" : "offline")")
    }
}
