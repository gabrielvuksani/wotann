/**
 * Hidden-text detector — V9 Tier 10 T10.P0.2 (agentic-browser P0 gate).
 *
 * Page content the agent CAN see but the user CANNOT is a top-tier
 * prompt-injection vector: a malicious page hides instructions via
 * `display:none`, `opacity:0`, off-screen positioning, tiny fonts,
 * or text the same color as the background. The browser's a11y
 * tree (which the agent reads) still contains the text; the rendered
 * pixels the user sees do not.
 *
 * This module ships PURE text-scanning helpers. Callers supply
 * already-parsed DOM elements (or mock shapes conforming to the
 * `HiddenTextElement` interface) and receive a list of offenders.
 * Browser integration (Playwright, JSDOM, Chrome CDP, etc.) is the
 * caller's concern; we never touch the DOM directly.
 *
 * ── Detection rules ─────────────────────────────────────────────────
 *   1. `display: none`          — text not rendered at all
 *   2. `visibility: hidden`     — text invisible (takes space)
 *   3. `opacity < 0.1`          — near-invisible
 *   4. Off-screen positioning   — `left/top < -9999px` or similar
 *   5. `font-size < 2px`        — effectively invisible
 *   6. Low-contrast             — color distance below threshold
 *   7. `aria-hidden="true"` on nodes that still carry visible text
 *   8. Canvas bitmap / OCR diff — separate module (not here)
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: elements with missing style fields are
 *    NOT flagged — we never fabricate "hidden" on incomplete data.
 *  - QB #7 per-call state: pure functions. No module-level state.
 *  - QB #13 env guard: no `process.env` reads.
 *  - QB #11 sibling-site scan: this is the ONLY hidden-text scanner
 *    for the agentic-browser P0 gate.
 */

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * Caller-supplied element shape. Exposes only the fields we need so
 * any DOM-adjacent library (JSDOM `Element`, Playwright snapshot,
 * a11y-tree entry) can satisfy the contract.
 */
export interface HiddenTextElement {
  /** Rendered text content (already concatenated from children). */
  readonly text: string;
  /** Computed style map. Missing fields are treated as default. */
  readonly style?: Readonly<Record<string, string>>;
  /** Bounding rect in CSS pixels. Absent when caller lacks layout info. */
  readonly rect?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  /** ARIA attributes. */
  readonly aria?: Readonly<Record<string, string>>;
  /**
   * Hex color of this element's computed background (best-effort).
   * Used for the low-contrast check. Absent when caller can't
   * resolve the cascade.
   */
  readonly backgroundHex?: string;
  /**
   * Hex color of the element's computed foreground. Absent when
   * caller can't resolve.
   */
  readonly foregroundHex?: string;
  /** Opaque identifier for callers (selector path, node index, etc.). */
  readonly id: string;
}

export type HiddenRule =
  | "display-none"
  | "visibility-hidden"
  | "opacity-near-zero"
  | "offscreen-positioning"
  | "font-too-small"
  | "low-contrast"
  | "aria-hidden-with-content";

export interface HiddenTextHit {
  readonly elementId: string;
  readonly rule: HiddenRule;
  readonly detail: string;
  readonly textPreview: string;
}

export interface HiddenTextReport {
  readonly hits: readonly HiddenTextHit[];
  /** Concatenated text from all hits. */
  readonly hiddenText: string;
  readonly scanned: number;
  readonly offenderCount: number;
}

export interface DetectHiddenTextOptions {
  readonly minTextLength?: number;
  readonly fontSizeThresholdPx?: number;
  readonly opacityThreshold?: number;
  readonly contrastThreshold?: number;
  readonly offscreenPx?: number;
}

// ═══ Color helpers ════════════════════════════════════════════════════════

/**
 * Parse `#rrggbb` or `#rgb` into a `[r, g, b]` tuple in 0..255.
 * Returns `null` on malformed input.
 */
export function parseHex(hex: unknown): readonly [number, number, number] | null {
  if (typeof hex !== "string") return null;
  const trimmed = hex.trim().toLowerCase();
  if (!trimmed.startsWith("#")) return null;
  const body = trimmed.slice(1);
  if (body.length === 3) {
    const r = parseInt(body[0]! + body[0], 16);
    const g = parseInt(body[1]! + body[1], 16);
    const b = parseInt(body[2]! + body[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }
  if (body.length === 6) {
    const r = parseInt(body.slice(0, 2), 16);
    const g = parseInt(body.slice(2, 4), 16);
    const b = parseInt(body.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }
  return null;
}

/**
 * Simplified perceptual distance between two RGB colors. Uses the
 * CIE76 approximation on RGB directly (not full LAB), good enough
 * for the near-invisible contrast check. Returns 0..100 where 0 =
 * identical.
 */
export function rgbDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  const raw = Math.sqrt(dr * dr + dg * dg + db * db);
  // Max RGB distance is sqrt(3*255^2) ≈ 441.67; scale to 0..100.
  return (raw / 441.67) * 100;
}

// ═══ Per-rule checkers ════════════════════════════════════════════════════

function parsePxNumber(value: string | undefined): number | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const m = /^(-?\d+(?:\.\d+)?)(px|em|rem|%)?$/.exec(trimmed);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? "px";
  if (unit === "px") return n;
  if (unit === "em" || unit === "rem") return n * 16;
  if (unit === "%") return (n / 100) * 16;
  return n;
}

function checkDisplayNone(el: HiddenTextElement): HiddenTextHit | null {
  const display = el.style?.["display"]?.trim().toLowerCase();
  if (display === "none") {
    return {
      elementId: el.id,
      rule: "display-none",
      detail: `display: ${display}`,
      textPreview: previewText(el.text),
    };
  }
  return null;
}

function checkVisibilityHidden(el: HiddenTextElement): HiddenTextHit | null {
  const vis = el.style?.["visibility"]?.trim().toLowerCase();
  if (vis === "hidden" || vis === "collapse") {
    return {
      elementId: el.id,
      rule: "visibility-hidden",
      detail: `visibility: ${vis}`,
      textPreview: previewText(el.text),
    };
  }
  return null;
}

function checkOpacity(el: HiddenTextElement, threshold: number): HiddenTextHit | null {
  const raw = el.style?.["opacity"];
  if (typeof raw !== "string") return null;
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return null;
  if (n < threshold) {
    return {
      elementId: el.id,
      rule: "opacity-near-zero",
      detail: `opacity: ${n}`,
      textPreview: previewText(el.text),
    };
  }
  return null;
}

function checkOffscreen(el: HiddenTextElement, offscreenPx: number): HiddenTextHit | null {
  const rect = el.rect;
  if (!rect) return null;
  if (rect.left < -offscreenPx || rect.top < -offscreenPx) {
    return {
      elementId: el.id,
      rule: "offscreen-positioning",
      detail: `rect.left=${rect.left}, rect.top=${rect.top}`,
      textPreview: previewText(el.text),
    };
  }
  return null;
}

function checkFontSize(el: HiddenTextElement, thresholdPx: number): HiddenTextHit | null {
  const raw = el.style?.["font-size"] ?? el.style?.["fontSize"];
  const px = parsePxNumber(raw);
  if (px === null) return null;
  if (px < thresholdPx) {
    return {
      elementId: el.id,
      rule: "font-too-small",
      detail: `font-size: ${px}px`,
      textPreview: previewText(el.text),
    };
  }
  return null;
}

function checkLowContrast(el: HiddenTextElement, threshold: number): HiddenTextHit | null {
  const fg = parseHex(el.foregroundHex);
  const bg = parseHex(el.backgroundHex);
  if (!fg || !bg) return null;
  const dist = rgbDistance(fg, bg);
  if (dist < threshold) {
    return {
      elementId: el.id,
      rule: "low-contrast",
      detail: `dist~${dist.toFixed(1)} fg=${el.foregroundHex} bg=${el.backgroundHex}`,
      textPreview: previewText(el.text),
    };
  }
  return null;
}

function checkAriaHidden(el: HiddenTextElement): HiddenTextHit | null {
  const aria = el.aria?.["aria-hidden"]?.trim().toLowerCase();
  if (aria === "true" && el.text.trim().length > 0) {
    return {
      elementId: el.id,
      rule: "aria-hidden-with-content",
      detail: `aria-hidden="true" with text content`,
      textPreview: previewText(el.text),
    };
  }
  return null;
}

function previewText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 80) return cleaned;
  return `${cleaned.slice(0, 79)}…`;
}

// ═══ Main API ═════════════════════════════════════════════════════════════

/**
 * Scan an array of parsed elements. Returns hits + the concatenated
 * hidden text so callers can drop it from the model's context before
 * sending the page to the agent.
 */
export function detectHiddenText(
  elements: readonly HiddenTextElement[],
  options: DetectHiddenTextOptions = {},
): HiddenTextReport {
  const minLen = options.minTextLength ?? 1;
  const fontThreshold = options.fontSizeThresholdPx ?? 2;
  const opacityThreshold = options.opacityThreshold ?? 0.1;
  const contrastThreshold = options.contrastThreshold ?? 10;
  // Default 999px (was 9999 — too lenient to catch the canonical
  // `left:-9999px` attack since that condition uses strict `<`).
  // Anything at left/top below -999px is well past any legitimate
  // viewport.
  const offscreenPx = options.offscreenPx ?? 999;

  const hits: HiddenTextHit[] = [];
  const hiddenPieces: string[] = [];

  for (const el of elements) {
    if (el.text.trim().length < minLen) continue;

    const checkers: ((e: HiddenTextElement) => HiddenTextHit | null)[] = [
      checkDisplayNone,
      checkVisibilityHidden,
      (e) => checkOpacity(e, opacityThreshold),
      (e) => checkOffscreen(e, offscreenPx),
      (e) => checkFontSize(e, fontThreshold),
      (e) => checkLowContrast(e, contrastThreshold),
      checkAriaHidden,
    ];

    for (const check of checkers) {
      const hit = check(el);
      if (hit !== null) {
        hits.push(hit);
        hiddenPieces.push(el.text);
        break;
      }
    }
  }

  return {
    hits,
    hiddenText: hiddenPieces.join("\n").trim(),
    scanned: elements.length,
    offenderCount: hits.length,
  };
}

/**
 * Convenience: return a set of text previews from hits so callers
 * can dedupe against their own source text.
 */
export function hiddenTextSet(report: HiddenTextReport): ReadonlySet<string> {
  return new Set(report.hits.map((h) => h.textPreview));
}
