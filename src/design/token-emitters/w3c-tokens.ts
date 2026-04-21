/**
 * W3C Design Tokens Community Group (DTCG) format emitter.
 *
 * Spec: https://tr.designtokens.org/format/
 *
 * Emits the canonical WOTANN tokens as a JSON object conforming to the
 * Design Tokens CG format: each leaf is `{ $type, $value }`, groups are
 * plain objects, description is optional but helpful.
 *
 * Use-cases: Figma / Style Dictionary / Tokens Studio can consume the
 * output directly. This is the interop format for any external designer
 * tool integration.
 */

import {
  type CanonicalPaletteName,
  type WotannTokens,
  COLOR_TOKEN_KEYS,
  formatShadowLayer,
} from "../tokens.js";

interface LeafToken {
  $type: string;
  $value: unknown;
  $description?: string;
}

export interface W3cTokenTree {
  $description?: string;
  [group: string]: W3cTokenTree | LeafToken | string | undefined;
}

function emitPaletteTree(palettes: WotannTokens["palettes"]): W3cTokenTree {
  const tree: W3cTokenTree = {
    $description: "WOTANN canonical palettes (5 themes × 19 color tokens)",
  };
  for (const name of Object.keys(palettes) as CanonicalPaletteName[]) {
    const p = palettes[name];
    const group: W3cTokenTree = {};
    for (const key of COLOR_TOKEN_KEYS) {
      group[key] = { $type: "color", $value: p[key] };
    }
    tree[name] = group;
  }
  return tree;
}

function emitTypographyTree(t: WotannTokens["typography"]): W3cTokenTree {
  const family: W3cTokenTree = {};
  for (const [k, v] of Object.entries(t.family)) {
    family[k] = { $type: "fontFamily", $value: v };
  }
  const size: W3cTokenTree = {};
  for (const [k, v] of Object.entries(t.size)) {
    size[k] = { $type: "dimension", $value: `${v}px` };
  }
  const weight: W3cTokenTree = {};
  for (const [k, v] of Object.entries(t.weight)) {
    weight[k] = { $type: "fontWeight", $value: v };
  }
  const lineHeight: W3cTokenTree = {};
  for (const [k, v] of Object.entries(t.lineHeight)) {
    lineHeight[k] = { $type: "number", $value: v };
  }
  const letterSpacing: W3cTokenTree = {};
  for (const [k, v] of Object.entries(t.letterSpacing)) {
    letterSpacing[k] = { $type: "dimension", $value: `${v}px` };
  }
  return { family, size, weight, lineHeight, letterSpacing };
}

function emitSpacingTree(s: WotannTokens["spacing"]): W3cTokenTree {
  const tree: W3cTokenTree = {};
  for (const [k, v] of Object.entries(s)) {
    tree[k] = { $type: "dimension", $value: `${v}px` };
  }
  return tree;
}

function emitRadiusTree(r: WotannTokens["radius"]): W3cTokenTree {
  const tree: W3cTokenTree = {};
  for (const [k, v] of Object.entries(r)) {
    tree[k] = { $type: "dimension", $value: `${v}px` };
  }
  return tree;
}

function emitShadowTree(shadow: WotannTokens["shadow"]): W3cTokenTree {
  const tree: W3cTokenTree = {
    none: { $type: "shadow", $value: "none" },
  };
  for (const k of ["sm", "md", "lg", "xl"] as const) {
    const layers = shadow[k];
    tree[k] = {
      $type: "shadow",
      $value: layers.map(formatShadowLayer).join(", "),
    };
  }
  return tree;
}

function emitMotionTree(m: WotannTokens["motion"]): W3cTokenTree {
  const duration: W3cTokenTree = {};
  for (const [k, v] of Object.entries(m.duration)) {
    duration[k] = { $type: "duration", $value: `${v}ms` };
  }
  const easing: W3cTokenTree = {};
  for (const [k, v] of Object.entries(m.easing)) {
    easing[k] = {
      $type: "cubicBezier",
      $value: v,
    };
  }
  return { duration, easing };
}

export function emitW3cTokens(tokens: WotannTokens): W3cTokenTree {
  return {
    $description:
      "WOTANN design tokens — W3C Design Tokens CG format. Auto-generated; do not edit.",
    color: emitPaletteTree(tokens.palettes),
    typography: emitTypographyTree(tokens.typography),
    spacing: emitSpacingTree(tokens.spacing),
    radius: emitRadiusTree(tokens.radius),
    shadow: emitShadowTree(tokens.shadow),
    motion: emitMotionTree(tokens.motion),
  };
}

/** Shortcut: JSON-stringified W3C token tree with indentation. */
export function emitW3cTokensJson(tokens: WotannTokens, indent = 2): string {
  return JSON.stringify(emitW3cTokens(tokens), null, indent) + "\n";
}
