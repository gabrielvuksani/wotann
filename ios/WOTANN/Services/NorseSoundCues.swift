import Foundation
import AVFoundation
import os.log

// MARK: - Norse Sound Cues (V9 T14.4)
//
// Programmatic synthesis for the four Norse signature audio cues that
// give WOTANN's iOS surface a recognisable audio language. All four
// cues are short (≤200ms), non-intrusive, and synthesised at runtime
// rather than shipped as binary `.caf` assets.
//
// CUE INVENTORY
// -------------
//   Rune-tap   (~30ms)  — square click @ 1.2kHz, action commit.
//   Well-hum  (~150ms)  — perfect-fifth pad (110/165 Hz), memory recall.
//   Wax-seal  (~120ms)  — 60Hz sine + noise burst, approval signed.
//   Wood-knock (~80ms)  — bandpass-filtered noise @ 800Hz, notification.
//
// SYNTHESIS RATIONALE
// We follow the same approach as `WotannStingService.swift`:
//
//   1. Deterministic across iOS versions / devices (no codec drift).
//   2. Zero binary footprint in the .ipa.
//   3. No licensing risk on source samples.
//   4. Cue parameters can be re-tuned in source without a re-ship.
//
// USAGE
// -----
//   NorseSoundCues.shared.playRuneTap()
//   NorseSoundCues.shared.playWellHum()
//   NorseSoundCues.shared.playWaxSeal()
//   NorseSoundCues.shared.playWoodKnock()
//
// All four are static-style entry points on a single shared engine.
// The buffers are computed lazily on first call and cached by cue type
// — re-rendering identical buffers on every play would burn battery
// for no auditory gain.

@available(iOS 16.0, *)
@MainActor
final class NorseSoundCues {
    static let shared = NorseSoundCues()

    private let log = Logger(subsystem: "com.wotann.ios", category: "NorseSoundCues")

    /// Single AVAudioEngine for the entire service. Same retention
    /// pattern as `WotannStingService` — the engine teardown rule on
    /// iOS releases the engine when its only reference falls out of
    /// scope, so we hold it on the singleton.
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?

    /// Lazy buffer cache keyed by cue. Each cue is rendered the first
    /// time it plays, then reused for every subsequent play.
    private var bufferCache: [Cue: AVAudioPCMBuffer] = [:]

    private let sampleRate: Double = 44_100.0

    /// Seedable RNG for the noise-based cues. Fixed seed so the burst
    /// shape is deterministic — no per-play timbre drift.
    private let noiseSeed: UInt64 = 0x57_4F_54_41_4E_4E_00_01 // "WOTANN" + 1

    private init() {}

    // MARK: - Cue Identity

    private enum Cue: String, CaseIterable {
        case runeTap
        case wellHum
        case waxSeal
        case woodKnock
    }

    // MARK: - Public API

    /// 30ms square-wave click at 1.2kHz. Use for action commits — the
    /// auditory equivalent of a rune carved into wood.
    func playRuneTap() {
        play(.runeTap)
    }

    /// 150ms low pad — two sines at 110Hz + 165Hz (perfect fifth) with
    /// a slow swell. Use when surfacing memory recall.
    func playWellHum() {
        play(.wellHum)
    }

    /// 120ms thump — 60Hz sine + sharp noise burst with exponential
    /// decay. Use when an approval is signed.
    func playWaxSeal() {
        play(.waxSeal)
    }

    /// 80ms percussive bandpass-filtered noise around 800Hz. Use for
    /// notifications.
    func playWoodKnock() {
        play(.woodKnock)
    }

    // MARK: - Playback Pipeline

    private func play(_ cue: Cue) {
        do {
            try ensureEngineRunning()
        } catch {
            log.warning("cue engine setup failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        guard let player else { return }
        guard let buffer = bufferFor(cue) else {
            log.warning("cue buffer render failed: \(cue.rawValue, privacy: .public)")
            return
        }

        player.scheduleBuffer(buffer, at: nil, options: .interrupts) { [weak self] in
            self?.log.debug("cue playback complete: \(cue.rawValue, privacy: .public)")
        }
        if !player.isPlaying {
            player.play()
        }
    }

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

    private func bufferFor(_ cue: Cue) -> AVAudioPCMBuffer? {
        if let cached = bufferCache[cue] { return cached }

        let buffer: AVAudioPCMBuffer?
        switch cue {
        case .runeTap:   buffer = renderRuneTap()
        case .wellHum:   buffer = renderWellHum()
        case .waxSeal:   buffer = renderWaxSeal()
        case .woodKnock: buffer = renderWoodKnock()
        }

        if let buffer {
            bufferCache[cue] = buffer
        }
        return buffer
    }

    // MARK: - Buffer Helpers

    private func makeBuffer(samples: Int) -> (AVAudioPCMBuffer, UnsafeMutablePointer<Float>)? {
        guard
            let format = AVAudioFormat(
                standardFormatWithSampleRate: sampleRate,
                channels: 1
            ),
            let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(samples)
            ),
            let channel = buffer.floatChannelData?[0]
        else {
            return nil
        }
        buffer.frameLength = AVAudioFrameCount(samples)
        return (buffer, channel)
    }

    // MARK: - Synthesis: Rune-tap

    /// Square-wave click. ~30ms total — 5ms attack, 25ms release.
    /// Pre-envelope amplitude is scaled to keep peaks well below clip
    /// even at 100% device volume.
    private func renderRuneTap() -> AVAudioPCMBuffer? {
        let durationSeconds = 0.030
        let frequency: Float = 1_200.0
        let totalSamples = Int(sampleRate * durationSeconds)
        let attackSamples = Int(sampleRate * 0.005)
        let releaseSamples = max(totalSamples - attackSamples, 1)

        guard let (buffer, channel) = makeBuffer(samples: totalSamples) else { return nil }

        let twoPi = Float(2.0 * .pi)
        let phaseStep = twoPi * frequency * Float(1.0 / sampleRate)
        var phase: Float = 0

        for i in 0..<totalSamples {
            let envelope: Float
            if i < attackSamples {
                envelope = Float(i) / Float(attackSamples)
            } else {
                let releaseIdx = i - attackSamples
                envelope = max(0, 1 - Float(releaseIdx) / Float(releaseSamples))
            }
            // Square wave via sign(sin) — sharper attack than a sine.
            let s = sinf(phase) >= 0 ? Float(1.0) : Float(-1.0)
            channel[i] = s * envelope * 0.30
            phase += phaseStep
            if phase >= twoPi { phase -= twoPi }
        }

        return buffer
    }

    // MARK: - Synthesis: Well-hum

    /// Two sines at A2 (110Hz) + a perfect fifth above (E3 ≈ 165Hz).
    /// 150ms with a slow swell — 30ms attack, 80ms sustain, 40ms release.
    /// The fifth interval has been deliberately chosen to read as
    /// open / contemplative rather than minor / sad.
    private func renderWellHum() -> AVAudioPCMBuffer? {
        let durationSeconds = 0.150
        let f1: Float = 110.0   // A2
        let f2: Float = 165.0   // perfect fifth above
        let totalSamples = Int(sampleRate * durationSeconds)
        let attackSamples = Int(sampleRate * 0.030)
        let releaseSamples = Int(sampleRate * 0.040)
        let sustainSamples = max(totalSamples - attackSamples - releaseSamples, 1)

        guard let (buffer, channel) = makeBuffer(samples: totalSamples) else { return nil }

        let twoPi = Float(2.0 * .pi)
        let invSample = Float(1.0 / sampleRate)
        let step1 = twoPi * f1 * invSample
        let step2 = twoPi * f2 * invSample
        var p1: Float = 0
        var p2: Float = 0

        for i in 0..<totalSamples {
            let envelope: Float
            if i < attackSamples {
                envelope = Float(i) / Float(attackSamples)
            } else if i >= attackSamples + sustainSamples {
                let releaseIdx = i - (attackSamples + sustainSamples)
                envelope = max(0, 1 - Float(releaseIdx) / Float(releaseSamples))
            } else {
                envelope = 1
            }

            // Equal-power blend of the two partials. Mild gain to
            // compensate for the lower frequency content.
            let s = (sinf(p1) * 0.55 + sinf(p2) * 0.45)
            channel[i] = s * envelope * 0.32

            p1 += step1
            p2 += step2
            if p1 >= twoPi { p1 -= twoPi }
            if p2 >= twoPi { p2 -= twoPi }
        }

        return buffer
    }

    // MARK: - Synthesis: Wax-seal

    /// Sharp thump. ~120ms — 60Hz sine plus a deterministic noise burst
    /// at the head, each on its own envelope. Models a hot wax stamp:
    /// instant high-frequency contact spike, then a low body resonance.
    private func renderWaxSeal() -> AVAudioPCMBuffer? {
        let durationSeconds = 0.120
        let bodyFreq: Float = 60.0
        let totalSamples = Int(sampleRate * durationSeconds)
        let attackSamples = Int(sampleRate * 0.002)   // very fast contact
        let noiseSamples  = Int(sampleRate * 0.018)   // 18ms head
        let releaseSamples = max(totalSamples - attackSamples, 1)

        guard let (buffer, channel) = makeBuffer(samples: totalSamples) else { return nil }

        let twoPi = Float(2.0 * .pi)
        let phaseStep = twoPi * bodyFreq * Float(1.0 / sampleRate)
        var phase: Float = 0
        var rng = SplitMix64(seed: noiseSeed)

        for i in 0..<totalSamples {
            // Body envelope — exponential decay (release-only after the
            // tiny attack lift so the strike feels instant).
            let bodyEnv: Float
            if i < attackSamples {
                bodyEnv = Float(i) / Float(attackSamples)
            } else {
                let releaseIdx = i - attackSamples
                let t = Float(releaseIdx) / Float(releaseSamples)
                // exp(-3 t) → ~5% by end of buffer.
                bodyEnv = expf(-3.0 * t)
            }

            // Noise envelope — only for the first ~18ms; sharp linear ramp
            // down so the stamp head doesn't smear into the body.
            let noiseEnv: Float
            if i < noiseSamples {
                noiseEnv = 1 - Float(i) / Float(noiseSamples)
            } else {
                noiseEnv = 0
            }

            let body = sinf(phase) * bodyEnv * 0.55
            let noise = rng.nextUnit() * noiseEnv * 0.25

            channel[i] = body + noise

            phase += phaseStep
            if phase >= twoPi { phase -= twoPi }
        }

        return buffer
    }

    // MARK: - Synthesis: Wood-knock

    /// Bandpass-filtered noise centred at 800Hz, ~80ms. Very fast
    /// attack/decay envelope so the cue reads as a single percussive
    /// "knock". Filtering is a one-pole biquad evaluated in-place.
    private func renderWoodKnock() -> AVAudioPCMBuffer? {
        let durationSeconds = 0.080
        let totalSamples = Int(sampleRate * durationSeconds)
        let attackSamples = Int(sampleRate * 0.002)   // 2ms
        let releaseSamples = max(totalSamples - attackSamples, 1)

        guard let (buffer, channel) = makeBuffer(samples: totalSamples) else { return nil }

        // Two-pole bandpass biquad coefficients for ~800Hz centre, Q≈4.
        // Computed offline once; equivalent to:
        //   omega = 2π · 800 / 44100
        //   alpha = sin(omega) / (2 · 4)
        // and then RBJ bandpass (constant skirt gain).
        let b0: Float = 0.0271
        let b1: Float = 0.0
        let b2: Float = -0.0271
        let a1: Float = -1.9407
        let a2: Float = 0.9457
        var x1: Float = 0
        var x2: Float = 0
        var y1: Float = 0
        var y2: Float = 0
        var rng = SplitMix64(seed: noiseSeed &+ 0x9E37_79B9_7F4A_7C15)

        for i in 0..<totalSamples {
            // Envelope: sharp linear attack then exponential decay.
            let envelope: Float
            if i < attackSamples {
                envelope = Float(i) / Float(attackSamples)
            } else {
                let releaseIdx = i - attackSamples
                let t = Float(releaseIdx) / Float(releaseSamples)
                envelope = expf(-5.0 * t)
            }

            let noise = rng.nextUnit()
            let y = b0 * noise + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = noise
            y2 = y1
            y1 = y

            channel[i] = y * envelope * 4.0 // bandpass cuts a lot of energy; lift it back
        }

        return buffer
    }
}

// MARK: - Deterministic RNG

/// SplitMix64 — small deterministic PRNG. Good enough for short noise
/// bursts without pulling in a heavier dependency.
private struct SplitMix64 {
    private var state: UInt64

    init(seed: UInt64) {
        self.state = seed
    }

    mutating func nextUInt64() -> UInt64 {
        state = state &+ 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }

    /// Uniform sample in [-1, 1).
    mutating func nextUnit() -> Float {
        let raw = Float(nextUInt64() >> 40) / Float(1 << 24)  // [0, 1)
        return raw * 2.0 - 1.0
    }
}
