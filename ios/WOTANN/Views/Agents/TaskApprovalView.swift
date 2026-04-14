import SwiftUI

// MARK: - TaskApprovalView

/// Approve/reject card for agent action requests.
struct TaskApprovalView: View {
    let title: String
    let description: String
    let onApprove: () -> Void
    let onReject: () -> Void
    @State private var appeared = false

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
            // Header
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: "exclamationmark.shield.fill")
                    .font(.title3)
                    .foregroundColor(WTheme.Colors.warning)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(WTheme.Typography.headline)
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Text(description)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
            }

            // Action buttons
            HStack(spacing: WTheme.Spacing.sm) {
                Button {
                    HapticService.shared.trigger(.taskComplete)
                    onApprove()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                        Text("Approve")
                    }
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.success)
                    .foregroundColor(.white)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                }

                Button {
                    HapticService.shared.trigger(.selection)
                    onReject()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "xmark.circle.fill")
                        Text("Reject")
                    }
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.surface)
                    .foregroundColor(WTheme.Colors.error)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                    .overlay(
                        RoundedRectangle(cornerRadius: WTheme.Radius.sm)
                            .strokeBorder(WTheme.Colors.error.opacity(0.3), lineWidth: 1)
                    )
                }
            }
        }
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.warning.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.md)
                .strokeBorder(WTheme.Colors.warning.opacity(0.3), lineWidth: 1)
        )
        .scaleEffect(appeared ? 1.0 : 0.95)
        .opacity(appeared ? 1.0 : 0)
        .onAppear {
            withAnimation(WTheme.Animation.bouncy) {
                appeared = true
            }
        }
    }
}

#Preview {
    TaskApprovalView(
        title: "Permission Required",
        description: "The agent wants to modify 3 files in src/core/",
        onApprove: {},
        onReject: {}
    )
    .padding()
    .background(WTheme.Colors.background)
    .preferredColorScheme(.dark)
}
