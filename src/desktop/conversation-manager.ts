/**
 * Conversation Manager — multi-conversation management for the desktop app.
 *
 * Handles CRUD operations for conversations, persistence to disk,
 * search across all conversations, project grouping, auto-title
 * generation, and conversation forking (time-travel).
 *
 * Persistence: conversations are stored as individual JSON files
 * under .wotann/desktop/conversations/{id}.json
 *
 * All operations return new objects (immutable pattern).
 */

import type { WotannMode } from "../core/mode-cycling.js";
import type { Artifact } from "./artifacts.js";
import { resolveDefaultProvider } from "../core/default-provider.js";

// ── Types ──────────────────────────────────────────────

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly path: string;
}

export interface DesktopMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly timestamp: string;
  readonly provider?: string;
  readonly model?: string;
  readonly tokensUsed?: number;
  readonly cost?: number;
  readonly attachments?: readonly Attachment[];
  readonly artifacts?: readonly Artifact[];
  readonly isEnhanced?: boolean;
  readonly originalPrompt?: string;
}

export interface Conversation {
  readonly id: string;
  readonly title: string;
  readonly messages: readonly DesktopMessage[];
  /**
   * Provider this conversation is bound to. May be null on a brand-new
   * conversation created before the user has configured any provider —
   * the UI prompts them to pick one before sending the first message.
   */
  readonly provider: string | null;
  readonly model: string | null;
  readonly mode: WotannMode;
  readonly project?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly tags: readonly string[];
  readonly tokenCount: number;
  readonly cost: number;
}

export interface ConversationSearchResult {
  readonly conversationId: string;
  readonly conversationTitle: string;
  readonly messageId: string;
  readonly messageContent: string;
  readonly matchIndex: number;
  readonly timestamp: string;
}

export interface ConversationSummary {
  readonly id: string;
  readonly title: string;
  readonly messageCount: number;
  readonly lastMessage: string;
  readonly updatedAt: string;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly project?: string;
  readonly tags: readonly string[];
}

// ── ID Generation ──────────────────────────────────────

let idCounter = 0;

export function generateId(prefix: string): string {
  idCounter++;
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${timestamp}_${random}_${idCounter}`;
}

// ── Auto-Title ─────────────────────────────────────────

/**
 * Generate a conversation title from the first user message.
 * Truncates to 60 characters and appends ellipsis if needed.
 */
export function generateTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\n/g, " ").trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57) + "...";
}

// ── Conversation Factory ───────────────────────────────

export function createConversation(options?: {
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly mode?: WotannMode;
  readonly project?: string;
  readonly tags?: readonly string[];
}): Conversation {
  const now = new Date().toISOString();
  // S1-18: resolve the default provider honestly — caller override first,
  // then env/YAML-discovered default. If nothing is configured we leave
  // both fields null so the UI can prompt the user to pick a provider
  // instead of silently sending the first message to Anthropic.
  const discovered = resolveDefaultProvider();
  const provider =
    options?.provider !== undefined ? options.provider : (discovered?.provider ?? null);
  const model = options?.model !== undefined ? options.model : (discovered?.model ?? null);

  return {
    id: generateId("conv"),
    title: "New Conversation",
    messages: [],
    provider,
    model,
    mode: options?.mode ?? "default",
    project: options?.project,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
    tags: options?.tags ?? [],
    tokenCount: 0,
    cost: 0,
  };
}

// ── Immutable Update Operations ────────────────────────

export function addMessage(conversation: Conversation, message: DesktopMessage): Conversation {
  const tokenDelta = message.tokensUsed ?? 0;
  const costDelta = message.cost ?? 0;
  const title =
    conversation.messages.length === 0 && message.role === "user"
      ? generateTitle(message.content)
      : conversation.title;

  return {
    ...conversation,
    title,
    messages: [...conversation.messages, message],
    updatedAt: message.timestamp,
    tokenCount: conversation.tokenCount + tokenDelta,
    cost: conversation.cost + costDelta,
  };
}

export function deleteMessage(conversation: Conversation, messageId: string): Conversation {
  const msg = conversation.messages.find((m) => m.id === messageId);
  const tokenDelta = msg?.tokensUsed ?? 0;
  const costDelta = msg?.cost ?? 0;

  return {
    ...conversation,
    messages: conversation.messages.filter((m) => m.id !== messageId),
    updatedAt: new Date().toISOString(),
    tokenCount: Math.max(0, conversation.tokenCount - tokenDelta),
    cost: Math.max(0, conversation.cost - costDelta),
  };
}

export function pinConversation(conversation: Conversation, pinned: boolean): Conversation {
  return { ...conversation, pinned, updatedAt: new Date().toISOString() };
}

export function archiveConversation(conversation: Conversation, archived: boolean): Conversation {
  return { ...conversation, archived, updatedAt: new Date().toISOString() };
}

export function tagConversation(conversation: Conversation, tag: string): Conversation {
  if (conversation.tags.includes(tag)) return conversation;
  return {
    ...conversation,
    tags: [...conversation.tags, tag],
    updatedAt: new Date().toISOString(),
  };
}

export function untagConversation(conversation: Conversation, tag: string): Conversation {
  return {
    ...conversation,
    tags: conversation.tags.filter((t) => t !== tag),
    updatedAt: new Date().toISOString(),
  };
}

export function renameConversation(conversation: Conversation, title: string): Conversation {
  return { ...conversation, title, updatedAt: new Date().toISOString() };
}

// ── Fork (Time-Travel) ────────────────────────────────

/**
 * Fork a conversation at a specific message, creating a new
 * conversation with messages up to and including the specified message.
 */
export function forkConversation(
  conversation: Conversation,
  atMessageId: string,
): Conversation | null {
  const messageIndex = conversation.messages.findIndex((m) => m.id === atMessageId);
  if (messageIndex === -1) return null;

  const keptMessages = conversation.messages.slice(0, messageIndex + 1);
  const keptTokens = keptMessages.reduce((sum, m) => sum + (m.tokensUsed ?? 0), 0);
  const keptCost = keptMessages.reduce((sum, m) => sum + (m.cost ?? 0), 0);

  const now = new Date().toISOString();
  return {
    id: generateId("conv"),
    title: `Fork: ${conversation.title}`,
    messages: keptMessages,
    provider: conversation.provider,
    model: conversation.model,
    mode: conversation.mode,
    project: conversation.project,
    createdAt: now,
    updatedAt: now,
    pinned: false,
    archived: false,
    tags: [...conversation.tags, "forked"],
    tokenCount: keptTokens,
    cost: keptCost,
  };
}

// ── Search ─────────────────────────────────────────────

/**
 * Search across all conversations for messages matching the query.
 * Case-insensitive substring match on message content.
 */
export function searchConversations(
  conversations: readonly Conversation[],
  query: string,
): readonly ConversationSearchResult[] {
  const lowerQuery = query.toLowerCase();
  const results: ConversationSearchResult[] = [];

  for (const conv of conversations) {
    if (conv.archived) continue;
    for (const msg of conv.messages) {
      const lowerContent = msg.content.toLowerCase();
      const matchIndex = lowerContent.indexOf(lowerQuery);
      if (matchIndex !== -1) {
        results.push({
          conversationId: conv.id,
          conversationTitle: conv.title,
          messageId: msg.id,
          messageContent: msg.content,
          matchIndex,
          timestamp: msg.timestamp,
        });
      }
    }
  }

  return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// ── Summaries ──────────────────────────────────────────

export function toSummary(conversation: Conversation): ConversationSummary {
  const lastMsg = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    messageCount: conversation.messages.length,
    lastMessage: lastMsg?.content.slice(0, 100) ?? "",
    updatedAt: conversation.updatedAt,
    pinned: conversation.pinned,
    archived: conversation.archived,
    project: conversation.project,
    tags: conversation.tags,
  };
}

/**
 * Get conversation summaries sorted by updatedAt (most recent first),
 * with pinned conversations always on top.
 */
export function getSortedSummaries(
  conversations: readonly Conversation[],
): readonly ConversationSummary[] {
  const summaries = conversations.filter((c) => !c.archived).map(toSummary);

  const pinned = summaries.filter((s) => s.pinned);
  const unpinned = summaries.filter((s) => !s.pinned);

  const byDate = (a: ConversationSummary, b: ConversationSummary) =>
    b.updatedAt.localeCompare(a.updatedAt);

  return [...pinned.sort(byDate), ...unpinned.sort(byDate)];
}
