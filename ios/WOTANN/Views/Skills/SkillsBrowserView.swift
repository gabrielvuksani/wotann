import SwiftUI

// MARK: - SkillsBrowserView

/// Browse and invoke WOTANN skills from the phone.
struct SkillsBrowserView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var skills: [SkillItem] = []
    @State private var searchQuery = ""
    @State private var isLoading = false
    @State private var selectedSkill: SkillItem?
    @State private var invokePrompt = ""
    @State private var isInvoking = false
    @State private var invokeResult: String?
    @State private var loadError: String?

    var filteredSkills: [SkillItem] {
        if searchQuery.isEmpty { return skills }
        return skills.filter {
            $0.name.localizedCaseInsensitiveContains(searchQuery) ||
            $0.description.localizedCaseInsensitiveContains(searchQuery)
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let loadError {
                    ErrorBanner(
                        message: loadError,
                        type: .error,
                        onRetry: { loadSkills() }
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                if isLoading {
                    Spacer()
                    ProgressView()
                        .tint(WTheme.Colors.primary)
                    Spacer()
                } else if let loadError {
                    Spacer()
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.wotannScaled(size: 40))
                            .foregroundColor(WTheme.Colors.error)
                        Text("Couldn't load skills")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textPrimary)
                        Text(loadError)
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, WTheme.Spacing.xl)
                        Text("Make sure `wotann engine start` is running on your desktop.")
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textTertiary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, WTheme.Spacing.xl)
                        RetryButton(action: { loadSkills() })
                            .padding(.top, WTheme.Spacing.sm)
                    }
                    Spacer()
                } else if skills.isEmpty {
                    Spacer()
                    VStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "sparkles")
                            .font(.wotannScaled(size: 40))
                            .foregroundColor(WTheme.Colors.textTertiary)
                        Text("No skills available")
                            .font(WTheme.Typography.headline)
                            .foregroundColor(WTheme.Colors.textSecondary)
                        Text("Connect to your desktop to browse available skills.")
                            .font(WTheme.Typography.subheadline)
                            .foregroundColor(WTheme.Colors.textTertiary)
                            .multilineTextAlignment(.center)
                    }
                    Spacer()
                } else {
                    List(filteredSkills) { skill in
                        Button {
                            selectedSkill = skill
                        } label: {
                            SkillRow(skill: skill)
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                    .searchable(text: $searchQuery, prompt: "Search skills...")
                }
            }
            .navigationTitle("Skills")
            .navigationBarTitleDisplayMode(.large)
            .onAppear { loadSkills() }
            .refreshable { loadSkills() }
            .sheet(item: $selectedSkill) { skill in
                SkillDetailSheet(
                    skill: skill,
                    invokePrompt: $invokePrompt,
                    isInvoking: $isInvoking,
                    invokeResult: $invokeResult,
                    onInvoke: { prompt in
                        invokeSkill(skill, prompt: prompt)
                    }
                )
            }
        }
    }

    private func loadSkills() {
        guard connectionManager.isPaired else { return }
        isLoading = true
        loadError = nil
        Task {
            do {
                let result = try await connectionManager.rpcClient.getSkills()
                await MainActor.run {
                    skills = result.map { key, value in
                        SkillItem(
                            name: key,
                            description: value.stringValue ?? ""
                        )
                    }.sorted { $0.name < $1.name }
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    loadError = error.localizedDescription
                    isLoading = false
                }
            }
        }
    }

    private func invokeSkill(_ skill: SkillItem, prompt: String) {
        guard !prompt.isEmpty else { return }
        isInvoking = true
        invokeResult = nil

        Task {
            do {
                // Provider neutrality fix: was hardcoded "anthropic" — broke
                // skill invocation for Ollama-only / OpenAI-only / Gemini-only
                // users. Now omits the provider key so the daemon resolves
                // from the active session's provider.
                let response = try await connectionManager.rpcClient.send("chat.send", params: [
                    "message": .string("/\(skill.name) \(prompt)"),
                ])
                await MainActor.run {
                    invokeResult = response.result?.stringValue
                        ?? response.result?.objectValue?["content"]?.stringValue
                        ?? "Skill invoked successfully"
                    isInvoking = false
                }
            } catch {
                await MainActor.run {
                    invokeResult = "Error: \(error.localizedDescription)"
                    isInvoking = false
                }
            }
        }
    }
}

// MARK: - SkillItem

struct SkillItem: Identifiable {
    let id = UUID()
    let name: String
    let description: String
}

// MARK: - SkillRow

struct SkillRow: View {
    let skill: SkillItem

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            Image(systemName: "sparkle")
                .font(.wotannScaled(size: 16))
                .foregroundColor(WTheme.Colors.primary)
                .frame(width: 32, height: 32)
                .background(WTheme.Colors.primary.opacity(0.1))
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))

            VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                Text(skill.name)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(WTheme.Colors.textPrimary)

                if !skill.description.isEmpty {
                    Text(skill.description)
                        .font(WTheme.Typography.caption)
                        .foregroundColor(WTheme.Colors.textTertiary)
                        .lineLimit(2)
                }
            }

            Spacer()

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .padding(.vertical, WTheme.Spacing.xs)
    }
}

// MARK: - SkillDetailSheet

struct SkillDetailSheet: View {
    let skill: SkillItem
    @Binding var invokePrompt: String
    @Binding var isInvoking: Bool
    @Binding var invokeResult: String?
    let onInvoke: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                    // Skill header
                    HStack(spacing: WTheme.Spacing.md) {
                        Image(systemName: "sparkle")
                            .font(.wotannScaled(size: 24))
                            .foregroundColor(WTheme.Colors.primary)
                            .frame(width: 48, height: 48)
                            .background(WTheme.Colors.primary.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))

                        VStack(alignment: .leading, spacing: WTheme.Spacing.xxs) {
                            Text(skill.name)
                                .font(WTheme.Typography.title3)
                                .foregroundColor(WTheme.Colors.textPrimary)

                            if !skill.description.isEmpty {
                                Text(skill.description)
                                    .font(WTheme.Typography.subheadline)
                                    .foregroundColor(WTheme.Colors.textSecondary)
                            }
                        }
                    }

                    Divider()

                    // Invoke section
                    VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                        Text("RUN SKILL")
                            .font(WTheme.Typography.caption2)
                            .fontWeight(.semibold)
                            .foregroundColor(WTheme.Colors.textSecondary)
                            .tracking(WTheme.Tracking.wide)

                        TextField("What should this skill do?", text: $invokePrompt, axis: .vertical)
                            .font(WTheme.Typography.body)
                            .lineLimit(3...6)
                            .padding(WTheme.Spacing.md)
                            .background(WTheme.Colors.surface)
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                            .overlay(
                                RoundedRectangle(cornerRadius: WTheme.Radius.md)
                                    .stroke(WTheme.Colors.border, lineWidth: WTheme.BorderWidth.hairline)
                            )

                        Button {
                            onInvoke(invokePrompt)
                        } label: {
                            HStack {
                                if isInvoking {
                                    ProgressView()
                                        .tint(.white)
                                        .scaleEffect(0.8)
                                } else {
                                    Image(systemName: "play.fill")
                                }
                                Text(isInvoking ? "Running..." : "Invoke Skill")
                                    .font(WTheme.Typography.headline)
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(invokePrompt.isEmpty || isInvoking
                                ? WTheme.Colors.textTertiary
                                : WTheme.Colors.primary
                            )
                            .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                        }
                        .disabled(invokePrompt.isEmpty || isInvoking)
                    }

                    // Result section
                    if let result = invokeResult {
                        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
                            Text("RESULT")
                                .font(WTheme.Typography.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(WTheme.Colors.textSecondary)
                                .tracking(WTheme.Tracking.wide)

                            Text(result)
                                .font(WTheme.Typography.body)
                                .foregroundColor(WTheme.Colors.textPrimary)
                                .padding(WTheme.Spacing.md)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(WTheme.Colors.surface)
                                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
                        }
                    }
                }
                .padding(WTheme.Spacing.lg)
            }
            .background(WTheme.Colors.background)
            .navigationTitle("Skill")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#Preview {
    SkillsBrowserView()
        .preferredColorScheme(.dark)
}
