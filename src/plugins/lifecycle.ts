/**
 * Plugin Lifecycle Hooks — extensibility points in the agent loop.
 *
 * Hooks fire at specific points in the request/response lifecycle:
 * - pre_llm_call: Before sending to provider (modify prompt, add context)
 * - post_llm_call: After receiving response (log, transform, cache)
 * - on_session_start: When a new session begins
 * - on_session_end: When a session ends (save state, generate summary)
 * - on_tool_call: When a tool is invoked (audit, rate limit)
 * - on_compaction: Before/after context compaction
 * - on_error: On any error in the pipeline
 *
 * From Hermes v0.5.0 plugin lifecycle hooks pattern.
 */

export type LifecycleEvent =
  | "pre_llm_call"
  | "post_llm_call"
  | "on_session_start"
  | "on_session_end"
  | "on_tool_call"
  | "on_compaction"
  | "on_error"
  | "on_mode_change"
  | "on_provider_switch";

export interface LifecycleContext {
  readonly sessionId: string;
  readonly provider: string;
  readonly model: string;
  readonly mode: string;
  readonly timestamp: number;
}

export interface PreLLMCallPayload {
  prompt: string;
  systemPrompt?: string;
  tools?: readonly unknown[];
  temperature?: number;
  maxTokens?: number;
}

export interface PostLLMCallPayload {
  readonly prompt: string;
  readonly response: string;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly provider: string;
  readonly model: string;
  readonly cached: boolean;
}

export interface ToolCallPayload {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly output?: string;
  readonly success: boolean;
  readonly durationMs: number;
}

export interface CompactionPayload {
  readonly phase: "before" | "after";
  readonly contextUsage: number;
  readonly tokensBeforeCompaction: number;
  readonly tokensAfterCompaction?: number;
}

export interface ErrorPayload {
  readonly error: Error;
  readonly source: string;
  readonly recoverable: boolean;
}

export type LifecyclePayload =
  | PreLLMCallPayload
  | PostLLMCallPayload
  | ToolCallPayload
  | CompactionPayload
  | ErrorPayload
  | Record<string, unknown>;

export type LifecycleHandler = (
  event: LifecycleEvent,
  payload: LifecyclePayload,
  context: LifecycleContext,
) => Promise<LifecyclePayload | void>;

interface RegisteredHook {
  readonly id: string;
  readonly event: LifecycleEvent;
  readonly handler: LifecycleHandler;
  readonly priority: number;
  readonly pluginName: string;
}

export class PluginLifecycle {
  private readonly hooks: Map<LifecycleEvent, RegisteredHook[]> = new Map();
  private hookIdCounter = 0;

  /**
   * Register a lifecycle hook.
   * Lower priority number = earlier execution.
   */
  register(
    event: LifecycleEvent,
    handler: LifecycleHandler,
    options?: { priority?: number; pluginName?: string },
  ): string {
    const id = `hook_${++this.hookIdCounter}`;
    const hook: RegisteredHook = {
      id,
      event,
      handler,
      priority: options?.priority ?? 100,
      pluginName: options?.pluginName ?? "anonymous",
    };

    const existing = this.hooks.get(event) ?? [];
    existing.push(hook);
    existing.sort((a, b) => a.priority - b.priority);
    this.hooks.set(event, existing);

    return id;
  }

  /**
   * Unregister a lifecycle hook by ID.
   */
  unregister(hookId: string): boolean {
    for (const [, hooks] of this.hooks) {
      const idx = hooks.findIndex((h) => h.id === hookId);
      if (idx >= 0) {
        hooks.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  /**
   * Fire all hooks for an event.
   * For pre_llm_call: hooks can modify the payload (chain transformations).
   * For other events: hooks run sequentially but don't modify the payload.
   */
  async fire(
    event: LifecycleEvent,
    payload: LifecyclePayload,
    context: LifecycleContext,
  ): Promise<LifecyclePayload> {
    const hooks = this.hooks.get(event) ?? [];
    let currentPayload = payload;

    for (const hook of hooks) {
      try {
        const result = await hook.handler(event, currentPayload, context);
        // For modifiable events, use the returned payload
        if (result && (event === "pre_llm_call" || event === "on_compaction")) {
          currentPayload = result;
        }
      } catch (error) {
        // Fire error hooks if an error occurs (but don't recurse)
        if (event !== "on_error") {
          await this.fire("on_error", {
            error: error instanceof Error ? error : new Error(String(error)),
            source: `hook:${hook.pluginName}:${hook.id}`,
            recoverable: true,
          }, context);
        }
      }
    }

    return currentPayload;
  }

  /**
   * Get all registered hooks for an event.
   */
  getHooks(event: LifecycleEvent): readonly RegisteredHook[] {
    return [...(this.hooks.get(event) ?? [])];
  }

  /**
   * Get hook count by event.
   */
  getStats(): Record<LifecycleEvent, number> {
    const stats = {} as Record<string, number>;
    for (const event of [
      "pre_llm_call", "post_llm_call", "on_session_start", "on_session_end",
      "on_tool_call", "on_compaction", "on_error", "on_mode_change", "on_provider_switch",
    ] as LifecycleEvent[]) {
      stats[event] = (this.hooks.get(event) ?? []).length;
    }
    return stats as Record<LifecycleEvent, number>;
  }

  /**
   * Clear all hooks (for testing or reset).
   */
  clear(): void {
    this.hooks.clear();
    this.hookIdCounter = 0;
  }
}

// ── Prompt Queue ────────────────────────────────────────────

/**
 * Prompt Queue — queue prompts without interrupting the current run.
 * From Hermes v0.4.0 /queue command pattern.
 */

export interface QueuedPrompt {
  readonly id: string;
  readonly prompt: string;
  readonly priority: number;
  readonly queuedAt: number;
  readonly metadata?: Record<string, string>;
}

export class PromptQueue {
  private readonly queue: QueuedPrompt[] = [];
  private idCounter = 0;

  /**
   * Add a prompt to the queue.
   * Higher priority number = processed first.
   */
  enqueue(prompt: string, priority: number = 0, metadata?: Record<string, string>): QueuedPrompt {
    const entry: QueuedPrompt = {
      id: `q_${++this.idCounter}`,
      prompt,
      priority,
      queuedAt: Date.now(),
      metadata,
    };
    this.queue.push(entry);
    this.queue.sort((a, b) => b.priority - a.priority || a.queuedAt - b.queuedAt);
    return entry;
  }

  /**
   * Get and remove the next prompt from the queue.
   */
  dequeue(): QueuedPrompt | null {
    return this.queue.shift() ?? null;
  }

  /**
   * Peek at the next prompt without removing it.
   */
  peek(): QueuedPrompt | null {
    return this.queue[0] ?? null;
  }

  /**
   * Remove a specific prompt from the queue.
   */
  remove(id: string): boolean {
    const idx = this.queue.findIndex((q) => q.id === id);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  /**
   * Get all queued prompts.
   */
  getAll(): readonly QueuedPrompt[] {
    return [...this.queue];
  }

  /**
   * Get queue size.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear the entire queue.
   */
  clear(): void {
    this.queue.length = 0;
  }
}
