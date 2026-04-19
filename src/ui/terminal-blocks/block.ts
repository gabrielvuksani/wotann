/**
 * Block — Warp-style terminal block data model.
 *
 * Phase D — Warp parity: each block wraps a prompt + command + output into a
 * single addressable unit of work. The `BlockBuffer` feeds on OSC 133 events
 * and emits completed `Block` records; incomplete blocks are held in-progress
 * until D (output-end) arrives.
 *
 * References:
 *   - OSC 133 spec: https://wezterm.org/shell-integration.html
 *   - Warp blocks:  https://docs.warp.dev/features/blocks
 *   - UNKNOWN_UNKNOWNS.md §6 (OSC 133 gap)
 *   - Lane 4: Block.tsx primitive (zero imports) — wired downstream.
 *
 * This module is provider-agnostic and runtime-neutral. It MUST NOT import
 * runtime, ink, React, or any I/O. Pure data transform over BlockEvent[].
 */

import type { BlockEvent } from "./osc-133-parser.js";

/** A single Warp-style terminal block. */
export interface Block {
  /** Monotonically increasing id, assigned by BlockBuffer. */
  readonly id: string;
  /** Raw prompt text emitted between the A (prompt-start) and B (cmd-start)
   *  markers. Typically something like `gabriel@mac ~/proj %`. May be empty
   *  if the shell skipped the prompt-begin marker. */
  readonly promptText: string;
  /** Raw command text emitted between B (cmd-start) and C (output-start). */
  readonly commandText: string;
  /** Output text emitted between C (output-start) and D (output-end). */
  readonly output: string;
  /** Exit code reported by D — undefined if shell did not emit one. */
  readonly exitCode?: number;
  /** Milliseconds between B and D. Undefined if block is still running. */
  readonly durationMs?: number;
  /** Epoch ms when B fired (command-begin). Undefined before B. */
  readonly startedAt?: number;
  /** Epoch ms when D fired (output-end). Undefined before D. */
  readonly endedAt?: number;
}

/**
 * In-progress block builder. Purely internal to BlockBuffer; kept separate
 * from the immutable `Block` type so callers can't observe half-built state.
 */
interface BlockDraft {
  id: string;
  promptText: string;
  commandText: string;
  output: string;
  exitCode?: number;
  startedAt?: number;
  endedAt?: number;
  /** Which OSC 133 markers we've seen so far — state machine cursor. */
  phase: "idle" | "prompt" | "command" | "output";
}

/** Options for BlockBuffer. */
export interface BlockBufferOptions {
  /** Clock injection for tests (defaults to Date.now). */
  readonly now?: () => number;
  /** Id generator — defaults to monotonic counter "blk-N". */
  readonly nextId?: () => string;
}

/**
 * BlockBuffer — stateful consumer of OSC 133 BlockEvents.
 *
 * Usage:
 *   const parser = new Osc133Parser();
 *   const buffer = new BlockBuffer();
 *   for (const chunk of stream) {
 *     const events = parser.feed(chunk);
 *     for (const ev of events) {
 *       const block = buffer.consume(ev);
 *       if (block) onBlockComplete(block);
 *     }
 *   }
 *
 * The buffer is deliberately single-threaded: one draft block at a time.
 * If the shell interleaves prompts (e.g. background jobs printing between
 * A and D), output is appended to whichever block is currently open. Shells
 * that care about precise attribution should emit OSC 133 for each job.
 */
export class BlockBuffer {
  private readonly now: () => number;
  private readonly nextId: () => string;
  private draft: BlockDraft | null = null;
  private counter = 0;

  constructor(options: BlockBufferOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.nextId =
      options.nextId ??
      ((): string => {
        this.counter += 1;
        return `blk-${this.counter}`;
      });
  }

  /**
   * Consume one parsed OSC 133 event. Returns a finished `Block` iff the
   * event completes the current draft (D marker). Otherwise returns null
   * and the draft is updated in-place (encapsulated — callers can't see it).
   *
   * The returned Block is immutable (frozen before return).
   */
  consume(event: BlockEvent): Block | null {
    switch (event.kind) {
      case "prompt-begin": {
        // A fires — start a fresh draft. If a prior draft exists without D,
        // flush it as an implicit close so we never silently drop blocks.
        const flushed = this.flushDraftIfOpen();
        this.draft = {
          id: this.nextId(),
          promptText: "",
          commandText: "",
          output: "",
          phase: "prompt",
        };
        return flushed;
      }
      case "command-begin": {
        // B fires — mark start time, transition phase.
        if (!this.draft) {
          // Shell emitted B without A — synthesize an empty-prompt draft.
          this.draft = {
            id: this.nextId(),
            promptText: "",
            commandText: "",
            output: "",
            phase: "command",
          };
        } else {
          this.draft.phase = "command";
        }
        this.draft.startedAt = this.now();
        return null;
      }
      case "output-begin": {
        // C fires — transition to output phase.
        if (!this.draft) {
          this.draft = {
            id: this.nextId(),
            promptText: "",
            commandText: "",
            output: "",
            phase: "output",
          };
        } else {
          this.draft.phase = "output";
        }
        return null;
      }
      case "output-end": {
        // D fires — finalize and emit.
        if (!this.draft) return null;
        const endedAt = this.now();
        this.draft.endedAt = endedAt;
        if (event.exitCode !== undefined) {
          this.draft.exitCode = event.exitCode;
        }
        const finished = this.finalize(this.draft);
        this.draft = null;
        return finished;
      }
      case "text": {
        // Plain text between markers — attribute to current phase.
        if (!this.draft) return null;
        if (this.draft.phase === "prompt") {
          this.draft.promptText += event.text;
        } else if (this.draft.phase === "command") {
          this.draft.commandText += event.text;
        } else if (this.draft.phase === "output") {
          this.draft.output += event.text;
        }
        // "idle" text is ignored — it's pre-OSC output before any A marker.
        return null;
      }
      default:
        return assertNever(event);
    }
  }

  /**
   * Force-flush the current draft as a completed block (e.g. on shell
   * disconnect). Returns null if no draft is in progress.
   */
  flush(): Block | null {
    const result = this.flushDraftIfOpen();
    this.draft = null;
    return result;
  }

  /** True if a block is currently being assembled. */
  hasDraft(): boolean {
    return this.draft !== null;
  }

  private flushDraftIfOpen(): Block | null {
    if (!this.draft) return null;
    const draft = this.draft;
    if (draft.endedAt === undefined) {
      draft.endedAt = this.now();
    }
    return this.finalize(draft);
  }

  private finalize(draft: BlockDraft): Block {
    const durationMs =
      draft.startedAt !== undefined && draft.endedAt !== undefined
        ? draft.endedAt - draft.startedAt
        : undefined;

    // Build a fresh immutable Block — never leak the draft reference.
    const block: Block = Object.freeze({
      id: draft.id,
      promptText: draft.promptText,
      commandText: draft.commandText,
      output: draft.output,
      ...(draft.exitCode !== undefined ? { exitCode: draft.exitCode } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(draft.startedAt !== undefined ? { startedAt: draft.startedAt } : {}),
      ...(draft.endedAt !== undefined ? { endedAt: draft.endedAt } : {}),
    });

    return block;
  }
}

function assertNever(value: never): never {
  throw new Error(`BlockBuffer: unhandled event ${JSON.stringify(value)}`);
}
