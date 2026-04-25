import Foundation
@preconcurrency import AVFoundation
import Speech
import Observation
import os

// MARK: - DuplexVoiceError

/// Errors that can occur during full-duplex voice sessions.
enum DuplexVoiceError: LocalizedError {
    case microphonePermissionDenied
    case speechRecognitionDenied
    case audioEngineStartFailed(Error)
    case audioSessionConfigFailed(Error)
    case recognizerUnavailable
    case alreadyRunning

    var errorDescription: String? {
        switch self {
        case .microphonePermissionDenied:
            return "Microphone access is required for voice mode"
        case .speechRecognitionDenied:
            return "Speech recognition permission is required"
        case .audioEngineStartFailed(let error):
            return "Audio engine failed to start: \(error.localizedDescription)"
        case .audioSessionConfigFailed(let error):
            return "Audio session configuration failed: \(error.localizedDescription)"
        case .recognizerUnavailable:
            return "Speech recognizer is not available for the current locale"
        case .alreadyRunning:
            return "Duplex voice session is already running"
        }
    }
}

// MARK: - DuplexVoiceSessionDelegate

/// Delegate callbacks for streaming transcripts, barge-in, and end-of-utterance events.
@MainActor
protocol DuplexVoiceSessionDelegate: AnyObject {
    func duplexVoice(_ session: DuplexVoiceSession, didReceivePartial transcript: String)
    func duplexVoice(_ session: DuplexVoiceSession, didFinalize transcript: String)
    func duplexVoiceDidDetectBargeIn(_ session: DuplexVoiceSession)
    func duplexVoice(_ session: DuplexVoiceSession, didEndUtterance transcript: String)
}

// MARK: - DuplexVoiceSession

/// Full-duplex voice session: simultaneous speak + listen with barge-in support.
///
/// Differs from `VoiceService` (push-to-talk one-shot) by keeping the audio engine and
/// recognition task alive while TTS plays back. The user can interrupt the assistant
/// mid-sentence and the synthesizer is stopped automatically.
///
/// Latency tradeoffs:
/// - 1024-frame buffer (~21ms @ 48kHz / ~64ms @ 16kHz). Smaller would reduce latency
///   but risk dropouts on busy main actor.
/// - VAD windows: 200ms barge-in detection, 700ms end-of-utterance, 1s minimum speech.
///   These match conversational expectations; tighter windows cause false ends, looser
///   feels sluggish.
/// - Premium voices loaded synchronously at start; first `speak()` blocks briefly the
///   first time but is cached afterward.
///
/// V9 T14.3 — Migrated from ObservableObject + @Published to the iOS 17
/// @Observable macro. No SwiftUI consumer references this class via @StateObject
/// or @ObservedObject; future consumers should adopt @State / @Bindable.
/// AVSpeechSynthesizerDelegate conformance still requires NSObject inheritance.
@MainActor
@Observable
final class DuplexVoiceSession: NSObject {

    // MARK: Observable State

    private(set) var partialTranscript: String = ""
    private(set) var finalTranscript: String = ""
    private(set) var isListening: Bool = false
    private(set) var isSpeaking: Bool = false
    private(set) var inputLevel: Float = 0  // -inf...0 dBFS
    var errorMessage: String?

    @ObservationIgnored
    weak var delegate: DuplexVoiceSessionDelegate?

    // MARK: VAD Tuning Constants

    /// Energy threshold (dBFS) above which audio is considered speech.
    private static let energyThresholdDBFS: Float = -40.0
    /// Sustained-speech window required to trigger barge-in (seconds).
    private static let bargeInHoldSeconds: TimeInterval = 0.2
    /// Sustained-silence window required to end an utterance (seconds).
    private static let endOfUtteranceSilenceSeconds: TimeInterval = 0.7
    /// Minimum total speech needed before end-of-utterance can fire.
    private static let minimumSpeechSeconds: TimeInterval = 1.0
    /// Hardware buffer duration target — lower is better, but iOS may round.
    private static let preferredIOBufferDuration: TimeInterval = 0.020

    // MARK: Audio Pipeline

    @ObservationIgnored
    private let audioEngine: AVAudioEngine = AVAudioEngine()
    @ObservationIgnored
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored
    private var recognitionTask: SFSpeechRecognitionTask?
    @ObservationIgnored
    private let speechRecognizer: SFSpeechRecognizer?

    @ObservationIgnored
    private let synthesizer: AVSpeechSynthesizer = AVSpeechSynthesizer()
    @ObservationIgnored
    private var configuredVoice: AVSpeechSynthesisVoice?

    // MARK: VAD State (per instance — no globals)

    @ObservationIgnored
    private var speechStartTime: Date?
    @ObservationIgnored
    private var lastSpeechTime: Date?
    @ObservationIgnored
    private var lastSilenceStart: Date?
    @ObservationIgnored
    private var bargeInDetected: Bool = false

    @ObservationIgnored
    private let logger: Logger = Logger(subsystem: "com.wotann.ios", category: "DuplexVoice")

    // MARK: Init

    init(locale: Locale = .current) {
        self.speechRecognizer = SFSpeechRecognizer(locale: locale)
        super.init()
        self.synthesizer.delegate = self
    }

    // MARK: - Permissions

    /// Request both microphone and speech recognition permissions.
    func requestPermissions() async -> Bool {
        let mic = await AVAudioApplication.requestRecordPermission()
        let speech: Bool = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        if !mic {
            errorMessage = DuplexVoiceError.microphonePermissionDenied.errorDescription
        } else if !speech {
            errorMessage = DuplexVoiceError.speechRecognitionDenied.errorDescription
        }
        return mic && speech
    }

    // MARK: - Lifecycle

    /// Start the duplex session. After this returns, the engine is listening and
    /// `speak(_:)` may be called concurrently.
    /// - Parameter voice: Optional voice; if nil, the highest-quality voice for
    ///   the system locale is selected.
    func start(voice: AVSpeechSynthesisVoice? = nil) async throws {
        guard !isListening else {
            throw DuplexVoiceError.alreadyRunning
        }

        // Permission gate — fail fast with explicit error.
        guard AVAudioApplication.shared.recordPermission == .granted else {
            errorMessage = DuplexVoiceError.microphonePermissionDenied.errorDescription
            throw DuplexVoiceError.microphonePermissionDenied
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            errorMessage = DuplexVoiceError.speechRecognitionDenied.errorDescription
            throw DuplexVoiceError.speechRecognitionDenied
        }
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            errorMessage = DuplexVoiceError.recognizerUnavailable.errorDescription
            throw DuplexVoiceError.recognizerUnavailable
        }

        // Configure voice — best available for locale.
        configuredVoice = voice ?? Self.bestVoice(for: speechRecognizer?.locale ?? .current)

        try configureAudioSession()
        try installRecognitionPipeline(recognizer: recognizer)

        isListening = true
        errorMessage = nil
        speechStartTime = nil
        lastSpeechTime = nil
        lastSilenceStart = nil
        bargeInDetected = false
        partialTranscript = ""
        finalTranscript = ""

        logger.info("Duplex voice session started (voice=\(self.configuredVoice?.identifier ?? "nil", privacy: .public))")
    }

    /// Speak the given text. Safe to call while listening — the engine continues
    /// to capture user audio for barge-in detection.
    func speak(_ text: String) {
        guard !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = configuredVoice
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate
        utterance.pitchMultiplier = 1.0
        utterance.volume = 1.0
        synthesizer.speak(utterance)
    }

    /// Stop the duplex session, tearing down audio engine, recognition, and TTS.
    func stop() {
        guard isListening || isSpeaking else { return }

        synthesizer.stopSpeaking(at: .immediate)

        if audioEngine.isRunning {
            audioEngine.inputNode.removeTap(onBus: 0)
            audioEngine.stop()
        }

        recognitionRequest?.endAudio()
        recognitionRequest = nil

        recognitionTask?.cancel()
        recognitionTask = nil

        // Reset audio session to ambient so other apps may resume normal playback.
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setActive(false, options: .notifyOthersOnDeactivation)
            try session.setCategory(.ambient, mode: .default, options: [])
        } catch {
            logger.error("Failed to reset audio session: \(error.localizedDescription, privacy: .public)")
        }

        isListening = false
        isSpeaking = false
        inputLevel = 0
        speechStartTime = nil
        lastSpeechTime = nil
        lastSilenceStart = nil
        bargeInDetected = false

        logger.info("Duplex voice session stopped")
    }

    // MARK: - Private Setup

    private func configureAudioSession() throws {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .measurement,
                options: [.allowBluetoothA2DP, .allowAirPlay, .defaultToSpeaker, .duckOthers]
            )
            try session.setPreferredIOBufferDuration(Self.preferredIOBufferDuration)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            logger.error("Audio session config failed: \(error.localizedDescription, privacy: .public)")
            throw DuplexVoiceError.audioSessionConfigFailed(error)
        }
    }

    private func installRecognitionPipeline(recognizer: SFSpeechRecognizer) throws {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        // On-device recognition where supported keeps audio off Apple's servers and
        // dramatically lowers latency for streaming partials.
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            // Append on the audio thread — request buffer is thread-safe.
            request.append(buffer)
            // Compute level off the main thread, dispatch state updates back.
            let level = Self.computeDBFS(from: buffer)
            Task { @MainActor [weak self] in
                self?.handleAudioFrame(levelDBFS: level)
            }
        }

        let task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.handleRecognitionUpdate(result: result, error: error)
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            logger.error("Audio engine start failed: \(error.localizedDescription, privacy: .public)")
            throw DuplexVoiceError.audioEngineStartFailed(error)
        }

        recognitionRequest = request
        recognitionTask = task
    }

    // MARK: - Recognition Handling

    private func handleRecognitionUpdate(result: SFSpeechRecognitionResult?, error: Error?) {
        if let result = result {
            let text = result.bestTranscription.formattedString
            if result.isFinal {
                finalTranscript = text
                delegate?.duplexVoice(self, didFinalize: text)
                // Recycle the recognition pipeline so the next utterance gets a fresh task.
                restartRecognitionPipeline()
            } else {
                partialTranscript = text
                delegate?.duplexVoice(self, didReceivePartial: text)
            }
        }

        if let error = error {
            let nsErr = error as NSError
            // kAFAssistantErrorDomain 1101/1110 are common idle-timeout codes —
            // surface as a soft restart, not a hard failure.
            if nsErr.domain == "kAFAssistantErrorDomain" {
                logger.info("Speech framework idle (code \(nsErr.code, privacy: .public)) — recycling pipeline")
                restartRecognitionPipeline()
            } else {
                errorMessage = error.localizedDescription
                logger.error("Recognition error: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    /// Recycle the recognition request without tearing down the audio engine.
    /// Lets a single duplex session span many utterances with a stable input tap.
    private func restartRecognitionPipeline() {
        guard isListening, let recognizer = speechRecognizer, recognizer.isAvailable else { return }

        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }

        // Re-route the existing input tap to the new request by replacing it.
        // The buffer-tap closure captures `request` by reference, so we must
        // rebind by reinstalling.
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            request.append(buffer)
            let level = Self.computeDBFS(from: buffer)
            Task { @MainActor [weak self] in
                self?.handleAudioFrame(levelDBFS: level)
            }
        }

        let task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.handleRecognitionUpdate(result: result, error: error)
            }
        }

        recognitionRequest = request
        recognitionTask = task
        partialTranscript = ""
        speechStartTime = nil
        lastSpeechTime = nil
        lastSilenceStart = nil
        bargeInDetected = false
    }

    // MARK: - VAD + Barge-in

    private func handleAudioFrame(levelDBFS: Float) {
        inputLevel = levelDBFS
        let now = Date()
        let isSpeech = levelDBFS > Self.energyThresholdDBFS

        if isSpeech {
            if speechStartTime == nil {
                speechStartTime = now
            }
            lastSpeechTime = now
            lastSilenceStart = nil

            // Barge-in: sustained user speech while assistant is talking.
            if isSpeaking, !bargeInDetected,
               let started = speechStartTime,
               now.timeIntervalSince(started) >= Self.bargeInHoldSeconds {
                triggerBargeIn()
            }
        } else {
            if lastSilenceStart == nil {
                lastSilenceStart = now
            }
            // End-of-utterance: silent long enough AND we had a real utterance.
            if let silenceStart = lastSilenceStart,
               let speechStart = speechStartTime,
               let lastSpeech = lastSpeechTime,
               now.timeIntervalSince(silenceStart) >= Self.endOfUtteranceSilenceSeconds,
               lastSpeech.timeIntervalSince(speechStart) >= Self.minimumSpeechSeconds {
                fireEndOfUtterance()
            }
        }
    }

    private func triggerBargeIn() {
        bargeInDetected = true
        synthesizer.stopSpeaking(at: .immediate)
        // isSpeaking flips false in the synthesizer delegate's didCancel.
        delegate?.duplexVoiceDidDetectBargeIn(self)
        logger.info("Barge-in detected — TTS interrupted")
    }

    private func fireEndOfUtterance() {
        let captured = partialTranscript
        delegate?.duplexVoice(self, didEndUtterance: captured)
        speechStartTime = nil
        lastSpeechTime = nil
        lastSilenceStart = nil
        logger.debug("End-of-utterance fired (\(captured.count, privacy: .public) chars)")
    }

    // MARK: - DSP

    /// Compute audio level in dBFS from a PCM buffer. Returns -160 dBFS on silence.
    nonisolated private static func computeDBFS(from buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData else { return -160.0 }
        let samples = channelData[0]
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return -160.0 }

        var sum: Float = 0
        for i in 0..<frameLength {
            let s = samples[i]
            sum += s * s
        }
        let rms = sqrt(sum / Float(frameLength))
        guard rms > 0 else { return -160.0 }
        return 20.0 * log10(rms)
    }

    // MARK: - Voice Selection

    /// Pick the highest-quality voice available for a given locale.
    /// Prefers premium > enhanced > default. iOS 17+ exposes `.premium` voices that
    /// must be downloaded by the user via Settings; we degrade gracefully if absent.
    nonisolated private static func bestVoice(for locale: Locale) -> AVSpeechSynthesisVoice? {
        let language = locale.identifier.replacingOccurrences(of: "_", with: "-")
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { voice in
            voice.language == language ||
            voice.language.hasPrefix(language.prefix(2))
        }
        if voices.isEmpty {
            return AVSpeechSynthesisVoice(language: language)
        }
        // Quality enum cases: .default = 1, .enhanced = 2, .premium = 3 (iOS 17+).
        return voices.max(by: { $0.quality.rawValue < $1.quality.rawValue })
            ?? AVSpeechSynthesisVoice(language: language)
    }

    deinit {
        // Cannot call stop() here — actor-isolated. Best effort cleanup of audio
        // engine; rely on caller to invoke stop() before releasing.
        if audioEngine.isRunning {
            audioEngine.stop()
        }
    }
}

// MARK: - AVSpeechSynthesizerDelegate

extension DuplexVoiceSession: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.isSpeaking = true
            self?.bargeInDetected = false
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.isSpeaking = false
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.isSpeaking = false
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didPause utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.isSpeaking = false
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didContinue utterance: AVSpeechUtterance) {
        Task { @MainActor [weak self] in
            self?.isSpeaking = true
        }
    }
}
