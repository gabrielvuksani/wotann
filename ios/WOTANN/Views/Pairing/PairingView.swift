import SwiftUI
@preconcurrency import CoreNFC

// MARK: - PairingView

/// Landing screen: scan QR code from desktop to connect.
struct PairingView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var showScanner = false
    @State private var manualHost = ""
    @State private var manualPort = "3849"
    @State private var errorMessage: String?
    @State private var isPairing = false
    @State private var showManual = false
    @State private var logoScale: CGFloat = 0.8
    @State private var logoOpacity: Double = 0
    @State private var isScanning = false
    @State private var discoveredHost: String?
    @StateObject private var nfcService = NFCPairingService()

    var body: some View {
        NavigationStack {
            ZStack {
                // Background gradient
                LinearGradient(
                    colors: [
                        WTheme.Colors.background,
                        WTheme.Colors.primary.opacity(0.05),
                        WTheme.Colors.background,
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .ignoresSafeArea()

                VStack(spacing: WTheme.Spacing.xl) {
                    Spacer()

                    // Logo
                    VStack(spacing: WTheme.Spacing.md) {
                        WLogo(size: 72, glowRadius: 20)
                            .scaleEffect(logoScale)
                            .opacity(logoOpacity)

                        Text("WOTANN")
                            .font(.wotannScaled(size: 40, weight: .black, design: .rounded))
                            .tracking(WTheme.Tracking.tighter)
                            .foregroundColor(WTheme.Colors.textPrimary)

                        Text("The All-Father of AI")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }

                    Spacer()

                    // Step indicator — labels kept short so all three fit
                    // without truncation on the narrow 3-chip row (session-10
                    // empirical audit found "Scan or discover" clipping to
                    // "Scan or disc…" on iPhone 17 Pro).
                    HStack(spacing: WTheme.Spacing.sm) {
                        StepPill(number: 1, label: "Open Mac", isActive: !isPairing)
                        StepPill(number: 2, label: "Pair", isActive: !isPairing)
                        StepPill(number: 3, label: "Connected", isActive: connectionManager.isPaired)
                    }
                    .padding(.horizontal, WTheme.Spacing.xl)

                    // Scan button
                    VStack(spacing: WTheme.Spacing.md) {
                        Button {
                            showScanner = true
                        } label: {
                            HStack(spacing: WTheme.Spacing.sm) {
                                Image(systemName: "qrcode.viewfinder")
                                    .font(.title3)
                                Text("Scan QR Code")
                                    .font(WTheme.Typography.headline)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .padding(.vertical, WTheme.Spacing.md)
                            .background(WTheme.Colors.primary)
                            .foregroundColor(.white)
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                        }
                        .disabled(isPairing)

                        // Scan local network for WOTANN desktop
                        Button {
                            isScanning = true
                            discoveredHost = nil
                            Task { @MainActor in
                                // Use Bonjour to find WOTANN on the network
                                let discovery = BonjourDiscovery()
                                discovery.startDiscovery()
                                // Poll for discovered hosts with a 10-second timeout
                                let deadline = Date().addingTimeInterval(10)
                                while Date() < deadline {
                                    try? await Task.sleep(nanoseconds: 500_000_000)
                                    if let found = discovery.discoveredHosts.first {
                                        discoveredHost = found.host
                                        isScanning = false
                                        // Auto-connect to discovered host
                                        let info = ConnectionManager.PairingInfo(
                                            id: "bonjour-\(UUID().uuidString.prefix(8))",
                                            pin: "000000",
                                            host: found.host,
                                            port: Int(found.port)
                                        )
                                        isPairing = true
                                        do {
                                            try await connectionManager.pair(with: info)
                                            HapticService.shared.trigger(.pairingSuccess)
                                        } catch {
                                            errorMessage = "Could not connect to \(found.host):\(found.port)"
                                            HapticService.shared.trigger(.pairingFailed)
                                        }
                                        isPairing = false
                                        discovery.stopDiscovery()
                                        return
                                    }
                                }
                                isScanning = false
                                errorMessage = "No WOTANN desktop found on this network. Make sure the desktop app is running."
                                discovery.stopDiscovery()
                            }
                        } label: {
                            HStack(spacing: WTheme.Spacing.sm) {
                                if isScanning {
                                    ProgressView()
                                        .progressViewStyle(.circular)
                                        .scaleEffect(0.8)
                                        .tint(WTheme.Colors.primary)
                                } else {
                                    Image(systemName: "wifi")
                                        .font(.title3)
                                }
                                Text(isScanning ? "Scanning..." : "Scan Network")
                                    .font(WTheme.Typography.headline)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .padding(.vertical, WTheme.Spacing.md)
                            .background(WTheme.Colors.surface)
                            .foregroundColor(WTheme.Colors.primary)
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                            .overlay(
                                RoundedRectangle(cornerRadius: WTheme.Radius.md)
                                    .stroke(WTheme.Colors.primary.opacity(0.3), lineWidth: 1)
                            )
                        }
                        .disabled(isPairing || isScanning)

                        if NFCPairingService.isAvailable {
                            Button {
                                handleNFCPairing()
                            } label: {
                                HStack(spacing: WTheme.Spacing.sm) {
                                    Image(systemName: "wave.3.right")
                                        .font(.title3)
                                    Text("NFC Tap to Pair")
                                        .font(WTheme.Typography.headline)
                                }
                                .frame(maxWidth: .infinity, minHeight: 44)
                                .padding(.vertical, WTheme.Spacing.md)
                                .background(WTheme.Colors.surface)
                                .foregroundColor(WTheme.Colors.primary)
                                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                                .overlay(
                                    RoundedRectangle(cornerRadius: WTheme.Radius.md)
                                        .stroke(WTheme.Colors.primary.opacity(0.3), lineWidth: 1)
                                )
                            }
                            .disabled(isPairing)
                        }

                        Text("Make sure WOTANN is running on your Mac.\nScan the QR code or let the app find it on your network.")
                            .multilineTextAlignment(.center)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                    .padding(.horizontal, WTheme.Spacing.xl)

                    // Manual toggle
                    Button {
                        withAnimation(WTheme.Animation.smooth) {
                            showManual.toggle()
                        }
                    } label: {
                        Text(showManual ? "Hide manual connection" : "Or connect manually")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }

                    // Manual connection
                    if showManual {
                        manualConnectionSection
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }

                    // V9 T5.13 — "Continue without pairing" escape hatch.
                    // Lets the user enter the main shell so on-device
                    // surfaces (Editor in browse mode, cached Exploit
                    // history, Memory snapshots, settings, on-device
                    // model preview) remain reachable even when there is
                    // no paired desktop. RPC-backed surfaces render an
                    // unpaired empty state via `connectionManager.isPaired`.
                    continueWithoutPairingButton

                    // Error
                    if let error = errorMessage {
                        Text(error)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.error)
                            .padding()
                            .background(WTheme.Colors.error.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                            .padding(.horizontal)
                    }

                    // Loading
                    if isPairing {
                        HStack(spacing: WTheme.Spacing.sm) {
                            ProgressView()
                                .tint(WTheme.Colors.primary)
                            Text("Pairing...")
                                .font(WTheme.Typography.subheadline)
                                .foregroundColor(WTheme.Colors.textSecondary)
                        }
                    }

                    Spacer()

                    // Footer
                    Text("Your data stays on your devices.\nAll communication is encrypted with AES-256-GCM.")
                        .multilineTextAlignment(.center)
                        .font(WTheme.Typography.caption2)
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .padding(.bottom, WTheme.Spacing.md)
                }
            }
            .navigationTitle("")
            .sheet(isPresented: $showScanner) {
                QRScannerView { code in
                    showScanner = false
                    handleScannedCode(code)
                }
            }
            .onAppear {
                withAnimation(WTheme.Animation.gentle) {
                    logoScale = 1.0
                    logoOpacity = 1.0
                }
                // Wire RPC subscriptions if a prior pairing was restored
                // from the keychain at app launch (ConnectionManager.init
                // restores isPaired before this view appears).
                wireRPCSubscriptionsIfPaired()
            }
            .onChange(of: connectionManager.isPaired) { _, paired in
                if paired {
                    wireRPCSubscriptionsIfPaired()
                }
            }
        }
    }

    // MARK: - RPC Subscription Wiring (T5.3 / T5.7)

    /// Attach the singleton RPC-backed services to the active client. We
    /// only attach when isPaired is true and the rpcClient is in scope.
    /// Both services guard against double-subscribe internally — calling
    /// twice is a no-op (quality bar #11 sibling-site scan).
    private func wireRPCSubscriptionsIfPaired() {
        guard connectionManager.isPaired else { return }
        LiveActivityManager.shared.attachRPC(connectionManager.rpcClient)
        NotificationService.shared.attachRPC(connectionManager.rpcClient)
    }

    // MARK: - Continue Without Pairing (T5.13)

    /// Tertiary affordance that lets the user enter the main shell with
    /// no paired desktop. We never call `connectionManager.pair(with:)`
    /// in this path — pairing implies an authenticated remote session.
    /// Instead we flip the `isPaired` state machine to its "ambient"
    /// position so `ContentView` falls through to `MainShell`. RPC-backed
    /// views check `connectionManager.isPaired` and present empty states.
    @ViewBuilder
    private var continueWithoutPairingButton: some View {
        Button {
            HapticService.shared.trigger(.buttonTap)
            // No network call — purely a UX bypass. The main shell will
            // show empty states for paired-only surfaces.
            connectionManager.isPaired = true
        } label: {
            Text("Continue without pairing")
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textTertiary)
                .underline()
                .padding(.vertical, WTheme.Spacing.xs)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Continue without pairing")
        .accessibilityHint("Enter the app without a paired desktop. Some features will require pairing.")
    }

    // MARK: - Manual Connection

    private var manualConnectionSection: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            TextField("Host (e.g. 192.168.1.5)", text: $manualHost)
                .textFieldStyle(.roundedBorder)
                .font(WTheme.Typography.caption)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            TextField("Port", text: $manualPort)
                .textFieldStyle(.roundedBorder)
                .font(WTheme.Typography.caption)
                .frame(width: 70)
                .keyboardType(.numberPad)

            Button("Connect") {
                Task { await connectManually() }
            }
            .font(WTheme.Typography.caption)
            .fontWeight(.bold)
            .disabled(manualHost.isEmpty || isPairing)
        }
        .padding(.horizontal, WTheme.Spacing.xl)
    }

    // MARK: - Actions

    private func handleScannedCode(_ code: String) {
        guard let info = connectionManager.parsePairingQR(code) else {
            errorMessage = "Invalid QR code. Please scan the code shown by `wotann link`."
            return
        }

        isPairing = true
        errorMessage = nil

        Task {
            do {
                try await connectionManager.pair(with: info)
            } catch {
                errorMessage = "Pairing failed: \(error.localizedDescription)"
            }
            isPairing = false
        }
    }

    private func handleNFCPairing() {
        isPairing = false
        errorMessage = nil

        nfcService.onPairingDataRead = { pairingData in
            let info = ConnectionManager.PairingInfo(
                id: pairingData.deviceId ?? UUID().uuidString,
                pin: pairingData.publicKey,
                host: pairingData.host,
                port: pairingData.port
            )

            isPairing = true
            Task {
                do {
                    try await connectionManager.pair(with: info)
                } catch {
                    errorMessage = "NFC pairing failed: \(error.localizedDescription)"
                }
                isPairing = false
            }
        }

        nfcService.startScanning()
    }

    private func connectManually() async {
        guard let port = Int(manualPort) else {
            errorMessage = "Invalid port number"
            return
        }

        isPairing = true
        errorMessage = nil

        let info = ConnectionManager.PairingInfo(
            id: "manual-\(UUID().uuidString.prefix(8))",
            pin: "000000",
            host: manualHost,
            port: port
        )

        do {
            try await connectionManager.pair(with: info)
        } catch {
            errorMessage = "Connection failed: \(error.localizedDescription)"
        }

        isPairing = false
    }
}

// MARK: - StepPill

/// A compact step indicator pill for the pairing flow.
private struct StepPill: View {
    let number: Int
    let label: String
    let isActive: Bool

    var body: some View {
        HStack(spacing: WTheme.Spacing.xs) {
            Text("\(number)")
                .font(WTheme.Typography.caption2)
                .fontWeight(.bold)
                .foregroundColor(isActive ? .white : WTheme.Colors.textTertiary)
                .frame(width: 18, height: 18)
                .background(isActive ? WTheme.Colors.primary : WTheme.Colors.surfaceAlt)
                .clipShape(Circle())

            Text(label)
                .font(WTheme.Typography.caption2)
                .foregroundColor(isActive ? WTheme.Colors.textPrimary : WTheme.Colors.textTertiary)
                .lineLimit(1)
        }
        .padding(.horizontal, WTheme.Spacing.sm)
        .padding(.vertical, WTheme.Spacing.xs)
        .background(WTheme.Colors.surface)
        .clipShape(Capsule())
        .animation(WTheme.Animation.smooth, value: isActive)
    }
}
