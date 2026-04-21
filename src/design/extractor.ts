/**
 * Codebase → design-system extractor.
 *
 * Claude Design (Anthropic Labs, 2026-04-17) introduced a reverse workflow:
 * point it at a codebase and it recovers the implicit design system — token
 * palette, spacing scale, typography — without any prior manifest. This is
 * the WOTANN port. It pairs with `handoff-receiver.ts` (which consumes
 * Claude Design's forward output) and `design-tokens-parser.ts` (which
 * emits CSS custom properties from W3C tokens). Together the three files
 * give us full round-trip: extract → tokens → CSS.
 *
 * Honesty principles
 * ------------------
 * - We never fabricate tokens a codebase doesn't contain. Empty workspace →
 *   empty system, not a guess.
 * - Every extracted value carries an inventory trail pointing to the source
 *   files it came from. Callers can audit every claim.
 * - Malformed files are skipped with a warning; they never corrupt the
 *   extraction or silently disappear.
 * - Palette clustering uses plain RGB Euclidean distance (a defensible
 *   approximation of perceptual distance). We don't claim Lab-space
 *   accuracy without a colorimetric library, so we stay in RGB and
 *   document the trade-off.
 *
 * Scope
 * -----
 * - Input: any directory on disk (CSS, SCSS, TSX, JSX, JS, TS files).
 * - Output: `DesignSystem` = palettes + spacing + typography + inventory.
 * - Stateless: same input → same output, no hidden caches.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

// ── Public types ─────────────────────────────────────────────────────────

export interface ExtractedColor {
  /** Color value as written in the source (normalized lower-case for hex). */
  readonly value: string;
  /** RGB triple used for clustering. Alpha is ignored for grouping. */
  readonly rgb: readonly [number, number, number];
  /** Frequency = how many distinct source files mention this color. */
  readonly frequency: number;
}

export interface ExtractedPalette {
  /** Stable name like `palette-1`, `palette-2`. Deterministic given input. */
  readonly name: string;
  /** Representative color (the cluster centroid, rounded). */
  readonly centroid: string;
  /** Colors that belong to this cluster. */
  readonly colors: readonly ExtractedColor[];
}

export interface ExtractedSpacing {
  /** Raw string as it appears in source (`"16px"`, `"1.5rem"`). */
  readonly raw: string;
  readonly value: number;
  readonly unit: "px" | "rem" | "em";
  readonly frequency: number;
}

export interface ExtractedFontFamily {
  readonly value: string;
  readonly frequency: number;
}

export interface ExtractedFontSize {
  readonly raw: string;
  readonly value: number;
  readonly unit: "px" | "rem" | "em";
  readonly frequency: number;
}

export interface ExtractedFontWeight {
  readonly value: number;
  readonly frequency: number;
}

export interface ExtractedTypography {
  readonly fontFamilies: readonly ExtractedFontFamily[];
  readonly fontSizes: readonly ExtractedFontSize[];
  readonly fontWeights: readonly ExtractedFontWeight[];
}

/**
 * Inventory: maps a stable token id (e.g. `color:#0a84ff`, `spacing:16px`)
 * to the workspace-relative file paths where it appeared. Callers can use
 * this to answer "where is this color used?" without re-scanning the disk.
 */
export type TokenInventory = Record<string, readonly string[]>;

export interface DesignSystem {
  readonly palettes: readonly ExtractedPalette[];
  readonly spacing: readonly ExtractedSpacing[];
  readonly typography: ExtractedTypography;
  readonly inventory: TokenInventory;
  readonly filesScanned: number;
  readonly warnings: readonly string[];
}

export interface DesignExtractorOptions {
  /**
   * Glob-like suffix/segment patterns to include. If provided, only files
   * whose workspace-relative path matches at least one pattern are scanned.
   * Default: all files with `.css`, `.scss`, `.tsx`, `.jsx`, `.ts`, `.js`,
   * `.mjs`, `.cjs`, `.html` extensions.
   */
  readonly include?: readonly string[];
  /**
   * Glob-like patterns for paths to skip. Default excludes common noise:
   * `node_modules/**`, `dist/**`, `.git/**`, `build/**`, `coverage/**`.
   */
  readonly exclude?: readonly string[];
  /**
   * Max RGB Euclidean distance for two colors to cluster into the same
   * palette. Default: 12 (chosen empirically on typical UI palettes — tight
   * enough to keep `#0A84FF` and `#FF0000` separate, loose enough to merge
   * one-channel rounding drift).
   */
  readonly paletteDistanceThreshold?: number;
  /** Max file size in bytes to read (default 1 MiB). */
  readonly maxFileBytes?: number;
}

// ── Implementation ───────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = new Set([
  ".css",
  ".scss",
  ".sass",
  ".less",
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".vue",
  ".svelte",
]);

const DEFAULT_EXCLUDES: readonly string[] = [
  "node_modules/**",
  "dist/**",
  ".git/**",
  "build/**",
  "coverage/**",
  ".next/**",
  ".turbo/**",
];

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_PALETTE_DISTANCE = 12;

// Regexes — kept simple and greedy. We never claim perfect CSS parsing;
// we only claim honest extraction of the tokens we can identify.
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const RGB_RGBA_RE =
  /rgba?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?\s*(?:,\s*(?:\d+(?:\.\d+)?|\.\d+)\s*)?\)/g;
const HSL_HSLA_RE =
  /hsla?\(\s*\d+(?:\.\d+)?\s*,\s*\d+(?:\.\d+)?%\s*,\s*\d+(?:\.\d+)?%\s*(?:,\s*(?:\d+(?:\.\d+)?|\.\d+)\s*)?\)/g;
const SPACING_RE = /\b(\d+(?:\.\d+)?)(px|rem|em)\b/g;
const FONT_FAMILY_RE = /font-family\s*:\s*([^;"\n\r}{]+(?:"[^"]*"[^;"\n\r}{]*)*[^;"\n\r}{]*)/g;
const FONT_SIZE_RE = /font-size\s*:\s*(\d+(?:\.\d+)?)(px|rem|em)/g;
const FONT_WEIGHT_RE = /font-weight\s*:\s*(\d{3})/g;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function matchesGlob(path: string, patterns: readonly string[]): boolean {
  for (const pat of patterns) {
    // Support the three glob shapes we actually emit:
    //   "dir/**"   → path starts with `dir/`
    //   "*.ext"    → path ends with `.ext`
    //   "exact"    → path === exact
    if (pat.endsWith("/**")) {
      const prefix = pat.slice(0, -3);
      if (path === prefix || path.startsWith(prefix + "/")) return true;
    } else if (pat.startsWith("*.")) {
      if (path.endsWith(pat.slice(1))) return true;
    } else {
      if (path === pat) return true;
    }
  }
  return false;
}

function normalizeHex(hex: string): string {
  const lower = hex.toLowerCase();
  // Expand #abc → #aabbcc so clustering is stable.
  if (lower.length === 4) {
    return "#" + lower[1]! + lower[1]! + lower[2]! + lower[2]! + lower[3]! + lower[3]!;
  }
  if (lower.length === 5) {
    // #abcd (with alpha) — drop alpha for the rgb triple below, but keep the
    // raw string as-is for the stored value.
    return lower;
  }
  if (lower.length === 9) {
    // #rrggbbaa — drop alpha when computing rgb, keep raw value.
    return lower;
  }
  return lower;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace(/^#/, "");
  const expanded =
    clean.length === 3
      ? clean[0]! + clean[0]! + clean[1]! + clean[1]! + clean[2]! + clean[2]!
      : clean.length === 4
        ? clean[0]! + clean[0]! + clean[1]! + clean[1]! + clean[2]! + clean[2]!
        : clean.length >= 6
          ? clean.slice(0, 6)
          : null;
  if (!expanded) return null;
  const r = parseInt(expanded.slice(0, 2), 16);
  const g = parseInt(expanded.slice(2, 4), 16);
  const b = parseInt(expanded.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function parseRgbFn(value: string): [number, number, number] | null {
  // rgb(10, 132, 255) or rgba(231, 76, 60, 0.8)
  const inside = value.replace(/^rgba?\(/, "").replace(/\)$/, "");
  const parts = inside.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const r = Math.round(Number(parts[0]));
  const g = Math.round(Number(parts[1]));
  const b = Math.round(Number(parts[2]));
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function parseHslFn(value: string): [number, number, number] | null {
  // hsl(210, 100%, 52%) — convert to rgb.
  const inside = value.replace(/^hsla?\(/, "").replace(/\)$/, "");
  const parts = inside.split(",").map((p) => p.trim());
  if (parts.length < 3) return null;
  const h = Number(parts[0]);
  const s = Number(parts[1]!.replace("%", "")) / 100;
  const l = Number(parts[2]!.replace("%", "")) / 100;
  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return null;
  // HSL → RGB (standard algorithm).
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbDistance(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function centroidToHex(rgb: readonly [number, number, number]): string {
  const pad = (n: number): string => n.toString(16).padStart(2, "0");
  return "#" + pad(Math.round(rgb[0])) + pad(Math.round(rgb[1])) + pad(Math.round(rgb[2]));
}

interface FileExtractionResult {
  readonly colors: ReadonlyMap<string, [number, number, number]>;
  readonly spacing: readonly { raw: string; value: number; unit: "px" | "rem" | "em" }[];
  readonly fontFamilies: readonly string[];
  readonly fontSizes: readonly { raw: string; value: number; unit: "px" | "rem" | "em" }[];
  readonly fontWeights: readonly number[];
}

function extractFromText(content: string): FileExtractionResult {
  const colors = new Map<string, [number, number, number]>();
  const spacing: { raw: string; value: number; unit: "px" | "rem" | "em" }[] = [];
  const fontFamilies: string[] = [];
  const fontSizes: { raw: string; value: number; unit: "px" | "rem" | "em" }[] = [];
  const fontWeights: number[] = [];

  // Colors.
  for (const match of content.matchAll(HEX_COLOR_RE)) {
    const raw = normalizeHex(match[0]);
    const rgb = hexToRgb(raw);
    if (rgb) colors.set(raw, rgb);
  }
  for (const match of content.matchAll(RGB_RGBA_RE)) {
    const raw = match[0];
    const rgb = parseRgbFn(raw);
    if (rgb) colors.set(raw, rgb);
  }
  for (const match of content.matchAll(HSL_HSLA_RE)) {
    const raw = match[0];
    const rgb = parseHslFn(raw);
    if (rgb) colors.set(raw, rgb);
  }

  // Spacing — pick up any `Npx`/`Nrem`/`Nem` literal.
  for (const match of content.matchAll(SPACING_RE)) {
    const value = Number(match[1]);
    const unit = match[2] as "px" | "rem" | "em";
    if (!Number.isNaN(value)) {
      spacing.push({ raw: `${match[1]}${unit}`, value, unit });
    }
  }

  // Typography.
  for (const match of content.matchAll(FONT_FAMILY_RE)) {
    const val = (match[1] ?? "").trim().replace(/;$/, "").trim();
    if (val.length > 0 && val.length < 200) fontFamilies.push(val);
  }
  for (const match of content.matchAll(FONT_SIZE_RE)) {
    const value = Number(match[1]);
    const unit = match[2] as "px" | "rem" | "em";
    if (!Number.isNaN(value)) {
      fontSizes.push({ raw: `${match[1]}${unit}`, value, unit });
    }
  }
  for (const match of content.matchAll(FONT_WEIGHT_RE)) {
    const w = Number(match[1]);
    if (!Number.isNaN(w)) fontWeights.push(w);
  }

  return { colors, spacing, fontFamilies, fontSizes, fontWeights };
}

interface InternalAccumulator {
  /** color-raw → rgb triple, union across all files. */
  colorRgb: Map<string, [number, number, number]>;
  /** color-raw → set of file paths where it appears. */
  colorFiles: Map<string, Set<string>>;
  spacingFiles: Map<string, Set<string>>;
  spacingInfo: Map<string, { value: number; unit: "px" | "rem" | "em" }>;
  fontFamilyFiles: Map<string, Set<string>>;
  fontSizeFiles: Map<string, Set<string>>;
  fontSizeInfo: Map<string, { value: number; unit: "px" | "rem" | "em" }>;
  fontWeightFiles: Map<number, Set<string>>;
  filesScanned: number;
  warnings: string[];
}

/**
 * Main extractor class. One instance per extract() call is fine — it holds
 * options only, all state is scoped to the extract() invocation.
 */
export class DesignExtractor {
  private readonly include?: readonly string[];
  private readonly exclude: readonly string[];
  private readonly threshold: number;
  private readonly maxFileBytes: number;

  constructor(opts: DesignExtractorOptions = {}) {
    this.include = opts.include;
    this.exclude = opts.exclude ?? DEFAULT_EXCLUDES;
    this.threshold = opts.paletteDistanceThreshold ?? DEFAULT_PALETTE_DISTANCE;
    this.maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  extract(workspaceRoot: string): DesignSystem {
    if (!existsSync(workspaceRoot)) {
      throw new Error(`workspace does not exist: ${workspaceRoot}`);
    }
    const acc: InternalAccumulator = {
      colorRgb: new Map(),
      colorFiles: new Map(),
      spacingFiles: new Map(),
      spacingInfo: new Map(),
      fontFamilyFiles: new Map(),
      fontSizeFiles: new Map(),
      fontSizeInfo: new Map(),
      fontWeightFiles: new Map(),
      filesScanned: 0,
      warnings: [],
    };

    this.walkWorkspace(workspaceRoot, workspaceRoot, acc);

    const palettes = this.clusterPalettes(acc);
    const spacing = this.flattenSpacing(acc);
    const typography = this.flattenTypography(acc);
    const inventory = this.buildInventory(acc);

    return {
      palettes,
      spacing,
      typography,
      inventory,
      filesScanned: acc.filesScanned,
      warnings: acc.warnings,
    };
  }

  // ── Walk / scan ─────────────────────────────────────────────────────

  private walkWorkspace(root: string, current: string, acc: InternalAccumulator): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch (err) {
      acc.warnings.push(`cannot read directory ${current}: ${String(err)}`);
      return;
    }
    for (const entry of entries) {
      const abs = join(current, entry);
      const rel = relative(root, abs).split(sep).join("/");
      if (matchesGlob(rel, this.exclude)) continue;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        this.walkWorkspace(root, abs, acc);
        continue;
      }
      if (!st.isFile()) continue;
      if (st.size > this.maxFileBytes) continue;
      if (!this.shouldScan(rel, entry)) continue;

      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch (err) {
        acc.warnings.push(`cannot read ${rel}: ${String(err)}`);
        continue;
      }
      acc.filesScanned += 1;
      try {
        this.accumulate(content, rel, acc);
      } catch (err) {
        acc.warnings.push(`extraction error in ${rel}: ${String(err)}`);
      }
    }
  }

  private shouldScan(rel: string, entry: string): boolean {
    if (this.include !== undefined && !matchesGlob(rel, this.include)) return false;
    const dot = entry.lastIndexOf(".");
    if (dot < 0) return false;
    const ext = entry.slice(dot).toLowerCase();
    return DEFAULT_EXTENSIONS.has(ext);
  }

  private accumulate(content: string, rel: string, acc: InternalAccumulator): void {
    const result = extractFromText(content);

    for (const [raw, rgb] of result.colors) {
      acc.colorRgb.set(raw, rgb);
      let bucket = acc.colorFiles.get(raw);
      if (!bucket) {
        bucket = new Set();
        acc.colorFiles.set(raw, bucket);
      }
      bucket.add(rel);
    }
    for (const sp of result.spacing) {
      acc.spacingInfo.set(sp.raw, { value: sp.value, unit: sp.unit });
      let bucket = acc.spacingFiles.get(sp.raw);
      if (!bucket) {
        bucket = new Set();
        acc.spacingFiles.set(sp.raw, bucket);
      }
      bucket.add(rel);
    }
    for (const fam of result.fontFamilies) {
      let bucket = acc.fontFamilyFiles.get(fam);
      if (!bucket) {
        bucket = new Set();
        acc.fontFamilyFiles.set(fam, bucket);
      }
      bucket.add(rel);
    }
    for (const sz of result.fontSizes) {
      acc.fontSizeInfo.set(sz.raw, { value: sz.value, unit: sz.unit });
      let bucket = acc.fontSizeFiles.get(sz.raw);
      if (!bucket) {
        bucket = new Set();
        acc.fontSizeFiles.set(sz.raw, bucket);
      }
      bucket.add(rel);
    }
    for (const w of result.fontWeights) {
      let bucket = acc.fontWeightFiles.get(w);
      if (!bucket) {
        bucket = new Set();
        acc.fontWeightFiles.set(w, bucket);
      }
      bucket.add(rel);
    }
  }

  // ── Palette clustering ──────────────────────────────────────────────

  private clusterPalettes(acc: InternalAccumulator): readonly ExtractedPalette[] {
    const entries = Array.from(acc.colorRgb.entries()).map(([raw, rgb]) => ({
      raw,
      rgb,
      frequency: acc.colorFiles.get(raw)?.size ?? 0,
    }));
    // Sort deterministically by hex/raw string so palette naming is stable.
    entries.sort((a, b) => a.raw.localeCompare(b.raw));

    const clusters: { centroid: [number, number, number]; members: typeof entries }[] = [];
    for (const e of entries) {
      let placed = false;
      for (const c of clusters) {
        if (rgbDistance(c.centroid, e.rgb) <= this.threshold) {
          c.members.push(e);
          // Recompute centroid as running average.
          const n = c.members.length;
          const sum: [number, number, number] = [0, 0, 0];
          for (const m of c.members) {
            sum[0] += m.rgb[0];
            sum[1] += m.rgb[1];
            sum[2] += m.rgb[2];
          }
          c.centroid = [sum[0] / n, sum[1] / n, sum[2] / n];
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push({ centroid: [...e.rgb], members: [e] });
      }
    }

    return clusters.map((c, i) => ({
      name: `palette-${i + 1}`,
      centroid: centroidToHex(c.centroid),
      colors: c.members.map((m) => ({
        value: m.raw,
        rgb: m.rgb,
        frequency: m.frequency,
      })),
    }));
  }

  // ── Flatten spacing/typography ──────────────────────────────────────

  private flattenSpacing(acc: InternalAccumulator): readonly ExtractedSpacing[] {
    const out: ExtractedSpacing[] = [];
    for (const [raw, info] of acc.spacingInfo) {
      const freq = acc.spacingFiles.get(raw)?.size ?? 0;
      out.push({ raw, value: info.value, unit: info.unit, frequency: freq });
    }
    // Sort by value ascending then unit alpha so the output is readable.
    out.sort((a, b) => a.value - b.value || a.unit.localeCompare(b.unit));
    return out;
  }

  private flattenTypography(acc: InternalAccumulator): ExtractedTypography {
    const fontFamilies: ExtractedFontFamily[] = [];
    for (const [value, files] of acc.fontFamilyFiles) {
      fontFamilies.push({ value, frequency: files.size });
    }
    fontFamilies.sort((a, b) => b.frequency - a.frequency || a.value.localeCompare(b.value));

    const fontSizes: ExtractedFontSize[] = [];
    for (const [raw, info] of acc.fontSizeInfo) {
      const freq = acc.fontSizeFiles.get(raw)?.size ?? 0;
      fontSizes.push({ raw, value: info.value, unit: info.unit, frequency: freq });
    }
    fontSizes.sort((a, b) => a.value - b.value || a.unit.localeCompare(b.unit));

    const fontWeights: ExtractedFontWeight[] = [];
    for (const [value, files] of acc.fontWeightFiles) {
      fontWeights.push({ value, frequency: files.size });
    }
    fontWeights.sort((a, b) => a.value - b.value);

    return { fontFamilies, fontSizes, fontWeights };
  }

  private buildInventory(acc: InternalAccumulator): TokenInventory {
    const inv: Record<string, readonly string[]> = {};
    for (const [raw, files] of acc.colorFiles) {
      inv[`color:${raw}`] = Array.from(files).sort();
    }
    for (const [raw, files] of acc.spacingFiles) {
      inv[`spacing:${raw}`] = Array.from(files).sort();
    }
    for (const [value, files] of acc.fontFamilyFiles) {
      inv[`font-family:${value}`] = Array.from(files).sort();
    }
    for (const [raw, files] of acc.fontSizeFiles) {
      inv[`font-size:${raw}`] = Array.from(files).sort();
    }
    for (const [value, files] of acc.fontWeightFiles) {
      inv[`font-weight:${value}`] = Array.from(files).sort();
    }
    return inv;
  }

  // ── Serialization ───────────────────────────────────────────────────

  /** Stringified JSON with stable key order for diffs. */
  toJson(system: DesignSystem): string {
    // Emit plain objects — DesignSystem's readonly arrays serialize fine.
    return JSON.stringify(
      {
        palettes: system.palettes,
        spacing: system.spacing,
        typography: system.typography,
        inventory: system.inventory,
        filesScanned: system.filesScanned,
        warnings: system.warnings,
      },
      null,
      2,
    );
  }

  /** Human-readable markdown summary with ascii swatches. */
  toMarkdown(system: DesignSystem): string {
    const lines: string[] = [];
    lines.push("# Design System");
    lines.push("");
    lines.push(`Files scanned: ${system.filesScanned}`);
    if (system.warnings.length > 0) {
      lines.push(`Warnings: ${system.warnings.length}`);
    }
    lines.push("");

    lines.push("## Palettes");
    if (system.palettes.length === 0) {
      lines.push("_no colors found_");
    } else {
      for (const p of system.palettes) {
        lines.push("");
        lines.push(`### ${p.name} — centroid ${p.centroid}`);
        for (const c of p.colors) {
          const rgbStr = `rgb(${c.rgb[0]}, ${c.rgb[1]}, ${c.rgb[2]})`;
          lines.push(`- \`${c.value}\` · ${rgbStr} · used in ${c.frequency} file(s)`);
        }
      }
    }
    lines.push("");

    lines.push("## Spacing");
    if (system.spacing.length === 0) {
      lines.push("_no spacing tokens found_");
    } else {
      for (const s of system.spacing) {
        lines.push(`- \`${s.raw}\` (${s.value} ${s.unit}) · used in ${s.frequency} file(s)`);
      }
    }
    lines.push("");

    lines.push("## Typography");
    lines.push("");
    lines.push("### Font families");
    if (system.typography.fontFamilies.length === 0) {
      lines.push("_none_");
    } else {
      for (const f of system.typography.fontFamilies) {
        lines.push(`- \`${f.value}\` · used in ${f.frequency} file(s)`);
      }
    }
    lines.push("");
    lines.push("### Font sizes");
    if (system.typography.fontSizes.length === 0) {
      lines.push("_none_");
    } else {
      for (const s of system.typography.fontSizes) {
        lines.push(`- \`${s.raw}\` · used in ${s.frequency} file(s)`);
      }
    }
    lines.push("");
    lines.push("### Font weights");
    if (system.typography.fontWeights.length === 0) {
      lines.push("_none_");
    } else {
      for (const w of system.typography.fontWeights) {
        lines.push(`- ${w.value} · used in ${w.frequency} file(s)`);
      }
    }
    lines.push("");

    return lines.join("\n");
  }
}

// Re-export helpers for tests or power users.
export const __internal = {
  normalizeHex,
  hexToRgb,
  parseRgbFn,
  parseHslFn,
  rgbDistance,
  matchesGlob,
  isObject,
};
