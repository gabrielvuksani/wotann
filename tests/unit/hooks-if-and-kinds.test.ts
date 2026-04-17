/**
 * C14: Hook `if` predicate + prompt/agent handler kinds.
 * Ports Claude Code v2.1.85's typed handler model into WOTANN.
 */

import { describe, it, expect } from "vitest";
import {
  HookEngine,
  definePromptHook,
  defineAgentHook,
  type HookHandler,
} from "../../src/hooks/engine.js";

describe("hook `if` predicate", () => {
  it("skips the handler when predicate returns false", async () => {
    const engine = new HookEngine("standard");
    let fired = false;
    engine.register({
      name: "GatedBlocker",
      event: "PreToolUse",
      profile: "standard",
      if: (p) => p.toolName === "Write",
      handler: () => {
        fired = true;
        return { action: "block", message: "gated block" };
      },
    });

    const result = await engine.fire({ event: "PreToolUse", toolName: "Read" });
    expect(fired).toBe(false);
    expect(result.action).toBe("allow");
  });

  it("runs the handler when predicate returns true", async () => {
    const engine = new HookEngine("standard");
    let fired = false;
    engine.register({
      name: "GatedBlocker",
      event: "PreToolUse",
      profile: "standard",
      if: (p) => p.toolName === "Write",
      handler: () => {
        fired = true;
        return { action: "block", message: "gated block" };
      },
    });

    const result = await engine.fire({ event: "PreToolUse", toolName: "Write" });
    expect(fired).toBe(true);
    expect(result.action).toBe("block");
    expect(result.message).toBe("gated block");
  });

  it("accepts async predicates", async () => {
    const engine = new HookEngine("standard");
    engine.register({
      name: "AsyncGated",
      event: "PreToolUse",
      profile: "standard",
      if: async (p) => {
        await Promise.resolve();
        return p.filePath === "/src/foo.ts";
      },
      handler: () => ({ action: "block", message: "async-gated block" }),
    });

    const r1 = await engine.fire({ event: "PreToolUse", filePath: "/src/foo.ts" });
    expect(r1.action).toBe("block");

    const r2 = await engine.fire({ event: "PreToolUse", filePath: "/src/other.ts" });
    expect(r2.action).toBe("allow");
  });

  it("does not count fires when predicate skips", async () => {
    const engine = new HookEngine("standard");
    engine.register({
      name: "Counting",
      event: "PreToolUse",
      profile: "standard",
      if: (p) => p.toolName === "Write",
      handler: () => ({ action: "allow" }),
    });

    await engine.fire({ event: "PreToolUse", toolName: "Read" });
    await engine.fire({ event: "PreToolUse", toolName: "Read" });
    const stats = engine.getHookStats("Counting");
    expect(stats?.fires).toBe(0);
  });

  it("surfaces predicate errors as warnings (does not crash)", async () => {
    const engine = new HookEngine("standard");
    engine.register({
      name: "BrokenPredicate",
      event: "PreToolUse",
      profile: "standard",
      if: () => {
        throw new Error("boom");
      },
      handler: () => ({ action: "block", message: "unreachable" }),
    });

    const result = await engine.fire({ event: "PreToolUse", toolName: "Write" });
    expect(result.action).toBe("warn");
    expect(result.message).toMatch(/BrokenPredicate/);
    expect(result.message).toMatch(/boom/);
  });

  it("sync path: skips async predicate with a warning", () => {
    const engine = new HookEngine("standard");
    engine.register({
      name: "AsyncOnSync",
      event: "PreToolUse",
      profile: "standard",
      if: async () => true,
      handler: () => ({ action: "allow" }),
    });

    const result = engine.fireSync({ event: "PreToolUse", toolName: "Write" });
    expect(result.action).toBe("warn");
    expect(result.message).toMatch(/if-predicate is async/);
  });

  it("sync path: honours a sync predicate", () => {
    const engine = new HookEngine("standard");
    let fired = false;
    engine.register({
      name: "SyncGated",
      event: "PreToolUse",
      profile: "standard",
      if: (p) => p.toolName === "Write",
      handler: () => {
        fired = true;
        return { action: "allow" };
      },
    });

    engine.fireSync({ event: "PreToolUse", toolName: "Read" });
    expect(fired).toBe(false);
    engine.fireSync({ event: "PreToolUse", toolName: "Write" });
    expect(fired).toBe(true);
  });
});

describe("definePromptHook (C14 prompt kind)", () => {
  it("rewrites the prompt text when rewrite returns a new string", async () => {
    const engine = new HookEngine("standard");
    engine.register(
      definePromptHook({
        name: "UpperCasePrompt",
        profile: "standard",
        rewrite: (text) => text.toUpperCase(),
      }),
    );

    const result = await engine.fire({
      event: "UserPromptSubmit",
      content: "hello",
    });
    expect(result.action).toBe("modify");
    expect(result.modifiedContent).toBe("HELLO");
  });

  it("leaves the prompt unchanged when rewrite returns null", async () => {
    const engine = new HookEngine("standard");
    engine.register(
      definePromptHook({
        name: "NoOp",
        profile: "standard",
        rewrite: () => null,
      }),
    );

    const result = await engine.fire({
      event: "UserPromptSubmit",
      content: "hello",
    });
    expect(result.action).toBe("allow");
  });

  it("defaults event to UserPromptSubmit and kind to prompt", () => {
    const hook: HookHandler = definePromptHook({
      name: "PromptX",
      profile: "standard",
      rewrite: (t) => t,
    });
    expect(hook.event).toBe("UserPromptSubmit");
    expect(hook.kind).toBe("prompt");
  });

  it("accepts SessionStart as an alternate event", () => {
    const hook = definePromptHook({
      name: "SessionIntro",
      profile: "standard",
      event: "SessionStart",
      rewrite: (t) => `Welcome.\n${t}`,
    });
    expect(hook.event).toBe("SessionStart");
  });
});

describe("defineAgentHook (C14 agent kind)", () => {
  it("dispatches async consult and returns its HookResult", async () => {
    const engine = new HookEngine("standard");
    engine.register(
      defineAgentHook({
        name: "SubagentAsker",
        event: "PreToolUse",
        profile: "standard",
        consult: async () => {
          await Promise.resolve();
          return { action: "warn", message: "consulted" };
        },
      }),
    );

    const result = await engine.fire({ event: "PreToolUse", toolName: "Bash" });
    expect(result.action).toBe("warn");
    expect(result.message).toMatch(/consulted/);
  });

  it("marks hook kind as agent for UI surfaces", () => {
    const hook = defineAgentHook({
      name: "Critic",
      event: "PreToolUse",
      profile: "strict",
      consult: async () => ({ action: "allow" }),
    });
    expect(hook.kind).toBe("agent");
    expect(hook.timeoutMs).toBe(30_000);
  });
});

describe("HookEngine.getHooksByKind (C14)", () => {
  it("segments hooks into tool / prompt / agent groups", () => {
    const engine = new HookEngine("standard");
    engine.register({
      name: "Tool1",
      event: "PreToolUse",
      profile: "standard",
      handler: () => ({ action: "allow" }),
    });
    engine.register(
      definePromptHook({
        name: "PromptX",
        profile: "standard",
        rewrite: (t) => t,
      }),
    );
    engine.register(
      defineAgentHook({
        name: "AgentY",
        event: "PreToolUse",
        profile: "standard",
        consult: async () => ({ action: "allow" }),
      }),
    );

    expect(engine.getHooksByKind("tool").map((h) => h.name)).toEqual(["Tool1"]);
    expect(engine.getHooksByKind("prompt").map((h) => h.name)).toEqual(["PromptX"]);
    expect(engine.getHooksByKind("agent").map((h) => h.name)).toEqual(["AgentY"]);
  });
});
