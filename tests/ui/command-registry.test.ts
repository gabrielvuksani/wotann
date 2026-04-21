import { describe, it, expect, beforeEach } from "vitest";
import {
  CommandRegistry,
  CommandExecutionError,
  fuzzyScore,
  getSharedRegistry,
  resetSharedRegistry,
  type Command,
} from "../../src/ui/command-registry.js";

function makeCmd(partial: Partial<Command> & { id: string }): Command {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    description: partial.description,
    keywords: partial.keywords,
    handler: partial.handler ?? ((): void => {}),
  };
}

describe("fuzzyScore", () => {
  it("returns 1 for empty query", () => {
    expect(fuzzyScore("", "git status")).toBe(1);
  });

  it("scores exact prefix matches highest", () => {
    const prefixScore = fuzzyScore("git", "git status");
    const midScore = fuzzyScore("status", "git status");
    expect(prefixScore).toBeGreaterThan(midScore);
  });

  it("returns 0 when characters cannot be matched in order", () => {
    expect(fuzzyScore("xyz", "git status")).toBe(0);
  });

  it("matches 'gs' against 'git status' via subsequence scan", () => {
    expect(fuzzyScore("gs", "git status")).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("GIT", "git status")).toBeGreaterThan(0);
  });
});

describe("CommandRegistry — registration", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it("register + list returns registered commands in insertion order", () => {
    registry.register(makeCmd({ id: "a", label: "Alpha" }));
    registry.register(makeCmd({ id: "b", label: "Bravo" }));

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.id).toBe("a");
    expect(list[1]?.id).toBe("b");
  });

  it("duplicate id REPLACES the existing command", () => {
    registry.register(makeCmd({ id: "x", label: "First" }));
    registry.register(makeCmd({ id: "x", label: "Second" }));

    expect(registry.size).toBe(1);
    expect(registry.list()[0]?.label).toBe("Second");
  });

  it("unregister removes the command", () => {
    registry.register(makeCmd({ id: "a" }));
    expect(registry.unregister("a")).toBe(true);
    expect(registry.size).toBe(0);
    expect(registry.unregister("a")).toBe(false);
  });

  it("rejects empty id", () => {
    expect(() => registry.register(makeCmd({ id: "" }))).toThrow(/non-empty/);
  });

  it("rejects empty label", () => {
    expect(() => registry.register(makeCmd({ id: "a", label: "" }))).toThrow(/non-empty label/);
  });
});

describe("CommandRegistry — search", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
    registry.register(makeCmd({ id: "git-status", label: "Git Status", keywords: ["git", "status"] }));
    registry.register(
      makeCmd({
        id: "git-diff",
        label: "Git Diff",
        description: "Show working tree diff",
        keywords: ["git", "diff"],
      }),
    );
    registry.register(makeCmd({ id: "new-convo", label: "New Conversation", keywords: ["chat", "reset"] }));
  });

  it("empty query returns ALL commands", () => {
    const results = registry.search("");
    expect(results).toHaveLength(3);
  });

  it("returns matches sorted by score descending", () => {
    const results = registry.search("git");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Both git commands should be present, non-git commands filtered out.
    const ids = results.map((r) => r.command.id);
    expect(ids).toContain("git-status");
    expect(ids).toContain("git-diff");
    expect(ids).not.toContain("new-convo");
    // Scores are monotonic non-increasing.
    for (let i = 1; i < results.length; i++) {
      expect(results[i]?.score).toBeLessThanOrEqual(results[i - 1]?.score ?? Infinity);
    }
  });

  it("fuzzy 'gs' matches 'Git Status'", () => {
    const results = registry.search("gs");
    const ids = results.map((r) => r.command.id);
    expect(ids).toContain("git-status");
  });

  it("matches via description when label does not match", () => {
    const results = registry.search("working tree");
    const ids = results.map((r) => r.command.id);
    expect(ids).toContain("git-diff");
  });

  it("matches via keywords", () => {
    const results = registry.search("reset");
    const ids = results.map((r) => r.command.id);
    expect(ids).toContain("new-convo");
  });

  it("returns empty array when nothing matches", () => {
    const results = registry.search("zzzzz-no-match");
    expect(results).toEqual([]);
  });
});

describe("CommandRegistry — execute", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  it("runs the handler for a registered command", async () => {
    let called = false;
    registry.register(
      makeCmd({
        id: "ping",
        handler: () => {
          called = true;
        },
      }),
    );
    await registry.execute("ping");
    expect(called).toBe(true);
  });

  it("awaits async handlers", async () => {
    let called = false;
    registry.register(
      makeCmd({
        id: "async",
        handler: async () => {
          await new Promise((r) => setTimeout(r, 5));
          called = true;
        },
      }),
    );
    await registry.execute("async");
    expect(called).toBe(true);
  });

  it("wraps unknown command in CommandExecutionError", async () => {
    await expect(registry.execute("does-not-exist")).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it("wraps handler errors in CommandExecutionError (preserves cause)", async () => {
    const boom = new Error("kaboom");
    registry.register(
      makeCmd({
        id: "boom",
        handler: () => {
          throw boom;
        },
      }),
    );
    try {
      await registry.execute("boom");
      throw new Error("expected error");
    } catch (err) {
      expect(err).toBeInstanceOf(CommandExecutionError);
      const cee = err as CommandExecutionError;
      expect(cee.commandId).toBe("boom");
      expect(cee.cause).toBe(boom);
      expect(cee.message).toContain("kaboom");
    }
  });

  it("wraps async handler rejections in CommandExecutionError", async () => {
    registry.register(
      makeCmd({
        id: "reject",
        handler: async () => {
          await Promise.reject(new Error("nope"));
        },
      }),
    );
    await expect(registry.execute("reject")).rejects.toBeInstanceOf(CommandExecutionError);
  });
});

describe("CommandRegistry — shared singleton", () => {
  beforeEach(() => {
    resetSharedRegistry();
  });

  it("returns the same instance across calls", () => {
    const a = getSharedRegistry();
    const b = getSharedRegistry();
    expect(a).toBe(b);
  });

  it("resetSharedRegistry lets subsequent getSharedRegistry return a fresh instance", () => {
    const a = getSharedRegistry();
    a.register(makeCmd({ id: "keep" }));
    resetSharedRegistry();
    const b = getSharedRegistry();
    expect(b).not.toBe(a);
    expect(b.size).toBe(0);
  });
});

describe("CommandRegistry — clear", () => {
  it("drops all commands", () => {
    const r = new CommandRegistry();
    r.register(makeCmd({ id: "a" }));
    r.register(makeCmd({ id: "b" }));
    r.clear();
    expect(r.size).toBe(0);
    expect(r.list()).toEqual([]);
  });
});
