import SwiftUI

// MARK: - CouncilView
//
// V9 T5.13 (F10) — iOS phone entry-point for Council (multi-model
// review). Sends a prompt to 2-3 providers in parallel and renders
// each response as a card. Subscribes to `council.update` so
// streaming responses appear live.
//
// QUALITY BARS
// - #6 (honest stubs): errors surface via `errorMessage`.
// - #7 (per-session state): @StateObject ViewModel per instance.
// - #11 (sibling-site scan): this file is the SINGLE site on iOS
//   subscribing to `council.*` RPCs.

private let defaultProviders = ["anthropic", "openai", "gemini"]

struct CouncilView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @StateObject private var viewModel = CouncilViewModel()
    @State private var prompt: String = ""
    @State private var selectedProviders: Set<String> = Set(defaultProviders)

    var body: some View {
        NavigationStack {
            ZStack {
                WTheme.Colors.background.ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: WTheme.Spacing.lg) {
                        composer
                        providerSelector
                        responsesList
                        if let error = viewModel.errorMessage {
                            Text(error)
                                .font(WTheme.Typography.caption)
                                .foregroundColor(WTheme.Colors.error)
                                .padding()
                                .background(WTheme.Colors.error.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle("Council")
            .navigationBarTitleDisplayMode(.large)
            .task {
                viewModel.configure(rpcClient: connectionManager.rpcClient)
                viewModel.subscribe()
            }
        }
    }

    // MARK: - Sections

    private var composer: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Prompt")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
            TextEditor(text: $prompt)
                .font(WTheme.Typography.body)
                .frame(minHeight: 96)
                .padding(WTheme.Spacing.xs)
                .background(WTheme.Colors.surfaceAlt)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            Button {
                runCouncil()
            } label: {
                HStack {
                    if viewModel.isRunning {
                        ProgressView().tint(.white)
                    }
                    Text(viewModel.isRunning ? "Running..." : "Ask the Council")
                        .font(WTheme.Typography.headline)
                }
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(WTheme.Colors.primary)
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
            }
            .disabled(prompt.trimmingCharacters(in: .whitespaces).isEmpty ||
                      selectedProviders.isEmpty ||
                      viewModel.isRunning ||
                      !connectionManager.isConnected)
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
    }

    private var providerSelector: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            Text("Providers")
                .font(WTheme.Typography.subheadline)
                .foregroundColor(WTheme.Colors.textPrimary)
            FlowRow(spacing: WTheme.Spacing.xs) {
                ForEach(defaultProviders, id: \.self) { provider in
                    ProviderChip(
                        name: provider,
                        isSelected: selectedProviders.contains(provider)
                    ) {
                        if selectedProviders.contains(provider) {
                            selectedProviders.remove(provider)
                        } else {
                            selectedProviders.insert(provider)
                        }
                    }
                }
            }
        }
    }

    private var responsesList: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.sm) {
            if !viewModel.responses.isEmpty {
                Text("Responses")
                    .font(WTheme.Typography.subheadline)
                    .foregroundColor(WTheme.Colors.textPrimary)
            }
            ForEach(viewModel.responses) { response in
                CouncilResponseCard(response: response)
            }
        }
    }

    // MARK: - Actions

    private func runCouncil() {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !selectedProviders.isEmpty else { return }
        Task {
            await viewModel.run(prompt: trimmed, providers: Array(selectedProviders))
        }
    }
}

// MARK: - Chip

private struct ProviderChip: View {
    let name: String
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(name.capitalized)
                .font(WTheme.Typography.caption)
                .padding(.horizontal, WTheme.Spacing.sm)
                .padding(.vertical, 6)
                .background(isSelected ? WTheme.Colors.primary : WTheme.Colors.surfaceAlt)
                .foregroundColor(isSelected ? .white : WTheme.Colors.textPrimary)
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(WTheme.Colors.border, lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Response Card

private struct CouncilResponseCard: View {
    let response: CouncilResponse

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
            HStack {
                Text(response.provider.capitalized)
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Spacer()
                Text(response.status.capitalized)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            Text(response.content.isEmpty ? "(Waiting for response)" : response.content)
                .font(WTheme.Typography.body)
                .foregroundColor(WTheme.Colors.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.md))
    }
}

// MARK: - FlowRow (minimal wrap layout, iOS 16+)

private struct FlowRow<Content: View>: View {
    let spacing: CGFloat
    let content: () -> Content

    init(spacing: CGFloat, @ViewBuilder content: @escaping () -> Content) {
        self.spacing = spacing
        self.content = content
    }

    var body: some View {
        // Simple horizontal wrap via a lazy stack — sufficient for a
        // handful of provider chips, avoids pulling in a custom layout.
        HStack(spacing: spacing) {
            content()
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Model

struct CouncilResponse: Identifiable, Equatable {
    let id: String
    let provider: String
    let status: String     // "pending" | "streaming" | "done" | "failed"
    let content: String
}

// MARK: - ViewModel

@MainActor
final class CouncilViewModel: ObservableObject {
    @Published private(set) var responses: [CouncilResponse] = []
    @Published private(set) var isRunning: Bool = false
    @Published var errorMessage: String?

    private var rpcClient: RPCClient?
    private var subscribed = false
    private var activeRequestId: String?

    func configure(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    func subscribe() {
        guard !subscribed, let rpcClient else { return }
        subscribed = true
        rpcClient.subscribe("council.update") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleUpdate(event)
            }
        }
    }

    func run(prompt: String, providers: [String]) async {
        guard let rpcClient else { return }
        isRunning = true
        defer { isRunning = false }

        // Reset for a fresh run.
        responses = providers.map { provider in
            CouncilResponse(
                id: "\(provider)-\(UUID().uuidString.prefix(6))",
                provider: provider,
                status: "pending",
                content: ""
            )
        }

        let providerValues = providers.map { RPCValue.string($0) }
        do {
            let response = try await rpcClient.send("council", params: [
                "query": .string(prompt),
                "providers": .array(providerValues),
            ])
            if let obj = response.result?.objectValue,
               let requestId = obj["requestId"]?.stringValue {
                activeRequestId = requestId
            }
            // Fill in any synchronous results that arrived in the
            // response — the stream will update the rest.
            applyResponseSnapshot(response.result)
            errorMessage = nil
        } catch {
            errorMessage = "Council request failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Parsing

    private func applyResponseSnapshot(_ value: RPCValue?) {
        guard let obj = value?.objectValue else { return }
        if let array = obj["responses"]?.arrayValue {
            for item in array {
                if let parsed = parseResponse(item) {
                    mergeResponse(parsed)
                }
            }
        }
    }

    private func parseResponse(_ value: RPCValue) -> CouncilResponse? {
        guard let obj = value.objectValue else { return nil }
        guard let provider = obj["provider"]?.stringValue else { return nil }
        let id = obj["id"]?.stringValue
            ?? "\(provider)-\(obj["messageId"]?.stringValue ?? UUID().uuidString)"
        let status = obj["status"]?.stringValue ?? "streaming"
        let content = obj["content"]?.stringValue
            ?? obj["text"]?.stringValue
            ?? ""
        return CouncilResponse(id: id, provider: provider, status: status, content: content)
    }

    private func mergeResponse(_ incoming: CouncilResponse) {
        if let idx = responses.firstIndex(where: { $0.provider == incoming.provider }) {
            responses[idx] = incoming
        } else {
            responses.append(incoming)
        }
    }

    private func handleUpdate(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }

        // Filter by requestId so council updates from other sessions
        // don't bleed into ours.
        if let requestId = obj["requestId"]?.stringValue,
           let active = activeRequestId,
           requestId != active {
            return
        }

        if let array = obj["responses"]?.arrayValue {
            for item in array {
                if let parsed = parseResponse(item) {
                    mergeResponse(parsed)
                }
            }
            return
        }
        if let responseValue = obj["response"] ?? obj["payload"],
           let parsed = parseResponse(responseValue) {
            mergeResponse(parsed)
        }
    }
}
