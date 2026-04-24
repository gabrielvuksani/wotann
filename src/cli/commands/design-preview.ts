/**
 * `wotann design preview` — V9 Tier 8 T8.4 CLI command (data layer).
 *
 * Produces preview-ready, pure-data structures summarizing a design
 * system (either freshly extracted from a workspace OR parsed from a
 * handoff bundle). A sibling TSX component (owned by another agent)
 * consumes this output and renders it in the Ink TUI.
 *
 * This file DELIBERATELY imports zero UI libraries (no React, Ink,
 * ink-select-input, etc.). Keeping the data layer isolated lets us:
 *   1. Test rendering contracts without booting Ink.
 *   2. Re-use the same structures from the MCP server and the web
 *      dashboard without TUI baggage.
 *   3. Swap the frontend later without touching data transforms.
 *
 * Flow (two modes, pick one — the other must be undefined):
 *   A) { workspaceDir } -> extractor.extract() -> lift -> preview
 *   B) { bundlePath }   -> parseHandoffBundle() -> walk DTCG -> preview
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: any parse/extract error returns
 *    `{ ok: false, error }`. Passing both or neither of bundlePath /
 *    workspaceDir is an input error (honest refusal).
 *  - QB #7 per-call state: fresh extractor per call; no module-level
 *    caches.
 *  - QB #13 env guard: zero process.* reads.
 */

import { resolve } from "node:path";
import {
  DesignExtractor,
  type DesignExtractorOptions,
  type DesignSystem,
} from "../../design/extractor.js";
import type { DtcgBundle, DtcgGroup, DtcgNode, DtcgToken } from "../../design/dtcg-emitter.js";
import { parseHandoffBundle } from "../../design/handoff-receiver.js";
import type { DesignSystemExtractor } from "./design-export.js";

// ═══ Preview types (pure data) ════════════════════════════════════════════

export interface PreviewPalette {
  readonly name: string;
  readonly colors: readonly { readonly name: string; readonly hex: string }[];
}

export interface PreviewSpacing {
  readonly name: string;
  readonly value: string;
}

export interface PreviewTypography {
  readonly fontFamilies: readonly string[];
  readonly fontSizes: readonly string[];
  readonly fontWeights: readonly number[];
}

export type DesignPreviewOptions =
  | {
      readonly workspaceDir: string;
      readonly bundlePath?: undefined;
      readonly extractor?: DesignSystemExtractor;
      readonly extractorOptions?: DesignExtractorOptions;
    }
  | { readonly bundlePath: string; readonly workspaceDir?: undefined };

export type PreviewResult =
  | {
      readonly ok: true;
      readonly palettes: readonly PreviewPalette[];
      readonly spacing: readonly PreviewSpacing[];
      readonly typography: PreviewTypography;
    }
  | {
      readonly ok: false;
      readonly error: string;
    };

// ═══ Helpers ═════════════════════════════════════════════════════════════

function defaultExtractor(
  extractorOptions: DesignExtractorOptions | undefined,
): DesignSystemExtractor {
  return async ({ workspaceDir }) => {
    const extractor = new DesignExtractor(extractorOptions ?? {});
    return extractor.extract(workspaceDir);
  };
}

/** Shape check for `DtcgToken`. Mirrors bundle-diff's isToken. */
function isToken(node: DtcgNode): node is DtcgToken {
  return typeof node === "object" && node !== null && "$value" in node && "$type" in node;
}

/** Convert extractor output (structural) to preview-ready form. */
function fromDesignSystem(system: DesignSystem): PreviewResult {
  const palettes: PreviewPalette[] = system.palettes.map((p) => ({
    name: p.name,
    colors: p.colors.map((c, idx) => ({
      name: idx === 0 ? "base" : `shade-${idx + 1}`,
      hex: c.value,
    })),
  }));
  const spacing: PreviewSpacing[] = system.spacing.map((s, idx) => ({
    name: `space-${idx + 1}`,
    value: s.raw,
  }));
  const typography: PreviewTypography = {
    fontFamilies: system.typography.fontFamilies.map((f) => f.value),
    fontSizes: system.typography.fontSizes.map((fs) => fs.raw),
    fontWeights: system.typography.fontWeights.map((fw) => fw.value),
  };
  return { ok: true, palettes, spacing, typography };
}

/** Convert DTCG bundle (descriptive) to preview-ready form. */
function fromDtcg(bundle: DtcgBundle): PreviewResult {
  const palettes: PreviewPalette[] = [];
  for (const paletteName of Object.keys(bundle.colors)) {
    if (paletteName.startsWith("$")) continue;
    const node = bundle.colors[paletteName];
    if (!node || typeof node !== "object" || isToken(node as DtcgNode)) continue;
    const paletteGroup = node as DtcgGroup;
    const colors: { name: string; hex: string }[] = [];
    for (const colorKey of Object.keys(paletteGroup)) {
      if (colorKey.startsWith("$")) continue;
      const colorNode = paletteGroup[colorKey];
      if (colorNode && typeof colorNode === "object" && isToken(colorNode as DtcgNode)) {
        const token = colorNode as DtcgToken;
        colors.push({ name: colorKey, hex: String(token.$value) });
      }
    }
    palettes.push({ name: paletteName, colors });
  }

  const spacing: PreviewSpacing[] = [];
  for (const key of Object.keys(bundle.spacing)) {
    if (key.startsWith("$")) continue;
    const node = bundle.spacing[key];
    if (node && typeof node === "object" && isToken(node as DtcgNode)) {
      const token = node as DtcgToken;
      spacing.push({ name: key, value: String(token.$value) });
    }
  }

  const families: string[] = [];
  const sizes: string[] = [];
  const weights: number[] = [];
  const typoGroup = bundle.typography;
  for (const categoryKey of Object.keys(typoGroup)) {
    if (categoryKey.startsWith("$")) continue;
    const catNode = typoGroup[categoryKey];
    if (!catNode || typeof catNode !== "object" || isToken(catNode as DtcgNode)) continue;
    const group = catNode as DtcgGroup;
    for (const tokenKey of Object.keys(group)) {
      if (tokenKey.startsWith("$")) continue;
      const leaf = group[tokenKey];
      if (leaf && typeof leaf === "object" && isToken(leaf as DtcgNode)) {
        const token = leaf as DtcgToken;
        if (token.$type === "fontFamily") families.push(String(token.$value));
        else if (token.$type === "fontSize") sizes.push(String(token.$value));
        else if (token.$type === "fontWeight") {
          const n = typeof token.$value === "number" ? token.$value : Number(token.$value);
          if (Number.isFinite(n)) weights.push(n);
        }
      }
    }
  }

  return {
    ok: true,
    palettes,
    spacing,
    typography: { fontFamilies: families, fontSizes: sizes, fontWeights: weights },
  };
}

// ═══ Main ════════════════════════════════════════════════════════════════

/**
 * Run the preview pipeline. Exactly one of `workspaceDir` or
 * `bundlePath` must be provided; both or neither is an error.
 */
export async function runDesignPreview(opts: DesignPreviewOptions): Promise<PreviewResult> {
  const hasWorkspace = typeof opts.workspaceDir === "string" && opts.workspaceDir.length > 0;
  const hasBundle = typeof opts.bundlePath === "string" && opts.bundlePath.length > 0;

  if (hasWorkspace === hasBundle) {
    return {
      ok: false,
      error: "runDesignPreview: pass exactly one of { workspaceDir } or { bundlePath }",
    };
  }

  if (hasWorkspace) {
    // Narrow the union — TypeScript knows workspaceDir is set here.
    const wsOpts = opts as Extract<DesignPreviewOptions, { workspaceDir: string }>;
    const workspaceDir = resolve(wsOpts.workspaceDir);
    const extractor = wsOpts.extractor ?? defaultExtractor(wsOpts.extractorOptions);
    let system: DesignSystem;
    try {
      system = await extractor({ workspaceDir });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `local extraction failed: ${reason}` };
    }
    return fromDesignSystem(system);
  }

  // Bundle mode.
  const bundleOpts = opts as Extract<DesignPreviewOptions, { bundlePath: string }>;
  const bundlePath = resolve(bundleOpts.bundlePath);
  try {
    const bundle = parseHandoffBundle(bundlePath);
    return fromDtcg(bundle.rawDesignSystem as DtcgBundle);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `failed to parse handoff bundle: ${reason}` };
  }
}
