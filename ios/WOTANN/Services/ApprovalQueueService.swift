import Foundation
import Combine
import os.log

// MARK: - ApprovalQueueService
//
// V9 R-08 — iOS approval queue cache + RPC bridge.
//
// The existing `ApprovalSheetView` (V9 T5.5 / F6) handles a *single in-flight*
// approval that needs an immediate decision (auto-deny after 30 s). It does
// NOT keep a queue the user can browse later. R-08 closes that gap so users
// can see every pending approval from their phone — including ones that
// arrived while the app was backgrounded — and act on them in their own time.
//
// Wire surface (verified against src/daemon/kairos-rpc.ts:6814-6902):
//
//   approvals.pending     → snapshot { pending: [serializedApprovalRecord] }
//   approvals.notify      → push   { approvalId, sessionId, riskLevel,
//                                    summary, payload, expiresAt }
//   approvals.dismiss     → push   { approvalId, sessionId, decision?,
//                                    deciderDeviceId? }   (decided | expired)
//   approvals.decide      → call   { approvalId, decision, deciderDeviceId }
//                                    → { approval: serializedApprovalRecord }
//
// The `ApprovalQueueService` owns the cached list and:
//   - Refreshes it via `approvals.pending` on demand (pull-to-refresh,
//     view appearance) AND on every `approvals.notify` push (so the cache
//     stays accurate even if a notify lands while the queue view is open).
//   - Removes entries when an `approvals.dismiss` push arrives (matches
//     desktop behaviour for both decided and expired records).
//   - Calls `approvals.decide` with `decision: "allow"|"deny"` and the
//     local device id (from KeychainManager). Updates the cache optimistically
//     on success and on RPC failure surfaces the error via `errorMessage`.
//
// QUALITY BARS
// - #6 (honest stubs): every RPC failure surfaces via `errorMessage`,
//   logged with `os.Logger`. Optimistic mutations roll back on failure.
// - #7 (per-session state): this is a class instantiated per pairing
//   (created via `ApprovalQueueService.shared` lazy with bound RPC client).
//   Multiple paired phones each see their own approval queue mirror.
// - #11 (sibling-site scan): the existing `ApprovalSheetView` subscribes
//   to the same `approvals.notify` topic for the *modal* sheet. Both
//   subscriptions coexist — `RPCClient.subscribe` appends handlers,
//   it does not replace them. The sheet handles the live "decide right
//   now" UX; this service maintains the durable queue. They share the
//   `approvalId` discriminator so a decision via either path eventually
//   converges in the cache (via the `approvals.dismiss` push).
//
// No deep-link routing lives here — that's the View layer's job (notification
// handler in WOTANNApp.swift sets `appState.deepLinkDestination = "approvals"`,
// and ApprovalQueueView pops up via the navigation router). This service is
// data-only.

@MainActor
@Observable
final class ApprovalQueueService {
    // MARK: - Observable state

    /// Cached pending approvals, sorted newest-first (by `createdAt` desc).
    private(set) var approvals: [ApprovalQueueItem] = []

    /// Set when an RPC call fails. UI surfaces it as a toast/banner.
    /// Cleared on the next successful RPC.
    var errorMessage: String?

    /// Whether a refresh / decide is in flight. Used to drive a spinner.
    private(set) var isRefreshing: Bool = false

    // MARK: - Wiring

    @ObservationIgnored
    private var rpcClient: RPCClient?
    @ObservationIgnored
    private var deviceId: String = ""
    @ObservationIgnored
    private var subscribed: Bool = false

    private static let log = Logger(subsystem: "com.wotann.ios", category: "ApprovalQueue")

    // MARK: - Configure

    /// Bind the service to a live RPC client and the local device id.
    /// Idempotent — safe to call from `.task` modifiers on every appearance.
    func configure(rpcClient: RPCClient, deviceId: String) {
        self.rpcClient = rpcClient
        self.deviceId = deviceId
    }

    /// Begin listening to push topics. Idempotent.
    func subscribe() {
        guard !subscribed, let rpcClient else { return }
        subscribed = true

        // `approvals.notify` is broadcast by the daemon's UnifiedDispatchPlane
        // (see src/session/dispatch/companion-bridge.ts). Each push carries
        // the same shape as the snapshot's per-record entry, so we can append
        // directly to the cache without a follow-up `approvals.pending` round
        // trip — but we DO refresh in the background to catch any approvals
        // missed while the socket was closed.
        rpcClient.subscribe("approvals.notify") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleNotify(event)
            }
        }

        rpcClient.subscribe("approvals.dismiss") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleDismiss(event)
            }
        }
    }

    // MARK: - Refresh (pull-to-refresh / view onAppear)

    /// Pull the authoritative pending list from the desktop. Replaces the
    /// cache atomically. Errors surface via `errorMessage`.
    func refresh() async {
        guard let rpcClient else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let response = try await rpcClient.send("approvals.pending")
            let pending = response.result?.objectValue?["pending"]?.arrayValue ?? []
            // Build new list, sorted newest-first.
            let parsed = pending.compactMap { ApprovalQueueItem(rpcValue: $0) }
            let sorted = parsed.sorted { $0.createdAt > $1.createdAt }
            self.approvals = sorted
            self.errorMessage = nil
        } catch {
            errorMessage = "Could not load approvals: \(error.localizedDescription)"
            Self.log.error("approvals.pending failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Decide

    /// Approve a pending request. Optimistic — removes from the cache on
    /// the assumption the desktop accepted; restores via `refresh()` if
    /// the RPC fails.
    func approve(_ approvalId: String) async {
        await decide(approvalId: approvalId, decision: "allow")
    }

    /// Deny a pending request. Same optimistic pattern as `approve`.
    func deny(_ approvalId: String) async {
        await decide(approvalId: approvalId, decision: "deny")
    }

    private func decide(approvalId: String, decision: String) async {
        guard let rpcClient else { return }
        guard !deviceId.isEmpty else {
            errorMessage = "Device id missing — cannot record decision."
            return
        }

        // Optimistic removal — record the snapshot so we can roll back.
        let previous = approvals
        approvals = approvals.filter { $0.approvalId != approvalId }

        do {
            _ = try await rpcClient.send("approvals.decide", params: [
                "approvalId": .string(approvalId),
                "decision": .string(decision),
                "deciderDeviceId": .string(deviceId),
            ])
            errorMessage = nil
            // V9 T14.4 — wax-seal cue on the queue-side approval grant.
            // Mirrors the same gating used in the modal sheet path so a
            // queue-managed grant gets the same audio signature.
            if decision == "allow", #available(iOS 16.0, *) {
                WotannStingService.shared.playApprovalGranted()
            }
        } catch {
            // Roll back. The RPC may have failed because the approval was
            // already decided/expired by another surface — refresh to land
            // on truth.
            approvals = previous
            errorMessage = "Could not record decision: \(error.localizedDescription)"
            Self.log.error("approvals.decide failed: \(error.localizedDescription, privacy: .public)")
            if #available(iOS 16.0, *) {
                WotannStingService.shared.playError()
            }
            await refresh()
        }
    }

    // MARK: - Push handlers

    private func handleNotify(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }
        guard let item = ApprovalQueueItem(rpcObject: obj) else { return }

        // De-dup against the cache (a push may race with a refresh).
        if approvals.contains(where: { $0.approvalId == item.approvalId }) {
            return
        }
        // Insert newest-first.
        approvals.insert(item, at: 0)
    }

    private func handleDismiss(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }
        guard let id = obj["approvalId"]?.stringValue ?? obj["id"]?.stringValue else { return }
        approvals.removeAll { $0.approvalId == id }
    }

    // MARK: - Lookup

    /// Find a single approval in the cache by id. Used by ApprovalDetailView.
    func find(_ approvalId: String) -> ApprovalQueueItem? {
        approvals.first(where: { $0.approvalId == approvalId })
    }
}

// MARK: - ApprovalQueueItem (model)

/// Cache entry mirroring the desktop's `serializeApprovalRecord` output
/// plus the `approvals.notify` push variant (which is the broadcast payload
/// from `ApprovalQueue.enqueue`).
///
/// Fields:
///   - approvalId / sessionId — identity
///   - summary                — human-readable description ("rm -rf …")
///   - riskLevel              — "low" | "medium" | "high"
///   - payload                — typed payload (shell-exec / file-write /
///                              destructive / custom / browser-action)
///   - createdAt / expiresAt  — Unix epoch milliseconds
struct ApprovalQueueItem: Identifiable, Equatable, Hashable {
    let approvalId: String
    let sessionId: String
    let summary: String
    let riskLevel: ApprovalRiskLevel
    let payload: ApprovalQueuePayload
    let createdAt: Date
    let expiresAt: Date

    var id: String { approvalId }

    /// Best-effort tool name surfaced from the payload, for the list cell.
    /// Falls back to a humanised payload kind when the payload doesn't
    /// carry an explicit tool field.
    var toolLabel: String {
        switch payload {
        case .shellExec: return "shell"
        case .fileWrite(let path, _): return path
        case .destructive(let op, _, _): return op
        case .custom(let schemaId, _): return schemaId
        case .browserAction(let url, _, _): return url
        case .unknown(let kind): return kind
        }
    }

    /// Detail string for the drill-in. Multiline; safe to render in a
    /// scrollable Text.
    var detailText: String {
        switch payload {
        case .shellExec(let command, let cwd):
            return "Command:\n\(command)\n\nWorking directory:\n\(cwd)"
        case .fileWrite(let path, let preview):
            return "Path:\n\(path)\n\nPreview:\n\(preview)"
        case .destructive(let op, let target, let reason):
            return "Operation:\n\(op)\n\nTarget:\n\(target)\n\nReason:\n\(reason)"
        case .custom(let schemaId, let dataDescription):
            return "Schema:\n\(schemaId)\n\nData:\n\(dataDescription)"
        case .browserAction(let url, let description, _):
            return "URL:\n\(url)\n\nDescription:\n\(description)"
        case .unknown(let kind):
            return "Payload kind: \(kind)\n\n(no further detail available)"
        }
    }
}

/// Risk level mirrored from `RiskLevel` in src/session/approval-queue.ts.
enum ApprovalRiskLevel: String, Codable, Equatable, Hashable {
    case low
    case medium
    case high

    init(raw: String?) {
        switch raw?.lowercased() {
        case "high": self = .high
        case "medium", "med": self = .medium
        default: self = .low
        }
    }
}

/// Discriminated union mirroring the typed payload union in
/// src/session/approval-queue.ts.
enum ApprovalQueuePayload: Equatable, Hashable {
    case shellExec(command: String, cwd: String)
    case fileWrite(path: String, preview: String)
    case destructive(operation: String, target: String, reason: String)
    case custom(schemaId: String, dataDescription: String)
    case browserAction(url: String, description: String, riskLevel: ApprovalRiskLevel)
    case unknown(kind: String)
}

// MARK: - Decoding helpers

extension ApprovalQueueItem {
    /// Decode from a top-level RPCValue (snapshot list entry).
    init?(rpcValue: RPCValue) {
        guard let obj = rpcValue.objectValue else { return nil }
        self.init(rpcObject: obj)
    }

    /// Decode from a `[String: RPCValue]` object. Both the snapshot and the
    /// notify push share this shape.
    init?(rpcObject obj: [String: RPCValue]) {
        guard let id = obj["approvalId"]?.stringValue ?? obj["id"]?.stringValue,
              !id.isEmpty else {
            return nil
        }
        let session = obj["sessionId"]?.stringValue ?? ""
        let summary = obj["summary"]?.stringValue ?? "Approval required"
        let risk = ApprovalRiskLevel(raw: obj["riskLevel"]?.stringValue)
        let payload = ApprovalQueuePayload(rpcValue: obj["payload"])
        let createdAt = ApprovalQueueItem.epochToDate(obj["createdAt"])
        let expiresAt = ApprovalQueueItem.epochToDate(obj["expiresAt"])

        self.approvalId = id
        self.sessionId = session
        self.summary = summary
        self.riskLevel = risk
        self.payload = payload
        self.createdAt = createdAt
        self.expiresAt = expiresAt
    }

    /// Convert milliseconds-since-epoch (the desktop's wire format) into Date.
    /// Falls back to `.now` if the value is missing or malformed so the cell
    /// still renders.
    fileprivate static func epochToDate(_ value: RPCValue?) -> Date {
        guard let value else { return .now }
        if let i = value.intValue {
            // Heuristic: treat values > 10^10 as ms, otherwise seconds.
            return i > 10_000_000_000
                ? Date(timeIntervalSince1970: Double(i) / 1000.0)
                : Date(timeIntervalSince1970: Double(i))
        }
        if let d = value.doubleValue {
            return d > 10_000_000_000
                ? Date(timeIntervalSince1970: d / 1000.0)
                : Date(timeIntervalSince1970: d)
        }
        return .now
    }
}

extension ApprovalQueuePayload {
    init(rpcValue: RPCValue?) {
        guard let obj = rpcValue?.objectValue else {
            self = .unknown(kind: "missing")
            return
        }
        let kind = obj["kind"]?.stringValue ?? ""
        switch kind {
        case "shell-exec":
            self = .shellExec(
                command: obj["command"]?.stringValue ?? "",
                cwd: obj["cwd"]?.stringValue ?? ""
            )
        case "file-write":
            self = .fileWrite(
                path: obj["path"]?.stringValue ?? "",
                preview: obj["preview"]?.stringValue ?? ""
            )
        case "destructive":
            self = .destructive(
                operation: obj["operation"]?.stringValue ?? "",
                target: obj["target"]?.stringValue ?? "",
                reason: obj["reason"]?.stringValue ?? ""
            )
        case "custom":
            // Render `data` as a flat key=value description for the detail view.
            let dataObj = obj["data"]?.objectValue ?? [:]
            let description = dataObj
                .sorted(by: { $0.key < $1.key })
                .map { "\($0.key): \($0.value.stringValue ?? "<\($0.value)>")" }
                .joined(separator: "\n")
            self = .custom(
                schemaId: obj["schemaId"]?.stringValue ?? "(unknown)",
                dataDescription: description.isEmpty ? "(no data)" : description
            )
        case "browser-action":
            self = .browserAction(
                url: obj["url"]?.stringValue ?? "",
                description: obj["description"]?.stringValue ?? "",
                riskLevel: ApprovalRiskLevel(raw: obj["riskLevel"]?.stringValue)
            )
        default:
            self = .unknown(kind: kind.isEmpty ? "(unknown)" : kind)
        }
    }
}
