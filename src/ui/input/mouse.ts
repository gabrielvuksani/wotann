/**
 * OSC 1006 extended mouse input — Wave 6-OO TUI v2 Phase 2.
 *
 * ── What this is ─────────────────────────────────────────────────────
 * A self-contained mouse-event source for the TUI. We use the
 * "SGR" (Select Graphic Rendition) extended mouse protocol — DEC mode
 * 1006 — which gives us:
 *   - Coordinates beyond column/row 223 (the X10/normal modes are
 *     limited to ASCII byte ranges).
 *   - Press, release, and (with mode 1003) move events.
 *   - A clean, deterministic ANSI parse — no ambiguous bytes mixed
 *     with the keyboard stream.
 *
 * The wire format on the input stream is:
 *
 *   ESC [ < <button>;<col>;<row> M     (press / drag)
 *   ESC [ < <button>;<col>;<row> m     (release)
 *
 * `<button>` is a bitmask: low 2 bits = button (0=L, 1=M, 2=R, 3=move),
 * bit 5 = motion flag, bit 6 = wheel.
 *
 * ── Honest fallback (QB#6) ───────────────────────────────────────────
 * Many terminals do not support OSC 1006 (legacy emulators, dumb
 * pipes, CI logs). We can NOT reliably feature-detect from the
 * outside — sending the enable bytes to a non-supporting terminal is
 * a no-op (the bytes are silently consumed). So we adopt a
 * conservative stance:
 *   - If `process.stdin.isTTY` is false, do nothing — there is no
 *     terminal to enable the mode on.
 *   - If `WOTANN_DISABLE_MOUSE=1` is set, do nothing (escape hatch
 *     for users on terminals where the protocol garbles input).
 *   - The hook always returns the latest event when one parses, and
 *     `null` otherwise. Consumers that never see an event simply get
 *     a no-op behavior — no crashes, no fake clicks.
 *
 * ── Per-instance state (QB#7) ────────────────────────────────────────
 * The MouseInputController owns its own subscriber set, raw buffer,
 * and enable flag. It is NOT a module-global singleton. Tests and
 * mocked environments can construct fresh instances with a mock
 * stdin without polluting global state. The exported
 * `useMouseEvents` hook ALSO uses per-instance React state and only
 * reaches into a shared controller when one was injected via props.
 */

import { useEffect, useRef, useState } from "react";

// ── Public types ─────────────────────────────────────────────────────

/** Mouse button identifiers exposed to consumers. */
export type MouseButton = "left" | "middle" | "right" | "wheel-up" | "wheel-down" | "none";

/** Action that produced this event. */
export type MouseAction = "press" | "release" | "move";

/** A single decoded mouse event. */
export interface MouseEvent {
  /** 1-based column of the cursor when the event fired. */
  readonly x: number;
  /** 1-based row of the cursor when the event fired. */
  readonly y: number;
  /** Logical button. `none` is used for pure motion. */
  readonly button: MouseButton;
  /** What the user did. */
  readonly action: MouseAction;
}

// ── Wire-protocol constants ──────────────────────────────────────────

/** Enable SGR (1006) extended mouse mode + any-event tracking (1003). */
export const MOUSE_ENABLE_SEQUENCE = "\x1b[?1006h\x1b[?1003h";
/** Disable both modes — restores the terminal's default cursor handling. */
export const MOUSE_DISABLE_SEQUENCE = "\x1b[?1006l\x1b[?1003l";

/** Regex matching ONE complete OSC 1006 SGR mouse report. */
// eslint-disable-next-line no-control-regex -- ANSI ESC byte (0x1B) is the
// literal first byte of every SGR mouse report. The regex parses raw
// terminal input where this control character is meaningful, not noise.
const MOUSE_REPORT_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

// ── Decoder ──────────────────────────────────────────────────────────

/**
 * Decode the button bitmask used by SGR mouse mode.
 *
 * Bits laid out per xterm's ctlseqs spec:
 *   bits 0-1 — button index (0=L, 1=M, 2=R, 3=release-on-X10/no-button)
 *   bit  2   — Shift held
 *   bit  3   — Meta/Alt held
 *   bit  4   — Control held
 *   bit  5   — Motion (drag if button held; move if not)
 *   bit  6   — Wheel event (button 0 = up, 1 = down)
 */
export function decodeMouseButton(maskByte: number, action: MouseAction): MouseButton {
  if (action === "move") return "none";

  const isWheel = (maskByte & 0b0100_0000) !== 0;
  const lowBits = maskByte & 0b0000_0011;

  if (isWheel) {
    return lowBits === 0 ? "wheel-up" : "wheel-down";
  }

  switch (lowBits) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "none";
  }
}

/**
 * Parse zero or more mouse reports from a chunk of stdin bytes.
 *
 * Returns the structured events AND the residue (bytes that did not
 * match any report) so callers can pass non-mouse bytes onward to the
 * keyboard handler. Pure function — no internal state.
 */
export function parseMouseEvents(chunk: string): {
  readonly events: readonly MouseEvent[];
  readonly residue: string;
} {
  const events: MouseEvent[] = [];
  let residue = "";
  let lastIndex = 0;

  // Re-create the regex per call to avoid lastIndex bleed across
  // unrelated chunks (the global flag stores state on the regex).
  const pattern = new RegExp(MOUSE_REPORT_PATTERN.source, "g");
  let match: RegExpExecArray | null = pattern.exec(chunk);

  while (match !== null) {
    residue += chunk.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;

    const maskRaw = Number.parseInt(match[1] ?? "0", 10);
    const x = Number.parseInt(match[2] ?? "0", 10);
    const y = Number.parseInt(match[3] ?? "0", 10);
    const terminator = match[4];

    if (Number.isFinite(maskRaw) && Number.isFinite(x) && Number.isFinite(y)) {
      const isMotion = (maskRaw & 0b0010_0000) !== 0;
      const action: MouseAction = isMotion ? "move" : terminator === "M" ? "press" : "release";
      const button = decodeMouseButton(maskRaw, action);
      events.push({ x, y, button, action });
    }

    match = pattern.exec(chunk);
  }

  residue += chunk.slice(lastIndex);
  return { events, residue };
}

// ── Controller — per-instance state (QB#7) ────────────────────────────

type MouseListener = (event: MouseEvent) => void;

export interface MouseInputControllerOptions {
  /** Stdin to read from — defaults to `process.stdin`. */
  readonly stdin?: NodeJS.ReadStream;
  /** Stdout used to write enable/disable sequences. Defaults to `process.stdout`. */
  readonly stdout?: NodeJS.WriteStream;
  /** Skip enabling the mode (used in tests). */
  readonly skipEnable?: boolean;
}

/**
 * MouseInputController — owns enable/disable state + subscriber list
 * for ONE stdin/stdout pair. Construct fresh instances per UI session.
 */
export class MouseInputController {
  private readonly stdin: NodeJS.ReadStream;
  private readonly stdout: NodeJS.WriteStream;
  private readonly listeners: Set<MouseListener> = new Set();
  private buffer = "";
  private enabled = false;
  private readonly dataHandler = (data: Buffer | string): void => {
    this.handleData(typeof data === "string" ? data : data.toString("utf8"));
  };

  constructor(options: MouseInputControllerOptions = {}) {
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    if (!options.skipEnable) {
      this.enable();
    }
  }

  /** Whether mouse tracking is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Whether the current stdin/stdout pair is suitable for mouse mode. */
  isSupported(): boolean {
    if (process.env["WOTANN_DISABLE_MOUSE"] === "1") return false;
    if (!this.stdin.isTTY) return false;
    if (!this.stdout.isTTY) return false;
    return true;
  }

  enable(): void {
    if (this.enabled) return;
    if (!this.isSupported()) {
      // Honest no-op — record state, do not attach listeners.
      this.enabled = false;
      return;
    }
    this.stdout.write(MOUSE_ENABLE_SEQUENCE);
    this.stdin.on("data", this.dataHandler);
    this.enabled = true;
  }

  disable(): void {
    if (!this.enabled) return;
    this.stdout.write(MOUSE_DISABLE_SEQUENCE);
    this.stdin.off("data", this.dataHandler);
    this.enabled = false;
  }

  subscribe(listener: MouseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Number of active subscribers — exposed for tests / instrumentation. */
  listenerCount(): number {
    return this.listeners.size;
  }

  private handleData(chunk: string): void {
    this.buffer += chunk;
    const parsed = parseMouseEvents(this.buffer);
    this.buffer = parsed.residue;
    for (const event of parsed.events) {
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }
}

// ── React hook ───────────────────────────────────────────────────────

export interface UseMouseEventsOptions {
  /**
   * Optional controller injection (tests, alternate stdin). When
   * omitted, the hook lazily creates ONE controller bound to
   * process.stdin/stdout for the lifetime of the component.
   */
  readonly controller?: MouseInputController;
  /**
   * If set, ignore mouse events. Used to honor the same
   * accessibility flag the rest of the TUI listens to.
   */
  readonly disabled?: boolean;
}

/**
 * Subscribe to mouse events from the active controller.
 *
 * Returns the most recently observed event, or null when nothing
 * has happened yet (or the terminal does not support OSC 1006).
 */
export function useMouseEvents(options: UseMouseEventsOptions = {}): MouseEvent | null {
  const [event, setEvent] = useState<MouseEvent | null>(null);
  const controllerRef = useRef<MouseInputController | null>(null);
  const ownsController = useRef<boolean>(false);

  // Resolve / construct the controller exactly once per mount.
  if (controllerRef.current === null) {
    if (options.controller) {
      controllerRef.current = options.controller;
      ownsController.current = false;
    } else {
      controllerRef.current = new MouseInputController();
      ownsController.current = true;
    }
  }

  useEffect(() => {
    const controller = controllerRef.current;
    if (controller === null) return;
    if (options.disabled) return;
    if (!controller.isEnabled()) return;

    const unsubscribe = controller.subscribe((next) => {
      setEvent(next);
    });

    return () => {
      unsubscribe();
      if (ownsController.current && controller.listenerCount() === 0) {
        controller.disable();
      }
    };
  }, [options.disabled]);

  if (options.disabled) return null;
  return event;
}
