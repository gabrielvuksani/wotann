import SwiftUI

// MARK: - BudgetView

/// Budget tracking with progress indicator and alert thresholds.
struct BudgetView: View {
    let spent: Double
    let budget: Double
    @State private var showEditor = false
    @State private var editBudget = ""

    var remaining: Double {
        max(0, budget - spent)
    }

    var percentage: Double {
        guard budget > 0 else { return 0 }
        return min(1.0, spent / budget)
    }

    var isOverBudget: Bool {
        spent >= budget
    }

    var isNearBudget: Bool {
        percentage >= 0.8
    }

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
            HStack {
                Text("Weekly Budget")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)

                Spacer()

                Button {
                    editBudget = String(format: "%.0f", budget)
                    showEditor = true
                } label: {
                    Text("$\(String(format: "%.0f", budget))")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)
                    Image(systemName: "pencil")
                        .font(.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }

            // Progress bar
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 4)
                        .fill(WTheme.Colors.surface)
                        .frame(height: 8)

                    RoundedRectangle(cornerRadius: 4)
                        .fill(progressColor)
                        .frame(width: max(0, geometry.size.width * percentage), height: 8)
                        .animation(WTheme.Animation.smooth, value: percentage)
                }
            }
            .frame(height: 8)

            // Labels
            HStack {
                Text("$\(String(format: "%.2f", spent)) spent")
                    .font(WTheme.Typography.caption)
                    .foregroundColor(progressColor)

                Spacer()

                if isOverBudget {
                    Text("Over budget!")
                        .font(WTheme.Typography.caption)
                        .fontWeight(.bold)
                        .foregroundColor(WTheme.Colors.error)
                } else {
                    Text("$\(String(format: "%.2f", remaining)) remaining")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
            }
        }
        .wCard()
        .overlay(
            Group {
                if isOverBudget {
                    RoundedRectangle(cornerRadius: WTheme.Radius.lg)
                        .strokeBorder(WTheme.Colors.error.opacity(0.3), lineWidth: 1)
                }
            }
        )
        .alert("Set Weekly Budget", isPresented: $showEditor) {
            TextField("Amount", text: $editBudget)
                .keyboardType(.decimalPad)
            Button("Save") {
                if let amount = Double(editBudget) {
                    UserDefaults.standard.set(amount, forKey: "weeklyBudget")
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var progressColor: Color {
        if isOverBudget {
            return WTheme.Colors.error
        } else if isNearBudget {
            return WTheme.Colors.warning
        } else {
            return WTheme.Colors.primary
        }
    }
}

#Preview {
    VStack(spacing: 16) {
        BudgetView(spent: 12.34, budget: 50.0)
        BudgetView(spent: 42.50, budget: 50.0)
        BudgetView(spent: 55.00, budget: 50.0)
    }
    .padding()
    .background(WTheme.Colors.background)
    .preferredColorScheme(.dark)
}
