import Foundation
import Observation
import os.log

// MARK: - OfflineQueueDLQ
//
// V9 H-9 hardening (Wave 6-LL). Dead-letter queue for `OfflineQueueService`.
// When a queued RPC task exhausts its retry budget (3 attempts with 1s/5s/30s
// backoff) it is moved here so the user can inspect the failure surface
// without the live queue re-trying the poison message on every flush.
//
// Storage:
//  - In-memory `entries` for foreground inspection
//  - Persisted to UserDefaults under a separate key from the live queue so
//    a `clearAll()` on the live queue does NOT wipe DLQ history
//
// Lifecycle:
//  - Add: `OfflineQueueService` calls `add(_:reason:)` after the final
//    failed attempt OR when the live queue is at `maxQueueSize` and the
//    oldest entry is rotated out.
//  - Inspect: a Settings/diagnostics screen reads `entries` (the array is
//    `@Observable`-friendly via the macro on the surrounding type).
//  - Clear: `clear(id:)` removes a single entry; `clearAll()` empties.
//
// Quality bar #7 (per-instance state): the DLQ is owned by an
// OfflineQueueService instance, not a module-global, so tests can construct
// throwaway instances without leaking state. The `storageKey` is hardcoded
// to a single key for the production app — multiple instances share that
// persistence by design (the queue is conceptually per-user, not per-VM).

@MainActor
@Observable
final class OfflineQueueDLQ {

    /// Snapshot of every dead-lettered task with the reason for its
    /// transition. Newest entries appear at the end of the array
    /// (append-on-write).
    var entries: [DLQEntry] = []

    @ObservationIgnored
    private let storageKey = "wotann_offline_queue_dlq"

    @ObservationIgnored
    private static let log = Logger(subsystem: "com.wotann.ios", category: "OfflineQueueDLQ")

    /// Maximum DLQ entries kept on disk. Older entries roll off the front
    /// when the cap is exceeded. Sized larger than the live queue (1000)
    /// so the DLQ has plenty of headroom for analysis.
    @ObservationIgnored
    static let maxEntries: Int = 5_000

    struct DLQEntry: Codable, Identifiable {
        let id: UUID
        let task: OfflineQueueService.QueuedTask
        let reason: String
        let movedAt: Date

        init(
            id: UUID = UUID(),
            task: OfflineQueueService.QueuedTask,
            reason: String,
            movedAt: Date = Date()
        ) {
            self.id = id
            self.task = task
            self.reason = reason
            self.movedAt = movedAt
        }
    }

    init() {
        loadFromDisk()
    }

    /// Append a failed task to the dead-letter queue with a human-readable
    /// reason. If the cap is exceeded, the OLDEST DLQ entry rolls off so
    /// memory stays bounded.
    func add(_ task: OfflineQueueService.QueuedTask, reason: String) {
        let entry = DLQEntry(task: task, reason: reason)
        entries.append(entry)
        while entries.count > Self.maxEntries {
            entries.removeFirst()
        }
        saveToDisk()
        Self.log.warning(
            "DLQ +1 (now \(self.entries.count)/\(Self.maxEntries)): \(reason, privacy: .public)"
        )
    }

    /// Remove a single DLQ entry by its `DLQEntry.id` (NOT the inner
    /// task id — the task may have been re-enqueued separately).
    func clear(id: UUID) {
        entries.removeAll { $0.id == id }
        saveToDisk()
    }

    /// Clear every DLQ entry. Quality bar #6: this is destructive; the
    /// caller is expected to confirm with the user before invoking.
    func clearAll() {
        entries.removeAll()
        saveToDisk()
    }

    // MARK: - Persistence

    private func saveToDisk() {
        if let data = try? JSONEncoder().encode(entries) {
            UserDefaults.standard.set(data, forKey: storageKey)
        }
    }

    private func loadFromDisk() {
        guard let data = UserDefaults.standard.data(forKey: storageKey),
              let loaded = try? JSONDecoder().decode([DLQEntry].self, from: data) else {
            return
        }
        entries = loaded
    }
}
