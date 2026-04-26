/**
 * Sound cues — Wave 6-OO TUI v2 Phase 2 optional audible feedback.
 *
 * ── Why this exists ───────────────────────────────────────────────
 * Some users — particularly those running long-form agent loops in
 * the background — want an audible nudge when the assistant
 * finishes or hits an error. We can't render real audio from a TUI
 * (no audio driver), but every halfway-modern terminal still
 * honours BEL (`\x07`), which usually maps to a system bell or a
 * visual flash.
 *
 * ── Off by default (QB#6 — honest defaults) ───────────────────────
 * Sound is OPT-IN. `WOTANN_SOUND_CUES=1` enables it. Defaulting
 * sound on would surprise users in shared offices and on speakers.
 *
 * ── Honest no-op when stdout cannot beep ──────────────────────────
 * - If stdout is not a TTY (pipe, log file, CI) the BEL byte is
 *   meaningless — do nothing.
 * - If `WOTANN_SOUND_CUES` is anything other than the literal "1",
 *   do nothing. We do not honour "true", "yes", etc., per the
 *   strict-string-equality bar (Session 4 quality bar #13).
 * - If a write fails (e.g. EPIPE on a closed terminal), the
 *   error is swallowed silently — sound is decorative, never
 *   load-bearing.
 *
 * ── Per-instance state (QB#7) ─────────────────────────────────────
 * The SoundCueController carries its own enable flag and stdout
 * reference. Module-globals would prevent tests from running in
 * parallel against different mock streams.
 */

/** Cue identifiers used by the rest of the TUI. */
export type SoundCueKind = "session-start" | "complete" | "error" | "notice";

/** BEL byte — sent to stdout to ring a terminal bell. */
const BEL_BYTE = "\x07";

/** Strict env value that enables sound cues. */
const ENABLE_VALUE = "1";

/** Env var that toggles sound on. */
const ENV_VAR = "WOTANN_SOUND_CUES";

// ── Public detection ─────────────────────────────────────────────────

/**
 * True iff env + stdout indicate that we may safely play a cue.
 * Pure function — does not actually emit anything.
 */
export function soundCuesEnabled(
  options: {
    readonly env?: NodeJS.ProcessEnv;
    readonly stdout?: NodeJS.WriteStream;
  } = {},
): boolean {
  const env = options.env ?? process.env;
  const stdout = options.stdout ?? process.stdout;
  if (env[ENV_VAR] !== ENABLE_VALUE) return false;
  if (!stdout.isTTY) return false;
  return true;
}

// ── Controller ───────────────────────────────────────────────────────

export interface SoundCueControllerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly stdout?: NodeJS.WriteStream;
  /**
   * Throttle cues fired in quick succession. Defaults to 200ms —
   * if the same kind fires twice within that window, only the
   * first is heard. Set to 0 to disable throttling.
   */
  readonly throttleMs?: number;
}

/**
 * SoundCueController — a per-session sound emitter.
 *
 * Applications construct ONE controller at startup and call
 * `play(kind)` whenever they want a cue. The controller checks
 * env and stdout each time so that toggling `WOTANN_SOUND_CUES`
 * mid-run takes effect without restarting the process.
 */
export class SoundCueController {
  private readonly env: NodeJS.ProcessEnv;
  private readonly stdout: NodeJS.WriteStream;
  private readonly throttleMs: number;
  private readonly lastFireAt: Map<SoundCueKind, number> = new Map();

  constructor(options: SoundCueControllerOptions = {}) {
    this.env = options.env ?? process.env;
    this.stdout = options.stdout ?? process.stdout;
    this.throttleMs = options.throttleMs ?? 200;
  }

  /** Whether `play()` will actually emit anything right now. */
  isEnabled(): boolean {
    return soundCuesEnabled({ env: this.env, stdout: this.stdout });
  }

  /**
   * Play a cue. Returns true iff a BEL was actually written. The
   * return value is mainly useful for tests — production callers
   * can fire-and-forget.
   */
  play(kind: SoundCueKind, now: number = Date.now()): boolean {
    if (!this.isEnabled()) return false;
    const last = this.lastFireAt.get(kind) ?? 0;
    if (this.throttleMs > 0 && now - last < this.throttleMs) return false;
    this.lastFireAt.set(kind, now);
    try {
      this.stdout.write(BEL_BYTE);
      return true;
    } catch {
      // EPIPE on a closed terminal is harmless — sound is decorative.
      return false;
    }
  }

  /** Reset throttle state. Used in tests. */
  resetThrottle(): void {
    this.lastFireAt.clear();
  }
}

// ── Convenience module-level helper ─────────────────────────────────

let defaultController: SoundCueController | null = null;

/**
 * Lazy default controller bound to `process.stdout`. Use this when
 * you do not need to inject a custom env/stdout. Tests SHOULD
 * construct their own SoundCueController instead — the default
 * controller is a process-global convenience.
 */
function getDefaultController(): SoundCueController {
  if (defaultController === null) {
    defaultController = new SoundCueController();
  }
  return defaultController;
}

/**
 * Fire a sound cue using the process-default controller.
 *
 * Exists so simple call sites don't have to thread a controller
 * through. For complex tests use a fresh `SoundCueController`.
 */
export function playSoundCue(kind: SoundCueKind): boolean {
  return getDefaultController().play(kind);
}

/** Reset the process-default controller (test-only utility). */
export function __resetDefaultSoundController(): void {
  defaultController = null;
}
