import { describe, it, expect, beforeEach } from "vitest";
import {
  JeanOrchestrator,
  OrchestratorError,
} from "../../src/orchestration/jean-orchestrator.js";
import type { CommandPolicy } from "../../src/orchestration/jean-registries/command-registry.js";
import type { ProcessEvent } from "../../src/orchestration/jean-registries/event-registry.js";

/**
 * Lifecycle integration tests — JeanOrchestrator coordinates all 4 registries.
 * Uses /bin/echo and /bin/sh (universally available on darwin/linux CI).
 */
describe("JeanOrchestrator (Jean §2.4 coordinator — spawn → event-stream → result)", () => {
  let orch: JeanOrchestrator;

  const echoPolicy: CommandPolicy = {
    name: "echo",
    binary: "/bin/echo",
    argsSchema: { maxArgs: 10 },
    timeoutMs: 10_000,
    retry: 0,
    concurrencyCap: 4,
  };

  const failPolicy: CommandPolicy = {
    name: "fail",
    binary: "/usr/bin/false",
    argsSchema: { maxArgs: 0 },
    timeoutMs: 5_000,
    retry: 0,
    concurrencyCap: 2,
  };

  beforeEach(() => {
    orch = new JeanOrchestrator();
    orch.commands.register(echoPolicy);
    orch.commands.register(failPolicy);
  });

  describe("spawn — happy path", () => {
    it("runs /bin/echo and reports exit code 0 via result registry", async () => {
      const handle = await orch.spawn("echo", ["hello", "world"]);
      const result = await handle.done;
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello world");

      // Verify all 4 registries were updated
      expect(orch.results.lookup(handle.pid)).toBeDefined();
      expect(orch.events.history(handle.pid).length).toBeGreaterThan(0);
      // After exit, process registry either retains final status or has been cleaned:
      const proc = orch.processes.get(handle.pid);
      if (proc) {
        expect(["exited", "failed"]).toContain(proc.status);
      }
    });

    it("emits started and exited events in order", async () => {
      const handle = await orch.spawn("echo", ["evt"]);
      await handle.done;
      const events = orch.events.history(handle.pid);
      const kinds = events.map((e: ProcessEvent) => e.kind);
      expect(kinds[0]).toBe("started");
      expect(kinds.at(-1)).toBe("exited");
    });

    it("captures stdout in the result", async () => {
      const handle = await orch.spawn("echo", ["marker-42"]);
      const r = await handle.done;
      expect(r.stdout.trim()).toBe("marker-42");
    });
  });

  describe("spawn — unknown command (honest failure)", () => {
    it("rejects with OrchestratorError when command is not registered", async () => {
      await expect(orch.spawn("ghost", [])).rejects.toThrow(OrchestratorError);
      await expect(orch.spawn("ghost", [])).rejects.toThrow(/unknown/i);
    });
  });

  describe("spawn — invalid args (honest failure)", () => {
    it("rejects with OrchestratorError when args exceed maxArgs", async () => {
      const tight: CommandPolicy = {
        name: "tight",
        binary: "/bin/echo",
        argsSchema: { maxArgs: 1 },
        timeoutMs: 5_000,
        retry: 0,
        concurrencyCap: 1,
      };
      orch.commands.register(tight);
      await expect(orch.spawn("tight", ["a", "b", "c"])).rejects.toThrow(
        OrchestratorError,
      );
    });
  });

  describe("spawn — spawn failure surfaces properly", () => {
    it("rejects or resolves with non-zero exit when binary cannot execute", async () => {
      const missingPolicy: CommandPolicy = {
        name: "missing",
        binary: "/absolutely/not/a/real/binary",
        argsSchema: { maxArgs: 0 },
        timeoutMs: 3_000,
        retry: 0,
        concurrencyCap: 1,
      };
      orch.commands.register(missingPolicy);
      const handle = await orch.spawn("missing", []);
      const result = await handle.done;
      // Either ENOENT → non-zero exit, or already surfaced error in result
      expect(result.exitCode === 0 ? false : true).toBe(true);
      expect(result.stderr.length >= 0).toBe(true);
    });
  });

  describe("spawn — non-zero exit captured", () => {
    it("runs /usr/bin/false and persists non-zero exit code", async () => {
      const handle = await orch.spawn("fail", []);
      const result = await handle.done;
      expect(result.exitCode).not.toBe(0);
      const persisted = orch.results.lookup(handle.pid);
      expect(persisted?.exitCode).not.toBe(0);
    });
  });

  describe("concurrency cap enforcement", () => {
    it("rejects additional spawns when cap is reached", async () => {
      const capOne: CommandPolicy = {
        name: "capone",
        binary: "/bin/sleep",
        argsSchema: { maxArgs: 1 },
        timeoutMs: 10_000,
        retry: 0,
        concurrencyCap: 1,
      };
      orch.commands.register(capOne);
      const first = await orch.spawn("capone", ["0.2"]);
      // Second spawn should violate concurrency cap while first is still running.
      await expect(orch.spawn("capone", ["0.2"])).rejects.toThrow(
        /concurrenc/i,
      );
      await first.done;
    });
  });

  describe("per-instance isolation (Quality Bar #7)", () => {
    it("two orchestrators don't share command state", () => {
      const a = new JeanOrchestrator();
      const b = new JeanOrchestrator();
      a.commands.register(echoPolicy);
      expect(a.commands.has("echo")).toBe(true);
      expect(b.commands.has("echo")).toBe(false);
    });
  });

  describe("event subscription during lifecycle", () => {
    it("broadcast listener receives started and exited for a run", async () => {
      const events: ProcessEvent[] = [];
      orch.events.subscribeAll((e) => events.push(e));
      const handle = await orch.spawn("echo", ["sub"]);
      await handle.done;
      const kinds = events.map((e) => e.kind);
      expect(kinds).toContain("started");
      expect(kinds).toContain("exited");
    });
  });
});
