import Foundation
import Combine
import os.log

#if canImport(ActivityKit)
import ActivityKit
#endif

// MARK: - LiveActivityManager
//
// S5-11. Central ActivityKit orchestrator for WOTANN. Keeps every running
// `Activity<TaskProgressAttributes>` in one spot so autopilot, morning
// briefing, and scheduled-job surfaces can share the same `Activity.request`
// and `Activity.update` code paths instead of each re-implementing state
// persistence and dismissal policy.
//
// Three logical activity classes share the single `TaskProgressAttributes`
// shape defined in WOTANNLiveActivity/TaskProgressActivity.swift. They are
// distinguished by `ActivityKind` so dismiss policies can diverge:
//
//  - `.taskRun` — running autonomous task. Stays live until completion.
//  - `.briefing` — daily briefing card. Auto-expires after 12 hours.
//  - `.scheduledJob` — cron / scheduled task. Ends at the predicted ETA.
//
// Thread safety: `@MainActor` so every mutation of the activity registry
// happens on the main queue. ActivityKit APIs are themselves async and must
// be called from a suspension context.

enum ActivityKind: String, Codable {
    case taskRun
    case briefing
    case scheduledJob
}

/// Final state emitted when an activity ends. UI can use this to pick a
/// dismissal message that matches the terminal status.
struct LiveActivityOutcome {
    let progress: Double
    let status: String
    let cost: Double
    let elapsedSeconds: Int
}

@MainActor
final class LiveActivityManager: ObservableObject {

    /// Process-wide singleton so autopilot, briefing, and scheduled-job views
    /// share the same running-activity registry.
    static let shared = LiveActivityManager()

    #if canImport(ActivityKit)
    /// Active ActivityKit activities keyed by the stable identifier the caller
    /// provided at start time. Callers own id generation; using `UUID()` is
    /// the idiomatic default.
    private var activities: [UUID: Activity<TaskProgressAttributes>] = [:]
    /// Remembers the kind of each activity so we can tailor dismiss policies
    /// at end time without plumbing it through every update call site.
    private var kinds: [UUID: ActivityKind] = [:]
    #endif

    private static let log = Logger(subsystem: "com.wotann.ios", category: "LiveActivity")

    private init() {}

    // MARK: Authorization

    /// `true` if the user has Live Activities enabled for the app. Writers
    /// must check this before `start(...)` — ActivityKit silently refuses if
    /// it is `false` and there is no runtime error surface.
    var areActivitiesEnabled: Bool {
        #if canImport(ActivityKit)
        return ActivityAuthorizationInfo().areActivitiesEnabled
        #else
        return false
        #endif
    }

    // MARK: Task Run (autopilot, agent tasks)

    /// Start a task-run activity. Returns the activity id on success, `nil` if
    /// ActivityKit refused (disabled, push token failure, etc.). The caller
    /// should persist the returned id so subsequent updates target the same
    /// activity across relaunches.
    @discardableResult
    func startTaskRun(
        id: UUID,
        title: String,
        provider: String,
        model: String,
        initialStatus: String = "Starting"
    ) -> UUID? {
        #if canImport(ActivityKit)
        guard areActivitiesEnabled else {
            Self.log.info("startTaskRun skipped: activities disabled")
            return nil
        }

        let attrs = TaskProgressAttributes(
            taskId: id.uuidString,
            provider: provider,
            model: model
        )
        let state = TaskProgressAttributes.ContentState(
            taskTitle: title,
            progress: 0,
            status: initialStatus,
            cost: 0,
            elapsedSeconds: 0
        )

        do {
            let activity = try Activity<TaskProgressAttributes>.request(
                attributes: attrs,
                content: .init(state: state, staleDate: nil),
                pushType: nil
            )
            activities[id] = activity
            kinds[id] = .taskRun
            return id
        } catch {
            Self.log.error("startTaskRun failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        #else
        return nil
        #endif
    }

    /// Push an incremental update to a running task activity. Silently drops
    /// if the activity id is unknown — this keeps callers from needing to
    /// track activity state separately from their domain state.
    func updateTaskRun(
        id: UUID,
        title: String,
        progress: Double,
        status: String,
        cost: Double,
        elapsedSeconds: Int
    ) {
        #if canImport(ActivityKit)
        guard let activity = activities[id] else { return }

        let state = TaskProgressAttributes.ContentState(
            taskTitle: title,
            progress: progress.clamped(to: 0...1),
            status: status,
            cost: cost,
            elapsedSeconds: elapsedSeconds
        )

        Task {
            await activity.update(.init(state: state, staleDate: nil))
        }
        #endif
    }

    // MARK: Briefing

    /// Start a daily-briefing activity. The briefing state expires after 12
    /// hours so it is not left visible overnight.
    @discardableResult
    func startBriefing(
        id: UUID,
        summary: String,
        cost: Double
    ) -> UUID? {
        #if canImport(ActivityKit)
        guard areActivitiesEnabled else {
            Self.log.info("startBriefing skipped: activities disabled")
            return nil
        }

        let attrs = TaskProgressAttributes(
            taskId: id.uuidString,
            provider: "briefing",
            model: "daily"
        )
        let state = TaskProgressAttributes.ContentState(
            taskTitle: summary,
            progress: 1.0,
            status: "Briefing",
            cost: cost,
            elapsedSeconds: 0
        )

        // Briefings are informational — mark stale after 12h so the system
        // downgrades presentation before we force an end.
        let staleDate = Date.now.addingTimeInterval(12 * 3600)

        do {
            let activity = try Activity<TaskProgressAttributes>.request(
                attributes: attrs,
                content: .init(state: state, staleDate: staleDate),
                pushType: nil
            )
            activities[id] = activity
            kinds[id] = .briefing
            return id
        } catch {
            Self.log.error("startBriefing failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        #else
        return nil
        #endif
    }

    // MARK: Scheduled Job

    /// Start a scheduled-job activity. `scheduledAt` sets the stale date so
    /// the activity naturally fades when the job is due.
    @discardableResult
    func startScheduledJob(
        id: UUID,
        title: String,
        scheduledAt: Date
    ) -> UUID? {
        #if canImport(ActivityKit)
        guard areActivitiesEnabled else {
            Self.log.info("startScheduledJob skipped: activities disabled")
            return nil
        }

        let attrs = TaskProgressAttributes(
            taskId: id.uuidString,
            provider: "schedule",
            model: "cron"
        )
        let state = TaskProgressAttributes.ContentState(
            taskTitle: title,
            progress: 0,
            status: "Scheduled",
            cost: 0,
            elapsedSeconds: 0
        )

        do {
            let activity = try Activity<TaskProgressAttributes>.request(
                attributes: attrs,
                content: .init(state: state, staleDate: scheduledAt),
                pushType: nil
            )
            activities[id] = activity
            kinds[id] = .scheduledJob
            return id
        } catch {
            Self.log.error("startScheduledJob failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
        #else
        return nil
        #endif
    }

    // MARK: End / Dismiss

    /// End a running activity with a final state. `dismissalPolicy` defaults
    /// to `.default` for task runs (immediate fade) and `.after(Date)` for
    /// briefings/scheduled jobs so users can see the final outcome briefly.
    func end(id: UUID, outcome: LiveActivityOutcome) {
        #if canImport(ActivityKit)
        guard let activity = activities.removeValue(forKey: id) else { return }
        let kind = kinds.removeValue(forKey: id) ?? .taskRun

        let state = TaskProgressAttributes.ContentState(
            taskTitle: activity.attributes.taskId,
            progress: outcome.progress,
            status: outcome.status,
            cost: outcome.cost,
            elapsedSeconds: outcome.elapsedSeconds
        )

        let policy: ActivityUIDismissalPolicy = {
            switch kind {
            case .taskRun:      return .default
            case .briefing:     return .after(.now + 60)
            case .scheduledJob: return .after(.now + 30)
            }
        }()

        Task {
            await activity.end(
                .init(state: state, staleDate: nil),
                dismissalPolicy: policy
            )
        }
        #endif
    }

    /// Immediately end every running activity. Called on logout / unpair so
    /// we do not leak notifications tied to a disconnected session.
    func endAll() {
        #if canImport(ActivityKit)
        let snapshot = activities
        activities.removeAll()
        kinds.removeAll()
        for (_, activity) in snapshot {
            Task {
                await activity.end(dismissalPolicy: .immediate)
            }
        }
        #endif
    }

    // MARK: Introspection

    /// `true` if an activity with `id` is currently running.
    func isActive(id: UUID) -> Bool {
        #if canImport(ActivityKit)
        return activities[id] != nil
        #else
        return false
        #endif
    }
}

// MARK: - Helpers

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
