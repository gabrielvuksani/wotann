import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandRegistry,
  CommandRegistryError,
  type CommandPolicy,
} from "../../src/orchestration/jean-registries/command-registry.js";

describe("CommandRegistry (Jean §2.4 port — command policy registry)", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  const echoPolicy: CommandPolicy = {
    name: "echo",
    binary: "/bin/echo",
    argsSchema: { maxArgs: 10, allowedFlags: ["-n", "-e"] },
    timeoutMs: 5_000,
    retry: 0,
    concurrencyCap: 2,
  };

  describe("register", () => {
    it("registers a new command policy and returns the frozen record", () => {
      const stored = registry.register(echoPolicy);
      expect(stored.name).toBe("echo");
      expect(stored.binary).toBe("/bin/echo");
      expect(stored.timeoutMs).toBe(5_000);
      expect(stored.concurrencyCap).toBe(2);
    });

    it("rejects duplicate command names with CommandRegistryError", () => {
      registry.register(echoPolicy);
      expect(() => registry.register(echoPolicy)).toThrow(CommandRegistryError);
      expect(() => registry.register(echoPolicy)).toThrow(/already registered/i);
    });

    it("rejects empty command name", () => {
      expect(() =>
        registry.register({ ...echoPolicy, name: "" }),
      ).toThrow(CommandRegistryError);
    });

    it("rejects non-positive timeout", () => {
      expect(() =>
        registry.register({ ...echoPolicy, timeoutMs: 0 }),
      ).toThrow(/timeout/i);
      expect(() =>
        registry.register({ ...echoPolicy, timeoutMs: -1 }),
      ).toThrow(/timeout/i);
    });

    it("rejects negative concurrency cap", () => {
      expect(() =>
        registry.register({ ...echoPolicy, concurrencyCap: -1 }),
      ).toThrow(/concurrency/i);
    });
  });

  describe("has / get", () => {
    it("has returns true after register, false otherwise", () => {
      expect(registry.has("echo")).toBe(false);
      registry.register(echoPolicy);
      expect(registry.has("echo")).toBe(true);
      expect(registry.has("nope")).toBe(false);
    });

    it("get returns the stored policy", () => {
      registry.register(echoPolicy);
      const got = registry.get("echo");
      expect(got?.name).toBe("echo");
      expect(got?.timeoutMs).toBe(5_000);
    });

    it("get returns undefined for unknown command", () => {
      expect(registry.get("ghost")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all registered policies", () => {
      registry.register(echoPolicy);
      registry.register({ ...echoPolicy, name: "ls", binary: "/bin/ls" });
      const all = registry.list();
      expect(all).toHaveLength(2);
      expect(all.map((p) => p.name).sort()).toEqual(["echo", "ls"]);
    });

    it("returns an empty array when registry is empty", () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe("per-instance isolation (Quality Bar #7)", () => {
    it("two registries do not share state", () => {
      const a = new CommandRegistry();
      const b = new CommandRegistry();
      a.register(echoPolicy);
      expect(a.has("echo")).toBe(true);
      expect(b.has("echo")).toBe(false);
    });
  });

  describe("validateArgs", () => {
    it("accepts args that match schema", () => {
      registry.register(echoPolicy);
      const result = registry.validateArgs("echo", ["-n", "hello"]);
      expect(result.valid).toBe(true);
    });

    it("rejects args exceeding maxArgs", () => {
      registry.register({ ...echoPolicy, argsSchema: { maxArgs: 2 } });
      const result = registry.validateArgs("echo", ["a", "b", "c"]);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/max/i);
    });

    it("rejects disallowed flags when allowedFlags is set", () => {
      registry.register(echoPolicy);
      const result = registry.validateArgs("echo", ["--malicious"]);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/flag/i);
    });

    it("validateArgs on unknown command returns invalid", () => {
      const result = registry.validateArgs("ghost", []);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/unknown/i);
    });
  });
});
