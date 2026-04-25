import SwiftUI
import UIKit

// MARK: - PairingWizardView

/// Phase E wizard with 3 ranked pairing paths:
///   1. Auto-detected LAN (AutoDetectedCard) — one-tap
///   2. Magic link — paste from clipboard
///   3. QR scan — existing QRScannerView
/// Plus a "No Mac?" fallback link at the bottom.
///
/// Presents `FirstRunSuccessView` on success.
struct PairingWizardView: View {
    let onComplete: () -> Void

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var connectionManager: ConnectionManager
    @Environment(\.dismiss) private var dismiss

    @State private var magicLink = ""
    @State private var isPairing = false
    @State private var errorMessage: String?
    @State private var showScanner = false
    @State private var showSuccess = false

    // Bonjour state — local to the wizard because ConnectionManager doesn't
    // expose `autoDetectedPeer`. The property is optional and missing here, so
    // we fall back to running discovery locally.
    @StateObject private var discovery = BonjourDiscovery()
    @State private var autoDetectedHost: BonjourDiscovery.DiscoveredHost?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: WTheme.Spacing.lg) {
                        header
                            .padding(.top, WTheme.Spacing.md)

                        // 1. Auto-detected (top priority)
                        if let host = autoDetectedHost {
                            AutoDetectedCard(
                                deviceName: host.name,
                                isPairing: isPairing,
                                onConnect: { connectAutoDetected(host) }
                            )
                            .transition(.opacity.combined(with: .move(edge: .top)))
                        }

                        // 2. Magic link
                        magicLinkSection

                        // 3. QR scan
                        qrScanSection

                        if let message = errorMessage {
                            Text(message)
                                .font(.wotannScaled(size: 13, weight: .medium, design: .rounded))
                                .foregroundStyle(WTheme.Colors.error)
                                .padding(WTheme.Spacing.md)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(WTheme.Colors.error.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))
                        }

                        Spacer(minLength: WTheme.Spacing.xl)

                        noMacLink
                    }
                    .padding(.horizontal, WTheme.Spacing.lg)
                    .padding(.bottom, WTheme.Spacing.xl)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(WTheme.Colors.primary)
                }
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showScanner) {
                QRScannerView { code in
                    showScanner = false
                    handleScannedCode(code)
                }
            }
            .fullScreenCover(isPresented: $showSuccess) {
                FirstRunSuccessView(onDone: {
                    showSuccess = false
                    onComplete()
                })
                .environmentObject(appState)
                .environmentObject(connectionManager)
            }
            .task { startDiscovery() }
            .onChange(of: discovery.discoveredHosts) { _, hosts in
                withAnimation(WTheme.Animation.smooth) {
                    autoDetectedHost = hosts.first
                }
            }
            .onChange(of: connectionManager.isPaired) { _, paired in
                if paired {
                    showSuccess = true
                    // V9 T5.3 / T5.7 — attach RPC subscriptions once
                    // pairing succeeds so live-activity and delivery
                    // pushes start flowing immediately. Both services
                    // are idempotent on re-attach.
                    LiveActivityManager.shared.attachRPC(connectionManager.rpcClient)
                    NotificationService.shared.attachRPC(connectionManager.rpcClient)
                }
            }
        }
    }

    // MARK: - Header

    private var header: some View {
        VStack(spacing: WTheme.Spacing.sm) {
            Image(systemName: "w.square.fill")
                .font(.wotannScaled(size: 48, weight: .bold))
                .foregroundStyle(WTheme.Colors.primary)
                .shadow(color: WTheme.Colors.primary.opacity(0.5), radius: 20)

            Text("Link your Mac")
                .font(.wotannScaled(size: 28, weight: .bold, design: .rounded))
                .tracking(WTheme.Tracking.displaySmall)
                .foregroundStyle(.white)

            Text("Pick the fastest way to connect.")
                .font(.wotannScaled(size: 15, weight: .regular, design: .rounded))
                .foregroundStyle(WTheme.Colors.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Magic Link Section

    private var magicLinkSection: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Label {
                Text("Magic link")
                    .font(.wotannScaled(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
            } icon: {
                Image(systemName: "link")
                    .font(.wotannScaled(size: 15, weight: .medium))
                    .foregroundStyle(WTheme.Colors.primary)
            }

            VStack(spacing: WTheme.Spacing.sm) {
                TextField("wotann://pair?...", text: $magicLink)
                    .font(.wotannScaled(size: 15, weight: .regular, design: .rounded))
                    .foregroundStyle(.white)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .padding(WTheme.Spacing.md)
                    .background(Color(hex: 0x2C2C2E))
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))

                HStack(spacing: WTheme.Spacing.sm) {
                    // Paste chip
                    Button(action: pasteFromClipboard) {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.on.clipboard")
                                .font(.wotannScaled(size: 13, weight: .medium))
                            Text("Paste from clipboard")
                                .font(.wotannScaled(size: 13, weight: .semibold, design: .rounded))
                        }
                        .foregroundStyle(WTheme.Colors.primary)
                        .padding(.horizontal, WTheme.Spacing.md)
                        .frame(minHeight: 32)
                        .background(WTheme.Colors.primary.opacity(0.12))
                        .clipShape(Capsule())
                    }

                    Spacer()

                    Button("Connect") {
                        connectFromMagicLink()
                    }
                    .font(.wotannScaled(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .frame(minHeight: 44)
                    .background(
                        magicLink.isEmpty || isPairing
                        ? WTheme.Colors.primary.opacity(0.4)
                        : WTheme.Colors.primary
                    )
                    .clipShape(Capsule())
                    .disabled(magicLink.isEmpty || isPairing)
                }
            }
        }
        .padding(WTheme.Spacing.md)
        .background(Color(hex: 0x1C1C1E))
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
    }

    // MARK: - QR Scan Section

    private var qrScanSection: some View {
        Button {
            showScanner = true
        } label: {
            HStack(spacing: WTheme.Spacing.md) {
                Image(systemName: "qrcode.viewfinder")
                    .font(.wotannScaled(size: 22, weight: .medium))
                    .foregroundStyle(WTheme.Colors.primary)
                    .frame(width: 44, height: 44)
                    .background(WTheme.Colors.primary.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))

                VStack(alignment: .leading, spacing: 2) {
                    Text("Scan QR code")
                        .font(.wotannScaled(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white)
                    Text("Shown by `wotann link`")
                        .font(.wotannScaled(size: 13, weight: .regular, design: .rounded))
                        .foregroundStyle(WTheme.Colors.textTertiary)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.wotannScaled(size: 14, weight: .semibold))
                    .foregroundStyle(WTheme.Colors.textTertiary)
            }
            .padding(WTheme.Spacing.md)
            .frame(minHeight: 72)
            .background(Color(hex: 0x1C1C1E))
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg, style: .continuous))
        }
        .disabled(isPairing)
    }

    // MARK: - No Mac Fallback

    private var noMacLink: some View {
        Link(destination: URL(string: "https://wotann.com/download")!) {
            HStack(spacing: WTheme.Spacing.xs) {
                Text("No Mac?")
                    .font(.wotannScaled(size: 13, weight: .regular, design: .rounded))
                    .foregroundStyle(WTheme.Colors.textTertiary)
                Text("Download for desktop")
                    .font(.wotannScaled(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(WTheme.Colors.primary)
                Image(systemName: "arrow.up.right")
                    .font(.wotannScaled(size: 11, weight: .semibold))
                    .foregroundStyle(WTheme.Colors.primary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, WTheme.Spacing.md)
        }
    }

    // MARK: - Actions

    private func startDiscovery() {
        discovery.startDiscovery()
    }

    private func pasteFromClipboard() {
        if let pasted = UIPasteboard.general.string, !pasted.isEmpty {
            magicLink = pasted
        }
    }

    private func connectFromMagicLink() {
        guard let info = connectionManager.parsePairingQR(magicLink.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            errorMessage = "That link doesn't look like a WOTANN pairing URL."
            return
        }
        performPairing(info)
    }

    private func handleScannedCode(_ code: String) {
        guard let info = connectionManager.parsePairingQR(code) else {
            errorMessage = "Couldn't read that QR code. Try again."
            return
        }
        performPairing(info)
    }

    private func connectAutoDetected(_ host: BonjourDiscovery.DiscoveredHost) {
        let info = ConnectionManager.PairingInfo(
            id: "bonjour-\(UUID().uuidString.prefix(8))",
            pin: "000000",
            host: host.host,
            port: Int(host.port)
        )
        performPairing(info)
    }

    private func performPairing(_ info: ConnectionManager.PairingInfo) {
        isPairing = true
        errorMessage = nil

        Task {
            do {
                try await connectionManager.pair(with: info)
                HapticService.shared.trigger(.pairingSuccess)
                // showSuccess is flipped by the `isPaired` observer.
            } catch {
                HapticService.shared.trigger(.pairingFailed)
                errorMessage = "Pairing failed: \(error.localizedDescription)"
            }
            isPairing = false
        }
    }
}

// MARK: - Preview

#Preview("PairingWizard") {
    PairingWizardView(onComplete: {})
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
