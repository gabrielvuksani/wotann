import Foundation
@preconcurrency import AVFoundation
import Speech
import Observation

// MARK: - VoiceError

/// Errors that can occur during voice recording and transcription.
enum VoiceError: LocalizedError {
    case microphonePermissionDenied
    case speechRecognitionDenied
    case audioEngineStartFailed(Error)
    case recognizerUnavailable
    case noTranscription

    var errorDescription: String? {
        switch self {
        case .microphonePermissionDenied:
            return "Microphone access is required for voice input"
        case .speechRecognitionDenied:
            return "Speech recognition permission is required"
        case .audioEngineStartFailed(let error):
            return "Audio engine failed to start: \(error.localizedDescription)"
        case .recognizerUnavailable:
            return "Speech recognizer is not available for the current locale"
        case .noTranscription:
            return "No speech was recognized"
        }
    }
}

// MARK: - VoiceService

/// Real voice recording and speech-to-text service using AVAudioEngine + Speech framework.
///
/// Provides:
/// - Push-to-talk recording with real-time transcription
/// - Audio level metering for waveform visualization
/// - Locale-aware speech recognition
///
/// V9 T14.3 — Migrated from ObservableObject + @Published to the iOS 17
/// @Observable macro. The owning views (VoiceInlineSheet, VoiceInputView)
/// switched from @StateObject to @State accordingly.
@MainActor
@Observable
final class VoiceService {

    // MARK: Observable State

    var isRecording = false
    var transcription = ""
    var audioLevel: Float = 0
    var error: VoiceError?

    // MARK: Private

    @ObservationIgnored
    private var audioEngine: AVAudioEngine?
    @ObservationIgnored
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored
    private var recognitionTask: SFSpeechRecognitionTask?
    @ObservationIgnored
    private let speechRecognizer: SFSpeechRecognizer?

    /// Exponential moving average smoothing for audio levels.
    @ObservationIgnored
    private let levelSmoothing: Float = 0.3

    // MARK: Init

    init(locale: Locale = .current) {
        speechRecognizer = SFSpeechRecognizer(locale: locale)
    }

    // MARK: - Permissions

    /// Request both microphone and speech recognition permissions.
    /// - Returns: `true` if both are granted.
    func requestPermissions() async -> Bool {
        let micGranted = await requestMicrophonePermission()
        let speechGranted = await requestSpeechPermission()
        return micGranted && speechGranted
    }

    private func requestMicrophonePermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    private func requestSpeechPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
    }

    // MARK: - Recording

    /// Start recording and transcribing speech.
    /// Throws if permissions are denied or the audio engine fails.
    func startRecording() async throws {
        guard !isRecording else { return }

        // Check permissions
        guard AVAudioApplication.shared.recordPermission == .granted else {
            throw VoiceError.microphonePermissionDenied
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            throw VoiceError.speechRecognitionDenied
        }
        guard let speechRecognizer, speechRecognizer.isAvailable else {
            throw VoiceError.recognizerUnavailable
        }

        // Cancel any existing task
        stopRecordingInternal()

        // Configure audio session
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let engine = AVAudioEngine()
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true

        // Install audio tap for level metering and speech buffer
        let inputNode = engine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            request.append(buffer)
            Task { @MainActor [weak self] in
                self?.updateAudioLevel(from: buffer)
            }
        }

        // Start recognition
        let task = speechRecognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if let result {
                    self.transcription = result.bestTranscription.formattedString
                }
                if let error, (error as NSError).domain == "kAFAssistantErrorDomain" {
                    // Speech framework error; recording may have timed out
                    self.error = .noTranscription
                    self.stopRecordingInternal()
                }
                if result?.isFinal == true {
                    self.stopRecordingInternal()
                }
            }
        }

        // Start audio engine
        do {
            try engine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            throw VoiceError.audioEngineStartFailed(error)
        }

        // Store references
        audioEngine = engine
        recognitionRequest = request
        recognitionTask = task
        isRecording = true
        transcription = ""
        self.error = nil
    }

    /// Stop recording and return the final transcription.
    /// - Returns: The transcribed text.
    @discardableResult
    func stopRecording() -> String {
        stopRecordingInternal()
        return transcription
    }

    // MARK: - Audio Level

    /// Compute the RMS audio level from a buffer for waveform visualization.
    private func updateAudioLevel(from buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData else { return }

        let channelSamples = channelData[0]
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return }

        var sum: Float = 0
        for i in 0..<frameLength {
            let sample = channelSamples[i]
            sum += sample * sample
        }
        let rms = sqrt(sum / Float(frameLength))

        // Normalize to 0-1 range (typical speech RMS is 0.01-0.3)
        let normalized = min(1.0, max(0, rms * 5.0))

        // Smooth with exponential moving average
        audioLevel = levelSmoothing * normalized + (1 - levelSmoothing) * audioLevel
    }

    // MARK: - Internal Cleanup

    private func stopRecordingInternal() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil

        recognitionRequest?.endAudio()
        recognitionRequest = nil

        recognitionTask?.cancel()
        recognitionTask = nil

        audioLevel = 0
        isRecording = false

        // Deactivate audio session
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
