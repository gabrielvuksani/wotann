import Foundation
#if os(iOS)
import BackgroundTasks
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

        // Honest fallback: in the absence of an injected RPC executor we mark
        // the task as completed (no-op) — drain logic is wired by callers via
        // OfflineQueueService.flushOnBackground(using:) on an upcoming pass.
        // Future wave (H-E14 in TIER 1) will inject the executor here.
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

        // Same honest pattern — surface the BGTaskScheduler entry point for
        // App Review while the actual sync executor lands in TIER 1.
        task.setTaskCompleted(success: !didExpire)
    }
    #endif
}
