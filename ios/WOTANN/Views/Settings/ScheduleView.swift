import SwiftUI

// MARK: - ScheduleView
//
// Surfaces the daemon's two distinct scheduling stores side-by-side:
//   - "Cron" tab     -> SQLite-backed CronStore (cron.list/add/remove/setEnabled)
//   - "Schedule" tab -> handler-based CronScheduler with at-most-once
//                       semantics (schedule.list/create/delete/fire)
//
// v9 cross-surface parity: TUI has /schedule, CLI has `wotann cron list` +
// `wotann schedule list`, macOS has its panel — iOS was missing both.
// Filed alongside MCPListView and OfflineQueueDLQView under Settings rather
// than its own Schedule/ folder because the Xcode add-source-file.py script
// places new files in the anchor's group; no Schedule group exists yet and
// adding one is out of scope for this UI surface task.
//
// Daemon RPCs (verified against src/daemon/kairos-rpc.ts:3559-3776):
//   cron.list                                   -> { jobs: [{id,name,schedule,command,enabled,...,source}] }
//   cron.add        { name, schedule, command } -> { id, name, schedule, ... }
//   cron.remove     { id }                      -> { ok, id }
//   cron.setEnabled { id, enabled }             -> { ok, id, enabled }
//   schedule.list                               -> { schedules: [{taskId,cronExpr,enabled,nextFireAt,inflight,...}] }
//   schedule.create { cronExpr, taskId? }       -> { ok, schedule }
//   schedule.delete { taskId }                  -> { ok, taskId }
//   schedule.fire   { taskId }                  -> { ok, taskId }

// MARK: - Domain models

/// Discriminator for which backend a tab targets — keeps the create-sheet
/// and the row actions branchless without an inheritance hierarchy.
enum ScheduleTab: String, CaseIterable, Identifiable {
    case cron
    case schedule

    var id: String { rawValue }
    var label: String {
        switch self {
        case .cron:     return "Cron"
        case .schedule: return "Schedule"
        }
    }
}

/// Immutable entry shape covering both backends. Optional fields cover the
/// shape gap: cron rows have `command`, schedule rows have `inflight`/`nextFireAt`.
struct ScheduleEntry: Identifiable, Hashable {
    let id: String
    let name: String
    let schedule: String
    let command: String?
    let enabled: Bool
    let nextFireAt: Date?
    let inflight: Bool
    let backend: ScheduleTab
}

// MARK: - View

struct ScheduleView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var selectedTab: ScheduleTab = .cron
    @State private var cronEntries: [ScheduleEntry] = []
    @State private var scheduleEntries: [ScheduleEntry] = []
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showCreateSheet = false
    @State private var firingId: String?

    private var entriesForActiveTab: [ScheduleEntry] {
        selectedTab == .cron ? cronEntries : scheduleEntries
    }

    var body: some View {
        VStack(spacing: 0) {
            // Tab segmented control. SwiftUI's Picker(.segmented) reads the
            // selected case from the binding so we don't need a separate
            // onChange handler — refresh runs whenever isLoading or
            // entriesForActiveTab change.
            Picker("Backend", selection: $selectedTab) {
                ForEach(ScheduleTab.allCases) { tab in
                    Text(tab.label).tag(tab)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)

            if let error = errorMessage {
                ErrorBanner(message: error)
                    .padding(.horizontal, WTheme.Spacing.md)
            }

            if isLoading && entriesForActiveTab.isEmpty {
                Spacer()
                ProgressView().tint(WTheme.Colors.primary)
                Spacer()
            } else if entriesForActiveTab.isEmpty {
                Spacer()
                EmptyState(
                    icon: selectedTab == .cron ? "clock.badge" : "calendar.badge.clock",
                    title: selectedTab == .cron ? "No cron jobs" : "No schedules",
                    subtitle: selectedTab == .cron
                        ? "Add a cron job with a name, 5-field schedule (e.g. \"0 9 * * 1\"), and a shell command."
                        : "Schedules created via the daemon's CronScheduler appear here. Tap + to register a new one."
                )
                Spacer()
            } else {
                List {
                    Section {
                        ForEach(entriesForActiveTab) { entry in
                            ScheduleRow(
                                entry: entry,
                                isFiring: firingId == entry.id,
                                onToggle: { Task { await toggle(entry) } },
                                onFire:   { Task { await fire(entry) } }
                            )
                            .swipeActions {
                                Button(role: .destructive) {
                                    Task { await delete(entry) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .listRowBackground(WTheme.Colors.surface)
                        }
                    } header: {
                        Text("\(entriesForActiveTab.count) \(selectedTab == .cron ? "cron jobs" : "schedules")")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    } footer: {
                        Text(selectedTab == .cron
                            ? "Cron jobs run shell commands on the desktop. Toggle to enable/disable, swipe to delete, tap the bolt to fire now."
                            : "Schedules with no in-process handler still appear here but won't fire — register the handler on the desktop first.")
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
        .navigationTitle("Scheduled Tasks")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showCreateSheet = true
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("Add scheduled task")
            }
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    Task { await refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(isLoading)
                .accessibilityLabel("Refresh schedules")
            }
        }
        .sheet(isPresented: $showCreateSheet) {
            ScheduleCreateSheet(
                tab: selectedTab,
                onSubmit: { name, schedule, command in
                    Task {
                        await create(name: name, schedule: schedule, command: command)
                        showCreateSheet = false
                    }
                },
                onCancel: { showCreateSheet = false }
            )
        }
        .task { await refresh() }
        .refreshable { await refresh() }
    }

    // MARK: - Loading

    @MainActor
    private func refresh() async {
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            async let cron = loadCron()
            async let schedule = loadSchedule()
            let (cronList, scheduleList) = try await (cron, schedule)
            cronEntries = cronList
            scheduleEntries = scheduleList
        } catch {
            errorMessage = "Failed to load schedules: \(error.localizedDescription)"
        }
    }

    private func loadCron() async throws -> [ScheduleEntry] {
        let response = try await connectionManager.rpcClient.send("cron.list")
        let jobs = response.result?.objectValue?["jobs"]?.arrayValue ?? []
        return jobs.compactMap { value -> ScheduleEntry? in
            guard let obj = value.objectValue,
                  let id = obj["id"]?.stringValue else { return nil }
            return ScheduleEntry(
                id: id,
                name: obj["name"]?.stringValue ?? "(unnamed)",
                schedule: obj["schedule"]?.stringValue ?? "",
                command: obj["command"]?.stringValue,
                enabled: obj["enabled"]?.boolValue ?? false,
                nextFireAt: msTimestampToDate(obj["nextFireAt"]),
                inflight: false,
                backend: .cron
            )
        }
    }

    private func loadSchedule() async throws -> [ScheduleEntry] {
        let response = try await connectionManager.rpcClient.send("schedule.list")
        let list = response.result?.objectValue?["schedules"]?.arrayValue ?? []
        return list.compactMap { value -> ScheduleEntry? in
            guard let obj = value.objectValue,
                  let taskId = obj["taskId"]?.stringValue else { return nil }
            return ScheduleEntry(
                id: taskId,
                name: taskId,
                schedule: obj["cronExpr"]?.stringValue ?? "",
                command: nil,
                enabled: obj["enabled"]?.boolValue ?? true,
                nextFireAt: msTimestampToDate(obj["nextFireAt"]),
                inflight: obj["inflight"]?.boolValue ?? false,
                backend: .schedule
            )
        }
    }

    // MARK: - Actions

    @MainActor
    private func toggle(_ entry: ScheduleEntry) async {
        // Only the cron backend exposes setEnabled — schedule.* doesn't have a
        // toggle RPC, so the row's Toggle is disabled for schedule entries.
        guard entry.backend == .cron else { return }
        do {
            _ = try await connectionManager.rpcClient.send("cron.setEnabled", params: [
                "id": .string(entry.id),
                "enabled": .bool(!entry.enabled),
            ])
            await refresh()
        } catch {
            errorMessage = "Toggle failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func delete(_ entry: ScheduleEntry) async {
        do {
            switch entry.backend {
            case .cron:
                _ = try await connectionManager.rpcClient.send("cron.remove", params: [
                    "id": .string(entry.id),
                ])
            case .schedule:
                _ = try await connectionManager.rpcClient.send("schedule.delete", params: [
                    "taskId": .string(entry.id),
                ])
            }
            await refresh()
        } catch {
            errorMessage = "Delete failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func fire(_ entry: ScheduleEntry) async {
        // Only schedule.* has fireNow — for cron jobs we fall back to a no-op
        // because the daemon doesn't expose a synchronous "run cron now" RPC.
        guard entry.backend == .schedule else { return }
        firingId = entry.id
        defer { firingId = nil }
        do {
            _ = try await connectionManager.rpcClient.send("schedule.fire", params: [
                "taskId": .string(entry.id),
            ])
            await refresh()
        } catch {
            errorMessage = "Fire failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func create(name: String, schedule: String, command: String) async {
        do {
            switch selectedTab {
            case .cron:
                _ = try await connectionManager.rpcClient.send("cron.add", params: [
                    "name": .string(name),
                    "schedule": .string(schedule),
                    "command": .string(command),
                ])
            case .schedule:
                // schedule.create takes cronExpr (and optional taskId). We
                // reuse `name` as the taskId so the user can still find the
                // entry by the label they typed.
                _ = try await connectionManager.rpcClient.send("schedule.create", params: [
                    "cronExpr": .string(schedule),
                    "taskId": .string(name),
                ])
            }
            await refresh()
        } catch {
            errorMessage = "Create failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Helpers

    /// Daemon timestamps are unix milliseconds (number) or null. Treat any
    /// non-number value as "no scheduled fire" rather than throwing.
    private func msTimestampToDate(_ value: RPCValue?) -> Date? {
        guard let value else { return nil }
        if let ms = value.intValue {
            return Date(timeIntervalSince1970: Double(ms) / 1000.0)
        }
        if let ms = value.doubleValue {
            return Date(timeIntervalSince1970: ms / 1000.0)
        }
        return nil
    }
}

// MARK: - Row

private struct ScheduleRow: View {
    let entry: ScheduleEntry
    let isFiring: Bool
    let onToggle: () -> Void
    let onFire: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: WTheme.Spacing.sm) {
            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text(entry.name)
                    .font(WTheme.Typography.body)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)

                Text(entry.schedule.isEmpty ? "(no schedule)" : entry.schedule)
                    .font(.wotannScaled(size: 12, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(1)

                if let command = entry.command, !command.isEmpty {
                    Text(command)
                        .font(.wotannScaled(size: 11, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                if let next = entry.nextFireAt {
                    Text("Next: \(next.formatted(date: .abbreviated, time: .shortened))")
                        .font(.wotannScaled(size: 11))
                        .foregroundColor(WTheme.Colors.textTertiary)
                }

                if entry.inflight {
                    HStack(spacing: WTheme.Spacing.xxs) {
                        Image(systemName: "play.circle.fill")
                            .foregroundColor(WTheme.Colors.warning)
                        Text("Inflight")
                            .font(WTheme.Typography.caption2)
                            .foregroundColor(WTheme.Colors.warning)
                    }
                }
            }

            Spacer()

            VStack(spacing: WTheme.Spacing.xs) {
                if entry.backend == .cron {
                    Toggle("", isOn: Binding(
                        get: { entry.enabled },
                        set: { _ in onToggle() }
                    ))
                    .labelsHidden()
                    .tint(WTheme.Colors.success)
                    .accessibilityLabel("Enable \(entry.name)")
                } else if entry.backend == .schedule {
                    if isFiring {
                        ProgressView().controlSize(.small)
                    } else {
                        Button(action: onFire) {
                            Image(systemName: "bolt.fill")
                                .foregroundColor(WTheme.Colors.primary)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Fire \(entry.name) now")
                    }
                }
            }
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }
}

// MARK: - Create sheet

private struct ScheduleCreateSheet: View {
    let tab: ScheduleTab
    let onSubmit: (_ name: String, _ schedule: String, _ command: String) -> Void
    let onCancel: () -> Void

    @State private var name: String = ""
    @State private var schedule: String = "0 9 * * 1"
    @State private var command: String = ""

    private var canSubmit: Bool {
        // Schedule backend doesn't take a command field, so we don't require it.
        // Cron requires all three fields.
        switch tab {
        case .cron:
            return !name.isEmpty && !schedule.isEmpty && !command.isEmpty
        case .schedule:
            return !name.isEmpty && !schedule.isEmpty
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(tab == .cron ? "Job name" : "Task ID", text: $name)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("Cron expression (5 fields)", text: $schedule)
                        .font(.wotannScaled(size: 14, design: .monospaced))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    if tab == .cron {
                        TextField("Shell command", text: $command, axis: .vertical)
                            .font(.wotannScaled(size: 14, design: .monospaced))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .lineLimit(1...3)
                    }
                } footer: {
                    Text(tab == .cron
                        ? "Cron jobs persist in SQLite on the desktop. Examples: \"0 9 * * 1\" (every Monday 9am), \"*/15 * * * *\" (every 15 min)."
                        : "Schedules use the same 5-field cron syntax. Handlers must be registered in-process on the desktop daemon to fire.")
                        .font(WTheme.Typography.caption2)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
                .listRowBackground(WTheme.Colors.surface)
            }
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("New \(tab.label)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Add") {
                        onSubmit(name, schedule, command)
                    }
                    .disabled(!canSubmit)
                }
            }
        }
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    NavigationStack {
        ScheduleView()
            .environmentObject(ConnectionManager())
    }
    .preferredColorScheme(.dark)
}
#endif
