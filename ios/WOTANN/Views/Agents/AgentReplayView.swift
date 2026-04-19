import SwiftUI

// MARK: - ReplayStep

/// A single step in an agent's action replay log.
struct ReplayStep: Identifiable, Hashable {
    let id: UUID
    let index: Int
    let action: String
    let detail: String
    let timestamp: Date
    let status: StepStatus
    let duration: TimeInterval?

    enum StepStatus: String, Hashable {
        case success
        case error
        case inProgress
        case skipped

        var iconName: String {
            switch self {
            case .success:    return "checkmark.circle.fill"
            case .error:      return "xmark.circle.fill"
            case .inProgress: return "arrow.clockwise.circle.fill"
            case .skipped:    return "forward.circle.fill"
            }
        }

        var color: Color {
            switch self {
            case .success:    return WTheme.Colors.success
            case .error:      return WTheme.Colors.error
            case .inProgress: return WTheme.Colors.info
            case .skipped:    return WTheme.Colors.textTertiary
            }
        }
    }

    init(
        id: UUID = UUID(),
        index: Int,
        action: String,
        detail: String = "",
        timestamp: Date = Date(),
        status: StepStatus = .success,
        duration: TimeInterval? = nil
    ) {
        self.id = id
        self.index = index
        self.action = action
        self.detail = detail
        self.timestamp = timestamp
        self.status = status
        self.duration = duration
    }
}

// MARK: - AgentReplayView

/// Displays a step-by-step action log for a completed autonomous task.
/// Includes a scrubber to navigate steps and a "Replay from here" button.
struct AgentReplayView: View {
    let taskTitle: String
    let steps: [ReplayStep]
    let onReplayFrom: ((Int) -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var currentStepIndex: Double = 0
    @State private var expandedStepIds: Set<UUID> = []

    init(
        taskTitle: String,
        steps: [ReplayStep],
        onReplayFrom: ((Int) -> Void)? = nil
    ) {
        self.taskTitle = taskTitle
        self.steps = steps
        self.onReplayFrom = onReplayFrom
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Scrubber
                scrubberSection

                // Step list
                stepList
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Replay")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    // MARK: - Scrubber

    private var scrubberSection: some View {
        VStack(spacing: WTheme.Spacing.sm) {
            // Task title
            Text(taskTitle)
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(2)
                .multilineTextAlignment(.center)

            // Step counter
            Text("Step \(selectedStepNumber) of \(steps.count)")
                .font(WTheme.Typography.caption)
                .fontDesign(.monospaced)
                .foregroundColor(WTheme.Colors.textSecondary)

            // Slider scrubber
            if steps.count > 1 {
                Slider(
                    value: $currentStepIndex,
                    in: 0...Double(steps.count - 1),
                    step: 1
                )
                .tint(WTheme.Colors.primary)
                .padding(.horizontal, WTheme.Spacing.md)
            }

            // Replay from here button
            if let onReplayFrom {
                Button {
                    onReplayFrom(Int(currentStepIndex))
                } label: {
                    HStack(spacing: WTheme.Spacing.xs) {
                        Image(systemName: "play.fill")
                            .font(.caption)
                        Text("Replay from step \(selectedStepNumber)")
                            .font(WTheme.Typography.subheadline)
                            .fontWeight(.semibold)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Gradients.primary)
                    .clipShape(Capsule())
                }
            }
        }
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .overlay(alignment: .bottom) {
            Divider().foregroundColor(WTheme.Colors.border)
        }
    }

    // MARK: - Step List

    private var stepList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                        stepRow(step: step, index: index)
                            .id(step.id)
                            .wStaggered(index: index)
                    }
                }
                .padding(.vertical, WTheme.Spacing.sm)
            }
            .onChange(of: currentStepIndex) { _, newValue in
                let idx = Int(newValue)
                if idx >= 0 && idx < steps.count {
                    withAnimation(WTheme.Animation.quick) {
                        proxy.scrollTo(steps[idx].id, anchor: .center)
                    }
                }
            }
        }
    }

    // MARK: - Step Row

    private func stepRow(step: ReplayStep, index: Int) -> some View {
        let isSelected = index == Int(currentStepIndex)
        let isExpanded = expandedStepIds.contains(step.id)

        return Button {
            withAnimation(WTheme.Animation.quick) {
                currentStepIndex = Double(index)
                if expandedStepIds.contains(step.id) {
                    expandedStepIds.remove(step.id)
                } else {
                    expandedStepIds.insert(step.id)
                }
            }
        } label: {
            HStack(alignment: .top, spacing: WTheme.Spacing.sm) {
                // Timeline indicator
                VStack(spacing: 0) {
                    // Status icon
                    Image(systemName: step.status.iconName)
                        .font(.wotannScaled(size: 18))
                        .foregroundColor(step.status.color)

                    // Connecting line (except last step)
                    if index < steps.count - 1 {
                        Rectangle()
                            .fill(WTheme.Colors.border)
                            .frame(width: 1.5)
                            .frame(maxHeight: .infinity)
                    }
                }
                .frame(width: 24)

                // Content
                VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                    // Action title
                    Text(step.action)
                        .font(WTheme.Typography.subheadline)
                        .fontWeight(isSelected ? .semibold : .regular)
                        .foregroundColor(
                            isSelected
                                ? WTheme.Colors.textPrimary
                                : WTheme.Colors.textSecondary
                        )
                        .lineLimit(isExpanded ? nil : 2)

                    // Metadata row: time + duration
                    HStack(spacing: WTheme.Spacing.sm) {
                        Text(step.timestamp, style: .time)
                            .font(WTheme.Typography.caption2)
                            .foregroundColor(WTheme.Colors.textTertiary)

                        if let duration = step.duration {
                            Text(formatDuration(duration))
                                .font(WTheme.Typography.caption2)
                                .fontDesign(.monospaced)
                                .foregroundColor(WTheme.Colors.textTertiary)
                        }
                    }

                    // Expanded detail
                    if isExpanded && !step.detail.isEmpty {
                        Text(step.detail)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .padding(WTheme.Spacing.sm)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(WTheme.Colors.surfaceAlt)
                            .clipShape(
                                RoundedRectangle(
                                    cornerRadius: WTheme.Radius.sm,
                                    style: .continuous
                                )
                            )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
            .background(
                isSelected
                    ? WTheme.Colors.primary.opacity(0.08)
                    : Color.clear
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Step \(step.index + 1): \(step.action). Status: \(step.status.rawValue)")
    }

    // MARK: - Helpers

    private var selectedStepNumber: Int {
        Int(currentStepIndex) + 1
    }

    private func formatDuration(_ interval: TimeInterval) -> String {
        if interval < 1 {
            return "\(Int(interval * 1000))ms"
        } else if interval < 60 {
            return String(format: "%.1fs", interval)
        } else {
            let minutes = Int(interval) / 60
            let seconds = Int(interval) % 60
            return "\(minutes)m \(seconds)s"
        }
    }
}
