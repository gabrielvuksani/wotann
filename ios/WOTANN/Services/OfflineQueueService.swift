import Foundation

// MARK: - OfflineQueueService

/// Queues tasks when offline, executes them when connectivity returns.
/// Enables subway/airplane usage — work is never lost.
@MainActor
class OfflineQueueService: ObservableObject {
    @Published var queuedTasks: [QueuedTask] = []
    @Published var isOnline = true

    private let storageKey = "wotann_offline_queue"

    struct QueuedTask: Codable, Identifiable {
        let id: UUID
        let prompt: String
        let provider: String?
        let createdAt: Date
        var status: TaskStatus

        enum TaskStatus: String, Codable {
            case queued, executing, completed, failed
        }
    }

    init() {
        loadFromDisk()
    }

    /// Queue a task for later execution.
    func enqueue(prompt: String, provider: String? = nil) {
        let task = QueuedTask(
            id: UUID(),
            prompt: prompt,
            provider: provider,
            createdAt: Date(),
            status: .queued
        )
        queuedTasks.append(task)
        saveToDisk()
    }

    /// Execute all queued tasks (called when connectivity returns).
    func executeAll(using execute: @escaping (String) async throws -> Void) async {
        for i in queuedTasks.indices {
            guard queuedTasks[i].status == .queued else { continue }
            queuedTasks[i].status = .executing
            do {
                try await execute(queuedTasks[i].prompt)
                queuedTasks[i].status = .completed
            } catch {
                queuedTasks[i].status = .failed
            }
        }
        // Remove completed tasks
        queuedTasks.removeAll { $0.status == .completed }
        saveToDisk()
    }

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
