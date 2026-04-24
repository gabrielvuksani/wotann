/**
 * V9 Tier 9 — scaffold-registry tests.
 *
 * Coverage:
 *   - Exactly 4 scaffolds exist and their ids match the V9 manifest.
 *   - Each of the 4 V9 routing scenarios picks the expected scaffold.
 *   - Empty spec is refused honestly (QB #6).
 *   - Unknown forced pick is refused honestly (QB #6).
 *   - Unknown spec falls through to the documented default and marks
 *     `matched: false` (not a silent fallback).
 *   - planEmission() exposes stable next-steps per scaffold.
 */

import { describe, expect, it } from "vitest";
import {
  SCAFFOLDS,
  DEFAULT_SCAFFOLD_ID,
  selectScaffold,
  planEmission,
  getScaffold,
  listScaffoldIds,
  type ScaffoldId,
} from "../../src/build/scaffold-registry.js";

describe("scaffold-registry: structure", () => {
  it("exposes exactly 4 canonical scaffolds", () => {
    expect(SCAFFOLDS).toHaveLength(4);
    const ids = SCAFFOLDS.map((s) => s.id).sort();
    expect(ids).toEqual(
      ["astro-static", "expo", "hono-react-edge", "nextjs-app-router"].sort(),
    );
  });

  it("listScaffoldIds returns the canonical list", () => {
    expect(listScaffoldIds()).toHaveLength(4);
  });

  it("getScaffold finds by id and returns null for unknown", () => {
    const s = getScaffold("nextjs-app-router");
    expect(s).not.toBeNull();
    expect(s?.label).toBe("Next.js App Router");
    expect(getScaffold("not-a-scaffold" as ScaffoldId)).toBeNull();
  });

  it("every scaffold exposes a non-empty signals + files list", () => {
    for (const s of SCAFFOLDS) {
      expect(s.signals.length).toBeGreaterThan(0);
      expect(s.files.length).toBeGreaterThan(0);
      expect(s.files).toContain("package.json");
    }
  });
});

describe("scaffold-registry: V9 routing matrix", () => {
  it("picks nextjs-app-router when spec mentions server components + streaming", () => {
    const r = selectScaffold("build a dashboard with server components + streaming");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaffold.id).toBe("nextjs-app-router");
    expect(r.matched).toBe(true);
  });

  it("picks hono-react-edge when spec mentions edge + minimal", () => {
    const r = selectScaffold("edge runtime, minimal api, cloudflare workers");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaffold.id).toBe("hono-react-edge");
    expect(r.matched).toBe(true);
  });

  it("picks astro-static when spec mentions static content site", () => {
    const r = selectScaffold("static content site for marketing with mdx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaffold.id).toBe("astro-static");
    expect(r.matched).toBe(true);
  });

  it("picks expo when spec mentions iOS + Android", () => {
    const r = selectScaffold("native iOS and android mobile app, cross-platform");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaffold.id).toBe("expo");
    expect(r.matched).toBe(true);
  });

  it("picks nextjs-app-router for Todo+auth+team+billing (V9 exit criteria)", () => {
    const r = selectScaffold("Todo app with auth, team collab, Stripe billing");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaffold.id).toBe("nextjs-app-router");
  });
});

describe("scaffold-registry: honest refusals (QB #6)", () => {
  it("refuses empty spec", () => {
    const r = selectScaffold("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("empty spec");
  });

  it("refuses whitespace-only spec", () => {
    const r = selectScaffold("   \n\t  ");
    expect(r.ok).toBe(false);
  });

  it("refuses unknown forced pick", () => {
    const r = selectScaffold("anything", { pick: "not-real" as ScaffoldId });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("unknown scaffold id");
  });

  it("falls through to the documented default with matched=false", () => {
    const r = selectScaffold("something totally unrelated zzzyyy qqqxxx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaffold.id).toBe(DEFAULT_SCAFFOLD_ID);
    expect(r.matched).toBe(false);
  });
});

describe("scaffold-registry: forced override still scores", () => {
  it("returns the forced scaffold but preserves the score trace", () => {
    const r = selectScaffold("ios android expo native", { pick: "astro-static" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.scaffold.id).toBe("astro-static");
    expect(r.matched).toBe(true);
    // The expo scaffold would have scored highest without --pick; the
    // trace preserves that so downstream UIs can say "you picked X but
    // Y matched better".
    const expoScore = r.scores.find((s) => s.id === "expo");
    expect(expoScore).toBeDefined();
    if (!expoScore) return;
    expect(expoScore.matchedSignals.length).toBeGreaterThan(0);
  });
});

describe("scaffold-registry: planEmission", () => {
  it("returns null for a failed selection", () => {
    const r = selectScaffold("");
    const plan = planEmission(r);
    expect(plan).toBeNull();
  });

  it("returns files + next steps per scaffold", () => {
    const r = selectScaffold("build a next.js full-stack app");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plan = planEmission(r);
    expect(plan).not.toBeNull();
    expect(plan?.scaffoldId).toBe("nextjs-app-router");
    expect(plan?.files.length).toBeGreaterThan(0);
    expect(plan?.nextSteps.length).toBeGreaterThan(0);
    expect(plan?.nextSteps[0]).toContain("cd <project>");
  });

  it("per-scaffold next steps are distinct", () => {
    const nextSeen = new Set<string>();
    for (const id of listScaffoldIds()) {
      const r = selectScaffold("force", { pick: id });
      const plan = planEmission(r);
      if (!plan) continue;
      // First line of next steps mentions cd; second differs per scaffold.
      const second = plan.nextSteps[1] ?? "";
      expect(nextSeen.has(second)).toBe(false);
      nextSeen.add(second);
    }
    expect(nextSeen.size).toBe(4);
  });
});
