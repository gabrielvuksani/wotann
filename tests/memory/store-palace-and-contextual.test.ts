/**
 * Phase 2 P1-M7: wire tests — mem-palace + contextual-embeddings
 * helpers into MemoryStore.
 *
 * mem-palace:
 *   - palaceListHalls / palaceListWings / palaceListRooms derived
 *     from memory_entries' domain/topic columns
 *   - palaceCountTree + palaceTreeText produce human-readable outlines
 *   - palaceParsePath / palaceFormatPath round-trip a palace path
 *
 * contextual-embeddings:
 *   - installContextGenerator stores the async generator
 *   - enableContextualRetrieval installs an LLM-backed generator
 *   - buildContextualChunk returns concatenated context+chunk
 *   - buildContextualChunksBatch parallelizes with bounded concurrency
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "store-palace-ctx-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore palace helpers (mem-palace wire)", () => {
  it("palaceListHalls returns distinct halls from memory_entries rows", () => {
    // Palace path "auth/oauth" → domain="auth", topic="oauth"
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "k-a",
      value: "v-a",
      verified: true,
      domain: "auth",
      topic: "oauth",
    });
    store.insert({
      id: "b",
      layer: "core_blocks",
      blockType: "feedback",
      key: "k-b",
      value: "v-b",
      verified: true,
      domain: "deploy",
      topic: "docker",
    });
    const halls = store.palaceListHalls();
    expect(halls).toContain("auth");
    expect(halls).toContain("deploy");
  });

  it("palaceListWings returns wings under a hall", () => {
    // Palace path "auth/login" → domain="auth", topic="login"
    // Palace path "auth/signup" → domain="auth", topic="signup"
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "k",
      value: "v",
      verified: true,
      domain: "auth",
      topic: "login",
    });
    store.insert({
      id: "b",
      layer: "core_blocks",
      blockType: "feedback",
      key: "k",
      value: "v2",
      verified: true,
      domain: "auth",
      topic: "signup",
    });
    const wings = store.palaceListWings("auth");
    expect(wings).toContain("login");
    expect(wings).toContain("signup");
  });

  it("palaceCountTree + palaceTreeText produce a readable outline", () => {
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "k",
      value: "v",
      verified: true,
      domain: "deploy",
      topic: "k8s",
    });
    const tree = store.palaceCountTree();
    expect(tree.length).toBeGreaterThan(0);
    const text = store.palaceTreeText();
    expect(text).toContain("deploy");
  });

  it("palaceParsePath + palaceFormatPath round-trip", () => {
    const parsed = store.palaceParsePath("alpha/beta/gamma");
    expect(parsed.hall).toBe("alpha");
    expect(parsed.wing).toBe("beta");
    expect(parsed.room).toBe("gamma");
    const formatted = store.palaceFormatPath(parsed);
    expect(formatted).toBe("alpha/beta/gamma");
  });
});

describe("MemoryStore contextual embeddings wire", () => {
  it("installContextGenerator stores the async generator", () => {
    const gen = {
      generate: async (chunk: string) => `ctx:${chunk.slice(0, 3)}`,
    };
    store.installContextGenerator(gen);
    expect(store.getContextGenerator()).toBe(gen);
    store.installContextGenerator(null);
    expect(store.getContextGenerator()).toBeNull();
  });

  it("enableContextualRetrieval installs an LLM-backed generator", () => {
    const llm = async () => "Generated context";
    store.enableContextualRetrieval(llm);
    expect(store.getContextGenerator()).not.toBeNull();
  });

  it("buildContextualChunk returns context + chunk concatenated", async () => {
    const llm = async () => "This chunk is about testing.";
    const out = await store.buildContextualChunk(
      "Chunk about testing.",
      "Document about software testing best practices.",
      llm,
    );
    expect(out).toContain("Chunk about testing.");
    expect(out).toContain("This chunk is about testing.");
  });

  it("buildContextualChunksBatch handles multiple chunks", async () => {
    let callCount = 0;
    const llm = async () => {
      callCount++;
      return `context-${callCount}`;
    };
    const out = await store.buildContextualChunksBatch(
      ["chunk-1", "chunk-2", "chunk-3"],
      "Document.",
      llm,
    );
    expect(out.length).toBe(3);
    for (const c of out) {
      expect(c).toMatch(/context-\d+/);
    }
  });

  it("installContextGenerator does NOT affect sync insert() pipeline", () => {
    // Async generator is separate from the sync setContextGenerator
    // used by insert(). This test proves they're independent.
    const gen = {
      generate: async () => "some-context",
    };
    store.installContextGenerator(gen);
    store.insert({
      id: "a",
      layer: "core_blocks",
      blockType: "feedback",
      key: "k",
      value: "v",
      verified: true,
    });
    const entry = store.getById("a");
    expect(entry).not.toBeNull();
    expect(entry!.value).toBe("v"); // no sync context injected
  });
});
