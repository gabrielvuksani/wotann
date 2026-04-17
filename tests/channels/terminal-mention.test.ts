/**
 * C8 — @terminal chat mention tests.
 */

import { describe, it, expect } from "vitest";
import {
  buildTerminalAttachment,
  inlineAttachment,
  parseTerminalMention,
  type TerminalSnapshot,
} from "../../src/channels/terminal-mention.js";

function mkSnapshot(over: Partial<TerminalSnapshot> = {}): TerminalSnapshot {
  return {
    cwd: "/Users/example/project",
    lastCommand: "npm test",
    lastExitCode: 0,
    bufferTail: "Test files 245 passed\nTests 3836 passed",
    capturedAt: Date.now() - 5_000,
    ...over,
  };
}

describe("parseTerminalMention", () => {
  it("detects @terminal at word boundary", () => {
    const r = parseTerminalMention("help me debug @terminal output");
    expect(r.mentionedTerminal).toBe(true);
    expect(r.cleaned).toBe("help me debug [terminal attachment] output");
  });

  it("returns unchanged when no mention present", () => {
    const r = parseTerminalMention("regular question");
    expect(r.mentionedTerminal).toBe(false);
    expect(r.cleaned).toBe("regular question");
  });

  it("is case-insensitive", () => {
    const r = parseTerminalMention("look at @Terminal");
    expect(r.mentionedTerminal).toBe(true);
  });

  it("replaces every occurrence", () => {
    const r = parseTerminalMention("@terminal and also @terminal again");
    expect((r.cleaned.match(/\[terminal attachment\]/g) ?? []).length).toBe(2);
  });

  it("ignores @terminals (word-boundary check)", () => {
    const r = parseTerminalMention("we have 3 @terminalsessions");
    expect(r.mentionedTerminal).toBe(false);
  });

  it("preserves the raw prompt for audit", () => {
    const r = parseTerminalMention("hi @terminal");
    expect(r.raw).toBe("hi @terminal");
    expect(r.cleaned).toBe("hi [terminal attachment]");
  });
});

describe("buildTerminalAttachment", () => {
  it("produces a terminal kind with uri, summary, body", () => {
    const att = buildTerminalAttachment(mkSnapshot());
    expect(att.kind).toBe("terminal");
    expect(att.uri).toMatch(/^terminal:\/\//);
    expect(att.summary).toContain("Terminal");
    expect(att.body).toContain("# Terminal attachment");
  });

  it("truncates bufferTail to the last 2000 chars", () => {
    const long = "x".repeat(5000);
    const att = buildTerminalAttachment(mkSnapshot({ bufferTail: long }));
    const fence = att.body.match(/```text\n([\s\S]*?)\n```/);
    expect(fence?.[1]?.length).toBeLessThanOrEqual(2000);
  });

  it("collapses $HOME into tilde in summary", () => {
    const home = process.env["HOME"] ?? "";
    if (!home) return;
    const att = buildTerminalAttachment(mkSnapshot({ cwd: `${home}/sub/dir` }));
    expect(att.summary).toMatch(/~\/sub\/dir/);
  });

  it("shortens deep paths with ellipsis", () => {
    const att = buildTerminalAttachment(mkSnapshot({ cwd: "/a/b/c/d/e/f" }));
    expect(att.summary).toMatch(/\.\.\.\/d\/e\/f/);
  });

  it("surfaces non-zero exit codes", () => {
    const att = buildTerminalAttachment(mkSnapshot({ lastExitCode: 1 }));
    expect(att.summary).toMatch(/exit 1/);
  });

  it("omits exit suffix on success", () => {
    const att = buildTerminalAttachment(mkSnapshot({ lastExitCode: 0 }));
    expect(att.summary).not.toMatch(/exit/);
  });

  it("computes ageMs as non-negative ms", () => {
    const now = Date.now();
    const att = buildTerminalAttachment(mkSnapshot({ capturedAt: now - 60_000 }));
    expect(att.ageMs).toBeGreaterThanOrEqual(60_000 - 100);
  });

  it("clamps negative age to 0 when capturedAt is in the future", () => {
    const att = buildTerminalAttachment(mkSnapshot({ capturedAt: Date.now() + 10_000 }));
    expect(att.ageMs).toBe(0);
  });

  it("reports <1m ago for fresh captures", () => {
    const att = buildTerminalAttachment(mkSnapshot({ capturedAt: Date.now() - 5_000 }));
    expect(att.summary).toMatch(/<1m ago/);
  });
});

describe("inlineAttachment", () => {
  it("replaces the placeholder with summary + body", () => {
    const { cleaned } = parseTerminalMention("check @terminal please");
    const att = buildTerminalAttachment(mkSnapshot());
    const final = inlineAttachment(cleaned, att);
    expect(final).toContain(att.summary);
    expect(final).toContain("# Terminal attachment");
    expect(final).not.toContain("[terminal attachment]");
  });

  it("leaves other text alone", () => {
    const { cleaned } = parseTerminalMention("prefix @terminal suffix");
    const att = buildTerminalAttachment(mkSnapshot());
    const final = inlineAttachment(cleaned, att);
    expect(final.startsWith("prefix ")).toBe(true);
    expect(final.endsWith(" suffix")).toBe(true);
  });
});
