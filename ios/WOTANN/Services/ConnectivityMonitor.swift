import Foundation
import Network
import Observation
import os.log

// MARK: - ConnectivityMonitor
//
// S4-14. Central network-reachability monitor. Wraps `NWPathMonitor` so every
// RPC client can check one source of truth for "can I reach the desktop right
// now?" instead of each client re-implementing reachability or silently
// failing mid-flight.
//
// Two signals are published:
//
//  - `isConnected`   — `true` when the OS reports a usable path (any interface).
//  - `interface`     — the winning interface kind (wifi / cellular / ethernet).
//
// The monitor also exposes a retry queue. RPC clients that attempt to dispatch
// while offline can enqueue their work via `enqueueForRetry(_:)`. Queued items
// are drained in insertion order the first time `isConnected` flips to `true`
// after being `false`.
//
// Thread safety: `@MainActor` so every publish happens on the main queue.
// The NWPathMonitor itself runs on a dedicated serial queue so `NWPathMonitor`
// callbacks do not block the UI.
//
// V9 T14.3 — Migrated from ObservableObject + @Published to the iOS 17
// @Observable macro. The only consumer is `RPCClient` calling
// `ConnectivityMonitor.shared.assertConnected(...)` — no SwiftUI binding ever
// observed `$isConnected`, so the migration is strictly internal. QB #7
// (per-session state) is satisfied because there is exactly one network
// interface per process; the singleton is appropriate.

@MainActor
@Observable
final class ConnectivityMonitor {

    /// Process-wide singleton. RPC clients and the connection manager resolve
    /// connectivity through this instance so state is consistent everywhere.
    static let shared = ConnectivityMonitor()

    /// `true` when the OS reports a usable network path. SwiftUI can observe
    /// this via @Observable per-property tracking when consumers are wired in.
    private(set) var isConnected: Bool = true
    private(set) var interface: Interface = .unknown

    /// Kinds of interfaces we care about surfacing to callers. Mirrors the
    /// `NWInterface.InterfaceType` subset that matters for WOTANN.
    enum Interface: String {
        case wifi
        case cellular
        case ethernet
        case wired
        case loopback
        case other
        case unknown
    }

    /// Error raised by RPC clients when a dispatch is refused due to offline
    /// state. Callers surface this as a user-facing banner instead of
    /// swallowing it — aligns with the "honest offline error" bar.
    struct OfflineError: LocalizedError {
        let request: String
        var errorDescription: String? {
            "Offline — '\(request)' was queued for retry when the connection returns."
        }
    }

    // MARK: - Internals

    private static let log = Logger(subsystem: "com.wotann.ios", category: "Connectivity")
    @ObservationIgnored
    private let monitor = NWPathMonitor()
    @ObservationIgnored
    private let queue = DispatchQueue(label: "com.wotann.ConnectivityMonitor")

    /// FIFO queue of pending work to retry on reconnect. Each entry is
    /// captured with the method name so the failure surface can distinguish
    /// "send queued" from "send sent".
    @ObservationIgnored
    private var pendingQueue: [PendingWork] = []

    private struct PendingWork {
        let id: UUID
        let label: String
        let work: @Sendable () async -> Void
    }

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            let iface = resolveInterface(path)
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.applyPathUpdate(connected: connected, interface: iface)
            }
        }
        monitor.start(queue: queue)

        // Prime state from the current path so the first read is correct.
        let initial = monitor.currentPath
        self.isConnected = initial.status == .satisfied
        self.interface = resolveInterface(initial)
    }

    deinit {
        monitor.cancel()
    }

    // MARK: - Path Handling

    private func applyPathUpdate(connected: Bool, interface: Interface) {
        let wasConnected = self.isConnected
        self.isConnected = connected
        self.interface = interface

        if connected && !wasConnected {
            Self.log.info("connectivity restored on \(interface.rawValue, privacy: .public)")
            drainPendingQueue()
        } else if !connected && wasConnected {
            Self.log.info("connectivity lost")
        }
    }

    // MARK: - Public Helpers

    /// Precondition check for RPC dispatch. Callers use this to short-circuit
    /// before constructing an expensive request payload.
    func assertConnected(label: String = "RPC") throws {
        guard isConnected else {
            Self.log.error("assertConnected failed for \(label, privacy: .public)")
            throw OfflineError(request: label)
        }
    }

    /// Enqueue a piece of work to retry when connectivity returns. Returns
    /// the id so callers can surface "Queued as ABCD" or cancel the pending
    /// item if the user navigates away.
    @discardableResult
    func enqueueForRetry(
        label: String,
        work: @escaping @Sendable () async -> Void
    ) -> UUID {
        let id = UUID()
        pendingQueue.append(PendingWork(id: id, label: label, work: work))
        Self.log.info("queued '\(label, privacy: .public)' id=\(id.uuidString, privacy: .public)")
        return id
    }

    /// Remove a previously-queued item. No-op if the id was already drained.
    func cancelPending(_ id: UUID) {
        pendingQueue.removeAll { $0.id == id }
    }

    /// Current depth of the retry queue. Exposed for status chips.
    var pendingCount: Int { pendingQueue.count }

    // MARK: - Drain

    /// Drain every queued work item in FIFO order on a detached task so the
    /// monitor's publish-cycle stays non-blocking. Items that throw are
    /// discarded — they've already been surfaced to the caller via
    /// `OfflineError` when originally dispatched.
    private func drainPendingQueue() {
        guard !pendingQueue.isEmpty else { return }
        let snapshot = pendingQueue
        pendingQueue.removeAll()

        Task.detached {
            for item in snapshot {
                await item.work()
            }
        }
    }
}

// MARK: - Free Functions

/// Resolved outside the MainActor class so `NWPathMonitor`'s background
/// callback can call it without crossing actor boundaries.
private func resolveInterface(_ path: NWPath) -> ConnectivityMonitor.Interface {
    if path.usesInterfaceType(.wifi)          { return .wifi }
    if path.usesInterfaceType(.cellular)      { return .cellular }
    if path.usesInterfaceType(.wiredEthernet) { return .wired }
    if path.usesInterfaceType(.loopback)      { return .loopback }
    if path.usesInterfaceType(.other)         { return .other }
    return .unknown
}
