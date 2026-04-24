/**
 * W3C DTCG v6.3 token emitter — V9 Tier 8 T8.1.
 *
 * Takes the `DesignSystem` produced by the codebase extractor
 * (`src/design/extractor.ts`) and emits it as a W3C Design Tokens
 * Community Group (DTCG) v6.3 JSON tree — the format Claude Design
 * consumes and produces.
 *
 * The extractor's output is structural (palettes, spacing, typography
 * with raw values + frequency counts). DTCG is descriptive (every
 * leaf has `$type`, `$value`, optional `$description`, and an optional
 * alias reference like `"{colors.primary}"`). This module is the
 * lossless structural→descriptive bridge.
 *
 * Mirror image: `design-tokens-parser.ts` is the DTCG *reader* —
 * Claude Design bundles come in through there. The emitter is the
 * reverse direction so WOTANN can ALSO *produce* a Claude-Design-
 * compatible bundle (picked up by the Tier 8 T8.2 bundle writer).
 *
 * ── DTCG v6.3 essentials ──────────────────────────────────────────
 * - Tokens are leaves with `$value` and `$type`. Groups are any other
 *   object.
 * - `$value` can be a primitive (string, number) OR an alias string
 *   of the form `"{group.subgroup.token}"` (curly-brace wrapped).
 * - `$type` tells consumers how to interpret `$value`. v6.3 canonical
 *   types: `color`, `dimension`, `fontFamily`, `fontWeight`,
 *   `fontSize` (added 6.3), `typography` (composite), `shadow`
 *   (composite), `number`, `duration`, `cubicBezier`.
 * - `$description` is free-text metadata surfaced by UIs (design
 *   apps render it as the token's tooltip).
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: `emitDtcg` never silently drops tokens;
 *    anything it can't classify lands in the `extras` group tagged
 *    with `$type: "other"`.
 *  - QB #7 per-call state: pure function. No module-level state.
 *  - QB #11 sibling-site scan: `design-tokens-parser.ts`
 *    (`DesignTokenEntry`) defines the token-path convention the
 *    emitter reverses; the two files are the only authority on the
 *    tree shape.
 */

import type {
  DesignSystem,
  ExtractedColor,
  ExtractedFontFamily,
  ExtractedFontSize,
  ExtractedFontWeight,
  ExtractedPalette,
  ExtractedSpacing,
} from "./extractor.js";

// ═══ DTCG types ═══════════════════════════════════════════════════════════

/**
 * v6.3 canonical token types plus `"other"` for the extras bucket. Kept as a
 * string union so consumers can switch on it exhaustively.
 */
export type DtcgType =
  | "color"
  | "dimension"
  | "fontFamily"
  | "fontWeight"
  | "fontSize"
  | "typography"
  | "shadow"
  | "number"
  | "duration"
  | "cubicBezier"
  | "other";

export interface DtcgToken {
  readonly $type: DtcgType;
  readonly $value: string | number;
  readonly $description?: string;
}

/**
 * Groups are recursive — any non-token object. The `$description`
 * optional field at the group level is permitted by the spec and
 * used for section-level metadata.
 */
export type DtcgNode = DtcgToken | DtcgGroup;

export interface DtcgGroup {
  readonly $description?: string;
  readonly [key: string]: DtcgNode | string | undefined;
}

/**
 * Top-level bundle. The 5 named groups mirror the categories
 * `design-tokens-parser.ts` recognizes so round-trip is lossless.
 * `extras` holds anything the extractor classified as "other".
 */
export interface DtcgBundle {
  readonly colors: DtcgGroup;
  readonly spacing: DtcgGroup;
  readonly typography: DtcgGroup;
  readonly borderRadius: DtcgGroup;
  readonly shadows: DtcgGroup;
  readonly extras: DtcgGroup;
}

export interface EmitDtcgOptions {
  /**
   * Optional human-readable description applied to the top-level
   * bundle. Shown by design tools as the design-system's title text.
   */
  readonly description?: string;
  /**
   * When set, every emitted leaf carries a `$description` pointing
   * back to the frequency count from the extractor — useful when
   * debugging why a token was promoted.
   */
  readonly includeFrequencyMeta?: boolean;
}

// ═══ Alias helpers ════════════════════════════════════════════════════════

/**
 * Build a DTCG alias string from a dotted path. DTCG aliases are
 * `"{colors.primary}"` — curly-braces around the dotted path.
 *
 * Callers typically build these when two tokens share a value and
 * only one needs an independent definition. Example:
 *
 *   const primary = { $type: "color", $value: "#06b6d4" };
 *   const accent  = { $type: "color", $value: createAlias(["colors", "primary"]) };
 *                                            // "{colors.primary}"
 */
export function createAlias(path: readonly string[]): string {
  if (path.length === 0) {
    throw new Error("createAlias: path cannot be empty");
  }
  return `{${path.join(".")}}`;
}

/**
 * Parse an alias string back to its dotted path. Returns `null` when
 * the input isn't an alias — lets callers use the same code path for
 * resolved vs alias values.
 */
export function parseAlias(value: unknown): readonly string[] | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("{") || !value.endsWith("}")) return null;
  const inner = value.slice(1, -1).trim();
  if (inner.length === 0) return null;
  return inner.split(".");
}

// ═══ Naming ═══════════════════════════════════════════════════════════════

/**
 * Build the stable token name within a palette group. The first
 * color gets `base` (the palette's visual identity); others get
 * `shade-<idx>` starting at 2. Empty palette → empty group.
 */
function paletteTokenName(idx: number): string {
  return idx === 0 ? "base" : `shade-${idx + 1}`;
}

/**
 * Convert an extracted-palette name like `palette-1` into a DTCG
 * group key. DTCG doesn't forbid hyphens but tools are happier with
 * camel-safe keys, and the leading digit that `palette-1` has would
 * clash with some CSS var emitters downstream.
 */
function paletteGroupKey(name: string): string {
  const cleaned = name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned : "palette";
}

// ═══ Per-category emitters ═══════════════════════════════════════════════

function emitPalette(palette: ExtractedPalette, includeFrequency: boolean): DtcgGroup {
  const group: Record<string, DtcgNode | string | undefined> = {
    $description: `${palette.colors.length} colors (centroid ${palette.centroid})`,
  };
  palette.colors.forEach((color: ExtractedColor, idx: number) => {
    const name = paletteTokenName(idx);
    const token: DtcgToken = {
      $type: "color",
      $value: color.value,
      ...(includeFrequency ? { $description: `Seen in ${color.frequency} file(s)` } : {}),
    };
    group[name] = token;
  });
  return group as DtcgGroup;
}

function emitSpacing(entries: readonly ExtractedSpacing[], includeFrequency: boolean): DtcgGroup {
  const group: Record<string, DtcgNode | string | undefined> = {};
  entries.forEach((s, idx) => {
    const token: DtcgToken = {
      $type: "dimension",
      $value: s.raw,
      ...(includeFrequency
        ? { $description: `${s.frequency} occurrences (${s.value}${s.unit})` }
        : {}),
    };
    group[`space-${idx + 1}`] = token;
  });
  return group as DtcgGroup;
}

function emitFontFamilies(
  entries: readonly ExtractedFontFamily[],
  includeFrequency: boolean,
): DtcgGroup {
  const group: Record<string, DtcgNode | string | undefined> = {};
  entries.forEach((f, idx) => {
    const token: DtcgToken = {
      $type: "fontFamily",
      $value: f.value,
      ...(includeFrequency ? { $description: `${f.frequency} refs` } : {}),
    };
    group[`family-${idx + 1}`] = token;
  });
  return group as DtcgGroup;
}

function emitFontSizes(
  entries: readonly ExtractedFontSize[],
  includeFrequency: boolean,
): DtcgGroup {
  const group: Record<string, DtcgNode | string | undefined> = {};
  entries.forEach((fs, idx) => {
    const token: DtcgToken = {
      $type: "fontSize",
      $value: fs.raw,
      ...(includeFrequency ? { $description: `${fs.frequency} refs (${fs.value}${fs.unit})` } : {}),
    };
    group[`size-${idx + 1}`] = token;
  });
  return group as DtcgGroup;
}

function emitFontWeights(
  entries: readonly ExtractedFontWeight[],
  includeFrequency: boolean,
): DtcgGroup {
  const group: Record<string, DtcgNode | string | undefined> = {};
  entries.forEach((fw, idx) => {
    const token: DtcgToken = {
      $type: "fontWeight",
      $value: fw.value,
      ...(includeFrequency ? { $description: `${fw.frequency} refs` } : {}),
    };
    group[`weight-${idx + 1}`] = token;
  });
  return group as DtcgGroup;
}

// ═══ Main emit ════════════════════════════════════════════════════════════

/**
 * Emit the full DTCG v6.3 bundle for a design system.
 *
 * ── Guarantees ────────────────────────────────────────────────────────────
 *  - Stable order: palettes emit in the order the extractor returned
 *    them; spacing, font-families, font-sizes, font-weights emit in
 *    the extractor's own descending-frequency order.
 *  - No data loss: every extractor field lands in the output. Tokens
 *    the extractor didn't classify (borderRadius, shadows) produce
 *    empty groups so consumers can always index into them safely.
 *  - Type-safe: every `$value` is either a primitive or an alias
 *    string; `$type` matches DTCG v6.3 canonical types.
 */
export function emitDtcg(system: DesignSystem, options: EmitDtcgOptions = {}): DtcgBundle {
  const includeFrequency = options.includeFrequencyMeta === true;

  const colors: Record<string, DtcgNode | string | undefined> = {};
  if (options.description !== undefined) {
    colors.$description = "Extracted palettes grouped by cluster.";
  }
  for (const palette of system.palettes) {
    colors[paletteGroupKey(palette.name)] = emitPalette(palette, includeFrequency);
  }

  const typography: Record<string, DtcgNode | string | undefined> = {
    fontFamily: emitFontFamilies(system.typography.fontFamilies, includeFrequency),
    fontSize: emitFontSizes(system.typography.fontSizes, includeFrequency),
    fontWeight: emitFontWeights(system.typography.fontWeights, includeFrequency),
  };

  return {
    colors: colors as DtcgGroup,
    spacing: emitSpacing(system.spacing, includeFrequency),
    typography: typography as DtcgGroup,
    // Empty pass-throughs. Future tiers (T8.5 round-trip tests) may wire
    // borderRadius + shadows in once the extractor learns to pull them.
    borderRadius: {} as DtcgGroup,
    shadows: {} as DtcgGroup,
    extras: {} as DtcgGroup,
  };
}

/**
 * Serialize a bundle to a canonical JSON string. Stable key order +
 * two-space indent match what `design-tokens-parser.ts` expects on
 * input; round-trip equality is a T8.5 test target.
 */
export function serializeDtcg(bundle: DtcgBundle, indent: number = 2): string {
  return JSON.stringify(bundle, sortedReplacer, indent);
}

/**
 * Key sort for deterministic output. DTCG doesn't require sorted
 * keys, but round-trip tests + content-hash diffs rely on a stable
 * ordering. `$`-prefixed meta fields come first (so tools that scan
 * top-of-object see `$type` before `$value`), then other keys
 * alphabetically.
 */
function sortedReplacer(this: unknown, _key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  const sorted: Record<string, unknown> = {};
  const meta = entries.filter(([k]) => k.startsWith("$")).sort(([a], [b]) => a.localeCompare(b));
  const normal = entries.filter(([k]) => !k.startsWith("$")).sort(([a], [b]) => a.localeCompare(b));
  for (const [k, v] of [...meta, ...normal]) sorted[k] = v;
  return sorted;
}
