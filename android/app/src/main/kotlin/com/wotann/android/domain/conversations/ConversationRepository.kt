/*
 * ConversationRepository.kt — V9 FT.3.3 conversations domain.
 *
 * WHAT: Repository interface + immutable models for conversations
 *   (chat threads). Each conversation is a sequence of messages —
 *   user, assistant, tool. Persisted as Room entities locally for
 *   offline access and synced bidirectionally with the desktop.
 *
 * WHY: V9 §FT.3.3 mandates offline-first chat. Even when the bridge
 *   is unavailable, the user should be able to scroll back through
 *   old messages and queue new ones.
 *
 * WHERE: Implementations in `data/db/` (Room) and `data/network/`
 *   (bridge sync). Consumed by ChatScreen + ChatViewModel.
 *
 * HOW: Repository methods return Flow for streaming reads; mutating
 *   methods are suspend.
 *
 * Honest stub: interface + data classes only.
 */
package com.wotann.android.domain.conversations

import kotlinx.coroutines.flow.Flow

/**
 * Identifier for a conversation thread. ULID-shaped.
 */
@JvmInline
value class ConversationId(val value: String)

/**
 * Identifier for a single message within a conversation. ULID-shaped.
 */
@JvmInline
value class MessageId(val value: String)

/**
 * Author of a message.
 */
enum class MessageRole {
    User,
    Assistant,
    Tool,        // Tool call or tool result
    System,      // System prompt — typically hidden
}

/**
 * Immutable message record. Tool calls are encoded as Tool messages
 * with structured content; the Compose layer decodes the structure.
 */
data class Message(
    val id: MessageId,
    val conversationId: ConversationId,
    val role: MessageRole,
    val content: String,                  // Markdown for User/Assistant, JSON for Tool
    val createdAtMillis: Long,
    val tokensIn: Long,
    val tokensOut: Long,
    val costUsd: Double,
    val isStreaming: Boolean,             // True while the assistant is still streaming
)

/**
 * Conversation metadata snapshot.
 */
data class ConversationSummary(
    val id: ConversationId,
    val title: String,
    val lastMessagePreview: String,
    val lastUpdatedMillis: Long,
    val messageCount: Int,
    val totalCostUsd: Double,
    val isPinned: Boolean,
)

/**
 * Repository contract.
 *
 * TODO (V9 FT.3.3 implementation phase):
 *   - LocalConversationRepository: Room-backed
 *   - BridgeConversationRepository: WebSocket-backed
 *   - SyncedConversationRepository: composes the two with last-write-wins
 *     plus user-initiated conflict resolution
 */
interface ConversationRepository {
    /**
     * All conversations, sorted by last-updated descending.
     */
    fun observeConversations(): Flow<List<ConversationSummary>>

    /**
     * All messages in a single conversation, in chronological order.
     */
    fun observeMessages(conversationId: ConversationId): Flow<List<Message>>

    /**
     * Create a new (empty) conversation. Returns the new id.
     */
    suspend fun createConversation(title: String): ConversationId

    /**
     * Append a user message and trigger an agent response. The
     * returned MessageId is for the user message; the assistant
     * reply will appear in the observe flow once the agent responds.
     */
    suspend fun sendMessage(
        conversationId: ConversationId,
        userText: String,
    ): MessageId

    /**
     * Pin / unpin a conversation. Pinned conversations sort to the
     * top of the list.
     */
    suspend fun setPinned(conversationId: ConversationId, isPinned: Boolean)

    /**
     * Delete a conversation. Soft-delete on local + bridge — the
     * desktop preserves history for compliance even when the phone
     * marks something deleted.
     */
    suspend fun deleteConversation(conversationId: ConversationId)
}
