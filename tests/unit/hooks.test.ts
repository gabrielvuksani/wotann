import { describe, it, expect } from "vitest";
import { HookEngine } from "../../src/hooks/engine.js";
import {
  registerBuiltinHooks,
  secretScanner,
  destructiveGuard,
  createLoopDetector,
  createContentAwareLoopDetector,
} from "../../src/hooks/built-in.js";

describe("Hook Engine", () => {
  describe("core engine", () => {
    it("registers and fires hooks", async () => {
      const engine = new HookEngine("standard");
      engine.register({
        name: "TestHook",
        event: "PreToolUse",
        profile: "standard",
        handler: () => ({ action: "allow" }),
      });

      const result = await engine.fire({ event: "PreToolUse" });
      expect(result.action).toBe("allow");
    });

    it("blocks on block result", async () => {
      const engine = new HookEngine("standard");
      engine.register({
        name: "Blocker",
        event: "PreToolUse",
        profile: "standard",
        handler: () => ({ action: "block", message: "Blocked!" }),
      });

      const result = await engine.fire({ event: "PreToolUse" });
      expect(result.action).toBe("block");
      expect(result.message).toBe("Blocked!");
    });

    it("respects profile filtering", async () => {
      const engine = new HookEngine("minimal");
      engine.register({
        name: "StandardOnly",
        event: "PreToolUse",
        profile: "standard",
        handler: () => ({ action: "block", message: "Should not fire" }),
      });

      // In minimal profile, standard hooks don't fire
      const result = await engine.fire({ event: "PreToolUse" });
      expect(result.action).toBe("allow");
    });

    it("fires minimal hooks in all profiles", async () => {
      const engine = new HookEngine("minimal");
      engine.register({
        name: "MinimalHook",
        event: "PreToolUse",
        profile: "minimal",
        handler: () => ({ action: "warn", message: "Warning" }),
      });

      const result = await engine.fire({ event: "PreToolUse" });
      // Warn continues execution but is surfaced to the caller
      expect(["allow", "warn"]).toContain(result.action);
    });
  });

  describe("Secret Scanner", () => {
    it("blocks Anthropic API keys", async () => {
      const result = await secretScanner.handler({
        event: "PreToolUse",
        content: 'const key = "sk-abcdefghijklmnopqrstuvwxyz1234"',
      });
      expect(result.action).toBe("block");
    });

    it("blocks GitHub tokens", async () => {
      const result = await secretScanner.handler({
        event: "PreToolUse",
        content: 'token = "ghp_123456789012345678901234567890123456"',
      });
      expect(result.action).toBe("block");
    });

    it("allows clean content", async () => {
      const result = await secretScanner.handler({
        event: "PreToolUse",
        content: "const greeting = 'hello world';",
      });
      expect(result.action).toBe("allow");
    });
  });

  describe("Destructive Guard", () => {
    it("blocks rm -rf (S2-14: upgraded from warn → block)", async () => {
      const result = await destructiveGuard.handler({
        event: "PreToolUse",
        toolName: "Bash",
        content: "rm -rf /tmp/old-build",
      });
      expect(result.action).toBe("block");
    });

    it("blocks force push (S2-14: upgraded from warn → block)", async () => {
      const result = await destructiveGuard.handler({
        event: "PreToolUse",
        toolName: "Bash",
        content: "git push --force origin main",
      });
      expect(result.action).toBe("block");
    });

    it("allows safe commands", async () => {
      const result = await destructiveGuard.handler({
        event: "PreToolUse",
        toolName: "Bash",
        content: "git status",
      });
      expect(result.action).toBe("allow");
    });

    it("ignores non-Bash tools", async () => {
      const result = await destructiveGuard.handler({
        event: "PreToolUse",
        toolName: "Read",
        content: "rm -rf something",
      });
      expect(result.action).toBe("allow");
    });
  });

  describe("Loop Detection", () => {
    it("warns at 3 identical calls", async () => {
      const detector = createLoopDetector(3, 5);
      const payload = { event: "PreToolUse" as const, toolName: "Read", toolInput: { path: "/foo" } };

      await detector.handler(payload);
      await detector.handler(payload);
      const third = await detector.handler(payload);

      expect(third.action).toBe("warn");
    });

    it("blocks at 5 identical calls", async () => {
      const detector = createLoopDetector(3, 5);
      const payload = { event: "PreToolUse" as const, toolName: "Edit", toolInput: { file: "a.ts" } };

      for (let i = 0; i < 4; i++) {
        await detector.handler(payload);
      }
      const fifth = await detector.handler(payload);

      expect(fifth.action).toBe("block");
    });
  });

  describe("registerBuiltinHooks", () => {
    it("registers all built-in hooks", () => {
      const engine = new HookEngine("standard");
      registerBuiltinHooks(engine);

      const hooks = engine.getRegisteredHooks();
      expect(hooks.length).toBeGreaterThanOrEqual(10);

      const names = hooks.map((h) => h.name);
      expect(names).toContain("SecretScanner");
      expect(names).toContain("DestructiveGuard");
      expect(names).toContain("LoopDetection");
      expect(names).toContain("ContentAwareLoopDetection");
      expect(names).toContain("CorrectionCapture");
    });
  });

  describe("ContentAwareLoopDetection hook", () => {
    it("warns at 3 reps and blocks at 5 reps for overlapping read_file ranges", async () => {
      const hook = createContentAwareLoopDetector();
      // Ranges 0, 50, 100 all live in the [0, 200) bucket.
      const r1 = await hook.handler({
        event: "PreToolUse",
        toolName: "read_file",
        toolInput: { path: "src/foo.ts", lineStart: 0 },
      });
      expect(r1.action).toBe("allow");
      const r2 = await hook.handler({
        event: "PreToolUse",
        toolName: "read_file",
        toolInput: { path: "src/foo.ts", lineStart: 50 },
      });
      expect(r2.action).toBe("allow");
      const r3 = await hook.handler({
        event: "PreToolUse",
        toolName: "read_file",
        toolInput: { path: "src/foo.ts", lineStart: 100 },
      });
      expect(r3.action).toBe("warn");
      // Push to 5 reps -> block.
      await hook.handler({
        event: "PreToolUse",
        toolName: "read_file",
        toolInput: { path: "src/foo.ts", lineStart: 150 },
      });
      const r5 = await hook.handler({
        event: "PreToolUse",
        toolName: "read_file",
        toolInput: { path: "src/foo.ts", lineStart: 199 },
      });
      expect(r5.action).toBe("block");
    });

    it("ignores tool calls without a name", async () => {
      const hook = createContentAwareLoopDetector();
      const result = await hook.handler({ event: "PreToolUse" });
      expect(result.action).toBe("allow");
    });
  });
});
