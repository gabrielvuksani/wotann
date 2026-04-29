import SwiftUI

// MARK: - MemoryBrowserView

/// Browse, search, and manage WOTANN's persistent memory entries.
struct MemoryBrowserView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var searchQuery = ""
    @State private var memories: [MemoryResult] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Search bar
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "magnifyingglass")
                        .foregroundColor(WTheme.Colors.textTertiary)
                    TextField("Search memories...", text: $searchQuery)
                        .textFieldStyle(.plain)
                        .onSubmit { searchMemories() }
                }
                .padding(WTheme.Spacing.md)
                .background(WTheme.Colors.surface)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                .padding(.horizontal, WTheme.Spacing.lg)
                .padding(.top, WTheme.Spacing.md)

                if let errorMessage {
                    ErrorBanner(
                        message: errorMessage,
                        type: .error,
                        onRetry: { searchMemories() }
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                if isLoading {
                    Spacer()
                    ProgressView()
                        .tint(WTheme.Colors.primary)
                    Spacer()
                } else if let errorMessage {
                    Spacer()
                    ErrorState(
                        message: errorMessage,
                        onRetry: { searchMemories() }
                    )
                    Spacer()
                } else if memories.isEmpty {
                    Spacer()
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "brain.head.profile")
                            .font(.wotannScaled(size: 40))
                            .foregroundColor(WTheme.Colors.textTertiary)
                        Text("Memory builds over time")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                        Text("As you work with WOTANN, it remembers patterns, decisions, and conventions.")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textTertiary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, WTheme.Spacing.xl)
                    }
                    Spacer()
                } else {
                    List(memories) { memory in
                        MemoryRow(memory: memory)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Memory")
            .navigationBarTitleDisplayMode(.large)
            .onAppear { searchMemories() }
        }
    }

    private func searchMemories() {
        guard connectionManager.isPaired else { return }
        isLoading = true
        errorMessage = nil
        Task {
            do {
                let results = try await connectionManager.rpcClient.searchMemory(searchQuery.isEmpty ? "*" : searchQuery)
                await MainActor.run {
                    memories = results
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }
}

// MARK: - MemoryRow

struct MemoryRow: View {
    let memory: MemoryResult

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack {
                Text(memory.type)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.primary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(WTheme.Colors.primary.opacity(0.1))
                    .clipShape(Capsule())
                Spacer()
                Text(memory.timestamp, style: .relative)
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            Text(memory.content)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
                .lineLimit(3)
            HStack {
                Text("Relevance: \(Int(memory.relevance * 100))%")
                    .font(WTheme.Typography.caption2)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
        }
        .padding(.vertical, WTheme.Spacing.xs)
    }
}

#Preview {
    MemoryBrowserView()
        .preferredColorScheme(.dark)
}
