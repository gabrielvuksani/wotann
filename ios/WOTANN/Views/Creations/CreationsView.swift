import SwiftUI

// MARK: - CreationsView
//
// V9 T5.4 (F5) — iOS browser for agent-emitted creations (files, code,
// docs, diffs). Subscribes to `creations.list` + `creations.watch`
// RPCs and renders a grid of cards.
//
// QUALITY BARS
// - #6 (honest stubs): RPC failures surface via `errorMessage` — no
//   silent swallowing.
// - #7 (per-session state): the `ViewModel` is a @StateObject,
//   created per view instance. No module-global singletons.
// - #11 (sibling-site scan): this file is the SINGLE site subscribing
//   to `creations.*` on iOS.

struct CreationsView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @StateObject private var viewModel = CreationsViewModel()
    @State private var selectedCreation: Creation?

    private let columns = [
        GridItem(.adaptive(minimum: 160), spacing: WTheme.Spacing.md),
    ]

    var body: some View {
        NavigationStack {
            ZStack {
                WTheme.Colors.background.ignoresSafeArea()

                if viewModel.isLoading && viewModel.creations.isEmpty {
                    ProgressView()
                        .tint(WTheme.Colors.primary)
                } else if viewModel.creations.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        LazyVGrid(columns: columns, spacing: WTheme.Spacing.md) {
                            ForEach(viewModel.creations) { creation in
                                CreationCard(creation: creation) {
                                    selectedCreation = creation
                                }
                                .contextMenu {
                                    ShareLink(
                                        item: creation.shareRepresentation,
                                        subject: Text(creation.title),
                                        message: Text(creation.summary)
                                    ) {
                                        Label("Share", systemImage: "square.and.arrow.up")
                                    }
                                }
                            }
                        }
                        .padding(WTheme.Spacing.md)
                    }
                    .refreshable {
                        await viewModel.refresh()
                    }
                }

                if let error = viewModel.errorMessage {
                    VStack {
                        Spacer()
                        Text(error)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.error)
                            .padding()
                            .background(WTheme.Colors.error.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                            .padding()
                    }
                }
            }
            .navigationTitle("Creations")
            .navigationBarTitleDisplayMode(.large)
            .sheet(item: $selectedCreation) { creation in
                CreationDetailView(creation: creation)
            }
            .task {
                viewModel.configure(rpcClient: connectionManager.rpcClient)
                await viewModel.load()
                viewModel.watch()
            }
            .onDisappear {
                viewModel.disconnect()
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: WTheme.Spacing.md) {
            Image(systemName: "sparkles")
                .font(.system(size: 48))
                .foregroundColor(WTheme.Colors.textTertiary)
            Text("No creations yet")
                .font(WTheme.Typography.headline)
                .foregroundColor(WTheme.Colors.textSecondary)
            Text("Files, code, and docs your agents create will appear here.")
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textTertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, WTheme.Spacing.xl)
        }
    }
}

// MARK: - Creation Card

private struct CreationCard: View {
    let creation: Creation
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                HStack {
                    Image(systemName: creation.iconName)
                        .font(.title3)
                        .foregroundColor(WTheme.Colors.primary)
                    Spacer()
                    Text(creation.kind.uppercased())
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
                Text(creation.title)
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(creation.summary)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                Text(creation.createdAt, style: .relative)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            .padding(WTheme.Spacing.md)
            .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
            // T7.3 — Creation tile glass. Replaces the manual
            // `.background + clipShape + overlay` triplet with the
            // wLiquidGlass helper so creations grid reads as native
            // Liquid Glass on iOS 26 and the existing ultra-thin
            // material + hairline ring on iOS 18.
            .wLiquidGlass(
                in: RoundedRectangle(cornerRadius: WTheme.Radius.md)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(creation.title), \(creation.kind)")
    }
}

// MARK: - Detail View

private struct CreationDetailView: View {
    let creation: Creation
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
                    Text(creation.title)
                        .font(WTheme.Typography.title2)
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Text(creation.summary)
                        .font(WTheme.Typography.body)
                        .foregroundColor(WTheme.Colors.textSecondary)
                    if !creation.body.isEmpty {
                        Text(creation.body)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundColor(WTheme.Colors.textPrimary)
                            .padding()
                            .background(WTheme.Colors.surfaceAlt)
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                    }
                }
                .padding()
            }
            .navigationTitle(creation.kind.capitalized)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(
                        item: creation.shareRepresentation,
                        subject: Text(creation.title),
                        message: Text(creation.summary)
                    ) {
                        Image(systemName: "square.and.arrow.up")
                    }
                }
            }
        }
    }
}

// MARK: - Model

struct Creation: Identifiable, Equatable {
    let id: String
    let kind: String          // "file" | "code" | "doc" | "diff"
    let title: String
    let summary: String
    let body: String
    let path: String?
    let createdAt: Date

    var iconName: String {
        switch kind {
        case "code":  return "chevron.left.forwardslash.chevron.right"
        case "doc":   return "doc.text.fill"
        case "diff":  return "plus.forwardslash.minus"
        case "file":  return "doc.fill"
        default:      return "sparkles"
        }
    }

    /// Text-safe representation used for ShareLink (see T5.6). Falls
    /// back to summary when the creation body is empty.
    var shareRepresentation: String {
        if !body.isEmpty { return body }
        return "\(title)\n\n\(summary)"
    }
}

// MARK: - ViewModel

@MainActor
final class CreationsViewModel: ObservableObject {
    @Published private(set) var creations: [Creation] = []
    @Published private(set) var isLoading: Bool = false
    @Published var errorMessage: String?

    private var rpcClient: RPCClient?
    private var isWatching = false

    func configure(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    func load() async {
        guard let rpcClient else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let response = try await rpcClient.send("creations.list")
            creations = parseList(response.result)
            errorMessage = nil
        } catch {
            errorMessage = "Could not load creations: \(error.localizedDescription)"
        }
    }

    func refresh() async {
        await load()
    }

    /// Subscribe to `creations.watch` so new creations appear live.
    func watch() {
        guard let rpcClient, !isWatching else { return }
        isWatching = true

        Task { [weak rpcClient] in
            guard let rpcClient else { return }
            _ = try? await rpcClient.send("creations.watch")
        }

        rpcClient.subscribe("creations.updated") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleUpdate(event)
            }
        }
    }

    func disconnect() {
        isWatching = false
    }

    // MARK: Parsing

    private func parseList(_ value: RPCValue?) -> [Creation] {
        let array = value?.arrayValue
            ?? value?.objectValue?["creations"]?.arrayValue
            ?? []
        return array.compactMap(parseCreation)
    }

    private func parseCreation(_ value: RPCValue) -> Creation? {
        guard let obj = value.objectValue else { return nil }
        let id = obj["id"]?.stringValue
            ?? obj["path"]?.stringValue
            ?? UUID().uuidString
        let kind = obj["kind"]?.stringValue ?? "file"
        let title = obj["title"]?.stringValue
            ?? obj["name"]?.stringValue
            ?? "Untitled"
        let summary = obj["summary"]?.stringValue ?? ""
        let body = obj["body"]?.stringValue
            ?? obj["content"]?.stringValue
            ?? ""
        let path = obj["path"]?.stringValue
        let createdAt: Date
        if let iso = obj["createdAt"]?.stringValue,
           let parsed = ISO8601DateFormatter().date(from: iso) {
            createdAt = parsed
        } else if let ms = obj["createdAt"]?.intValue {
            createdAt = Date(timeIntervalSince1970: Double(ms) / 1000.0)
        } else {
            createdAt = .now
        }
        return Creation(
            id: id,
            kind: kind,
            title: title,
            summary: summary,
            body: body,
            path: path,
            createdAt: createdAt
        )
    }

    private func handleUpdate(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }

        // Support two wire shapes: a full list replacement under
        // "creations" OR an incremental "type"/"creation" pair.
        if let array = obj["creations"]?.arrayValue {
            let parsed = array.compactMap(parseCreation)
            creations = parsed
            return
        }

        let type = obj["type"]?.stringValue ?? "updated"
        guard let creationValue = obj["creation"] ?? obj["payload"] else { return }

        switch type {
        case "created", "updated", "added":
            if let c = parseCreation(creationValue) {
                if let idx = creations.firstIndex(where: { $0.id == c.id }) {
                    creations[idx] = c
                } else {
                    creations.insert(c, at: 0)
                }
            }
        case "deleted", "removed":
            if let id = creationValue.objectValue?["id"]?.stringValue {
                creations.removeAll { $0.id == id }
            }
        default:
            break
        }
    }
}
