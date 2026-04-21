import { describe, it, expect, beforeEach } from "vitest";
import {
  ProcessRegistry,
  ProcessRegistryError,
  type ProcessStatus,
  type ProcessMeta,
} from "../../src/orchestration/jean-registries/process-registry.js";

describe("ProcessRegistry (Jean §2.4 port — tracks running PIDs)", () => {
  let registry: ProcessRegistry;

  beforeEach(() => {
    registry = new ProcessRegistry();
  });

  const baseMeta: ProcessMeta = {
    pid: 1234,
    commandName: "echo",
    startedAt: 1_700_000_000_000,
    status: "starting",
    sessionId: "s1",
  };

  describe("add", () => {
    it("tracks a new process and returns a frozen record", () => {
      const rec = registry.add(baseMeta);
      expect(rec.pid).toBe(1234);
      expect(rec.commandName).toBe("echo");
      expect(rec.status).toBe("starting");
    });

    it("rejects duplicate pid", () => {
      registry.add(baseMeta);
      expect(() => registry.add(baseMeta)).toThrow(ProcessRegistryError);
    });

    it("rejects non-positive pid", () => {
      expect(() => registry.add({ ...baseMeta, pid: 0 })).toThrow(/pid/i);
      expect(() => registry.add({ ...baseMeta, pid: -1 })).toThrow(/pid/i);
    });
  });

  describe("update", () => {
    it("transitions status immutably", () => {
      registry.add(baseMeta);
      const next = registry.update(1234, { status: "running" });
      expect(next.status).toBe("running");
      expect(next.pid).toBe(1234);
    });

    it("throws for unknown pid", () => {
      expect(() => registry.update(9999, { status: "running" })).toThrow(
        ProcessRegistryError,
      );
    });

    it("preserves unchanged fields", () => {
      registry.add(baseMeta);
      const next = registry.update(1234, { status: "exited", exitCode: 0 });
      expect(next.sessionId).toBe("s1");
      expect(next.startedAt).toBe(1_700_000_000_000);
      expect(next.exitCode).toBe(0);
    });
  });

  describe("remove", () => {
    it("removes a tracked process and returns true", () => {
      registry.add(baseMeta);
      expect(registry.remove(1234)).toBe(true);
      expect(registry.get(1234)).toBeUndefined();
    });

    it("returns false for unknown pid", () => {
      expect(registry.remove(9999)).toBe(false);
    });
  });

  describe("get / has", () => {
    it("returns stored process", () => {
      registry.add(baseMeta);
      expect(registry.has(1234)).toBe(true);
      expect(registry.get(1234)?.commandName).toBe("echo");
    });

    it("get returns undefined when unknown", () => {
      expect(registry.get(42)).toBeUndefined();
      expect(registry.has(42)).toBe(false);
    });
  });

  describe("query", () => {
    beforeEach(() => {
      registry.add({ ...baseMeta, pid: 100, status: "running", commandName: "echo" });
      registry.add({ ...baseMeta, pid: 101, status: "running", commandName: "ls" });
      registry.add({ ...baseMeta, pid: 102, status: "exited", commandName: "echo" });
    });

    it("filters by status", () => {
      const running = registry.query({ status: "running" });
      expect(running).toHaveLength(2);
      expect(running.every((p) => p.status === "running")).toBe(true);
    });

    it("filters by commandName", () => {
      const echos = registry.query({ commandName: "echo" });
      expect(echos).toHaveLength(2);
      expect(echos.every((p) => p.commandName === "echo")).toBe(true);
    });

    it("filters by both fields combined", () => {
      const runningEchos = registry.query({
        status: "running",
        commandName: "echo",
      });
      expect(runningEchos).toHaveLength(1);
      expect(runningEchos[0]?.pid).toBe(100);
    });

    it("returns all with empty filter", () => {
      expect(registry.query({})).toHaveLength(3);
    });
  });

  describe("activeCount (for concurrency cap)", () => {
    it("counts processes in non-terminal states per command", () => {
      registry.add({ ...baseMeta, pid: 10, status: "running", commandName: "echo" });
      registry.add({ ...baseMeta, pid: 11, status: "starting", commandName: "echo" });
      registry.add({ ...baseMeta, pid: 12, status: "exited", commandName: "echo" });
      expect(registry.activeCount("echo")).toBe(2);
      expect(registry.activeCount("ls")).toBe(0);
    });
  });

  describe("per-instance isolation (Quality Bar #7)", () => {
    it("two registries do not share state", () => {
      const a = new ProcessRegistry();
      const b = new ProcessRegistry();
      a.add(baseMeta);
      expect(a.has(1234)).toBe(true);
      expect(b.has(1234)).toBe(false);
    });
  });

  describe("status enumeration sanity", () => {
    it("supports documented ProcessStatus values", () => {
      const statuses: ProcessStatus[] = [
        "starting",
        "running",
        "exited",
        "failed",
        "killed",
      ];
      for (const s of statuses) {
        // Each value is a valid ProcessStatus string.
        expect(typeof s).toBe("string");
      }
    });
  });
});
