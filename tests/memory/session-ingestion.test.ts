/**
 * Phase H Task 4 — session-level ingestion.
 *
 * Verifies ingestSession runs resolution → extraction → classification
 * → dedup as one unit, and that scheduleViaHook registers a SessionEnd
 * handler that routes observations into memory_entries.
 */

import { describe, expect, it } from "vitest";
import {
  ingestSession,
  scheduleViaHook,
  type HookEngineLike,
  type SessionIngestStoreLike,
} from "../../src/memory/session-ingestion.js";
import type { AutoCaptureEntry } from "../../src/memory/store.js";
import {
  bindPronoun,
  createSessionContext,
} from "../../src/memory/atomic-memory.js";
import type { MemoryRelationship } from "../../src/memory/relationship-types.js";

function makeCapture(overrides: Partial<AutoCaptureEntry> & { id: number }): AutoCaptureEntry {
  return {
    eventType: "tool_call",
    content: "",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ingestSession", () => {
  it("returns empty result for empty input", async () => {
    const result = await ingestSession({ sessionId: "s1", captures: [] });
    expect(result.sessionId).toBe("s1");
    expect(result.readCount).toBe(0);
    expect(result.observations).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it("extracts observations from mixed captures", async () => {
    const result = await ingestSession({
      sessionId: "s1",
      captures: [
        makeCapture({ id: 1, content: "User chose Redis over Memcached", sessionId: "s1" }),
        makeCapture({ id: 2, content: "Build failed with ENOMEM", sessionId: "s1" }),
        makeCapture({ id: 3, content: "All tests passed", sessionId: "s1" }),
      ],
    });
    expect(result.observations.length).toBeGreaterThanOrEqual(3);
    const types = new Set(result.observations.map((o) => o.type));
    expect(types.has("decision")).toBe(true);
    expect(types.has("problem")).toBe(true);
    expect(types.has("milestone")).toBe(true);
  });

  it("applies contextual resolution when a context is supplied", async () => {
    const ctx = bindPronoun(createSessionContext("s1"), "he", "Maya");
    const result = await ingestSession({
      sessionId: "s1",
      captures: [
        makeCapture({
          id: 1,
          content: "he decided to use Postgres instead of MySQL",
          sessionId: "s1",
        }),
      ],
      context: ctx,
    });
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0]!.resolved).toContain("Maya");
    const decision = result.observations.find((o) => o.type === "decision");
    expect(decision?.assertion).toContain("Maya");
  });

  it("emits resolution_failed for unresolved pronouns (honest counter)", async () => {
    const ctx = createSessionContext("s1");
    const result = await ingestSession({
      sessionId: "s1",
      captures: [
        makeCapture({ id: 1, content: "he chose Postgres", sessionId: "s1" }),
      ],
      context: ctx,
    });
    expect(result.failures.resolutionFailed).toBe(1);
    expect(result.resolutions[0]!.kind).toBe("resolution_failed");
  });

  it("dedups observations by assertion text", async () => {
    const result = await ingestSession({
      sessionId: "s1",
      captures: [
        makeCapture({ id: 1, content: "User chose Postgres over MySQL", sessionId: "s1" }),
        // Same content produces same assertion → dedup.
        makeCapture({ id: 2, content: "User chose Postgres over MySQL", sessionId: "s1" }),
      ],
    });
    const decisions = result.observations.filter((o) => o.type === "decision");
    expect(decisions).toHaveLength(1);
  });

  it("reports extractionEmpty when pattern extractor produces nothing", async () => {
    const result = await ingestSession({
      sessionId: "s1",
      captures: [
        makeCapture({ id: 1, content: "Reading a file", sessionId: "s1" }),
        makeCapture({ id: 2, content: "Listing a directory", sessionId: "s1" }),
      ],
    });
    expect(result.observations).toHaveLength(0);
    expect(result.failures.extractionEmpty).toBeGreaterThan(0);
  });

  it("uses endedAt as the relationship createdAt timestamp", async () => {
    const ctx = createSessionContext("s1");
    const result = await ingestSession({
      sessionId: "s1",
      endedAt: 42_000,
      context: ctx,
      captures: [
        makeCapture({
          id: 1,
          content: "Old policy: 30-day return window was chosen for reliability",
          sessionId: "s1",
        }),
        makeCapture({
          id: 2,
          content:
            "This supersedes the previous policy — effective 2026-01-01, return window is now 45 days. I chose this rule.",
          sessionId: "s1",
        }),
      ],
    });
    expect(result.endedAt).toBe(42_000);
    if (result.relationships.length > 0) {
      expect(result.relationships[0]!.createdAt).toBe(42_000);
    }
  });
});

describe("scheduleViaHook", () => {
  it("registers a SessionEnd hook", () => {
    const registered: Array<{ name: string; event: string }> = [];
    const engine: HookEngineLike = {
      register: (h) => registered.push({ name: h.name, event: h.event }),
    };
    const store = makeMockStore([]);
    scheduleViaHook(engine, store, () => undefined);
    expect(registered).toHaveLength(1);
    expect(registered[0]!.event).toBe("SessionEnd");
  });

  it("runs ingestion and routes observations + relationships into the store", async () => {
    const captures: AutoCaptureEntry[] = [
      makeCapture({ id: 1, content: "User chose Postgres over MySQL", sessionId: "s1" }),
      makeCapture({ id: 2, content: "Build succeeded after fixing import", sessionId: "s1" }),
    ];
    const store = makeMockStore(captures);
    const engine: HookEngineLike = { register: () => {} };

    const run = scheduleViaHook(engine, store, () => undefined);
    const result = await run("s1");

    expect(result.observations.length).toBeGreaterThan(0);
    expect(store.inserted.length).toBe(result.observations.length);
    // Relationships may or may not be emitted depending on heuristic hits;
    // always routed through addRelationships which increments totalAdded.
    expect(store.totalAdded).toBe(result.relationships.length);
  });

  it("honest: warns via action=warn when a stage fails", async () => {
    const captures: AutoCaptureEntry[] = [
      makeCapture({ id: 1, content: "he chose Postgres", sessionId: "s1" }),
    ];
    const store = makeMockStore(captures);
    let capturedResult: { action: string; message?: string } | undefined;
    const engine: HookEngineLike = {
      register: (h) => {
        (async () => {
          const result = await h.handler({ sessionId: "s1" });
          capturedResult = result as { action: string; message?: string };
        })();
      },
    };

    scheduleViaHook(engine, store, () => createSessionContext("s1"));

    // Give the microtask queue time to run the deferred handler
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedResult?.action).toBe("warn");
    expect(capturedResult?.message).toContain("stage-failures");
  });

  it("warns when payload is missing sessionId", async () => {
    let capturedResult: { action: string; message?: string } | undefined;
    const engine: HookEngineLike = {
      register: (h) => {
        (async () => {
          const result = await h.handler({});
          capturedResult = result as { action: string; message?: string };
        })();
      },
    };
    const store = makeMockStore([]);
    scheduleViaHook(engine, store, () => undefined);
    await new Promise((r) => setTimeout(r, 10));

    expect(capturedResult?.action).toBe("warn");
    expect(capturedResult?.message).toContain("no sessionId");
  });
});

// ── Mock store ─────────────────────────────────────────

function makeMockStore(captures: readonly AutoCaptureEntry[]): SessionIngestStoreLike & {
  readonly inserted: readonly { id: string; blockType: string }[];
  readonly totalAdded: number;
} {
  const inserted: { id: string; blockType: string }[] = [];
  let totalAdded = 0;
  return {
    getAutoCaptureEntries: () => captures,
    insert: (e) => {
      inserted.push({ id: e.id, blockType: e.blockType });
    },
    addRelationships: (rels: readonly MemoryRelationship[]) => {
      totalAdded += rels.length;
      return rels.length;
    },
    get inserted() {
      return inserted;
    },
    get totalAdded() {
      return totalAdded;
    },
  };
}
