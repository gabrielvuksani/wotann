/**
 * Tests for Hashline Edits — text-format surgical patch parser + applier.
 *
 * Covers:
 *   - parse single-line edit, multi-line range, prepend, append
 *   - apply surgical edit succeeds and preserves surrounding content
 *   - apply fails on content mismatch with structured diff
 *   - parse error on malformed hashline with explicit line number
 *   - multiple edits in one block apply in order
 *   - dedup edits targeting same location (last-wins)
 *   - binary file refuse (NUL byte detection)
 *   - path-traversal rejection (../../etc/passwd style)
 *   - per-batch atomic: one failed pre-check aborts everything
 *   - per-batch atomic: mid-batch write failure rolls back
 *   - prompt-schema export present and well-formed
 *   - prepend on new (non-existent) file creates it
 *   - line edit on missing file returns file_missing
 *   - range_invalid when line number exceeds file size
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  parseHashlines,
  applyHashlineEdits,
  HASHLINE_EDITS_TOOL_SCHEMA,
  type HashlineEdit,
} from "../../src/tools/hashline-edits.js";

// ── Fixtures ────────────────────────────────────────────

let scratch: string;

beforeEach(() => {
  scratch = join(tmpdir(), `wotann-hashline-${randomUUID()}`);
  mkdirSync(scratch, { recursive: true });
});

afterEach(() => {
  try {
    // Make read-only dirs writable again so rmSync can clean up
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function mkFile(relPath: string, content: string): string {
  const full = join(scratch, relPath);
  const parent = full.substring(0, full.lastIndexOf("/"));
  if (parent && parent !== scratch) mkdirSync(parent, { recursive: true });
  writeFileSync(full, content, "utf-8");
  return full;
}

function read(relPath: string): string {
  return readFileSync(join(scratch, relPath), "utf-8");
}

// ── Parser tests ──────────────────────────────────────────

describe("parseHashlines", () => {
  it("parses a single-line edit", () => {
    const text = [
      "# src/foo.ts:42",
      "- const x = 1;",
      "+ const x = 2;",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parse ok");
    expect(result.edits).toHaveLength(1);
    const edit = result.edits[0]!;
    expect(edit.path).toBe("src/foo.ts");
    expect(edit.locator).toEqual({ kind: "line", start: 42, end: 42 });
    expect(edit.minusLines).toEqual(["const x = 1;"]);
    expect(edit.plusLines).toEqual(["const x = 2;"]);
  });

  it("parses a multi-line range edit", () => {
    const text = [
      "# src/foo.ts:5-7",
      "- function a() {",
      "-   return 1;",
      "- }",
      "+ function a() { return 2; }",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parse ok");
    expect(result.edits).toHaveLength(1);
    const edit = result.edits[0]!;
    expect(edit.locator).toEqual({ kind: "line", start: 5, end: 7 });
    expect(edit.minusLines).toHaveLength(3);
    expect(edit.plusLines).toHaveLength(1);
  });

  it("parses a prepend block (no line suffix)", () => {
    const text = [
      "# src/new.ts",
      "+ // header comment",
      "+ export const FLAG = true;",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parse ok");
    expect(result.edits[0]!.locator).toEqual({ kind: "prepend" });
    expect(result.edits[0]!.plusLines).toHaveLength(2);
  });

  it("parses an append block (:end)", () => {
    const text = [
      "# src/foo.ts:end",
      "+ // appended",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parse ok");
    expect(result.edits[0]!.locator).toEqual({ kind: "append" });
  });

  it("parses multiple edits in one block", () => {
    const text = [
      "# a.ts:1",
      "- x",
      "+ y",
      "",
      "# b.ts:2",
      "- p",
      "+ q",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parse ok");
    expect(result.edits).toHaveLength(2);
    expect(result.edits[0]!.path).toBe("a.ts");
    expect(result.edits[1]!.path).toBe("b.ts");
  });

  it("returns structured errors for malformed headers", () => {
    const text = [
      "# bad:header:with:extra:colons",
      "- x",
      "+ y",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected parse fail");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.lineNumber).toBe(1);
    expect(result.errors[0]!.message).toMatch(/malformed header|unrecognized locator/);
  });

  it("returns error when block body has no +/- prefix", () => {
    const text = [
      "# foo.ts:1",
      "just random text",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected parse fail");
    expect(result.errors[0]!.message).toMatch(/must start with '-' or '\+'/);
  });

  it("dedupes edits targeting the same locator (last-wins)", () => {
    const text = [
      "# a.ts:5",
      "- old",
      "+ first",
      "",
      "# a.ts:5",
      "- old",
      "+ second",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parse ok");
    expect(result.edits).toHaveLength(1);
    expect(result.edits[0]!.plusLines).toEqual(["second"]);
  });

  it("rejects prepend block that contains '-' lines", () => {
    const text = [
      "# new.ts",
      "- cannot remove from a new file",
      "+ only adds allowed",
    ].join("\n");

    const result = parseHashlines(text);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected parse fail");
    expect(result.errors[0]!.message).toMatch(/prepend block/);
  });

  it("handles empty string input as zero edits", () => {
    const result = parseHashlines("");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parse ok");
    expect(result.edits).toHaveLength(0);
  });
});

// ── Applier tests ─────────────────────────────────────────

describe("applyHashlineEdits", () => {
  it("applies a single-line edit surgically", () => {
    mkFile("foo.ts", ["line1", "line2", "line3"].join("\n"));
    const edits: HashlineEdit[] = [
      {
        path: "foo.ts",
        locator: { kind: "line", start: 2, end: 2 },
        minusLines: ["line2"],
        plusLines: ["line2-NEW"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(true);
    expect(read("foo.ts")).toBe(["line1", "line2-NEW", "line3"].join("\n"));
  });

  it("fails with content_mismatch when '-' lines do not match current file", () => {
    mkFile("foo.ts", ["line1", "line2-ACTUAL", "line3"].join("\n"));
    const edits: HashlineEdit[] = [
      {
        path: "foo.ts",
        locator: { kind: "line", start: 2, end: 2 },
        minusLines: ["line2-STALE"],
        plusLines: ["line2-NEW"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected apply fail");
    expect(result.failure.ok).toBe(false);
    if (result.failure.ok) throw new Error("unreachable");
    expect(result.failure.reason).toBe("content_mismatch");
    expect(result.failure.expected).toEqual(["line2-STALE"]);
    expect(result.failure.actual).toEqual(["line2-ACTUAL"]);
    // File must NOT have been modified
    expect(read("foo.ts")).toBe(["line1", "line2-ACTUAL", "line3"].join("\n"));
  });

  it("rejects path traversal (../../etc/passwd)", () => {
    const edits: HashlineEdit[] = [
      {
        path: "../../../../../../../etc/passwd",
        locator: { kind: "prepend" },
        minusLines: [],
        plusLines: ["evil"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected apply fail");
    expect(result.failure.ok).toBe(false);
    if (result.failure.ok) throw new Error("unreachable");
    expect(result.failure.reason).toBe("path_escape");
  });

  it("refuses to edit binary files (NUL byte detection)", () => {
    // Create a file with an embedded NUL byte
    writeFileSync(join(scratch, "bin.dat"), "header\0binary-payload", "utf-8");
    const edits: HashlineEdit[] = [
      {
        path: "bin.dat",
        locator: { kind: "line", start: 1, end: 1 },
        minusLines: ["header"],
        plusLines: ["new-header"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected apply fail");
    expect(result.failure.ok).toBe(false);
    if (result.failure.ok) throw new Error("unreachable");
    expect(result.failure.reason).toBe("binary_refused");
  });

  it("line-edit on missing file returns file_missing", () => {
    const edits: HashlineEdit[] = [
      {
        path: "missing.ts",
        locator: { kind: "line", start: 1, end: 1 },
        minusLines: ["x"],
        plusLines: ["y"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected apply fail");
    expect(result.failure.ok).toBe(false);
    if (result.failure.ok) throw new Error("unreachable");
    expect(result.failure.reason).toBe("file_missing");
  });

  it("range_invalid when line number exceeds file length", () => {
    mkFile("tiny.ts", "just-one-line");
    const edits: HashlineEdit[] = [
      {
        path: "tiny.ts",
        locator: { kind: "line", start: 100, end: 100 },
        minusLines: ["anything"],
        plusLines: ["replacement"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected apply fail");
    expect(result.failure.ok).toBe(false);
    if (result.failure.ok) throw new Error("unreachable");
    expect(result.failure.reason).toBe("range_invalid");
  });

  it("applies prepend to create a new file", () => {
    const edits: HashlineEdit[] = [
      {
        path: "new-file.ts",
        locator: { kind: "prepend" },
        minusLines: [],
        plusLines: ["// new file", "export const X = 1;"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(true);
    expect(read("new-file.ts")).toBe("// new file\nexport const X = 1;");
  });

  it("applies append to end of existing file (no trailing newline)", () => {
    mkFile("log.txt", "line1\nline2");
    const edits: HashlineEdit[] = [
      {
        path: "log.txt",
        locator: { kind: "append" },
        minusLines: [],
        plusLines: ["line3"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(true);
    expect(read("log.txt")).toBe("line1\nline2\nline3");
  });

  it("applies append to end of existing file (trailing newline preserved)", () => {
    mkFile("log.txt", "line1\nline2\n");
    const edits: HashlineEdit[] = [
      {
        path: "log.txt",
        locator: { kind: "append" },
        minusLines: [],
        plusLines: ["line3"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(true);
    expect(read("log.txt")).toBe("line1\nline2\nline3");
  });

  it("atomic: first edit fails => no files modified", () => {
    mkFile("a.ts", "original-a");
    mkFile("b.ts", "original-b");
    const edits: HashlineEdit[] = [
      {
        path: "a.ts",
        locator: { kind: "line", start: 1, end: 1 },
        minusLines: ["WRONG-EXPECTED"],
        plusLines: ["new-a"],
      },
      {
        path: "b.ts",
        locator: { kind: "line", start: 1, end: 1 },
        minusLines: ["original-b"],
        plusLines: ["new-b"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    // Both files untouched
    expect(read("a.ts")).toBe("original-a");
    expect(read("b.ts")).toBe("original-b");
  });

  it("applies multiple edits atomically when all pre-checks pass", () => {
    mkFile("a.ts", "orig-a-line1\norig-a-line2");
    mkFile("b.ts", "orig-b");
    const edits: HashlineEdit[] = [
      {
        path: "a.ts",
        locator: { kind: "line", start: 1, end: 1 },
        minusLines: ["orig-a-line1"],
        plusLines: ["new-a-line1"],
      },
      {
        path: "b.ts",
        locator: { kind: "line", start: 1, end: 1 },
        minusLines: ["orig-b"],
        plusLines: ["new-b"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(true);
    expect(read("a.ts")).toBe("new-a-line1\norig-a-line2");
    expect(read("b.ts")).toBe("new-b");
  });

  it("mid-batch write failure rolls back earlier writes (read-only dir)", () => {
    // On Unix we can make a dir read-only to force a write failure.
    // Skip on Windows where chmod semantics differ.
    if (process.platform === "win32") return;

    mkFile("writable/a.ts", "orig-a");
    const readOnlyDir = join(scratch, "readonly");
    mkdirSync(readOnlyDir, { recursive: true });
    mkFile("readonly/b.ts", "orig-b");
    // Make dir read-only AFTER creating the file so stat still works but writes fail
    chmodSync(readOnlyDir, 0o555);

    try {
      const edits: HashlineEdit[] = [
        {
          path: "writable/a.ts",
          locator: { kind: "line", start: 1, end: 1 },
          minusLines: ["orig-a"],
          plusLines: ["new-a"],
        },
        {
          path: "readonly/b.ts",
          locator: { kind: "line", start: 1, end: 1 },
          minusLines: ["orig-b"],
          plusLines: ["new-b"],
        },
      ];
      const result = applyHashlineEdits(edits, scratch);
      // The second write fails, the first should be rolled back
      if (result.ok) {
        // Some filesystems may still allow writes; tolerate and skip
        return;
      }
      expect(result.rolledBack).toBe(true);
      // First file should be restored to its pre-batch state
      expect(read("writable/a.ts")).toBe("orig-a");
    } finally {
      // Restore permissions so the afterEach cleanup succeeds
      chmodSync(readOnlyDir, 0o755);
    }
  });

  it("empty edit list is a successful no-op", () => {
    const result = applyHashlineEdits([], scratch);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.outcomes).toHaveLength(0);
  });

  it("rejects NUL byte in path (defense in depth)", () => {
    const edits: HashlineEdit[] = [
      {
        path: "foo\0.ts",
        locator: { kind: "prepend" },
        minusLines: [],
        plusLines: ["x"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.ok).toBe(false);
    if (result.failure.ok) throw new Error("unreachable");
    expect(result.failure.reason).toBe("path_escape");
  });

  it("content-mismatch preserves file contents verbatim", () => {
    const original = "keep-line-1\nkeep-line-2\nkeep-line-3";
    mkFile("preserve.ts", original);
    const edits: HashlineEdit[] = [
      {
        path: "preserve.ts",
        locator: { kind: "line", start: 2, end: 2 },
        minusLines: ["MISMATCH"],
        plusLines: ["new"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(false);
    expect(read("preserve.ts")).toBe(original);
  });

  it("allowCreate=false rejects new files", () => {
    const edits: HashlineEdit[] = [
      {
        path: "wont-create.ts",
        locator: { kind: "prepend" },
        minusLines: [],
        plusLines: ["x"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch, { allowCreate: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.failure.ok).toBe(false);
    if (result.failure.ok) throw new Error("unreachable");
    expect(result.failure.reason).toBe("file_missing");
    expect(existsSync(join(scratch, "wont-create.ts"))).toBe(false);
  });

  it("multi-line replacement handles line count change correctly", () => {
    mkFile("many.ts", "a\nb\nc\nd\ne");
    const edits: HashlineEdit[] = [
      {
        path: "many.ts",
        locator: { kind: "line", start: 2, end: 4 },
        minusLines: ["b", "c", "d"],
        plusLines: ["B-AND-C-AND-D"],
      },
    ];
    const result = applyHashlineEdits(edits, scratch);
    expect(result.ok).toBe(true);
    expect(read("many.ts")).toBe("a\nB-AND-C-AND-D\ne");
  });
});

// ── Integration tests ─────────────────────────────────────

describe("parse → apply end-to-end", () => {
  it("parses and applies a realistic edit block", () => {
    mkFile("src/example.ts", [
      "export function greet(name: string) {",
      "  return `Hello, ${name}`;",
      "}",
    ].join("\n"));

    const text = [
      "# src/example.ts:2",
      "-   return `Hello, ${name}`;",
      "+   return `Howdy, ${name}!`;",
    ].join("\n");

    const parsed = parseHashlines(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("parse failed");

    const applied = applyHashlineEdits(parsed.edits, scratch);
    expect(applied.ok).toBe(true);
    expect(read("src/example.ts")).toContain("Howdy");
    expect(read("src/example.ts")).not.toContain("Hello");
  });
});

// ── Prompt-schema export ──────────────────────────────────

describe("HASHLINE_EDITS_TOOL_SCHEMA", () => {
  it("exports a well-formed schema with name, description, and inputSchema", () => {
    expect(HASHLINE_EDITS_TOOL_SCHEMA.name).toBe("hashline_edits");
    expect(typeof HASHLINE_EDITS_TOOL_SCHEMA.description).toBe("string");
    expect(HASHLINE_EDITS_TOOL_SCHEMA.description.length).toBeGreaterThan(100);
    expect(HASHLINE_EDITS_TOOL_SCHEMA.inputSchema.type).toBe("object");
    expect(HASHLINE_EDITS_TOOL_SCHEMA.inputSchema.required).toContain("text");
  });

  it("description includes worked examples (grammar documentation)", () => {
    // Mid-tier models benefit from examples; the schema must include them.
    const desc = HASHLINE_EDITS_TOOL_SCHEMA.description;
    expect(desc).toContain("# src/foo.ts:42");
    expect(desc).toContain("# src/new.ts");
    expect(desc).toMatch(/:end/);
  });
});
