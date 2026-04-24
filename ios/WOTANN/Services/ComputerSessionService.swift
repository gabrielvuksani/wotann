import Foundation
import Combine
import os.log

// MARK: - ComputerSessionService
//
// V9 T5.1 (F1) — iOS consumer for the `computer.session.events` RPC stream.
//
// The desktop daemon emits per-step lifecycle frames via
// `kairos-rpc.ts::computer.session.events` whenever an agent uses
// Computer Use. T1.1 wired the producer; this service wires the iOS
// consumer. RemoteDesktopView uses the published snapshots to render
// live session state (frames, step counts, cursor, approval prompts,
// session claims / releases).
//
// DESIGN NOTES
//
// - Quality bar #7 (per-session state): each instance owns its own
//   `sessionId` and `events` buffer. No module-global state — multiple
//   sessions can run concurrently if the user pairs two desktops.
// - Quality bar #6 (honest stubs): every RPC call that can fail throws
//   up to the caller; there is no silent-success path.
// - Quality bar #11 (sibling-site scan): this file is the SINGLE
//   RPC-subscription site for `computer.session.events`; other code
//   should observe `@Published` state here instead of re-subscribing.
//
// EVENT SHAPE
//
// Server frames look like
//   { "method": "computer.session.events",
//     "params": { "sessionId": "...", "type": "...", "payload": {...} } }
// Recognised types (mirrors `computer-session-store.ts`):
//   session-started, action-dispatched, action-result, action-error,
//   frame, cursor, session-claimed, session-released, heartbeat.
// Unknown types are logged and dropped (forward-compat).
//
// USAGE
//
//   let service = ComputerSessionService(rpcClient: rpc)
//   service.subscribe(sessionId: id)
//   // later
//   service.disconnect()
//
// Bounded buffer: the `events` array retains up to `maxRetainedEvents`
// entries. Older frames are dropped FIFO to avoid unbounded memory
// growth during long sessions.

/// Maximum events retained in `events` before dropping FIFO.
private let maxRetainedEvents = 500

/// Typed discriminated union representing a single lifecycle event.
enum ComputerSessionEvent: Equatable {
    case sessionStarted(sessionId: String, timestamp: Date)
    case actionDispatched(step: Int, action: String, timestamp: Date)
    case actionResult(step: Int, durationMs: Int, timestamp: Date)
    case actionError(step: Int, message: String, timestamp: Date)
    case frame(imageBase64: String, width: Int, height: Int, timestamp: Date)
    case cursor(x: Double, y: Double, timestamp: Date)
    case sessionClaimed(claimantId: String, timestamp: Date)
    case sessionReleased(reason: String, timestamp: Date)
    case heartbeat(timestamp: Date)

    var timestamp: Date {
        switch self {
        case .sessionStarted(_, let t),
             .actionDispatched(_, _, let t),
             .actionResult(_, _, let t),
             .actionError(_, _, let t),
             .frame(_, _, _, let t),
             .cursor(_, _, let t),
             .sessionClaimed(_, let t),
             .sessionReleased(_, let t),
             .heartbeat(let t):
            return t
        }
    }
}

/// Observable state for a single computer-use session subscription.
@MainActor
final class ComputerSessionService: ObservableObject {

    // Per-instance (NOT module-global) state — quality bar #7.
    @Published private(set) var events: [ComputerSessionEvent] = []
    @Published private(set) var isSubscribed: Bool = false
    @Published private(set) var lastFrame: (image: String, width: Int, height: Int)?
    @Published private(set) var cursorPosition: CGPoint?
    @Published private(set) var stepCount: Int = 0
    @Published private(set) var sessionStatus: SessionStatus = .idle
    @Published private(set) var errorMessage: String?

    /// The session this instance is tracking. `nil` until `subscribe` is
    /// called. Separate instances track separate sessions — never share.
    private(set) var sessionId: String?

    enum SessionStatus: Equatable {
        case idle
        case running
        case claimed(by: String)
        case released(reason: String)
        case failed(String)
    }

    private let rpcClient: RPCClient
    private static let log = Logger(
        subsystem: "com.wotann.ios",
        category: "ComputerSession"
    )

    init(rpcClient: RPCClient) {
        self.rpcClient = rpcClient
    }

    // MARK: Subscription

    /// Subscribe to a specific computer session's events. Calling twice
    /// with the same id is a no-op; calling with a new id tears down the
    /// old subscription and starts a fresh one.
    func subscribe(sessionId id: String) {
        if sessionId == id, isSubscribed { return }

        // Tear down prior state when switching sessions.
        if sessionId != nil {
            reset()
        }

        sessionId = id
        rpcClient.subscribe("computer.session.events") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleFrame(event)
            }
        }
        isSubscribed = true
        sessionStatus = .running
        Self.log.info("Subscribed to computer.session.events for id \(id, privacy: .public)")
    }

    /// Stop tracking the current session and drop all retained state.
    /// Safe to call when not subscribed.
    func disconnect() {
        guard isSubscribed else { return }
        // RPCClient currently does not expose unsubscribe; closing the
        // subscription requires a reconnect. We clear local state so
        // stale frames are ignored by `handleFrame` via sessionId check.
        reset()
        isSubscribed = false
        sessionStatus = .idle
    }

    // MARK: Actions

    /// Request to claim this session for the current device. Returns the
    /// server's response (claim granted or denied). Throws on transport
    /// error — the caller decides how to surface failure.
    func claimSession() async throws {
        guard let id = sessionId else {
            throw RPCError(code: -1, message: "No active session to claim")
        }
        _ = try await rpcClient.send("computer.session.claim", params: [
            "sessionId": .string(id),
        ])
    }

    /// Release the session so other devices can claim it. Throws on
    /// transport error.
    func releaseSession() async throws {
        guard let id = sessionId else { return }
        _ = try await rpcClient.send("computer.session.release", params: [
            "sessionId": .string(id),
        ])
    }

    // MARK: Frame Handling

    private func handleFrame(_ event: RPCEvent) {
        guard
            let obj = event.params?.objectValue,
            let frameSessionId = obj["sessionId"]?.stringValue
        else { return }

        // Drop events for other sessions — an RPCClient connection can
        // multiplex several sessions when the user has multiple desktops
        // paired. Only frames for our sessionId are relevant.
        guard frameSessionId == sessionId else { return }

        let type = obj["type"]?.stringValue ?? "unknown"
        let payload = obj["payload"]?.objectValue ?? [:]
        let timestamp = timestampFrom(obj["timestamp"]) ?? .now

        let parsedEvent: ComputerSessionEvent?
        switch type {
        case "session-started":
            parsedEvent = .sessionStarted(sessionId: frameSessionId, timestamp: timestamp)
            sessionStatus = .running

        case "action-dispatched":
            let step = payload["step"]?.intValue ?? stepCount + 1
            let action = payload["action"]?.stringValue ?? "unknown"
            stepCount = step
            parsedEvent = .actionDispatched(step: step, action: action, timestamp: timestamp)

        case "action-result":
            let step = payload["step"]?.intValue ?? stepCount
            let durationMs = payload["durationMs"]?.intValue ?? 0
            parsedEvent = .actionResult(step: step, durationMs: durationMs, timestamp: timestamp)

        case "action-error":
            let step = payload["step"]?.intValue ?? stepCount
            let message = payload["message"]?.stringValue ?? "Unknown error"
            errorMessage = message
            parsedEvent = .actionError(step: step, message: message, timestamp: timestamp)

        case "frame":
            guard let image = payload["image"]?.stringValue else {
                parsedEvent = nil
                break
            }
            let width = payload["width"]?.intValue ?? 0
            let height = payload["height"]?.intValue ?? 0
            lastFrame = (image, width, height)
            parsedEvent = .frame(imageBase64: image, width: width, height: height, timestamp: timestamp)

        case "cursor":
            let x = payload["x"]?.doubleValue ?? 0
            let y = payload["y"]?.doubleValue ?? 0
            cursorPosition = CGPoint(x: x, y: y)
            parsedEvent = .cursor(x: x, y: y, timestamp: timestamp)

        case "session-claimed":
            let by = payload["claimantId"]?.stringValue ?? "unknown"
            sessionStatus = .claimed(by: by)
            parsedEvent = .sessionClaimed(claimantId: by, timestamp: timestamp)

        case "session-released":
            let reason = payload["reason"]?.stringValue ?? "ended"
            sessionStatus = .released(reason: reason)
            parsedEvent = .sessionReleased(reason: reason, timestamp: timestamp)

        case "heartbeat":
            parsedEvent = .heartbeat(timestamp: timestamp)

        default:
            Self.log.info("Dropping unknown event type \(type, privacy: .public)")
            parsedEvent = nil
        }

        if let e = parsedEvent {
            appendEvent(e)
        }
    }

    private func appendEvent(_ event: ComputerSessionEvent) {
        events.append(event)
        // Keep the buffer bounded — drop oldest when exceeded.
        if events.count > maxRetainedEvents {
            events.removeFirst(events.count - maxRetainedEvents)
        }
    }

    private func reset() {
        events.removeAll()
        lastFrame = nil
        cursorPosition = nil
        stepCount = 0
        errorMessage = nil
        sessionStatus = .idle
        sessionId = nil
    }

    private func timestampFrom(_ value: RPCValue?) -> Date? {
        guard let value else { return nil }
        if let iso = value.stringValue,
           let parsed = ISO8601DateFormatter().date(from: iso) {
            return parsed
        }
        if let millis = value.intValue {
            return Date(timeIntervalSince1970: Double(millis) / 1000.0)
        }
        if let seconds = value.doubleValue {
            return Date(timeIntervalSince1970: seconds)
        }
        return nil
    }
}
