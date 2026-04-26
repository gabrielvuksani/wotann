import SwiftUI
import Observation

// MARK: - ApprovalDetailView
//
// V9 R-08 — Drill-in view for a single pending approval. Reachable from
// `ApprovalQueueView`. Shows the full payload (tool, args, risk, why,
// expiry timer) and lets the user Approve / Deny without auto-deny
// pressure (unlike `ApprovalSheetView`).
//
// If the approval is decided/dismissed by another surface (or by this
// device through the queue list) while the detail is open, the detail
// auto-pops back to the queue — driven by the parent service's cache.
//
// QUALITY BARS
// - #6 (honest stubs): error states surface inline.
// - #7 (per-session state): receives the parent's `service` (not a
//   separate instance), so Approve/Deny here mutates the same cache the
//   queue list shows.
// - #11 (sibling-site scan): the only iOS surfaces touching `approvals.*`
//   are this view, `ApprovalQueueView`, `ApprovalSheetView`, and
//   `ApprovalQueueService`.

struct ApprovalDetailView: View {
    let approvalId: String
    let service: ApprovalQueueService

    @Environment(\.dismiss) private var dismiss
    @State private var isActing: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                if let item = service.find(approvalId) {
                    header(for: item)
                    payloadSection(for: item)
                    metadataSection(for: item)
                } else {
                    decidedPlaceholder
                }
            }
            .padding()
        }
        .background(WTheme.Colors.background)
        .navigationTitle("Approval")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) {
            if let item = service.find(approvalId) {
                actionBar(for: item)
            }
        }
        // Auto-pop when the cache no longer contains this approval — it
        // means another surface already decided it (or it expired).
        .onChange(of: service.find(approvalId)?.approvalId) { _, newValue in
            if newValue == nil {
                dismiss()
            }
        }
    }

    // MARK: - Header

    private func header(for item: ApprovalQueueItem) -> some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack(spacing: WTheme.Spacing.sm) {
                RiskBadge(level: item.riskLevel)
                Spacer()
                Text(item.expiresAt, style: .relative)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .accessibilityLabel("Expires \(item.expiresAt.formatted(.relative(presentation: .named)))")
            }

            Text(item.summary)
                .font(WTheme.Typography.title2)
                .foregroundColor(WTheme.Colors.textPrimary)
                .fixedSize(horizontal: false, vertical: true)

            Text(item.toolLabel)
                .font(.system(.footnote, design: .monospaced))
                .foregroundColor(WTheme.Colors.textTertiary)
                .textSelection(.enabled)
        }
    }

    // MARK: - Payload

    private func payloadSection(for item: ApprovalQueueItem) -> some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Details")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textSecondary)

            Text(item.detailText)
                .font(.system(.callout, design: .monospaced))
                .foregroundColor(WTheme.Colors.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
                .background(WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                .textSelection(.enabled)
        }
    }

    // MARK: - Metadata

    private func metadataSection(for item: ApprovalQueueItem) -> some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            Text("Context")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textSecondary)

            metadataRow(label: "Session", value: item.sessionId)
            metadataRow(label: "Approval ID", value: item.approvalId)
            metadataRow(
                label: "Created",
                value: item.createdAt.formatted(date: .abbreviated, time: .standard)
            )
            metadataRow(
                label: "Expires",
                value: item.expiresAt.formatted(date: .abbreviated, time: .standard)
            )
        }
        .padding()
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
    }

    private func metadataRow(label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textTertiary)
                .frame(width: 100, alignment: .leading)
            Text(value)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
            Spacer()
        }
    }

    // MARK: - Action bar (sticky bottom)

    private func actionBar(for item: ApprovalQueueItem) -> some View {
        HStack(spacing: WTheme.Spacing.md) {
            Button {
                Task {
                    isActing = true
                    await service.deny(item.approvalId)
                    isActing = false
                }
            } label: {
                Text("Deny")
                    .font(WTheme.Typography.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .tint(WTheme.Colors.error)
            .disabled(isActing)

            Button {
                Task {
                    isActing = true
                    await service.approve(item.approvalId)
                    isActing = false
                }
            } label: {
                Text("Approve")
                    .font(WTheme.Typography.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(WTheme.Colors.primary)
            .disabled(isActing)
        }
        .padding()
        .background(.ultraThinMaterial)
    }

    // MARK: - Already-decided placeholder

    private var decidedPlaceholder: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Image(systemName: "checkmark.shield.fill")
                .font(.system(size: 48))
                .foregroundColor(WTheme.Colors.success)
            Text("Already decided")
                .font(WTheme.Typography.title3)
                .foregroundColor(WTheme.Colors.textPrimary)
            Text("This approval was resolved on another surface, or it expired.")
                .font(WTheme.Typography.body)
                .foregroundColor(WTheme.Colors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, WTheme.Spacing.xl)

            Button("Back to queue") {
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .tint(WTheme.Colors.primary)
            .padding(.top, WTheme.Spacing.sm)
        }
        .frame(maxWidth: .infinity, minHeight: 300)
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    NavigationStack {
        ApprovalDetailView(
            approvalId: "ap-preview",
            service: ApprovalQueueService()
        )
    }
    .preferredColorScheme(.dark)
}
#endif
