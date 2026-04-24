/**
 * DesignPreview — Ink TUI rendering of a design-system preview.
 *
 * Shown by `wotann design preview` (T8.4 design-preview.ts) and as a
 * secondary panel inside the Workshop tab. Consumes a three-part
 * projection (palettes, spacing, typography) produced by whichever
 * upstream source the caller chose — local extraction from
 * `DesignExtractor`, a parsed Claude Design handoff bundle, or a
 * diffed overlay between two bundles.
 *
 * ── V9 reference ──────────────────────────────────────────────────
 * Master Plan V9 Tier 8 T8.5 (docs/MASTER_PLAN_V9.md, lines
 * 1293-1298). The T8.5 integration-test matrix specifies a "huge
 * system — 500 tokens" smoke test that must render without OOM;
 * this component honours that by bounding every iteration with
 * `.slice(0, N)` on the render side and exposing an overflow tag
 * instead of scrolling massive lists.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────
 *  - QB #6 honest failures: props are read-only, no runtime parsing —
 *    an incomplete preview is the caller's responsibility to report,
 *    not ours to silently backfill.
 *  - QB #7 per-call state: pure render (props → JSX). No state, no
 *    `useEffect`, no module-level caches.
 *  - QB #11 sibling-site scan: the prop shapes deliberately mirror
 *    the extractor's flattened output and the DTCG v6.3 leaves, so
 *    `design-preview.ts` (CLI adaptor) is the single marshalling
 *    site between bundle/extraction and this view.
 */
import React from "react";
import { Box, Text } from "ink";

// ═══ Public prop types ════════════════════════════════════════════════════

/**
 * A swatch inside a palette. `hex` is passed straight to Ink's
 * `<Text color={hex}>` so the terminal renders a real colored glyph
 * when the pair of hex+terminal supports it; otherwise the glyph is
 * still printed (just uncolored).
 */
export interface PreviewColor {
  readonly name: string;
  readonly hex: string;
}

export interface PreviewPalette {
  readonly name: string;
  readonly colors: readonly PreviewColor[];
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

export interface DesignPreviewProps {
  readonly palettes: readonly PreviewPalette[];
  readonly spacing: readonly PreviewSpacing[];
  readonly typography: PreviewTypography;
}

// ═══ Bounds (tuned for 500+ token stress target) ══════════════════════════

const MAX_PALETTES = 12;
const MAX_COLORS_PER_PALETTE = 8;
const MAX_SPACING = 10;
const MAX_FONT_FAMILIES = 6;
const MAX_FONT_SIZES = 10;
const MAX_FONT_WEIGHTS = 8;

// ═══ Helpers ══════════════════════════════════════════════════════════════

function overflowTag(total: number, shown: number): string | null {
  return total > shown ? `+${total - shown} more` : null;
}

function PaletteRow({ palette }: { readonly palette: PreviewPalette }): React.ReactElement {
  const shown = palette.colors.slice(0, MAX_COLORS_PER_PALETTE);
  const extra = overflowTag(palette.colors.length, shown.length);
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{palette.name}</Text>
        <Text dimColor> ({palette.colors.length})</Text>
      </Box>
      <Box>
        {shown.map((c, i) => (
          <Box key={`${palette.name}-${c.name}-${i}`} marginRight={1}>
            <Text color={c.hex}>■</Text>
            <Text dimColor> {c.name}</Text>
          </Box>
        ))}
        {extra !== null && <Text dimColor> {extra}</Text>}
      </Box>
    </Box>
  );
}

// ═══ Main component ═══════════════════════════════════════════════════════

/**
 * Pure render — no hooks, no effects. Given props are treated as
 * authoritative; the component never mutates nor re-sorts them so
 * callers control emission order (useful when diffing two systems).
 */
export const DesignPreview: React.FC<DesignPreviewProps> = (
  props: DesignPreviewProps,
): React.ReactElement => {
  const palettes = props.palettes.slice(0, MAX_PALETTES);
  const spacing = props.spacing.slice(0, MAX_SPACING);
  const families = props.typography.fontFamilies.slice(0, MAX_FONT_FAMILIES);
  const sizes = props.typography.fontSizes.slice(0, MAX_FONT_SIZES);
  const weights = props.typography.fontWeights.slice(0, MAX_FONT_WEIGHTS);

  const palettesOverflow = overflowTag(props.palettes.length, palettes.length);
  const spacingOverflow = overflowTag(props.spacing.length, spacing.length);
  const familiesOverflow = overflowTag(props.typography.fontFamilies.length, families.length);
  const sizesOverflow = overflowTag(props.typography.fontSizes.length, sizes.length);
  const weightsOverflow = overflowTag(props.typography.fontWeights.length, weights.length);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box>
        <Text bold color="cyan">
          Design System Preview
        </Text>
      </Box>

      {/* Palettes */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Palettes</Text>
        {palettes.length === 0 ? (
          <Text dimColor>no palettes</Text>
        ) : (
          palettes.map((p, i) => <PaletteRow key={`p-${i}-${p.name}`} palette={p} />)
        )}
        {palettesOverflow !== null && <Text dimColor>{palettesOverflow} palettes</Text>}
      </Box>

      {/* Spacing */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Spacing</Text>
        {spacing.length === 0 ? (
          <Text dimColor>no spacing tokens</Text>
        ) : (
          spacing.map((s, i) => (
            <Box key={`s-${i}-${s.name}`}>
              <Text>{s.name}</Text>
              <Text dimColor> · {s.value}</Text>
            </Box>
          ))
        )}
        {spacingOverflow !== null && <Text dimColor>{spacingOverflow}</Text>}
      </Box>

      {/* Typography */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Typography</Text>
        <Box>
          <Text>families: </Text>
          <Text dimColor>{families.join(", ") || "none"}</Text>
          {familiesOverflow !== null && <Text dimColor> ({familiesOverflow})</Text>}
        </Box>
        <Box>
          <Text>sizes: </Text>
          <Text dimColor>{sizes.join(", ") || "none"}</Text>
          {sizesOverflow !== null && <Text dimColor> ({sizesOverflow})</Text>}
        </Box>
        <Box>
          <Text>weights: </Text>
          <Text dimColor>{weights.map((w) => String(w)).join(", ") || "none"}</Text>
          {weightsOverflow !== null && <Text dimColor> ({weightsOverflow})</Text>}
        </Box>
      </Box>
    </Box>
  );
};

export default DesignPreview;
