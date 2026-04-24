/**
 * V9 T11.1 — Session-Scoped Perception
 *
 * Per-session screenshot regions for the parallel virtual-cursor pool.
 * Each virtual cursor session carries a perception descriptor that
 * defines what slice of the desktop IT can see. The input-arbiter
 * pipeline pairs this with a (fake or real) screenshot and crops to
 * the session's region before passing anything to the session's agent.
 *
 * Motivation: multi-agent parallel computer-use is only trustworthy if
 * a session's model can't peek outside its allotted rectangle. When
 * `strictIsolation` is set, anything outside the session's region is
 * invisible — no way for a rogue session to read another tab's
 * contents just because they share one screen buffer.
 *
 * Non-goals here: no OS hooks, no pixel grabs. We operate on a
 * deterministic `FakeScreenshot` type (RGBA-interleaved `Uint8Array`)
 * so the whole module stays testable without a display server. A real
 * consumer wraps the output of `screencapture`/`maim` in the same
 * shape before calling into here — the crop arithmetic is identical.
 *
 * K-means wallpaper color extraction lives here (not in cursor-sprite)
 * because it operates on pixel buffers, not on sprite math. The sprite
 * module is the COLOR CONSUMER; this module is the color PRODUCER.
 */

// ── Types ──────────────────────────────────────────────────

/**
 * Rectangular region in screen coordinates. `x`/`y` are the top-left
 * origin; `width`/`height` extend toward the bottom-right.
 */
export interface ScreenRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A session's view of the desktop. Bound at spawn time and immutable
 * for the session's lifetime — a session CANNOT later opt into seeing
 * more of the screen (would undermine isolation guarantees).
 */
export interface SessionPerception {
  readonly sessionId: string;
  readonly region: ScreenRegion;
  /**
   * When true, the session only sees ITS region — not the whole
   * screen. When false, the session sees the whole screen but the
   * `region` is still used to bound where ITS cursor can land. Most
   * production deployments should keep this `true`.
   */
  readonly strictIsolation: boolean;
}

/**
 * Raw pixel buffer we treat as a "screenshot" in this module. RGBA
 * interleaved, row-major, `width * height * 4` bytes. Production
 * callers adapt their platform's native buffer to this layout before
 * calling `cropToRegion` or `extractDominantColors`.
 */
export interface FakeScreenshot {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

// ── Constructors ───────────────────────────────────────────

/**
 * Build a `SessionPerception` for a session id + region. Validates
 * that the region is well-formed — zero/negative dimensions are a
 * configuration bug and rejected early (QB #6 — honest failures over
 * silent degradation).
 */
export function createPerception(
  sessionId: string,
  region: ScreenRegion,
  strictIsolation: boolean = true,
): SessionPerception {
  if (!sessionId || sessionId.trim() === "") {
    throw new Error("createPerception: sessionId required");
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new Error(
      `createPerception: region must have positive dimensions (got ${region.width}×${region.height})`,
    );
  }
  if (!Number.isFinite(region.x) || !Number.isFinite(region.y)) {
    throw new Error("createPerception: region.x/y must be finite numbers");
  }
  // Return a fresh object so callers can't mutate the supplied region
  // out from under us.
  return {
    sessionId,
    region: {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    },
    strictIsolation,
  };
}

// ── Cropping ───────────────────────────────────────────────

/**
 * Clamp a region to the screenshot's bounds. If the region is fully
 * outside the screenshot we return a degenerate 0×0 region at the
 * nearest clamped origin (the caller's check will then produce an
 * empty pixel slice).
 */
function clampRegion(region: ScreenRegion, shot: FakeScreenshot): ScreenRegion {
  const x0 = Math.max(0, Math.min(shot.width, Math.floor(region.x)));
  const y0 = Math.max(0, Math.min(shot.height, Math.floor(region.y)));
  const x1 = Math.max(x0, Math.min(shot.width, Math.floor(region.x + region.width)));
  const y1 = Math.max(y0, Math.min(shot.height, Math.floor(region.y + region.height)));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Crop a screenshot to the session's region. Returns a NEW screenshot
 * (fresh `Uint8Array`) — we never hand out slices into someone else's
 * buffer because a downstream mutation would retroactively corrupt the
 * caller's data (Gabriel's immutability rule).
 *
 * The region is clamped to the screenshot's bounds, so a region that
 * starts off-screen or extends past the right/bottom edge simply gets
 * the visible portion. An out-of-bounds region returns a zero-pixel
 * screenshot rather than throwing — let the caller decide whether
 * empty means "retry" or "fatal".
 */
export function cropToRegion(shot: FakeScreenshot, region: ScreenRegion): FakeScreenshot {
  const clamped = clampRegion(region, shot);
  const out = new Uint8Array(clamped.width * clamped.height * 4);
  for (let row = 0; row < clamped.height; row++) {
    const srcStart = ((clamped.y + row) * shot.width + clamped.x) * 4;
    const dstStart = row * clamped.width * 4;
    // Manual per-row copy. Uint8Array.set accepts a sub-array without
    // allocating so this is O(width × height) bytes touched, no extra
    // garbage beyond the destination buffer.
    out.set(shot.pixels.subarray(srcStart, srcStart + clamped.width * 4), dstStart);
  }
  return {
    width: clamped.width,
    height: clamped.height,
    pixels: out,
  };
}

// ── K-means color extraction ───────────────────────────────

/**
 * Euclidean distance in RGB. Square-root elided because we only ever
 * compare distances, and sqrt is monotonic — comparing squared
 * distances yields the same ordering.
 */
function rgbDistSq(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * Deterministic pixel sampler — picks `k` initial centroids by
 * stepping through the pixel buffer at equal spacing. Using positions
 * rather than a random selection keeps `extractDominantColors`
 * reproducible; the spec needs sprite contrast to be stable across
 * re-renders.
 */
function seedCentroids(shot: FakeScreenshot, k: number): [number, number, number][] {
  const n = shot.width * shot.height;
  if (n === 0) return [];
  const seeds: [number, number, number][] = [];
  for (let i = 0; i < k; i++) {
    // Offset by +0.5 * step to avoid the top-left corner repeatedly
    // seeding centroid 0 (common source of trivial duplicate seeds).
    const idx = Math.floor(((i + 0.5) / k) * n) * 4;
    seeds.push([shot.pixels[idx] ?? 0, shot.pixels[idx + 1] ?? 0, shot.pixels[idx + 2] ?? 0]);
  }
  return seeds;
}

/**
 * K-means color extraction. Returns cluster centroids as RGB triples.
 * `k` defaults to 4 to match the spec. `maxIterations` defaults to 8
 * — Lloyd's algorithm converges quickly for low-dimensional data and
 * we prefer a predictable budget over a converge-or-bust loop.
 *
 * The alpha channel is ignored — wallpapers are solid RGB in every
 * realistic case, and including alpha would let transparent pixels
 * poison the centroids.
 *
 * For sparse screenshots (< k pixels) we simply return one centroid
 * per available pixel. No graceful fallback is needed — a 2-pixel
 * wallpaper is a test fixture; the production path always has ≥ 10^6
 * pixels to cluster.
 */
export function extractDominantColors(
  shot: FakeScreenshot,
  k: number = 4,
  maxIterations: number = 8,
): readonly (readonly [number, number, number])[] {
  const n = shot.width * shot.height;
  if (n === 0) return [];

  const effectiveK = Math.max(1, Math.min(k, n));
  const centroids = seedCentroids(shot, effectiveK);

  // Sums for incremental averaging (avoid re-scanning pixels for each
  // centroid during the update step).
  const sumR = new Float64Array(effectiveK);
  const sumG = new Float64Array(effectiveK);
  const sumB = new Float64Array(effectiveK);
  const counts = new Uint32Array(effectiveK);

  for (let iter = 0; iter < maxIterations; iter++) {
    sumR.fill(0);
    sumG.fill(0);
    sumB.fill(0);
    counts.fill(0);

    for (let p = 0; p < n; p++) {
      const off = p * 4;
      const pixel: [number, number, number] = [
        shot.pixels[off] ?? 0,
        shot.pixels[off + 1] ?? 0,
        shot.pixels[off + 2] ?? 0,
      ];
      // Find nearest centroid. Early-exit on zero distance (common
      // for uniform-color backgrounds) since nothing can beat it.
      let best = 0;
      let bestD = rgbDistSq(pixel, centroids[0] ?? [0, 0, 0]);
      for (let c = 1; c < effectiveK; c++) {
        const d = rgbDistSq(pixel, centroids[c] ?? [0, 0, 0]);
        if (d < bestD) {
          bestD = d;
          best = c;
          if (d === 0) break;
        }
      }
      sumR[best] = (sumR[best] ?? 0) + pixel[0];
      sumG[best] = (sumG[best] ?? 0) + pixel[1];
      sumB[best] = (sumB[best] ?? 0) + pixel[2];
      counts[best] = (counts[best] ?? 0) + 1;
    }

    // Update centroids. An empty cluster keeps its previous value —
    // moving it to a random pixel each iteration would destabilize
    // the stopping criterion.
    let moved = false;
    for (let c = 0; c < effectiveK; c++) {
      const count = counts[c] ?? 0;
      if (count === 0) continue;
      const nr = Math.round((sumR[c] ?? 0) / count);
      const ng = Math.round((sumG[c] ?? 0) / count);
      const nb = Math.round((sumB[c] ?? 0) / count);
      const prev = centroids[c] ?? [0, 0, 0];
      if (prev[0] !== nr || prev[1] !== ng || prev[2] !== nb) {
        centroids[c] = [nr, ng, nb];
        moved = true;
      }
    }
    if (!moved) break;
  }

  return centroids.map((c) => [c[0], c[1], c[2]] as const);
}

// ── Convenience ────────────────────────────────────────────

/**
 * Sample a single dominant color for a session's region — used by the
 * pool at spawn time to pick the sprite's contrast color. Thin wrapper
 * over `cropToRegion` + `extractDominantColors` that returns the
 * centroid with the largest membership (the TRUE wallpaper color,
 * not an outlier from a toolbar glyph).
 *
 * Returns `[0, 0, 0]` when the region is empty — matches what the
 * sprite builder expects as a "no signal" default (yields a white
 * cursor, which is the safest guess on an unknown background).
 */
export function dominantBackgroundColor(
  shot: FakeScreenshot,
  region: ScreenRegion,
): [number, number, number] {
  const crop = cropToRegion(shot, region);
  if (crop.width === 0 || crop.height === 0) return [0, 0, 0];
  const centroids = extractDominantColors(crop, 4, 8);
  if (centroids.length === 0) return [0, 0, 0];
  // Largest-cluster selection: re-tally which centroid each pixel
  // belongs to. Cheaper than plumbing counts out of the k-means loop
  // and keeps that function's return shape simple.
  const counts = new Uint32Array(centroids.length);
  for (let p = 0; p < crop.width * crop.height; p++) {
    const off = p * 4;
    const pixel: [number, number, number] = [
      crop.pixels[off] ?? 0,
      crop.pixels[off + 1] ?? 0,
      crop.pixels[off + 2] ?? 0,
    ];
    let best = 0;
    let bestD = rgbDistSq(pixel, centroids[0] ?? [0, 0, 0]);
    for (let c = 1; c < centroids.length; c++) {
      const d = rgbDistSq(pixel, centroids[c] ?? [0, 0, 0]);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    counts[best] = (counts[best] ?? 0) + 1;
  }
  let bestIdx = 0;
  let bestCount = counts[0] ?? 0;
  for (let c = 1; c < counts.length; c++) {
    if ((counts[c] ?? 0) > bestCount) {
      bestCount = counts[c] ?? 0;
      bestIdx = c;
    }
  }
  const dom = centroids[bestIdx] ?? [0, 0, 0];
  return [dom[0], dom[1], dom[2]];
}
