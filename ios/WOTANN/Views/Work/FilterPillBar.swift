import SwiftUI

// MARK: - WorkFilter

/// The segmented pill filter values shown on the Work tab. Maps each visual
/// bucket to the `TaskState` values it aggregates. A single tab can represent
/// multiple raw states (e.g. `.pending` covers both queued and paused) so
/// users see a short, high-signal list rather than raw enum names.
enum WorkFilter: String, CaseIterable, Identifiable, Hashable {
    case running
    case pending
    case approval
    case done
    case failed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .running:  return "Running"
        case .pending:  return "Pending"
        case .approval: return "Approval"
        case .done:     return "Done"
        case .failed:   return "Failed"
        }
    }

    /// The set of raw `TaskState` values that should appear under this pill.
    func matches(_ state: TaskState) -> Bool {
        switch self {
        case .running:  return state == .running
        case .pending:  return state == .queued || state == .paused
        case .approval: return state == .approvalRequired
        case .done:     return state == .completed
        case .failed:   return state == .failed || state == .cancelled
        }
    }

    /// Tint used for the pill's count badge and active underline.
    var tint: Color {
        switch self {
        case .running:  return WTheme.Colors.primary
        case .pending:  return WTheme.Colors.textSecondary
        case .approval: return WTheme.Colors.warning
        case .done:     return WTheme.Colors.success
        case .failed:   return WTheme.Colors.error
        }
    }
}

// MARK: - FilterPillBar

/// Horizontal row of segmented pills with a slide underline that animates
/// between the active pill via `matchedGeometryEffect`. Counts are live from
/// the caller so the badge updates as `appState.agents` changes.
struct FilterPillBar: View {
    @Binding var selection: WorkFilter
    /// Returns the live count of agents for a given filter.
    let counts: (WorkFilter) -> Int

    @Namespace private var underlineNamespace

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: WTheme.Spacing.xs) {
                ForEach(WorkFilter.allCases) { filter in
                    pill(for: filter)
                }
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
        }
        .background(WTheme.Colors.background)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(WTheme.Colors.border)
                .frame(height: WTheme.BorderWidth.hairline)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filter work by status")
    }

    private func pill(for filter: WorkFilter) -> some View {
        let isActive = selection == filter
        let count = counts(filter)

        return Button {
            withAnimation(WTheme.Animation.smooth) {
                selection = filter
            }
            HapticService.shared.trigger(.selection)
        } label: {
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    Text(filter.title)
                        // T7.6 — Dynamic Type cleanup. Scaled variant keeps
                        // the 14pt pill label readable under Accessibility
                        // Sizes without breaking the pill layout.
                        .font(.wotannScaled(size: 14, weight: isActive ? .semibold : .medium))
                        .foregroundColor(isActive ? WTheme.Colors.textPrimary : WTheme.Colors.textSecondary)

                    Text("\(count)")
                        .font(.wotannScaled(size: 11, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(isActive ? .white : filter.tint)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule().fill(
                                isActive
                                    ? filter.tint
                                    : filter.tint.opacity(0.15)
                            )
                        )
                }
                .padding(.horizontal, WTheme.Spacing.sm)
                .padding(.vertical, 6)

                // Underline: matched geometry so the bar slides between pills.
                ZStack {
                    if isActive {
                        Capsule()
                            .fill(filter.tint)
                            .frame(height: 2)
                            .matchedGeometryEffect(id: "underline", in: underlineNamespace)
                    } else {
                        Capsule()
                            .fill(Color.clear)
                            .frame(height: 2)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(filter.title), \(count) items")
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}
