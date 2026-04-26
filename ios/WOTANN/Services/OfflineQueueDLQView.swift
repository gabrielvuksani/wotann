import SwiftUI

// MARK: - OfflineQueueDLQView
//
// H-E15: surface the dead-letter queue from iOS Settings so users can
// inspect tasks that exhausted their retry budget. Until this view
// existed, dead-lettered tasks accumulated on disk with no UI — the
// user had no way to know failures were piling up or to recover them.
//
// Reads the same UserDefaults key (wotann_offline_queue_dlq) that
// OfflineQueueDLQ writes to. Fresh instance per view appearance so we
// pick up changes from background drains.

struct OfflineQueueDLQView: View {
    @State private var dlq = OfflineQueueDLQ()

    var body: some View {
        Group {
            if dlq.entries.isEmpty {
                EmptyState(
                    icon: "tray.fill",
                    title: "No dead-lettered tasks",
                    subtitle: "Tasks that exhaust their retry budget appear here. The live queue retries 3 times with 1s/5s/30s backoff before moving a task to this list."
                )
            } else {
                List {
                    Section {
                        ForEach(dlq.entries) { entry in
                            DLQRow(entry: entry, onRemove: {
                                dlq.clear(id: entry.id)
                            })
                        }
                    } header: {
                        Text("\(dlq.entries.count) dead-lettered")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    } footer: {
                        Text("Tap a row to expand the original task. Swipe to delete or use the Clear All button.")
                            .font(WTheme.Typography.caption2)
                            .foregroundColor(WTheme.Colors.textTertiary)
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(WTheme.Colors.background)
            }
        }
        .background(WTheme.Colors.background)
        .navigationTitle("Dead Letter Queue")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !dlq.entries.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear All", role: .destructive) {
                        dlq.clearAll()
                    }
                    .foregroundColor(WTheme.Colors.error)
                }
            }
        }
    }
}

// MARK: - Row

private struct DLQRow: View {
    let entry: OfflineQueueDLQ.DLQEntry
    let onRemove: () -> Void
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack {
                Text(entry.task.prompt.prefix(80))
                    .font(WTheme.Typography.body)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(expanded ? nil : 1)
                Spacer()
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .font(.caption)
            }
            Text(entry.reason)
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.error)
                .lineLimit(2)
            Text(entry.movedAt.formatted(date: .abbreviated, time: .shortened))
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .contentShape(Rectangle())
        .onTapGesture { withAnimation { expanded.toggle() } }
        .swipeActions {
            Button(role: .destructive, action: onRemove) {
                Label("Remove", systemImage: "trash")
            }
        }
    }
}
