/**
 * PostToolUse hook — V9 T3.3 Wave 2.
 *
 * Fires after every tool call completes (success OR error). WOTANN uses this to:
 *   1. Forward the event to the Observer subsystem for drift detection.
 *   2. Write a shadow-git commit if the tool was Edit/Write/MultiEdit
 *      (so the user can roll back any agent-authored change).
 *
 * Hook is FIRE-AND-FORGET style — Claude doesn't wait for a decision, it
 * just notifies us. We always return `allow`. The handler must complete
 * within `timeoutMs` (default 5000) or Claude moves on without us; the
 * Observer is built to absorb a missed event without breaking telemetry.
 */

import type { HookHandler, PostToolUsePayload, HookDecision, WaveDeps } from "../types.js";

const SHADOW_GIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

export function createPostToolUseHandler(): HookHandler<PostToolUsePayload, HookDecision> {
  return async function postToolUse(
    payload: PostToolUsePayload,
    deps: WaveDeps,
  ): Promise<HookDecision> {
    const tasks: Array<Promise<unknown>> = [];

    if (deps.observe) {
      tasks.push(safeRun(() => deps.observe!(payload)));
    }

    if (
      SHADOW_GIT_TOOLS.has(payload.toolName) &&
      deps.shadowGitWrite &&
      typeof payload.input.file_path === "string"
    ) {
      const filePath = payload.input.file_path;
      // For Write the new content is `content`; for Edit/MultiEdit it's
      // post-apply text. We pull from `output` if it carries a `result`
      // field (the tool returns the resulting text on success), else fall
      // through to the input (best-effort).
      const content = extractWrittenContent(payload);
      if (typeof content === "string") {
        tasks.push(safeRun(() => deps.shadowGitWrite!(filePath, content, payload.sessionId)));
      }
    }

    // Cost ledger — every tool call advances per-session token totals if the
    // output carries a usage block. The Claude binary surfaces these via the
    // `result` envelope; the bridge transports a flat shape.
    if (deps.recordCost) {
      const usage = extractUsage(payload.output);
      if (usage) {
        tasks.push(safeRun(() => deps.recordCost!(payload.sessionId, usage)));
      }
    }

    // We don't await with a hard timeout here because the HTTP server
    // wraps every handler in a per-route timeout. Just fire all tasks.
    await Promise.all(tasks);

    return { action: "allow" };
  };
}

function extractWrittenContent(payload: PostToolUsePayload): string | null {
  if (typeof payload.input.content === "string") return payload.input.content;
  if (typeof payload.input.new_string === "string") return payload.input.new_string;
  if (
    payload.output &&
    typeof payload.output === "object" &&
    "result" in payload.output &&
    typeof (payload.output as { result?: unknown }).result === "string"
  ) {
    return (payload.output as { result: string }).result;
  }
  return null;
}

function extractUsage(
  output: unknown,
): { readonly input?: number; readonly output?: number } | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;
  const usage = o.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;
  const input = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const out = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  if (input === undefined && out === undefined) return null;
  return {
    ...(input !== undefined ? { input } : {}),
    ...(out !== undefined ? { output: out } : {}),
  };
}

async function safeRun(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // Observer / shadow-git / cost-ledger failures are advisory.
  }
}
