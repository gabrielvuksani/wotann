import SwiftUI
import Observation

// MARK: - ApprovalQueueView
//
// V9 R-08 — iOS approval queue surface. Lets the user see every pending
// dangerous-op approval the desktop has queued up and act on it from the
// phone. Pairs with `ApprovalSheetView`: the sheet is the in-flight modal
// (auto-deny in 30 s); this view is the durable list (pull to refresh,
// drill-in detail, decide on your own clock).
//
// Navigation:
//   - Reachable from the You tab (R-03 navigation lift).
//   - Push-notification deep link (`approvals.notify` → APNs → tap on
//     phone) sets `appState.deepLinkDestination = "approvals"`, which
//     MainShell observes and pushes this view onto the active tab's
//     navigation stack. (If MainShell route registration is owned by
//     C2's iOS-navigation-lift agent and conflicts at merge time, this
//     view is still wired via its NavigationStack so it can be presented
//     directly from a sheet/programmatic NavigationLink.)
//
// QUALITY BARS
// - #6 (honest stubs): error states surface inline as a banner.
// - #7 (per-session state): `service` is owned by `@State`, scoped to
//   this view instance.
// - #11 (sibling-site scan): the only iOS surfaces touching `approvals.*`
//   are this view, `ApprovalDetailView`, `ApprovalSheetView`, and
//   `ApprovalQueueService`. All four coexist intentionally — see the
//   service header comment.

struct ApprovalQueueView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var service = ApprovalQueueService()
    @State private var selection: ApprovalQueueItem?

    var body: some View {
        NavigationStack {
            content
                .background(WTheme.Colors.background)
                .navigationTitle("Approvals")
                .navigationBarTitleDisplayMode(.large)
                .toolbar {
                    ToolbarItem(placement: .primaryAction) {
                        if service.isRefreshing {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Button {
                                Task { await service.refresh() }
                            } label: {
                                Image(systemName: "arrow.clockwise")
                                    .foregroundColor(WTheme.Colors.primary)
                            }
                            .accessibilityLabel("Refresh approvals")
                        }
                    }
                }
                .navigationDestination(item: $selection) { item in
                    ApprovalDetailView(
                        approvalId: item.approvalId,
                        service: service
                    )
                }
                .task {
                    let deviceId = connectionManager.pairedDevice?.id
                        ?? UUID().uuidString
                    service.configure(
                        rpcClient: connectionManager.rpcClient,
                        deviceId: deviceId
                    )
                    service.subscribe()
                    await service.refresh()
                }
                .refreshable {
                    await service.refresh()
                }
        }
    }

    // MARK: - Content (extracted for type-checker)

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            if let errorMessage = service.errorMessage {
                ErrorBanner(message: errorMessage)
            }

            if service.approvals.isEmpty {
                EmptyState(
                    icon: "checkmark.shield.fill",
                    title: "No approvals waiting",
                    subtitle: "When your desktop agent needs sign-off for a dangerous operation, it will show up here."
                )
            } else {
                approvalList
            }
        }
        .frame(maxHeight: .infinity)
    }

    // MARK: - List

    private var approvalList: some View {
        List(service.approvals) { item in
            Button {
                selection = item
            } label: {
                ApprovalRow(
                    item: item,
                    onApprove: { Task { await service.approve(item.approvalId) } },
                    onDeny:    { Task { await service.deny(item.approvalId) } }
                )
            }
            .buttonStyle(.plain)
            .listRowBackground(WTheme.Colors.background)
            .listRowSeparator(.visible)
            .listRowSeparatorTint(WTheme.Colors.border)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }
}

// MARK: - ApprovalRow

private struct ApprovalRow: View {
    let item: ApprovalQueueItem
    let onApprove: () -> Void
    let onDeny: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack(alignment: .firstTextBaseline) {
                RiskBadge(level: item.riskLevel)
                Text(item.summary)
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(2)
                Spacer()
            }

            Text(item.toolLabel)
                .font(.system(.footnote, design: .monospaced))
                .foregroundColor(WTheme.Colors.textTertiary)
                .lineLimit(1)
                .truncationMode(.middle)

            HStack(spacing: WTheme.Spacing.sm) {
                Button(action: onDeny) {
                    Text("Deny")
                        .font(WTheme.Typography.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.bordered)
                .tint(WTheme.Colors.error)

                Button(action: onApprove) {
                    Text("Approve")
                        .font(WTheme.Typography.subheadline)
                        .frame(maxWidth: .infinity, minHeight: 36)
                }
                .buttonStyle(.borderedProminent)
                .tint(WTheme.Colors.primary)
            }
        }
        .padding(.vertical, WTheme.Spacing.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.riskLevel.rawValue) risk approval: \(item.summary)")
        .accessibilityHint("Double tap to view details")
    }
}

// MARK: - RiskBadge

struct RiskBadge: View {
    let level: ApprovalRiskLevel

    var body: some View {
        Text(label)
            .font(.system(size: 10, weight: .bold, design: .rounded))
            .foregroundColor(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color)
            .clipShape(Capsule())
            .accessibilityLabel("Risk level: \(label)")
    }

    private var color: Color {
        switch level {
        case .high:   return WTheme.Colors.error
        case .medium: return WTheme.Colors.warning
        case .low:    return WTheme.Colors.success
        }
    }

    private var label: String {
        switch level {
        case .high:   return "HIGH"
        case .medium: return "MED"
        case .low:    return "LOW"
        }
    }
}

// MARK: - ErrorBanner

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(WTheme.Colors.error)
            Text(message)
                .font(WTheme.Typography.footnote)
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(2)
            Spacer()
        }
        .padding(.horizontal, WTheme.Spacing.md)
        .padding(.vertical, WTheme.Spacing.sm)
        .background(WTheme.Colors.error.opacity(0.12))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Empty queue") {
    ApprovalQueueView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
#endif
