import LocalAuthentication
import Observation
import SwiftUI

// MARK: - BiometricAuth
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro (Observation framework). The macro generates per-property
// observation registration so SwiftUI only invalidates views that actually read
// the changed property, eliminating Combine wrapping and reducing the
// invalidation cascade that the old `ObservableObject` conformance produced.
//
// Consumer migration:
//   - `@StateObject private var biometricAuth = BiometricAuth()`
//       → `@State private var biometricAuth = BiometricAuth()`
//   - `@ObservedObject var biometricAuth: BiometricAuth`
//       → `var biometricAuth: BiometricAuth` (read-only) or
//         `@Bindable var biometricAuth: BiometricAuth` (two-way)
//
// See: https://developer.apple.com/documentation/observation/observable

/// Face ID / Touch ID authentication via LAContext.
/// Gate destructive operations (deploy, force push, delete) behind biometric.
@MainActor
@Observable
final class BiometricAuth {
    var isAuthenticated = false
    var biometryType: BiometryType = .none
    var error: String?

    enum BiometryType {
        case faceID, touchID, none
    }

    @ObservationIgnored
    private let context = LAContext()

    init() {
        detectBiometryType()
    }

    /// Check what biometric type is available.
    func detectBiometryType() {
        var authError: NSError?
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError) {
            switch context.biometryType {
            case .faceID:
                biometryType = .faceID
            case .touchID:
                biometryType = .touchID
            default:
                biometryType = .none
            }
        } else {
            biometryType = .none
        }
    }

    /// Authenticate the user with biometrics.
    /// Returns true if successful.
    func authenticate(reason: String = "Authenticate to approve this action") async -> Bool {
        let context = LAContext()
        var authError: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError) else {
            error = "Biometric authentication not available"
            return false
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: reason
            )
            isAuthenticated = success
            error = nil
            return success
        } catch let authErr as LAError {
            switch authErr.code {
            case .userCancel:
                error = "Authentication cancelled"
            case .biometryNotAvailable:
                error = "Biometric not available"
            case .biometryNotEnrolled:
                error = "No biometric enrolled"
            case .biometryLockout:
                error = "Biometric locked out — use passcode"
            default:
                error = "Authentication failed"
            }
            return false
        } catch {
            self.error = "Authentication error"
            return false
        }
    }

    /// Authenticate for a specific sensitive operation.
    func authenticateForOperation(_ operation: String) async -> Bool {
        return await authenticate(reason: "Authenticate to \(operation)")
    }

    /// Check if biometric is available.
    var isAvailable: Bool {
        biometryType != .none
    }

    /// Human-readable biometry name.
    var biometryName: String {
        switch biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .none: return "Passcode"
        }
    }
}
