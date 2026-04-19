/**
 * OSC 133 parser — VT escape sequence stream parser for Warp-style blocks.
 *
 * Phase D — UNKNOWN_UNKNOWNS.md §6 flagged zero OSC 133 hits. This parser
 * converts a raw terminal byte stream (as a string of decoded characters)
 * into a sequence of `BlockEvent`s that `BlockBuffer` can consume.
 *
 * Recognised escape forms (per FinalTerm / xterm convention):
 *   ESC ] 133 ; A ST      -> prompt-begin
 *   ESC ] 133 ; B ST      -> command-begin
 *   ESC ] 133 ; C ST      -> output-begin
 *   ESC ] 133 ; D ST       -> output-end (no exit code)
 *   ESC ] 133 ; D ; N ST   -> output-end with integer exit code N
 *
 * String Terminators (ST) we accept:
 *   BEL   (\x07)                — common in shells
 *   ESC \ (\x1b\x5c)           — canonical xterm form
 *
 * Partial chunks are handled by buffering until either a ST is seen or the
 * buffered prefix cannot possibly become a valid OSC 133 (fast reject).
 * Text between escapes is emitted as `text` events preserving original bytes.
 *
 * This parser is:
 *   - pure (no side effects, no I/O)
 *   - chunk-safe (feed arbitrary substrings; no data loss at boundaries)
 *   - strict (unknown OSC codes are passed through as literal text so the
 *     underlying terminal can still interpret them)
 *   - no `any` types (per WOTANN strict rule)
 */

/** A parsed event in the OSC 133 stream. */
export type BlockEvent =
  | { readonly kind: "prompt-begin" }
  | { readonly kind: "command-begin" }
  | { readonly kind: "output-begin" }
  | { readonly kind: "output-end"; readonly exitCode?: number }
  | { readonly kind: "text"; readonly text: string };

const ESC = "\x1b";
const BEL = "\x07";
const OSC_PREFIX = `${ESC}]133;`;
// Longest possible OSC 133 payload we'd ever emit before ST:
// "D;4294967295" (11 chars + D + ;). Cap buffer to prevent DoS / runaway.
const MAX_OSC_BUFFER = 64;

/**
 * Osc133Parser — stateful, chunk-safe OSC 133 stream parser.
 *
 * Usage:
 *   const p = new Osc133Parser();
 *   const events = p.feed("prefix\x1b]133;A\x07...");
 *   for (const e of events) handle(e);
 *
 * The parser buffers partial escape sequences across feed() calls. Callers
 * MUST drive the parser to completion before destructing it; a trailing
 * half-sequence will simply not be emitted, which is the correct behaviour
 * (don't hallucinate events on incomplete input).
 */
export class Osc133Parser {
  /** Pending bytes from the previous feed() that may start an OSC sequence. */
  private pending = "";
  /** Text accumulator flushed as a single "text" event per feed() boundary
   *  between escape sequences. Keeps allocation low for long outputs. */
  private textAccum = "";

  /**
   * Feed a chunk of the raw terminal stream. Returns zero or more events in
   * emission order. Events NEVER cross a chunk boundary inconsistently — a
   * partial escape at end-of-chunk is held until the next feed().
   */
  feed(chunk: string): readonly BlockEvent[] {
    if (chunk.length === 0 && this.pending.length === 0 && this.textAccum.length === 0) {
      return [];
    }

    const events: BlockEvent[] = [];
    // Work buffer is whatever the previous chunk didn't consume, plus the
    // new chunk. We never mutate the caller's chunk.
    const buf = this.pending + chunk;
    this.pending = "";

    let i = 0;
    while (i < buf.length) {
      // Scan for the next potential OSC 133 prefix. If none, everything
      // remaining is text (modulo a possible partial ESC at the tail).
      const escIdx = buf.indexOf(ESC, i);
      if (escIdx === -1) {
        // No escape — everything from i is text.
        this.textAccum += buf.slice(i);
        i = buf.length;
        break;
      }

      // Append everything before the ESC as literal text.
      if (escIdx > i) {
        this.textAccum += buf.slice(i, escIdx);
      }

      // Is this the start of an OSC 133? We need at least OSC_PREFIX length
      // of buffered bytes to know. If not enough, stash the tail as pending.
      if (escIdx + OSC_PREFIX.length > buf.length) {
        // Might still become an OSC — stash from ESC onwards.
        this.pending = buf.slice(escIdx);
        i = buf.length;
        break;
      }

      const candidate = buf.slice(escIdx, escIdx + OSC_PREFIX.length);
      if (candidate !== OSC_PREFIX) {
        // Not OSC 133. Emit the ESC + remainder (up to next ESC or end) as
        // literal text so the downstream terminal can still interpret
        // colours, CSI, other OSC codes, etc. Scan forward so we don't
        // re-examine the same ESC infinitely.
        this.textAccum += buf.slice(escIdx, escIdx + 1);
        i = escIdx + 1;
        continue;
      }

      // We have a confirmed OSC 133 prefix. Find the string terminator (ST).
      const payloadStart = escIdx + OSC_PREFIX.length;
      const stIdx = this.findST(buf, payloadStart);
      if (stIdx === -1) {
        // Incomplete — stash everything from ESC onwards.
        // Guard against runaway buffering from a malicious / broken stream:
        // if the payload has grown past MAX_OSC_BUFFER without a ST, give up
        // on this attempt, emit the raw prefix as text, and resume.
        if (buf.length - escIdx > MAX_OSC_BUFFER) {
          this.textAccum += buf.slice(escIdx, escIdx + OSC_PREFIX.length);
          i = escIdx + OSC_PREFIX.length;
          continue;
        }
        this.pending = buf.slice(escIdx);
        i = buf.length;
        break;
      }

      // Extract the payload (e.g. "A" or "D;0") and decode it.
      const payload = buf.slice(payloadStart, stIdx.start);
      const event = this.decodePayload(payload);
      if (event) {
        // Flush any accumulated text BEFORE emitting the structured event.
        if (this.textAccum.length > 0) {
          events.push({ kind: "text", text: this.textAccum });
          this.textAccum = "";
        }
        events.push(event);
      } else {
        // Unknown OSC 133 code — pass through as literal text. Some shells
        // emit non-A/B/C/D codes (e.g. L for last-status) that we don't map.
        this.textAccum += buf.slice(escIdx, stIdx.end);
      }
      i = stIdx.end;
    }

    // Coalesce text: hold the accumulator across feed() boundaries so a
    // stream of single-byte chunks yields one "text" event per run of
    // unstructured bytes (rather than N tiny events). Text IS flushed
    // immediately before any structured event above, so ordering is
    // preserved. The tail accumulator is only emitted when (a) the next
    // feed() sees an event boundary, or (b) the caller invokes flush().
    return events;
  }

  /**
   * Flush any buffered text as a final event. Partial (unterminated) OSC
   * sequences are DISCARDED — a half-escape is not a valid event, and
   * fabricating one would violate the "don't emit on half-line" quality bar.
   */
  flush(): readonly BlockEvent[] {
    const events: BlockEvent[] = [];
    if (this.textAccum.length > 0) {
      events.push({ kind: "text", text: this.textAccum });
      this.textAccum = "";
    }
    // Intentionally drop `this.pending` — it's an incomplete escape.
    this.pending = "";
    return events;
  }

  /** True if there's buffered state (text or pending) that hasn't been flushed. */
  hasPending(): boolean {
    return this.pending.length > 0 || this.textAccum.length > 0;
  }

  /**
   * Find the next String Terminator starting at `from`. Returns both the
   * start of the ST (so we can slice the payload up to it) and the end of
   * the ST (so we can resume after it).
   */
  private findST(buf: string, from: number): { start: number; end: number } | -1 {
    // BEL is one byte; ESC \ is two. Scan for whichever comes first.
    const bel = buf.indexOf(BEL, from);
    const esc = buf.indexOf(`${ESC}\\`, from);
    if (bel === -1 && esc === -1) return -1;
    if (bel === -1) return { start: esc, end: esc + 2 };
    if (esc === -1) return { start: bel, end: bel + 1 };
    return bel < esc ? { start: bel, end: bel + 1 } : { start: esc, end: esc + 2 };
  }

  /**
   * Decode an OSC 133 payload. Returns null for unrecognised codes so the
   * caller can fall back to passing them through as literal text.
   */
  private decodePayload(payload: string): BlockEvent | null {
    // Fast-path the single-char cases.
    if (payload === "A") return { kind: "prompt-begin" };
    if (payload === "B") return { kind: "command-begin" };
    if (payload === "C") return { kind: "output-begin" };
    if (payload === "D") return { kind: "output-end" };

    // D with exit code: "D;<int>". Allow any number of semicolon-separated
    // trailing fields, but only the first after D is the exit code; shells
    // like wezterm sometimes emit extra metadata we don't currently use.
    if (payload.startsWith("D;")) {
      const rest = payload.slice(2);
      const firstField = rest.split(";")[0] ?? "";
      // Exit codes are unsigned small integers. Reject anything else.
      if (firstField.length === 0) {
        return { kind: "output-end" };
      }
      if (!/^\d+$/.test(firstField)) return null;
      const parsed = Number.parseInt(firstField, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 4_294_967_295) {
        return null;
      }
      return { kind: "output-end", exitCode: parsed };
    }

    return null;
  }
}

/** OSC 133 escape literals — exported for tests and shell-init generators. */
export const OSC_133 = Object.freeze({
  PROMPT_BEGIN: `${ESC}]133;A${BEL}`,
  COMMAND_BEGIN: `${ESC}]133;B${BEL}`,
  OUTPUT_BEGIN: `${ESC}]133;C${BEL}`,
  OUTPUT_END: `${ESC}]133;D${BEL}`,
  /** Build an output-end sequence carrying a specific exit code. */
  outputEnd(exitCode: number): string {
    if (!Number.isInteger(exitCode) || exitCode < 0) {
      throw new Error(`OSC_133.outputEnd: exitCode must be non-negative integer, got ${exitCode}`);
    }
    return `${ESC}]133;D;${exitCode}${BEL}`;
  },
});
