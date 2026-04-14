import SwiftUI

// MARK: - PairedDevicesView

/// Manage paired desktop devices.
struct PairedDevicesView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showUnpairAlert = false

    var body: some View {
        List {
            if let device = connectionManager.pairedDevice {
                Section("Paired Device") {
                    HStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "desktopcomputer")
                            .font(.title2)
                            .foregroundColor(WTheme.Colors.primary)
                            .frame(width: 40, height: 40)
                            .background(WTheme.Colors.primary.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))

                        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                            Text(device.name)
                                .font(WTheme.Typography.headline)
                                .foregroundColor(WTheme.Colors.textPrimary)

                            Text("\(device.host):\(device.port)")
                                .font(WTheme.Typography.code)
                                .foregroundColor(WTheme.Colors.textSecondary)
                        }

                        Spacer()

                        Circle()
                            .fill(connectionManager.isConnected ? WTheme.Colors.success : WTheme.Colors.error)
                            .frame(width: 10, height: 10)
                    }
                    .listRowBackground(WTheme.Colors.surface)

                    LabeledContent("Status") {
                        Text(connectionManager.connectionStatus.rawValue)
                            .foregroundColor(
                                connectionManager.isConnected
                                    ? WTheme.Colors.success
                                    : WTheme.Colors.error
                            )
                    }
                    .listRowBackground(WTheme.Colors.surface)

                    LabeledContent("Paired On") {
                        Text(device.pairedAt, style: .date)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                    .listRowBackground(WTheme.Colors.surface)
                }

                Section {
                    Button(role: .destructive) {
                        showUnpairAlert = true
                    } label: {
                        HStack {
                            Spacer()
                            Text("Unpair Device")
                                .fontWeight(.semibold)
                            Spacer()
                        }
                    }
                    .listRowBackground(WTheme.Colors.error.opacity(0.1))
                }
            } else {
                Section {
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "link.circle")
                            .font(.system(size: 48))
                            .foregroundColor(WTheme.Colors.textTertiary)
                        Text("No devices paired")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Text("Go to the pairing screen to connect your desktop.")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WTheme.Spacing.xl)
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(WTheme.Colors.background)
        .navigationTitle("Paired Devices")
        .navigationBarTitleDisplayMode(.inline)
        .alert("Unpair Device?", isPresented: $showUnpairAlert) {
            Button("Unpair", role: .destructive) {
                connectionManager.unpair()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will disconnect and remove all pairing data.")
        }
    }
}
