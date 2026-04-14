import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - HapticEvent

enum HapticEvent {
    case messageSent
    case responseComplete
    case error
    case voiceStart
    case voiceStop
    case taskComplete
    case taskFailed
    case enhanceComplete
    case pairingSuccess
    case pairingFailed
    case approvalRequired
    case costAlert
    case selection
    case buttonTap
    case swipe
    case shake
}

// MARK: - HapticService

/// Maps WOTANN events to iOS haptic feedback patterns.
final class HapticService {
    static let shared = HapticService()

    #if canImport(UIKit)
    private let impactLight  = UIImpactFeedbackGenerator(style: .light)
    private let impactMedium = UIImpactFeedbackGenerator(style: .medium)
    private let impactHeavy  = UIImpactFeedbackGenerator(style: .heavy)
    private let notification = UINotificationFeedbackGenerator()
    private let selectionGen = UISelectionFeedbackGenerator()
    #endif

    private init() {
        // prepare() warms up the haptic engines for lower-latency feedback.
        // On devices where CoreHaptics is unavailable (older iPods, etc.),
        // these calls no-op. The "hapticd" connection errors seen in simulator
        // logs are benign — they're simulator limitations, not app bugs.
        #if canImport(UIKit)
        impactLight.prepare()
        impactMedium.prepare()
        notification.prepare()
        selectionGen.prepare()
        #endif
    }

    /// Trigger haptic feedback for a WOTANN event.
    func trigger(_ event: HapticEvent) {
        guard UserDefaults.standard.bool(forKey: "hapticFeedback") != false else { return }

        #if canImport(UIKit)
        switch event {
        case .messageSent:         impactLight.impactOccurred()
        case .responseComplete:    notification.notificationOccurred(.success)
        case .error:               notification.notificationOccurred(.error)
        case .voiceStart:          impactMedium.impactOccurred()
        case .voiceStop:           impactLight.impactOccurred()
        case .taskComplete:        notification.notificationOccurred(.success)
        case .taskFailed:          notification.notificationOccurred(.error)
        case .enhanceComplete:     impactLight.impactOccurred()
        case .pairingSuccess:      notification.notificationOccurred(.success)
        case .pairingFailed:       notification.notificationOccurred(.error)
        case .approvalRequired:    notification.notificationOccurred(.warning)
        case .costAlert:           notification.notificationOccurred(.warning)
        case .selection:           selectionGen.selectionChanged()
        case .buttonTap:           impactLight.impactOccurred()
        case .swipe:               impactLight.impactOccurred(intensity: 0.5)
        case .shake:               impactHeavy.impactOccurred()
        }
        #endif
    }
}
