import SwiftUI

// MARK: - VoiceInputView

/// Full-screen voice input mode with waveform visualization and transcription.
struct VoiceInputView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) var reduceMotion
    @State private var voiceService = VoiceService()
    @State private var waveformHeights: [CGFloat] = Array(repeating: 0.1, count: 40)
    @State private var pulseScale: CGFloat = 1.0
    @State private var ringOpacity: Double = 0.0
    @State private var waveformTimer: Timer?
    @State private var recordingDuration: TimeInterval = 0
    @State private var durationTimer: Timer?
    @State private var permissionError: String?

    let onSend: (String) -> Void

    private var isRecording: Bool { voiceService.isRecording }
    private var transcription: String { voiceService.transcription }

    var body: some View {
        ZStack {
            WTheme.Colors.background.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                Spacer()
                transcriptionArea
                Spacer()
                waveformView
                    .padding(.bottom, WTheme.Spacing.lg)
                microphoneButton
                    .padding(.bottom, WTheme.Spacing.md)
                controlButtons
                    .padding(.bottom, WTheme.Spacing.xxl)
            }
        }
        .onDisappear(perform: cleanup)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Button(action: { dismiss() }) {
                Image(systemName: "xmark.circle.fill")
                    .font(.title2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }

            Spacer()

            VStack(spacing: WTheme.Spacing.xxs) {
                Text("Voice Input")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                if isRecording {
                    Text(formattedDuration)
                        .font(WTheme.Typography.caption)
                        .fontDesign(.monospaced)
                        .foregroundColor(WTheme.Colors.error)
                        .contentTransition(.numericText())
                } else {
                    Text("Tap the microphone to begin")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
            }

            Spacer()

            // Balance the X button width
            Color.clear
                .frame(width: 28, height: 28)
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.top, WTheme.Spacing.md)
    }

    // MARK: - Transcription

    private var transcriptionArea: some View {
        VStack(spacing: WTheme.Spacing.sm) {
            if let error = permissionError ?? voiceService.error?.localizedDescription {
                VStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "mic.slash.fill")
                        .font(.wotannScaled(size: 40))
                        .foregroundColor(WTheme.Colors.error)
                    Text(error)
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.error)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, WTheme.Spacing.xl)
                }
            } else if transcription.isEmpty && !isRecording {
                VStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "waveform.and.mic")
                        .font(.wotannScaled(size: 40))
                        .foregroundColor(WTheme.Colors.textTertiary)
                    Text("Speak your prompt and WOTANN will transcribe it.")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, WTheme.Spacing.xl)
                }
            } else if transcription.isEmpty && isRecording {
                HStack(spacing: WTheme.Spacing.sm) {
                    StreamingDots()
                    Text("Listening...")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
            } else {
                ScrollView {
                    Text(transcription)
                        .font(WTheme.Typography.body)
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(WTheme.Spacing.md)
                }
                .frame(maxHeight: 200)
                .background(WTheme.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg))
                .padding(.horizontal, WTheme.Spacing.md)
            }
        }
        .animation(WTheme.Animation.smooth, value: transcription.isEmpty)
        .animation(WTheme.Animation.smooth, value: isRecording)
    }

    // MARK: - Waveform

    private var waveformView: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(0..<waveformHeights.count, id: \.self) { index in
                RoundedRectangle(cornerRadius: 2)
                    .fill(waveformBarColor(at: index))
                    .frame(width: 4, height: waveformHeights[index] * 60)
                    .animation(
                        .spring(duration: 0.15, bounce: 0.2),
                        value: waveformHeights[index]
                    )
            }
        }
        .frame(height: 64)
        .padding(.horizontal, WTheme.Spacing.lg)
        .opacity(isRecording ? 1 : 0.3)
        .animation(WTheme.Animation.smooth, value: isRecording)
    }

    private func waveformBarColor(at index: Int) -> Color {
        let center = waveformHeights.count / 2
        let distance = abs(index - center)
        let maxDistance = Double(center)
        let progress = 1.0 - (Double(distance) / maxDistance)

        return Color(
            hue: 0.68 + progress * 0.08,
            saturation: 0.6 + progress * 0.2,
            brightness: 0.7 + progress * 0.3
        )
    }

    // MARK: - Microphone Button

    private var microphoneButton: some View {
        ZStack {
            // Outer pulse rings
            Circle()
                .fill(WTheme.Colors.primary.opacity(0.08))
                .frame(width: 160, height: 160)
                .scaleEffect(isRecording ? pulseScale * 1.3 : 1.0)
                .opacity(isRecording ? ringOpacity * 0.5 : 0)

            Circle()
                .fill(WTheme.Colors.primary.opacity(0.12))
                .frame(width: 130, height: 130)
                .scaleEffect(isRecording ? pulseScale * 1.15 : 1.0)
                .opacity(isRecording ? ringOpacity : 0)

            // Main button
            Button(action: toggleRecording) {
                ZStack {
                    Circle()
                        .fill(
                            isRecording
                                ? LinearGradient(
                                    colors: [WTheme.Colors.error, WTheme.Colors.error.opacity(0.8)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                                : LinearGradient(
                                    colors: [WTheme.Colors.primary, WTheme.Colors.primaryDim],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                        )
                        .frame(width: 88, height: 88)
                        .shadow(
                            color: (isRecording ? WTheme.Colors.error : WTheme.Colors.primary)
                                .opacity(0.4),
                            radius: isRecording ? 20 : 12,
                            x: 0,
                            y: 4
                        )

                    Image(systemName: isRecording ? "stop.fill" : "mic.fill")
                        .font(.wotannScaled(size: 32, weight: .medium))
                        .foregroundColor(.white)
                        .contentTransition(.symbolEffect(.replace))
                }
            }
            .scaleEffect(isRecording ? pulseScale : 1.0)
            .accessibilityLabel(isRecording ? "Stop recording" : "Start voice recording")
            .accessibilityHint(isRecording ? "Stops the current voice transcription" : "Begins voice transcription using the microphone")
        }
        .animation(WTheme.Animation.smooth, value: isRecording)
    }

    // MARK: - Control Buttons

    private var controlButtons: some View {
        HStack(spacing: WTheme.Spacing.xl) {
            // Cancel
            Button(action: cancelRecording) {
                VStack(spacing: WTheme.Spacing.xs) {
                    Image(systemName: "trash.circle.fill")
                        .font(.title2)
                        .foregroundColor(WTheme.Colors.textTertiary)
                    Text("Discard")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
            .opacity(transcription.isEmpty && !isRecording ? 0.3 : 1)
            .disabled(transcription.isEmpty && !isRecording)

            // Send
            Button(action: sendTranscription) {
                VStack(spacing: WTheme.Spacing.xs) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.wotannScaled(size: 28))
                        .foregroundColor(
                            canSend
                                ? WTheme.Colors.primary
                                : WTheme.Colors.textTertiary
                        )
                    Text("Send")
                        .font(WTheme.Typography.caption)
                        .fontWeight(.medium)
                        .foregroundColor(
                            canSend
                                ? WTheme.Colors.primary
                                : WTheme.Colors.textTertiary
                        )
                }
            }
            .disabled(!canSend)
        }
    }

    private var canSend: Bool {
        !voiceService.transcription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !voiceService.isRecording
    }

    // MARK: - Actions

    private func toggleRecording() {
        if isRecording {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private func startRecording() {
        permissionError = nil
        recordingDuration = 0

        HapticService.shared.trigger(.voiceStart)

        Task {
            let granted = await voiceService.requestPermissions()
            guard granted else {
                permissionError = "Microphone and speech recognition permissions are required."
                return
            }

            do {
                try await voiceService.startRecording()
            } catch {
                permissionError = error.localizedDescription
                return
            }

            // Animate pulse (skip repeating animation when reduce motion is on)
            if reduceMotion {
                pulseScale = 1.0
                ringOpacity = 0.4
            } else {
                withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                    pulseScale = 1.06
                    ringOpacity = 0.8
                }
            }

            // Drive waveform from real audio level
            waveformTimer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { _ in
                Task { @MainActor in
                    let level = CGFloat(voiceService.audioLevel)
                    var newHeights = waveformHeights
                    for i in 0..<newHeights.count {
                        let base: CGFloat = 0.15
                        let centerBoost = 1.0 - abs(CGFloat(i - newHeights.count / 2)) / CGFloat(newHeights.count / 2)
                        let jitter = CGFloat.random(in: -0.1...0.1)
                        newHeights[i] = base + level * (0.4 + centerBoost * 0.6) + jitter
                    }
                    waveformHeights = newHeights
                }
            }

            // Duration timer
            durationTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
                Task { @MainActor in
                    recordingDuration += 1
                }
            }
        }
    }

    private func stopRecording() {
        voiceService.stopRecording()

        withAnimation(WTheme.Animation.smooth) {
            pulseScale = 1.0
            ringOpacity = 0.0
        }

        HapticService.shared.trigger(.voiceStop)

        waveformTimer?.invalidate()
        waveformTimer = nil
        durationTimer?.invalidate()
        durationTimer = nil

        // Reset waveform to idle
        withAnimation(WTheme.Animation.gentle) {
            waveformHeights = Array(repeating: 0.1, count: 40)
        }
    }

    private func cancelRecording() {
        stopRecording()
        voiceService.transcription = ""
        withAnimation(WTheme.Animation.smooth) {
            recordingDuration = 0
        }
        HapticService.shared.trigger(.selection)
    }

    private func sendTranscription() {
        let text = transcription.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        HapticService.shared.trigger(.messageSent)
        onSend(text)
        dismiss()
    }

    private func cleanup() {
        waveformTimer?.invalidate()
        durationTimer?.invalidate()
        voiceService.stopRecording()
    }

    private var formattedDuration: String {
        let minutes = Int(recordingDuration) / 60
        let seconds = Int(recordingDuration) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}

// MARK: - Previews

#Preview("Voice Input - Idle") {
    VoiceInputView(onSend: { _ in })
        .environmentObject(AppState())
        .preferredColorScheme(.dark)
}
