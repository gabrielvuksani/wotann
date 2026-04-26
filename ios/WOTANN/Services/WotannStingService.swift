import Foundation
import AVFoundation
import os.log

// MARK: - Wotann Sting Service (V9 T7.6)
//
// Plays the 6-note Wotann signature audio cue (≤400ms) once per session on
// first unlock. Per V9 T7.6 the cue is part of WOTANN's identity layer:
// it pairs with the "Rune-flash" haptic + glyph to give every action
// completion a recognizable signature.
//
// SYNTHESIS RATIONALE
// We generate the cue programmatically at runtime instead of shipping a
// `wotann_sting.caf` binary asset. Reasons:
//
//   1. Deterministic across iOS versions and devices — no codec drift.
//   2. Zero binary footprint in the .ipa (saves ~20-40KB).
//   3. No licensing question on the source samples.
//   4. The caller can re-tune notes / envelope without re-shipping an asset.
//
// The Companion script `scripts/generate-wotann-sting.swift` (run from
// macOS) materialises the same buffer to a `.caf` file for marketing /
// preview use; production iOS does NOT load that file.
//
// PRESENTATION RULE
// "Once per session on first unlock" is enforced via App Group defaults:
// the cue plays the first time `playIfFirstUnlock(sessionId:)` is invoked
// for a given `sessionId`, then suppresses subsequent calls until the
// `sessionId` changes (next process boot or sign-out / sign-in cycle).

@available(iOS 16.0, *)
final class WotannStingService {
    static let shared = WotannStingService()

    private let log = Logger(subsystem: "com.wotann.ios", category: "WotannStingService")
    private let defaults = UserDefaults(suiteName: "group.com.wotann.shared") ?? .standard
    private let lastSessionKey = "sting.lastPlayedSessionId"

    /// Kept alive for the cue's full duration; iOS will tear down a
    /// `AVAudioEngine` when its only reference falls out of scope, so we
    /// retain a single engine on the service singleton.
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?

    /// 6-note Wotann signature pattern. Frequencies are pentatonic
    /// E-minor — E5 G5 D5 E5 A5 D5 — chosen for an ascending → falling →
    /// resolving rune-cadence shape that reads as "complete" without
    /// being a major-key triumphal sting.
    private let notes: [Float] = [
        659.25,   // E5
        783.99,   // G5
        587.33,   // D5
        659.25,   // E5
        880.00,   // A5
        587.33,   // D5
    ]

    /// Per-note duration (seconds). 60ms × 6 = 360ms total — under the
    /// V9 T7.6 ≤400ms cap with 40ms headroom for envelope tail.
    private let perNoteSeconds: Double = 0.060

    private let sampleRate: Double = 44100.0

    private init() {}

    // MARK: - Public

    /// Play the sting once for the given session id. No-op on subsequent
    /// invocations with the same id.
    func playIfFirstUnlock(sessionId: String) {
        let last = defaults.string(forKey: lastSessionKey)
        guard last != sessionId else { return }
        defaults.set(sessionId, forKey: lastSessionKey)
        play()
    }

    /// Play the Norse "wax-seal" cue when an approval has been granted.
    /// Delegates to `NorseSoundCues.shared` — the sting service stays the
    /// single audio facade callers reach for. Marked nonisolated so it can
    /// be invoked from any actor; the underlying cue service is `@MainActor`
    /// and we hop onto it.
    func playApprovalGranted() {
        Task { @MainActor in
            NorseSoundCues.shared.playWaxSeal()
        }
    }

    /// Play the Norse "well-hum" cue on a task-completion event. Same
    /// hop-to-main-actor pattern as `playApprovalGranted()`.
    func playTaskComplete() {
        Task { @MainActor in
            NorseSoundCues.shared.playWellHum()
        }
    }

    /// Play the Norse "rune-tap" cue for a brand-voice button tap. This is
    /// the lightest cue — use sparingly so it stays distinctive.
    func playRuneTap() {
        Task { @MainActor in
            NorseSoundCues.shared.playRuneTap()
        }
    }

    /// Play the Norse "wood-knock" cue on a recoverable error. Pairs with
    /// the existing `HapticService.shared.trigger(.error)` notification
    /// haptic so the failure has both a tactile and audio signature.
    func playError() {
        Task { @MainActor in
            NorseSoundCues.shared.playWoodKnock()
        }
    }

    /// Force-play regardless of session state. Used by the Settings screen
    /// "Preview audio sting" button.
    func play() {
        do {
            try ensureEngineRunning()
        } catch {
            log.warning("sting engine setup failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        guard let engine, let player else { return }
        guard let buffer = renderBuffer() else { return }

        player.scheduleBuffer(buffer, at: nil, options: .interrupts) { [weak self] in
            // Engine stays running for the next play; nothing to release here.
            self?.log.debug("sting playback complete")
        }
        if !player.isPlaying {
            player.play()
        }
        // Engine continues running between plays; the audio session
        // category is left as the system default (.ambient via shared
        // session) so the cue mixes with other audio rather than ducking
        // it. This is the V9 T7.6 "non-intrusive" requirement.
        _ = engine
    }

    // MARK: - Engine lifecycle

    private func ensureEngineRunning() throws {
        if let engine, engine.isRunning {
            return
        }
        let newEngine = AVAudioEngine()
        let newPlayer = AVAudioPlayerNode()
        newEngine.attach(newPlayer)
        let format = AVAudioFormat(
            standardFormatWithSampleRate: sampleRate,
            channels: 1
        )
        newEngine.connect(newPlayer, to: newEngine.mainMixerNode, format: format)
        try newEngine.start()
        self.engine = newEngine
        self.player = newPlayer
    }

    // MARK: - Synthesis

    /// Build the 6-note buffer in one shot. Each note is a 4-partial
    /// additive synth (1.0/0.5/0.25/0.125 amplitudes on harmonics
    /// 1/2/3/4) shaped by an ADSR-lite envelope: 4ms attack, sustain,
    /// 16ms release. The result is a clean, slightly-bell tone — the
    /// "rune" signature.
    private func renderBuffer() -> AVAudioPCMBuffer? {
        let perNoteSamples = Int(sampleRate * perNoteSeconds)
        let totalSamples = perNoteSamples * notes.count
        guard
            let format = AVAudioFormat(
                standardFormatWithSampleRate: sampleRate,
                channels: 1
            ),
            let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(totalSamples)
            )
        else {
            return nil
        }
        buffer.frameLength = AVAudioFrameCount(totalSamples)
        guard let channel = buffer.floatChannelData?[0] else { return nil }

        let twoPi = Float(2.0 * .pi)
        let invSample = Float(1.0 / sampleRate)
        let attackSamples = Int(sampleRate * 0.004) // 4ms
        let releaseSamples = Int(sampleRate * 0.016) // 16ms
        let sustainSamples = max(perNoteSamples - attackSamples - releaseSamples, 1)
        var writeIndex = 0

        for note in notes {
            let phaseStep = twoPi * note * invSample
            var phase: Float = 0
            for sampleIndex in 0..<perNoteSamples {
                let envelope: Float
                if sampleIndex < attackSamples {
                    envelope = Float(sampleIndex) / Float(attackSamples)
                } else if sampleIndex >= attackSamples + sustainSamples {
                    let releaseIdx = sampleIndex - (attackSamples + sustainSamples)
                    envelope = max(0, 1 - Float(releaseIdx) / Float(releaseSamples))
                } else {
                    envelope = 1
                }

                // 4-partial additive — bell-like timbre.
                let s1 = sinf(phase) * 1.0
                let s2 = sinf(phase * 2) * 0.50
                let s3 = sinf(phase * 3) * 0.25
                let s4 = sinf(phase * 4) * 0.125
                let raw = (s1 + s2 + s3 + s4) * 0.40 // pre-envelope gain
                channel[writeIndex] = raw * envelope
                writeIndex += 1
                phase += phaseStep
                if phase >= twoPi {
                    phase -= twoPi
                }
            }
        }

        return buffer
    }
}
