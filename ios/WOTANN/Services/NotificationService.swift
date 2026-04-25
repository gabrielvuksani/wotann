import Foundation
import UIKit
import os.log
import UserNotifications

#if canImport(PushKit)
import PushKit
#endif

// MARK: - NotificationService

/// Schedules local notifications for task completion, errors, and budget
/// alerts; owns APNs and VoIP-push registration for Handoff resume.
///
/// V9 T14.3 — Push registration:
///   - Standard APNs for routine remote notifications. The device token
///     is forwarded to the paired desktop daemon via the
///     `device.registerAPNsToken` RPC so the daemon can target this
///     device when fanning out task-completion / approval pushes.
///   - PushKit (VoIP class) for high-priority *Handoff resume* pushes.
///     VoIP pushes wake the app even from suspended state, which is
///     what Handoff resume needs to re-attach a chat session quickly.
///
/// Honest stubs: if APNs entitlements or the PushKit framework are
/// unavailable in the current build (e.g. simulator with no APNs
/// sandbox, or an extension target missing the push entitlement) we
/// log + skip rather than crash. The user-visible notification surface
/// keeps working through `UNUserNotificationCenter`.
@MainActor
final class NotificationService: NSObject {
    static let shared = NotificationService()

    private let center = UNUserNotificationCenter.current()

    /// Last error encountered while wiring `delivery.subscribe`. Surfaced
    /// for diagnostics screens — never silent (quality bar #6 honest stubs).
    private(set) var subscribeError: String?

    /// True once the delivery push subscription is wired to a paired
    /// desktop. Idempotent so re-pairing or re-rendering a settings
    /// screen does not double-subscribe (quality bar #11 sibling-site
    /// scan: this is the SINGLE site on iOS subscribing to
    /// `delivery.subscribe`).
    private var deliverySubscribed = false

    /// Weak ref to the RPC client we own a subscription against. Held
    /// weak because the connection manager outlives any individual
    /// session and we never want this manager to retain the client.
    private weak var rpcClient: RPCClient?

    /// Last-observed APNs device token (lowercase hex). Cached so a
    /// daemon reconnect can re-send the registration without waiting
    /// for iOS to re-issue the token. Per-instance, no module-global.
    private(set) var apnsTokenHex: String?

    /// Last-observed VoIP-push token. See `apnsTokenHex` for rationale.
    private(set) var voipTokenHex: String?

    /// Last error from APNs registration, surfaced for diagnostics.
    private(set) var apnsRegistrationError: String?

    #if canImport(PushKit)
    /// Held strong so the PushKit delegate is not garbage-collected.
    /// Per-instance — each `NotificationService` instance owns its own
    /// registry. We never construct more than one in production
    /// because `shared` is a singleton, but tests can construct
    /// throwaway instances without leaking the registry.
    private var pushRegistry: PKPushRegistry?
    #endif

    private static let log = Logger(subsystem: "com.wotann.ios", category: "Notifications")

    private override init() {
        super.init()
    }

    // MARK: - Permission

    func requestPermission() async -> Bool {
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            return granted
        } catch {
            return false
        }
    }

    // MARK: - APNs Registration (V9 T14.3)

    /// Kick off APNs registration. Safe to call from
    /// `application(_:didFinishLaunchingWithOptions:)` — the token (or
    /// failure) arrives asynchronously on the `AppDelegate`, which
    /// forwards it to `handleAPNsToken(_:)` /
    /// `handleAPNsRegistrationFailure(_:)`.
    ///
    /// Also registers for VoIP-class pushes (Handoff resume) if
    /// PushKit is available. Both registrations are honest stubs: a
    /// build missing the push entitlements logs and continues.
    func registerForRemoteNotifications() {
        UIApplication.shared.registerForRemoteNotifications()
        Self.log.info("Requested APNs registration")
        registerForVoIPPushesIfAvailable()
    }

    /// Called from `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)`.
    /// Encodes the binary token to lowercase hex (the format APNs
    /// servers and our desktop daemon both expect) and forwards it to
    /// the paired desktop via the `device.registerAPNsToken` RPC.
    ///
    /// QUALITY BARS:
    /// - #6 (honest stubs): a missing daemon connection logs + skips
    ///   instead of crashing. The cached `apnsTokenHex` lets a
    ///   reconnect retry the forward without iOS re-issuing.
    /// - #7 (per-session state): the token cache lives on the
    ///   instance, not on a module-global.
    func handleAPNsToken(_ deviceToken: Data) {
        let hex = Self.hexString(from: deviceToken)
        self.apnsTokenHex = hex
        self.apnsRegistrationError = nil
        Self.log.info("APNs registration succeeded; token \(hex.prefix(8), privacy: .public)…")
        Task { [weak self] in
            await self?.dispatchTokenToDaemon(hex: hex, kind: "apns")
        }
    }

    /// Called from
    /// `application(_:didFailToRegisterForRemoteNotificationsWithError:)`.
    /// We log and continue — local notifications still work without
    /// APNs, so the app remains functional. Honest stub: the failure
    /// is surfaced through `apnsRegistrationError` for any
    /// diagnostics screen rather than silently swallowed.
    func handleAPNsRegistrationFailure(_ error: Error) {
        let message = error.localizedDescription
        self.apnsRegistrationError = message
        Self.log.error("APNs registration failed: \(message, privacy: .public)")
    }

    /// Decode an incoming remote notification payload, surface a local
    /// notification mirror to the user, and broadcast a route hint via
    /// `NotificationCenter` so the active scene can deep-link if it
    /// chooses. The payload shape follows our daemon's convention:
    ///
    ///     { "aps": { "alert": "...", "sound": "default" },
    ///       "wotann": { "route": "wotann://chat?id=...",
    ///                   "show": true,
    ///                   "category": "TASK_COMPLETE" } }
    ///
    /// - Parameter userInfo: The full APS payload from
    ///   `application(_:didReceiveRemoteNotification:fetchCompletionHandler:)`
    ///   or a PushKit VoIP push.
    func handleRemoteNotification(userInfo: [AnyHashable: Any]) {
        let wotannBlock = userInfo["wotann"] as? [String: Any] ?? [:]
        let route = (wotannBlock["route"] as? String) ?? ""
        let show = (wotannBlock["show"] as? Bool) ?? true
        let category = (wotannBlock["category"] as? String) ?? "REMOTE_NOTIFICATION"

        if !route.isEmpty {
            // Post on the main actor (we're already @MainActor) so any
            // subscriber on AppState can mutate `@Published` properties
            // without crossing actor boundaries.
            NotificationCenter.default.post(
                name: .wotannRemoteRoute,
                object: nil,
                userInfo: ["route": route, "category": category]
            )
            Self.log.info("Remote notification routed: \(route, privacy: .public)")
        }

        guard show else { return }

        let aps = userInfo["aps"] as? [String: Any] ?? [:]
        let alertObject = aps["alert"]
        let bodyText: String
        let titleText: String
        if let dict = alertObject as? [String: Any] {
            titleText = (dict["title"] as? String) ?? "WOTANN"
            bodyText = (dict["body"] as? String) ?? ""
        } else if let plain = alertObject as? String {
            titleText = "WOTANN"
            bodyText = plain
        } else {
            titleText = "WOTANN"
            bodyText = ""
        }

        let content = UNMutableNotificationContent()
        content.title = titleText
        content.body = bodyText
        content.sound = .default
        content.categoryIdentifier = category
        // Preserve userInfo as best-effort dictionary; APS keys remain
        // accessible for later inspection from notification handlers.
        var info: [AnyHashable: Any] = userInfo
        info["wotannRoute"] = route
        content.userInfo = info

        let request = UNNotificationRequest(
            identifier: "remote-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        center.add(request) { error in
            if let error {
                Task { @MainActor in
                    Self.log.error(
                        "remote notification add failed: \(error.localizedDescription, privacy: .public)"
                    )
                }
            }
        }
    }

    // MARK: - VoIP Push Registration (V9 T14.3 — Handoff resume)

    /// Register for VoIP-class pushes. VoIP pushes wake the app even
    /// from suspended state, which is what Handoff resume needs:
    /// when the user picks up where they left off on a paired device,
    /// the daemon emits a high-priority push and we re-attach the
    /// session before the user even opens the app.
    ///
    /// Honest stub: a target without the `voip` background mode
    /// entitlement still gets here without crashing — iOS will simply
    /// not deliver any pushes.
    private func registerForVoIPPushesIfAvailable() {
        #if canImport(PushKit)
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        self.pushRegistry = registry
        Self.log.info("Requested VoIP push registration")
        #else
        Self.log.info("PushKit unavailable — VoIP-push (Handoff resume) skipped")
        #endif
    }

    // MARK: - Daemon Forwarding

    /// Forward a freshly-issued push token to the desktop daemon.
    /// Reuses the already-attached `RPCClient` (set via `attachRPC`)
    /// so we never duplicate the connection-manager lookup logic.
    ///
    /// Honest stub: if no client has been attached yet (e.g. APNs
    /// registers before pairing completes) we skip the send. The
    /// cached token lets a `re-send-on-pair` path retry later.
    private func dispatchTokenToDaemon(hex: String, kind: String) async {
        guard let client = rpcClient else {
            Self.log.info(
                "Skipped \(kind, privacy: .public) token forward: no RPC client attached"
            )
            return
        }
        do {
            _ = try await client.send("device.registerAPNsToken", params: [
                "token": .string(hex),
                "kind": .string(kind),
            ])
            Self.log.info("Forwarded \(kind, privacy: .public) token to daemon")
        } catch {
            Self.log.error(
                "Failed to forward \(kind, privacy: .public) token: \(error.localizedDescription, privacy: .public)"
            )
        }
    }

    /// Encode raw token bytes as lowercase hex — the format APNs
    /// providers and our desktop daemon both expect.
    private static func hexString(from data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    // MARK: - Schedule

    func notifyTaskComplete(title: String, taskId: UUID) {
        let content = UNMutableNotificationContent()
        content.title = "Task Complete"
        content.body = title
        content.sound = .default
        content.categoryIdentifier = "TASK_COMPLETE"
        content.userInfo = ["taskId": taskId.uuidString]

        let request = UNNotificationRequest(
            identifier: "task-\(taskId.uuidString)",
            content: content,
            trigger: nil  // Deliver immediately
        )
        center.add(request)
    }

    func notifyTaskFailed(title: String, error: String, taskId: UUID) {
        let content = UNMutableNotificationContent()
        content.title = "Task Failed"
        content.body = "\(title): \(error)"
        content.sound = .defaultCritical
        content.categoryIdentifier = "TASK_FAILED"
        content.userInfo = ["taskId": taskId.uuidString]

        let request = UNNotificationRequest(
            identifier: "task-fail-\(taskId.uuidString)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }

    func notifyApprovalRequired(title: String, taskId: UUID) {
        let content = UNMutableNotificationContent()
        content.title = "Approval Required"
        content.body = title
        content.sound = .default
        content.categoryIdentifier = "APPROVAL_REQUIRED"
        content.userInfo = ["taskId": taskId.uuidString]

        let approveAction = UNNotificationAction(identifier: "APPROVE", title: "Approve", options: [])
        let rejectAction = UNNotificationAction(identifier: "REJECT", title: "Reject", options: [.destructive])
        let category = UNNotificationCategory(
            identifier: "APPROVAL_REQUIRED",
            actions: [approveAction, rejectAction],
            intentIdentifiers: []
        )
        center.setNotificationCategories([category])

        let request = UNNotificationRequest(
            identifier: "approval-\(taskId.uuidString)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }

    func notifyBudgetAlert(spent: Double, budget: Double) {
        let percent = Int((spent / budget) * 100)
        let content = UNMutableNotificationContent()
        content.title = "Budget Alert"
        content.body = "You've used \(percent)% of your weekly budget ($\(String(format: "%.2f", spent)) / $\(String(format: "%.2f", budget)))"
        content.sound = .default
        content.categoryIdentifier = "BUDGET_ALERT"

        let request = UNNotificationRequest(
            identifier: "budget-alert",
            content: content,
            trigger: nil
        )
        center.add(request)
    }

    // MARK: - Category Registration

    /// Update which notification categories are registered based on user preferences.
    /// Call whenever a notification toggle changes in Settings.
    func updateCategories(
        taskComplete: Bool,
        errors: Bool,
        budgetAlerts: Bool,
        approvalRequests: Bool
    ) {
        var categories = Set<UNNotificationCategory>()

        if taskComplete {
            categories.insert(UNNotificationCategory(
                identifier: "TASK_COMPLETE",
                actions: [],
                intentIdentifiers: []
            ))
        }

        if errors {
            categories.insert(UNNotificationCategory(
                identifier: "TASK_FAILED",
                actions: [],
                intentIdentifiers: []
            ))
        }

        if budgetAlerts {
            categories.insert(UNNotificationCategory(
                identifier: "BUDGET_ALERT",
                actions: [],
                intentIdentifiers: []
            ))
        }

        if approvalRequests {
            let approveAction = UNNotificationAction(identifier: "APPROVE", title: "Approve", options: [])
            let rejectAction = UNNotificationAction(identifier: "REJECT", title: "Reject", options: [.destructive])
            categories.insert(UNNotificationCategory(
                identifier: "APPROVAL_REQUIRED",
                actions: [approveAction, rejectAction],
                intentIdentifiers: []
            ))
        }

        center.setNotificationCategories(categories)
    }

    // MARK: - Clear

    func clearAll() {
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    // MARK: - RPC Subscription (T5.7)

    /// Wire this service to a paired desktop's RPC client and subscribe to
    /// `delivery.subscribe` so the daemon can push a UNUserNotification
    /// whenever a Creation is ready for download. Idempotent — calling
    /// twice with the same client is a no-op.
    ///
    /// QUALITY BARS:
    /// - #6 (honest stubs): seed-call errors surface via `subscribeError`.
    /// - #7 (per-session state): subscription state lives on the
    ///   instance, not on a module-global.
    /// - #11 (sibling-site scan): this method is the SINGLE site on iOS
    ///   subscribing to `delivery.subscribe`.
    func attachRPC(_ client: RPCClient) {
        guard !deliverySubscribed else { return }
        if rpcClient === client { return }
        rpcClient = client
        deliverySubscribed = true

        Task { [weak self, weak client] in
            guard let client else { return }
            do {
                _ = try await client.send("delivery.subscribe")
                await MainActor.run { self?.subscribeError = nil }
            } catch {
                await MainActor.run {
                    self?.subscribeError = "delivery.subscribe failed: \(error.localizedDescription)"
                    Self.log.error(
                        "delivery.subscribe seed failed: \(error.localizedDescription, privacy: .public)"
                    )
                }
            }
        }

        client.subscribe("delivery") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleDeliveryEvent(event)
            }
        }

        // Re-flush any cached push tokens now that we have a live RPC
        // client. This is the recovery path for the common race where
        // APNs/PushKit issues a token *before* pairing completes.
        // Honest stub: if no token is cached yet we no-op.
        if let cachedAPNs = apnsTokenHex {
            Task { [weak self] in
                await self?.dispatchTokenToDaemon(hex: cachedAPNs, kind: "apns")
            }
        }
        if let cachedVoIP = voipTokenHex {
            Task { [weak self] in
                await self?.dispatchTokenToDaemon(hex: cachedVoIP, kind: "voip")
            }
        }
    }

    /// Translate a daemon `delivery` push event into a UNUserNotification.
    /// Schema (best-effort decode — the daemon's `DeliveryEvent` shape):
    ///
    ///   { type: "ready" | "acknowledged" | "expired",
    ///     deliveryId: String,
    ///     filename:   String,
    ///     displayName: String?,
    ///     description: String?,
    ///     sessionId:  String? }
    ///
    /// Only `type=ready` produces a user-facing notification; the other
    /// types are operational signals consumed by other services.
    private func handleDeliveryEvent(_ event: RPCEvent) {
        guard let obj = event.params?.objectValue else { return }
        let type = obj["type"]?.stringValue ?? "ready"
        guard type == "ready" else { return }

        let deliveryId = obj["deliveryId"]?.stringValue
            ?? obj["id"]?.stringValue
            ?? UUID().uuidString
        let filename = obj["filename"]?.stringValue ?? ""
        let displayName = obj["displayName"]?.stringValue ?? filename
        let description = obj["description"]?.stringValue ?? "A new file is ready to download."
        let sessionId = obj["sessionId"]?.stringValue ?? ""

        let content = UNMutableNotificationContent()
        content.title = displayName.isEmpty ? "File Ready" : displayName
        content.body = description
        content.sound = .default
        content.categoryIdentifier = "DELIVERY_READY"
        var info: [AnyHashable: Any] = [
            "deliveryId": deliveryId,
            "filename": filename,
        ]
        if !sessionId.isEmpty {
            info["sessionId"] = sessionId
        }
        content.userInfo = info

        let request = UNNotificationRequest(
            identifier: "delivery-\(deliveryId)",
            content: content,
            trigger: nil
        )
        center.add(request) { error in
            if let error {
                Task { @MainActor in
                    Self.log.error(
                        "delivery notification add failed: \(error.localizedDescription, privacy: .public)"
                    )
                }
            }
        }
    }
}

// MARK: - PushKit Delegate (V9 T14.3)

#if canImport(PushKit)
extension NotificationService: PKPushRegistryDelegate {

    /// Called when iOS issues (or re-issues) a VoIP-push token. We
    /// hop to the main actor before mutating instance state so the
    /// per-instance state stays consistent under the @MainActor rule.
    nonisolated func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        guard type == .voIP else { return }
        let hex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.voipTokenHex = hex
            Self.log.info("VoIP token updated; \(hex.prefix(8), privacy: .public)…")
            await self.dispatchTokenToDaemon(hex: hex, kind: "voip")
        }
    }

    /// Called when iOS invalidates a VoIP-push token (rare — usually a
    /// device wipe or app reinstall). We log and let iOS re-issue.
    nonisolated func pushRegistry(
        _ registry: PKPushRegistry,
        didInvalidatePushTokenFor type: PKPushType
    ) {
        guard type == .voIP else { return }
        Task { @MainActor [weak self] in
            self?.voipTokenHex = nil
            Self.log.info("VoIP token invalidated")
        }
    }

    /// Called when a VoIP push arrives. WOTANN uses VoIP pushes for
    /// *Handoff resume* (not real calls), so the payload follows the
    /// same `wotann.route` envelope as standard remote pushes. The
    /// completion handler MUST be called before iOS suspends the app
    /// or subsequent VoIP pushes will be dropped.
    nonisolated func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }
        let userInfo = payload.dictionaryPayload
        Task { @MainActor [weak self] in
            self?.handleRemoteNotification(userInfo: userInfo)
            completion()
        }
    }
}
#endif

// MARK: - Notification Names

extension Notification.Name {
    /// Posted when a remote notification arrives carrying a
    /// `wotann://...` route hint. The active scene observes this and
    /// deep-links if the user-visible scene is foregrounded.
    static let wotannRemoteRoute = Notification.Name("com.wotann.ios.remoteRoute")
}
