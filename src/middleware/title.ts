/**
 * TitleMiddleware — auto-generate conversation title after the first N turns.
 *
 * Ported from deer-flow (bytedance/deer-flow) Lane 2:
 *   packages/harness/deerflow/agents/middlewares/title_middleware.py
 *
 * WOTANN currently shows "Thread <sessionId>" in its UI. This middleware
 * generates a short, human-readable title once the conversation has
 * enough signal (default: 3 turns = at least 2 user messages + 1
 * assistant response). The generated title is stored on the context so
 * the runtime / UI can persist it.
 *
 * Generation strategy (provider-agnostic):
 *   - Primary: caller-supplied async generator that takes the prompt and
 *     returns a title string. The generator is NOT tied to any specific
 *     provider — callers pass a function that uses whatever provider
 *     adapter they want (or a deterministic stub in tests).
 *   - Fallback: local heuristic — take the first user message, trim
 *     punctuation, cap at max chars.
 *
 * Honest stub: without a supplied generator, the middleware only returns
 * the local heuristic title. That is deliberate — silently succeeding
 * with "Untitled" would mask the missing wiring.
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import type { AgentMessage } from "../core/types.js";

// -- Config ---------------------------------------------------------------

export interface TitleOptions {
  /** Minimum number of conversation turns before generating. Default: 3. */
  readonly minTurns?: number;
  /** Max characters in the final title. Default: 60. */
  readonly maxChars?: number;
  /** Max words in the final title. Default: 8. */
  readonly maxWords?: number;
  /**
   * Optional async title generator. If omitted, only the local heuristic
   * is used — the agent is never invoked.
   */
  readonly generator?: TitleGenerator;
}

export interface TitleGeneratorInput {
  readonly userMessage: string;
  readonly assistantMessage: string;
  readonly maxWords: number;
}

export type TitleGenerator = (input: TitleGeneratorInput) => Promise<string>;

export interface TitleStats {
  readonly totalGenerated: number;
  readonly totalFallbacks: number;
  readonly totalSkipped: number;
}

// -- Context extension ---------------------------------------------------

declare module "./types.js" {
  interface MiddlewareContext {
    /** Auto-generated conversation title. Stamped by TitleMiddleware. */
    title?: string;
  }
}

// -- Utility --------------------------------------------------------------

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function normalizeTitle(raw: string, maxChars: number): string {
  const stripped = stripThinkTags(raw);
  const trimmed = stripped.trim().replace(/^["']+|["']+$/g, "");
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars).trimEnd() : trimmed;
}

function firstUserMessage(history: readonly AgentMessage[]): string {
  for (const msg of history) {
    if (msg.role === "user") return msg.content;
  }
  return "";
}

function firstAssistantMessage(history: readonly AgentMessage[]): string {
  for (const msg of history) {
    if (msg.role === "assistant" && !msg.toolCallId) return msg.content;
  }
  return "";
}

function countTurnsByRole(history: readonly AgentMessage[]): {
  readonly user: number;
  readonly assistant: number;
} {
  let user = 0;
  let assistant = 0;
  for (const msg of history) {
    if (msg.role === "user") user++;
    else if (msg.role === "assistant" && !msg.toolCallId) assistant++;
  }
  return { user, assistant };
}

function fallbackTitle(userMsg: string, maxChars: number): string {
  const source = userMsg.trim();
  if (source.length === 0) return "New Conversation";
  const oneLine = source.replace(/\s+/g, " ");
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

// -- Middleware class -----------------------------------------------------

export class TitleMiddleware {
  private readonly minTurns: number;
  private readonly maxChars: number;
  private readonly maxWords: number;
  private readonly generator: TitleGenerator | undefined;

  private totalGenerated = 0;
  private totalFallbacks = 0;
  private totalSkipped = 0;

  constructor(options: TitleOptions = {}) {
    this.minTurns = options.minTurns ?? 3;
    this.maxChars = options.maxChars ?? 60;
    this.maxWords = options.maxWords ?? 8;
    this.generator = options.generator;
  }

  /**
   * Decide whether a title should be generated given the current history
   * and any existing title on the context.
   */
  shouldGenerate(ctx: MiddlewareContext): boolean {
    if (ctx.title && ctx.title.length > 0) return false;
    const total = ctx.recentHistory.length;
    if (total < this.minTurns) return false;
    const { user, assistant } = countTurnsByRole(ctx.recentHistory);
    return user >= 1 && assistant >= 1;
  }

  /**
   * Produce a title for the given history. Uses the caller-supplied
   * generator when available; otherwise uses the deterministic
   * fallback.
   */
  async generate(history: readonly AgentMessage[]): Promise<string> {
    const userMsg = firstUserMessage(history);
    const assistantMsg = firstAssistantMessage(history);

    if (!this.generator) {
      this.totalFallbacks++;
      return fallbackTitle(userMsg, this.maxChars);
    }

    try {
      const raw = await this.generator({
        userMessage: userMsg.slice(0, 500),
        assistantMessage: assistantMsg.slice(0, 500),
        maxWords: this.maxWords,
      });
      const normalized = normalizeTitle(raw, this.maxChars);
      if (normalized.length > 0) {
        this.totalGenerated++;
        return normalized;
      }
      this.totalFallbacks++;
      return fallbackTitle(userMsg, this.maxChars);
    } catch {
      this.totalFallbacks++;
      return fallbackTitle(userMsg, this.maxChars);
    }
  }

  getStats(): TitleStats {
    return {
      totalGenerated: this.totalGenerated,
      totalFallbacks: this.totalFallbacks,
      totalSkipped: this.totalSkipped,
    };
  }

  reset(): void {
    this.totalGenerated = 0;
    this.totalFallbacks = 0;
    this.totalSkipped = 0;
  }

  /** Exposed for tests — increment the skipped counter. */
  markSkipped(): void {
    this.totalSkipped++;
  }
}

// -- Pipeline adapter -----------------------------------------------------

export function createTitleMiddleware(instance: TitleMiddleware): Middleware {
  return {
    name: "Title",
    order: 17.5,
    async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
      if (!instance.shouldGenerate(ctx)) {
        instance.markSkipped();
        return ctx;
      }
      const title = await instance.generate(ctx.recentHistory);
      return {
        ...ctx,
        title,
      };
    },
  };
}
