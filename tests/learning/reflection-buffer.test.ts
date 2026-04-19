import { describe, it, expect } from "vitest";
import { ReflectionBuffer } from "../../src/learning/reflection-buffer.js";

describe("ReflectionBuffer — add + retrieve", () => {
  it("starts empty", () => {
    const b = new ReflectionBuffer();
    expect(b.size()).toBe(0);
    expect(b.retrieve()).toEqual([]);
  });

  it("add creates entry with id + timestamp", () => {
    const b = new ReflectionBuffer();
    const entry = b.add({
      context: "writing tests",
      mistake: "used mock where real call was required",
      correction: "use real call + in-memory adapter",
    });
    expect(entry.id).toBeTruthy();
    expect(b.size()).toBe(1);
  });

  it("retrieve respects limit", () => {
    const b = new ReflectionBuffer();
    for (let i = 0; i < 10; i++) {
      b.add({ context: `c${i}`, mistake: `m${i}`, correction: `fix${i}` });
    }
    expect(b.retrieve({ limit: 3 })).toHaveLength(3);
  });
});

describe("ReflectionBuffer — filtering", () => {
  it("tag filter (any-match)", () => {
    const b = new ReflectionBuffer();
    b.add({ context: "a", mistake: "m", correction: "c", tags: ["bash"] });
    b.add({ context: "b", mistake: "m", correction: "c", tags: ["ts"] });
    b.add({ context: "c", mistake: "m", correction: "c", tags: ["bash", "ts"] });
    const result = b.retrieve({ tags: ["bash"] });
    expect(result).toHaveLength(2);
  });

  it("query substring over context + mistake", () => {
    const b = new ReflectionBuffer();
    b.add({ context: "parsing JSON", mistake: "assumed UTF-8", correction: "check BOM" });
    b.add({ context: "writing files", mistake: "wrong perms", correction: "chmod 644" });
    const r = b.retrieve({ query: "JSON" });
    expect(r).toHaveLength(1);
    expect(r[0]?.context).toContain("JSON");
  });

  it("minAgeDays / maxAgeDays filter", () => {
    let now = 10 * 86_400_000;
    const b = new ReflectionBuffer({ now: () => now });
    b.add({ context: "old", mistake: "m", correction: "c" });
    now += 5 * 86_400_000;
    b.add({ context: "recent", mistake: "m", correction: "c" });
    now += 1 * 86_400_000;

    // Only entries 2+ days old
    const old = b.retrieve({ minAgeDays: 2 });
    expect(old.map((e) => e.context)).toContain("old");
    expect(old.map((e) => e.context)).not.toContain("recent");
  });
});

describe("ReflectionBuffer — scoring", () => {
  it("recent entries score higher", () => {
    let now = 0;
    const b = new ReflectionBuffer({ now: () => now });
    b.add({ context: "old", mistake: "m", correction: "c" });
    now += 30 * 86_400_000; // 30 days later
    b.add({ context: "new", mistake: "m", correction: "c" });
    now += 1;
    const r = b.retrieve({ limit: 2 });
    expect(r[0]?.context).toBe("new"); // more recent
  });

  it("tag match boosts score", () => {
    const b = new ReflectionBuffer();
    b.add({ context: "no-tag", mistake: "m", correction: "c" });
    b.add({ context: "tagged", mistake: "m", correction: "c", tags: ["special"] });
    const r = b.retrieve({ tags: ["special"] });
    expect(r[0]?.context).toBe("tagged");
  });

  it("hits incremented on retrieval", () => {
    const b = new ReflectionBuffer();
    b.add({ context: "x", mistake: "m", correction: "c" });
    b.retrieve();
    b.retrieve();
    const entry = b.list()[0];
    expect(entry?.hits).toBe(2);
  });
});

describe("ReflectionBuffer — serialization", () => {
  it("serialize + loadSerialized round-trip", () => {
    const b1 = new ReflectionBuffer();
    b1.add({ context: "x", mistake: "m", correction: "c", tags: ["t"] });
    const raw = b1.serialize();

    const b2 = new ReflectionBuffer();
    b2.loadSerialized(raw);
    expect(b2.size()).toBe(1);
    expect(b2.list()[0]?.context).toBe("x");
  });

  it("loadSerialized tolerant of garbage", () => {
    const b = new ReflectionBuffer();
    b.loadSerialized("not json");
    expect(b.size()).toBe(0);
  });
});

describe("ReflectionBuffer — formatForPrompt", () => {
  it("empty produces empty string", () => {
    const b = new ReflectionBuffer();
    expect(b.formatForPrompt([])).toBe("");
  });

  it("formats entries as prompt block", () => {
    const b = new ReflectionBuffer();
    const entry = b.add({
      context: "ctx",
      mistake: "mis",
      correction: "corr",
    });
    const text = b.formatForPrompt([entry]);
    expect(text).toContain("past mistakes");
    expect(text).toContain("ctx");
    expect(text).toContain("mis");
    expect(text).toContain("corr");
  });
});

describe("ReflectionBuffer — lifecycle", () => {
  it("removeById removes", () => {
    const b = new ReflectionBuffer();
    const e = b.add({ context: "x", mistake: "m", correction: "c" });
    expect(b.removeById(e.id)).toBe(true);
    expect(b.size()).toBe(0);
    expect(b.removeById("nonexistent")).toBe(false);
  });

  it("clear empties buffer", () => {
    const b = new ReflectionBuffer();
    b.add({ context: "x", mistake: "m", correction: "c" });
    b.clear();
    expect(b.size()).toBe(0);
  });
});
