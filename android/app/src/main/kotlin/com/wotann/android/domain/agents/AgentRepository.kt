/*
 * AgentRepository.kt — V9 FT.3.3 agent domain interface.
 *
 * WHAT: Defines the AgentRepository interface and the immutable
 *   data classes that flow through it (AgentTask, AgentRunStatus,
 *   AgentEvent). The repository is the single source of truth for
 *   "what is the agent doing right now" on the Android client.
 *
 * WHY: V9 §FT.3.3 mandates a clean Repository pattern (per the
 *   global coding-style rule). All agent-related UI state goes
 *   through this interface so the implementation can swap between
 *   bridge-backed (default) and local-engine-backed (future) without
 *   touching the UI layer.
 *
 * WHERE: Implementations live in `data/network/RpcClient`-backed
 *   classes. The interface is consumed by AgentForegroundService and
 *   the Workshop / Chat ViewModels.
 *
 * HOW: All return types are Flow-based for streaming updates. Any
 *   mutating call (start, stop, retry) is suspend so callers can
 *   integrate with structured concurrency.
 *
 * Honest stub: only the interface and the data classes are
 *   declared. The concrete implementation is a 12-week task.
 */
package com.wotann.android.domain.agents

import kotlinx.coroutines.flow.Flow

/**
 * Identifier for a single agent task. ULID-formatted (sortable by
 * creation time). Generated on the desktop and synced to the phone.
 */
@JvmInline
value class AgentTaskId(val value: String)

/**
 * The ladder rung the agent picked for this task. Maps 1:1 to the
 * desktop's provider-ladder rungs.
 */
enum class ProviderRung {
    Free,         // Gemma / Ollama / local
    Bargain,      // Cost-optimised cloud
    Workhorse,    // Default cloud (Sonnet, Haiku, mini-class)
    Frontier,     // Top of the line (Opus, GPT-4 class)
    Thinking,     // Extended thinking modes
}

/**
 * Immutable snapshot of an agent task. Returned by `getStatus()` and
 * emitted on the events Flow.
 */
data class AgentTask(
    val id: AgentTaskId,
    val title: String,
    val status: AgentRunStatus,
    val rung: ProviderRung,
    val startedAtMillis: Long,
    val completedAtMillis: Long?,
    val tokensIn: Long,
    val tokensOut: Long,
    val costUsd: Double,
)

/**
 * Lifecycle state of an agent run.
 */
enum class AgentRunStatus {
    Pending,      // Queued, not yet started
    Running,      // Actively iterating
    AwaitingUser, // Paused for user input / approval
    Completed,    // Finished successfully
    Failed,       // Errored out
    Cancelled,    // User-cancelled
}

/**
 * Streaming event from the agent. Used by the live-update UI to
 * render intermediate steps (tool calls, thoughts) in real time.
 */
sealed interface AgentEvent {
    val taskId: AgentTaskId
    val timestampMillis: Long

    data class TextChunk(
        override val taskId: AgentTaskId,
        override val timestampMillis: Long,
        val text: String,
    ) : AgentEvent

    data class ToolCall(
        override val taskId: AgentTaskId,
        override val timestampMillis: Long,
        val toolName: String,
        val argumentsJson: String,
    ) : AgentEvent

    data class ToolResult(
        override val taskId: AgentTaskId,
        override val timestampMillis: Long,
        val toolName: String,
        val outputSnippet: String,
    ) : AgentEvent

    data class StatusChanged(
        override val taskId: AgentTaskId,
        override val timestampMillis: Long,
        val newStatus: AgentRunStatus,
    ) : AgentEvent
}

/**
 * Repository contract. Implementations:
 *   - BridgeAgentRepository: talks to the desktop engine over WebSocket
 *   - LocalAgentRepository (future): runs the agent loop on-device
 *
 * Every method that returns a Flow MUST emit the current value
 * eagerly when collected, then push updates as they arrive.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - BridgeAgentRepository concrete impl
 *   - Hilt @Binds wiring in di/AppModule.kt
 *   - WorkManager-driven offline queue for queued starts/stops
 */
interface AgentRepository {
    /**
     * Stream of all known tasks, in reverse-chronological order.
     * Emits the current snapshot eagerly, then per-task updates.
     */
    fun observeTasks(): Flow<List<AgentTask>>

    /**
     * Stream of events for a single task. Useful for the Chat surface
     * to render streaming tokens.
     */
    fun observeEvents(taskId: AgentTaskId): Flow<AgentEvent>

    /**
     * Kick off a new agent task. Returns the new task's id once the
     * desktop engine has accepted the request.
     */
    suspend fun startTask(title: String, prompt: String, rung: ProviderRung?): AgentTaskId

    /**
     * Cancel an in-flight task. Best-effort — the engine may have
     * already completed by the time the cancel reaches it.
     */
    suspend fun cancelTask(taskId: AgentTaskId)

    /**
     * Retry a failed task with the same prompt. Returns a new
     * AgentTaskId — the failed task is preserved as history.
     */
    suspend fun retryTask(taskId: AgentTaskId): AgentTaskId
}
