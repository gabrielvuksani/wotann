import Foundation
import Combine

// MARK: - PairingViewModel

/// Drives the pairing flow UI (scan, verify PIN, connect).
@MainActor
final class PairingViewModel: ObservableObject {
    @Published var state: PairingState = .unpaired
    @Published var showScanner = false
    @Published var manualHost = ""
    @Published var manualPort = "3849"
    @Published var errorMessage: String?
    @Published var isPairing = false

    private let pairingManager: PairingManager

    init(connectionManager: ConnectionManager) {
        self.pairingManager = PairingManager(connectionManager: connectionManager)
        self.state = pairingManager.state
    }

    // MARK: - QR Scanning

    func openScanner() {
        Task {
            let granted = await PairingManager.requestCameraPermission()
            if granted {
                showScanner = true
                state = .scanning
            } else {
                errorMessage = "Camera access is required to scan QR codes. Please enable it in Settings."
            }
        }
    }

    func handleScannedCode(_ code: String) {
        showScanner = false
        isPairing = true

        Task {
            await pairingManager.handleScannedCode(code)
            state = pairingManager.state
            isPairing = state.isInProgress
        }
    }

    // MARK: - PIN

    func confirmPin() {
        isPairing = true
        Task {
            await pairingManager.confirmPin()
            state = pairingManager.state
            isPairing = false
        }
    }

    func rejectPin() {
        pairingManager.rejectPin()
        state = .unpaired
    }

    // MARK: - Manual Connection

    func connectManually() {
        guard !manualHost.isEmpty,
              let port = Int(manualPort) else {
            errorMessage = "Please enter a valid host and port."
            return
        }

        isPairing = true
        errorMessage = nil

        Task {
            await pairingManager.connectManually(host: manualHost, port: port)
            state = pairingManager.state

            if case .error(let msg) = state {
                errorMessage = msg
            }
            isPairing = false
        }
    }

    // MARK: - Unpair

    func unpair() {
        pairingManager.unpair()
        state = .unpaired
        errorMessage = nil
    }
}
