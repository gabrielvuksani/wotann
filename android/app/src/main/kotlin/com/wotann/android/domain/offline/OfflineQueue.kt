/*
 * OfflineQueue.kt — V9 FT.3.3 offline command queue.
 *
 * WHAT: An offline-first queue that buffers user commands while the
 *   bridge is disconnected and drains them on reconnect. Backed by
 *   a Room table so the queue survives app death.
 *
 * WHY: Mobile networks drop. V9 §FT.3.3 specifies that the user
 *   should be able to type a chat message while in airplane mode and
 *   have it sent automatically when connectivity returns — without
 *   the user having to manually retry.
 *
 * WHERE: Used by ConversationRepository and AgentRepository when
 *   the bridge reports disconnected. WorkManager triggers the drain
 *   on connectivity-restored events.
 *
 * HOW: Repository pattern again — a clean interface here, a Room +
 *   WorkManager implementation under data/.
 *
 * Honest stub: interface + data classes only.
 */
package com.wotann.android.domain.offline

import kotlinx.coroutines.flow.Flow

/**
 * Identifier for a queued command. Locally generated (UUID).
 */
@JvmInline
value class QueuedCommandId(val value: String)

/**
 * A single queued command. Each kind is a distinct sealed subtype
 * so the drain handler can pattern-match safely.
 */
sealed interface QueuedCommand {
    val id: QueuedCommandId
    val enqueuedAtMillis: Long
    val attempts: Int

    /** Send a chat message. */
    data class SendMessage(
        override val id: QueuedCommandId,
        override val enqueuedAtMillis: Long,
        override val attempts: Int,
        val conversationId: String,
        val text: String,
    ) : QueuedCommand

    /** Start a Workshop task. */
    data class StartWorkshopTask(
        override val id: QueuedCommandId,
        override val enqueuedAtMillis: Long,
        override val attempts: Int,
        val title: String,
        val prompt: String,
    ) : QueuedCommand

    /** Cancel an in-flight task. */
    data class CancelTask(
        override val id: QueuedCommandId,
        override val enqueuedAtMillis: Long,
        override val attempts: Int,
        val taskId: String,
    ) : QueuedCommand
}

/**
 * Queue contract.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - RoomOfflineQueue concrete impl
 *   - WorkManager Worker that drains the queue
 *   - Backoff policy: exponential up to 1 hour, capped attempts at 50
 *   - Per-command idempotency token so the desktop dedupes
 */
interface OfflineQueue {
    /** Stream of queued commands (for the Settings "queued" badge). */
    fun observeQueueDepth(): Flow<Int>

    /** Add a command to the queue. */
    suspend fun enqueue(command: QueuedCommand)

    /**
     * Drain the queue against the bridge. Caller schedules this via
     * WorkManager when connectivity returns. Returns the count of
     * successfully drained commands.
     */
    suspend fun drain(): Int

    /** Empty the queue (user-initiated, "abandon queued"). */
    suspend fun purge()
}
