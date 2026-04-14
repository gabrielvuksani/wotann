import SwiftUI

// MARK: - GitPanelView

/// Git status, branches, and recent commits from the desktop workspace.
struct GitPanelView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var gitStatus: [String: RPCValue] = [:]
    @State private var branches: [String] = []
    @State private var currentBranch = ""
    @State private var recentCommits: [[String: RPCValue]] = []
    @State private var isLoading = true
    @State private var diff = ""

    var body: some View {
        NavigationStack {
            List {
                statusSection
                branchSection
                commitsSection
                if !diff.isEmpty { diffSection }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("Git")
            .navigationBarTitleDisplayMode(.large)
            .onAppear { loadAll() }
            .refreshable { loadAll() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button {
                            runGitCommand("git add -A && git status")
                        } label: {
                            Label("Stage All", systemImage: "plus.circle")
                        }
                        Button {
                            loadDiff()
                        } label: {
                            Label("View Diff", systemImage: "doc.text.magnifyingglass")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                }
            }
        }
    }

    // MARK: - Status Section

    private var statusSection: some View {
        Section {
            if isLoading {
                HStack {
                    Spacer()
                    ProgressView().scaleEffect(0.8)
                    Spacer()
                }
            } else {
                HStack(spacing: WTheme.Spacing.sm) {
                    Image(systemName: "arrow.triangle.branch")
                        .foregroundColor(WTheme.Colors.primary)
                        .frame(width: 28)
                    Text(currentBranch.isEmpty ? "Unknown" : currentBranch)
                        .font(WTheme.Typography.code)
                        .foregroundColor(WTheme.Colors.textPrimary)
                    Spacer()
                    if let clean = gitStatus["clean"]?.boolValue {
                        Text(clean ? "Clean" : "Modified")
                            .font(WTheme.Typography.caption2)
                            .fontWeight(.medium)
                            .foregroundColor(clean ? WTheme.Colors.success : WTheme.Colors.warning)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background((clean ? WTheme.Colors.success : WTheme.Colors.warning).opacity(0.15))
                            .clipShape(Capsule())
                    }
                }

                if let staged = gitStatus["staged"]?.intValue, staged > 0 {
                    Label("\(staged) files staged", systemImage: "checkmark.circle.fill")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.success)
                }

                if let modified = gitStatus["modified"]?.intValue, modified > 0 {
                    Label("\(modified) files modified", systemImage: "pencil.circle.fill")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.warning)
                }

                if let untracked = gitStatus["untracked"]?.intValue, untracked > 0 {
                    Label("\(untracked) untracked files", systemImage: "questionmark.circle")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }
        } header: {
            Text("Status")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Branch Section

    private var branchSection: some View {
        Section {
            if branches.isEmpty {
                Text("No branches loaded")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
            } else {
                ForEach(branches, id: \.self) { branch in
                    HStack {
                        Image(systemName: branch == currentBranch ? "arrow.triangle.branch" : "line.diagonal")
                            .font(.caption)
                            .foregroundColor(branch == currentBranch ? WTheme.Colors.primary : WTheme.Colors.textTertiary)
                            .frame(width: 20)
                        Text(branch)
                            .font(WTheme.Typography.code)
                            .foregroundColor(branch == currentBranch ? WTheme.Colors.primary : WTheme.Colors.textPrimary)
                        Spacer()
                        if branch == currentBranch {
                            Text("current")
                                .font(WTheme.Typography.caption2)
                                .foregroundColor(WTheme.Colors.primary)
                        }
                    }
                }
            }
        } header: {
            Text("Branches")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Commits Section

    private var commitsSection: some View {
        Section {
            if recentCommits.isEmpty {
                Text("No commits loaded")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textTertiary)
            } else {
                ForEach(Array(recentCommits.prefix(10).enumerated()), id: \.offset) { _, commit in
                    VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                        Text(commit["message"]?.stringValue ?? "No message")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                            .lineLimit(2)

                        HStack(spacing: WTheme.Spacing.sm) {
                            if let hash = commit["hash"]?.stringValue {
                                Text(String(hash.prefix(7)))
                                    .font(WTheme.Typography.codeSmall)
                                    .foregroundColor(WTheme.Colors.primary)
                            }
                            if let author = commit["author"]?.stringValue {
                                Text(author)
                                    .font(WTheme.Typography.caption2)
                                    .foregroundColor(WTheme.Colors.textTertiary)
                            }
                            if let date = commit["date"]?.stringValue {
                                Text(date)
                                    .font(WTheme.Typography.caption2)
                                    .foregroundColor(WTheme.Colors.textTertiary)
                            }
                        }
                    }
                    .padding(.vertical, WTheme.Spacing.xxs)
                }
            }
        } header: {
            Text("Recent Commits")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Diff Section

    private var diffSection: some View {
        Section {
            Text(diff)
                .font(WTheme.Typography.codeSmall)
                .foregroundColor(WTheme.Colors.textSecondary)
                .lineLimit(nil)
        } header: {
            Text("Diff")
        }
        .listRowBackground(WTheme.Colors.surface)
    }

    // MARK: - Data Loading

    private func loadAll() {
        isLoading = true
        Task {
            async let statusReq = connectionManager.rpcClient.send("git.status")
            async let branchReq = connectionManager.rpcClient.send("git.branches")
            async let logReq = connectionManager.rpcClient.send("git.log", params: ["limit": .double(10)])

            do {
                let (statusResp, branchResp, logResp) = try await (statusReq, branchReq, logReq)

                if let obj = statusResp.result?.objectValue {
                    gitStatus = obj
                    currentBranch = obj["branch"]?.stringValue ?? ""
                }

                if let arr = branchResp.result?.objectValue?["branches"]?.arrayValue {
                    branches = arr.compactMap { $0.stringValue }
                }

                if let arr = logResp.result?.objectValue?["commits"]?.arrayValue {
                    recentCommits = arr.compactMap { $0.objectValue }
                }
            } catch {
                // Non-fatal — views show empty state
            }

            isLoading = false
        }
    }

    private func loadDiff() {
        Task {
            do {
                let response = try await connectionManager.rpcClient.send("git.diff")
                diff = response.result?.stringValue
                    ?? response.result?.objectValue?["diff"]?.stringValue
                    ?? ""
            } catch {}
        }
    }

    private func runGitCommand(_ command: String) {
        Task {
            _ = try? await connectionManager.rpcClient.send("execute", params: [
                "command": .string(command),
            ])
            loadAll()
        }
    }
}

#Preview {
    GitPanelView()
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}
