import SwiftUI

// MARK: - HandoffView
//
// V9 T5.11 (F14) — Handoff banner that appears when the desktop
// signals a session is eligible to resume on the phone. Subscribes
// to `computer.session.handoff` and, when a candidate exists,
// presents a pill the user taps to adopt the session.
//
// Behaviour mirrors the iOS `NSUserActivity` Handoff card but is
// driven by our own RPC stream so the desktop can advertise
// candidates before the app is even foregrounded — the `@State`
// banner shows on next app activation.
//
// QUALITY BARS
// - #6 (honest stubs): RPC failures route to `errorMessage`.
// - #7 (per-session state): `HandoffViewModel` is @StateObject, so
//   each HandoffView instance has its own queue. No module-global.
// - #11 (sibling-site scan): this file is the SINGLE site on iOS
//   subscribing to `computer.session.handoff*`.

struct HandoffView: View {
    @EnvironmentObject var connectionManager: ConnectionManager
    @StateObject private var viewModel = HandoffViewModel()
    var onAccept: ((HandoffCandidate) -> Void)?

    var body: some View {
        VStack {
            if let candidate = viewModel.current {
                HandoffBanner(
                    candidate: candidate,
                    onAccept: {
                        onAccept?(candidate)
                        Task { await viewModel.accept() }
                    },
                    onDismiss: { viewModel.dismiss() }
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            Spacer()
        }
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: viewModel.current?.id)
        .task {
            viewModel.configure(rpcClient: connectionManager.rpcClient)
            viewModel.subscribe()
        }
    }
}

// MARK: - Banner

private struct HandoffBanner: View {
    let candidate: HandoffCandidate
    let onAccept: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        HStack(spacing: WTheme.Spacing.md) {
            Image(systemName: "arrow.triangle.branch")
                .font(.title3)
                .foregroundColor(WTheme.Colors.primary)
            VStack(alignment: .leading, spacing: 2) {
                Text("Continue on iPhone")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(WTheme.Colors.textPrimary)
                Text(candidate.summary)
                    .font(WTheme.Typography.caption)
                    .foregroundColor(WTheme.Colors.textSecondary)
                    .lineLimit(1)
            }
            Spacer()
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.caption)
                    .foregroundColor(WTheme.Colors.textTertiary)
            }
            .accessibilityLabel("Dismiss handoff")
            Button(action: onAccept) {
                Text("Open")
                    .font(WTheme.Typography.headline)
                    .foregroundColor(.white)
                    .padding(.horizontal, WTheme.Spacing.md)
                    .padding(.vertical, WTheme.Spacing.xs)
                    .background(WTheme.Colors.primary)
                    .clipShape(Capsule())
            }
            .accessibilityLabel("Open handoff")
        }
        .padding()
        // T7.3 — Handoff banner glass. The same wLiquidGlass treatment
        // as ApprovalSheetView so the cross-cutting overlays read as one
        // visual family. iOS 26 promotes to native Liquid Glass; iOS 18
        // gets the ultra-thin material + hairline ring.
        .wLiquidGlass(
            in: RoundedRectangle(cornerRadius: WTheme.Radius.md)
        )
        .padding(.horizontal)
        .padding(.top, WTheme.Spacing.sm)
    }
}

// MARK: - Model

struct HandoffCandidate: Identifiable, Equatable {
    let id: String                    // session id
    let summary: String               // user-visible, e.g. "Chat with GPT-5"
    let surface: String               // "chat" | "editor" | "workshop" | "exploit"
    let resumeContext: String?        // daemon-provided resume blob
    let announcedAt: Date
}

// MARK: - ViewModel

@MainActor
final class HandoffViewModel: ObservableObject {
    @Published private(set) var current: HandoffCandidate?
    @Published var errorMessage: String?

    private var queue: [HandoffCandidate] = []
    private var rpcClient: RPCClient?
    private var subscribed = false

    func configure(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    func subscribe() {
        guard !subscribed, let rpcClient else { return }
        subscribed = true

        Task { [weak rpcClient] in
            guard let rpcClient else { return }
            _ = try? await rpcClient.send("computer.session.handoff")
        }

        rpcClient.subscribe("computer.session.handoff") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleAnnounce(event)
            }
        }
        rpcClient.subscribe("computer.session.expireHandoff") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleRevoke(event)
            }
        }
    }

    // MARK: Inbound

    private func handleAnnounce(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }
        guard let id = obj["sessionId"]?.stringValue ?? obj["id"]?.stringValue else { return }

        // De-dup — an earlier announce may have already surfaced.
        if current?.id == id || queue.contains(where: { $0.id == id }) { return }

        let candidate = HandoffCandidate(
            id: id,
            summary: obj["summary"]?.stringValue ?? "Continue on iPhone",
            surface: obj["surface"]?.stringValue ?? "chat",
            resumeContext: obj["resumeContext"]?.stringValue,
            announcedAt: .now
        )
        if current == nil {
            current = candidate
        } else {
            queue.append(candidate)
        }
    }

    private func handleRevoke(_ event: RPCEvent) {
        guard
            let obj = event.params?.objectValue,
            let id = obj["sessionId"]?.stringValue ?? obj["id"]?.stringValue
        else { return }
        if current?.id == id {
            advance()
        } else {
            queue.removeAll { $0.id == id }
        }
    }

    // MARK: Actions

    /// Accept the current handoff candidate. Tells the desktop daemon
    /// the phone is now the active surface. The caller also receives
    /// the candidate via the `onAccept` closure so it can route the
    /// UI to the right tab.
    func accept() async {
        guard let candidate = current, let rpcClient else { return }
        do {
            _ = try await rpcClient.send("computer.session.acceptHandoff", params: [
                "sessionId": .string(candidate.id),
            ])
            errorMessage = nil
        } catch {
            errorMessage = "Could not accept handoff: \(error.localizedDescription)"
        }
        advance()
    }

    /// Dismiss the current candidate without accepting.
    func dismiss() {
        guard let candidate = current, let rpcClient else {
            advance()
            return
        }
        Task { [weak rpcClient] in
            guard let rpcClient else { return }
            _ = try? await rpcClient.send("computer.session.expireHandoff", params: [
                "sessionId": .string(candidate.id),
            ])
        }
        advance()
    }

    private func advance() {
        if queue.isEmpty {
            current = nil
        } else {
            current = queue.removeFirst()
        }
    }
}
