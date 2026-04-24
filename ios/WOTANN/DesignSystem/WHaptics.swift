import Foundation
#if canImport(UIKit)
import UIKit
#endif

// MARK: - WHaptics — Signature 5-Verb Haptic Vocabulary (T7.6)
//
// Five verbs, five feelings. Every touch in WOTANN maps to exactly one of
// these — no ad-hoc `impactOccurred` calls anywhere else in the code base.
// The mapping is intentional: a distinct pattern per verb means a user
// can *feel* what just happened without looking.
//
// Verb     Source                                 When it fires
// ------   -----------------------------------   -----------------------------
// strike   .impact(.rigid)                        agent action committed
// pulse    .impact(.soft) ×2 @ 200ms              streaming token arrived
// summon   .impact(.heavy) + .notification(.ok)   relay delivered
// warn     .notification(.warning)                cost threshold crossed
// rune     full two-tier strike (rigid + success) task success / signature motif
//
// Every verb respects `UIAccessibility.isReduceMotionEnabled` — when the
// user has reduce motion on, heavier verbs collapse to their lightest
// feedback equivalent. The light `strike` stays (it's the cheapest verb).
//
// Usage:
//
//   WHaptics.strike()           // agent committed a change
//   WHaptics.pulse()            // streaming token — already throttled
//   WHaptics.summon()           // phone-to-desktop relay landed
//   WHaptics.warn()             // cost budget threshold crossed
//   WHaptics.rune()             // autopilot task completed — signature motif

enum WHaptics {

    #if canImport(UIKit)
    // Generators kept hot on a process-wide basis. Each verb prepares
    // lazily on first use; `prepare()` is cheap but non-zero so we pay it
    // once per process instead of once per call.
    private static let rigid    = UIImpactFeedbackGenerator(style: .rigid)
    private static let soft     = UIImpactFeedbackGenerator(style: .soft)
    private static let heavy    = UIImpactFeedbackGenerator(style: .heavy)
    private static let notice   = UINotificationFeedbackGenerator()
    #endif

    // Pulse throttle — streaming can fire tokens hundreds of times a second.
    // We clamp to one pulse every 180ms which matches the two-pulse cadence
    // described in the verb table (200ms apart).
    private static let pulseThrottle: TimeInterval = 0.18
    private static var lastPulseAt: Date = .distantPast
    private static let pulseLock = NSLock()

    // MARK: - Reduce Motion

    private static var reduceMotion: Bool {
        #if canImport(UIKit)
        return UIAccessibility.isReduceMotionEnabled
        #else
        return false
        #endif
    }

    // MARK: - strike — agent action committed

    /// Rigid impact. Fires when the agent commits a change (file written,
    /// message sent, tool invoked). The lightest heavy-feel verb — still
    /// fires under reduce motion because agent actions are load-bearing.
    static func strike() {
        #if canImport(UIKit)
        rigid.prepare()
        rigid.impactOccurred()
        #endif
    }

    // MARK: - pulse — streaming token arrived

    /// Soft impact, doubled ~200ms apart. Throttled so a streaming response
    /// that fires hundreds of tokens per second is only felt at the cadence
    /// humans can perceive. Suppressed entirely under reduce motion.
    static func pulse() {
        guard !reduceMotion else { return }
        pulseLock.lock()
        let now = Date()
        let elapsed = now.timeIntervalSince(lastPulseAt)
        guard elapsed >= pulseThrottle else {
            pulseLock.unlock()
            return
        }
        lastPulseAt = now
        pulseLock.unlock()

        #if canImport(UIKit)
        soft.prepare()
        soft.impactOccurred()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            soft.impactOccurred()
        }
        #endif
    }

    // MARK: - summon — relay delivered

    /// Heavy impact immediately followed by a success notification. Fires
    /// when a phone→desktop relay has landed on the other device. Reduce
    /// motion collapses this to a single rigid strike.
    static func summon() {
        #if canImport(UIKit)
        if reduceMotion {
            strike()
            return
        }
        heavy.prepare()
        heavy.impactOccurred()
        notice.prepare()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) {
            notice.notificationOccurred(.success)
        }
        #endif
    }

    // MARK: - warn — cost threshold crossed

    /// Warning notification. Fires when a cost budget threshold is crossed
    /// (50% / 80% / 100% of the weekly budget). Suppressed under reduce
    /// motion because it is a supplementary alert — the banner UI carries
    /// the primary signal.
    static func warn() {
        guard !reduceMotion else { return }
        #if canImport(UIKit)
        notice.prepare()
        notice.notificationOccurred(.warning)
        #endif
    }

    // MARK: - rune — task success / signature motif

    /// Full two-tier strike — rigid impact, then 100ms later a success
    /// notification. Reserved for task completion (autopilot landed, PR
    /// merged, build passed). Paired with the `SignatureMotif` rune-flash
    /// overlay to form the WOTANN signature motif.
    static func rune() {
        #if canImport(UIKit)
        rigid.prepare()
        rigid.impactOccurred(intensity: reduceMotion ? 0.6 : 1.0)
        guard !reduceMotion else { return }
        notice.prepare()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            notice.notificationOccurred(.success)
        }
        #endif
    }
}
