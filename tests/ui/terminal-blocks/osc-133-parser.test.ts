/**
 * OSC 133 parser tests — verify escape sequence recognition, partial-chunk
 * resilience, and edge cases (unknown codes, runaway buffers, unterminated
 * sequences).
 */

import { describe, it, expect } from "vitest";
import {
  Osc133Parser,
  OSC_133,
  type BlockEvent,
} from "../../../src/ui/terminal-blocks/osc-133-parser.js";

function drain(parser: Osc133Parser, input: string): BlockEvent[] {
  return [...parser.feed(input)];
}

describe("Osc133Parser — basic sequences", () => {
  it("parses A/B/C/D in order", () => {
    const parser = new Osc133Parser();
    const events = drain(
      parser,
      `${OSC_133.PROMPT_BEGIN}${OSC_133.COMMAND_BEGIN}${OSC_133.OUTPUT_BEGIN}${OSC_133.OUTPUT_END}`,
    );

    expect(events).toEqual([
      { kind: "prompt-begin" },
      { kind: "command-begin" },
      { kind: "output-begin" },
      { kind: "output-end" },
    ]);
  });

  it("parses D with exit code", () => {
    const parser = new Osc133Parser();
    const events = drain(parser, OSC_133.outputEnd(0));
    expect(events).toEqual([{ kind: "output-end", exitCode: 0 }]);
  });

  it("parses D with nonzero exit code", () => {
    const parser = new Osc133Parser();
    const events = drain(parser, OSC_133.outputEnd(127));
    expect(events).toEqual([{ kind: "output-end", exitCode: 127 }]);
  });

  it("emits text between markers as a single text event", () => {
    const parser = new Osc133Parser();
    const events = drain(
      parser,
      `${OSC_133.PROMPT_BEGIN}user@host $ ${OSC_133.COMMAND_BEGIN}echo hi${OSC_133.OUTPUT_BEGIN}hi\n${OSC_133.OUTPUT_END}`,
    );

    expect(events).toEqual([
      { kind: "prompt-begin" },
      { kind: "text", text: "user@host $ " },
      { kind: "command-begin" },
      { kind: "text", text: "echo hi" },
      { kind: "output-begin" },
      { kind: "text", text: "hi\n" },
      { kind: "output-end" },
    ]);
  });
});

describe("Osc133Parser — partial chunks", () => {
  it("handles a single byte at a time", () => {
    const parser = new Osc133Parser();
    const input = `${OSC_133.PROMPT_BEGIN}echo${OSC_133.COMMAND_BEGIN}`;
    const collected: BlockEvent[] = [];
    for (const char of input) {
      collected.push(...parser.feed(char));
    }
    expect(collected).toEqual([
      { kind: "prompt-begin" },
      { kind: "text", text: "echo" },
      { kind: "command-begin" },
    ]);
  });

  it("holds an unterminated escape until the ST arrives", () => {
    const parser = new Osc133Parser();
    // First feed has prefix but no terminator.
    const first = drain(parser, "\x1b]133;A");
    expect(first).toEqual([]);
    // Second feed provides the BEL terminator. Text is coalesced across
    // feed boundaries, so we need flush() to observe the trailing "after".
    const second = [...drain(parser, "\x07after"), ...parser.flush()];
    expect(second).toEqual([
      { kind: "prompt-begin" },
      { kind: "text", text: "after" },
    ]);
  });

  it("splits a D with exit code across chunks", () => {
    const parser = new Osc133Parser();
    const first = drain(parser, "\x1b]133;D;12");
    expect(first).toEqual([]);
    const second = drain(parser, "7\x07");
    expect(second).toEqual([{ kind: "output-end", exitCode: 127 }]);
  });

  it("supports ESC-backslash as string terminator", () => {
    const parser = new Osc133Parser();
    const events = drain(parser, "\x1b]133;A\x1b\\");
    expect(events).toEqual([{ kind: "prompt-begin" }]);
  });
});

describe("Osc133Parser — unknown / pass-through", () => {
  it("passes unknown OSC 133 codes as literal text", () => {
    const parser = new Osc133Parser();
    // "Z" is not a recognised marker — should be emitted as literal text.
    const events = [
      ...drain(parser, "\x1b]133;Z\x07hello"),
      ...parser.flush(),
    ];
    expect(events).toEqual([
      { kind: "text", text: "\x1b]133;Z\x07hello" },
    ]);
  });

  it("passes other OSC codes (non-133) as literal text", () => {
    const parser = new Osc133Parser();
    // OSC 0 is window-title — not ours. The parser emits the ESC as literal
    // text, then resumes scanning: the `]0;title\x07` tail has no further
    // ESC, so it all flows into the same text event. The downstream terminal
    // still sees the full OSC 0 sequence because every byte is preserved.
    // Need to force a flush since text is coalesced across feeds.
    const events = [...drain(parser, "\x1b]0;title\x07"), ...parser.flush()];
    expect(events).toEqual([
      { kind: "text", text: "\x1b]0;title\x07" },
    ]);
  });

  it("rejects malformed exit code (negative)", () => {
    const parser = new Osc133Parser();
    // "-1" doesn't match /^\d+$/ so decode returns null → pass-through.
    const events = [
      ...drain(parser, "\x1b]133;D;-1\x07"),
      ...parser.flush(),
    ];
    expect(events).toEqual([
      { kind: "text", text: "\x1b]133;D;-1\x07" },
    ]);
  });

  it("ignores trailing semicolon-separated fields after exit code", () => {
    const parser = new Osc133Parser();
    const events = drain(parser, "\x1b]133;D;0;extra-metadata\x07");
    expect(events).toEqual([{ kind: "output-end", exitCode: 0 }]);
  });
});

describe("Osc133Parser — robustness", () => {
  it("never emits an event on a half-line (flush discards pending)", () => {
    const parser = new Osc133Parser();
    const mid = drain(parser, "\x1b]133;A"); // no ST
    expect(mid).toEqual([]);
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([]); // nothing fabricated
  });

  it("emits buffered text on flush", () => {
    const parser = new Osc133Parser();
    drain(parser, "some text");
    // Text accumulated but not flushed (since no subsequent event boundary).
    const flushed = [...parser.flush()];
    expect(flushed).toEqual([{ kind: "text", text: "some text" }]);
  });

  it("drops a runaway OSC payload past the 64-byte cap", () => {
    const parser = new Osc133Parser();
    // Feed an obviously malicious prefix with no terminator.
    const chunk = "\x1b]133;" + "A".repeat(200);
    const events = [...drain(parser, chunk), ...parser.flush()];
    // Parser should fall back to emitting the prefix as text and resume.
    expect(events.length).toBeGreaterThan(0);
    // The recovery emits the 7-char OSC prefix then scans the remaining
    // 'A's as literal text (coalesced with the prefix into one text event).
    const joined = events
      .filter((e) => e.kind === "text")
      .map((e) => (e.kind === "text" ? e.text : ""))
      .join("");
    expect(joined).toContain("\x1b]133;");
    expect(joined).toContain("AAA");
  });

  it("handles empty feed", () => {
    const parser = new Osc133Parser();
    expect(drain(parser, "")).toEqual([]);
  });

  it("hasPending reports buffered state", () => {
    const parser = new Osc133Parser();
    drain(parser, "\x1b]133;A"); // no ST
    expect(parser.hasPending()).toBe(true);
    drain(parser, "\x07");
    expect(parser.hasPending()).toBe(false);
  });
});

describe("OSC_133 literal builder", () => {
  it("rejects negative exit codes", () => {
    expect(() => OSC_133.outputEnd(-1)).toThrow();
  });

  it("rejects non-integer exit codes", () => {
    expect(() => OSC_133.outputEnd(1.5)).toThrow();
  });

  it("produces valid sequences that the parser can round-trip", () => {
    const parser = new Osc133Parser();
    const encoded = OSC_133.outputEnd(42);
    const events = drain(parser, encoded);
    expect(events).toEqual([{ kind: "output-end", exitCode: 42 }]);
  });
});
