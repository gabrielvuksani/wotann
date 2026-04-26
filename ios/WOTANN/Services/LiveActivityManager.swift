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
    /// Maps a daemon sessionId (the key the RPC payload uses) to the
    /// in-flight activity id we minted for it. Lets `live.activity` push
    /// events route updates to the right ActivityKit activity instead of
    /// re-creating one per event (which would flood the Dynamic Island).
    private var sessionToActivity: [String: UUID] = [:]
    #endif

    /// Latest error encountered while wiring the `live.activity.subscribe`
    /// stream. Surfaced as `@Published` so a Settings/diagnostics screen
    /// can render the failure rather than have it disappear silently.
    /// Honest-stub quality bar (#6): every RPC failure must be surface-able.
    @Published var subscribeError: String?

    /// True once we have wired the live-activity push subscription against
    /// the supplied RPC client. Idempotent so a re-pair / re-connect does
    /// not double-subscribe (quality bar #11 sibling-site scan: this is the
    /// SINGLE site on iOS subscribing to `live.activity.subscribe`).
    private var subscribed = false

    /// Weak handle to the RPC client whose subscription we own. Held weak
    /// because the connection manager outlives any individual session and
    /// we never want the manager to retain the client.
    private weak var rpcClient: RPCClient?

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

    // MARK: - Restoration (V9 H-9, Wave 6-LL)

    /// Re-attach to ActivityKit activities that survived a daemon restart
    /// or app relaunch. Without this, an in-flight Live Activity becomes
    /// "orphaned" — visible in the Dynamic Island / Lock Screen but no
    /// longer wired to any session, so the user sees a frozen progress
    /// indicator forever (H-9 finding).
    ///
    /// Behaviour:
    ///  1. Iterate `Activity<TaskProgressAttributes>.activities` (the
    ///     system's authoritative list of activities the OS resurrected
    ///     for our app at launch).
    ///  2. For each, rebuild the in-memory registries (`activities`,
    ///     `kinds`, `sessionToActivity`) so subsequent `update`/`end`
    ///     calls route correctly.
    ///  3. If an `RPCClient` is supplied AND it reports as connected,
    ///     call `liveActivity.pending` with each session id to ask the
    ///     daemon whether the session is still live. Sessions absent
    ///     from the daemon's pending set are gracefully ended (with a
    ///     "stale" outcome so the user sees the activity dismiss with
    ///     dignity instead of vanishing).
    ///  4. Honest fallback (quality bar #6): if the daemon is
    ///     unreachable during restoration we DO NOT end any activities.
    ///     The activities stay in our registry as known-but-unverified
    ///     so a subsequent `live.activity` push event can refresh them.
    ///     The caller surfaces this via `restoreError`.
    ///
    /// Idempotent: safe to call multiple times. The second call is a
    /// near no-op (registries are already populated; the daemon
    /// reconciliation pass repeats but produces the same answer).
    @discardableResult
    func restoreActivities(client: RPCClient? = nil) async -> RestoreOutcome {
        #if canImport(ActivityKit)
        var rebuilt = 0
        var endedStale = 0
        var verified = 0
        var unreachable = false

        let live = Activity<TaskProgressAttributes>.activities

        // Phase 1: rebuild the in-memory registry. We do this whether or
        // not the daemon is reachable so subsequent pushes can find the
        // activity.
        for activity in live {
            let taskId = activity.attributes.taskId
            let activityId: UUID
            if let parsed = UUID(uuidString: taskId) {
                activityId = parsed
            } else {
                // Daemon-side sessionIds are not guaranteed to be UUIDs;
                // mint a stable client-side UUID so our registry keys
                // remain UUID-shaped. This loses round-trip with the
                // daemon's sessionId — sessionToActivity below preserves
                // the daemon-side string for push routing.
                activityId = UUID()
            }
            activities[activityId] = activity
            // We have no source-of-truth for the kind once the process
            // dies — assume `.taskRun` (the most common case). End-time
            // dismissal policy is the only thing this affects.
            kinds[activityId] = .taskRun
            sessionToActivity[taskId] = activityId
            rebuilt += 1
        }

        Self.log.info(
            "restoreActivities phase 1: rebuilt \(rebuilt) registry entries"
        )

        // Phase 2: reconcile with daemon if a connected client is given.
        // Honest stub (#6): if no client OR the call fails, leave
        // activities alone — they will refresh via push events when the
        // daemon comes back online.
        guard let client else {
            Self.log.info(
                "restoreActivities phase 2 skipped: no RPC client provided"
            )
            return RestoreOutcome(
                rebuilt: rebuilt,
                verified: 0,
                endedStale: 0,
                daemonUnreachable: false
            )
        }

        // Snapshot the session ids we just rebuilt so we can iterate
        // without mutating the registry mid-loop.
        let sessionIds = Array(sessionToActivity.keys)
        guard !sessionIds.isEmpty else {
            return RestoreOutcome(
                rebuilt: 0,
                verified: 0,
                endedStale: 0,
                daemonUnreachable: false
            )
        }

        let pendingResponse: RPCResponse
        do {
            // No sessionId → daemon returns ALL pending steps. Cheaper
            // than N round-trips and avoids a thundering-herd on a slow
            // daemon during cold start.
            pendingResponse = try await client.send("liveActivity.pending")
        } catch {
            unreachable = true
            self.restoreError = "liveActivity.pending failed: \(error.localizedDescription)"
            Self.log.error(
                "restoreActivities daemon reconciliation failed: \(error.localizedDescription, privacy: .public). Leaving \(rebuilt) activity/activities in registry as known-but-unverified."
            )
            return RestoreOutcome(
                rebuilt: rebuilt,
                verified: 0,
                endedStale: 0,
                daemonUnreachable: true
            )
        }

        self.restoreError = nil

        // Build the set of session ids the daemon still considers active.
        var liveSessionIds = Set<String>()
        if let pendingArray = pendingResponse.result?.objectValue?["pending"]?.arrayValue {
            for value in pendingArray {
                guard let obj = value.objectValue else { continue }
                if let sid = obj["sessionId"]?.stringValue, !sid.isEmpty {
                    liveSessionIds.insert(sid)
                }
            }
        }

        // Phase 3: for every session we restored, decide:
        //  - daemon says still pending → leave registry intact (the next
        //    push event will refresh state). Count as verified.
        //  - daemon says NOT pending → end gracefully with a "Recovered"
        //    status so the user sees the activity dismiss instead of
        //    hanging at frozen-progress.
        for sessionId in sessionIds {
            guard let activityId = sessionToActivity[sessionId],
                  let activity = activities[activityId] else { continue }

            if liveSessionIds.contains(sessionId) {
                verified += 1
                Self.log.info(
                    "restoreActivities verified session \(sessionId, privacy: .public)"
                )
            } else {
                // Compose a dignified terminal state from whatever the
                // OS preserved across launches.
                let lastState = activity.content.state
                let outcome = LiveActivityOutcome(
                    progress: lastState.progress,
                    status: "Recovered",
                    cost: lastState.cost,
                    elapsedSeconds: lastState.elapsedSeconds
                )
                end(id: activityId, outcome: outcome)
                sessionToActivity.removeValue(forKey: sessionId)
                endedStale += 1
                Self.log.info(
                    "restoreActivities ended stale session \(sessionId, privacy: .public)"
                )
            }
        }

        return RestoreOutcome(
            rebuilt: rebuilt,
            verified: verified,
            endedStale: endedStale,
            daemonUnreachable: unreachable
        )
        #else
        return RestoreOutcome(rebuilt: 0, verified: 0, endedStale: 0, daemonUnreachable: false)
        #endif
    }

    /// Outcome of a restoration pass. Surfaced for diagnostics and for
    /// callers that want to log/metric the recovery rate.
    struct RestoreOutcome: Equatable {
        let rebuilt: Int
        let verified: Int
        let endedStale: Int
        /// True if the daemon was unreachable during the reconciliation
        /// step. Quality bar #6 honest fallback marker — the caller can
        /// surface "we restored N activities but couldn't verify them".
        let daemonUnreachable: Bool
    }

    /// Last error from the daemon-reconciliation step of
    /// `restoreActivities`. Surfaced as @Published so a Settings or
    /// diagnostics screen can render the failure rather than have it
    /// disappear silently. Quality bar #6: every RPC failure surfaces.
    @Published var restoreError: String?

    // MARK: - RPC Subscription (T5.3)

    /// Wire the manager to a paired desktop's RPC client and subscribe to
    /// the `live.activity.subscribe` push stream. Idempotent — calling
    /// twice with the same client is a no-op so a UI re-render cannot
    /// double-subscribe (quality bar #7 per-session state).
    ///
    /// Behavior:
    /// - Sends the seed `live.activity.subscribe` RPC so the daemon
    ///   begins buffering events.
    /// - Wires a push handler that mirrors each TaskProgress event into
    ///   ActivityKit (Dynamic Island lights up).
    /// - Surfaces failures via `subscribeError` instead of silently
    ///   swallowing them (quality bar #6 honest stubs).
    func attachRPC(_ client: RPCClient) {
        guard !subscribed else { return }
        if rpcClient === client { return }
        rpcClient = client
        subscribed = true

        Task { [weak self, weak client] in
            guard let client else { return }
            do {
                _ = try await client.send("live.activity.subscribe")
                await MainActor.run { self?.subscribeError = nil }
            } catch {
                await MainActor.run {
                    self?.subscribeError = "live.activity.subscribe failed: \(error.localizedDescription)"
                    Self.log.error(
                        "live.activity.subscribe seed failed: \(error.localizedDescription, privacy: .public)"
                    )
                }
            }
        }

        client.subscribe("live.activity") { [weak self] event in
            Task { @MainActor [weak self] in
                self?.handleLiveActivityEvent(event)
            }
        }
    }

    /// Translate a daemon `live.activity` push payload into an
    /// ActivityKit start/update call. Schema (best-effort decode — daemon
    /// payloads vary slightly by surface):
    ///
    ///   { sessionId: String,
    ///     title:    String,
    ///     status:   String?,
    ///     progress: Double in 0...1,
    ///     cost:     Double?,
    ///     elapsedSeconds: Int?,
    ///     provider: String?,
    ///     model:    String?,
    ///     done:     Bool? }
    private func handleLiveActivityEvent(_ event: RPCEvent) {
        #if canImport(ActivityKit)
        guard let obj = event.params?.objectValue else { return }
        guard let sessionId = obj["sessionId"]?.stringValue ?? obj["taskId"]?.stringValue else {
            return
        }

        let title = obj["title"]?.stringValue
            ?? obj["taskTitle"]?.stringValue
            ?? "Task"
        let status = obj["status"]?.stringValue ?? "Running"
        let progress = obj["progress"]?.doubleValue
            ?? obj["progress"]?.intValue.map(Double.init)
            ?? 0
        let cost = obj["cost"]?.doubleValue
            ?? obj["cost"]?.intValue.map(Double.init)
            ?? 0
        let elapsedSeconds = obj["elapsedSeconds"]?.intValue
            ?? obj["elapsed"]?.intValue
            ?? 0
        let provider = obj["provider"]?.stringValue ?? "remote"
        let model = obj["model"]?.stringValue ?? "agent"
        let done = obj["done"]?.boolValue ?? (progress >= 1)

        if done, let activityId = sessionToActivity.removeValue(forKey: sessionId) {
            end(
                id: activityId,
                outcome: LiveActivityOutcome(
                    progress: progress,
                    status: status,
                    cost: cost,
                    elapsedSeconds: elapsedSeconds
                )
            )
            return
        }

        if let activityId = sessionToActivity[sessionId] {
            updateTaskRun(
                id: activityId,
                title: title,
                progress: progress,
                status: status,
                cost: cost,
                elapsedSeconds: elapsedSeconds
            )
        } else {
            let activityId = UUID()
            if startTaskRun(
                id: activityId,
                title: title,
                provider: provider,
                model: model,
                initialStatus: status
            ) != nil {
                sessionToActivity[sessionId] = activityId
                if progress > 0 {
                    updateTaskRun(
                        id: activityId,
                        title: title,
                        progress: progress,
                        status: status,
                        cost: cost,
                        elapsedSeconds: elapsedSeconds
                    )
                }
            }
        }
        #endif
    }
}

// MARK: - Helpers

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
