import { describe, it, expect, beforeEach } from "vitest";
import { TTSREngine, type TTSRRule } from "../../src/middleware/ttsr.js";

describe("TTSR — Time-Traveling Streamed Rules", () => {
  let engine: TTSREngine;

  beforeEach(() => {
    engine = new TTSREngine();
  });

  describe("default rules", () => {
    it("fires on TODO marker (warning severity — does NOT abort)", () => {
      const result = engine.processChunk("// TODO: implement this later");
      expect(result.injections.length).toBe(1);
      expect(result.injections[0]).toContain("TODO/FIXME");
      // Tier 9F: TODO is severity "warning", only "critical" triggers abort
      expect(result.shouldAbort).toBe(false);
    });

    it("fires on FIXME marker", () => {
      const result = engine.processChunk("// FIXME: broken edge case");
      expect(result.injections.length).toBe(1);
    });

    it("fires on type assertion", () => {
      const result = engine.processChunk("const x = any as string;");
      expect(result.injections.length).toBe(1);
      expect(result.injections[0]).toContain("Type assertion");
    });

    it("fires on console.log", () => {
      const result = engine.processChunk('console.log("debug output");');
      expect(result.injections.length).toBe(1);
      expect(result.injections[0]).toContain("console.log");
    });

    it("fires on hardcoded password", () => {
      const result = engine.processChunk('const password = "secret123";');
      expect(result.injections.length).toBe(1);
      expect(result.injections[0]).toContain("CRITICAL");
    });

    it("does not fire on clean code", () => {
      const result = engine.processChunk("const x: number = 42;");
      expect(result.injections.length).toBe(0);
      expect(result.shouldAbort).toBe(false);
    });
  });

  describe("maxFiresPerSession", () => {
    it("stops firing after reaching max", () => {
      // console.log has maxFiresPerSession: 1
      engine.processChunk('console.log("first");');
      const second = engine.processChunk('console.log("second");');
      expect(second.injections.length).toBe(0);
    });

    it("TODO rule fires up to 3 times", () => {
      engine.processChunk("TODO: first");
      engine.processChunk("TODO: second");
      engine.processChunk("TODO: third");
      const fourth = engine.processChunk("TODO: fourth");
      expect(fourth.injections.length).toBe(0);
    });
  });

  describe("reset", () => {
    it("resets fire counts allowing rules to fire again", () => {
      engine.processChunk('console.log("first");');
      const before = engine.processChunk('console.log("second");');
      expect(before.injections.length).toBe(0);

      engine.reset();
      const after = engine.processChunk('console.log("third");');
      expect(after.injections.length).toBe(1);
    });
  });

  describe("custom rules", () => {
    it("fires custom rule on matching content", () => {
      const rule: TTSRRule = {
        trigger: /debugger;/,
        injection: "[TTSR] Remove debugger statement.",
        severity: "warning",
        maxFiresPerSession: 2,
        firedCount: 0,
      };
      engine.addRule(rule);
      const result = engine.processChunk("debugger;");
      expect(result.injections.some((i) => i.includes("debugger"))).toBe(true);
    });
  });

  describe("multiple rules on same chunk", () => {
    it("fires multiple rules when content matches several patterns", () => {
      const result = engine.processChunk('// TODO: password = "hunter2"');
      expect(result.injections.length).toBe(2);
    });
  });

  describe("modified passthrough", () => {
    it("returns original chunk unmodified", () => {
      const input = "some code here";
      const result = engine.processChunk(input);
      expect(result.modified).toBe(input);
    });
  });
});
