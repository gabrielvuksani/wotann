/**
 * V9 T11.1 — Virtual Cursor Pool tests.
 *
 * Covers all three modules:
 *   - cursor-sprite:       math (lerp/bezierPoint/wiggle) + buildSprite contrast
 *   - session-scoped-perception: createPerception / cropToRegion / extractDominantColors
 *   - virtual-cursor-pool: spawn / despawn / enqueueMove / tick / snapshot
 *
 * QB #12: no wall-clock assertions — tests use an injected `now()` so
 * frame timestamps are reproducible on a clean CI runner.
 */
import { describe, it, expect } from "vitest";
import {
  bezierPoint,
  buildSprite,
  lerp,
  spriteToRgb,
  wiggle,
  type CursorFrame,
} from "../../src/computer-use/cursor-sprite.js";
import {
  createPerception,
  cropToRegion,
  dominantBackgroundColor,
  extractDominantColors,
  type FakeScreenshot,
  type ScreenRegion,
} from "../../src/computer-use/session-scoped-perception.js";
import { createVirtualCursorPool } from "../../src/computer-use/virtual-cursor-pool.js";

// ── Helpers ────────────────────────────────────────────────

function solidShot(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): FakeScreenshot {
  const pixels = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    pixels[p * 4] = rgb[0];
    pixels[p * 4 + 1] = rgb[1];
    pixels[p * 4 + 2] = rgb[2];
    pixels[p * 4 + 3] = 255;
  }
  return { width, height, pixels };
}

function gradientShot(width: number, height: number): FakeScreenshot {
  // Simple horizontal red gradient: left column = (0,0,0), right column
  // = (255, 0, 0). Deterministic; easy to eyeball the crop.
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      pixels[p] = Math.round((x / Math.max(1, width - 1)) * 255);
      pixels[p + 1] = 0;
      pixels[p + 2] = 0;
      pixels[p + 3] = 255;
    }
  }
  return { width, height, pixels };
}

function rgbFromShotAt(
  shot: FakeScreenshot,
  x: number,
  y: number,
): [number, number, number] {
  const off = (y * shot.width + x) * 4;
  return [shot.pixels[off] ?? 0, shot.pixels[off + 1] ?? 0, shot.pixels[off + 2] ?? 0];
}

// ── cursor-sprite ──────────────────────────────────────────

describe("cursor-sprite: lerp", () => {
  it("t=0 returns a", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("t=1 returns b", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("t=0.5 returns midpoint", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("t outside [0,1] extrapolates (unclamped)", () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
  });
});

describe("cursor-sprite: bezierPoint", () => {
  it("t=0 returns P0", () => {
    expect(bezierPoint([5, 7], [10, 10], [15, 17], 0)).toEqual([5, 7]);
  });

  it("t=1 returns P2", () => {
    expect(bezierPoint([5, 7], [10, 10], [15, 17], 1)).toEqual([15, 17]);
  });

  it("t=0.5 on a straight-line control produces the midpoint", () => {
    // P0=(0,0), P1=(5,5) (midpoint), P2=(10,10) — a straight-line
    // parameterization. At t=0.5 the curve equals the midpoint.
    const [x, y] = bezierPoint([0, 0], [5, 5], [10, 10], 0.5);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(5);
  });

  it("clamps t to [0,1] — t=2 equals t=1", () => {
    expect(bezierPoint([5, 7], [10, 10], [15, 17], 2)).toEqual([15, 17]);
  });
});

describe("cursor-sprite: wiggle", () => {
  it("is deterministic for a fixed seed", () => {
    const [ax, ay] = wiggle([100, 100], 2, 42);
    const [bx, by] = wiggle([100, 100], 2, 42);
    expect(ax).toBe(bx);
    expect(ay).toBe(by);
  });

  it("stays within the ±amplitude box", () => {
    for (let seed = 0; seed < 50; seed++) {
      const [x, y] = wiggle([100, 100], 3, seed);
      expect(Math.abs(x - 100)).toBeLessThanOrEqual(3);
      expect(Math.abs(y - 100)).toBeLessThanOrEqual(3);
    }
  });

  it("different seeds produce (almost always) different offsets", () => {
    const [a, b] = [wiggle([0, 0], 5, 1), wiggle([0, 0], 5, 2)];
    // Either x or y differs — both being identical across two seeds
    // would indicate a broken PRNG.
    expect(a[0] !== b[0] || a[1] !== b[1]).toBe(true);
  });
});

describe("cursor-sprite: buildSprite", () => {
  it("picks a hue 180° away from the background", () => {
    // Pure red background (hue 0°) — expect cursor hue 180°.
    const sprite = buildSprite("s1", [255, 0, 0]);
    expect(sprite.hue).toBeCloseTo(180, 0);
  });

  it("preserves the session id", () => {
    const sprite = buildSprite("sess-xyz", [0, 0, 0]);
    expect(sprite.sessionId).toBe("sess-xyz");
  });

  it("default size is 24 pixels", () => {
    const sprite = buildSprite("s", [128, 128, 128]);
    expect(sprite.sizePx).toBe(24);
  });

  it("spriteToRgb of a red background gives a cyan-ish cursor", () => {
    // Cyan is the complement of red (R=0, G>200, B>200 ish).
    const sprite = buildSprite("s", [255, 0, 0]);
    const [r, g, b] = spriteToRgb(sprite);
    expect(r).toBeLessThan(50);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeGreaterThan(150);
  });
});

// ── session-scoped-perception ──────────────────────────────

describe("session-scoped-perception: createPerception", () => {
  it("defaults strictIsolation=true", () => {
    const p = createPerception("s1", { x: 0, y: 0, width: 100, height: 100 });
    expect(p.strictIsolation).toBe(true);
    expect(p.sessionId).toBe("s1");
    expect(p.region.width).toBe(100);
  });

  it("can be explicitly non-strict", () => {
    const p = createPerception("s2", { x: 0, y: 0, width: 10, height: 10 }, false);
    expect(p.strictIsolation).toBe(false);
  });

  it("rejects empty session id", () => {
    expect(() => createPerception("", { x: 0, y: 0, width: 10, height: 10 })).toThrow(
      /sessionId required/,
    );
  });

  it("rejects non-positive dimensions", () => {
    expect(() => createPerception("s", { x: 0, y: 0, width: 0, height: 10 })).toThrow(
      /positive dimensions/,
    );
    expect(() => createPerception("s", { x: 0, y: 0, width: 10, height: -5 })).toThrow(
      /positive dimensions/,
    );
  });

  it("returns a fresh region (not an alias of the input)", () => {
    const region: ScreenRegion = { x: 1, y: 2, width: 3, height: 4 };
    const p = createPerception("s", region);
    // Mutate-like attempts can't actually mutate readonly, but we
    // verify the returned object is structurally independent by
    // checking that it's not the same reference.
    expect(p.region).not.toBe(region);
    expect(p.region).toEqual(region);
  });
});

describe("session-scoped-perception: cropToRegion", () => {
  it("crops a gradient to the requested pixels", () => {
    const shot = gradientShot(10, 10);
    const crop = cropToRegion(shot, { x: 2, y: 3, width: 4, height: 2 });
    expect(crop.width).toBe(4);
    expect(crop.height).toBe(2);
    // Top-left of crop was original (2, 3) which has red ~ round(2/9 * 255) = 57
    const [r, g, b] = rgbFromShotAt(crop, 0, 0);
    const [rOrig] = rgbFromShotAt(shot, 2, 3);
    expect(r).toBe(rOrig);
    expect(g).toBe(0);
    expect(b).toBe(0);
  });

  it("clamps regions that extend past the bottom-right edge", () => {
    const shot = gradientShot(10, 10);
    const crop = cropToRegion(shot, { x: 8, y: 8, width: 100, height: 100 });
    expect(crop.width).toBe(2);
    expect(crop.height).toBe(2);
  });

  it("fully out-of-bounds region produces a zero-sized screenshot", () => {
    const shot = gradientShot(10, 10);
    const crop = cropToRegion(shot, { x: 50, y: 50, width: 10, height: 10 });
    expect(crop.width).toBe(0);
    expect(crop.height).toBe(0);
    expect(crop.pixels.length).toBe(0);
  });

  it("returns a NEW pixel buffer (not an alias)", () => {
    const shot = gradientShot(4, 4);
    const crop = cropToRegion(shot, { x: 0, y: 0, width: 4, height: 4 });
    expect(crop.pixels).not.toBe(shot.pixels);
    // Mutating the crop must not affect the original.
    crop.pixels[0] = 123;
    expect(shot.pixels[0]).not.toBe(123);
  });
});

describe("session-scoped-perception: extractDominantColors", () => {
  it("stabilizes on a solid-color background (all centroids same color)", () => {
    const shot = solidShot(16, 16, [64, 128, 192]);
    const centroids = extractDominantColors(shot, 4, 8);
    expect(centroids.length).toBe(4);
    for (const c of centroids) {
      expect(c[0]).toBe(64);
      expect(c[1]).toBe(128);
      expect(c[2]).toBe(192);
    }
  });

  it("returns k centroids when enough pixels exist", () => {
    const shot = gradientShot(20, 20);
    const centroids = extractDominantColors(shot, 4, 8);
    expect(centroids.length).toBe(4);
  });

  it("returns empty array for empty screenshot", () => {
    const empty: FakeScreenshot = { width: 0, height: 0, pixels: new Uint8Array(0) };
    expect(extractDominantColors(empty).length).toBe(0);
  });

  it("dominantBackgroundColor matches the sole color of a solid shot", () => {
    const shot = solidShot(8, 8, [200, 50, 50]);
    const [r, g, b] = dominantBackgroundColor(shot, { x: 0, y: 0, width: 8, height: 8 });
    expect(r).toBe(200);
    expect(g).toBe(50);
    expect(b).toBe(50);
  });
});

// ── virtual-cursor-pool ────────────────────────────────────

describe("virtual-cursor-pool: spawn / despawn", () => {
  it("spawn succeeds under the max", () => {
    const pool = createVirtualCursorPool();
    const r = pool.spawn({
      sessionId: "s1",
      region: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cursor.sessionId).toBe("s1");
    }
  });

  it("rejects a 9th session when default max is 8", () => {
    const pool = createVirtualCursorPool();
    for (let i = 0; i < 8; i++) {
      const r = pool.spawn({
        sessionId: `s${i}`,
        region: { x: 0, y: 0, width: 100, height: 100 },
      });
      expect(r.ok).toBe(true);
    }
    const ninth = pool.spawn({
      sessionId: "s9",
      region: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(ninth.ok).toBe(false);
    if (!ninth.ok) expect(ninth.error).toBe("max-sessions-exceeded");
  });

  it("rejects duplicate session id", () => {
    const pool = createVirtualCursorPool();
    pool.spawn({ sessionId: "s", region: { x: 0, y: 0, width: 100, height: 100 } });
    const dup = pool.spawn({
      sessionId: "s",
      region: { x: 0, y: 0, width: 100, height: 100 },
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("duplicate-session");
  });

  it("despawn returns true for existing, false for missing", () => {
    const pool = createVirtualCursorPool();
    pool.spawn({ sessionId: "s", region: { x: 0, y: 0, width: 100, height: 100 } });
    expect(pool.despawn("s")).toBe(true);
    expect(pool.despawn("s")).toBe(false);
    expect(pool.despawn("never-existed")).toBe(false);
  });

  it("honors a custom maxSessions option", () => {
    const pool = createVirtualCursorPool({ maxSessions: 2 });
    expect(
      pool.spawn({ sessionId: "a", region: { x: 0, y: 0, width: 10, height: 10 } }).ok,
    ).toBe(true);
    expect(
      pool.spawn({ sessionId: "b", region: { x: 0, y: 0, width: 10, height: 10 } }).ok,
    ).toBe(true);
    const third = pool.spawn({
      sessionId: "c",
      region: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(third.ok).toBe(false);
  });
});

describe("virtual-cursor-pool: enqueueMove + tick", () => {
  it("tick advances position toward the enqueued target", () => {
    let t = 1000;
    const pool = createVirtualCursorPool({ now: () => t });
    pool.spawn({
      sessionId: "s",
      region: { x: 0, y: 0, width: 400, height: 400 },
    });
    const [startX, startY] = pool.snapshot()[0]!.position;

    pool.enqueueMove("s", [390, 390]);
    const framesA = pool.tick();
    const framesB = pool.tick();
    const framesC = pool.tick();

    expect(framesA.length).toBe(1);
    expect(framesB.length).toBe(1);
    expect(framesC.length).toBe(1);

    // Position moves closer to the target over time.
    const d0 = Math.hypot(390 - startX, 390 - startY);
    const d1 = Math.hypot(390 - framesA[0]!.x, 390 - framesA[0]!.y);
    const d3 = Math.hypot(390 - framesC[0]!.x, 390 - framesC[0]!.y);
    expect(d1).toBeLessThan(d0);
    expect(d3).toBeLessThan(d1);
  });

  it("emits one frame per cursor per tick", () => {
    const pool = createVirtualCursorPool();
    pool.spawn({ sessionId: "a", region: { x: 0, y: 0, width: 100, height: 100 } });
    pool.spawn({
      sessionId: "b",
      region: { x: 100, y: 0, width: 100, height: 100 },
    });
    pool.spawn({
      sessionId: "c",
      region: { x: 200, y: 0, width: 100, height: 100 },
    });

    const frames = pool.tick();
    expect(frames.length).toBe(3);
    const ids = new Set(frames.map((f: CursorFrame) => f.sessionId));
    expect(ids.has("a")).toBe(true);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("c")).toBe(true);
  });

  it("enqueueMove on unknown session returns false", () => {
    const pool = createVirtualCursorPool();
    expect(pool.enqueueMove("ghost", [1, 1])).toBe(false);
  });

  it("enqueueMove clamps into the session's region", () => {
    const pool = createVirtualCursorPool();
    pool.spawn({ sessionId: "s", region: { x: 100, y: 100, width: 50, height: 50 } });
    // Target is way outside. After enough ticks the cursor should
    // converge to the region boundary, never outside it.
    pool.enqueueMove("s", [10_000, 10_000]);
    for (let i = 0; i < 30; i++) pool.tick();
    const cur = pool.snapshot()[0]!;
    expect(cur.position[0]).toBeLessThanOrEqual(150);
    expect(cur.position[1]).toBeLessThanOrEqual(150);
    expect(cur.position[0]).toBeGreaterThanOrEqual(100);
    expect(cur.position[1]).toBeGreaterThanOrEqual(100);
  });

  it("refuses non-finite targets", () => {
    const pool = createVirtualCursorPool();
    pool.spawn({ sessionId: "s", region: { x: 0, y: 0, width: 100, height: 100 } });
    expect(pool.enqueueMove("s", [Number.NaN, 10])).toBe(false);
    expect(pool.enqueueMove("s", [10, Number.POSITIVE_INFINITY])).toBe(false);
  });
});

describe("virtual-cursor-pool: snapshot", () => {
  it("returns a stable read-only copy (not an alias)", () => {
    const pool = createVirtualCursorPool();
    pool.spawn({ sessionId: "s", region: { x: 0, y: 0, width: 100, height: 100 } });
    const snap1 = pool.snapshot();
    const snap2 = pool.snapshot();
    expect(snap1).not.toBe(snap2);
    expect(snap1[0]!.position).not.toBe(snap2[0]!.position);
    expect(snap1[0]!.position).toEqual(snap2[0]!.position);
  });

  it("snapshot reflects spawned + despawned sessions", () => {
    const pool = createVirtualCursorPool();
    pool.spawn({ sessionId: "a", region: { x: 0, y: 0, width: 10, height: 10 } });
    pool.spawn({ sessionId: "b", region: { x: 10, y: 0, width: 10, height: 10 } });
    expect(pool.snapshot().length).toBe(2);
    pool.despawn("a");
    expect(pool.snapshot().length).toBe(1);
    expect(pool.snapshot()[0]!.sessionId).toBe("b");
  });
});

describe("virtual-cursor-pool: constructor validation", () => {
  it("rejects tickHz ≤ 0", () => {
    expect(() => createVirtualCursorPool({ tickHz: 0 })).toThrow(/tickHz/);
    expect(() => createVirtualCursorPool({ tickHz: -5 })).toThrow(/tickHz/);
  });

  it("rejects maxSessions ≤ 0", () => {
    expect(() => createVirtualCursorPool({ maxSessions: 0 })).toThrow(/maxSessions/);
  });

  it("uses injected clock for frame timestamps", () => {
    let t = 5_000;
    const pool = createVirtualCursorPool({ now: () => t });
    pool.spawn({ sessionId: "s", region: { x: 0, y: 0, width: 10, height: 10 } });
    const frames = pool.tick();
    expect(frames[0]!.timestamp).toBe(5_000);
    t = 6_000;
    const frames2 = pool.tick();
    expect(frames2[0]!.timestamp).toBe(6_000);
  });
});
