/**
 * Phase H Task 3 — atomic memory contextual resolution.
 *
 * Verifies resolveContextAtIngest rewrites pronouns, task refs, and
 * abbreviations using the per-session bindings, leaves ambiguous
 * references honestly unresolved, and immutable-updates bindings.
 */

import { describe, expect, it } from "vitest";
import {
  bindAbbreviation,
  bindPronoun,
  bindTaskAlias,
  createLlmResolver,
  createSessionContext,
  resolveContextAtIngest,
  toResolutionEvent,
  type ResolvedMemory,
} from "../../src/memory/atomic-memory.js";

describe("createSessionContext", () => {
  it("creates an empty context with the given sessionId", () => {
    const ctx = createSessionContext("sess-1");
    expect(ctx.sessionId).toBe("sess-1");
    expect(ctx.bindings.size).toBe(0);
    expect(ctx.taskAliases.size).toBe(0);
    expect(ctx.abbreviations.size).toBe(0);
  });
});

describe("bindPronoun / bindTaskAlias / bindAbbreviation", () => {
  it("is immutable — returns a new context, original unchanged", () => {
    const ctx = createSessionContext("s1");
    const ctx2 = bindPronoun(ctx, "he", "Maya");
    expect(ctx.bindings.size).toBe(0);
    expect(ctx2.bindings.size).toBe(1);
    expect(ctx2.bindings.get("he")).toBe("Maya");
  });

  it("lowercases pronoun keys", () => {
    const ctx = bindPronoun(createSessionContext("s"), "HE", "Maya");
    expect(ctx.bindings.get("he")).toBe("Maya");
  });

  it("task aliases and abbreviations also immutable", () => {
    const ctx = createSessionContext("s");
    const ctx2 = bindTaskAlias(ctx, "first task", "auth-migration");
    const ctx3 = bindAbbreviation(ctx2, "WOTANN", "WOTANN harness");
    expect(ctx.taskAliases.size).toBe(0);
    expect(ctx2.taskAliases.size).toBe(1);
    expect(ctx3.abbreviations.get("WOTANN")).toBe("WOTANN harness");
  });
});

describe("resolveContextAtIngest — pronouns", () => {
  it("replaces 'he' with the bound referent", () => {
    const ctx = bindPronoun(createSessionContext("s"), "he", "Maya");
    const result = resolveContextAtIngest("he said he'd ship Friday", ctx);
    expect(result.resolved).toBe("Maya said Maya'd ship Friday");
    expect(result.unresolved).toEqual([]);
    expect(result.diffs).toHaveLength(1);
    expect(result.diffs[0]!.source).toBe("binding");
  });

  it("leaves pronouns unresolved when no binding exists", () => {
    const ctx = createSessionContext("s");
    const result = resolveContextAtIngest("he said it was fine", ctx);
    expect(result.resolved).toBe("he said it was fine");
    expect(result.unresolved.sort()).toEqual(["he", "it"]);
  });

  it("is case-insensitive for pronouns but preserves the referent casing", () => {
    const ctx = bindPronoun(createSessionContext("s"), "she", "Maya");
    const result = resolveContextAtIngest("She and SHE should be replaced", ctx);
    expect(result.resolved).toBe("Maya and Maya should be replaced");
  });
});

describe("resolveContextAtIngest — task aliases", () => {
  it("replaces task aliases with stable task names", () => {
    const ctx = bindTaskAlias(createSessionContext("s"), "the second task", "auth-migration");
    const result = resolveContextAtIngest("the second task is blocked", ctx);
    expect(result.resolved).toBe("auth-migration is blocked");
  });

  it("longer alias wins over shorter", () => {
    let ctx = createSessionContext("s");
    ctx = bindTaskAlias(ctx, "task", "generic-task");
    ctx = bindTaskAlias(ctx, "the second task", "auth-migration");
    const result = resolveContextAtIngest("the second task is blocked", ctx);
    expect(result.resolved).toContain("auth-migration");
  });

  it("resolves 'that one' via the built-in pattern when there is exactly one task alias", () => {
    const ctx = bindTaskAlias(createSessionContext("s"), "migration", "auth-migration-task");
    const result = resolveContextAtIngest("that one is blocked", ctx);
    expect(result.resolved).toBe("auth-migration-task is blocked");
  });

  it("leaves 'that one' unresolved when multiple task aliases exist", () => {
    let ctx = createSessionContext("s");
    ctx = bindTaskAlias(ctx, "a", "task-a");
    ctx = bindTaskAlias(ctx, "b", "task-b");
    const result = resolveContextAtIngest("that one is blocked", ctx);
    expect(result.unresolved).toContain("that one");
  });
});

describe("resolveContextAtIngest — abbreviations", () => {
  it("expands case-sensitive abbreviations", () => {
    const ctx = bindAbbreviation(createSessionContext("s"), "WOTANN", "WOTANN (agent harness)");
    const result = resolveContextAtIngest("WOTANN ships Gemma by default", ctx);
    expect(result.resolved).toBe("WOTANN (agent harness) ships Gemma by default");
  });

  it("does not match wotann lowercase when abbreviation is uppercase only", () => {
    const ctx = bindAbbreviation(createSessionContext("s"), "WOTANN", "harness");
    const result = resolveContextAtIngest("wotann is lowercase here", ctx);
    expect(result.resolved).toBe("wotann is lowercase here");
  });
});

describe("resolveContextAtIngest — edge cases", () => {
  it("returns a no-op for empty input", () => {
    const result = resolveContextAtIngest("", createSessionContext("s"));
    expect(result.original).toBe("");
    expect(result.resolved).toBe("");
    expect(result.diffs).toEqual([]);
  });

  it("is safe against regex-injection in binding keys", () => {
    const ctx = bindPronoun(createSessionContext("s"), "it", "$1 injected");
    const result = resolveContextAtIngest("it happened", ctx);
    expect(result.resolved).toBe("$1 injected happened");
  });

  it("is idempotent on an already-resolved string", () => {
    const ctx = bindPronoun(createSessionContext("s"), "he", "Maya");
    const once = resolveContextAtIngest("he shipped", ctx);
    const twice = resolveContextAtIngest(once.resolved, ctx);
    expect(twice.resolved).toBe(once.resolved);
  });
});

describe("toResolutionEvent — honest provenance", () => {
  it("emits resolved when everything was rewritten", () => {
    const ctx = bindPronoun(createSessionContext("s1"), "he", "Maya");
    const result = resolveContextAtIngest("he shipped", ctx);
    const event = toResolutionEvent(result, "s1", 12345);
    expect(event.kind).toBe("resolved");
    expect(event.sessionId).toBe("s1");
    expect(event.at).toBe(12345);
    expect(event.unresolved).toEqual([]);
  });

  it("emits resolution_failed when any unresolved pronoun remains", () => {
    const ctx = createSessionContext("s1");
    const result = resolveContextAtIngest("he shipped", ctx);
    const event = toResolutionEvent(result, "s1");
    expect(event.kind).toBe("resolution_failed");
    expect(event.unresolved).toContain("he");
  });
});

describe("createLlmResolver — LLM upgrade path", () => {
  it("falls back to heuristic when heuristic had no unresolved pronouns", async () => {
    const ctx = bindPronoun(createSessionContext("s"), "he", "Maya");
    const resolver = createLlmResolver(async () => {
      throw new Error("LLM should not be called");
    });
    const result = await resolver("he shipped", ctx);
    expect(result.resolved).toBe("Maya shipped");
  });

  it("asks the LLM only when heuristic left unresolved pronouns", async () => {
    let calls = 0;
    const resolver = createLlmResolver(async (_prompt, _opts) => {
      calls++;
      return "Maya shipped it by Friday";
    });
    const ctx = createSessionContext("s");
    const result: ResolvedMemory = await resolver("he shipped it by Friday", ctx);
    expect(calls).toBe(1);
    expect(result.resolved).toBe("Maya shipped it by Friday");
    // "it" never had a binding, still in unresolved list if it appears in the output
    // but "he" is no longer unresolved.
    expect(result.unresolved).not.toContain("he");
    expect(result.diffs.some((d) => d.source === "llm")).toBe(true);
  });

  it("honest-failure when LLM throws — returns heuristic result with unresolved intact", async () => {
    const resolver = createLlmResolver(async () => {
      throw new Error("quota exhausted");
    });
    const ctx = createSessionContext("s");
    const result = await resolver("he shipped", ctx);
    expect(result.unresolved).toContain("he");
    expect(result.resolved).toBe("he shipped");
  });
});
