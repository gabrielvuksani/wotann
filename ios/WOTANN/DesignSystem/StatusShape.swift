import SwiftUI

// MARK: - Status Shape Tokens

/// Maps `TaskState` to a trio of (color, SF Symbol, shape) so every status
/// indicator communicates state through BOTH color AND shape. This makes
/// status legible for color-blind users — a core accessibility requirement.
enum StatusShape {
    /// The shape token for a state. Paired with the color for redundancy.
    enum Glyph {
        case circle          // running, active, live
        case square          // queued, pending
        case triangle        // warning, approval-required
        case cross           // failed, error
        case checkmark       // completed
        case pauseBars       // paused
        case stop            // cancelled

        var systemName: String {
            switch self {
            case .circle:     return "circle.fill"
            case .square:     return "square.fill"
            case .triangle:   return "exclamationmark.triangle.fill"
            case .cross:      return "xmark.circle.fill"
            case .checkmark:  return "checkmark.circle.fill"
            case .pauseBars:  return "pause.circle.fill"
            case .stop:       return "stop.circle.fill"
            }
        }
    }
}

// MARK: - TaskState → Status Rendering

/// The SF Symbol paired with a given `TaskState`.
/// Each state uses a distinct shape, not just a color, for color-blind users.
func statusGlyph(for state: TaskState) -> Image {
    Image(systemName: glyph(for: state).systemName)
}

/// Returns the theme color associated with a `TaskState`.
func statusColor(for state: TaskState) -> Color {
    switch state {
    case .queued:           return WTheme.Colors.textTertiary
    case .running:          return WTheme.Colors.primary
    case .paused:           return WTheme.Colors.warning
    case .completed:        return WTheme.Colors.success
    case .failed:           return WTheme.Colors.error
    case .cancelled:        return WTheme.Colors.textQuaternary
    case .approvalRequired: return WTheme.Colors.warning
    }
}

/// Returns the shape glyph for a `TaskState`.
func glyph(for state: TaskState) -> StatusShape.Glyph {
    switch state {
    case .queued:           return .square
    case .running:          return .circle
    case .paused:           return .pauseBars
    case .completed:        return .checkmark
    case .failed:           return .cross
    case .cancelled:        return .stop
    case .approvalRequired: return .triangle
    }
}

// MARK: - Pre-composed Status Badge

/// A small pill-shaped badge showing a state's symbol + label.
/// Uses both color and shape so color-blind users can distinguish states.
struct StatusBadge: View {
    let state: TaskState

    var body: some View {
        HStack(spacing: WTheme.Spacing.xs) {
            statusGlyph(for: state)
                .font(.system(size: 10, weight: .bold))
            Text(state.displayName)
                .font(WTheme.Typography.captionStd)
        }
        .foregroundColor(statusColor(for: state))
        .padding(.horizontal, WTheme.Spacing.sm)
        .padding(.vertical, WTheme.Spacing.xxs)
        .background(statusColor(for: state).opacity(0.12))
        .clipShape(Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(state.displayName) status"))
    }
}
