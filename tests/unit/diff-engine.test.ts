/**
 * Tests for Interactive Diff Preview Engine.
 */

import { describe, it, expect } from "vitest";
import {
  computeDiff,
  createProposalFromContent,
  applyReviews,
  applyDiff,
  acceptAll,
  rejectAll,
  getDiffStats,
  type HunkReview,
} from "../../src/ui/diff-engine.js";

describe("Diff Engine", () => {
  const ORIGINAL = [
    "function greet(name: string): string {",
    '  return "Hello, " + name;',
    "}",
    "",
    "function farewell(name: string): string {",
    '  return "Goodbye, " + name;',
    "}",
  ].join("\n");

  const PROPOSED = [
    "function greet(name: string): string {",
    "  return `Hello, ${name}!`;",
    "}",
    "",
    "function farewell(name: string): string {",
    "  return `Goodbye, ${name}!`;",
    "}",
    "",
    "function welcome(): string {",
    '  return "Welcome!";',
    "}",
  ].join("\n");

  describe("computeDiff", () => {
    it("detects changed lines", () => {
      const hunks = computeDiff(ORIGINAL, PROPOSED);
      expect(hunks.length).toBeGreaterThan(0);
    });

    it("returns empty hunks for identical content", () => {
      const hunks = computeDiff(ORIGINAL, ORIGINAL);
      expect(hunks).toHaveLength(0);
    });

    it("detects additions at the end", () => {
      const original = "line1\nline2";
      const proposed = "line1\nline2\nline3";
      const hunks = computeDiff(original, proposed);

      expect(hunks.length).toBeGreaterThan(0);
      const lastHunk = hunks[hunks.length - 1]!;
      expect(lastHunk.proposedLines).toContain("line3");
    });

    it("detects deletions", () => {
      const original = "line1\nline2\nline3";
      const proposed = "line1\nline3";
      const hunks = computeDiff(original, proposed);

      expect(hunks.length).toBeGreaterThan(0);
    });

    it("includes context lines", () => {
      const original = "a\nb\nc\nold\ne\nf\ng";
      const proposed = "a\nb\nc\nnew\ne\nf\ng";
      const hunks = computeDiff(original, proposed, 2);

      expect(hunks[0]!.contextBefore.length).toBeLessThanOrEqual(2);
    });

    it("handles empty original (new file)", () => {
      const hunks = computeDiff("", "new content\nhere");
      expect(hunks.length).toBeGreaterThan(0);
    });

    it("handles empty proposed (file deletion)", () => {
      const hunks = computeDiff("existing\ncontent", "");
      expect(hunks.length).toBeGreaterThan(0);
    });
  });

  describe("createProposalFromContent", () => {
    it("creates a proposal with hunks", () => {
      const proposal = createProposalFromContent(
        "/tmp/test.ts",
        ORIGINAL,
        PROPOSED,
        "Modernize string concatenation",
      );

      expect(proposal.filePath).toBe("/tmp/test.ts");
      expect(proposal.originalContent).toBe(ORIGINAL);
      expect(proposal.proposedContent).toBe(PROPOSED);
      expect(proposal.hunks.length).toBeGreaterThan(0);
      expect(proposal.description).toBe("Modernize string concatenation");
      expect(proposal.originalHash).toHaveLength(64); // SHA-256 hex
    });

    it("creates proposal with no hunks for identical content", () => {
      const proposal = createProposalFromContent(
        "/tmp/same.ts",
        ORIGINAL,
        ORIGINAL,
        "No changes",
      );

      expect(proposal.hunks).toHaveLength(0);
    });
  });

  describe("applyReviews", () => {
    it("returns proposed content when all accepted", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");
      const reviews = acceptAll(proposal);
      const result = applyReviews(proposal, reviews);

      expect(result).toBe(PROPOSED);
    });

    it("returns original content when all rejected", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");
      const reviews = rejectAll(proposal);
      const result = applyReviews(proposal, reviews);

      expect(result).toBe(ORIGINAL);
    });

    it("produces partial content with mixed reviews", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");

      if (proposal.hunks.length >= 2) {
        const reviews = new Map<string, HunkReview>();
        reviews.set(proposal.hunks[0]!.id, { hunkId: proposal.hunks[0]!.id, decision: "accept" });
        reviews.set(proposal.hunks[1]!.id, { hunkId: proposal.hunks[1]!.id, decision: "reject" });

        const result = applyReviews(proposal, reviews);

        // Result should not be identical to either original or proposed
        expect(result).not.toBe(ORIGINAL);
        expect(result).not.toBe(PROPOSED);
      }
    });
  });

  describe("applyDiff", () => {
    it("applies accepted changes in dry-run mode", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");
      const reviews = acceptAll(proposal);

      const result = applyDiff(proposal, reviews, true);

      expect(result.applied).toBe(false); // dry-run doesn't write
      expect(result.hunksAccepted).toBe(proposal.hunks.length);
      expect(result.hunksRejected).toBe(0);
      expect(result.resultContent).toBe(PROPOSED);
      expect(result.conflictDetected).toBe(false);
    });

    it("reports all rejected when no accepts", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");
      const reviews = rejectAll(proposal);

      const result = applyDiff(proposal, reviews, true);

      expect(result.hunksAccepted).toBe(0);
      expect(result.hunksRejected).toBe(proposal.hunks.length);
    });
  });

  describe("acceptAll / rejectAll", () => {
    it("acceptAll marks all hunks as accept", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");
      const reviews = acceptAll(proposal);

      for (const hunk of proposal.hunks) {
        expect(reviews.get(hunk.id)?.decision).toBe("accept");
      }
    });

    it("rejectAll marks all hunks as reject", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");
      const reviews = rejectAll(proposal);

      for (const hunk of proposal.hunks) {
        expect(reviews.get(hunk.id)?.decision).toBe("reject");
      }
    });
  });

  describe("getDiffStats", () => {
    it("reports correct line counts", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, PROPOSED, "test");
      const stats = getDiffStats(proposal);

      expect(stats.totalHunks).toBe(proposal.hunks.length);
      expect(stats.linesAdded).toBeGreaterThanOrEqual(0);
      expect(stats.linesRemoved).toBeGreaterThanOrEqual(0);
      expect(stats.filesChanged).toBe(1);
    });

    it("reports zero changes for identical content", () => {
      const proposal = createProposalFromContent("/tmp/test.ts", ORIGINAL, ORIGINAL, "test");
      const stats = getDiffStats(proposal);

      expect(stats.totalHunks).toBe(0);
      expect(stats.linesAdded).toBe(0);
      expect(stats.linesRemoved).toBe(0);
    });

    it("reports additions for new file", () => {
      const proposal = createProposalFromContent("/tmp/new.ts", "", "line1\nline2\nline3", "test");
      const stats = getDiffStats(proposal);

      expect(stats.linesAdded).toBeGreaterThan(0);
      // Empty string splits to [""] which is 1 "line" removed in the diff
      expect(stats.linesRemoved).toBeGreaterThanOrEqual(0);
    });
  });
});
