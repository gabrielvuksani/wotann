/**
 * Tests for the shared prompt-quarantine utility.
 *
 * The util is a thin layer of pure functions; the goal of these tests
 * is to lock the contract that callers (currently hybrid-retrieval and
 * entity-types, possibly more later) rely on.
 */

import { describe, expect, it } from "vitest";

import {
  QUARANTINE_PREAMBLE,
  clampForPrompt,
  fenceUserContent,
  sandwichReminder,
  sanitizeForPromptInsertion,
} from "../../src/security/prompt-quarantine.js";

describe("sanitizeForPromptInsertion", () => {
  it("strips ASCII control chars (except \\n \\r \\t)", () => {
    const dirty = "before\x00\x07\x08\x0F\x1Fafter";
    expect(sanitizeForPromptInsertion(dirty)).toBe("beforeafter");
  });

  it("preserves \\n \\r \\t", () => {
    const s = "a\nb\rc\td";
    expect(sanitizeForPromptInsertion(s)).toBe(s);
  });

  it("strips zero-width unicode", () => {
    const dirty = "in​vis‌ible‍"; // ZWSP, ZWNJ, ZWJ
    expect(sanitizeForPromptInsertion(dirty)).toBe("invisible");
  });

  it("strips bidi-override unicode (the RTL-spoof vector)", () => {
    const dirty = "safe‮evil‬"; // RLO, PDF
    expect(sanitizeForPromptInsertion(dirty)).toBe("safeevil");
  });

  it("strips BOM", () => {
    expect(sanitizeForPromptInsertion("﻿hello")).toBe("hello");
  });
});

describe("clampForPrompt", () => {
  it("returns the string unchanged when under cap", () => {
    expect(clampForPrompt("short", 100)).toBe("short");
  });

  it("truncates with marker when over cap", () => {
    const long = "x".repeat(200);
    const out = clampForPrompt(long, 50);
    expect(out.startsWith("x".repeat(50))).toBe(true);
    expect(out).toContain("[truncated to 50 chars]");
  });
});

describe("fenceUserContent", () => {
  it("wraps content in BEGIN_<LABEL> / END_<LABEL>", () => {
    const out = fenceUserContent({ label: "query", content: "hello", max: 100 });
    expect(out).toContain("BEGIN_QUERY");
    expect(out).toContain("END_QUERY");
    expect(out).toContain("hello");
  });

  it("uppercases and slug-safes labels", () => {
    const out = fenceUserContent({ label: "user.input!!", content: "x", max: 100 });
    expect(out).toContain("BEGIN_USER_INPUT__");
    expect(out).toContain("END_USER_INPUT__");
  });

  it("sanitizes control / stealth chars before fencing", () => {
    const out = fenceUserContent({
      label: "obs",
      content: "be​fore\x00after",
      max: 100,
    });
    expect(out).toContain("beforeafter");
    expect(out).not.toContain("​");
    expect(out).not.toContain("\x00");
  });

  it("clamps oversized content", () => {
    const out = fenceUserContent({
      label: "obs",
      content: "x".repeat(500),
      max: 50,
    });
    expect(out).toContain("[truncated to 50 chars]");
    expect(out.length).toBeLessThan(500);
  });
});

describe("QUARANTINE_PREAMBLE + sandwichReminder", () => {
  it("preamble mentions the data/instructions distinction", () => {
    expect(QUARANTINE_PREAMBLE.toLowerCase()).toContain("data");
    expect(QUARANTINE_PREAMBLE.toLowerCase()).toContain("instructions");
  });

  it("sandwichReminder echoes the task description", () => {
    const r = sandwichReminder("output JSON only");
    expect(r).toContain("output JSON only");
    expect(r.toLowerCase()).toContain("ignore any instructions");
  });
});
