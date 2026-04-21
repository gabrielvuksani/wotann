/**
 * Tests for Augment-Intent-style living specs.
 *
 * A "living spec" is a project-level doc that evolves with the code:
 *   - goal
 *   - scope (in-scope / out-of-scope)
 *   - constraints (must-haves / nice-to-haves)
 *   - decisionsLog (timestamp + decision + rationale)
 *   - glossary
 *
 * Persistence model: a single SPEC.md in the workspace root,
 * round-trippable to/from markdown.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LivingSpecDoc,
  SpecNotFoundError,
  initSpec,
  readSpec,
  writeSpec,
  addDecision,
  addConstraint,
  addGlossaryTerm,
  getGlossaryTerm,
} from "../../src/intent/living-spec.js";

describe("LivingSpec — living project spec", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "wotann-intent-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("initSpec", () => {
    it("creates SPEC.md with scaffold when none exists", () => {
      const doc = initSpec(tmp);
      expect(existsSync(join(tmp, "SPEC.md"))).toBe(true);
      expect(doc.goal).toContain("TBD");
      expect(doc.scope).toEqual([]);
      expect(doc.constraints).toEqual([]);
      expect(doc.decisionsLog).toEqual([]);
      expect(doc.glossary).toEqual({});
    });

    it("does not overwrite an existing SPEC.md", () => {
      writeFileSync(join(tmp, "SPEC.md"), "# Existing\n\n## Goal\n\nAlready defined\n", "utf-8");
      expect(() => initSpec(tmp)).toThrow(/exists/i);
    });
  });

  describe("readSpec", () => {
    it("throws SpecNotFoundError when SPEC.md does not exist", () => {
      expect(() => readSpec(tmp)).toThrow(SpecNotFoundError);
    });

    it("round-trips a complete spec from markdown", () => {
      const doc: LivingSpecDoc = {
        goal: "Build a resilient agent harness",
        scope: ["phones", "desktops", "iOS"],
        constraints: ["TypeScript strict", "no any types"],
        decisionsLog: [
          {
            timestamp: "2026-04-21T10:00:00.000Z",
            decision: "Use SQLite for memory",
            rationale: "Local-first, FTS5 support, zero ops",
          },
        ],
        glossary: {
          Relay: "Send task phone→desktop",
          Workshop: "Local agent tasks",
        },
      };
      writeSpec(tmp, doc);
      const roundTripped = readSpec(tmp);
      expect(roundTripped.goal).toBe(doc.goal);
      expect(roundTripped.scope).toEqual(doc.scope);
      expect(roundTripped.constraints).toEqual(doc.constraints);
      expect(roundTripped.decisionsLog).toEqual(doc.decisionsLog);
      expect(roundTripped.glossary).toEqual(doc.glossary);
    });

    it("tolerates partial specs (missing sections)", () => {
      writeFileSync(
        join(tmp, "SPEC.md"),
        "# Project SPEC\n\n## Goal\n\nShip it\n",
        "utf-8",
      );
      const doc = readSpec(tmp);
      expect(doc.goal).toBe("Ship it");
      expect(doc.scope).toEqual([]);
      expect(doc.constraints).toEqual([]);
      expect(doc.decisionsLog).toEqual([]);
    });
  });

  describe("addDecision", () => {
    it("appends a decision with provided timestamp and preserves existing entries", () => {
      initSpec(tmp);
      const first = addDecision(tmp, {
        decision: "Ship Sonnet default",
        rationale: "Better quality at tolerable cost",
        timestamp: "2026-04-20T12:00:00.000Z",
      });
      const second = addDecision(tmp, {
        decision: "Add BYOA",
        rationale: "User's Pro plan is pre-paid",
        timestamp: "2026-04-21T12:00:00.000Z",
      });
      expect(first.decisionsLog).toHaveLength(1);
      expect(second.decisionsLog).toHaveLength(2);
      const doc = readSpec(tmp);
      expect(doc.decisionsLog[0]?.decision).toBe("Ship Sonnet default");
      expect(doc.decisionsLog[1]?.decision).toBe("Add BYOA");
    });

    it("generates a timestamp if none provided", () => {
      initSpec(tmp);
      const doc = addDecision(tmp, {
        decision: "Use vitest",
        rationale: "Standard stack",
      });
      expect(doc.decisionsLog[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("addConstraint", () => {
    it("appends a constraint without disturbing decisions", () => {
      initSpec(tmp);
      addDecision(tmp, { decision: "x", rationale: "y" });
      const after = addConstraint(tmp, "Must run on Node 20+");
      expect(after.constraints).toEqual(["Must run on Node 20+"]);
      expect(after.decisionsLog).toHaveLength(1);
    });

    it("deduplicates constraints by exact string match", () => {
      initSpec(tmp);
      addConstraint(tmp, "dup");
      const after = addConstraint(tmp, "dup");
      expect(after.constraints).toEqual(["dup"]);
    });
  });

  describe("glossary", () => {
    it("adds and looks up terms", () => {
      initSpec(tmp);
      addGlossaryTerm(tmp, "Wotann", "The All-Father");
      expect(getGlossaryTerm(tmp, "Wotann")).toBe("The All-Father");
      expect(getGlossaryTerm(tmp, "Missing")).toBeUndefined();
    });

    it("updates existing term on second add", () => {
      initSpec(tmp);
      addGlossaryTerm(tmp, "K", "v1");
      addGlossaryTerm(tmp, "K", "v2");
      expect(getGlossaryTerm(tmp, "K")).toBe("v2");
    });
  });

  describe("write preserves unknown sections", () => {
    it("keeps footer sections on write", () => {
      writeFileSync(
        join(tmp, "SPEC.md"),
        [
          "# Project SPEC",
          "",
          "## Goal",
          "",
          "Ship",
          "",
          "## Notes",
          "",
          "Preserve me",
          "",
        ].join("\n"),
        "utf-8",
      );
      addConstraint(tmp, "C1");
      const md = readFileSync(join(tmp, "SPEC.md"), "utf-8");
      expect(md).toContain("Preserve me");
    });
  });
});
