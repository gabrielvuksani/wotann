/*
 * LiveUpdateManager.kt — V9 FT.3.3 live activity / persistent
 * notification manager.
 *
 * WHAT: Renders a "live" notification while the agent is running —
 *   shows the current step, progress, and a tap-to-cancel action.
 *   Equivalent to iOS Live Activities, but using Android's persistent
 *   notification + Lockscreen notification + (Android 14+) Live
 *   Updates API.
 *
 * WHY: V9 §FT.3.3 wants the user to glance at the lockscreen and
 *   see "Agent is editing 3 files…" without unlocking. iOS has a
 *   first-class API; Android's analog is the persistent
 *   foreground-service notification, optionally promoted to a
 *   Live Update on Android 14+.
 *
 * WHERE: Owned by AgentForegroundService and updated as agent state
 *   changes flow through.
 *
 * HOW: Skeleton — builds nothing until the impl phase.
 *
 * Honest stub: methods are no-ops.
 */
package com.wotann.android.services

import android.content.Context

/**
 * Live update facade. Lets the foreground service publish state
 * changes without coupling itself to NotificationCompat.Builder.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - NotificationCompat.Builder with progress, action, deep-link
 *   - Notification channel setup
 *   - Android 14+ Live Update promotion via a ProgressStyle
 *   - Update batching (no more than 1 update per second to avoid
 *     getting throttled by the system)
 */
class LiveUpdateManager(private val context: Context) {

    /**
     * Push a fresh status to the notification. Idempotent — repeated
     * calls with the same payload are no-ops.
     */
    fun publish(status: LiveUpdateStatus) {
        // V9 FT.3.3 scaffold: no-op until NotificationCompat impl lands.
    }

    /** Tear down the notification. */
    fun dismiss() {
        // V9 FT.3.3 scaffold: no-op.
    }
}

/**
 * Snapshot pushed to the notification. Immutable so the manager can
 * dedupe by equality.
 */
data class LiveUpdateStatus(
    val title: String,
    val subtitle: String,
    val progressPercent: Int?,    // null → indeterminate
    val isCancellable: Boolean,
)
