/**
 * V9 T14.1 — Memory tool shim adapter tests.
 *
 * Exercises the `ToolHostAdapter` the `mcp-server.ts` wire consumes.
 * All tests inject a stub `MemoryStoreLike` backed by an in-memory
 * Map — no SQLite, no filesystem.
 */

import { describe, expect, it } from "vitest";
import {
  createMemoryToolShimAdapter,
  listMemoryToolShimTools,
  type MemoryStoreLike,
} from "../../src/mcp/memory-tool-shim.js";

// ── Stub store ────────────────────────────────────────────────────────────

interface StubEntry {
  id: string;
  key: string;
  value: string;
  sessionId?: string;
}

function makeStubStore(seed: readonly StubEntry[] = []): {
  readonly store: MemoryStoreLike;
  readonly snapshot: () => readonly StubEntry[];
  readonly lastInsertSessionId: () => string | undefined;
} {
  const rows = new Map<string, StubEntry>();
  for (const e of seed) rows.set(e.id, { ...e });
  let nextId = 1;
  let lastSessionId: string | undefined;

  const store: MemoryStoreLike = {
    list(prefix) {
      const out: StubEntry[] = [];
      for (const e of rows.values()) {
        // Match exact-prefix or prefix followed by "/" — matches the
        // shim's path semantics without pulling real store logic.
        if (e.key === prefix || e.key.startsWith(prefix + "/")) {
          out.push({ ...e });
        }
      }
      return out;
    },
    get(id) {
      const e = rows.get(id);
      return e ? { ...e } : null;
    },
    insert(entry) {
      const id = `m${nextId++}`;
      const row: StubEntry = { id, key: entry.key, value: entry.value };
      if (entry.sessionId !== undefined) {
        row.sessionId = entry.sessionId;
        lastSessionId = entry.sessionId;
      } else {
        lastSessionId = undefined;
      }
      rows.set(id, row);
      return { id };
    },
    updateValue(id, newValue) {
      const e = rows.get(id);
      if (!e) return false;
      rows.set(id, { ...e, value: newValue });
      return true;
    },
    remove(id) {
      return rows.delete(id);
    },
  };

  return {
    store,
    snapshot: () => Array.from(rows.values()).map((e) => ({ ...e })),
    lastInsertSessionId: () => lastSessionId,
  };
}

function parsePayload(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

// ── Factory + tool list ───────────────────────────────────────────────────

describe("createMemoryToolShimAdapter — construction", () => {
  it("rejects missing store", () => {
    expect(() =>
      createMemoryToolShimAdapter({} as unknown as Parameters<
        typeof createMemoryToolShimAdapter
      >[0]),
    ).toThrow(/store/);
  });

  it("rejects a namespaceRoot that doesn't start with /", () => {
    const { store } = makeStubStore();
    expect(() =>
      createMemoryToolShimAdapter({ store, namespaceRoot: "memories" }),
    ).toThrow(/namespaceRoot/);
  });

  it("produces an adapter with listTools + callTool", () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    expect(typeof adapter.listTools).toBe("function");
    expect(typeof adapter.callTool).toBe("function");
  });
});

describe("listTools / listMemoryToolShimTools", () => {
  it("exposes exactly the 5 Anthropic Memory tool operations", () => {
    const names = listMemoryToolShimTools()
      .map((t) => t.name)
      .sort();
    expect(names).toEqual([
      "memory.create",
      "memory.delete",
      "memory.insert",
      "memory.str_replace",
      "memory.view",
    ]);
  });

  it("each tool has an object inputSchema + non-trivial description", () => {
    for (const tool of listMemoryToolShimTools()) {
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("each tool declares its required args honestly", () => {
    const byName: Record<string, readonly string[]> = {};
    for (const t of listMemoryToolShimTools()) {
      byName[t.name] = t.inputSchema.required ?? [];
    }
    expect(byName["memory.view"]).toEqual([]);
    expect(byName["memory.create"]).toEqual(["path", "content"]);
    expect(byName["memory.str_replace"]).toEqual(["id", "oldStr", "newStr"]);
    expect(byName["memory.insert"]).toEqual(["id", "line", "text"]);
    expect(byName["memory.delete"]).toEqual(["id"]);
  });
});

// ── memory.view ───────────────────────────────────────────────────────────

describe("callTool memory.view", () => {
  it("returns entries under a prefix", async () => {
    const { store } = makeStubStore([
      { id: "a", key: "/memories/alpha", value: "one" },
      { id: "b", key: "/memories/beta", value: "two" },
      { id: "c", key: "/other/beta", value: "skip" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.view", { path: "/memories" });
    expect(result.isError).not.toBe(true);
    const payload = parsePayload(result.content[0]?.text ?? "{}");
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(2);
    const entries = payload.entries as Array<{ id: string; path: string }>;
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("returns empty list (not error) when no entries match", async () => {
    const { store } = makeStubStore([]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.view", {
      path: "/memories/nothing-here",
    });
    expect(result.isError).not.toBe(true);
    const payload = parsePayload(result.content[0]?.text ?? "{}");
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(0);
    expect(payload.entries).toEqual([]);
  });

  it("defaults to root when no path is given", async () => {
    const { store } = makeStubStore([
      { id: "a", key: "/memories/alpha", value: "one" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.view", {});
    const payload = parsePayload(result.content[0]?.text ?? "{}");
    expect(payload.path).toBe("/memories");
    expect(payload.count).toBe(1);
  });

  it("rejects path traversal honestly", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.view", {
      path: "/memories/../etc/passwd",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("traversal");
  });

  it("rejects null-byte injection", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.view", {
      path: "/memories/evil\0.txt",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("null byte");
  });

  it("rejects paths outside the namespace root", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.view", {
      path: "/elsewhere/foo",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("namespace root");
  });
});

// ── memory.create ─────────────────────────────────────────────────────────

describe("callTool memory.create", () => {
  it("stores an entry and returns the new id", async () => {
    const { store, snapshot } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.create", {
      path: "/memories/projects/wotann",
      content: "hello",
    });
    expect(result.isError).not.toBe(true);
    const payload = parsePayload(result.content[0]?.text ?? "{}");
    expect(payload.ok).toBe(true);
    expect(typeof payload.id).toBe("string");
    expect(payload.path).toBe("/memories/projects/wotann");
    const rows = snapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("/memories/projects/wotann");
    expect(rows[0]?.value).toBe("hello");
  });

  it("propagates sessionId when configured", async () => {
    const { store, lastInsertSessionId } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store, sessionId: "sess-42" });
    await adapter.callTool("memory.create", {
      path: "/memories/x",
      content: "y",
    });
    expect(lastInsertSessionId()).toBe("sess-42");
  });

  it("rejects creating at the bare namespace root", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.create", {
      path: "/memories",
      content: "oops",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("bare root");
  });
});

// ── memory.str_replace ────────────────────────────────────────────────────

describe("callTool memory.str_replace", () => {
  it("replaces a unique substring", async () => {
    const { store } = makeStubStore([
      { id: "m1", key: "/memories/doc", value: "hello world" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.str_replace", {
      id: "m1",
      oldStr: "world",
      newStr: "wotann",
    });
    expect(result.isError).not.toBe(true);
    expect(store.get("m1")?.value).toBe("hello wotann");
  });

  it("rejects when oldStr appears multiple times", async () => {
    const { store } = makeStubStore([
      { id: "m1", key: "/memories/doc", value: "one two one" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.str_replace", {
      id: "m1",
      oldStr: "one",
      newStr: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("appears 2 times");
    // Must not have mutated the store.
    expect(store.get("m1")?.value).toBe("one two one");
  });

  it("rejects when oldStr is not found", async () => {
    const { store } = makeStubStore([
      { id: "m1", key: "/memories/doc", value: "hello" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.str_replace", {
      id: "m1",
      oldStr: "absent",
      newStr: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("not found");
  });

  it("returns isError on unknown id", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.str_replace", {
      id: "ghost",
      oldStr: "x",
      newStr: "y",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("ghost");
  });
});

// ── memory.insert ─────────────────────────────────────────────────────────

describe("callTool memory.insert", () => {
  it("inserts at line 0 (prepend)", async () => {
    const { store } = makeStubStore([
      { id: "m1", key: "/memories/notes", value: "second\nthird" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.insert", {
      id: "m1",
      line: 0,
      text: "first",
    });
    expect(result.isError).not.toBe(true);
    expect(store.get("m1")?.value).toBe("first\nsecond\nthird");
  });

  it("inserts at end (append past last line)", async () => {
    const { store } = makeStubStore([
      { id: "m1", key: "/memories/notes", value: "a\nb" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.insert", {
      id: "m1",
      line: 2,
      text: "c",
    });
    expect(result.isError).not.toBe(true);
    expect(store.get("m1")?.value).toBe("a\nb\nc");
  });

  it("rejects out-of-range line", async () => {
    const { store } = makeStubStore([
      { id: "m1", key: "/memories/notes", value: "a" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.insert", {
      id: "m1",
      line: 99,
      text: "x",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("out of range");
  });
});

// ── memory.delete ─────────────────────────────────────────────────────────

describe("callTool memory.delete", () => {
  it("removes an existing memory", async () => {
    const { store, snapshot } = makeStubStore([
      { id: "m1", key: "/memories/x", value: "val" },
    ]);
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.delete", { id: "m1" });
    expect(result.isError).not.toBe(true);
    expect(snapshot()).toHaveLength(0);
  });

  it("returns isError with a clear message on unknown id", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.delete", { id: "ghost" });
    expect(result.isError).toBe(true);
    const payload = parsePayload(result.content[0]?.text ?? "{}");
    expect(payload.ok).toBe(false);
    expect(String(payload.error)).toContain("ghost");
  });
});

// ── Unknown tool + per-call state isolation ───────────────────────────────

describe("unknown tool + isolation", () => {
  it("returns isError for unknown tool names", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({ store });
    const result = await adapter.callTool("memory.unknown", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unknown tool");
  });

  it("two adapters do not share state (QB #7)", async () => {
    const a = makeStubStore();
    const b = makeStubStore();
    const adapterA = createMemoryToolShimAdapter({ store: a.store });
    const adapterB = createMemoryToolShimAdapter({ store: b.store });
    await adapterA.callTool("memory.create", {
      path: "/memories/a",
      content: "A",
    });
    expect(a.snapshot()).toHaveLength(1);
    expect(b.snapshot()).toHaveLength(0);
  });

  it("respects a custom namespaceRoot", async () => {
    const { store } = makeStubStore();
    const adapter = createMemoryToolShimAdapter({
      store,
      namespaceRoot: "/wotann-mem",
    });
    // /memories is now outside the root — must be rejected.
    const denied = await adapter.callTool("memory.create", {
      path: "/memories/x",
      content: "y",
    });
    expect(denied.isError).toBe(true);
    // The custom root works.
    const ok = await adapter.callTool("memory.create", {
      path: "/wotann-mem/x",
      content: "y",
    });
    expect(ok.isError).not.toBe(true);
  });
});
