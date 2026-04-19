import SwiftUI

// MARK: - FileSearchView

/// Search and browse files on the desktop from the phone.
struct FileSearchView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var query = ""
    @State private var results: [[String: RPCValue]] = []
    @State private var isSearching = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(WTheme.Colors.textTertiary)
                    TextField("Search files...", text: $query)
                        .textFieldStyle(.plain)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit { searchFiles() }
                }
                .padding(WTheme.Spacing.md)
                .background(WTheme.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                .padding(.horizontal, WTheme.Spacing.lg)
                .padding(.top, WTheme.Spacing.md)

                if isSearching {
                    Spacer()
                    ProgressView().tint(WTheme.Colors.primary)
                    Spacer()
                } else if results.isEmpty && !query.isEmpty {
                    Spacer()
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "doc.text.magnifyingglass")
                            .font(.wotannScaled(size: 40))
                            .foregroundColor(WTheme.Colors.textTertiary)
                        Text("No files found")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                    Spacer()
                } else if results.isEmpty {
                    Spacer()
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "folder")
                            .font(.wotannScaled(size: 40))
                            .foregroundColor(WTheme.Colors.textTertiary)
                        Text("Search your project files")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                        Text("Search by filename, content, or symbols across your codebase.")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textTertiary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, WTheme.Spacing.xl)
                    }
                    Spacer()
                } else {
                    List(Array(results.enumerated()), id: \.offset) { _, file in
                        FileResultRow(file: file)
                    }
                    .listStyle(.plain)
                }
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Files")
            .navigationBarTitleDisplayMode(.large)
        }
    }

    private func searchFiles() {
        guard !query.isEmpty else { return }
        isSearching = true
        Task {
            do {
                let response = try await connectionManager.rpcClient.send("files.search", params: [
                    "query": .string(query),
                ])
                results = (response.result?.objectValue?["files"]?.arrayValue ?? [])
                    .compactMap { $0.objectValue }
            } catch {
                results = []
            }
            isSearching = false
        }
    }
}

// MARK: - FileResultRow

private struct FileResultRow: View {
    let file: [String: RPCValue]

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack(spacing: WTheme.Spacing.sm) {
                Image(systemName: fileIcon)
                    .font(.wotannScaled(size: 14))
                    .foregroundColor(WTheme.Colors.primary)

                Text(file["name"]?.stringValue ?? file["path"]?.stringValue ?? "Unknown")
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1)
            }

            if let path = file["path"]?.stringValue {
                Text(path)
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textTertiary)
                    .lineLimit(1)
            }

            if let snippet = file["snippet"]?.stringValue, !snippet.isEmpty {
                Text(snippet)
                    .font(WTheme.Typography.codeSmall)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(3)
                    .padding(WTheme.Spacing.sm)
                    .background(WTheme.Colors.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }
        }
        .padding(.vertical, WTheme.Spacing.xs)
    }

    private var fileIcon: String {
        let name = file["name"]?.stringValue ?? ""
        if name.hasSuffix(".swift") || name.hasSuffix(".ts") || name.hasSuffix(".tsx") { return "doc.text" }
        if name.hasSuffix(".json") || name.hasSuffix(".yaml") { return "doc.badge.gearshape" }
        if name.hasSuffix(".md") { return "doc.richtext" }
        return "doc"
    }
}

#Preview {
    FileSearchView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
