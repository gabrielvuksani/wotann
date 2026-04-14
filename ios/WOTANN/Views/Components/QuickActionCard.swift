import SwiftUI

/// Quick action card for the chat empty state.
/// Displays an icon, title, and subtitle with staggered fade-in animation.
/// When tapped, invokes the `onTap` closure with a predefined prompt.
struct QuickActionCard: View {
    let icon: String
    let title: String
    let subtitle: String
    let color: Color
    let index: Int
    var onTap: (() -> Void)?

    var body: some View {
        Button {
            HapticService.shared.trigger(.buttonTap)
            onTap?()
        } label: {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                // Icon in tinted container (Vercel-style)
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(color)
                    .frame(width: 32, height: 32)
                    .background(color.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm, style: .continuous))

                Text(title)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .tracking(WTheme.Tracking.tight)
                    .foregroundColor(WTheme.Colors.textPrimary)

                Text(subtitle)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(WTheme.Spacing.md)
            .background(WTheme.Colors.surface)
            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: WTheme.Radius.md, style: .continuous)
                    .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
            )
            .shadow(
                color: WTheme.Shadow.sm.color,
                radius: WTheme.Shadow.sm.radius,
                x: WTheme.Shadow.sm.x,
                y: WTheme.Shadow.sm.y
            )
        }
        .buttonStyle(.plain)
        .wStaggered(index: index)
    }
}

// MARK: - Predefined Prompts

/// Standard quick action prompts for the chat empty state.
enum QuickActionPrompts {
    static let build = "Help me write code for a new feature. What would you like to build?"
    static let debug = "I have a bug I need help fixing. Let me describe the issue."
    static let review = "Please review my code for quality, security, and best practices."
    static let explain = "Explain how this code works and help me understand it better."
}

#Preview {
    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
        QuickActionCard(icon: "hammer.fill", title: "Build", subtitle: "Write code", color: .blue, index: 0)
        QuickActionCard(icon: "magnifyingglass", title: "Debug", subtitle: "Fix a bug", color: .red, index: 1)
    }
    .padding()
    .background(Color.black)
    .preferredColorScheme(.dark)
}
