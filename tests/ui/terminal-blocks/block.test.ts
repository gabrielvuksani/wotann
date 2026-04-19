/**
 * BlockBuffer tests — verify event-to-block translation, timing, partial-D
 * handling, and the parser+buffer integration path.
 */

import { describe, it, expect } from "vitest";
import { BlockBuffer } from "../../../src/ui/terminal-blocks/block.js";
import {
  Osc133Parser,
  OSC_133,
  type BlockEvent,
} from "../../../src/ui/terminal-blocks/osc-133-parser.js";

function makeBuffer(now: () => number): BlockBuffer {
  let id = 0;
  return new BlockBuffer({
    now,
    nextId: () => {
      id += 1;
      return `blk-${id}`;
    },
  });
}

describe("BlockBuffer — happy path", () => {
  it("assembles one block from A/B/C/D", () => {
    let clock = 1000;
    const buffer = makeBuffer(() => clock);
    const events: BlockEvent[] = [
      { kind: "prompt-begin" },
      { kind: "text", text: "user@host $ " },
      { kind: "command-begin" },
      { kind: "text", text: "echo hi" },
      { kind: "output-begin" },
      { kind: "text", text: "hi\n" },
      { kind: "output-end", exitCode: 0 },
    ];

    // Advance clock when B fires.
    const emitted: ReturnType<BlockBuffer["consume"]>[] = [];
    for (const ev of events) {
      if (ev.kind === "command-begin") clock = 1000; // started
      if (ev.kind === "output-end") clock = 1250; // ended
      emitted.push(buffer.consume(ev));
    }

    const completed = emitted.filter((b) => b !== null);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      id: "blk-1",
      promptText: "user@host $ ",
      commandText: "echo hi",
      output: "hi\n",
      exitCode: 0,
      durationMs: 250,
      startedAt: 1000,
      endedAt: 1250,
    });
  });

  it("assembles multiple blocks back-to-back", () => {
    const buffer = makeBuffer(() => 100);
    const events: BlockEvent[] = [
      { kind: "prompt-begin" },
      { kind: "command-begin" },
      { kind: "text", text: "first" },
      { kind: "output-begin" },
      { kind: "output-end", exitCode: 0 },
      { kind: "prompt-begin" },
      { kind: "command-begin" },
      { kind: "text", text: "second" },
      { kind: "output-begin" },
      { kind: "output-end", exitCode: 1 },
    ];

    const completed = events
      .map((ev) => buffer.consume(ev))
      .filter((b): b is NonNullable<typeof b> => b !== null);

    expect(completed).toHaveLength(2);
    expect(completed[0]?.commandText).toBe("first");
    expect(completed[0]?.exitCode).toBe(0);
    expect(completed[1]?.commandText).toBe("second");
    expect(completed[1]?.exitCode).toBe(1);
  });

  it("returns frozen (immutable) blocks", () => {
    const buffer = makeBuffer(() => 1);
    buffer.consume({ kind: "prompt-begin" });
    buffer.consume({ kind: "command-begin" });
    buffer.consume({ kind: "output-begin" });
    const block = buffer.consume({ kind: "output-end" });
    expect(block).not.toBeNull();
    expect(Object.isFrozen(block)).toBe(true);
  });
});

describe("BlockBuffer — edge cases", () => {
  it("synthesizes an empty-prompt draft if B fires without A", () => {
    const buffer = makeBuffer(() => 1);
    expect(buffer.consume({ kind: "command-begin" })).toBeNull();
    buffer.consume({ kind: "text", text: "ls" });
    buffer.consume({ kind: "output-begin" });
    buffer.consume({ kind: "text", text: "file.txt\n" });
    const block = buffer.consume({ kind: "output-end" });
    expect(block).not.toBeNull();
    expect(block?.promptText).toBe("");
    expect(block?.commandText).toBe("ls");
    expect(block?.output).toBe("file.txt\n");
  });

  it("flushes a prior incomplete draft when a new A arrives", () => {
    const buffer = makeBuffer(() => 1);
    // First block: A + B + text + no C / no D.
    buffer.consume({ kind: "prompt-begin" });
    buffer.consume({ kind: "command-begin" });
    buffer.consume({ kind: "text", text: "first" });
    // New A — should implicitly close the prior block.
    const flushed = buffer.consume({ kind: "prompt-begin" });
    expect(flushed).not.toBeNull();
    expect(flushed?.commandText).toBe("first");
  });

  it("flush() emits a forced close at session-end", () => {
    const buffer = makeBuffer(() => 1);
    buffer.consume({ kind: "prompt-begin" });
    buffer.consume({ kind: "command-begin" });
    buffer.consume({ kind: "text", text: "cmd" });
    const flushed = buffer.flush();
    expect(flushed).not.toBeNull();
    expect(flushed?.commandText).toBe("cmd");
    expect(buffer.hasDraft()).toBe(false);
  });

  it("text before any marker goes to the void (phase=idle)", () => {
    const buffer = makeBuffer(() => 1);
    // No A — text event is ignored.
    expect(buffer.consume({ kind: "text", text: "pre-shell output" })).toBeNull();
    expect(buffer.hasDraft()).toBe(false);
  });

  it("omits durationMs if D fires without a preceding B", () => {
    const buffer = makeBuffer(() => 42);
    buffer.consume({ kind: "prompt-begin" });
    const block = buffer.consume({ kind: "output-end" });
    expect(block?.durationMs).toBeUndefined();
    expect(block?.startedAt).toBeUndefined();
  });
});

describe("BlockBuffer + Osc133Parser — integration", () => {
  it("round-trips a complete OSC 133 byte stream to 3 blocks", () => {
    const parser = new Osc133Parser();
    const buffer = makeBuffer(() => 1);
    const completed: string[] = [];

    const stream = [
      // Block 1
      OSC_133.PROMPT_BEGIN,
      "user$ ",
      OSC_133.COMMAND_BEGIN,
      "ls",
      OSC_133.OUTPUT_BEGIN,
      "a.txt\nb.txt\n",
      OSC_133.outputEnd(0),
      // Block 2
      OSC_133.PROMPT_BEGIN,
      "user$ ",
      OSC_133.COMMAND_BEGIN,
      "false",
      OSC_133.OUTPUT_BEGIN,
      OSC_133.outputEnd(1),
      // Block 3
      OSC_133.PROMPT_BEGIN,
      "user$ ",
      OSC_133.COMMAND_BEGIN,
      "echo done",
      OSC_133.OUTPUT_BEGIN,
      "done\n",
      OSC_133.outputEnd(0),
    ].join("");

    // Feed in small chunks to exercise partial-escape paths.
    for (let i = 0; i < stream.length; i += 3) {
      const chunk = stream.slice(i, i + 3);
      const events = parser.feed(chunk);
      for (const ev of events) {
        const block = buffer.consume(ev);
        if (block) completed.push(block.commandText);
      }
    }

    expect(completed).toEqual(["ls", "false", "echo done"]);
  });

  it("does not emit a block on half-line input (quality bar)", () => {
    const parser = new Osc133Parser();
    const buffer = makeBuffer(() => 1);
    const emitted: string[] = [];

    // Feed ONLY A + B + partial text (no C, no D).
    const events = parser.feed(`${OSC_133.PROMPT_BEGIN}${OSC_133.COMMAND_BEGIN}partial`);
    for (const ev of events) {
      const block = buffer.consume(ev);
      if (block) emitted.push(block.commandText);
    }

    expect(emitted).toEqual([]);
    expect(buffer.hasDraft()).toBe(true);
  });
});
