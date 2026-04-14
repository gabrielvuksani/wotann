import SwiftUI

// MARK: - TaskPriority (future)

/// Reserved for future AgentTask priority support. Defaults to `.p3`
/// (no flag) today. When AgentTask gains a priority field, map it through
/// `priority(for:)` to render the correct flag.
enum TaskPriority {
    case p1
    case p2
    case p3

    var label: String? {
        switch self {
        case .p1: return "P1"
        case .p2: return "P2"
        case .p3: return nil
        }
    }

    var tint: Color {
        switch self {
        case .p1: return WTheme.Colors.error
        case .p2: return WTheme.Colors.warning
        case .p3: return WTheme.Colors.textTertiary
        }
    }
}

/// Resolve the priority for an agent. Centralised so we can switch to a
/// real field on `AgentTask` later without touching the row.
func priority(for _: AgentTask) -> TaskPriority {
    .p3
}

// MARK: - WorkAgentRow

/// Linear-style row (88pt tall) for the Work tab list.
/// Visual anatomy, left → right:
///   - 8pt vertical status bar (color + position encodes state)
///   - optional priority flag (P1/P2)
///   - title (17pt semibold) + subtitle ("2/5 steps · Claude Opus · 3m ago")
///   - cost badge (mono 14pt) + progress ring (running) + chevron
/// Interactions:
///   - Long-press: context menu (Cancel, Duplicate, Re-run different model,
///     Convert to Workflow, Pin) with a medium haptic
///   - Swipe right: Approve / Reject (only when approval required)
///   - Swipe left: Archive / Cancel
struct WorkAgentRow: View {
    let agent: AgentTask
    var onTap: () -> Void = {}
    var onApprove: () -> Void = {}
    var onReject: () -> Void = {}
    var onArchive: () -> Void = {}
    var onCancel: () -> Void = {}
    var onDuplicate: () -> Void = {}
    var onRerunDifferentModel: () -> Void = {}
    var onConvertToWorkflow: () -> Void = {}
    var onPin: () -> Void = {}

    private var statusTint: Color { statusColor(for: agent.status) }
    private var stepsText: String {
        // Progress is 0…1. Until the backend exposes explicit step counts,
        // synthesise a "n/m steps" string from the progress ratio so the
        // subtitle never shows "0/0 steps".
        let totalSteps = 5
        let completed = max(0, min(totalSteps, Int((agent.progress * Double(totalSteps)).rounded())))
        return "\(completed)/\(totalSteps) steps"
    }

    private var modelText: String {
        // Short, human-friendly model name.
        switch agent.model.lowercased() {
        case let m where m.contains("opus"):    return "Claude Opus"
        case let m where m.contains("sonnet"):  return "Claude Sonnet"
        case let m where m.contains("haiku"):   return "Claude Haiku"
        case let m where m.contains("gpt-4"):   return "GPT-4"
        case let m where m.contains("o1"):      return "o1"
        case "auto":                            return "Auto"
        default:                                return agent.model
        }
    }

    private var relativeTimeText: String {
        let now = Date.now
        let interval = now.timeIntervalSince(agent.startedAt)
        if interval < 60 { return "just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86_400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86_400))d ago"
    }

    var body: some View {
        Button(action: {
            HapticService.shared.trigger(.buttonTap)
            onTap()
        }) {
            content
        }
        .buttonStyle(.plain)
        .contextMenu { contextMenu }
        .swipeActions(edge: .leading, allowsFullSwipe: false) {
            if agent.status == .approvalRequired {
                Button {
                    HapticService.shared.trigger(.responseComplete)
                    onApprove()
                } label: {
                    Label("Approve", systemImage: "checkmark.circle.fill")
                }
                .tint(WTheme.Colors.success)

                Button {
                    HapticService.shared.trigger(.error)
                    onReject()
                } label: {
                    Label("Reject", systemImage: "xmark.circle.fill")
                }
                .tint(WTheme.Colors.error)
            }
        }
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button(role: .destructive) {
                HapticService.shared.trigger(.error)
                onCancel()
            } label: {
                Label("Cancel", systemImage: "xmark.circle")
            }

            Button {
                HapticService.shared.trigger(.buttonTap)
                onArchive()
            } label: {
                Label("Archive", systemImage: "archivebox.fill")
            }
            .tint(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.background)
        .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
        .listRowSeparator(.hidden)
    }

    // MARK: - Content

    private var content: some View {
        ZStack(alignment: .bottom) {
            HStack(spacing: 0) {
                // 8pt status bar.
                statusTint
                    .frame(width: 8)
                    .accessibilityHidden(true)

                HStack(spacing: WTheme.Spacing.md) {
                    // Priority flag column (fixed-width so titles line up).
                    priorityColumn
                        .frame(width: 22, alignment: .leading)

                    // Title + subtitle.
                    VStack(alignment: .leading, spacing: 4) {
                        Text(agent.title)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(WTheme.Colors.textPrimary)
                            .lineLimit(1)

                        HStack(spacing: 4) {
                            Text(stepsText)
                            Text("·").foregroundColor(WTheme.Colors.textTertiary)
                            Text(modelText)
                            Text("·").foregroundColor(WTheme.Colors.textTertiary)
                            Text(relativeTimeText)
                        }
                        .font(.system(size: 13))
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .lineLimit(1)
                    }

                    Spacer(minLength: WTheme.Spacing.sm)

                    // Right accessories.
                    HStack(spacing: WTheme.Spacing.sm) {
                        Text(costLabelText)
                            .font(.system(size: 14, weight: .medium, design: .monospaced))
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .monospacedDigit()

                        if agent.status == .running {
                            progressRing
                                .frame(width: 24, height: 24)
                        } else {
                            statusGlyph(for: agent.status)
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(statusTint)
                                .frame(width: 24, height: 24)
                        }

                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }
                .padding(.horizontal, WTheme.Spacing.md)
            }
            .frame(height: 88)
            .background(WTheme.Colors.background)
            .contentShape(Rectangle())

            // 0.5pt hairline divider.
            Rectangle()
                .fill(WTheme.Colors.border)
                .frame(height: WTheme.BorderWidth.hairline)
                .padding(.leading, 8 + WTheme.Spacing.md)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(agent.title), \(agent.status.displayName), \(Int(agent.progress * 100)) percent")
        .accessibilityHint("Double tap to view details. Swipe for actions.")
    }

    private var priorityColumn: some View {
        Group {
            if let label = priority(for: agent).label {
                Text(label)
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundColor(priority(for: agent).tint)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .stroke(priority(for: agent).tint, lineWidth: 1)
                    )
                    .accessibilityLabel("Priority \(label)")
            } else {
                Color.clear
            }
        }
    }

    private var progressRing: some View {
        ZStack {
            Circle()
                .stroke(WTheme.Colors.border, lineWidth: 2)
            Circle()
                .trim(from: 0, to: max(0.02, CGFloat(agent.progress)))
                .stroke(
                    statusTint,
                    style: StrokeStyle(lineWidth: 2, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(WTheme.Animation.smooth, value: agent.progress)
        }
    }

    private var costLabelText: String {
        if agent.cost == 0 {
            return "$0.00"
        } else if agent.cost < 0.01 {
            return String(format: "$%.4f", agent.cost)
        } else if agent.cost < 1 {
            return String(format: "$%.3f", agent.cost)
        } else {
            return String(format: "$%.2f", agent.cost)
        }
    }

    // MARK: - Context Menu

    @ViewBuilder
    private var contextMenu: some View {
        Button(role: .destructive) {
            HapticService.shared.trigger(.error)
            onCancel()
        } label: {
            Label("Cancel", systemImage: "xmark.circle")
        }

        Button {
            HapticService.shared.trigger(.buttonTap)
            onDuplicate()
        } label: {
            Label("Duplicate", systemImage: "plus.square.on.square")
        }

        Button {
            HapticService.shared.trigger(.buttonTap)
            onRerunDifferentModel()
        } label: {
            Label("Re-run with different model", systemImage: "arrow.triangle.2.circlepath")
        }

        Button {
            HapticService.shared.trigger(.buttonTap)
            onConvertToWorkflow()
        } label: {
            Label("Convert to Workflow", systemImage: "flowchart")
        }

        Button {
            HapticService.shared.trigger(.buttonTap)
            onPin()
        } label: {
            Label("Pin", systemImage: "pin.fill")
        }
    }
}
