import SwiftUI

// MARK: - BlocksView
//
// Letta-style core-memory editor for iOS. Mirrors the Desktop
// BlockMemoryPanel.tsx and the `wotann blocks` CLI: every block is a
// fixed-size slot the agent reads on every turn via the GuidanceWhisper
// hook. Edits autosave (debounced) over the daemon's `blocks.*` RPC.

struct BlocksView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var summaries: [BlockSummary] = []
    @State private var kinds: [BlockKindInfo] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Memory Blocks")
                .navigationBarTitleDisplayMode(.large)
                .task { await refresh() }
                .refreshable { await refresh() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !connectionManager.isPaired {
            DaemonOfflineView()
        } else if let errorMessage {
            VStack(spacing: WTheme.Spacing.md) {
                ErrorBanner(message: errorMessage, type: .error, onRetry: { Task { await refresh() } })
                Spacer()
                ErrorState(message: errorMessage, onRetry: { Task { await refresh() } })
                Spacer()
            }
        } else if isLoading && summaries.isEmpty {
            ProgressView().tint(WTheme.Colors.primary)
        } else {
            ScrollView {
                VStack(spacing: WTheme.Spacing.md) {
                    headerCard
                    ForEach(kinds) { info in
                        BlockEditorCard(
                            kind: info.kind,
                            limit: info.limit,
                            summary: summaries.first(where: { $0.kind == info.kind }),
                            onSaved: { Task { await refresh() } }
                        )
                        .environmentObject(connectionManager)
                    }
                }
                .padding(WTheme.Spacing.md)
            }
        }
    }

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Always-on context")
                .font(.headline)
            Text("Each block is injected into every turn so the agent always sees your latest persona, project notes, and active task. Edits autosave.")
                .font(.callout)
                .foregroundColor(WTheme.Colors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
    }

    private func refresh() async {
        guard connectionManager.isPaired else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            async let s = connectionManager.rpcClient.listBlocks()
            async let k = connectionManager.rpcClient.listBlockKinds()
            summaries = try await s
            kinds = try await k
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - BlockEditorCard

private struct BlockEditorCard: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    let kind: String
    let limit: Int
    let summary: BlockSummary?
    let onSaved: () -> Void

    @State private var content: String = ""
    @State private var loaded = false
    @State private var saving = false
    @State private var errorMessage: String?
    @State private var saveTask: Task<Void, Never>?

    private var label: String {
        BlockSummary.labels[kind] ?? kind.capitalized
    }

    private var help: String {
        BlockSummary.helps[kind] ?? ""
    }

    private var bytes: Int {
        content.utf8.count
    }

    private var pct: Double {
        guard limit > 0 else { return 0 }
        return Double(bytes) / Double(limit)
    }

    private var pctColor: Color {
        if pct >= 0.9 { return WTheme.Colors.warning }
        if pct >= 0.6 { return WTheme.Colors.primary }
        return WTheme.Colors.success
    }

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack {
                Text(label)
                    .font(.headline)
                if summary?.truncated == true {
                    Text("truncated")
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(WTheme.Colors.warning.opacity(0.18))
                        .foregroundColor(WTheme.Colors.warning)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
                Spacer()
                Text("\(bytes) / \(limit)")
                    .font(.caption.monospacedDigit())
                    .foregroundColor(pctColor)
            }
            if !help.isEmpty {
                Text(help)
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }
            TextEditor(text: $content)
                .frame(minHeight: 100)
                .font(.body.monospaced())
                .scrollContentBackground(.hidden)
                .padding(WTheme.Spacing.sm)
                .background(WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                .onChange(of: content) { _, newValue in scheduleSave(newValue) }
            HStack {
                if saving {
                    Label("Saving…", systemImage: "arrow.triangle.2.circlepath")
                        .font(.caption2)
                        .foregroundColor(WTheme.Colors.textSecondary)
                } else if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .font(.caption2)
                        .foregroundColor(WTheme.Colors.warning)
                        .lineLimit(1)
                } else if loaded {
                    Label("Saved", systemImage: "checkmark.circle")
                        .font(.caption2)
                        .foregroundColor(WTheme.Colors.success)
                } else {
                    Text("Loading…")
                        .font(.caption2)
                        .foregroundColor(WTheme.Colors.textSecondary)
                }
                Spacer()
                Button(role: .destructive) {
                    Task { await clear() }
                } label: {
                    Label("Clear", systemImage: "trash")
                        .font(.caption2)
                }
                .disabled(!loaded || content.isEmpty)
            }
        }
        .padding(WTheme.Spacing.md)
        .background(WTheme.Colors.surface)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
        .task { await load() }
    }

    private func load() async {
        guard !loaded else { return }
        do {
            let block = try await connectionManager.rpcClient.getBlock(kind: kind)
            await MainActor.run {
                content = block?.content ?? ""
                loaded = true
            }
        } catch {
            await MainActor.run {
                errorMessage = error.localizedDescription
                loaded = true
            }
        }
    }

    private func scheduleSave(_ next: String) {
        saveTask?.cancel()
        saveTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 500_000_000)
            guard !Task.isCancelled else { return }
            await save(next)
        }
    }

    private func save(_ next: String) async {
        saving = true
        defer { saving = false }
        do {
            _ = try await connectionManager.rpcClient.setBlock(kind: kind, content: next)
            errorMessage = nil
            onSaved()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func clear() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await connectionManager.rpcClient.clearBlock(kind: kind)
            await MainActor.run { content = "" }
            onSaved()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
