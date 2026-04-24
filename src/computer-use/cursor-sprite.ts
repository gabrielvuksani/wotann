/**
 * V9 T11.1 — Cursor Sprite (wiggle + Bezier overlay)
 *
 * Pure-TS geometry + color primitives for the parallel virtual-cursor
 * pool. This module owns:
 *
 *   - Linear interpolation (`lerp`) — used by the input arbiter's
 *     per-tick smoothing (straight-line approach toward a target).
 *   - 3-point Bezier (`bezierPoint`) — used by cursor-sprite to trace a
 *     natural, non-linear path through an inferred mid-control point.
 *   - Deterministic `wiggle` — small per-tick perturbation around a
 *     target. Uses a simple xorshift-style scrambler so replays at the
 *     same (center, amplitude, seed) produce IDENTICAL motion. Needed
 *     for test-time reproducibility (QB #12 — no wall-clock bleed).
 *   - `buildSprite` — picks a cursor color distinct from the supplied
 *     wallpaper background by rotating the hue 180° on the HSL wheel.
 *
 * Deliberate non-goals: no rasterization, no window-system integration.
 * The parent package turns a `CursorFrame` into pixels; we just compute
 * positions and colors. Keeping this module OS-agnostic is what lets a
 * Tauri / Electron / native overlay consume it unchanged.
 *
 * Everything is `readonly` by convention (per project immutability
 * rules). No mutation; helpers return new objects.
 */

// ── Types ──────────────────────────────────────────────────

export interface CursorSprite {
  readonly sessionId: string;
  /** HSL hue in degrees, 0..360. */
  readonly hue: number;
  /** HSL saturation, 0..100 (percent). */
  readonly saturation: number;
  /** HSL lightness, 0..100 (percent). */
  readonly lightness: number;
  /** Default 24 (matches a typical system cursor). */
  readonly sizePx: number;
}

export interface CursorFrame {
  readonly sessionId: string;
  readonly x: number;
  readonly y: number;
  readonly timestamp: number;
  /**
   * Optional motion trail — most recent sample first. `age` is in
   * arbiter-ticks (integer) so the overlay can fade them out without
   * needing wall-clock math.
   */
  readonly trail?: readonly { readonly x: number; readonly y: number; readonly age: number }[];
}

// ── Math helpers ───────────────────────────────────────────

/**
 * Linear interpolation. `t=0` → `a`, `t=1` → `b`. `t` is NOT clamped;
 * values outside `[0, 1]` extrapolate (useful for spring-ish overshoot
 * if a caller passes `t > 1`).
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp a scalar into a closed interval. Not exported beyond the
 * module — the public API prefers unclamped primitives and clamps
 * only where a hard bound is load-bearing (trail age, HSL channels).
 */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * 3-point quadratic Bezier. P0 → P2 with P1 as the control handle.
 * `t` is clamped to `[0, 1]` so callers can't accidentally produce a
 * point outside the curve's span by passing an out-of-range `t`.
 *
 * Formula:   B(t) = (1-t)² P0 + 2 (1-t) t P1 + t² P2
 */
export function bezierPoint(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  t: number,
): [number, number] {
  const u = clamp(t, 0, 1);
  const one = 1 - u;
  const a = one * one;
  const b = 2 * one * u;
  const c = u * u;
  return [a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]];
}

/**
 * Deterministic pseudo-random in `[0, 1)` from a 32-bit seed. Uses a
 * mulberry32-style scrambler — short, stable across JS engines, good
 * enough for sub-pixel wiggle. NOT a crypto PRNG.
 */
function prng01(seed: number): number {
  let s = (seed | 0) + 0x6d2b79f5;
  s = Math.imul(s ^ (s >>> 15), s | 1);
  s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
  return ((s ^ (s >>> 14)) >>> 0) / 0x1_0000_0000;
}

/**
 * Natural cursor wiggle. Produces a point slightly offset from
 * `center` by at most `amplitude` on each axis. Given the same seed
 * the function returns the exact same offset — tests can assert
 * reproducibility without mocking `Math.random()`.
 *
 * The two axes use different seed derivatives so horizontal and
 * vertical jitter are uncorrelated (real cursors don't jiggle along
 * the y = x diagonal).
 */
export function wiggle(
  center: readonly [number, number],
  amplitude: number,
  seed: number,
): [number, number] {
  // Centered in [-amplitude, +amplitude] on each axis.
  const rx = (prng01(seed * 0x9e37 + 0x1) - 0.5) * 2 * amplitude;
  const ry = (prng01(seed * 0x9e37 + 0x2) - 0.5) * 2 * amplitude;
  return [center[0] + rx, center[1] + ry];
}

// ── Color helpers ──────────────────────────────────────────

/**
 * Convert 8-bit RGB `[0..255]^3` to HSL with `h ∈ [0, 360)`,
 * `s, l ∈ [0, 100]`. Standard reference implementation — kept inline
 * because importing a color lib for a 20-line routine would violate
 * the "stdlib-only" constraint.
 */
function rgbToHsl(rgb: readonly [number, number, number]): [number, number, number] {
  const r = clamp(rgb[0], 0, 255) / 255;
  const g = clamp(rgb[1], 0, 255) / 255;
  const b = clamp(rgb[2], 0, 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return [0, 0, l * 100];
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  h = (h * 60) % 360;
  if (h < 0) h += 360;
  return [h, s * 100, l * 100];
}

/**
 * Rotate a hue by 180° on the color wheel, keeping it in `[0, 360)`.
 * The canonical "maximum contrast" operation on HSL.
 */
function complementHue(h: number): number {
  return (h + 180) % 360;
}

/**
 * Build a sprite whose color contrasts with the supplied background.
 *
 * Contrast strategy (intentionally simple):
 *   1. Compute the background's HSL.
 *   2. Pick hue = complement (H + 180°).
 *   3. Force saturation to 80 % — pastel-ish cursors vanish on bright
 *      wallpapers, so we bias toward vivid.
 *   4. Force lightness to 50 % (middle-gray-luminance range). A 90 %
 *      lightness cursor disappears on a white desktop and vice versa.
 *
 * The session id is taken verbatim — the sprite is the sole visual
 * identity of a virtual cursor and must survive round-trips through
 * the event log without collision.
 */
export function buildSprite(
  sessionId: string,
  backgroundRgb: readonly [number, number, number],
): CursorSprite {
  const [bgH] = rgbToHsl(backgroundRgb);
  const hue = complementHue(bgH);
  return {
    sessionId,
    hue,
    saturation: 80,
    lightness: 50,
    sizePx: 24,
  };
}

/**
 * Test / consumer utility — compose an RGB sample from the sprite's
 * HSL triplet. Not part of the spec's required surface but needed by
 * buildSprite contrast tests (a hue 180° away isn't obviously visible
 * without a real rendering check, so we reconstruct RGB here). Kept
 * internal to the project via export; the overlay layer can use it to
 * style the cursor glyph.
 */
export function spriteToRgb(sprite: CursorSprite): [number, number, number] {
  const h = sprite.hue / 360;
  const s = sprite.saturation / 100;
  const l = sprite.lightness / 100;

  if (s === 0) {
    const gray = Math.round(l * 255);
    return [gray, gray, gray];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const hueToRgb = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const r = hueToRgb(h + 1 / 3);
  const g = hueToRgb(h);
  const b = hueToRgb(h - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}
