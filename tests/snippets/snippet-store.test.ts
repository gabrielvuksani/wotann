import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  SnippetStore,
  extractVariables,
  renderSnippet,
} from "../../src/snippets/snippet-store.js";

describe("extractVariables", () => {
  it("returns empty array for body with no placeholders", () => {
    expect(extractVariables("plain text without variables")).toEqual([]);
  });

  it("extracts a single variable", () => {
    expect(extractVariables("hello {{name}}")).toEqual(["name"]);
  });

  it("deduplicates repeated variables", () => {
    expect(extractVariables("{{name}} and {{name}} again")).toEqual(["name"]);
  });

  it("tolerates whitespace inside braces", () => {
    expect(extractVariables("hello {{ name }}")).toEqual(["name"]);
  });

  it("captures multiple distinct variables in document order", () => {
    expect(extractVariables("{{first}} - {{last}} ({{first}})")).toEqual(["first", "last"]);
  });

  it("ignores invalid identifiers", () => {
    // Numbers leading the name aren't valid identifiers; brace-only
    // tokens or empty placeholders are ignored.
    expect(extractVariables("{{1bad}} {{}} {{ok}}")).toEqual(["ok"]);
  });

  it("doesn't capture single-brace tokens", () => {
    expect(extractVariables("not a {var} placeholder")).toEqual([]);
  });
});

describe("renderSnippet", () => {
  it("substitutes a single variable", () => {
    const result = renderSnippet("hello {{name}}", { name: "world" });
    expect(result.rendered).toBe("hello world");
    expect(result.missingVars).toEqual([]);
  });

  it("leaves missing variables as raw tokens AND surfaces them", () => {
    const result = renderSnippet("hello {{name}} from {{place}}", { name: "Gabriel" });
    expect(result.rendered).toBe("hello Gabriel from {{place}}");
    expect(result.missingVars).toEqual(["place"]);
  });

  it("treats empty-string substitution as a successful render (not missing)", () => {
    const result = renderSnippet("hello {{name}}", { name: "" });
    expect(result.rendered).toBe("hello ");
    expect(result.missingVars).toEqual([]);
  });

  it("substitutes the same variable in multiple positions", () => {
    const result = renderSnippet("{{x}} + {{x}} = 2x", { x: "5" });
    expect(result.rendered).toBe("5 + 5 = 2x");
  });

  it("preserves whitespace-tolerant placeholders on miss", () => {
    const result = renderSnippet("{{ name }}", {});
    expect(result.rendered).toBe("{{ name }}");
    expect(result.missingVars).toEqual(["name"]);
  });
});

describe("SnippetStore", () => {
  let tmp: string;
  let store: SnippetStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "wotann-snippet-test-"));
    store = new SnippetStore(join(tmp, "snippets.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it("upsert creates a new snippet with auto-minted id", () => {
    const snippet = store.upsert({
      title: "code review prompt",
      body: "review this {{language}} code: {{code}}",
    });
    expect(snippet.id).toMatch(/^snip-/);
    expect(snippet.title).toBe("code review prompt");
    expect(snippet.variables).toEqual(["language", "code"]);
    expect(snippet.useCount).toBe(0);
    expect(snippet.lastUsedAt).toBeNull();
    expect(snippet.isFavorite).toBe(false);
    expect(snippet.tags).toEqual([]);
  });

  it("upsert with an explicit id stores deterministic key", () => {
    const snippet = store.upsert({
      id: "user-defined-id",
      title: "t",
      body: "b",
    });
    expect(snippet.id).toBe("user-defined-id");
  });

  it("upsert on an existing id updates fields without resetting counters", () => {
    const initial = store.upsert({ title: "v1", body: "old body" });
    // Bump use to create non-default counter state
    store.use(initial.id);
    const updated = store.upsert({ id: initial.id, title: "v2", body: "new body" });
    expect(updated.id).toBe(initial.id);
    expect(updated.title).toBe("v2");
    expect(updated.body).toBe("new body");
    // Use-count should survive an update.
    expect(updated.useCount).toBe(1);
  });

  it("delete removes the snippet and reports success", () => {
    const s = store.upsert({ title: "x", body: "y" });
    expect(store.delete(s.id)).toBe(true);
    expect(store.getById(s.id)).toBeNull();
    expect(store.delete(s.id)).toBe(false);
  });

  it("list returns favorites first, then by last-used desc", async () => {
    const a = store.upsert({ title: "a", body: "a" });
    const b = store.upsert({ title: "b", body: "b" });
    const c = store.upsert({ title: "c", body: "c", isFavorite: true });

    // a and b both used; b is more recent.
    store.use(a.id);
    await new Promise((r) => setTimeout(r, 5));
    store.use(b.id);

    const list = store.list();
    expect(list[0]?.id).toBe(c.id); // favorite wins
    expect(list[1]?.id).toBe(b.id); // recent use
    expect(list[2]?.id).toBe(a.id);
  });

  it("list filters by category", () => {
    const a = store.upsert({ title: "code", body: "x", category: "code" });
    store.upsert({ title: "writing", body: "y", category: "writing" });
    const result = store.list({ category: "code" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(a.id);
  });

  it("list filters by favorites only", () => {
    store.upsert({ title: "a", body: "a" });
    const fav = store.upsert({ title: "fav", body: "b", isFavorite: true });
    const result = store.list({ favOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(fav.id);
  });

  it("list handles FTS5 search with special chars in user input", () => {
    store.upsert({ title: "review TypeScript code", body: "review {{file}}" });
    store.upsert({ title: "haiku writer", body: "compose haiku about {{topic}}" });

    // Special character that would break naive FTS5 syntax
    const result = store.list({ query: 'review "code"' });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.title).toContain("review");
  });

  it("use bumps counters and renders with vars", () => {
    const s = store.upsert({ title: "t", body: "hello {{name}}" });
    const result = store.use(s.id, { name: "Gabriel" });
    expect(result?.snippet.useCount).toBe(1);
    expect(result?.snippet.lastUsedAt).not.toBeNull();
    expect(result?.render.rendered).toBe("hello Gabriel");
    expect(result?.render.missingVars).toEqual([]);
  });

  it("use returns null for missing snippet", () => {
    expect(store.use("does-not-exist")).toBeNull();
  });

  it("count tracks total snippets", () => {
    expect(store.count()).toBe(0);
    store.upsert({ title: "a", body: "a" });
    store.upsert({ title: "b", body: "b" });
    expect(store.count()).toBe(2);
    const a = store.list()[0];
    if (a) store.delete(a.id);
    expect(store.count()).toBe(1);
  });

  it("healthCheck reports true on a live db", () => {
    expect(store.healthCheck()).toBe(true);
  });

  it("tags round-trip through CSV storage", () => {
    const s = store.upsert({
      title: "tagged",
      body: "x",
      tags: ["work", "code-review", "ai"],
    });
    const fetched = store.getById(s.id);
    expect(fetched?.tags).toEqual(["work", "code-review", "ai"]);
  });
});
