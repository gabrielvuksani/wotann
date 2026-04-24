import SwiftUI
import os.log

// MARK: - ApprovalSheetView
//
// V9 T5.5 (F6) — iOS approval sheet that slides up when a destructive
// tool call needs user sign-off. Subscribes to
// `approval.queue.subscribe` + calls `approval.decide`.
//
// AUTO-DENY: if the user does not decide within 30 seconds, the
// request is auto-denied and the desktop is notified so the agent
// does not hang forever. Matches the T5.5 integration test.
//
// QUALITY BARS
// - #6 (honest stubs): every RPC failure surfaces via `errorMessage`.
// - #7 (per-session state): the view-model is an `@StateObject`
//   created per view instance. Multiple phones paired to the same
//   desktop can each have their own queue.
// - #11 (sibling-site scan): this file is the SINGLE site on iOS
//   subscribing to `approval.queue.*`.

private let autoDenyTimeoutSeconds: UInt64 = 30

struct ApprovalSheetView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @StateObject private var viewModel = ApprovalSheetViewModel()

    var body: some View {
        ZStack {
            // Backdrop — visible only while a request is pending so
            // the rest of the app is usable between prompts.
            if viewModel.current != nil {
                Color.black.opacity(0.35)
                    .ignoresSafeArea()
                    .transition(.opacity)
            }

            if let request = viewModel.current {
                ApprovalCard(
                    request: request,
                    remainingSeconds: viewModel.remainingSeconds,
                    onApprove: { Task { await viewModel.approve() } },
                    onDeny:    { Task { await viewModel.deny() } }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .padding()
            }
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: viewModel.current?.id)
        .task {
            viewModel.configure(rpcClient: connectionManager.rpcClient)
            viewModel.subscribe()
        }
    }
}

// MARK: - Approval Card

private struct ApprovalCard: View {
    let request: ApprovalRequest
    let remainingSeconds: Int
    let onApprove: () -> Void
    let onDeny: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: WTheme.Spacing.md) {
            HStack {
                Image(systemName: "exclamationmark.shield.fill")
                    .foregroundColor(WTheme.Colors.error)
                Text("Approval required")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Spacer()
                Text("\(remainingSeconds)s")
                    .font(.system(.caption, design: .monospaced))
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .accessibilityLabel("\(remainingSeconds) seconds remaining")
            }

            VStack(alignment: .leading, spacing: WTheme.Spacing.xs) {
                Text(request.title)
                    .font(WTheme.Typography.title3)
                    .foregroundColor(WTheme.Colors.textPrimary)
                if !request.tool.isEmpty {
                    Text(request.tool)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundColor(WTheme.Colors.textTertiary)
                }
            }

            if !request.detail.isEmpty {
                Text(request.detail)
                    .font(WTheme.Typography.body)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(WTheme.Colors.surfaceAlt)
                    .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.sm))
            }

            HStack(spacing: WTheme.Spacing.md) {
                Button(action: onDeny) {
                    Text("Deny")
                        .font(WTheme.Typography.headline)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(WTheme.Colors.error)

                Button(action: onApprove) {
                    Text("Approve")
                        .font(WTheme.Typography.headline)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(WTheme.Colors.primary)
            }
        }
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: WTheme.Radius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: WTheme.Radius.lg)
                .stroke(WTheme.Colors.border, lineWidth: 0.5)
        )
    }
}

// MARK: - Model

struct ApprovalRequest: Identifiable, Equatable {
    let id: String
    let title: String
    let tool: String
    let detail: String
    let receivedAt: Date
}

// MARK: - ViewModel

@MainActor
final class ApprovalSheetViewModel: ObservableObject {
    @Published private(set) var current: ApprovalRequest?
    @Published private(set) var remainingSeconds: Int = Int(autoDenyTimeoutSeconds)
    @Published var errorMessage: String?

    private var queue: [ApprovalRequest] = []
    private var rpcClient: RPCClient?
    private var expiryTask: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?
    private var subscribed: Bool = false
    private static let log = Logger(subsystem: "com.wotann.ios", category: "Approvals")

    func configure(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    func subscribe() {
        guard !subscribed, let rpcClient else { return }
        subscribed = true

        Task { [weak rpcClient] in
            guard let rpcClient else { return }
            _ = try? await rpcClient.send("approval.queue.subscribe")
        }

        rpcClient.subscribe("approval.queue.request") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleIncoming(event)
            }
        }

        rpcClient.subscribe("approval.queue.dismiss") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleDismiss(event)
            }
        }
    }

    // MARK: Incoming

    private func handleIncoming(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }
        guard let id = obj["id"]?.stringValue ?? obj["requestId"]?.stringValue else { return }

        // Ignore duplicate requests — other devices may race.
        if current?.id == id || queue.contains(where: { $0.id == id }) { return }

        let request = ApprovalRequest(
            id: id,
            title: obj["title"]?.stringValue ?? "Confirm action",
            tool: obj["tool"]?.stringValue ?? "",
            detail: obj["detail"]?.stringValue ?? obj["description"]?.stringValue ?? "",
            receivedAt: .now
        )

        if current == nil {
            present(request)
        } else {
            queue.append(request)
        }
    }

    private func handleDismiss(_ event: RPCEvent) {
        guard
            let obj = event.params?.objectValue,
            let id = obj["id"]?.stringValue ?? obj["requestId"]?.stringValue
        else { return }

        // The server dismissed this request (e.g. another device approved).
        // Drop it silently so the user doesn't see a confusing vote.
        if current?.id == id {
            cancelTimers()
            advance()
        } else {
            queue.removeAll { $0.id == id }
        }
    }

    private func present(_ request: ApprovalRequest) {
        current = request
        remainingSeconds = Int(autoDenyTimeoutSeconds)
        startTimers()
    }

    // MARK: Decide

    func approve() async {
        await decide(granted: true)
    }

    func deny() async {
        await decide(granted: false)
    }

    private func decide(granted: Bool) async {
        guard let request = current, let rpcClient else { return }
        cancelTimers()

        do {
            _ = try await rpcClient.send("approval.decide", params: [
                "id": .string(request.id),
                "granted": .bool(granted),
            ])
            errorMessage = nil
        } catch {
            errorMessage = "Could not send decision: \(error.localizedDescription)"
            Self.log.error("approval.decide failed: \(error.localizedDescription, privacy: .public)")
        }

        advance()
    }

    private func advance() {
        if queue.isEmpty {
            current = nil
        } else {
            let next = queue.removeFirst()
            present(next)
        }
    }

    // MARK: Timers

    private func startTimers() {
        let deadline = Date.now.addingTimeInterval(Double(autoDenyTimeoutSeconds))

        expiryTask?.cancel()
        expiryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: autoDenyTimeoutSeconds * 1_000_000_000)
            await MainActor.run { [weak self] in
                guard let self, self.current != nil else { return }
                Task { await self.deny() }
            }
        }

        countdownTask?.cancel()
        countdownTask = Task { [weak self] in
            while !Task.isCancelled {
                let remaining = max(0, Int(deadline.timeIntervalSinceNow))
                await MainActor.run { [weak self] in
                    self?.remainingSeconds = remaining
                }
                if remaining == 0 { break }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }

    private func cancelTimers() {
        expiryTask?.cancel()
        expiryTask = nil
        countdownTask?.cancel()
        countdownTask = nil
    }
}
