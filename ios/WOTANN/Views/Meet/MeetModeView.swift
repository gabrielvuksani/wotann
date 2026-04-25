import SwiftUI
import Observation

// MARK: - Meet Mode

/// Meeting assistant — record, transcribe, summarize via WOTANN.
/// Inspired by Cortex's Meet mode: templates, real-time transcription, AI summaries.
///
/// V9 T14.3 — `MeetModeViewModel` migrated from ObservableObject + @Published
/// to the iOS 17 @Observable macro. The owning view switched from @StateObject
/// to @State, and `ActiveMeetingView` switched from @ObservedObject to a plain
/// `let` since it only reads from the view model.
struct MeetModeView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var meetVM = MeetModeViewModel()

    var body: some View {
        NavigationStack {
            Group {
                if let meeting = meetVM.activeMeeting {
                    ActiveMeetingView(meeting: meeting, viewModel: meetVM)
                } else {
                    MeetingTemplateList(onSelect: { template in
                        meetVM.startMeeting(template: template)
                    })
                }
            }
            .navigationTitle("Meet")
            .toolbar {
                if meetVM.activeMeeting != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("End") {
                            meetVM.endMeeting()
                        }
                        .foregroundColor(WTheme.Colors.error)
                    }
                }
            }
            .onAppear {
                meetVM.configure(rpcClient: connectionManager.rpcClient)
            }
        }
    }
}

// MARK: - Meeting Templates

struct MeetingTemplateList: View {
    let onSelect: (MeetingType) -> Void

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: WTheme.Spacing.md) {
                ForEach(MeetingType.allCases) { template in
                    Button { onSelect(template) } label: {
                        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                            Image(systemName: template.icon)
                                .font(.title2)
                                .foregroundColor(template.color)
                            Text(template.title)
                                .font(WTheme.Typography.headline)
                                .foregroundColor(WTheme.Colors.textPrimary)
                            Text(template.description)
                                .font(WTheme.Typography.caption)
                                .foregroundColor(WTheme.Colors.textSecondary)
                                .lineLimit(2)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(WTheme.Spacing.md)
                        .background(WTheme.Colors.surface)
                        .cornerRadius(WTheme.Radius.lg)
                    }
                }
            }
            .padding(WTheme.Spacing.md)
        }
        .background(WTheme.Colors.background)
    }
}

// MARK: - Active Meeting View

struct ActiveMeetingView: View {
    let meeting: ActiveMeeting
    let viewModel: MeetModeViewModel

    var body: some View {
        VStack(spacing: 0) {
            // Recording indicator
            HStack(spacing: WTheme.Spacing.sm) {
                Circle()
                    .fill(viewModel.isRecording ? WTheme.Colors.error : WTheme.Colors.textTertiary)
                    .frame(width: 10, height: 10)
                    .scaleEffect(viewModel.isRecording ? 1.2 : 1.0)
                    .animation(.easeInOut(duration: 0.5).repeatForever(), value: viewModel.isRecording)
                Text(viewModel.isRecording ? "Recording..." : "Paused")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
                Spacer()
                Text(viewModel.formattedDuration)
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
            .background(WTheme.Colors.surface)

            // Transcript
            ScrollView {
                LazyVStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    ForEach(viewModel.transcriptSegments) { segment in
                        TranscriptSegmentRow(segment: segment)
                    }
                    if viewModel.liveTranscript.isEmpty == false {
                        Text(viewModel.liveTranscript)
                            .font(WTheme.Typography.body)
                            .foregroundColor(WTheme.Colors.primary.opacity(0.8))
                            .italic()
                            .padding(.horizontal, WTheme.Spacing.md)
                    }
                }
                .padding(.vertical, WTheme.Spacing.md)
            }

            // AI Summary (when available)
            if let summary = viewModel.aiSummary {
                Divider()
                VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                    Text("AI Summary")
                        .font(WTheme.Typography.headline)
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Text(summary)
                        .font(WTheme.Typography.body)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
                .padding(WTheme.Spacing.md)
                .background(WTheme.Colors.surface)
            }

            // Controls
            HStack(spacing: WTheme.Spacing.xl) {
                Button {
                    viewModel.toggleRecording()
                } label: {
                    Image(systemName: viewModel.isRecording ? "pause.circle.fill" : "record.circle")
                        .font(.wotannScaled(size: 56))
                        .foregroundColor(viewModel.isRecording ? WTheme.Colors.warning : WTheme.Colors.error)
                }

                Button {
                    viewModel.generateSummary()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "sparkles")
                            .font(.title2)
                        Text("Summarize")
                            .font(WTheme.Typography.caption2)
                    }
                    .foregroundColor(WTheme.Colors.primary)
                }
                .disabled(viewModel.transcriptSegments.isEmpty)

                Button {
                    viewModel.dispatchToDesktop()
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: "desktopcomputer")
                            .font(.title2)
                        Text("Dispatch")
                            .font(WTheme.Typography.caption2)
                    }
                    .foregroundColor(WTheme.Colors.success)
                }
            }
            .padding(.vertical, WTheme.Spacing.lg)
            .background(WTheme.Colors.surface)
        }
    }
}

// MARK: - Transcript Segment Row

struct TranscriptSegmentRow: View {
    let segment: TranscriptSegment

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(segment.speaker)
                    .font(WTheme.Typography.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(WTheme.Colors.primary)
                Text(segment.formattedTimestamp)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            Text(segment.text)
                .font(WTheme.Typography.body)
                .foregroundColor(WTheme.Colors.textPrimary)
        }
        .padding(.horizontal, WTheme.Spacing.md)
    }
}

// MARK: - Models

enum MeetingType: String, CaseIterable, Identifiable {
    case standup, oneOnOne, retro, planning, brainstorm, blank

    var id: String { rawValue }

    var title: String {
        switch self {
        case .standup: return "Daily Standup"
        case .oneOnOne: return "1:1 Meeting"
        case .retro: return "Retrospective"
        case .planning: return "Sprint Planning"
        case .brainstorm: return "Brainstorm"
        case .blank: return "Blank Meeting"
        }
    }

    var description: String {
        switch self {
        case .standup: return "Quick sync on blockers and priorities"
        case .oneOnOne: return "Check-in on goals and feedback"
        case .retro: return "What worked, what didn't, what's next"
        case .planning: return "Scope work and estimate effort"
        case .brainstorm: return "Free-form idea generation"
        case .blank: return "Start from scratch"
        }
    }

    var icon: String {
        switch self {
        case .standup: return "sunrise.fill"
        case .oneOnOne: return "person.2.fill"
        case .retro: return "arrow.counterclockwise.circle.fill"
        case .planning: return "calendar.badge.clock"
        case .brainstorm: return "lightbulb.fill"
        case .blank: return "doc.badge.plus"
        }
    }

    var color: Color {
        switch self {
        case .standup: return WTheme.Colors.error
        case .oneOnOne: return WTheme.Colors.primary
        case .retro: return WTheme.Colors.warning
        case .planning: return WTheme.Colors.success
        case .brainstorm: return WTheme.Colors.brainstormAccent
        case .blank: return WTheme.Colors.textTertiary
        }
    }
}

struct ActiveMeeting: Identifiable {
    let id = UUID()
    let type: MeetingType
    let startedAt: Date
    var title: String
}

struct TranscriptSegment: Identifiable {
    let id = UUID()
    let speaker: String
    let text: String
    let timestamp: TimeInterval
    var formattedTimestamp: String {
        let m = Int(timestamp) / 60
        let s = Int(timestamp) % 60
        return String(format: "%d:%02d", m, s)
    }
}

// MARK: - ViewModel

@MainActor
@Observable
final class MeetModeViewModel {
    var activeMeeting: ActiveMeeting?
    var isRecording = false
    var transcriptSegments: [TranscriptSegment] = []
    var liveTranscript = ""
    var aiSummary: String?
    var elapsedSeconds: Int = 0
    var isSummarizing = false
    var isDispatching = false

    @ObservationIgnored
    private var timer: Timer?
    @ObservationIgnored
    private let voiceService = VoiceService()
    @ObservationIgnored
    private var lastTranscription = ""
    @ObservationIgnored
    private var rpcClient: RPCClient?

    /// Tracks the current speaker index (1 or 2) for simple diarization heuristic.
    @ObservationIgnored
    private var currentSpeakerIndex = 1
    /// Timestamp (in elapsed seconds) when the last segment was finalized.
    @ObservationIgnored
    private var lastSegmentEndTime: Int = 0
    /// Pause threshold in seconds -- gaps longer than this trigger a speaker change.
    private static let speakerChangeThreshold = 2

    /// Inject the RPC client for desktop communication.
    func configure(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    var formattedDuration: String {
        let m = elapsedSeconds / 60
        let s = elapsedSeconds % 60
        return String(format: "%d:%02d", m, s)
    }

    func startMeeting(template: MeetingType) {
        activeMeeting = ActiveMeeting(type: template, startedAt: Date(), title: template.title)
        isRecording = true
        elapsedSeconds = 0
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.elapsedSeconds += 1
                // Capture live transcription updates
                let current = self.voiceService.transcription
                if current != self.lastTranscription {
                    self.liveTranscript = current
                }
            }
        }
        HapticService.shared.trigger(.voiceStart)

        Task {
            let granted = await voiceService.requestPermissions()
            if granted {
                try? await voiceService.startRecording()
            }
        }
    }

    func endMeeting() {
        voiceService.stopRecording()
        finalizeCurrentSegment()
        isRecording = false
        timer?.invalidate()
        timer = nil
        activeMeeting = nil
        transcriptSegments = []
        liveTranscript = ""
        aiSummary = nil
        lastTranscription = ""
        currentSpeakerIndex = 1
        lastSegmentEndTime = 0
        HapticService.shared.trigger(.voiceStop)
    }

    func toggleRecording() {
        if isRecording {
            voiceService.stopRecording()
            finalizeCurrentSegment()
            isRecording = false
            HapticService.shared.trigger(.voiceStop)
        } else {
            isRecording = true
            HapticService.shared.trigger(.voiceStart)
            Task {
                try? await voiceService.startRecording()
            }
        }
    }

    private func finalizeCurrentSegment() {
        let text = voiceService.transcription.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty && text != lastTranscription {
            // Determine speaker label based on pause gap heuristic.
            // If more than `speakerChangeThreshold` seconds have elapsed since the
            // last segment, assume a different person is speaking and toggle the index.
            let pauseGap = elapsedSeconds - lastSegmentEndTime
            if !transcriptSegments.isEmpty && pauseGap > Self.speakerChangeThreshold {
                currentSpeakerIndex = currentSpeakerIndex == 1 ? 2 : 1
            }

            let segment = TranscriptSegment(
                speaker: "Speaker \(currentSpeakerIndex)",
                text: text,
                timestamp: TimeInterval(elapsedSeconds)
            )
            transcriptSegments.append(segment)
            lastTranscription = text
            lastSegmentEndTime = elapsedSeconds
            liveTranscript = ""
        }
    }

    func generateSummary() {
        guard !transcriptSegments.isEmpty else { return }

        let transcript = transcriptSegments
            .map { "\($0.speaker) [\($0.formattedTimestamp)]: \($0.text)" }
            .joined(separator: "\n")

        guard let rpcClient else {
            aiSummary = "Not connected to WOTANN desktop. Pair your device to generate AI summaries."
            return
        }

        isSummarizing = true
        aiSummary = "Generating summary..."

        Task {
            do {
                let response = try await rpcClient.send("meet.summarize", params: [
                    "transcript": .string(transcript),
                    "segmentCount": .int(transcriptSegments.count),
                    "durationSeconds": .int(elapsedSeconds),
                    "meetingType": .string(activeMeeting?.type.rawValue ?? "blank"),
                ])
                aiSummary = response.result?.stringValue
                    ?? "Summary generated. Open the desktop app for full details."
                HapticService.shared.trigger(.enhanceComplete)
            } catch {
                aiSummary = "Summary failed: \(error.localizedDescription)"
                HapticService.shared.trigger(.error)
            }
            isSummarizing = false
        }
    }

    func dispatchToDesktop() {
        guard !transcriptSegments.isEmpty else { return }

        let transcript = transcriptSegments
            .map { "\($0.speaker) [\($0.formattedTimestamp)]: \($0.text)" }
            .joined(separator: "\n")

        guard let rpcClient else {
            HapticService.shared.trigger(.error)
            return
        }

        isDispatching = true
        HapticService.shared.trigger(.messageSent)

        let prompt = "Process this meeting transcript. Extract action items, decisions, and follow-ups:\n\n\(transcript)"

        Task {
            do {
                let request = DispatchRequest(
                    prompt: prompt,
                    provider: nil,
                    model: nil,
                    template: nil
                )
                _ = try await rpcClient.dispatchTask(request)
                HapticService.shared.trigger(.taskComplete)
            } catch {
                HapticService.shared.trigger(.error)
            }
            isDispatching = false
        }
    }
}
