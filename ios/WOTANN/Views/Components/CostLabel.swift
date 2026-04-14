import SwiftUI

// MARK: - CostLabel

/// Formatted cost display optimized for small dollar amounts.
struct CostLabel: View {
    let amount: Double
    var style: CostStyle = .default

    enum CostStyle {
        case `default`
        case compact
        case large
    }

    var body: some View {
        Text(formattedCost)
            .font(font)
            .fontDesign(.monospaced)
            .foregroundColor(color)
    }

    private var formattedCost: String {
        if amount == 0 {
            return "$0.00"
        } else if amount < 0.01 {
            return "$\(String(format: "%.4f", amount))"
        } else if amount < 1.0 {
            return "$\(String(format: "%.3f", amount))"
        } else if amount < 100 {
            return "$\(String(format: "%.2f", amount))"
        } else {
            return "$\(String(format: "%.0f", amount))"
        }
    }

    private var font: Font {
        switch style {
        case .default: return WTheme.Typography.caption
        case .compact: return WTheme.Typography.caption2
        case .large:   return .system(size: 32, weight: .bold, design: .rounded)
        }
    }

    private var color: Color {
        switch style {
        case .large:   return WTheme.Colors.textPrimary
        default:       return WTheme.Colors.textSecondary
        }
    }
}

// MARK: - CostDelta

/// Shows a cost change with +/- indicator.
struct CostDelta: View {
    let amount: Double

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: amount >= 0 ? "arrow.up.right" : "arrow.down.right")
                .font(.caption2)
            Text("+$\(String(format: "%.4f", abs(amount)))")
                .font(WTheme.Typography.caption2)
                .fontDesign(.monospaced)
        }
        .foregroundColor(amount > 0 ? WTheme.Colors.warning : WTheme.Colors.success)
    }
}

#Preview {
    VStack(spacing: 16) {
        CostLabel(amount: 0.0023)
        CostLabel(amount: 0.123, style: .compact)
        CostLabel(amount: 45.67, style: .large)
        CostDelta(amount: 0.003)
    }
    .padding()
    .preferredColorScheme(.dark)
}
