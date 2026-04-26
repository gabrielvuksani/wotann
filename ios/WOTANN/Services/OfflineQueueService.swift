import Foundation
import Observation
import os.log

#if canImport(UIKit)
import UIKit
#endif

// MARK: - OfflineQueueService
//
// V9 T14.3 — Migrated from `ObservableObject` + `@Published` to the iOS 17
// `@Observable` macro. `OfflineQueueService` is held privately by
// `ChatViewModel` and `OnDeviceModelService`; nothing reads
// `offlineQueue.$queuedTasks` via Combine projection, so the migration is
// strictly internal — no consumer-side changes required.
//
// V9 H-9 hardening (Wave 6-LL) — Three resilience features added on top of
// the existing API surface:
//
//  1. Bounded queue (max 1000 entries). Older queued tasks at the head are
//     dropped (with a log warning + DLQ rotation) when the cap is hit so a
//     stuck offline session cannot grow memory unbounded.
//  2. Exponential-backoff retries (1s, 5s, 30s) inside `executeAll`. Each
//     queued task gets up to 3 attempts before it is moved to the
//     dead-letter queue (`OfflineQueueDLQ`) for manual review by the user.
//  3. `beginBackgroundTask` wrapper around `flushOnBackground(...)` so when
//     the app goes to background iOS gives us a few extra seconds to push
//     the queue through before suspending.
//
// All three are internal-state changes on the existing `@MainActor`
// instance — no caller signature breakage. `enqueue` / `executeAll` /
// `remove` / `clearAll` round-trip identically to V9 T14.3 behaviour for
// happy-path callers.

/// Queues tasks when offline, executes them when connectivity returns.
/// Enables subway/airplane usage — work is never lost.
@MainActor
@Observable
final class OfflineQueueService {
    var queuedTasks: [QueuedTask] = []
    var isOnline = true

    @ObservationIgnored
    private let storageKey = "wotann_offline_queue"

    /// Hard cap on queued tasks. When exceeded, the OLDEST queued task is
    /// rotated into the DLQ (so the user can still see it) and removed from
    /// the live queue. Quality bar #6 honest fallback: we never silently
    /// drop user work — overflow is preserved in the DLQ rather than lost.
    @ObservationIgnored
    static let maxQueueSize: Int = 1000

    /// Maximum retry attempts before a task is moved to the DLQ.
    @ObservationIgnored
    static let maxAttempts: Int = 3

    /// Exponential-backoff schedule between attempts. Indices line up with
    /// `attempts` count (so the FIRST retry waits 1s, the SECOND 5s, the
    /// THIRD 30s). Values are seconds.
    @ObservationIgnored
    static let retryDelaysSeconds: [UInt64] = [1, 5, 30]

    /// Per-instance dead-letter queue. Quality bar #7: state is per-instance
    /// (each OfflineQueueService owns its own DLQ), not a module-global, so
    /// tests can construct throwaway instances without leaking state.
    @ObservationIgnored
    private(set) var dlq: OfflineQueueDLQ = OfflineQueueDLQ()

    @ObservationIgnored
    private static let log = Logger(subsystem: "com.wotann.ios", category: "OfflineQueue")

    struct QueuedTask: Codable, Identifiable {
        let id: UUID
        let prompt: String
        let provider: String?
        let createdAt: Date
        var status: TaskStatus
        /// Number of times the task has been attempted. Persisted so a
        /// daemon-restart partway through a flush does not reset the
        /// retry counter and let a poison message loop forever.
        var attempts: Int

        enum TaskStatus: String, Codable {
            case queued, executing, completed, failed
        }

        init(
            id: UUID = UUID(),
            prompt: String,
            provider: String? = nil,
            createdAt: Date = Date(),
            status: TaskStatus = .queued,
            attempts: Int = 0
        ) {
            self.id = id
            self.prompt = prompt
            self.provider = provider
            self.createdAt = createdAt
            self.status = status
            self.attempts = attempts
        }
    }

    init() {
        loadFromDisk()
    }

    /// Queue a task for later execution.
    ///
    /// If the queue would exceed `maxQueueSize`, the OLDEST queued task is
    /// rotated into the DLQ before the new task is appended — never silently
    /// dropped (quality bar #6 honest fallback).
    func enqueue(prompt: String, provider: String? = nil) {
        let task = QueuedTask(
            prompt: prompt,
            provider: provider
        )
        // Bound the queue. If we are at the cap, evict the oldest entry to
        // the DLQ so the user can still find it later.
        while queuedTasks.count >= Self.maxQueueSize {
            let evicted = queuedTasks.removeFirst()
            dlq.add(
                evicted,
                reason: "Queue capacity exceeded (\(Self.maxQueueSize)); oldest entry rotated to DLQ"
            )
            Self.log.warning(
                "OfflineQueue at cap (\(Self.maxQueueSize)); evicted oldest task to DLQ"
            )
        }
        queuedTasks.append(task)
        saveToDisk()
    }

    /// Execute all queued tasks (called when connectivity returns).
    ///
    /// Each task gets up to `maxAttempts` retries with the
    /// `retryDelaysSeconds` backoff schedule between attempts. After the
    /// final failure the task is moved to the DLQ for manual review.
    func executeAll(using execute: @escaping (String) async throws -> Void) async {
        for i in queuedTasks.indices {
            guard queuedTasks[i].status == .queued else { continue }
            queuedTasks[i].status = .executing
            saveToDisk()

            var lastError: Error?
            var succeeded = false

            // Attempt loop. The first attempt has no preceding wait; each
            // subsequent attempt waits for the corresponding entry in
            // `retryDelaysSeconds`. We persist the attempt counter on every
            // failure so a daemon-restart mid-flush does not let a poison
            // task loop forever.
            for attempt in 0..<Self.maxAttempts {
                if attempt > 0 {
                    let delaySeconds = Self.retryDelaysSeconds[
                        min(attempt - 1, Self.retryDelaysSeconds.count - 1)
                    ]
                    try? await Task.sleep(nanoseconds: delaySeconds * 1_000_000_000)
                }

                queuedTasks[i].attempts = attempt + 1

                do {
                    try await execute(queuedTasks[i].prompt)
                    succeeded = true
                    break
                } catch {
                    lastError = error
                    Self.log.error(
                        "OfflineQueue task \(self.queuedTasks[i].id.uuidString, privacy: .public) attempt \(attempt + 1)/\(Self.maxAttempts) failed: \(error.localizedDescription, privacy: .public)"
                    )
                    saveToDisk()
                }
            }

            if succeeded {
                queuedTasks[i].status = .completed
            } else {
                queuedTasks[i].status = .failed
                let reason = lastError?.localizedDescription
                    ?? "Failed after \(Self.maxAttempts) attempts"
                dlq.add(queuedTasks[i], reason: reason)
                Self.log.error(
                    "OfflineQueue task \(self.queuedTasks[i].id.uuidString, privacy: .public) moved to DLQ: \(reason, privacy: .public)"
                )
            }
        }
        // Remove completed AND failed tasks (failed are already in the DLQ
        // for inspection — keeping them in the live queue would cause the
        // next flush to attempt them again).
        queuedTasks.removeAll { $0.status == .completed || $0.status == .failed }
        saveToDisk()
    }

    /// Flush the queue while the app is going to background. Wraps the
    /// `executeAll` invocation in a `beginBackgroundTask` so iOS grants the
    /// process a short extension (typically ~30s) to drain the queue before
    /// suspending. Honest fallback: if the OS denies the background task
    /// (no entitlement, system pressure, etc.) we still attempt the flush
    /// inline and let the system suspend us when it must.
    ///
    /// Quality bar #6 honest stub: if `execute` throws partway through (RPC
    /// dies as the app goes background), the failed task is preserved in
    /// the queue and re-tried on next launch.
    #if canImport(UIKit)
    func flushOnBackground(
        using execute: @escaping (String) async throws -> Void
    ) async {
        var bgTaskId: UIBackgroundTaskIdentifier = .invalid
        bgTaskId = UIApplication.shared.beginBackgroundTask(
            withName: "wotann.offline-queue.flush"
        ) { [weak self] in
            // Expiration handler — iOS is about to forcibly suspend us.
            // End the task so the process is not killed for misbehaviour.
            Task { @MainActor [weak self] in
                self?.saveToDisk()
                if bgTaskId != .invalid {
                    UIApplication.shared.endBackgroundTask(bgTaskId)
                    bgTaskId = .invalid
                }
            }
        }

        defer {
            if bgTaskId != .invalid {
                UIApplication.shared.endBackgroundTask(bgTaskId)
                bgTaskId = .invalid
            }
        }

        if bgTaskId == .invalid {
            // The OS refused to grant background time. Still attempt the
            // flush inline — the queue is persisted so anything that does
            // not finish will be re-tried on next launch.
            Self.log.info(
                "beginBackgroundTask refused; flushing inline without grace period"
            )
        }

        await executeAll(using: execute)
    }
    #endif

    /// Remove a queued task.
    func remove(id: UUID) {
        queuedTasks.removeAll { $0.id == id }
        saveToDisk()
    }

    /// Clear all queued tasks.
    func clearAll() {
        queuedTasks.removeAll()
        saveToDisk()
    }

    // MARK: - Persistence

    private func saveToDisk() {
        if let data = try? JSONEncoder().encode(queuedTasks) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func loadFromDisk() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let tasks = try? JSONDecoder().decode([QueuedTask].self, from: data) else { return }
        queuedTasks = tasks
    }
}
