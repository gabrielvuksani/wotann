import SwiftUI

// MARK: - ArenaView

/// Side-by-side model comparison view (Compare feature).
struct ArenaView: View {
    @EnvironmentObject var appState: AppState
    @EnvironmentObject var connectionManager: ConnectionManager
    @State private var prompt = ""
    // Empty initial pair — populated from AppState.activeProvider /
    // configuredProviders when the view appears. Hard-coding two
    // vendors here would force every Arena session to start with that
    // pair regardless of what the user actually configured (and would
    // reference the stale claude-opus-4-6 model that retires Jun 15
    // 2026). Use the model picker to choose.
    @State private var selectedModels: [ArenaModel] = []
    @State private var responses: [ArenaResponse] = []
    @State private var isRunning = false
    @State private var showModelPicker = false
    @State private var votedId: UUID?
    @AppStorage("arenaBlindMode") private var blindMode = false
    @AppStorage("arenaVoteHistory") private var voteHistoryData: Data = Data()
    @FocusState private var isPromptFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                WTheme.Colors.background.ignoresSafeArea()

                if responses.isEmpty && !isRunning {
                    emptyState
                } else {
                    resultsContent
                }
            }
            .safeAreaInset(edge: .bottom) {
                promptBar
            }
            .navigationTitle("Compare")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        blindMode.toggle()
                        HapticService.shared.trigger(.selection)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: blindMode ? "eye.slash.fill" : "eye.fill")
                            Text(blindMode ? "Blind" : "Open")
                                .font(WTheme.Typography.caption2)
                                .fontWeight(.medium)
                        }
                        .foregroundColor(blindMode ? WTheme.Colors.warning : WTheme.Colors.textSecondary)
                        .padding(.horizontal, WTheme.Spacing.sm)
                        .padding(.vertical, WTheme.Spacing.xs)
                        .background(blindMode ? WTheme.Colors.warning.opacity(0.15) : WTheme.Colors.surface)
                        .clipShape(Capsule())
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showModelPicker = true
                    } label: {
                        Image(systemName: "slider.horizontal.3")
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                }
            }
            .sheet(isPresented: $showModelPicker) {
                ModelPickerSheet(
                    selectedModels: $selectedModels,
                    onDismiss: { showModelPicker = false }
                )
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: WTheme.Spacing.lg) {
            Image(systemName: "square.split.2x1.fill")
                .font(.wotannScaled(size: 56))
                .foregroundStyle(
                    LinearGradient(
                        colors: [WTheme.Colors.primary, .wotannCyan],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            Text("Model Arena")
                .font(WTheme.Typography.title2)
                .foregroundColor(WTheme.Colors.textPrimary)

            Text("Send the same prompt to multiple models\nand compare their responses side by side.")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, WTheme.Spacing.xl)

            modelChips
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Model Chips

    private var modelChips: some View {
        HStack(spacing: WTheme.Spacing.sm) {
            ForEach(selectedModels) { model in
                ProviderBadge(provider: model.provider)
            }
        }
        .padding(.top, WTheme.Spacing.sm)
    }

    // MARK: - Results

    private var resultsContent: some View {
        ScrollView {
            VStack(spacing: WTheme.Spacing.md) {
                if !prompt.isEmpty || !responses.isEmpty {
                    promptCard
                }

                responseGrid
            }
            .padding(WTheme.Spacing.md)
        }
    }

    private var promptCard: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            HStack(spacing: WTheme.Spacing.xs) {
                Image(systemName: "text.bubble.fill")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.primary)
                Text("Prompt")
                    .font(WTheme.Typography.caption)
                    .fontWeight(.bold)
                    .foregroundColor(WTheme.Colors.textSecondary)
            }

            Text(responses.first?.prompt ?? prompt)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .wCard()
    }

    private var responseGrid: some View {
        let isCompact = UIScreen.main.bounds.width < 600

        return Group {
            if isCompact {
                VStack(spacing: WTheme.Spacing.md) {
                    ForEach(Array(responsesOrPlaceholders.enumerated()), id: \.element.id) { index, item in
                        ArenaResponseCard(
                            item: item,
                            isVoted: votedId == item.id,
                            blindMode: blindMode,
                            blindLabel: "Model \(Character(UnicodeScalar(65 + index)!))",
                            onVote: { voteFor(item.id) }
                        )
                    }
                }
            } else {
                HStack(alignment: .top, spacing: WTheme.Spacing.md) {
                    ForEach(Array(responsesOrPlaceholders.enumerated()), id: \.element.id) { index, item in
                        ArenaResponseCard(
                            item: item,
                            isVoted: votedId == item.id,
                            blindMode: blindMode,
                            blindLabel: "Model \(Character(UnicodeScalar(65 + index)!))",
                            onVote: { voteFor(item.id) }
                        )
                        .frame(maxWidth: .infinity)
                    }
                }
            }
        }
    }

    private var responsesOrPlaceholders: [ArenaResponse] {
        if isRunning && responses.isEmpty {
            return selectedModels.map { model in
                ArenaResponse(
                    provider: model.provider,
                    model: model.model,
                    content: "",
                    tokenCount: 0,
                    cost: 0,
                    latencyMs: 0,
                    prompt: prompt,
                    isLoading: true
                )
            }
        }
        return responses
    }

    // MARK: - Prompt Bar

    private var promptBar: some View {
        VStack(spacing: 0) {
            // T7.3 — The divider + prompt bar together form the Compare
            // composer surface. Wrapping the prompt bar in `.wLiquidGlass`
            // keeps the iOS 18 `.ultraThinMaterial` look and gracefully
            // upgrades to Liquid Glass on iOS 26.
            Divider().background(WTheme.Colors.border)

            HStack(alignment: .bottom, spacing: WTheme.Spacing.sm) {
                TextField("Enter a prompt to compare...", text: $prompt, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .lineLimit(1...4)
                    .focused($isPromptFocused)
                    .submitLabel(.send)
                    .onSubmit(runComparison)
                    // T7.2 — Writing Tools on the Compare composer.
                    .wotannWritingToolsComplete()
                    .padding(.horizontal, WTheme.Spacing.sm)
                    .padding(.vertical, WTheme.Spacing.sm)
                    .background(WTheme.Colors.surface)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg))

                Button(action: runComparison) {
                    Group {
                        if isRunning {
                            ProgressView()
                                .tint(WTheme.Colors.textPrimary)
                        } else {
                            Image(systemName: "play.fill")
                        }
                    }
                    .frame(width: 36, height: 36)
                    .foregroundColor(WTheme.Colors.textPrimary)
                    .background(
                        canRun
                            ? WTheme.Colors.primary
                            : WTheme.Colors.surfaceAlt
                    )
                    .clipShape(Circle())
                }
                .disabled(!canRun)
            }
            .padding(.horizontal, WTheme.Spacing.md)
            .padding(.vertical, WTheme.Spacing.sm)
            .wLiquidGlass(in: Rectangle())
        }
    }

    private var canRun: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isRunning
            && selectedModels.count >= 2
    }

    // MARK: - Actions

    private func runComparison() {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isRunning else { return }

        HapticService.shared.trigger(.buttonTap)
        isRunning = true
        votedId = nil
        responses = []
        isPromptFocused = false

        Task {
            var collected: [ArenaResponse] = []

            await withTaskGroup(of: ArenaResponse?.self) { group in
                for model in selectedModels {
                    group.addTask {
                        await self.fetchResponse(
                            prompt: trimmed,
                            provider: model.provider,
                            model: model.model
                        )
                    }
                }
                for await result in group {
                    if let r = result {
                        collected.append(r)
                        withAnimation(WTheme.Animation.smooth) {
                            responses = collected
                        }
                    }
                }
            }

            withAnimation(WTheme.Animation.smooth) {
                isRunning = false
            }

            HapticService.shared.trigger(.responseComplete)
        }
    }

    private func fetchResponse(
        prompt: String,
        provider: String,
        model: String
    ) async -> ArenaResponse? {
        let start = Date()
        do {
            let response = try await connectionManager.rpcClient.send("arena.run", params: [
                "prompt": .string(prompt),
                "provider": .string(provider),
                "model": .string(model),
            ])

            let latency = Date().timeIntervalSince(start) * 1000

            // Parse structured response from the RPC result
            let content: String
            let tokenCount: Int
            let cost: Double

            if case .object(let obj) = response.result {
                content = obj["content"]?.stringValue
                    ?? obj["text"]?.stringValue
                    ?? "No response received."
                tokenCount = obj["token_count"]?.intValue ?? 0
                cost = obj["cost"]?.doubleValue ?? 0
            } else {
                content = response.result?.stringValue ?? "No response received."
                tokenCount = 0
                cost = 0
            }

            return ArenaResponse(
                provider: provider,
                model: model,
                content: content,
                tokenCount: tokenCount,
                cost: cost,
                latencyMs: latency,
                prompt: prompt,
                isLoading: false
            )
        } catch {
            let latency = Date().timeIntervalSince(start) * 1000
            return ArenaResponse(
                provider: provider,
                model: model,
                content: "Error: \(error.localizedDescription)",
                tokenCount: 0,
                cost: 0,
                latencyMs: latency,
                prompt: prompt,
                isLoading: false,
                isError: true
            )
        }
    }

    private func voteFor(_ id: UUID) {
        withAnimation(WTheme.Animation.bouncy) {
            votedId = id
        }
        HapticService.shared.trigger(.selection)

        // Persist vote to leaderboard
        if let winner = responses.first(where: { $0.id == id }) {
            var history = loadVoteHistory()
            let key = "\(winner.provider)/\(winner.model)"
            history[key, default: 0] += 1
            saveVoteHistory(history)
        }
    }

    // MARK: - Vote Persistence

    private func loadVoteHistory() -> [String: Int] {
        guard !voteHistoryData.isEmpty,
              let decoded = try? JSONDecoder().decode([String: Int].self, from: voteHistoryData) else {
            return [:]
        }
        return decoded
    }

    private func saveVoteHistory(_ history: [String: Int]) {
        if let encoded = try? JSONEncoder().encode(history) {
            voteHistoryData = encoded
        }
    }
}

// MARK: - ArenaModel

struct ArenaModel: Identifiable, Hashable {
    let id = UUID()
    let provider: String
    let model: String
}

// MARK: - ArenaResponse

struct ArenaResponse: Identifiable {
    let id = UUID()
    let provider: String
    let model: String
    let content: String
    let tokenCount: Int
    let cost: Double
    let latencyMs: Double
    let prompt: String
    var isLoading: Bool = false
    var isError: Bool = false

    var formattedLatency: String {
        if latencyMs < 1000 {
            return "\(Int(latencyMs))ms"
        }
        return String(format: "%.1fs", latencyMs / 1000)
    }
}

// MARK: - ArenaResponseCard

struct ArenaResponseCard: View {
    let item: ArenaResponse
    let isVoted: Bool
    var blindMode: Bool = false
    var blindLabel: String = ""
    let onVote: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            header
            Divider().background(WTheme.Colors.border)

            if item.isLoading {
                loadingBody
            } else {
                responseBody
            }
        }
        .wCard()
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.lg)
                .strokeBorder(
                    isVoted ? WTheme.Colors.success : Color.clear,
                    lineWidth: 2
                )
        )
        .animation(WTheme.Animation.smooth, value: isVoted)
    }

    /// Show blind label (e.g. "Model A") when blind mode is on and no vote cast yet.
    /// After voting, reveal the actual provider/model identity.
    private var shouldReveal: Bool { !blindMode || isVoted }

    private var header: some View {
        HStack {
            if shouldReveal {
                ProviderBadge(provider: item.provider)
                Text(item.model)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            } else {
                Text(blindLabel)
                    .font(WTheme.Typography.subheadline)
                    .fontWeight(.bold)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Image(systemName: "eye.slash")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.warning)
            }

            Spacer()

            if isVoted {
                Image(systemName: "trophy.fill")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.success)
                    .transition(.scale.combined(with: .opacity))
            }
        }
    }

    private var loadingBody: some View {
        VStack(spacing: WTheme.Spacing.md) {
            LoadingIndicator(size: 32, color: WTheme.Colors.provider(item.provider))
            Text("Generating response...")
                .font(WTheme.Typography.caption)
                .foregroundColor(WTheme.Colors.textTertiary)
        }
        .frame(maxWidth: .infinity, minHeight: 120)
    }

    private var responseBody: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text(item.content)
                .font(WTheme.Typography.subheadline)
                .foregroundColor(
                    item.isError
                        ? WTheme.Colors.error
                        : WTheme.Colors.textPrimary
                )
                .lineLimit(nil)

            Divider().background(WTheme.Colors.border)

            statsRow
            voteButton
        }
    }

    private var statsRow: some View {
        HStack(spacing: WTheme.Spacing.md) {
            StatPill(icon: "number", label: "\(item.tokenCount) tok")
            StatPill(icon: "dollarsign.circle", label: String(format: "$%.4f", item.cost))
            StatPill(icon: "clock", label: item.formattedLatency)
        }
    }

    private var voteButton: some View {
        Button(action: onVote) {
            HStack(spacing: WTheme.Spacing.xs) {
                Image(systemName: isVoted ? "hand.thumbsup.fill" : "hand.thumbsup")
                Text(isVoted ? "Preferred" : "Vote")
                    .font(WTheme.Typography.caption)
                    .fontWeight(.medium)
            }
            .foregroundColor(isVoted ? WTheme.Colors.success : WTheme.Colors.textSecondary)
            .padding(.horizontal, WTheme.Spacing.sm)
            .padding(.vertical, WTheme.Spacing.xs)
            .background(
                (isVoted ? WTheme.Colors.success : WTheme.Colors.surfaceAlt)
                    .opacity(isVoted ? 0.15 : 1)
            )
            .clipShape(Capsule())
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }
}

// MARK: - StatPill

private struct StatPill: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: WTheme.Spacing.xxs) {
            Image(systemName: icon)
                .font(.wotannScaled(size: 10))
            Text(label)
                .font(WTheme.Typography.caption2)
        }
        .foregroundColor(WTheme.Colors.textTertiary)
    }
}

// MARK: - ModelPickerSheet

struct ModelPickerSheet: View {
    @Binding var selectedModels: [ArenaModel]
    let onDismiss: () -> Void

    private let availableModels: [(provider: String, models: [String])] = [
        ("anthropic", ["claude-opus-4-6", "claude-sonnet-4-5", "claude-haiku-3-5"]),
        ("openai", ["gpt-4o", "gpt-4o-mini", "o1-preview"]),
        ("google", ["gemini-2.0-flash", "gemini-1.5-pro"]),
        ("mistral", ["mistral-large", "mistral-medium"]),
        ("groq", ["llama-3.1-70b", "mixtral-8x7b"]),
        ("deepseek", ["deepseek-v3", "deepseek-r1"]),
        ("xai", ["grok-2"]),
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Select 2 or more models to compare side by side.")
                        .font(WTheme.Typography.subheadline)
                        .foregroundColor(WTheme.Colors.textSecondary)
                        .listRowBackground(Color.clear)
                }

                ForEach(availableModels, id: \.provider) { group in
                    Section {
                        ForEach(group.models, id: \.self) { model in
                            let isSelected = selectedModels.contains {
                                $0.provider == group.provider && $0.model == model
                            }

                            Button {
                                toggleModel(provider: group.provider, model: model)
                            } label: {
                                HStack {
                                    ProviderBadge(provider: group.provider, size: .small)

                                    Text(model)
                                        .font(WTheme.Typography.subheadline)
                                        .foregroundColor(WTheme.Colors.textPrimary)

                                    Spacer()

                                    if isSelected {
                                        Image(systemName: "checkmark.circle.fill")
                                            .foregroundColor(WTheme.Colors.primary)
                                    } else {
                                        Image(systemName: "circle")
                                            .foregroundColor(WTheme.Colors.textTertiary)
                                    }
                                }
                            }
                        }
                    } header: {
                        Text(group.provider.capitalized)
                            .font(WTheme.Typography.caption)
                            .foregroundColor(WTheme.Colors.textSecondary)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(WTheme.Colors.background)
            .navigationTitle("Select Models")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done", action: onDismiss)
                        .fontWeight(.semibold)
                        .disabled(selectedModels.count < 2)
                }
            }
        }
    }

    private func toggleModel(provider: String, model: String) {
        if let index = selectedModels.firstIndex(where: {
            $0.provider == provider && $0.model == model
        }) {
            guard selectedModels.count > 2 else { return }
            var updated = selectedModels
            updated.remove(at: index)
            selectedModels = updated
        } else {
            selectedModels = selectedModels + [ArenaModel(provider: provider, model: model)]
        }
        HapticService.shared.trigger(.selection)
    }
}

// MARK: - Previews

#Preview("Arena - Empty") {
    ArenaView()
        .environmentObject(AppState())
        .environmentObject(ConnectionManager())
        .preferredColorScheme(.dark)
}

#Preview("Arena Response Card") {
    VStack(spacing: 16) {
        ArenaResponseCard(
            item: ArenaResponse(
                provider: "anthropic",
                model: "claude-opus-4-6",
                content: "Here is a detailed comparison of the two approaches...",
                tokenCount: 342,
                cost: 0.0123,
                latencyMs: 1450,
                prompt: "Compare REST vs GraphQL"
            ),
            isVoted: true,
            onVote: {}
        )

        ArenaResponseCard(
            item: ArenaResponse(
                provider: "openai",
                model: "gpt-4o",
                content: "REST and GraphQL serve different purposes...",
                tokenCount: 287,
                cost: 0.0089,
                latencyMs: 980,
                prompt: "Compare REST vs GraphQL"
            ),
            isVoted: false,
            onVote: {}
        )
    }
    .padding()
    .background(WTheme.Colors.background)
    .preferredColorScheme(.dark)
}
