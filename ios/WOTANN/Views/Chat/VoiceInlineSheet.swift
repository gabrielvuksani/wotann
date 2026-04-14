import SwiftUI

// MARK: - VoiceInlineSheet

/// Phase C voice mode — a full-screen inline sheet shown when the user
/// long-presses the Composer's microphone. Mimics the standalone
/// `VoiceInputView` feel while keeping the chat context visually present
/// behind a translucent OLED black surface.
///
/// The sheet is purely presentational; speech recognition lives in
/// `VoiceService`. When the user confirms the transcript, `onSubmit` is
/// invoked with the captured text and the sheet dismisses itself.
struct VoiceInlineSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @StateObject private var voiceService = VoiceService()
    @State private var waveform: [CGFloat] = Array(repeating: 0.1, count: 48)
    @State private var pulse: CGFloat = 1.0
    @State private var waveformTimer: Timer?
    @State private var recordingDuration: TimeInterval = 0
    @State private var durationTimer: Timer?
    @State private var permissionError: String?

    let onSubmit: (String) -> Void

    private var isRecording: Bool { voiceService.isRecording }
    private var transcription: String { voiceService.transcription }

    var body: some View {
        ZStack {
            Color.black.opacity(0.98).ignoresSafeArea()

            VStack(spacing: WTheme.Spacing.lg) {
                header
                Spacer()
                transcriptArea
                Spacer()
                waveformBars
                micButton
                    .padding(.top, WTheme.Spacing.md)
                bottomControls
                    .padding(.bottom, WTheme.Spacing.xxl)
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.top, WTheme.Spacing.md)
        }
        .onAppear {
            // Auto-start recording immediately for low-friction voice mode.
            startRecording()
        }
        .onDisappear {
            cleanup()
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button(action: cancel) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(WTheme.Colors.surface))
            }
            .accessibilityLabel("Close voice input")

            Spacer()

            VStack(spacing: 2) {
                Text(isRecording ? "Listening" : "Voice")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundColor(WTheme.Colors.textPrimary)
                if isRecording {
                    Text(formattedDuration)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(WTheme.Colors.error)
                        .contentTransition(.numericText())
                }
            }

            Spacer()

            Color.clear.frame(width: 36, height: 36)
        }
    }

    // MARK: - Transcript Area

    private var transcriptArea: some View {
        Group {
            if let error = permissionError ?? voiceService.error?.localizedDescription {
                VStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "mic.slash.fill")
                        .font(.system(size: 32))
                        .foregroundColor(WTheme.Colors.error)
                    Text(error)
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.error)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, WTheme.Spacing.xl)
                }
            } else if transcription.isEmpty {
                Text(isRecording ? "Speak freely..." : "Tap the mic to begin")
                    .font(.system(size: 18, weight: .regular, design: .rounded))
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, WTheme.Spacing.xl)
            } else {
                ScrollView {
                    Text(transcription)
                        .font(.system(size: 20, weight: .regular))
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(WTheme.Spacing.md)
                }
                .frame(maxHeight: 220)
            }
        }
    }

    // MARK: - Waveform

    private var waveformBars: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(0..<waveform.count, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(WTheme.Colors.primary)
                    .frame(width: 3, height: max(3, waveform[i] * 64))
                    .opacity(isRecording ? 1 : 0.35)
                    .animation(.spring(duration: 0.15, bounce: 0.2), value: waveform[i])
            }
        }
        .frame(height: 72)
    }

    // MARK: - Mic Button

    private var micButton: some View {
        Button(action: toggleRecording) {
            ZStack {
                Circle()
                    .fill(
                        isRecording
                            ? LinearGradient(
                                colors: [WTheme.Colors.error, WTheme.Colors.error.opacity(0.8)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            : LinearGradient(
                                colors: [WTheme.Colors.primary, WTheme.Colors.primaryPressed],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                    )
                    .frame(width: 88, height: 88)
                    .shadow(
                        color: (isRecording ? WTheme.Colors.error : WTheme.Colors.primary)
                            .opacity(0.4),
                        radius: 16,
                        x: 0,
                        y: 4
                    )
                Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                    .font(.system(size: 32, weight: .medium))
                    .foregroundColor(.white)
                    .contentTransition(.symbolEffect(.replace))
            }
            .scaleEffect(isRecording ? pulse : 1.0)
        }
        .accessibilityLabel(isRecording ? "Stop recording" : "Start recording")
    }

    // MARK: - Bottom Controls

    private var bottomControls: some View {
        HStack(spacing: WTheme.Spacing.xl) {
            Button(action: cancel) {
                VStack(spacing: 4) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 24))
                    Text("Cancel")
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                }
                .foregroundColor(WTheme.Colors.textTertiary)
            }

            Button(action: submitTranscript) {
                VStack(spacing: 4) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                    Text("Send")
                        .font(.system(size: 11, weight: .semibold, design: .rounded))
                }
                .foregroundColor(canSend ? WTheme.Colors.primary : WTheme.Colors.textTertiary)
            }
            .disabled(!canSend)
        }
    }

    private var canSend: Bool {
        !transcription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isRecording
    }

    // MARK: - Actions

    private func toggleRecording() {
        if isRecording { stopRecording() } else { startRecording() }
    }

    private func startRecording() {
        permissionError = nil
        HapticService.shared.trigger(.voiceStart)
        Task {
            let granted = await voiceService.requestPermissions()
            guard granted else {
                await MainActor.run {
                    permissionError = "Microphone and speech recognition permissions are required."
                }
                return
            }
            do { try await voiceService.startRecording() } catch {
                await MainActor.run {
                    permissionError = error.localizedDescription
                }
                return
            }
            await MainActor.run {
                startAnimations()
            }
        }
    }

    private func startAnimations() {
        if !reduceMotion {
            withAnimation(.easeInOut(duration: 0.85).repeatForever(autoreverses: true)) {
                pulse = 1.06
            }
        }
        waveformTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { _ in
            Task { @MainActor in
                let level = CGFloat(voiceService.audioLevel)
                var next = waveform
                for i in 0..<next.count {
                    let center = CGFloat(next.count / 2)
                    let distance = abs(CGFloat(i) - center) / center
                    let centerBoost = 1 - distance
                    let jitter = CGFloat.random(in: -0.08...0.08)
                    next[i] = 0.15 + level * (0.4 + centerBoost * 0.6) + jitter
                }
                waveform = next
            }
        }
        durationTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            Task { @MainActor in
                recordingDuration += 1
            }
        }
    }

    private func stopRecording() {
        voiceService.stopRecording()
        HapticService.shared.trigger(.voiceStop)
        withAnimation(WTheme.Animation.smooth) {
            pulse = 1.0
            waveform = Array(repeating: 0.1, count: 48)
        }
        waveformTimer?.invalidate()
        waveformTimer = nil
        durationTimer?.invalidate()
        durationTimer = nil
    }

    private func cancel() {
        stopRecording()
        HapticService.shared.trigger(.selection)
        dismiss()
    }

    private func submitTranscript() {
        let text = transcription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        stopRecording()
        HapticService.shared.trigger(.messageSent)
        onSubmit(text)
        dismiss()
    }

    private func cleanup() {
        waveformTimer?.invalidate()
        durationTimer?.invalidate()
        voiceService.stopRecording()
    }

    private var formattedDuration: String {
        let m = Int(recordingDuration) / 60
        let s = Int(recordingDuration) % 60
        return String(format: "%d:%02d", m, s)
    }
}

#Preview {
    VoiceInlineSheet(onSubmit: { _ in })
        .preferredColorScheme(.dark)
}
