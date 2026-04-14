/**
 * Tool timing in model context (E6).
 *
 * Codex-style: after each tool call completes, append a brief "[timing]"
 * marker to the tool result so the model can see how long the call took
 * and reason about performance in its next step. Catches regressions
 * like "this grep suddenly takes 4s, maybe the index is stale".
 *
 * Marker format:
 *   [timing] took 423ms
 *   [timing] took 12.3s  (slow)
 *   [timing] took 1.2s   (cached)
 *
 * The marker is a single line at the end of the result. It's tiny — adds
 * ~20 tokens — but unlocks model-driven performance awareness.
 */

export interface ToolTimingAnnotation {
  readonly durationMs: number;
  readonly cached?: boolean;
  readonly baselineMs?: number;
}

/** Classify a duration into a qualitative bucket. */
export function classifyDuration(durationMs: number): "fast" | "normal" | "slow" | "very-slow" {
  if (durationMs < 100) return "fast";
  if (durationMs < 1_000) return "normal";
  if (durationMs < 10_000) return "slow";
  return "very-slow";
}

/**
 * Format a timing annotation as a single line suitable for appending to
 * a tool result. Callers should append it with a leading newline.
 */
export function formatToolTiming(ann: ToolTimingAnnotation): string {
  const d = ann.durationMs;
  const durationStr = d < 1_000 ? `${Math.round(d)}ms` : `${(d / 1_000).toFixed(1)}s`;
  const tag = classifyDuration(d);
  const slowness = tag === "slow" ? " (slow)" : tag === "very-slow" ? " (very slow)" : "";
  const cachedMarker = ann.cached ? " (cached)" : "";
  const baseline =
    ann.baselineMs !== undefined && ann.baselineMs > 0
      ? ` · baseline ${Math.round(ann.baselineMs)}ms`
      : "";
  return `[timing] took ${durationStr}${slowness}${cachedMarker}${baseline}`;
}

/**
 * Wrap a tool result string with a timing annotation. Returns the original
 * result unchanged when duration data is missing, so this can be plugged in
 * behind every tool with zero risk.
 */
export function annotateToolResult(result: string, ann: ToolTimingAnnotation | null): string {
  if (!ann) return result;
  return `${result}\n${formatToolTiming(ann)}`;
}

/**
 * Decorator that wraps an async tool handler with automatic timing. The
 * wrapper measures duration with `performance.now()` and appends the
 * timing line to the returned string. Non-string returns are passed through
 * unchanged.
 */
export function withToolTiming<Args extends unknown[], Result extends string>(
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<string> {
  return async (...args: Args): Promise<string> => {
    const start = performance.now();
    try {
      const result = await fn(...args);
      const durationMs = performance.now() - start;
      return annotateToolResult(result, { durationMs });
    } catch (err) {
      const durationMs = performance.now() - start;
      const errStr = err instanceof Error ? err.message : String(err);
      return annotateToolResult(`Error: ${errStr}`, { durationMs });
    }
  };
}

/**
 * Rolling baseline tracker — keeps the median duration of each tool name
 * across the last N calls so the prompt can include `baseline 320ms` to
 * flag regressions at a glance.
 */
export class ToolTimingBaseline {
  private readonly history = new Map<string, number[]>();
  private readonly windowSize: number;

  constructor(windowSize = 20) {
    this.windowSize = windowSize;
  }

  record(toolName: string, durationMs: number): void {
    const list = this.history.get(toolName) ?? [];
    list.push(durationMs);
    while (list.length > this.windowSize) list.shift();
    this.history.set(toolName, list);
  }

  baseline(toolName: string): number | undefined {
    const list = this.history.get(toolName);
    if (!list || list.length < 3) return undefined;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : sorted[mid];
  }

  clear(): void {
    this.history.clear();
  }

  snapshot(): Readonly<Record<string, { baselineMs: number; sampleCount: number }>> {
    const out: Record<string, { baselineMs: number; sampleCount: number }> = {};
    for (const [name, list] of this.history) {
      const baseline = this.baseline(name);
      if (baseline !== undefined) {
        out[name] = { baselineMs: baseline, sampleCount: list.length };
      }
    }
    return out;
  }
}
