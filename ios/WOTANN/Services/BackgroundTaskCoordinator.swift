import Foundation
#if os(iOS)
import BackgroundTasks
import Security
#endif
import os.log

// SB-N6 fix: BGTaskScheduler registration so the `processing` UIBackgroundMode
// declared in Info.plist is BACKED by code (Apple App Review guideline 2.5.4
// rejects unjustified background-mode claims).
//
// Two task identifiers are registered:
//   * com.wotann.ios.offlinequeue.flush — drains pending iOS→desktop relay
//     tasks queued via OfflineQueueService while the app was offline.
//   * com.wotann.ios.memory.sync — opportunistic memory snapshot pull from
//     the daemon so iOS sees fresh conversations on next foreground.
//
// MUST be registered BEFORE the application finishes launching (Apple's
// rule), so this coordinator is invoked from `WOTANNApp.wireServices()`
// which runs on `.onAppear` of the root scene.
//
// Honest fallback (QB#6): if BackgroundTasks framework is unavailable or
// the OS rejects scheduling, we log and move on. Foreground operation is
// unaffected; offline queue still drains on next launch.

@MainActor
final class BackgroundTaskCoordinator {
    static let shared = BackgroundTaskCoordinator()

    static let offlineQueueFlushIdentifier = "com.wotann.ios.offlinequeue.flush"
    static let memorySyncIdentifier = "com.wotann.ios.memory.sync"

    private static let log = Logger(
        subsystem: "com.wotann.ios",
        category: "BackgroundTaskCoordinator"
    )

    private var registered = false

    private init() {}

    /// Register all permitted background task identifiers. Idempotent —
    /// repeated calls are a no-op. Must be called BEFORE the app finishes
    /// launching per Apple's BGTaskScheduler contract.
    func registerTasks() {
        guard !registered else { return }
        registered = true

        #if os(iOS)
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.offlineQueueFlushIdentifier,
            using: nil
        ) { task in
            // Cast: registration with `using: nil` runs the launch handler
            // on a background queue; the framework hands us the concrete
            // BGProcessingTask shape we declared in plist.
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
                await Self.handleOfflineQueueFlush(task: processingTask)
            }
        }
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: Self.memorySyncIdentifier,
            using: nil
        ) { task in
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
                await Self.handleMemorySync(task: processingTask)
            }
        }
        Self.log.info("BGTaskScheduler tasks registered (offlinequeue.flush + memory.sync)")
        #endif
    }

    /// Schedule the offline-queue flush task. Called when the app moves to
    /// background; the OS picks an opportunistic window (typically when the
    /// device is on power + Wi-Fi).
    func scheduleOfflineQueueFlush() {
        #if os(iOS)
        let request = BGProcessingTaskRequest(identifier: Self.offlineQueueFlushIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            Self.log.warning("Failed to schedule offline-queue flush task: \(error.localizedDescription, privacy: .public)")
        }
        #endif
    }

    /// Schedule an opportunistic memory snapshot pull.
    func scheduleMemorySync() {
        #if os(iOS)
        let request = BGProcessingTaskRequest(identifier: Self.memorySyncIdentifier)
        request.requiresNetworkConnectivity = true
        request.requiresExternalPower = false
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            Self.log.warning("Failed to schedule memory-sync task: \(error.localizedDescription, privacy: .public)")
        }
        #endif
    }

    // MARK: - Handlers

    #if os(iOS)
    @MainActor
    private static func handleOfflineQueueFlush(task: BGProcessingTask) async {
        // Always reschedule first so we don't drop the cadence even if the
        // current invocation is cancelled mid-flush.
        BackgroundTaskCoordinator.shared.scheduleOfflineQueueFlush()

        var didExpire = false
        task.expirationHandler = {
            didExpire = true
            log.info("offline-queue flush task expired before completion")
        }

        // H-E14: actually drain the offline queue. Construct a fresh
        // OfflineQueueService instance — it loads queued tasks from
        // the shared UserDefaults key on init, so it sees whatever
        // ChatViewModel queued during foreground use.
        //
        // The executor closure attempts a real desktop dispatch via
        // RPCDispatcher; on failure the queue's own retry/DLQ logic
        // takes over and we leave the unsent items for the next BG
        // window. Honest fallback: if no pairing is configured, the
        // dispatcher fails fast, the queue keeps its items, and we
        // mark the BG task complete so iOS doesn't penalise our
        // refresh budget.
        let queue = OfflineQueueService()
        await queue.flushOnBackground { content in
            try await BGOfflineQueueDispatcher.dispatch(content: content)
        }

        task.setTaskCompleted(success: !didExpire)
    }

    @MainActor
    private static func handleMemorySync(task: BGProcessingTask) async {
        BackgroundTaskCoordinator.shared.scheduleMemorySync()

        var didExpire = false
        task.expirationHandler = {
            didExpire = true
            log.info("memory-sync task expired before completion")
        }

        // Memory sync issues a single mem.snapshot.pull RPC to the
        // daemon so the next foreground sees fresh conversation
        // metadata. Failure is non-fatal — same retry/DLQ semantics
        // as the offline queue. Use BGOfflineQueueDispatcher's shared
        // RPC channel to keep the wire surface consistent.
        do {
            try await BGOfflineQueueDispatcher.runRPC("mem.snapshot.pull")
        } catch {
            log.warning("memory-sync rpc failed: \(error.localizedDescription, privacy: .public)")
        }

        task.setTaskCompleted(success: !didExpire)
    }
    #endif
}

// MARK: - BGOfflineQueueDispatcher
//
// Static RPC bridge used by background-task handlers when no live view
// is mounted. Reads the same pairing data that ChatViewModel uses for
// its RPCClient so the BG drain reaches the same desktop. Honest
// fallback: if no pairing data is in the keychain, throws — the queue
// keeps its items for the next foreground.

#if os(iOS)
@MainActor
enum BGOfflineQueueDispatcher {
    private static let log = Logger(
        subsystem: "com.wotann.ios",
        category: "BGOfflineQueueDispatcher"
    )

    /// Dispatch a single queued message via the desktop chat.send RPC.
    static func dispatch(content: String) async throws {
        try await runRPC("chat.send", params: ["content": .string(content)])
    }

    /// Issue an arbitrary RPC against the paired desktop. Used for both
    /// chat dispatch and memory snapshot pulls.
    static func runRPC(
        _ method: String,
        params: [String: RPCValue]? = nil
    ) async throws {
        let client = RPCClient()
        guard let pairingJson = readKeychain("pairing_data"),
              let data = pairingJson.data(using: .utf8),
              let pairing = try? JSONDecoder().decode(ConnectionManager.PairedDevice.self, from: data) else {
            throw NSError(
                domain: "wotann.bg-dispatch",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "no pairing data in shared keychain"]
            )
        }
        client.connect(host: pairing.host, port: pairing.port)
        // Tight handshake budget — BG tasks are time-limited.
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        guard client.isConnected else {
            throw NSError(
                domain: "wotann.bg-dispatch",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "websocket handshake timeout"]
            )
        }
        // Inherit the encrypted channel the main app already negotiated.
        if let secretBase64 = readKeychain("shared_secret"),
           let keyData = Data(base64Encoded: secretBase64) {
            let ecdh = ECDHManager()
            try? ecdh.loadDerivedKey(keyData)
            client.setEncryption(ecdh)
        }
        _ = try await client.send(method, params: params)
    }

    private static func readKeychain(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.wotann.ios",
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess,
              let data = result as? Data,
              let string = String(data: data, encoding: .utf8) else {
            return nil
        }
        return string
    }
}
#endif
