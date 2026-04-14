/**
 * Haptic Feedback — maps WOTANN app events to iOS haptic engine patterns.
 *
 * The iOS companion sends haptic trigger names over the WebSocket.
 * The server resolves them to pattern descriptors that the native
 * UIFeedbackGenerator on iOS translates into physical feedback.
 *
 * All data is immutable (readonly arrays + readonly interfaces).
 */

// ── Types ──────────────────────────────────────────────

export type HapticPattern =
  | "success"
  | "error"
  | "warning"
  | "selection"
  | "impact-light"
  | "impact-medium"
  | "impact-heavy";

export interface HapticEvent {
  readonly trigger: string;
  readonly pattern: HapticPattern;
}

// ── Mapping ────────────────────────────────────────────

export const HAPTIC_MAP: readonly HapticEvent[] = [
  { trigger: "message-sent", pattern: "impact-light" },
  { trigger: "response-complete", pattern: "success" },
  { trigger: "error", pattern: "error" },
  { trigger: "voice-start", pattern: "impact-medium" },
  { trigger: "voice-stop", pattern: "impact-light" },
  { trigger: "task-complete", pattern: "success" },
  { trigger: "task-failed", pattern: "error" },
  { trigger: "enhance-complete", pattern: "success" },
  { trigger: "arena-complete", pattern: "impact-heavy" },
  { trigger: "council-complete", pattern: "impact-heavy" },
  { trigger: "pairing-success", pattern: "success" },
  { trigger: "pairing-failed", pattern: "error" },
  { trigger: "budget-warning", pattern: "warning" },
  { trigger: "tab-switch", pattern: "selection" },
  { trigger: "pull-to-refresh", pattern: "impact-light" },
  { trigger: "long-press", pattern: "impact-medium" },
  { trigger: "file-received", pattern: "success" },
  { trigger: "notification-tap", pattern: "selection" },
] as const;

// ── Lookup ─────────────────────────────────────────────

const hapticIndex: ReadonlyMap<string, HapticPattern> = new Map(
  HAPTIC_MAP.map((e) => [e.trigger, e.pattern]),
);

/**
 * Resolve a trigger name to its haptic pattern.
 * Returns `null` when the trigger has no mapped pattern.
 */
export function resolveHaptic(trigger: string): HapticPattern | null {
  return hapticIndex.get(trigger) ?? null;
}

/**
 * List all recognized trigger names.
 */
export function listTriggers(): readonly string[] {
  return HAPTIC_MAP.map((e) => e.trigger);
}
