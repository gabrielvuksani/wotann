import Foundation
import Observation

// MARK: - PairingViewModel
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. Every stored property is automatically tracked, so
// the `@Published` wrappers are dropped. SwiftUI invalidates per-property
// rather than per-publish, which is the right model for the pairing flow:
// touching `errorMessage` should not redraw the QR scanner host field, and
// vice versa.
//
// Consumer migration (when this VM gets wired into PairingView):
//   - `@StateObject private var vm = PairingViewModel(connectionManager: ...)`
//       → `@State private var vm = PairingViewModel(connectionManager: ...)`
//   - `@ObservedObject var vm: PairingViewModel`
//       → `var vm: PairingViewModel` (read-only) or
//         `@Bindable var vm: PairingViewModel` (two-way bindings, e.g.
//         `TextField(..., text: $vm.manualHost)` or
//         `.sheet(isPresented: $vm.showScanner)`).

/// Drives the pairing flow UI (scan, verify PIN, connect).
@MainActor
@Observable
final class PairingViewModel {
    var state: PairingState = .unpaired
    var showScanner = false
    var manualHost = ""
    var manualPort = "3849"
    var errorMessage: String?
    var isPairing = false

    @ObservationIgnored
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
