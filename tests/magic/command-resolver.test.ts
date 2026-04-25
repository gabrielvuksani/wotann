/**
 * Tests for V9 T12.17 — magic-command resolver.
 */

import { describe, it, expect } from "vitest";
import { resolveMagicInput } from "../../src/magic/command-resolver.js";
import { MAGIC_COMMANDS } from "../../src/magic/magic-commands.js";

describe("resolveMagicInput", () => {
  it("rejects non-string input", () => {
    // @ts-expect-error — invalid input
    const r = resolveMagicInput(null);
    expect(r.kind).toBe("error");
  });

  it("passthrough on plain prompt", () => {
    const r = resolveMagicInput("hello world");
    expect(r.kind).toBe("passthrough");
    if (r.kind !== "passthrough") return;
    expect(r.prompt).toBe("hello world");
  });

  it("expands `.fix` shortcut into a real prompt", () => {
    const r = resolveMagicInput(".fix the off-by-one in the loop");
    expect(r.kind).toBe("magic");
    if (r.kind !== "magic") return;
    expect(r.id).toBe("fix");
    expect(r.prompt).toContain("Fix bugs");
    expect(r.prompt).toContain("off-by-one");
  });

  it("works with leading whitespace", () => {
    const r = resolveMagicInput("   .review the diff");
    expect(r.kind).toBe("magic");
    if (r.kind !== "magic") return;
    expect(r.id).toBe("review");
  });

  it("supports bare shortcut (no remainder)", () => {
    const r = resolveMagicInput(".test");
    expect(r.kind).toBe("magic");
    if (r.kind !== "magic") return;
    expect(r.prompt).toContain("test suite");
  });

  it("does NOT match a token that just starts with a dot", () => {
    const r = resolveMagicInput(".unknown blah");
    expect(r.kind).toBe("passthrough");
  });

  it("does NOT match `.fix` followed by another character (e.g. `.fixup`)", () => {
    const r = resolveMagicInput(".fixup foo");
    expect(r.kind).toBe("passthrough");
  });

  it("each registered command resolves cleanly", () => {
    for (const cmd of MAGIC_COMMANDS) {
      const r = resolveMagicInput(`${cmd.trigger} stub remainder`);
      expect(r.kind).toBe("magic");
      if (r.kind !== "magic") continue;
      expect(r.id).toBe(cmd.id);
    }
  });

  it("each registered command emits a non-empty system augment", () => {
    for (const cmd of MAGIC_COMMANDS) {
      const r = resolveMagicInput(`${cmd.trigger}`);
      if (r.kind !== "magic") throw new Error(`expected magic for ${cmd.trigger}`);
      expect(typeof r.systemAugment).toBe("string");
      expect((r.systemAugment ?? "").length).toBeGreaterThan(20);
    }
  });
});
