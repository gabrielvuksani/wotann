/**
 * Phase 2 P1-M5: bi-temporal edges (Zep/Graphiti port).
 *
 * Verifies the TWO-axis time model on knowledge_edges:
 *   - knowledge-time: valid_from / valid_to (when the fact is true)
 *   - ingest-time:    recorded_from / recorded_to (when WOTANN knew it)
 *
 * Each test isolates a single behavior so a regression in one axis
 * doesn't mask regressions elsewhere.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "../../src/memory/store.js";
import {
  ValidationError,
  validateDate,
  validateDateOrNull,
  isValidAt,
  isKnownAt,
  matchesSnapshot,
  filterValidAt,
  filterKnownAt,
  filterSnapshot,
  defaultIngestAxis,
  defaultKnowledgeAxis,
  buildInvalidationFields,
  type BiTemporalEdge,
} from "../../src/memory/bi-temporal-edges.js";

let dir: string;
let store: MemoryStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bi-temporal-edges-"));
  store = new MemoryStore(join(dir, "memory.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// ── Helpers ─────────────────────────────────────────────────

function makeNodes(): { from: string; to: string } {
  const from = store.addKnowledgeNode("EntityA", "concept");
  const to = store.addKnowledgeNode("EntityB", "concept");
  return { from, to };
}

function makeEdge(opts?: Parameters<MemoryStore["addBiTemporalEdge"]>[3]): {
  edgeId: string;
  from: string;
  to: string;
} {
  const { from, to } = makeNodes();
  const edgeId = store.addBiTemporalEdge(from, to, "related-to", opts ?? {});
  return { edgeId, from, to };
}

// ── Pure-module tests ───────────────────────────────────────

describe("bi-temporal-edges: pure helpers", () => {
  it("validateDate accepts ISO-8601 YYYY-MM-DD", () => {
    expect(validateDate("2026-04-20", "d")).toBe("2026-04-20");
  });

  it("validateDate accepts full ISO-8601 with Z", () => {
    expect(validateDate("2026-04-20T12:00:00.000Z", "d")).toBe("2026-04-20T12:00:00.000Z");
  });

  it("validateDate rejects non-strings", () => {
    expect(() => validateDate(42, "d")).toThrow(ValidationError);
    expect(() => validateDate(null, "d")).toThrow(ValidationError);
    expect(() => validateDate(undefined, "d")).toThrow(ValidationError);
  });

  it("validateDate rejects malformed strings", () => {
    expect(() => validateDate("not-a-date", "d")).toThrow(ValidationError);
    expect(() => validateDate("2026/04/20", "d")).toThrow(ValidationError);
    expect(() => validateDate("", "d")).toThrow(ValidationError);
  });

  it("validateDateOrNull passes null through but rejects garbage", () => {
    expect(validateDateOrNull(null, "d")).toBeNull();
    expect(validateDateOrNull(undefined, "d")).toBeNull();
    expect(validateDateOrNull("2026-01-01", "d")).toBe("2026-01-01");
    expect(() => validateDateOrNull("bad", "d")).toThrow(ValidationError);
  });

  it("isValidAt: date inside [validFrom, validTo] returns true", () => {
    const edge: BiTemporalEdge = {
      id: "e",
      sourceId: "a",
      targetId: "b",
      relation: "r",
      weight: 1,
      validFrom: "2026-01-01T00:00:00Z",
      validTo: "2026-12-31T23:59:59Z",
      recordedFrom: "2026-01-01T00:00:00Z",
      recordedTo: null,
    };
    expect(isValidAt(edge, "2026-06-15T00:00:00Z")).toBe(true);
  });

  it("isValidAt: date before validFrom returns false", () => {
    const edge: BiTemporalEdge = {
      id: "e",
      sourceId: "a",
      targetId: "b",
      relation: "r",
      weight: 1,
      validFrom: "2026-06-01T00:00:00Z",
      validTo: null,
      recordedFrom: "2026-06-01T00:00:00Z",
      recordedTo: null,
    };
    expect(isValidAt(edge, "2026-01-01T00:00:00Z")).toBe(false);
  });

  it("isValidAt: null validTo treated as still-valid", () => {
    const edge: BiTemporalEdge = {
      id: "e",
      sourceId: "a",
      targetId: "b",
      relation: "r",
      weight: 1,
      validFrom: "2026-01-01T00:00:00Z",
      validTo: null,
      recordedFrom: "2026-01-01T00:00:00Z",
      recordedTo: null,
    };
    expect(isValidAt(edge, "9999-12-31T00:00:00Z")).toBe(true);
  });

  it("isKnownAt: null recordedTo treated as still-known", () => {
    const edge: BiTemporalEdge = {
      id: "e",
      sourceId: "a",
      targetId: "b",
      relation: "r",
      weight: 1,
      validFrom: "2026-01-01T00:00:00Z",
      validTo: null,
      recordedFrom: "2026-01-01T00:00:00Z",
      recordedTo: null,
    };
    expect(isKnownAt(edge, "9999-12-31T00:00:00Z")).toBe(true);
  });

  it("isKnownAt: date before recordedFrom returns false", () => {
    const edge: BiTemporalEdge = {
      id: "e",
      sourceId: "a",
      targetId: "b",
      relation: "r",
      weight: 1,
      validFrom: "2020-01-01T00:00:00Z",
      validTo: null,
      recordedFrom: "2026-06-01T00:00:00Z",
      recordedTo: null,
    };
    expect(isKnownAt(edge, "2026-01-01T00:00:00Z")).toBe(false);
  });

  it("matchesSnapshot: combines both axes", () => {
    const edge: BiTemporalEdge = {
      id: "e",
      sourceId: "a",
      targetId: "b",
      relation: "r",
      weight: 1,
      validFrom: "2020-01-01T00:00:00Z",
      validTo: "2023-01-01T00:00:00Z",
      recordedFrom: "2026-01-01T00:00:00Z",
      recordedTo: null,
    };
    expect(
      matchesSnapshot(edge, {
        validAt: "2021-06-01T00:00:00Z",
        knownAt: "2026-06-01T00:00:00Z",
      }),
    ).toBe(true);
    // Fact was NOT valid in 2024
    expect(
      matchesSnapshot(edge, {
        validAt: "2024-06-01T00:00:00Z",
        knownAt: "2026-06-01T00:00:00Z",
      }),
    ).toBe(false);
    // WOTANN did NOT know in 2025
    expect(
      matchesSnapshot(edge, {
        validAt: "2021-06-01T00:00:00Z",
        knownAt: "2025-06-01T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("filterValidAt / filterKnownAt partition a list correctly", () => {
    const base: BiTemporalEdge = {
      id: "1",
      sourceId: "a",
      targetId: "b",
      relation: "r",
      weight: 1,
      validFrom: "2020-01-01T00:00:00Z",
      validTo: "2022-12-31T00:00:00Z",
      recordedFrom: "2020-01-01T00:00:00Z",
      recordedTo: null,
    };
    const edges: BiTemporalEdge[] = [
      base,
      { ...base, id: "2", validFrom: "2023-01-01T00:00:00Z", validTo: null },
      { ...base, id: "3", recordedFrom: "2026-04-20T00:00:00Z" },
    ];
    const valid2021 = filterValidAt(edges, "2021-06-01T00:00:00Z");
    expect(valid2021.map((e) => e.id).sort()).toEqual(["1", "3"]);
    const known2025 = filterKnownAt(edges, "2025-01-01T00:00:00Z");
    expect(known2025.map((e) => e.id).sort()).toEqual(["1", "2"]);
    const snap = filterSnapshot(edges, {
      validAt: "2021-06-01T00:00:00Z",
      knownAt: "2025-01-01T00:00:00Z",
    });
    expect(snap.map((e) => e.id).sort()).toEqual(["1"]);
  });

  it("filterSnapshot throws on invalid date inputs", () => {
    expect(() => filterSnapshot([], { validAt: "bad", knownAt: "2026-01-01" })).toThrow(
      ValidationError,
    );
    expect(() => filterSnapshot([], { validAt: "2026-01-01", knownAt: "oops" })).toThrow(
      ValidationError,
    );
  });

  it("defaultIngestAxis / defaultKnowledgeAxis return documented defaults", () => {
    const t = "2026-04-20T00:00:00Z";
    expect(defaultIngestAxis(t)).toEqual({ recordedFrom: t, recordedTo: null });
    expect(defaultKnowledgeAxis(t)).toEqual({ validFrom: t, validTo: null });
  });

  it("buildInvalidationFields sets recordedTo, leaves validTo undefined when no factEndedAt", () => {
    const fields = buildInvalidationFields({ retractedAt: "2026-04-20T00:00:00Z" });
    expect(fields.recordedTo).toBe("2026-04-20T00:00:00Z");
    expect(fields.validTo).toBeUndefined();
  });

  it("buildInvalidationFields sets both when factEndedAt supplied", () => {
    const fields = buildInvalidationFields({
      retractedAt: "2026-04-20T00:00:00Z",
      factEndedAt: "2026-03-01T00:00:00Z",
    });
    expect(fields.recordedTo).toBe("2026-04-20T00:00:00Z");
    expect(fields.validTo).toBe("2026-03-01T00:00:00Z");
  });
});

// ── Store-backed tests ──────────────────────────────────────

describe("MemoryStore.addBiTemporalEdge", () => {
  it("stamps recorded_from with now() on insert when not provided", () => {
    const before = new Date().toISOString();
    const { edgeId } = makeEdge();
    const after = new Date().toISOString();
    const edge = store.getBiTemporalEdge(edgeId);
    expect(edge).not.toBeNull();
    expect(edge!.recordedFrom >= before).toBe(true);
    expect(edge!.recordedFrom <= after).toBe(true);
    expect(edge!.recordedTo).toBeNull();
  });

  it("preserves caller-supplied valid_from", () => {
    const { edgeId } = makeEdge({ validFrom: "2020-01-01T00:00:00Z" });
    const edge = store.getBiTemporalEdge(edgeId);
    expect(edge!.validFrom).toBe("2020-01-01T00:00:00Z");
    expect(edge!.validTo).toBeNull();
  });

  it("supports a bounded knowledge-time range", () => {
    const { edgeId } = makeEdge({
      validFrom: "2020-01-01T00:00:00Z",
      validTo: "2023-12-31T00:00:00Z",
    });
    const edge = store.getBiTemporalEdge(edgeId);
    expect(edge!.validFrom).toBe("2020-01-01T00:00:00Z");
    expect(edge!.validTo).toBe("2023-12-31T00:00:00Z");
  });

  it("throws ValidationError on malformed validFrom", () => {
    const { from, to } = makeNodes();
    expect(() => store.addBiTemporalEdge(from, to, "r", { validFrom: "not-iso" })).toThrow(
      ValidationError,
    );
  });

  it("throws ValidationError on malformed validTo", () => {
    const { from, to } = makeNodes();
    expect(() =>
      store.addBiTemporalEdge(from, to, "r", {
        validFrom: "2020-01-01",
        validTo: "garbage",
      }),
    ).toThrow(ValidationError);
  });
});

describe("MemoryStore.retractBiTemporalEdge", () => {
  it("sets recorded_to while preserving recorded_from", () => {
    const { edgeId } = makeEdge();
    const before = store.getBiTemporalEdge(edgeId);
    const retractedAt = new Date(Date.now() + 1000).toISOString();
    const ok = store.retractBiTemporalEdge(edgeId, { retractedAt });
    expect(ok).toBe(true);
    const after = store.getBiTemporalEdge(edgeId);
    expect(after!.recordedFrom).toBe(before!.recordedFrom);
    expect(after!.recordedTo).toBe(retractedAt);
    // Knowledge axis untouched unless caller supplied factEndedAt
    expect(after!.validTo).toBe(before!.validTo);
  });

  it("closes both axes when factEndedAt is supplied", () => {
    const { edgeId } = makeEdge({ validFrom: "2020-01-01T00:00:00Z" });
    const retractedAt = "2026-04-20T00:00:00Z";
    const factEndedAt = "2025-12-31T00:00:00Z";
    store.retractBiTemporalEdge(edgeId, { retractedAt, factEndedAt });
    const edge = store.getBiTemporalEdge(edgeId);
    expect(edge!.validTo).toBe(factEndedAt);
    expect(edge!.recordedTo).toBe(retractedAt);
  });

  it("returns false and is a no-op on double retract", () => {
    const { edgeId } = makeEdge();
    expect(store.retractBiTemporalEdge(edgeId)).toBe(true);
    expect(store.retractBiTemporalEdge(edgeId)).toBe(false);
  });

  it("throws ValidationError on malformed retractedAt", () => {
    const { edgeId } = makeEdge();
    expect(() => store.retractBiTemporalEdge(edgeId, { retractedAt: "oops" })).toThrow(
      ValidationError,
    );
  });
});

describe("MemoryStore.queryValidAt", () => {
  it("includes edges where validFrom ≤ date ≤ validTo", () => {
    makeEdge({ validFrom: "2020-01-01T00:00:00Z", validTo: "2022-12-31T00:00:00Z" });
    makeEdge({ validFrom: "2023-01-01T00:00:00Z", validTo: null });
    const r = store.queryValidAt("2021-06-01T00:00:00Z");
    expect(r.length).toBe(1);
  });

  it("excludes edges whose valid window has passed", () => {
    makeEdge({ validFrom: "2020-01-01T00:00:00Z", validTo: "2022-12-31T00:00:00Z" });
    const r = store.queryValidAt("2024-06-01T00:00:00Z");
    expect(r.length).toBe(0);
  });

  it("throws on invalid date", () => {
    expect(() => store.queryValidAt("not-a-date")).toThrow(ValidationError);
  });
});

describe("MemoryStore.queryKnownAt", () => {
  it("excludes edges recorded after the query date", () => {
    makeEdge({ recordedFrom: "2026-04-20T00:00:00Z" });
    const r = store.queryKnownAt("2026-01-01T00:00:00Z");
    expect(r.length).toBe(0);
  });

  it("includes still-known edges at any future date", () => {
    makeEdge({ recordedFrom: "2026-01-01T00:00:00Z" });
    const r = store.queryKnownAt("2099-01-01T00:00:00Z");
    expect(r.length).toBe(1);
  });

  it("throws on invalid date", () => {
    expect(() => store.queryKnownAt("garbage")).toThrow(ValidationError);
  });
});

describe("MemoryStore.querySnapshot", () => {
  it("combines both axes: fact valid AND known at the snapshot point", () => {
    makeEdge({
      validFrom: "2020-01-01T00:00:00Z",
      validTo: "2022-12-31T00:00:00Z",
      recordedFrom: "2026-01-01T00:00:00Z",
    });
    // Valid in 2021 AND known in 2026 → match
    expect(
      store.querySnapshot({
        validAt: "2021-06-01T00:00:00Z",
        knownAt: "2026-06-01T00:00:00Z",
      }).length,
    ).toBe(1);
    // Not yet known in 2025 → no match
    expect(
      store.querySnapshot({
        validAt: "2021-06-01T00:00:00Z",
        knownAt: "2025-06-01T00:00:00Z",
      }).length,
    ).toBe(0);
    // No longer valid in 2024 → no match
    expect(
      store.querySnapshot({
        validAt: "2024-06-01T00:00:00Z",
        knownAt: "2026-06-01T00:00:00Z",
      }).length,
    ).toBe(0);
  });

  it("throws on invalid dates", () => {
    expect(() =>
      store.querySnapshot({ validAt: "nope", knownAt: "2026-01-01T00:00:00Z" }),
    ).toThrow(ValidationError);
  });
});

describe("MemoryStore.replaceBiTemporalEdge", () => {
  it("invalidates the old edge and inserts a replacement at the same instant", () => {
    const { edgeId, from, to } = makeEdge({ validFrom: "2020-01-01T00:00:00Z" });
    const at = "2026-04-20T00:00:00Z";
    const newEdgeId = store.replaceBiTemporalEdge(edgeId, {
      sourceId: from,
      targetId: to,
      relation: "related-to",
      at,
    });
    expect(newEdgeId).not.toBeNull();

    const oldEdge = store.getBiTemporalEdge(edgeId);
    expect(oldEdge!.recordedTo).toBe(at);
    expect(oldEdge!.validTo).toBe(at);

    const newEdge = store.getBiTemporalEdge(newEdgeId!);
    expect(newEdge!.validFrom).toBe(at);
    expect(newEdge!.validTo).toBeNull();
    expect(newEdge!.recordedFrom).toBe(at);
    expect(newEdge!.recordedTo).toBeNull();
  });

  it("returns null when the source edge doesn't exist", () => {
    const { from, to } = makeNodes();
    const result = store.replaceBiTemporalEdge("does-not-exist", {
      sourceId: from,
      targetId: to,
      relation: "r",
    });
    expect(result).toBeNull();
  });
});

describe("MemoryStore legacy compatibility (migration)", () => {
  it("addKnowledgeEdge (legacy path) now populates recorded_from automatically", () => {
    const { from, to } = makeNodes();
    const id = store.addKnowledgeEdge(from, to, "related-to");
    const edge = store.getBiTemporalEdge(id);
    expect(edge).not.toBeNull();
    expect(edge!.recordedFrom.length).toBeGreaterThan(0);
    expect(edge!.recordedTo).toBeNull();
  });

  it("getActiveEdgesAt (legacy API) still works after migration", () => {
    const { from, to } = makeNodes();
    store.addKnowledgeEdge(from, to, "related-to");
    const r = store.getActiveEdgesAt(new Date().toISOString());
    expect(r.length).toBe(1);
  });
});
