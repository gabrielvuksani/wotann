/**
 * Tests for KV-cache-stable timestamp utilities (P1-B8).
 *
 * These tests pin the invariants that make Anthropic / OpenAI prompt
 * caching hit across turns within the same session:
 *
 *   1. formatCacheSafeDate returns `YYYY-MM-DD` exactly (date only).
 *   2. It is UTC-stable (no local-time drift in mixed-timezone setups).
 *   3. Same date produces byte-identical output across many calls.
 *   4. Different dates produce different output (expected invalidation).
 *   5. Honest failure: invalid Date → epoch fallback, no throw.
 *   6. stripIsoTimestampsFromPrompt collapses full ISO to date-only.
 *   7. Regression-lock: the bootstrap snapshot's prompt form has no
 *      sub-day timestamps after passing through the stripper.
 *   8. findIsoTimestampsInPrompt correctly detects drift surfaces.
 *
 * The spec (MASTER_PLAN_V8 §5 P1-B8) targets 40–90% provider-side
 * prompt-cache hit rate across turns in the same session. Every
 * test below encodes one invariant that, if broken, would tank the
 * hit rate back toward 0%.
 */

import { describe, it, expect } from "vitest";
import {
  formatCacheSafeDate,
  stripIsoTimestampsFromPrompt,
  findIsoTimestampsInPrompt,
  ISO_TIMESTAMP_REGEX,
} from "../../src/prompt/system-prompt.js";

// ── formatCacheSafeDate ──────────────────────────────────

describe("formatCacheSafeDate", () => {
  it("returns YYYY-MM-DD for a known UTC Date", () => {
    // Use UTC constructor so the test is timezone-agnostic.
    const d = new Date(Date.UTC(2026, 3, 20, 15, 32, 45, 812)); // April=3
    expect(formatCacheSafeDate(d)).toBe("2026-04-20");
  });

  it("output is exactly 10 characters long", () => {
    const d = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, 0));
    const out = formatCacheSafeDate(d);
    expect(out.length).toBe(10);
    expect(out).toBe("2026-01-01");
  });

  it("is stable across calls with the same Date instance", () => {
    const d = new Date(Date.UTC(2026, 5, 15, 9, 0, 0, 0));
    const a = formatCacheSafeDate(d);
    const b = formatCacheSafeDate(d);
    const c = formatCacheSafeDate(d);
    // Byte-identical output — the cache-stability invariant.
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("is stable when the underlying moment changes within the same UTC day", () => {
    // Same day, different sub-second times — the crucial cache-stability
    // case. Intra-day turn drift must NOT invalidate the prefix.
    const earlyMorning = new Date(Date.UTC(2026, 3, 20, 0, 0, 1, 0));
    const noon = new Date(Date.UTC(2026, 3, 20, 12, 30, 45, 500));
    const lateEvening = new Date(Date.UTC(2026, 3, 20, 23, 59, 59, 999));

    expect(formatCacheSafeDate(earlyMorning)).toBe("2026-04-20");
    expect(formatCacheSafeDate(noon)).toBe("2026-04-20");
    expect(formatCacheSafeDate(lateEvening)).toBe("2026-04-20");
  });

  it("changes across different UTC days — expected cache invalidation", () => {
    const day1 = new Date(Date.UTC(2026, 3, 20, 23, 0, 0, 0));
    const day2 = new Date(Date.UTC(2026, 3, 21, 1, 0, 0, 0));
    expect(formatCacheSafeDate(day1)).toBe("2026-04-20");
    expect(formatCacheSafeDate(day2)).toBe("2026-04-21");
    expect(formatCacheSafeDate(day1)).not.toBe(formatCacheSafeDate(day2));
  });

  it("uses UTC — not local timezone — so TZ-differing runs cache-match", () => {
    // A Date constructed from a UTC moment near the day boundary.
    // Whether the caller's local TZ is UTC+14 or UTC-12, the cache
    // key must be the UTC day.
    const utc = new Date(Date.UTC(2026, 3, 20, 23, 30, 0, 0));
    // Direct assertion: formatCacheSafeDate mirrors toISOString().slice(0,10)
    // which is always UTC. No local-time shifting.
    expect(formatCacheSafeDate(utc)).toBe(utc.toISOString().slice(0, 10));
  });

  it("defaults `now` to the current Date when no argument passed", () => {
    // We don't assert the exact day (the test would drift), only the
    // shape: `YYYY-MM-DD`, 10 chars, matches the literal ISO prefix.
    const out = formatCacheSafeDate();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.length).toBe(10);
  });

  it("honest-failure: invalid Date → epoch fallback, no throw", () => {
    const bad = new Date("absolutely-not-a-date");
    expect(Number.isNaN(bad.getTime())).toBe(true);
    // Must NOT throw.
    expect(() => formatCacheSafeDate(bad)).not.toThrow();
    // Fallback is deterministic — the cache key stays stable even on
    // a busted clock.
    expect(formatCacheSafeDate(bad)).toBe("1970-01-01");
  });

  it("honest-failure: non-Date input → epoch fallback, no throw", () => {
    // TypeScript would reject this at compile time, but runtime input
    // may come from JSON / untrusted sources. Pin the defensive branch.
    const notADate = {} as unknown as Date;
    expect(() => formatCacheSafeDate(notADate)).not.toThrow();
    expect(formatCacheSafeDate(notADate)).toBe("1970-01-01");
  });
});

// ── stripIsoTimestampsFromPrompt ─────────────────────────

describe("stripIsoTimestampsFromPrompt", () => {
  it("collapses a full ISO timestamp to its date-only prefix", () => {
    const input = "Captured: 2026-04-20T15:32:45.812Z\nWorkspace: /home/x";
    const output = stripIsoTimestampsFromPrompt(input);
    expect(output).toContain("Captured: 2026-04-20\n");
    expect(output).not.toContain("T15:32:45");
    expect(output).not.toContain(".812Z");
  });

  it("handles ISO timestamp without milliseconds", () => {
    const input = "Captured: 2026-04-20T15:32:45Z";
    const output = stripIsoTimestampsFromPrompt(input);
    expect(output).toBe("Captured: 2026-04-20");
  });

  it("leaves date-only strings untouched (idempotent)", () => {
    const input = "Captured: 2026-04-20\nNothing to strip here.";
    expect(stripIsoTimestampsFromPrompt(input)).toBe(input);
  });

  it("collapses multiple ISO timestamps in one fragment", () => {
    const input = "Start: 2026-04-20T10:00:00Z, End: 2026-04-21T18:45:30.123Z";
    const output = stripIsoTimestampsFromPrompt(input);
    expect(output).toBe("Start: 2026-04-20, End: 2026-04-21");
  });

  it("returns identical empty string for empty input", () => {
    expect(stripIsoTimestampsFromPrompt("")).toBe("");
  });

  it("does NOT mutate the input string", () => {
    const original = "Captured: 2026-04-20T15:32:45.812Z";
    const copy = original;
    stripIsoTimestampsFromPrompt(original);
    // String primitives are immutable in JS, but this pins the invariant
    // that `original` still holds the same value after processing.
    expect(original).toBe(copy);
  });
});

// ── findIsoTimestampsInPrompt ────────────────────────────

describe("findIsoTimestampsInPrompt", () => {
  it("returns empty list when the prompt has no ISO timestamps", () => {
    const clean = "Captured: 2026-04-20\nBranch: main\nDirty: no";
    expect(findIsoTimestampsInPrompt(clean)).toEqual([]);
  });

  it("detects every ISO timestamp in a mixed-content prompt", () => {
    const dirty =
      "A: 2026-04-20T10:00:00Z, B: 2026-04-21T18:45:30.123Z, date-only: 2026-04-22";
    const hits = findIsoTimestampsInPrompt(dirty);
    expect(hits.length).toBe(2);
    expect(hits[0]).toBe("2026-04-20T10:00:00Z");
    expect(hits[1]).toBe("2026-04-21T18:45:30.123Z");
  });

  it("returns empty list for empty input", () => {
    expect(findIsoTimestampsInPrompt("")).toEqual([]);
  });
});

// ── ISO_TIMESTAMP_REGEX (exported for reuse) ─────────────

describe("ISO_TIMESTAMP_REGEX", () => {
  it("matches the exact shape Date.prototype.toISOString() emits", () => {
    const d = new Date(Date.UTC(2026, 3, 20, 15, 32, 45, 812));
    const iso = d.toISOString();
    expect(iso).toBe("2026-04-20T15:32:45.812Z");
    // Regex is /g (stateful); reset before reuse.
    ISO_TIMESTAMP_REGEX.lastIndex = 0;
    expect(ISO_TIMESTAMP_REGEX.test(iso)).toBe(true);
  });

  it("matches ISO timestamps with or without millisecond fraction", () => {
    ISO_TIMESTAMP_REGEX.lastIndex = 0;
    expect(ISO_TIMESTAMP_REGEX.test("2026-04-20T15:32:45Z")).toBe(true);
    ISO_TIMESTAMP_REGEX.lastIndex = 0;
    expect(ISO_TIMESTAMP_REGEX.test("2026-04-20T15:32:45.8Z")).toBe(true);
    ISO_TIMESTAMP_REGEX.lastIndex = 0;
    expect(ISO_TIMESTAMP_REGEX.test("2026-04-20T15:32:45.812Z")).toBe(true);
  });

  it("does NOT match date-only or otherwise-shaped strings", () => {
    const notMatches: readonly string[] = [
      "2026-04-20",
      "04/20/2026",
      "2026-04-20T15:32:45", // no Z
      "2026-04-20 15:32:45Z", // space not T
      "2026/04/20T15:32:45Z", // slash not dash
    ];
    for (const s of notMatches) {
      ISO_TIMESTAMP_REGEX.lastIndex = 0;
      expect(ISO_TIMESTAMP_REGEX.test(s)).toBe(false);
    }
  });
});

// ── Regression-lock: bootstrap snapshot prompt form ──────

describe("regression-lock: bootstrap snapshot prompt form is cache-safe after strip", () => {
  it("strips the sub-day timestamp from a formatted snapshot fragment", () => {
    // Exercise the exact string shape `formatSnapshotForPrompt`
    // produces for its `Captured:` header. If that formatter ever
    // starts emitting a second-precision timestamp into the prompt,
    // this test pins the assertion that the stripper catches it.
    const fragment = [
      "## Environment Bootstrap Snapshot",
      `Captured: 2026-04-20T15:32:45.812Z`,
      "Workspace: /tmp/wotann",
    ].join("\n");

    const safe = stripIsoTimestampsFromPrompt(fragment);
    expect(findIsoTimestampsInPrompt(safe)).toEqual([]);
    expect(safe).toContain("Captured: 2026-04-20\n");
    expect(safe).toContain("Workspace: /tmp/wotann");
  });

  it("end-to-end: real formatSnapshotForPrompt output is cache-safe after strip", async () => {
    // Dynamic import to avoid cross-module entanglement in the test file.
    // The bootstrap-snapshot module emits a full ISO timestamp for
    // `capturedAt`. After the runtime's strip step, the prompt
    // emission must contain ONLY the date-only prefix — no T/Z/ms
    // drift surface remains.
    const { formatSnapshotForPrompt } = await import(
      "../../src/core/bootstrap-snapshot.js"
    );

    // Build a synthetic snapshot directly — skips the git/lsof shell
    // exec (this test is a pure formatter assertion, not an I/O
    // integration test). `capturedAt` carries sub-second precision
    // to mirror real capture behaviour.
    const snapshot = {
      workspaceRoot: "/tmp/wotann-test",
      capturedAt: new Date(Date.UTC(2026, 3, 20, 15, 32, 45, 812)),
      tree: { captured: false, reason: "synthetic — no tree" },
      git: { captured: false, reason: "synthetic — no git" },
      env: { captured: false, reason: "synthetic — no env" },
      services: { captured: false, reason: "synthetic — no services" },
      logs: { captured: false, reason: "synthetic — no logs" },
      lockfiles: { captured: false, reason: "synthetic — no lockfiles" },
    } as const;

    const rawPrompt = formatSnapshotForPrompt(
      snapshot as unknown as Parameters<typeof formatSnapshotForPrompt>[0],
    );
    // BEFORE strip: contains the full ISO. This is the drift surface.
    expect(rawPrompt).toContain("2026-04-20T15:32:45.812Z");
    expect(findIsoTimestampsInPrompt(rawPrompt).length).toBeGreaterThan(0);

    // AFTER strip: only date-only survives. This is what lands in
    // the system prompt.
    const safePrompt = stripIsoTimestampsFromPrompt(rawPrompt);
    expect(safePrompt).not.toContain("T15:32:45");
    expect(safePrompt).not.toContain(".812Z");
    expect(safePrompt).toContain("Captured: 2026-04-20");
    expect(findIsoTimestampsInPrompt(safePrompt)).toEqual([]);
  });

  it("same-day turns produce byte-identical stripped fragments", () => {
    // Same UTC day, different sub-second moments — simulates two
    // adjacent turns within one session. After stripping, the
    // fragments must be byte-identical so the provider-side prefix
    // cache hits.
    const turn1 = "Captured: 2026-04-20T10:00:00.000Z";
    const turn2 = "Captured: 2026-04-20T15:32:45.812Z";
    const turn3 = "Captured: 2026-04-20T23:59:59.999Z";

    const safe1 = stripIsoTimestampsFromPrompt(turn1);
    const safe2 = stripIsoTimestampsFromPrompt(turn2);
    const safe3 = stripIsoTimestampsFromPrompt(turn3);

    expect(safe2).toBe(safe1);
    expect(safe3).toBe(safe1);
    // All collapse to the date-only form.
    expect(safe1).toBe("Captured: 2026-04-20");
  });

  it("next-day turn produces a DIFFERENT stripped fragment (expected invalidation)", () => {
    const today = "Captured: 2026-04-20T23:59:59.999Z";
    const tomorrow = "Captured: 2026-04-21T00:00:00.000Z";

    const safeToday = stripIsoTimestampsFromPrompt(today);
    const safeTomorrow = stripIsoTimestampsFromPrompt(tomorrow);
    // Different days — cache key rotates, by design.
    expect(safeTomorrow).not.toBe(safeToday);
  });
});
