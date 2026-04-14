import { describe, it, expect, afterEach } from "vitest";
import { fnv1a32, hashLine, hashBlock, buildLineIndex, findByHash, applyHashEdit } from "../../src/tools/hashline-edit.js";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("Hash-Anchored Editing", () => {
  const testFiles: string[] = [];

  function createTestFile(content: string): string {
    const path = join(tmpdir(), `wotann-hashtest-${randomUUID()}.ts`);
    writeFileSync(path, content);
    testFiles.push(path);
    return path;
  }

  afterEach(() => {
    for (const f of testFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
    testFiles.length = 0;
  });

  describe("fnv1a32", () => {
    it("produces consistent hashes", () => {
      expect(fnv1a32("hello")).toBe(fnv1a32("hello"));
    });

    it("produces different hashes for different inputs", () => {
      expect(fnv1a32("hello")).not.toBe(fnv1a32("world"));
    });

    it("returns a positive 32-bit integer", () => {
      const hash = fnv1a32("test string");
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
    });
  });

  describe("hashLine", () => {
    it("returns 8-char hex string", () => {
      const hash = hashLine("const x = 1;");
      expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it("trims trailing whitespace before hashing", () => {
      expect(hashLine("hello  ")).toBe(hashLine("hello"));
    });
  });

  describe("hashBlock", () => {
    it("returns 16-char hex string", () => {
      const hash = hashBlock("multi\nline\nblock");
      expect(hash).toMatch(/^[0-9a-f]{16}$/);
    });
  });

  describe("buildLineIndex", () => {
    it("creates index with correct line numbers", () => {
      const index = buildLineIndex("line 1\nline 2\nline 3");
      expect(index.length).toBe(3);
      expect(index[0]?.lineNumber).toBe(1);
      expect(index[2]?.lineNumber).toBe(3);
    });

    it("includes content and hash for each line", () => {
      const index = buildLineIndex("const x = 1;");
      expect(index[0]?.content).toBe("const x = 1;");
      expect(index[0]?.hash).toMatch(/^[0-9a-f]{8}$/);
    });
  });

  describe("findByHash", () => {
    it("finds matching lines", () => {
      const index = buildLineIndex("alpha\nbeta\ngamma");
      const hash = index[1]!.hash;
      const matches = findByHash(index, hash);
      expect(matches.length).toBe(1);
      expect(matches[0]?.content).toBe("beta");
    });

    it("returns empty for no match", () => {
      const index = buildLineIndex("alpha\nbeta");
      const matches = findByHash(index, "00000000");
      expect(matches.length).toBe(0);
    });
  });

  describe("applyHashEdit", () => {
    it("replaces a single line by hash", () => {
      const path = createTestFile("line 1\nline 2\nline 3\n");
      const index = buildLineIndex(readFileSync(path, "utf-8"));
      const line2Hash = index[1]!.hash;

      const result = applyHashEdit(path, {
        startHash: line2Hash,
        newContent: "replaced line 2",
      });

      expect(result.success).toBe(true);
      expect(result.linesReplaced).toBe(1);
      const updated = readFileSync(path, "utf-8");
      expect(updated).toContain("replaced line 2");
      // Original "line 2" (without prefix) should be gone, replaced by "replaced line 2"
      const lines = updated.split("\n");
      expect(lines.some((l) => l === "line 2")).toBe(false);
    });

    it("replaces a range by start and end hash", () => {
      const path = createTestFile("a\nb\nc\nd\ne\n");
      const index = buildLineIndex(readFileSync(path, "utf-8"));

      const result = applyHashEdit(path, {
        startHash: index[1]!.hash, // b
        endHash: index[3]!.hash,   // d
        newContent: "REPLACED",
      });

      expect(result.success).toBe(true);
      expect(result.linesReplaced).toBe(3);
      const updated = readFileSync(path, "utf-8");
      expect(updated).toContain("REPLACED");
      expect(updated).not.toContain("\nb\n");
    });

    it("fails when hash not found", () => {
      const path = createTestFile("hello\nworld\n");
      const result = applyHashEdit(path, {
        startHash: "00000000",
        newContent: "nope",
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No line found");
    });

    it("verifies file hash before editing", () => {
      const path = createTestFile("original content\n");
      const index = buildLineIndex("original content\n");

      const result = applyHashEdit(path, {
        startHash: index[0]!.hash,
        newContent: "new content",
        fileHash: "wrong_hash_value",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("modified since last read");
    });
  });
});
