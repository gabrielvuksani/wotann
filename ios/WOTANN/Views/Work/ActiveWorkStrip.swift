import SwiftUI

// MARK: - ActiveWorkStrip

/// A 56pt docked strip summarising all active agents:
///   • Aggregate progress line (sum of progress divided by count)
///   • Live cost ticker (sum of cost across active agents)
///   • Kill-all button  → cancels every non-terminal agent
///   • Approve-all button → approves every agent currently awaiting approval
/// Appears with a spring animation when any agent becomes active and slides
/// out when all agents reach a terminal state.
struct ActiveWorkStrip: View {
    let activeAgents: [AgentTask]
    let onKillAll: () -> Void
    let onApproveAll: () -> Void

    private var aggregateProgress: Double {
        guard !activeAgents.isEmpty else { return 0 }
        let running = activeAgents.filter { $0.status == .running }
        guard !running.isEmpty else { return 0 }
        let total = running.reduce(0.0) { $0 + $1.progress }
        return total / Double(running.count)
    }

    private var totalCost: Double {
        activeAgents.reduce(0.0) { $0 + $1.cost }
    }

    private var needsApprovalCount: Int {
        activeAgents.filter { $0.status == .approvalRequired }.count
    }

    private var runningCount: Int {
        activeAgents.filter { $0.status == .running }.count
    }

    private var summaryText: String {
        let parts: [String] = [
            runningCount > 0 ? "\(runningCount) running" : nil,
            needsApprovalCount > 0 ? "\(needsApprovalCount) approval" : nil,
        ].compactMap { $0 }
        return parts.isEmpty ? "\(activeAgents.count) active" : parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(spacing: 6) {
            // Aggregate progress line
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(WTheme.Colors.border)
                    .frame(height: 2)

                GeometryReader { proxy in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(WTheme.Colors.primary)
                        .frame(width: proxy.size.width * max(0.02, CGFloat(aggregateProgress)), height: 2)
                        .animation(WTheme.Animation.smooth, value: aggregateProgress)
                }
                .frame(height: 2)
            }

            HStack(spacing: WTheme.Spacing.md) {
                // Summary + cost
                VStack(alignment: .leading, spacing: 2) {
                    Text(summaryText)
                        .font(.wotannScaled(size: 13, weight: .semibold))
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .lineLimit(1)
                    Text(formattedCost)
                        .font(.wotannScaled(size: 12, weight: .medium, design: .monospaced))
                        .monospacedDigit()
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .lineLimit(1)
                        .contentTransition(.numericText())
                        .animation(WTheme.Animation.quick, value: totalCost)
                }

                Spacer()

                // Approve-all (only when at least one is pending approval)
                if needsApprovalCount > 0 {
                    Button {
                        HapticService.shared.trigger(.responseComplete)
                        onApproveAll()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "checkmark")
                                .font(.wotannScaled(size: 12, weight: .bold))
                            Text("Approve All")
                                .font(.wotannScaled(size: 13, weight: .semibold))
                        }
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            Capsule().fill(WTheme.Colors.success)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Approve all pending")
                }

                // Kill all
                Button {
                    HapticService.shared.trigger(.error)
                    onKillAll()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "stop.fill")
                            .font(.wotannScaled(size: 11, weight: .bold))
                        Text("Kill All")
                            .font(.wotannScaled(size: 13, weight: .semibold))
                    }
                    .foregroundColor(WTheme.Colors.error)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        Capsule().stroke(WTheme.Colors.error, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Kill all active agents")
            }
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        .frame(height: 56)
        .background(
            RoundedRectangle(cornerRadius: WTheme.Radius.md)
                .fill(WTheme.Colors.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md)
                .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
        )
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.top, WTheme.Spacing.xs)
        .transition(.asymmetric(
            insertion: .move(edge: .top).combined(with: .opacity),
            removal: .move(edge: .top).combined(with: .opacity)
        ))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Active work summary: \(summaryText). Total cost \(formattedCost).")
    }

    private var formattedCost: String {
        if totalCost == 0 {
            return "$0.00"
        } else if totalCost < 0.01 {
            return String(format: "$%.4f", totalCost)
        } else if totalCost < 1 {
            return String(format: "$%.3f", totalCost)
        } else {
            return String(format: "$%.2f", totalCost)
        }
    }
}
