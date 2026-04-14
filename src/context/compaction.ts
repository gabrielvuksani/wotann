/**
 * Context window management with 5 compaction strategies.
 * Reduces context while preserving essential information.
 *
 * Structured summary template inspired by hermes-agent's context_compressor.py:
 *   Goal, Progress, Decisions, Files Modified, Next Steps.
 * Iterative update: when a previous summary exists, merge new info
 * instead of creating a fresh summary from scratch.
 */

export type CompactionStrategy =
  | "summarize"
  | "evict-oldest"
  | "evict-by-type"
  | "offload-to-disk"
  | "hybrid";

export interface CompactionResult {
  readonly strategy: CompactionStrategy;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly reduction: number;
  readonly evictedCount: number;
}

interface Message {
  readonly role: string;
  readonly content: string;
  readonly timestamp: number;
  readonly type?: string;
  readonly important?: boolean;
}

/** Prefix used to detect existing structured summaries. */
const SUMMARY_HEADER = "## Conversation Summary";

/**
 * Estimate token count (rough: ~4 chars per token).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build a structured summary prompt for the given conversation slice.
 *
 * When `existingSummary` is provided, the prompt asks the LLM to UPDATE
 * the existing summary with new information rather than starting fresh.
 * This follows the hermes-agent pattern of iterative summary refinement
 * across multiple compactions.
 */
export function buildStructuredSummaryPrompt(
  messagesToSummarize: string,
  startIdx: number,
  endIdx: number,
  existingSummary?: string,
): string {
  const template = `## Conversation Summary (Turns ${startIdx}-${endIdx})
**Goal**: [one sentence - what the user is trying to achieve]
**Progress**: [2-3 bullet points of what's been accomplished]
**Decisions**: [key architectural/design decisions made, if any]
**Files Modified**: [comma-separated list of file paths touched]
**Next Steps**: [1-2 sentences of what should happen next]`;

  if (existingSummary) {
    return `You are updating an existing context compaction summary. A previous compaction produced the summary below. New conversation turns have occurred since then and need to be incorporated.

PREVIOUS SUMMARY:
${existingSummary}

NEW TURNS TO INCORPORATE:
${messagesToSummarize}

Update the summary into this EXACT structure. PRESERVE all existing information that is still relevant. ADD new progress, decisions, and files. Remove information only if it is clearly obsolete.

${template}

Be specific — include file paths, command outputs, error messages, and concrete values rather than vague descriptions.`;
  }

  return `Summarize the following conversation turns into this EXACT structure:

${template}

Conversation to summarize:
${messagesToSummarize}`;
}

/**
 * Serialize messages into labeled text for the summarizer.
 * Includes role, content, and type annotations so the summary
 * can capture tool calls, file edits, and decisions.
 */
function serializeMessagesForSummary(messages: readonly Message[]): string {
  return messages
    .map((m) => {
      const typeTag = m.type ? ` (${m.type})` : "";
      return `[${m.role.toUpperCase()}${typeTag}]: ${m.content}`;
    })
    .join("\n\n");
}

/**
 * Detect whether a message contains a previous structured summary.
 */
function isStructuredSummary(message: Message): boolean {
  return message.content.startsWith(SUMMARY_HEADER)
    || message.content.includes(SUMMARY_HEADER);
}

/**
 * Extract an existing structured summary from the message list, if present.
 * Returns the summary text or undefined if none found.
 */
function extractExistingSummary(messages: readonly Message[]): string | undefined {
  // Check the first few messages (system + possible summary injection)
  const searchRange = Math.min(messages.length, 5);
  for (let i = 0; i < searchRange; i++) {
    const msg = messages[i];
    if (msg && isStructuredSummary(msg)) {
      return msg.content;
    }
  }
  return undefined;
}

/**
 * Evict oldest messages, keeping system and recent messages.
 */
export function evictOldest(
  messages: readonly Message[],
  targetTokens: number,
): readonly Message[] {
  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens <= targetTokens) return messages;

  const result = [...messages];
  // Never evict first (system) or last 5 messages
  const protectedEnd = result.length - 5;

  for (let i = 1; i < protectedEnd && totalTokens > targetTokens; i++) {
    const msg = result[i];
    if (msg && !msg.important) {
      totalTokens -= estimateTokens(msg.content);
      result.splice(i, 1);
      i--;
    }
  }

  return result;
}

/**
 * Evict by type — remove tool results first, then assistant explanations.
 */
export function evictByType(
  messages: readonly Message[],
  targetTokens: number,
): readonly Message[] {
  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens <= targetTokens) return messages;

  // Priority order for eviction: tool results -> tool calls -> assistant -> user
  const evictionOrder = ["tool", "assistant"];
  const result = [...messages];

  for (const type of evictionOrder) {
    for (let i = result.length - 6; i >= 1 && totalTokens > targetTokens; i--) {
      const msg = result[i];
      if (msg?.role === type && !msg.important) {
        totalTokens -= estimateTokens(msg.content);
        result.splice(i, 1);
      }
    }
  }

  return result;
}

/**
 * Summarize older messages into a single structured summary message.
 *
 * Uses a structured template (Goal, Progress, Decisions, Files, Next Steps)
 * inspired by hermes-agent's context_compressor.py. When a previous summary
 * exists in the conversation, produces an iterative update prompt so the
 * summaryFn can merge new information into the existing summary rather
 * than starting from scratch.
 *
 * The `summaryFn` callback receives the full structured prompt (including
 * the template and any existing summary context) as a single string argument.
 */
export function summarizeOlder(
  messages: readonly Message[],
  summaryFn: (prompt: string) => string,
  keepRecentCount: number = 10,
): readonly Message[] {
  if (messages.length <= keepRecentCount + 1) return messages;

  const system = messages[0];
  const startIdx = 1;
  const endIdx = messages.length - keepRecentCount;
  const older = messages.slice(startIdx, endIdx);
  const recent = messages.slice(endIdx);

  // Check for an existing structured summary to enable iterative updates
  const existingSummary = extractExistingSummary(messages);

  // Serialize messages and build the structured prompt
  const serialized = serializeMessagesForSummary(older);
  const structuredPrompt = buildStructuredSummaryPrompt(
    serialized,
    startIdx,
    endIdx,
    existingSummary,
  );

  // Pass the structured prompt to the callback
  const summary = summaryFn(structuredPrompt);
  const summaryMessage: Message = {
    role: "system",
    content: summary,
    timestamp: Date.now(),
    type: "summary",
  };

  return system ? [system, summaryMessage, ...recent] : [summaryMessage, ...recent];
}

/**
 * Hybrid strategy: summarize old, evict tool results, keep recent.
 */
export function compactHybrid(
  messages: readonly Message[],
  targetTokens: number,
  summaryFn: (prompt: string) => string,
): CompactionResult {
  const tokensBefore = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  // Step 1: Summarize older messages with structured template
  let compacted = summarizeOlder(messages, summaryFn, 15);

  // Step 2: Evict tool results if still over budget
  let currentTokens = compacted.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (currentTokens > targetTokens) {
    compacted = evictByType(compacted, targetTokens);
  }

  // Step 3: Evict oldest if still over
  currentTokens = compacted.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (currentTokens > targetTokens) {
    compacted = evictOldest(compacted, targetTokens);
  }

  const tokensAfter = compacted.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  return {
    strategy: "hybrid",
    tokensBefore,
    tokensAfter,
    reduction: tokensBefore > 0 ? (tokensBefore - tokensAfter) / tokensBefore : 0,
    evictedCount: messages.length - compacted.length,
  };
}
