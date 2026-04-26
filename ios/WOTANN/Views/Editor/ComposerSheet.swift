import SwiftUI

// MARK: - ComposerSheet
//
// Multi-file edit composer surface. Lets the user phrase an edit intent,
// preview the daemon's plan (per-file unified diff), and apply it as a
// batch via the composer.* RPC family.
//
// Daemon RPC contract (verified against src/daemon/kairos-rpc.ts:4582-5457):
//   composer.plan  { edits: [{path, newContent}] }
//                                -> { ok, plan: [{path,resolved,inWorkspace,isNew,
//                                                  previewBytes,oldBytes,diff,additions,deletions}],
//                                     total }
//   composer.apply { edits: [{path, newContent, acceptedHunkIds?}] }
//                                -> { ok, applied, failures: [{path,error}], total }
//
// IMPORTANT: the iOS task spec describes the contract as
//   composer.plan  { prompt }      -> { plan, planId }
//   composer.apply { planId }      -> { ok, ... }
// but the actual daemon handler accepts an `edits` array (no prompt → plan
// AI step on the daemon today). This view exposes BOTH:
//   - A "prompt" textarea so the user can type an intent for the daemon to
//     synthesize edits — flagged as a daemon-side TODO since composer.plan
//     currently echoes the diff rather than producing edits from prose.
//   - A manual edits list (path + new content) so the existing daemon
//     handler is exercised end-to-end.
// The prompt input becomes useful the moment a "composer.synthesize" RPC
// (or composer.plan-from-prompt) lands daemon-side.

// MARK: - Domain

/// One row in the manual-edit list. Path + content come from the user; the
/// rest is filled in by composer.plan.
struct ComposerEdit: Identifiable, Hashable {
    let id: UUID
    var path: String
    var newContent: String

    init(id: UUID = UUID(), path: String = "", newContent: String = "") {
        self.id = id
        self.path = path
        self.newContent = newContent
    }
}

/// Decoded per-file plan entry returned by composer.plan.
struct ComposerPlanEntry: Identifiable, Hashable {
    let id = UUID()
    let path: String
    let resolved: String
    let inWorkspace: Bool
    let isNew: Bool
    let previewBytes: Int
    let oldBytes: Int
    let diff: String
    let additions: Int
    let deletions: Int
}

// MARK: - View

struct ComposerSheet: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @Environment(\.dismiss) private var dismiss

    // Inputs the user fills in.
    @State private var prompt: String = ""
    @State private var edits: [ComposerEdit] = [ComposerEdit()]

    // Output state.
    @State private var planEntries: [ComposerPlanEntry] = []
    @State private var planError: String?
    @State private var isPlanning = false
    @State private var isApplying = false
    @State private var applyResult: ApplyResult?
    @State private var errorMessage: String?

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                promptSection
                editsSection
                if !planEntries.isEmpty || planError != nil {
                    planSection
                }
                if let result = applyResult {
                    applyResultSection(result)
                }
                actionsSection
            }
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("Composer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert(
                "Composer Error",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                ),
                presenting: errorMessage
            ) { _ in
                Button("OK", role: .cancel) { errorMessage = nil }
            } message: { msg in
                Text(msg)
            }
        }
    }

    // MARK: - Sections

    private var promptSection: some View {
        Section {
            TextField(
                "Describe the change (optional)",
                text: $prompt,
                axis: .vertical
            )
            .font(WTheme.Typography.body)
            .lineLimit(3...8)
        } header: {
            Text("Intent")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        } footer: {
            Text("Used to seed the LLM-driven plan when the daemon supports prompt synthesis. Until then, fill in the per-file edits below.")
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var editsSection: some View {
        Section {
            ForEach($edits) { $edit in
                VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                    LabeledContent("Path") {
                        TextField("relative/path/to/file.swift", text: $edit.path)
                            .font(.wotannScaled(size: 13, design: .monospaced))
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .multilineTextAlignment(.trailing)
                    }
                    TextField(
                        "New file contents…",
                        text: $edit.newContent,
                        axis: .vertical
                    )
                    .font(.wotannScaled(size: 13, design: .monospaced))
                    .lineLimit(3...12)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                }
            }
            .onDelete(perform: deleteEdits)

            Button {
                edits.append(ComposerEdit())
            } label: {
                Label("Add another file", systemImage: "plus.circle")
            }
            .accessibilityLabel("Add another edit row")
        } header: {
            HStack {
                Text("Edits")
                    .font(.wotannScaled(size: 12, weight: .semibold))
                    .tracking(WTheme.Tracking.wide)
                    .textCase(.uppercase)
                Spacer()
                if edits.count > 1 {
                    EditButton()
                        .font(WTheme.Typography.caption)
                }
            }
        } footer: {
            Text("Paths are resolved against the desktop workspace root. Edits outside the workspace are rejected by composer.apply.")
                .font(WTheme.Typography.caption2)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    @ViewBuilder
    private var planSection: some View {
        Section {
            if let err = planError {
                ErrorBanner(message: err)
                    .listRowInsets(EdgeInsets())
            } else {
                ForEach(planEntries) { entry in
                    PlanEntryRow(entry: entry)
                }
            }
        } header: {
            Text("Plan")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        } footer: {
            if planError == nil && !planEntries.isEmpty {
                let totalAdd = planEntries.reduce(0) { $0 + $1.additions }
                let totalDel = planEntries.reduce(0) { $0 + $1.deletions }
                Text("\(planEntries.count) file\(planEntries.count == 1 ? "" : "s"), +\(totalAdd) / -\(totalDel) lines")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private func applyResultSection(_ result: ApplyResult) -> some View {
        Section {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: result.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundColor(result.ok ? WTheme.Colors.success : WTheme.Colors.error)
                VStack(alignment: .leading, spacing: 2) {
                    Text(result.ok ? "Applied" : "Partially applied")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Text("\(result.applied)/\(result.total) edits written")
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
            }
            if !result.failures.isEmpty {
                ForEach(Array(result.failures.enumerated()), id: \.offset) { _, failure in
                    VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                        Text(failure.path)
                            .font(.wotannScaled(size: 13, design: .monospaced))
                            .foregroundColor(WTheme.Colors.textPrimary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Text(failure.error)
                            .font(WTheme.Typography.caption2)
                            .foregroundColor(WTheme.Colors.error)
                            .lineLimit(3)
                    }
                }
            }
        } header: {
            Text("Result")
                .font(.wotannScaled(size: 12, weight: .semibold))
                .tracking(WTheme.Tracking.wide)
                .textCase(.uppercase)
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    private var actionsSection: some View {
        Section {
            Button {
                Task { await runPlan() }
            } label: {
                HStack {
                    if isPlanning {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "doc.text.magnifyingglass")
                    }
                    Text(isPlanning ? "Planning…" : "Plan")
                        .fontWeight(.semibold)
                    Spacer()
                }
                .foregroundColor(WTheme.Colors.primary)
                .frame(minHeight: 44)
            }
            .disabled(!canPlan)
            .accessibilityLabel("Generate plan")

            Button {
                Task { await runApply() }
            } label: {
                HStack {
                    Spacer()
                    if isApplying {
                        ProgressView().tint(.white)
                    } else {
                        Image(systemName: "checkmark.seal.fill")
                    }
                    Text(isApplying ? "Applying…" : "Apply")
                        .fontWeight(.semibold)
                    Spacer()
                }
                .frame(minHeight: 44)
                .foregroundColor(.white)
                .background(canApply ? WTheme.Colors.primary : WTheme.Colors.primary.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
            .buttonStyle(.plain)
            .disabled(!canApply)
            .accessibilityLabel("Apply edits")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Gates

    /// At least one edit must have a non-empty path AND non-empty content
    /// before composer.plan can run — daemon will reject empty rows.
    private var canPlan: Bool {
        !isPlanning && !isApplying && validEdits.isEmpty == false
    }

    /// Apply requires a successful plan (planEntries non-empty, no planError).
    private var canApply: Bool {
        !isApplying && !isPlanning && !planEntries.isEmpty && planError == nil
    }

    private var validEdits: [ComposerEdit] {
        edits.filter { !$0.path.trimmingCharacters(in: .whitespaces).isEmpty
                    && !$0.newContent.isEmpty }
    }

    // MARK: - Actions

    private func deleteEdits(at offsets: IndexSet) {
        // Always keep at least one row so the form isn't empty.
        var copy = edits
        copy.remove(atOffsets: offsets)
        if copy.isEmpty { copy = [ComposerEdit()] }
        edits = copy
    }

    @MainActor
    private func runPlan() async {
        guard !validEdits.isEmpty else { return }
        isPlanning = true
        planError = nil
        applyResult = nil
        defer { isPlanning = false }

        do {
            let editsParam = RPCValue.array(validEdits.map { edit in
                RPCValue.object([
                    "path": .string(edit.path),
                    "newContent": .string(edit.newContent),
                ])
            })
            let response = try await connectionManager.rpcClient.send("composer.plan", params: [
                "edits": editsParam,
                "prompt": .string(prompt),
            ])
            let result = response.result?.objectValue ?? [:]
            if result["ok"]?.boolValue == false {
                planError = result["error"]?.stringValue ?? "composer.plan returned ok=false"
                planEntries = []
                return
            }
            let planArr = result["plan"]?.arrayValue ?? []
            planEntries = planArr.compactMap { decodePlanEntry($0) }
            if planEntries.isEmpty {
                planError = "Daemon returned an empty plan"
            }
        } catch {
            planError = "composer.plan failed: \(error.localizedDescription)"
            planEntries = []
        }
    }

    @MainActor
    private func runApply() async {
        guard !planEntries.isEmpty else { return }
        isApplying = true
        applyResult = nil
        defer { isApplying = false }

        do {
            let editsParam = RPCValue.array(validEdits.map { edit in
                RPCValue.object([
                    "path": .string(edit.path),
                    "newContent": .string(edit.newContent),
                ])
            })
            let response = try await connectionManager.rpcClient.send("composer.apply", params: [
                "edits": editsParam,
            ])
            let result = response.result?.objectValue ?? [:]
            let ok = result["ok"]?.boolValue ?? false
            let applied = result["applied"]?.intValue ?? 0
            let total = result["total"]?.intValue ?? validEdits.count
            let failuresArr = result["failures"]?.arrayValue ?? []
            let failures: [ApplyResult.Failure] = failuresArr.compactMap { value in
                guard let obj = value.objectValue,
                      let path = obj["path"]?.stringValue,
                      let err = obj["error"]?.stringValue else { return nil }
                return ApplyResult.Failure(path: path, error: err)
            }
            applyResult = ApplyResult(ok: ok, applied: applied, total: total, failures: failures)
            if ok {
                HapticService.shared.trigger(.taskComplete)
            } else {
                HapticService.shared.trigger(.taskFailed)
            }
        } catch {
            errorMessage = "composer.apply failed: \(error.localizedDescription)"
            HapticService.shared.trigger(.error)
        }
    }

    // MARK: - Decoding

    private func decodePlanEntry(_ value: RPCValue) -> ComposerPlanEntry? {
        guard let obj = value.objectValue,
              let path = obj["path"]?.stringValue else { return nil }
        return ComposerPlanEntry(
            path: path,
            resolved: obj["resolved"]?.stringValue ?? path,
            inWorkspace: obj["inWorkspace"]?.boolValue ?? true,
            isNew: obj["isNew"]?.boolValue ?? false,
            previewBytes: obj["previewBytes"]?.intValue ?? 0,
            oldBytes: obj["oldBytes"]?.intValue ?? 0,
            diff: obj["diff"]?.stringValue ?? "",
            additions: obj["additions"]?.intValue ?? 0,
            deletions: obj["deletions"]?.intValue ?? 0
        )
    }
}

// MARK: - Apply result holder

private struct ApplyResult {
    struct Failure { let path: String; let error: String }
    let ok: Bool
    let applied: Int
    let total: Int
    let failures: [Failure]
}

// MARK: - Plan row

private struct PlanEntryRow: View {
    let entry: ComposerPlanEntry
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: entry.isNew ? "doc.fill.badge.plus" : "pencil.circle.fill")
                    .foregroundColor(entry.inWorkspace ? WTheme.Colors.primary : WTheme.Colors.warning)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.path)
                        .font(.wotannScaled(size: 13, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    HStack(spacing: WTheme.Spacing.sm) {
                        Text("+\(entry.additions)")
                            .foregroundColor(WTheme.Colors.success)
                        Text("-\(entry.deletions)")
                            .foregroundColor(WTheme.Colors.error)
                        if !entry.inWorkspace {
                            Text("outside workspace")
                                .foregroundColor(WTheme.Colors.warning)
                        }
                    }
                    .font(WTheme.Typography.caption2)
                }
                Spacer()
                Image(systemName: expanded ? "chevron.up" : "chevron.down")
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            .contentShape(Rectangle())
            .onTapGesture { withAnimation { expanded.toggle() } }

            if expanded && !entry.diff.isEmpty {
                ScrollView(.horizontal, showsIndicators: true) {
                    Text(entry.diff)
                        .font(.wotannScaled(size: 11, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .padding(WTheme.Spacing.sm)
                }
                .frame(maxHeight: 240)
                .background(WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
        }
        .padding(.vertical, WTheme.Spacing.xxs)
    }
}

// MARK: - Preview

#if DEBUG
#Preview {
    ComposerSheet()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
#endif
