import SwiftUI

// MARK: - AutoDetectedCard

/// 88pt card surfaced at the top of the pairing wizard when Bonjour discovers
/// a WOTANN desktop on the local network. Tapping the CTA triggers a one-tap
/// pair to the discovered host. The amber status dot pulses while pairing is
/// in progress, turning steady once paired or idle.
struct AutoDetectedCard: View {
    /// Human-readable Mac name (e.g. "Gabriel's MacBook Pro").
    let deviceName: String
    /// True while the pairing handshake is underway.
    let isPairing: Bool
    /// Tapped when the user accepts the auto-detected connection.
    let onConnect: () -> Void

    @State private var pulse = false

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            // Mac icon tile
            ZStack {
                RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous)
                    .fill(WTheme.Colors.primary.opacity(0.12))

                Image(systemName: "desktopcomputer")
                    .font(.wotannScaled(size: 26, weight: .medium))
                    .foregroundStyle(WTheme.Colors.primary)
            }
            .frame(width: 56, height: 56)

            // Name + status
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: WTheme.Spacing.xs) {
                    Circle()
                        .fill(isPairing ? WTheme.Colors.warning : WTheme.Colors.success)
                        .frame(width: 8, height: 8)
                        .opacity(pulse && isPairing ? 0.35 : 1.0)
                        .animation(
                            isPairing
                            ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true)
                            : .linear(duration: 0),
                            value: pulse
                        )

                    Text(isPairing ? "Pairing…" : "Detected on LAN")
                        .font(.wotannScaled(size: 12, weight: .medium, design: .rounded))
                        .tracking(WTheme.Tracking.caption)
                        .foregroundStyle(WTheme.Colors.textSecondary)
                        .lineLimit(1)
                }

                Text("Mac '\(deviceName)'")
                    .font(.wotannScaled(size: 17, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
            }

            Spacer()

            // 44pt one-tap CTA
            Button(action: onConnect) {
                Text("Connect")
                    .font(.wotannScaled(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .frame(minHeight: 44)
                    .background(WTheme.Colors.primary)
                    .clipShape(Capsule())
            }
            .disabled(isPairing)
        }
        .padding(WTheme.Spacing.md)
        .frame(minHeight: 88)
        .background(Color(hex: 0x1C1C1E))
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous)
                .stroke(WTheme.Colors.primary.opacity(0.25), lineWidth: 1)
        )
        .onAppear { pulse = true }
    }
}

// MARK: - Preview

#Preview("AutoDetectedCard") {
    VStack(spacing: 16) {
        AutoDetectedCard(
            deviceName: "Gabriel's MacBook Pro",
            isPairing: false,
            onConnect: {}
        )
        AutoDetectedCard(
            deviceName: "Studio Mac",
            isPairing: true,
            onConnect: {}
        )
    }
    .padding()
    .background(Color.black)
    .preferredColorScheme(.dark)
}
