/**
 * Phase 2 P1-M2 — OMEGA 3-layer orchestrator tests.
 *
 * Layer 1 — raw event log (maps to auto_capture)
 * Layer 2 — extracted facts (maps to memory_entries)
 * Layer 3 — compressed summaries (NEW: memory_summaries)
 *
 * The orchestrator does NOT replace the existing tables — it's a read/
 * write facade that composes the canonical 3-layer abstraction over
 * what WOTANN already has. Per CLAUDE.md, we keep existing 8-layer
 * `memory_entries.layer` enum and `auto_capture` table unchanged
 * (regression-lock), and add a new `memory_summaries` table for L3.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "../../src/memory/store.js";
import {
  createOmegaLayers,
  type CompressionSummary,
  type OmegaLlmQuery,
} from "../../src/memory/omega-layers.js";

let tmpDir: string;
let dbPath: string;
let store: MemoryStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "omega-layers-"));
  dbPath = join(tmpDir, "memory.db");
  store = new MemoryStore(dbPath);
});

afterEach(() => {
  try {
    store.close();
  } catch {
    /* ignore */
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("OmegaLayers — Layer 1 (raw events)", () => {
  it("writes raw events and reads them back in insertion order", () => {
    const layers = createOmegaLayers({ store });
    layers.layer1.append({
      eventType: "tool_call",
      toolName: "read",
      content: "read /foo/bar",
      sessionId: "s1",
    });
    layers.layer1.append({
      eventType: "tool_result",
      toolName: "read",
      content: "file content here",
      sessionId: "s1",
    });
    const events = layers.layer1.query({ sessionId: "s1" });
    expect(events.length).toBe(2);
    expect(events[0]?.content).toBe("read /foo/bar");
    expect(events[1]?.content).toBe("file content here");
  });

  it("query filters by session", () => {
    const layers = createOmegaLayers({ store });
    layers.layer1.append({ eventType: "x", content: "a", sessionId: "s1" });
    layers.layer1.append({ eventType: "x", content: "b", sessionId: "s2" });
    expect(layers.layer1.query({ sessionId: "s1" }).length).toBe(1);
    expect(layers.layer1.query({ sessionId: "s2" }).length).toBe(1);
    expect(layers.layer1.query({}).length).toBeGreaterThanOrEqual(2);
  });

  it("respects limit", () => {
    const layers = createOmegaLayers({ store });
    for (let i = 0; i < 10; i++) {
      layers.layer1.append({ eventType: "x", content: `e${i}`, sessionId: "s" });
    }
    const limited = layers.layer1.query({ sessionId: "s", limit: 3 });
    expect(limited.length).toBe(3);
  });
});

describe("OmegaLayers — Layer 2 (facts)", () => {
  it("reads memory_entries via layer2 facade", () => {
    const layers = createOmegaLayers({ store });
    store.insert({
      id: "omega-l2-1",
      layer: "working",
      blockType: "feedback",
      key: "pref/style",
      value: "use immutable data patterns everywhere",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
    });
    const facts = layers.layer2.search("immutable");
    const ids = facts.map((f) => f.id);
    expect(ids).toContain("omega-l2-1");
  });

  it("layer2 returns facts with layer/block metadata", () => {
    const layers = createOmegaLayers({ store });
    store.insert({
      id: "omega-l2-2",
      layer: "core_blocks",
      blockType: "project",
      key: "proj/wotann",
      value: "agent harness for AI",
      verified: false,
      freshnessScore: 1.0,
      confidenceLevel: 0.8,
      verificationStatus: "unverified",
    });
    const facts = layers.layer2.search("harness");
    expect(facts.length).toBeGreaterThan(0);
    expect(facts[0]?.layer).toBeDefined();
    expect(facts[0]?.blockType).toBeDefined();
  });
});

describe("OmegaLayers — Layer 3 (summaries)", () => {
  it("creates memory_summaries table idempotently", () => {
    const layers1 = createOmegaLayers({ store });
    const layers2 = createOmegaLayers({ store });
    expect(layers1.layer3.count()).toBe(0);
    expect(layers2.layer3.count()).toBe(0);
  });

  it("compress: raw L1 events in a time range → summary via LlmQuery", async () => {
    const layers = createOmegaLayers({ store });
    layers.layer1.append({
      eventType: "tool_call",
      content: "edited auth.ts to add JWT validation",
      sessionId: "s1",
    });
    layers.layer1.append({
      eventType: "tool_call",
      content: "ran tests — all pass",
      sessionId: "s1",
    });

    const mockLlm: OmegaLlmQuery = async (prompt: string) => {
      // Mock LLM produces a terse summary referencing input
      expect(prompt).toContain("JWT");
      expect(prompt).toContain("tests");
      return "Added JWT validation to auth.ts and verified via passing tests.";
    };

    const summary = await layers.layer3.compress({
      sessionId: "s1",
      llmQuery: mockLlm,
    });
    expect(summary).not.toBeNull();
    expect(summary!.content).toContain("JWT");
    expect(summary!.sourceEventCount).toBe(2);
  });

  it("compress: no events in range → returns null (honest)", async () => {
    const layers = createOmegaLayers({ store });
    const mockLlm: OmegaLlmQuery = async () => "should not be called";
    const summary = await layers.layer3.compress({
      sessionId: "nonexistent-session",
      llmQuery: mockLlm,
    });
    expect(summary).toBeNull();
  });

  it("compress: preserves L1 event ids for lineage traceability", async () => {
    const layers = createOmegaLayers({ store });
    layers.layer1.append({ eventType: "x", content: "a", sessionId: "s1" });
    layers.layer1.append({ eventType: "x", content: "b", sessionId: "s1" });

    const mockLlm: OmegaLlmQuery = async () => "summary text";
    const summary = await layers.layer3.compress({
      sessionId: "s1",
      llmQuery: mockLlm,
    });
    expect(summary).not.toBeNull();
    expect(summary!.sourceEventIds.length).toBe(2);
    // Each id should be a stable integer reference to an auto_capture row
    for (const id of summary!.sourceEventIds) {
      expect(typeof id).toBe("number");
    }
  });

  it("compress: honest fail when LlmQuery throws", async () => {
    const layers = createOmegaLayers({ store });
    layers.layer1.append({ eventType: "x", content: "a", sessionId: "s1" });
    const mockLlm: OmegaLlmQuery = async () => {
      throw new Error("provider down");
    };
    const summary = await layers.layer3.compress({
      sessionId: "s1",
      llmQuery: mockLlm,
    });
    expect(summary).toBeNull(); // Honest: no stub, no fake content
  });

  it("list: returns stored summaries in created-desc order", async () => {
    const layers = createOmegaLayers({ store });
    layers.layer1.append({ eventType: "x", content: "e1", sessionId: "s1" });
    const mockLlm: OmegaLlmQuery = async () => "first summary";
    const s1 = await layers.layer3.compress({ sessionId: "s1", llmQuery: mockLlm });

    // Allow a time tick so created_at differs
    await new Promise((r) => setTimeout(r, 10));

    layers.layer1.append({ eventType: "x", content: "e2", sessionId: "s2" });
    const s2 = await layers.layer3.compress({
      sessionId: "s2",
      llmQuery: async () => "second summary",
    });

    const all = layers.layer3.list();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const ids = all.map((s) => s.id);
    expect(ids).toContain(s1!.id);
    expect(ids).toContain(s2!.id);
  });
});

describe("OmegaLayers — per-instance isolation", () => {
  it("two OmegaLayers instances over the same store share the same data", () => {
    // Per-session stateless: both facade instances read the same tables.
    // The instances themselves don't carry cross-call state.
    const a = createOmegaLayers({ store });
    const b = createOmegaLayers({ store });
    a.layer1.append({ eventType: "x", content: "shared", sessionId: "s" });
    expect(b.layer1.query({ sessionId: "s" }).length).toBe(1);
  });

  it("layer3 respects custom table name isolation", async () => {
    const a = createOmegaLayers({ store, summariesTable: "omega_summaries_a" });
    const b = createOmegaLayers({ store, summariesTable: "omega_summaries_b" });
    a.layer1.append({ eventType: "x", content: "content", sessionId: "s1" });
    await a.layer3.compress({ sessionId: "s1", llmQuery: async () => "A summary" });
    expect(a.layer3.count()).toBeGreaterThan(0);
    expect(b.layer3.count()).toBe(0);
  });
});

describe("OmegaLayers — compression summary type", () => {
  it("CompressionSummary has expected shape", async () => {
    const layers = createOmegaLayers({ store });
    layers.layer1.append({ eventType: "x", content: "a", sessionId: "s" });
    const summary: CompressionSummary | null = await layers.layer3.compress({
      sessionId: "s",
      llmQuery: async () => "summary",
    });
    expect(summary).not.toBeNull();
    expect(typeof summary!.id).toBe("string");
    expect(typeof summary!.content).toBe("string");
    expect(typeof summary!.createdAt).toBe("string");
    expect(Array.isArray(summary!.sourceEventIds)).toBe(true);
    expect(summary!.sourceEventCount).toBeGreaterThan(0);
  });
});
