/**
 * LoopDetector — Crush loop_detection.go port.
 *
 * Tracks the last-N tool calls per session with a hash of (tool_name,
 * canonical args). When the same hash appears ≥ threshold times within
 * the sliding window, emits a "stuck" nudge prompt:
 *
 *   "You appear to be in a loop. The last N actions were the same.
 *    Reconsider your plan."
 *
 * DESIGN NOTES:
 * - Per-session state: `Map<sessionId, RecentCallWindow>` (Quality Bar #7).
 *   Two concurrent sessions never cross-contaminate each other's windows.
 * - Windowed, not full history: old entries slide out at `windowSize`.
 * - Distinct from existing {@link DoomLoopMiddleware} (order 24):
 *   DoomLoop does exact-match + sequence + Jaccard similarity across a
 *   50-entry history; LoopDetector is a minimal Crush-parity layer that
 *   catches plain "same tool, same args, N times in a row / recently"
 *   at a smaller window. The two complement each other; this file adds
 *   a lightweight fast-path for Crush's published +1-2pp TB2 pattern.
 *
 * Crush reference: charmbracelet/crush `internal/llm/agent/loop_detection.go`
 * (not cloned locally — pattern described in
 *  docs/internal/RESEARCH_TERMINALBENCH_HARNESSES_DEEP.md §P1-B6).
 */

import { createHash } from "node:crypto";
import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// ── Types ─────────────────────────────────────────────────────

export interface LoopDetectionResult {
  readonly detected: boolean;
  readonly count: number;
  readonly toolName: string | null;
}

export interface LoopDetectorConfig {
  /** Sliding-window size (default: 10). */
  readonly windowSize: number;
  /** Hash-repetition threshold inside the window (default: 3). */
  readonly threshold: number;
}

export const DEFAULT_LOOP_CONFIG: LoopDetectorConfig = {
  windowSize: 10,
  threshold: 3,
};

interface CallEntry {
  readonly toolName: string;
  readonly hash: string;
}

interface RecentCallWindow {
  readonly entries: readonly CallEntry[];
}

// ── Canonical Args Hash ───────────────────────────────────────

/**
 * Canonicalize args by recursively sorting object keys so that
 * `{a:1,b:2}` and `{b:2,a:1}` produce identical hashes.
 * Arrays preserve order (order is meaningful for most tool args).
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, canonicalize(v)] as const);
  return Object.fromEntries(entries);
}

function hashCall(toolName: string, args: Record<string, unknown>): string {
  const canonical = JSON.stringify({
    tool: toolName,
    args: canonicalize(args),
  });
  return createHash("md5").update(canonical).digest("hex").slice(0, 12);
}

// ── Detector ──────────────────────────────────────────────────

/**
 * LoopDetector — per-session sliding-window tool-call loop detector.
 *
 * Usage:
 *   const detector = new LoopDetector();
 *   const result = detector.record(sessionId, "Bash", { cmd: "ls" });
 *   if (result.detected) {
 *     const nudge = detector.buildNudge(result);
 *     // inject nudge into next agent turn
 *   }
 */
export class LoopDetector {
  private readonly config: LoopDetectorConfig;
  // Per-session state — Quality Bar #7: no module-global cross-contamination.
  private readonly sessions = new Map<string, RecentCallWindow>();

  constructor(config?: Partial<LoopDetectorConfig>) {
    this.config = { ...DEFAULT_LOOP_CONFIG, ...config };
  }

  /**
   * Record a tool call for a session and check whether the same
   * (tool, args) hash has appeared ≥ threshold times within the
   * last windowSize entries.
   */
  record(sessionId: string, toolName: string, args: Record<string, unknown>): LoopDetectionResult {
    const hash = hashCall(toolName, args);
    const prev = this.sessions.get(sessionId);
    const prevEntries = prev?.entries ?? [];
    const updatedEntries: readonly CallEntry[] = [...prevEntries, { toolName, hash }].slice(
      -this.config.windowSize,
    );
    this.sessions.set(sessionId, { entries: updatedEntries });

    let count = 0;
    for (const entry of updatedEntries) {
      if (entry.hash === hash) count++;
    }

    if (count >= this.config.threshold) {
      return { detected: true, count, toolName };
    }
    return { detected: false, count, toolName };
  }

  /**
   * Build the "you appear stuck" nudge prompt for an emitted detection.
   * Returns null for non-detections.
   */
  buildNudge(result: LoopDetectionResult): string | null {
    if (!result.detected || !result.toolName) return null;
    return [
      "<system_reminder>",
      `You appear to be in a loop. The last ${result.count} actions were the same ` +
        `(tool: ${result.toolName}, identical arguments).`,
      "Reconsider your plan. The current approach is not making progress —",
      "step back and try a fundamentally different strategy.",
      "</system_reminder>",
    ].join("\n");
  }

  /** Clear state for a specific session (e.g., on task completion). */
  resetSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** Clear state for ALL sessions. */
  resetAll(): void {
    this.sessions.clear();
  }

  /** Number of tracked sessions — diagnostic helper. */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /** Current window length for a session — diagnostic helper. */
  getWindowLength(sessionId: string): number {
    return this.sessions.get(sessionId)?.entries.length ?? 0;
  }

  /** Current config — for tests/diagnostics. */
  getConfig(): LoopDetectorConfig {
    return this.config;
  }
}

// ── Pipeline Adapter ──────────────────────────────────────────

/**
 * Wire a LoopDetector into the middleware pipeline. Runs in the
 * `after` phase so it sees the tool call that just executed.
 *
 * Pipeline order 24.5 — sits immediately after DoomLoop (order 24)
 * so both layers contribute to the same post-tool follow-up chain.
 * The distinct order ensures deterministic layering — DoomLoop's
 * richer detector fires first, and LoopDetector adds its Crush-style
 * Nudge only if DoomLoop did not already produce a stronger message.
 */
export function createLoopDetectionMiddleware(instance: LoopDetector): Middleware {
  return {
    name: "LoopDetection",
    order: 24.5,
    after(ctx: MiddlewareContext, result: AgentResult): AgentResult {
      if (!result.toolName) return result;

      // Build args from available result properties (same shape as DoomLoop).
      const args: Record<string, unknown> = {};
      if (result.filePath) args["filePath"] = result.filePath;
      if (result.content) args["content"] = result.content.slice(0, 500);

      const detection = instance.record(ctx.sessionId, result.toolName, args);
      const nudge = instance.buildNudge(detection);

      if (!nudge) return result;

      // If DoomLoop already injected a stronger follow-up, append —
      // do NOT replace (preserve the richer message).
      return {
        ...result,
        followUp: result.followUp ? `${result.followUp}\n\n${nudge}` : nudge,
      };
    },
  };
}
