import Foundation
import Combine
import WatchConnectivity
#if canImport(ClockKit)
import ClockKit
#endif
#if canImport(WidgetKit)
import WidgetKit
#endif
import os.log

// MARK: - WatchService
//
// V9 T5.9 (F12) — watchOS-side consumer for
// `watch.dispatch.subscribe`. Because watchOS does not have direct
// access to the desktop WebSocket, we forward subscription requests
// through the paired iPhone via WatchConnectivity. The iPhone's
// `PhoneWCSessionDelegate` forwards RPC frames back here as
// WCSession messages keyed on `"dispatch"`.
//
// QUALITY BARS
// - #6 (honest stubs): errors from WCSession are logged to stdout
//   and exposed via `errorMessage` — never swallowed.
// - #7 (per-session state): each `WatchService` instance holds its
//   own `dispatches` buffer. The watch app has one instance tied
//   to the root view; nothing is module-global.

@MainActor
final class WatchService: ObservableObject {

    @Published private(set) var dispatches: [WatchDispatch] = []
    @Published var errorMessage: String?

    private weak var phoneSession: PhoneSessionDelegate?
    private var cancellables = Set<AnyCancellable>()
    private var isSubscribed = false
    private static let log = Logger(subsystem: "com.wotann.watch", category: "Dispatch")

    // MARK: - Start / Stop

    /// Begin listening for dispatch updates from the iPhone. The
    /// iPhone relays frames for `watch.dispatch.subscribe` and
    /// `watch.dispatch.update` via WCSession application-context
    /// messages. Idempotent.
    func start(phoneSession: PhoneSessionDelegate) {
        guard !isSubscribed else { return }
        isSubscribed = true
        self.phoneSession = phoneSession

        // Ask iPhone to turn on the dispatch subscription.
        phoneSession.requestWatchDispatchSubscription()

        // Observe the phoneSession's `agents` array — the iPhone
        // currently forwards agent status through `agents`. When a
        // dedicated dispatches channel lands on the phone side, the
        // binding below will pick it up without changes here.
        phoneSession.$agents
            .receive(on: DispatchQueue.main)
            .sink { [weak self] agents in
                self?.applyAgents(agents)
            }
            .store(in: &cancellables)

        phoneSession.$lastError
            .receive(on: DispatchQueue.main)
            .sink { [weak self] error in
                if let error, !error.isEmpty {
                    self?.errorMessage = error
                } else {
                    self?.errorMessage = nil
                }
            }
            .store(in: &cancellables)
    }

    /// Tear down the subscription and clear retained state so another
    /// `start` call wires up fresh.
    func stop() {
        cancellables.removeAll()
        isSubscribed = false
        phoneSession?.stopWatchDispatchSubscription()
        phoneSession = nil
    }

    // MARK: - Launch iPhone

    /// Ask the iPhone to open the WOTANN app at the given dispatch.
    /// Uses WCSession messaging — no direct Handoff activity from
    /// watchOS to iOS is available without the companion app.
    func launchiPhone(for dispatch: WatchDispatch) {
        phoneSession?.launchiPhoneApp(dispatchId: dispatch.id)
        // Re-request an update so the phone publishes the current
        // state into the dispatch list as soon as the app launches.
        phoneSession?.requestUpdate()
    }

    // MARK: - Agent → Dispatch Mapping

    private func applyAgents(_ agents: [WatchAgent]) {
        dispatches = agents.map { agent in
            WatchDispatch(
                id: agent.id.uuidString,
                title: agent.name,
                status: agent.status,
                progress: agent.progress,
                cost: agent.cost
            )
        }

        // Smart Stack relevance: when any dispatch is running, bump
        // the widget relevance so watchOS 10+ surfaces the widget on
        // the Smart Stack.
        updateSmartStackRelevance()
    }

    private func updateSmartStackRelevance() {
        let hasRunning = dispatches.contains(where: \.isRunning)
        #if canImport(WidgetKit)
        // iOS 17 / watchOS 10+: request a timeline reload when the
        // running state changes. The widget's TimelineEntry uses
        // `RelevantContext` to raise its Smart Stack score.
        WidgetCenter.shared.reloadTimelines(ofKind: "WOTANNWatchDispatchWidget")
        #endif
        Self.log.info("Smart Stack relevance \(hasRunning ? "raised" : "lowered", privacy: .public)")
    }
}

// MARK: - Phone ↔ Watch Messaging
//
// These helpers attach to `PhoneSessionDelegate` (defined in
// WOTANNWatchApp.swift). We extend it here so WatchService can ask
// the iPhone to subscribe/unsubscribe/launch without pulling all
// subscription handling into the app-root file.

extension PhoneSessionDelegate {
    /// Send a request to the iPhone to activate the
    /// `watch.dispatch.subscribe` RPC stream. The iPhone handles the
    /// actual WebSocket subscription (watchOS cannot keep a socket
    /// alive reliably).
    func requestWatchDispatchSubscription() {
        sendRequest(["action": "watch.dispatch.subscribe"])
    }

    /// Ask the iPhone to drop the dispatch subscription.
    func stopWatchDispatchSubscription() {
        sendRequest(["action": "watch.dispatch.unsubscribe"])
    }

    /// Open the WOTANN iPhone app at a specific dispatch id. Uses
    /// WCSession messaging as the signal; the iOS AppDelegate routes
    /// on receipt.
    func launchiPhoneApp(dispatchId: String) {
        sendRequest([
            "action": "launchApp",
            "dispatchId": dispatchId,
        ])
    }

    /// Internal best-effort WCSession message sender that never
    /// surfaces transport errors to the UI — WatchService already
    /// shows the existing `lastError` property via its binding.
    private func sendRequest(_ payload: [String: Any]) {
        guard WCSession.default.isReachable else {
            Task { @MainActor in
                self.lastError = "iPhone not reachable"
            }
            return
        }
        WCSession.default.sendMessage(payload, replyHandler: nil) { [weak self] error in
            Task { @MainActor in
                self?.lastError = error.localizedDescription
            }
        }
    }
}
