/**
 * WOTANN Raven — aperiodic mascot state machine (C17).
 *
 * Port of OpenClaw's "Critter" pattern to WOTANN's Norse theme. The
 * Critter's novelty over generic spinners was the *aperiodic cadence*
 * — frames fire at variable intervals keyed to the mascot's mood, so
 * the thing feels alive instead of mechanical. This module owns the
 * pure state engine; rendering (ASCII for the terminal, SVG for the
 * menu bar, complication for watchOS) lives in separate callers.
 *
 * Huginn (Thought) & Muninn (Memory) are Odin's ravens. The mood
 * `preening` is a nod to a bored raven fiddling with its feathers —
 * when the agent has been idle for minutes the Raven softly tidies
 * itself so the UI still shows liveness without demanding attention.
 */

export type RavenMood =
  | "idle"
  | "alert"
  | "thinking"
  | "listening"
  | "error"
  | "celebrating"
  | "preening";

export type EyeState = "open" | "half" | "closed" | "wink";
export type Facing = "left" | "right";

export interface RavenState {
  readonly mood: RavenMood;
  readonly energy: number; // 0..1 — drives animation amplitude
  readonly facing: Facing;
  readonly eye: EyeState;
  readonly since: number; // ms timestamp when mood entered
  readonly revision: number; // monotonic — useful for UI keying
}

export interface RavenContext {
  /** How many ms since the last user or agent action. */
  readonly idleMs: number;
  /** Whether a tool call is currently running. */
  readonly toolActive: boolean;
  /** Recent error count in the last 30s. */
  readonly recentErrors: number;
  /** Set true when the last agent turn completed successfully. */
  readonly justCompleted: boolean;
  /** Set true when the microphone is open (voice-mode listening). */
  readonly listening: boolean;
}

// ── Tuning constants ─────────────────────────────────────────

export const RAVEN_TUNING = {
  /** Idle ms before we drop into `preening`. */
  preeningAfterIdleMs: 60_000,
  /** Minimum ticks between aperiodic samples. */
  minTickDelayMs: 180,
  /** Maximum delay between ticks — when truly idle we barely move. */
  maxTickDelayMs: 7_000,
  /** Error recency to flip into `error` mood. */
  errorMood_recentErrorsAtLeast: 1,
} as const;

// ── State derivation ─────────────────────────────────────────

export function initialState(now: number = Date.now()): RavenState {
  return {
    mood: "idle",
    energy: 0.3,
    facing: "right",
    eye: "open",
    since: now,
    revision: 0,
  };
}

export function deriveMood(ctx: RavenContext): RavenMood {
  if (ctx.recentErrors >= RAVEN_TUNING.errorMood_recentErrorsAtLeast) return "error";
  if (ctx.justCompleted) return "celebrating";
  if (ctx.listening) return "listening";
  if (ctx.toolActive) return "thinking";
  if (ctx.idleMs >= RAVEN_TUNING.preeningAfterIdleMs) return "preening";
  if (ctx.idleMs < 1_500) return "alert";
  return "idle";
}

export function tick(prev: RavenState, ctx: RavenContext, now: number): RavenState {
  const nextMood = deriveMood(ctx);
  const moodChanged = nextMood !== prev.mood;
  const since = moodChanged ? now : prev.since;
  const nextEnergy = blendEnergy(prev.energy, targetEnergy(nextMood));
  const nextEye = nextEyeState(prev.eye, nextMood, now);
  // Facing flips on mood changes keyed to errors/completion so the
  // visual shift is explicit. Idle stretches preserve facing.
  const nextFacing: Facing =
    moodChanged && (nextMood === "error" || nextMood === "celebrating")
      ? prev.facing === "left"
        ? "right"
        : "left"
      : prev.facing;

  return {
    mood: nextMood,
    energy: nextEnergy,
    facing: nextFacing,
    eye: nextEye,
    since,
    revision: prev.revision + 1,
  };
}

function targetEnergy(mood: RavenMood): number {
  switch (mood) {
    case "error":
      return 0.85;
    case "celebrating":
      return 1.0;
    case "thinking":
      return 0.6;
    case "listening":
      return 0.7;
    case "alert":
      return 0.55;
    case "idle":
      return 0.3;
    case "preening":
      return 0.15;
  }
}

function blendEnergy(prev: number, target: number): number {
  // First-order low-pass filter so energy eases toward target instead
  // of jumping, which would look like stutter on a 60-fps display.
  return prev + (target - prev) * 0.25;
}

function nextEyeState(prev: EyeState, mood: RavenMood, now: number): EyeState {
  // Deterministic blink schedule keyed to `now` so tests can assert it.
  // Blink every ~3.2s in idle/preening; eyes stay open while active.
  if (mood === "error") return "wink"; // cheeky wink on error — playful cue
  if (mood === "celebrating") return "open";
  if (mood === "thinking") return "open";
  const blinkWindow = Math.floor(now / 3_200) % 8;
  if (blinkWindow === 0) return "closed";
  if (blinkWindow === 1 || blinkWindow === 7) return "half";
  return prev === "closed" || prev === "half" ? "open" : prev;
}

// ── Aperiodic scheduling ─────────────────────────────────────

/**
 * Returns the next tick delay for the given state. The delay is a base
 * value per-mood plus a mood-scaled jitter; the jitter ensures no two
 * consecutive frames share a timestamp, which is what gives the Raven
 * its "breathing" feel.
 *
 * `random` is injectable so tests can pin the schedule. Production
 * callers pass `Math.random`.
 */
export function nextDelayMs(state: RavenState, random: () => number = Math.random): number {
  const { mood } = state;
  const base =
    mood === "thinking"
      ? 220
      : mood === "listening"
        ? 260
        : mood === "celebrating"
          ? 300
          : mood === "error"
            ? 340
            : mood === "alert"
              ? 480
              : mood === "preening"
                ? 3_200
                : 1_600; // idle

  // Jitter is a multiplicative window so delays scale with the base.
  // Window is ±40% for active moods, ±70% for preening (bored bird).
  const jitterWindow = mood === "preening" || mood === "idle" ? 0.7 : 0.4;
  const jitter = (random() * 2 - 1) * jitterWindow;
  const raw = Math.round(base * (1 + jitter));

  const clamped = Math.max(RAVEN_TUNING.minTickDelayMs, Math.min(RAVEN_TUNING.maxTickDelayMs, raw));
  return clamped;
}

// ── ASCII renderer (terminal + early TUI usage) ──────────────

/**
 * Minimal ASCII rendering for terminal surfaces. The menu-bar SVG and
 * watchOS complication renderers will live next to this but share
 * the same state input — the whole point is that mood/energy/eye are
 * the contract, not any one visual format.
 */
export function renderAscii(state: RavenState): string {
  const eye =
    state.eye === "closed" ? "–" : state.eye === "half" ? "~" : state.eye === "wink" ? "*" : "o";
  const beakFull = state.energy > 0.55 ? "<" : "c";
  const beakRight = state.facing === "left" ? beakFull : ">";
  const beakLeft =
    state.facing === "right" ? (state.energy > 0.55 ? ">" : "c") : beakLeftFor(state);
  void beakLeft; // kept to document the two-sided beak choice
  const body = bodyForMood(state.mood, state.energy);
  return state.facing === "right" ? `${body} ${eye}${beakRight}` : `${beakRight}${eye} ${body}`;
}

function beakLeftFor(state: RavenState): string {
  return state.energy > 0.55 ? "<" : "c";
}

function bodyForMood(mood: RavenMood, energy: number): string {
  switch (mood) {
    case "thinking":
      return energy > 0.5 ? "v" : "~";
    case "error":
      return "!";
    case "celebrating":
      return "*";
    case "listening":
      return "^";
    case "alert":
      return "^";
    case "preening":
      return ".";
    case "idle":
    default:
      return "o";
  }
}
