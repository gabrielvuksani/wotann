import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import {
  DiffTimeline,
  type DiffEntry,
  type DiffHunk,
  type DiffLine,
} from "../../src/ui/components/DiffTimeline.js";

// ── Test Helpers ────────────────────────────────────────────

function makeDiffLine(overrides?: Partial<DiffLine>): DiffLine {
  return {
    type: "add",
    content: "const x = 42;",
    lineNumber: 10,
    ...overrides,
  };
}

function makeDiffHunk(overrides?: Partial<DiffHunk>): DiffHunk {
  return {
    startLine: 1,
    lines: [
      makeDiffLine({ type: "context", content: "function main() {", lineNumber: 1 }),
      makeDiffLine({ type: "remove", content: "  const x = 1;", lineNumber: 2 }),
      makeDiffLine({ type: "add", content: "  const x = 2;", lineNumber: 2 }),
      makeDiffLine({ type: "context", content: "}", lineNumber: 3 }),
    ],
    ...overrides,
  };
}

function makeDiffEntry(overrides?: Partial<DiffEntry>): DiffEntry {
  return {
    id: "diff-1",
    file: "src/index.ts",
    timestamp: Date.now(),
    additions: 5,
    deletions: 2,
    hunks: [makeDiffHunk()],
    author: "Gabriel",
    message: "Fix type error in index",
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────

describe("DiffTimeline", () => {
  describe("empty state", () => {
    it("renders empty state when no entries", () => {
      const { lastFrame } = render(<DiffTimeline entries={[]} />);
      const output = lastFrame();

      expect(output).toContain("Diff Timeline");
      expect(output).toContain("No changes recorded");
    });

    it("does not render controls when empty", () => {
      const { lastFrame } = render(<DiffTimeline entries={[]} />);
      expect(lastFrame()).not.toContain("scrub timeline");
    });
  });

  describe("entry rendering", () => {
    it("renders file name and change counts", () => {
      const entry = makeDiffEntry({
        file: "src/app.ts",
        additions: 10,
        deletions: 3,
      });

      const { lastFrame } = render(<DiffTimeline entries={[entry]} />);
      const output = lastFrame();

      expect(output).toContain("src/app.ts");
      expect(output).toContain("+10");
      expect(output).toContain("-3");
    });

    it("renders commit message", () => {
      const entry = makeDiffEntry({ message: "Update authentication module" });

      const { lastFrame } = render(<DiffTimeline entries={[entry]} />);
      expect(lastFrame()).toContain("Update authentication module");
    });

    it("renders timeline scrubber with timestamps", () => {
      const entries = [
        makeDiffEntry({
          id: "d1",
          timestamp: new Date(2025, 0, 1, 14, 30).getTime(),
        }),
        makeDiffEntry({
          id: "d2",
          timestamp: new Date(2025, 0, 1, 15, 45).getTime(),
        }),
      ];

      const { lastFrame } = render(<DiffTimeline entries={entries} />);
      const output = lastFrame();

      expect(output).toContain("14:30");
      expect(output).toContain("15:45");
    });
  });

  describe("diff hunk rendering", () => {
    it("renders diff lines with correct prefixes", () => {
      const entry = makeDiffEntry({
        hunks: [
          makeDiffHunk({
            lines: [
              makeDiffLine({ type: "add", content: "new line", lineNumber: 5 }),
              makeDiffLine({ type: "remove", content: "old line", lineNumber: 5 }),
              makeDiffLine({ type: "context", content: "unchanged", lineNumber: 6 }),
            ],
          }),
        ],
      });

      const { lastFrame } = render(<DiffTimeline entries={[entry]} />);
      const output = lastFrame();

      expect(output).toContain("+ new line");
      expect(output).toContain("- old line");
    });

    it("renders hunk header with start line", () => {
      const entry = makeDiffEntry({
        hunks: [makeDiffHunk({ startLine: 42 })],
      });

      const { lastFrame } = render(<DiffTimeline entries={[entry]} />);
      expect(lastFrame()).toContain("@@ Line 42 @@");
    });

    it("shows line numbers", () => {
      const entry = makeDiffEntry({
        hunks: [
          makeDiffHunk({
            lines: [makeDiffLine({ lineNumber: 123, content: "test" })],
          }),
        ],
      });

      const { lastFrame } = render(<DiffTimeline entries={[entry]} />);
      expect(lastFrame()).toContain("123");
    });
  });

  describe("hunk visibility", () => {
    it("limits visible hunks to maxHunksVisible", () => {
      const hunks = Array.from({ length: 8 }, (_, i) =>
        makeDiffHunk({
          startLine: (i + 1) * 10,
          lines: [makeDiffLine({ content: `hunk ${i}`, lineNumber: (i + 1) * 10 })],
        }),
      );

      const entry = makeDiffEntry({ hunks });

      const { lastFrame } = render(
        <DiffTimeline entries={[entry]} maxHunksVisible={3} />,
      );
      const output = lastFrame();

      // Should show overflow indicator
      expect(output).toContain("Showing hunks");
    });

    it("does not show overflow when all hunks visible", () => {
      const entry = makeDiffEntry({
        hunks: [makeDiffHunk(), makeDiffHunk({ startLine: 20 })],
      });

      const { lastFrame } = render(
        <DiffTimeline entries={[entry]} maxHunksVisible={4} />,
      );
      expect(lastFrame()).not.toContain("Showing hunks");
    });
  });

  describe("navigation controls", () => {
    it("shows navigation hint with entry count", () => {
      const entries = [
        makeDiffEntry({ id: "d1" }),
        makeDiffEntry({ id: "d2" }),
        makeDiffEntry({ id: "d3" }),
      ];

      const { lastFrame } = render(<DiffTimeline entries={entries} />);
      const output = lastFrame();

      expect(output).toContain("scrub timeline");
      expect(output).toContain("scroll hunks");
      expect(output).toContain("1/3");
    });

    it("shows single entry count for one entry", () => {
      const entries = [makeDiffEntry()];

      const { lastFrame } = render(<DiffTimeline entries={entries} />);
      expect(lastFrame()).toContain("1/1");
    });
  });

  describe("entry with no hunks", () => {
    it("renders entry details without diff content", () => {
      const entry = makeDiffEntry({
        hunks: [],
        file: "empty-diff.ts",
        additions: 0,
        deletions: 0,
      });

      const { lastFrame } = render(<DiffTimeline entries={[entry]} />);
      const output = lastFrame();

      expect(output).toContain("empty-diff.ts");
      expect(output).toContain("+0");
      expect(output).toContain("-0");
    });
  });

  describe("multiple entries", () => {
    it("renders first entry by default", () => {
      const entries = [
        makeDiffEntry({ id: "d1", file: "first.ts", message: "First commit" }),
        makeDiffEntry({ id: "d2", file: "second.ts", message: "Second commit" }),
      ];

      const { lastFrame } = render(<DiffTimeline entries={entries} />);
      const output = lastFrame();

      expect(output).toContain("first.ts");
      expect(output).toContain("First commit");
    });
  });

  describe("component header", () => {
    it("always shows the Diff Timeline header", () => {
      const { lastFrame } = render(<DiffTimeline entries={[makeDiffEntry()]} />);
      expect(lastFrame()).toContain("Diff Timeline");
    });
  });
});
