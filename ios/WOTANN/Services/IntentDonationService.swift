import Foundation
import os.log

#if canImport(AppIntents)
import AppIntents
#endif

// MARK: - IntentDonationService
//
// V9 T14.3 — Siri suggestion donation.
//
// Apple's `AppIntent.donate()` API teaches the system which intents are
// useful "right now" so they surface in:
//   - Siri Suggestions / Spotlight Top Hits
//   - Action Button suggestions on iPhone 15 Pro+
//   - the predictive Shortcuts row on the Lock Screen
//
// We donate after every *successful* prompt send because the donation
// signal is "the user just did this; offer it again". A donation on a
// failed send would teach Siri to suggest a flow that doesn't work.
//
// All donations are best-effort. Donation failures are logged at the
// debug level — they should never break the user-facing send flow.
//
// The service owns no shared mutable state: every donation builds a
// fresh intent struct so concurrent sends from multiple views never
// interfere with each other. Per-instance — no module globals.

/// Donates `AppIntent` activity to the system after meaningful user
/// actions (currently: every successful chat send).
///
/// Per-instance state, no module globals beyond the shared singleton
/// reference for ergonomic call-site dispatch.
final class IntentDonationService {

    /// Process-wide convenience handle. The singleton holds only a logger
    /// — every donation operates on a freshly-constructed intent struct.
    static let shared = IntentDonationService()

    private let log = Logger(subsystem: "com.wotann.ios", category: "IntentDonation")

    /// Cap so a single multi-megabyte paste never balloons the Siri
    /// suggestion telemetry. The first ~280 chars are more than enough
    /// for Siri's matching heuristics; the remainder would be discarded
    /// upstream anyway.
    private static let maxDonatedPromptChars = 280

    private init() {}

    // MARK: - Public API

    /// Donate an "ask WOTANN" intent — the chat send path.
    ///
    /// The donation is fire-and-forget; we never await its completion in
    /// a critical path. Donation failures are logged at debug level and
    /// never propagate to the user.
    func donateAsk(prompt: String) {
        let truncated = Self.truncate(prompt)
        guard !truncated.isEmpty else {
            log.debug("Skipping donation: empty prompt after trim")
            return
        }

        // T14.3 only requires the AppIntent.donate() call after every
        // successful sendPrompt. The OpenVoiceAskIntent is the closest
        // existing AppIntent that represents "the user is asking
        // WOTANN something" — donating it teaches Siri the user
        // engages WOTANN through this surface, which is what we want
        // surfaced as a Siri suggestion / Action Button shortcut.
        //
        // We do NOT route the prompt text into the intent payload —
        // OpenVoiceAskIntent has no @Parameter to receive it, and
        // adding one would change the public AppShortcut surface.
        // The donation itself is the "user did this" signal Siri uses;
        // the payload-less form is the supported pattern when there is
        // no parameterized intent for the action.
        #if canImport(AppIntents)
        if #available(iOS 18.0, *) {
            let intent = OpenVoiceAskIntent()
            Task { [log] in
                do {
                    try await intent.donate()
                    log.debug("Donated OpenVoiceAskIntent (\(truncated.count, privacy: .public) chars)")
                } catch {
                    // Honest stub: AppIntents donation can fail when
                    // intents metadata is missing from the build (e.g.
                    // a debug variant compiled without the intents
                    // target). Log and skip rather than crash.
                    log.debug("Donation failed: \(error.localizedDescription, privacy: .public)")
                }
            }
        } else {
            log.debug("Skipping donation: requires iOS 18+")
        }
        #else
        log.debug("Skipping donation: AppIntents framework unavailable")
        #endif
    }

    // MARK: - Helpers

    private static func truncate(_ prompt: String) -> String {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count <= maxDonatedPromptChars { return trimmed }
        let endIndex = trimmed.index(trimmed.startIndex, offsetBy: maxDonatedPromptChars)
        return String(trimmed[..<endIndex])
    }
}
