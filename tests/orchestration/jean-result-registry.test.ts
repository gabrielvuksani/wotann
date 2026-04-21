import { describe, it, expect, beforeEach } from "vitest";
import {
  ResultRegistry,
  ResultRegistryError,
  type ProcessResult,
} from "../../src/orchestration/jean-registries/result-registry.js";

describe("ResultRegistry (Jean §2.4 port — persists completed-process results)", () => {
  let registry: ResultRegistry;

  beforeEach(() => {
    registry = new ResultRegistry({ maxStdoutBytes: 1024, maxStderrBytes: 1024 });
  });

  const mkResult = (pid: number, commandName: string = "echo"): ProcessResult => ({
    pid,
    commandName,
    exitCode: 0,
    durationMs: 42,
    stdout: "ok",
    stderr: "",
    finishedAt: 1_700_000_000_000 + pid,
  });

  describe("persist / lookup", () => {
    it("stores a result and returns it from lookup", () => {
      const r = mkResult(100);
      registry.persist(r);
      const found = registry.lookup(100);
      expect(found?.pid).toBe(100);
      expect(found?.exitCode).toBe(0);
      expect(found?.stdout).toBe("ok");
    });

    it("lookup returns undefined for unknown pid", () => {
      expect(registry.lookup(999)).toBeUndefined();
    });

    it("rejects duplicate pid persistence", () => {
      const r = mkResult(100);
      registry.persist(r);
      expect(() => registry.persist(r)).toThrow(ResultRegistryError);
    });

    it("rejects non-positive pid", () => {
      expect(() => registry.persist({ ...mkResult(0) })).toThrow(/pid/i);
    });
  });

  describe("stdout/stderr truncation", () => {
    it("truncates stdout above maxStdoutBytes", () => {
      const big = "a".repeat(5_000);
      registry.persist({ ...mkResult(1), stdout: big });
      const got = registry.lookup(1);
      // Stored stdout must not exceed the cap.
      expect((got?.stdout ?? "").length).toBeLessThanOrEqual(1024);
    });

    it("truncates stderr above maxStderrBytes", () => {
      const big = "e".repeat(5_000);
      registry.persist({ ...mkResult(2), stderr: big });
      const got = registry.lookup(2);
      expect((got?.stderr ?? "").length).toBeLessThanOrEqual(1024);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      registry.persist({ ...mkResult(1, "echo"), finishedAt: 1_000 });
      registry.persist({ ...mkResult(2, "ls"), finishedAt: 2_000 });
      registry.persist({ ...mkResult(3, "echo"), finishedAt: 3_000 });
    });

    it("filters by command", () => {
      const rows = registry.query({ commandName: "echo" });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.commandName === "echo")).toBe(true);
    });

    it("filters by since timestamp", () => {
      const rows = registry.query({ since: 1_500 });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.finishedAt >= 1_500)).toBe(true);
    });

    it("filters by combined command + since", () => {
      const rows = registry.query({ commandName: "echo", since: 1_500 });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.pid).toBe(3);
    });

    it("empty filter returns all", () => {
      expect(registry.query({})).toHaveLength(3);
    });
  });

  describe("size / clear", () => {
    it("tracks count and clears correctly", () => {
      registry.persist(mkResult(1));
      registry.persist(mkResult(2));
      expect(registry.size()).toBe(2);
      registry.clear();
      expect(registry.size()).toBe(0);
      expect(registry.lookup(1)).toBeUndefined();
    });
  });

  describe("per-instance isolation (Quality Bar #7)", () => {
    it("two registries don't share state", () => {
      const a = new ResultRegistry();
      const b = new ResultRegistry();
      a.persist(mkResult(100));
      expect(a.lookup(100)).toBeDefined();
      expect(b.lookup(100)).toBeUndefined();
    });
  });
});
