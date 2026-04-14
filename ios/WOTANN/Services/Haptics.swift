import Foundation
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Haptics

/// Modern haptic primitives used by the new Obsidian Precision UI layer.
/// Respects `UIAccessibility.isReduceMotionEnabled` — when reduce motion
/// is on, heavy / success / warning / error haptics are skipped. Soft
/// streaming token haptics are throttled to one per 500ms to avoid
/// buzzing during rapid streaming.
///
/// This is intentionally separate from the legacy `HapticService` used
/// throughout the codebase. Both can coexist.
final class Haptics {
    static let shared = Haptics()

    #if canImport(UIKit)
    private let impactLight  = UIImpactFeedbackGenerator(style: .light)
    private let impactMedium = UIImpactFeedbackGenerator(style: .medium)
    private let impactHeavy  = UIImpactFeedbackGenerator(style: .heavy)
    private let impactSoft   = UIImpactFeedbackGenerator(style: .soft)
    private let notification = UINotificationFeedbackGenerator()
    private let selection    = UISelectionFeedbackGenerator()
    #endif

    /// Last time a streaming token haptic fired. Used for throttling.
    private var lastStreamingTokenAt: Date = .distantPast
    /// Minimum interval between streaming token haptics.
    private let streamingThrottle: TimeInterval = 0.5

    private init() {
        #if canImport(UIKit)
        impactLight.prepare()
        impactMedium.prepare()
        impactSoft.prepare()
        notification.prepare()
        selection.prepare()
        #endif
    }

    // MARK: - Reduce Motion Gate

    /// Whether reduce motion is active. When on, heavier haptics are suppressed.
    private var reduceMotion: Bool {
        #if canImport(UIKit)
        return UIAccessibility.isReduceMotionEnabled
        #else
        return false
        #endif
    }

    // MARK: - Public Haptic Primitives

    /// Light impact — button taps, selection.
    func buttonTap() {
        guard isHapticsEnabled else { return }
        #if canImport(UIKit)
        impactLight.impactOccurred()
        #endif
    }

    /// Medium impact — toggle-on.
    func toggleOn() {
        guard isHapticsEnabled else { return }
        #if canImport(UIKit)
        impactMedium.impactOccurred()
        #endif
    }

    /// Success notification. Suppressed in reduce motion.
    func success() {
        guard isHapticsEnabled, !reduceMotion else { return }
        #if canImport(UIKit)
        notification.notificationOccurred(.success)
        #endif
    }

    /// Warning notification.
    func warning() {
        guard isHapticsEnabled else { return }
        #if canImport(UIKit)
        notification.notificationOccurred(.warning)
        #endif
    }

    /// Error notification.
    func error() {
        guard isHapticsEnabled else { return }
        #if canImport(UIKit)
        notification.notificationOccurred(.error)
        #endif
    }

    /// Heavy impact — long-press start. Suppressed in reduce motion.
    func longPressStart() {
        guard isHapticsEnabled, !reduceMotion else { return }
        #if canImport(UIKit)
        impactHeavy.impactOccurred()
        #endif
    }

    /// Soft impact, throttled to once per 500ms. Used while streaming tokens.
    func streamingToken() {
        guard isHapticsEnabled, !reduceMotion else { return }
        let now = Date()
        guard now.timeIntervalSince(lastStreamingTokenAt) >= streamingThrottle else { return }
        lastStreamingTokenAt = now
        #if canImport(UIKit)
        impactSoft.impactOccurred()
        #endif
    }

    /// Selection change for pull-to-refresh / picker wheels.
    func pullToRefresh() {
        guard isHapticsEnabled else { return }
        #if canImport(UIKit)
        selection.selectionChanged()
        #endif
    }

    // MARK: - User Preference

    /// Reads the app's "hapticFeedback" preference (mirror of `HapticService`).
    private var isHapticsEnabled: Bool {
        // Defaults to ON if the key has never been set.
        if UserDefaults.standard.object(forKey: "hapticFeedback") == nil {
            return true
        }
        return UserDefaults.standard.bool(forKey: "hapticFeedback")
    }
}
