/**
 * Stage-0 pressure-relief: truncate verbose tool-call args in messages
 * outside the keep-window. Preserves structure (tool message ordering
 * intact, IDs preserved, role/toolName/toolCallId fields kept) so the
 * model still sees "this tool was called with truncated args" rather
 * than confusion from missing tool calls.
 *
 * WOTANN's AgentMessage stores the verbose payload — write_file content,
 * edit_file patches, execute output — in the `content` field of tool
 * and assistant messages. This module trims those payloads in OUTSIDE
 * the keep-window, leaving the most-recent slice intact for cache
 * locality and recent-context fidelity.
 *
 * Stage-0 fires at ~50% context pressure. Stage-1 (full LLM-based
 * summarization in compactConversationHistory) remains the existing
 * path at higher pressure (>=85%).
 *
 * Inspired by langchain-ai/deepagents
 *   libs/deepagents/deepagents/middleware/summarization.py:122-149
 *   (TruncateArgsSettings).
 */

export interface TruncateArgsConfig {
  /** Fraction of context budget at which Stage-0 fires (0..1). Default 0.5. */
  readonly triggerFrac: number;
  /** Fraction of most-recent messages to keep untouched (0..1). Default 0.10. */
  readonly keepFrac: number;
  /** Hard cap on per-arg/content string length in bytes. Default 2000. */
  readonly maxArgLen: number;
  /** Marker substituted for clipped values. */
  readonly clipMarker: string;
}

export const DEFAULT_TRUNCATE_ARGS: TruncateArgsConfig = {
  triggerFrac: 0.5,
  keepFrac: 0.1,
  maxArgLen: 2000,
  clipMarker: "<...argument truncated>",
};

/**
 * Minimum keep-window size. We never strip the last 2 turns even on
 * tiny conversations — the model needs at least the recent question
 * + the current scratchpad to keep coherence.
 */
const MIN_KEEP_COUNT = 2;

/**
 * Shape we operate on — a message with a stringy `content` field plus
 * optional tool metadata. Compatible with WOTANN's `AgentMessage` shape.
 */
export interface TruncatableMessage {
  readonly role: string;
  readonly content: string;
  readonly toolName?: string;
  readonly toolCallId?: string;
}

export interface TruncateResult<M extends TruncatableMessage> {
  readonly messages: readonly M[];
  /** Bytes reclaimed across all clipped fields. */
  readonly bytesReclaimed: number;
  /** Number of messages whose content was clipped at least once. */
  readonly messagesAffected: number;
}

/**
 * Compute the keep-window size: at least MIN_KEEP_COUNT messages, otherwise
 * a fraction of total length. Bounded above by total length so callers
 * can pass tiny arrays without underflow.
 */
function computeKeepCount(total: number, keepFrac: number): number {
  if (total <= MIN_KEEP_COUNT) return total;
  const fractional = Math.floor(total * keepFrac);
  const safeKeep = Math.max(MIN_KEEP_COUNT, fractional);
  return Math.min(total, safeKeep);
}

/**
 * Detect whether a string represents a JSON-encoded payload (object or
 * array). We try a structural truncation when it does, and fall back
 * to a flat clip otherwise.
 */
function tryParseJSON(input: string): unknown | null {
  const trimmed = input.trimStart();
  if (!trimmed) return null;
  const first = trimmed[0];
  if (first !== "{" && first !== "[") return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

/**
 * Recursively walk a JSON value and clip any leaf string longer than
 * maxArgLen. Long arrays collapse to `[clipMarker]`; long objects
 * collapse to `{ "_truncated": clipMarker }`. Returns the new value
 * AND the bytes reclaimed for telemetry.
 */
function truncateValue(
  value: unknown,
  config: TruncateArgsConfig,
): { readonly value: unknown; readonly reclaimed: number } {
  if (typeof value === "string") {
    if (value.length <= config.maxArgLen) return { value, reclaimed: 0 };
    return { value: config.clipMarker, reclaimed: value.length - config.clipMarker.length };
  }

  if (Array.isArray(value)) {
    // Stringify upfront once; if the encoded form is short keep as-is,
    // else collapse to a single-element array carrying the marker.
    const encoded = JSON.stringify(value);
    if (encoded.length <= config.maxArgLen) return { value, reclaimed: 0 };
    return {
      value: [config.clipMarker],
      reclaimed: encoded.length - JSON.stringify([config.clipMarker]).length,
    };
  }

  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    let totalReclaimed = 0;
    const result: Record<string, unknown> = {};
    let mutated = false;

    for (const key of Object.keys(obj)) {
      const child = truncateValue(obj[key], config);
      result[key] = child.value;
      totalReclaimed += child.reclaimed;
      if (child.reclaimed > 0) mutated = true;
    }

    if (!mutated) return { value, reclaimed: 0 };

    // If after per-key trimming the object is STILL larger than the
    // cap (e.g. many medium-length keys), collapse the whole thing.
    const trimmedEncoded = JSON.stringify(result);
    if (trimmedEncoded.length > config.maxArgLen) {
      const collapsed = { _truncated: config.clipMarker };
      const originalEncoded = JSON.stringify(value);
      return {
        value: collapsed,
        reclaimed: originalEncoded.length - JSON.stringify(collapsed).length,
      };
    }

    return { value: result, reclaimed: totalReclaimed };
  }

  // numbers, booleans, null — leave untouched
  return { value, reclaimed: 0 };
}

/**
 * Truncate a single message's content. Returns the new content and the
 * number of bytes reclaimed (>0 means the content was trimmed).
 */
function truncateMessageContent(
  content: string,
  config: TruncateArgsConfig,
): { readonly content: string; readonly reclaimed: number } {
  if (content.length <= config.maxArgLen) {
    return { content, reclaimed: 0 };
  }

  // Try JSON-aware truncation first so structured payloads keep their
  // shape (and the model still parses them).
  const parsed = tryParseJSON(content);
  if (parsed !== null) {
    const trimmed = truncateValue(parsed, config);
    if (trimmed.reclaimed > 0) {
      const encoded = JSON.stringify(trimmed.value);
      return { content: encoded, reclaimed: content.length - encoded.length };
    }
  }

  // Flat clip: head + marker + tail. Keeping head + tail preserves
  // file paths and line numbers at the start and any closing context
  // at the end (often a stack trace tail or a closing brace).
  const headLen = Math.floor(config.maxArgLen * 0.6);
  const tailLen = Math.floor(config.maxArgLen * 0.2);
  const head = content.slice(0, headLen);
  const tail = content.slice(content.length - tailLen);
  const clipped = `${head}\n${config.clipMarker}\n${tail}`;
  return { content: clipped, reclaimed: content.length - clipped.length };
}

/**
 * Whether a message is a candidate for truncation. We target tool
 * messages (which carry the verbose tool output) and assistant
 * messages (which may carry multi-thousand-char tool_use payloads
 * inlined into content). System and user messages are left alone —
 * they're prompts and questions, not bulk data.
 */
function isTruncationCandidate(message: TruncatableMessage): boolean {
  return message.role === "tool" || message.role === "assistant";
}

/**
 * Stage-0 pressure-relief truncator.
 *
 * For each message OUTSIDE the keep-window: if the role is tool/assistant
 * and the content is longer than maxArgLen, replace it with a clipped
 * form. Recent N messages are returned untouched.
 *
 * Returns a new immutable array — callers must NOT pass the result back
 * into persistent storage. Use it as the prompt copy only.
 */
export function truncateToolArgs<M extends TruncatableMessage>(
  messages: readonly M[],
  config: TruncateArgsConfig = DEFAULT_TRUNCATE_ARGS,
): TruncateResult<M> {
  if (messages.length === 0) {
    return { messages, bytesReclaimed: 0, messagesAffected: 0 };
  }

  const keepCount = computeKeepCount(messages.length, config.keepFrac);
  const truncateBoundary = messages.length - keepCount;

  // Fast path: if every message stays in the keep window, return original.
  if (truncateBoundary <= 0) {
    return { messages, bytesReclaimed: 0, messagesAffected: 0 };
  }

  const out: M[] = new Array<M>(messages.length);
  let bytesReclaimed = 0;
  let messagesAffected = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const inKeepWindow = i >= truncateBoundary;
    if (inKeepWindow || !isTruncationCandidate(msg)) {
      out[i] = msg;
      continue;
    }

    const { content: newContent, reclaimed } = truncateMessageContent(msg.content, config);
    if (reclaimed > 0) {
      // Immutable update: spread original then overwrite content.
      out[i] = { ...msg, content: newContent };
      bytesReclaimed += reclaimed;
      messagesAffected += 1;
    } else {
      out[i] = msg;
    }
  }

  return { messages: out, bytesReclaimed, messagesAffected };
}

/**
 * Cheap predicate: should Stage-0 fire right now?
 *
 * Returns true when the current usage is at or above the trigger
 * threshold AND below the Stage-1 hard threshold (caller's choice,
 * default 0.85). Callers should plug in their own pressure source.
 */
export function shouldTriggerStage0(
  currentTokens: number,
  maxTokens: number,
  config: TruncateArgsConfig = DEFAULT_TRUNCATE_ARGS,
  stage1Frac: number = 0.85,
): boolean {
  if (maxTokens <= 0) return false;
  const usageFrac = currentTokens / maxTokens;
  return usageFrac >= config.triggerFrac && usageFrac < stage1Frac;
}
