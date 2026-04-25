import Foundation
@preconcurrency import AVFoundation
import Observation

// MARK: - PairingProgressDelegate

/// Fine-grained progress signals emitted during the QR -> key exchange ->
/// PIN verify -> connect lifecycle. The UI can implement this to surface
/// the current phase (validating QR, exchanging keys, verifying PIN, ...).
@MainActor
protocol PairingProgressDelegate: AnyObject {
    func onPairingProgress(phase: String)
}

// MARK: - PairingManager
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. `PairingManager` is owned privately by
// `PairingViewModel` (already `@Observable`); no SwiftUI consumer reads
// `pairingManager.$state` directly, so the migration is strictly internal.

/// Manages the QR scan -> key exchange -> PIN verify -> connect flow.
@MainActor
@Observable
final class PairingManager {
    var state: PairingState = .unpaired
    var scannedCode: String?

    /// Most recent progress phase reported to observers. Also emits via `progressDelegate`.
    private(set) var progressPhase: String = ""

    /// Optional delegate for granular progress updates during pairing.
    @ObservationIgnored
    weak var progressDelegate: PairingProgressDelegate?

    @ObservationIgnored
    private let connectionManager: ConnectionManager

    init(connectionManager: ConnectionManager) {
        self.connectionManager = connectionManager
        if connectionManager.isPaired {
            state = .paired(deviceName: connectionManager.pairedDevice?.name ?? "Desktop")
        }
    }

    /// Report a progress phase to both the published property and the delegate.
    private func reportProgress(_ phase: String) {
        progressPhase = phase
        progressDelegate?.onPairingProgress(phase: phase)
    }

    // MARK: - QR Scanning

    func startScanning() {
        state = .scanning
    }

    func cancelScanning() {
        state = .unpaired
        scannedCode = nil
    }

    func handleScannedCode(_ code: String) async {
        scannedCode = code
        reportProgress("Validating QR code")

        guard let info = connectionManager.parsePairingQR(code) else {
            state = .error("Invalid QR code. Please scan the code shown by `wotann link`.")
            reportProgress("Invalid QR code")
            return
        }

        state = .exchangingKeys
        reportProgress("Ready to verify PIN")

        // Surface the PIN so the user can confirm it matches the desktop display.
        // The real ECDH exchange runs after the user taps Confirm; see `confirmPin()`
        // -> ConnectionManager.pair() -> negotiateEncryption().
        state = .verifyingPin(pin: info.pin)
    }

    // MARK: - PIN Verification

    func confirmPin() async {
        guard let code = scannedCode,
              let info = connectionManager.parsePairingQR(code) else {
            state = .error("No pairing data available")
            reportProgress("No pairing data")
            return
        }

        state = .exchangingKeys
        reportProgress("Connecting to desktop")

        do {
            reportProgress("Exchanging keys")
            try await connectionManager.pair(with: info)
            reportProgress("Paired")
            state = .paired(deviceName: connectionManager.pairedDevice?.name ?? "Desktop")
            HapticService.shared.trigger(.pairingSuccess)
        } catch {
            reportProgress("Pairing failed")
            state = .error("Pairing failed: \(error.localizedDescription)")
            HapticService.shared.trigger(.pairingFailed)
        }
    }

    func rejectPin() {
        state = .unpaired
        scannedCode = nil
    }

    // MARK: - Manual Connection

    func connectManually(host: String, port: Int) async {
        state = .exchangingKeys
        reportProgress("Connecting to \(host):\(port)")

        let info = ConnectionManager.PairingInfo(
            id: "manual-\(UUID().uuidString.prefix(8))",
            pin: "000000",
            host: host,
            port: port
        )

        do {
            reportProgress("Exchanging keys")
            try await connectionManager.pair(with: info)
            reportProgress("Connected")
            state = .paired(deviceName: connectionManager.pairedDevice?.name ?? "Desktop")
        } catch {
            reportProgress("Connection failed")
            state = .error("Connection failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Unpair

    func unpair() {
        connectionManager.unpair()
        state = .unpaired
        scannedCode = nil
    }

    // MARK: - Camera Permission

    static func requestCameraPermission() async -> Bool {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .video)
        default:
            return false
        }
    }
}
