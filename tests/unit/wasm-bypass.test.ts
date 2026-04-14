import { describe, it, expect } from "vitest";
import { canBypass, executeBypass, getSupportedOperations } from "../../src/utils/wasm-bypass.js";

describe("WASM Bypass (Tier 0 routing)", () => {
  describe("canBypass", () => {
    it("handles JSON formatting", () => {
      expect(canBypass("format json")).toBe(true);
      expect(canBypass("Format JSON file")).toBe(true);
    });

    it("handles base64", () => {
      expect(canBypass("base64 encode")).toBe(true);
      expect(canBypass("base64 decode")).toBe(true);
    });

    it("handles hashing", () => {
      expect(canBypass("hash sha256")).toBe(true);
    });

    it("rejects non-deterministic tasks", () => {
      expect(canBypass("write a function")).toBe(false);
      expect(canBypass("explain this code")).toBe(false);
    });
  });

  describe("executeBypass", () => {
    it("formats JSON", () => {
      const result = executeBypass("format json", '{"a":1,"b":2}');
      expect(result.handled).toBe(true);
      expect(result.output).toBe('{\n  "a": 1,\n  "b": 2\n}');
    });

    it("minifies JSON", () => {
      const result = executeBypass("minify json", '{\n  "a": 1\n}');
      expect(result.handled).toBe(true);
      expect(result.output).toBe('{"a":1}');
    });

    it("validates JSON (valid)", () => {
      const result = executeBypass("validate json", '{"valid": true}');
      expect(result.output).toBe("Valid JSON");
    });

    it("validates JSON (invalid)", () => {
      const result = executeBypass("validate json", "not json");
      expect(result.output).toContain("Error");
    });

    it("encodes base64", () => {
      const result = executeBypass("base64 encode", "hello");
      expect(result.output).toBe("aGVsbG8=");
    });

    it("decodes base64", () => {
      const result = executeBypass("base64 decode", "aGVsbG8=");
      expect(result.output).toBe("hello");
    });

    it("hashes SHA256", () => {
      const result = executeBypass("hash sha256", "test");
      expect(result.output).toHaveLength(64);
    });

    it("counts lines", () => {
      const result = executeBypass("count lines", "a\nb\nc");
      expect(result.output).toBe("3");
    });

    it("sorts lines", () => {
      const result = executeBypass("sort lines", "c\na\nb");
      expect(result.output).toBe("a\nb\nc");
    });

    it("returns not-handled for unknown operations", () => {
      const result = executeBypass("do something complex", "input");
      expect(result.handled).toBe(false);
    });
  });

  describe("getSupportedOperations", () => {
    it("returns all supported operations", () => {
      const ops = getSupportedOperations();
      expect(ops.length).toBeGreaterThan(10);
      expect(ops).toContain("format json");
      expect(ops).toContain("base64 encode");
      expect(ops).toContain("hash sha256");
    });
  });
});
