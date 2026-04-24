/**
 * V9 T8.1 — DTCG emitter tests.
 *
 * Covers the structural→descriptive translation from the codebase
 * extractor's `DesignSystem` to a W3C DTCG v6.3 tree, plus alias
 * helpers and serializer determinism.
 */

import { describe, expect, it } from "vitest";
import type { DesignSystem } from "../../src/design/extractor.js";
import {
  createAlias,
  emitDtcg,
  parseAlias,
  serializeDtcg,
  type DtcgBundle,
  type DtcgGroup,
  type DtcgToken,
} from "../../src/design/dtcg-emitter.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function emptySystem(): DesignSystem {
  return {
    palettes: [],
    spacing: [],
    typography: {
      fontFamilies: [],
      fontSizes: [],
      fontWeights: [],
    },
    inventory: {},
    filesScanned: 0,
    warnings: [],
  };
}

function sampleSystem(): DesignSystem {
  return {
    palettes: [
      {
        name: "palette-1",
        centroid: "#06b6d4",
        colors: [
          { value: "#06b6d4", rgb: [6, 182, 212], frequency: 8 },
          { value: "#0891b2", rgb: [8, 145, 178], frequency: 3 },
        ],
      },
      {
        name: "palette-2",
        centroid: "#1e293b",
        colors: [{ value: "#1e293b", rgb: [30, 41, 59], frequency: 12 }],
      },
    ],
    spacing: [
      { raw: "16px", value: 16, unit: "px", frequency: 42 },
      { raw: "8px", value: 8, unit: "px", frequency: 28 },
    ],
    typography: {
      fontFamilies: [
        { value: "Inter, sans-serif", frequency: 10 },
        { value: "JetBrains Mono, monospace", frequency: 3 },
      ],
      fontSizes: [{ raw: "1rem", value: 1, unit: "rem", frequency: 15 }],
      fontWeights: [{ value: 500, frequency: 9 }],
    },
    inventory: {},
    filesScanned: 17,
    warnings: [],
  };
}

function pickToken(group: DtcgGroup, key: string): DtcgToken | undefined {
  const node = group[key];
  if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
  if ("$value" in node && "$type" in node) return node as DtcgToken;
  return undefined;
}

// ── createAlias / parseAlias ───────────────────────────────────────────────

describe("createAlias", () => {
  it("wraps a dotted path in curly braces", () => {
    expect(createAlias(["colors", "primary"])).toBe("{colors.primary}");
  });

  it("joins longer paths", () => {
    expect(createAlias(["colors", "palette1", "base"])).toBe("{colors.palette1.base}");
  });

  it("throws on empty paths (the spec requires at least one segment)", () => {
    expect(() => createAlias([])).toThrow(/empty/);
  });
});

describe("parseAlias", () => {
  it("splits an alias back into its path", () => {
    expect(parseAlias("{colors.primary}")).toEqual(["colors", "primary"]);
  });

  it("returns null for raw values", () => {
    expect(parseAlias("#06b6d4")).toBeNull();
    expect(parseAlias("16px")).toBeNull();
  });

  it("returns null for unwrapped strings that look like paths", () => {
    expect(parseAlias("colors.primary")).toBeNull();
  });

  it("returns null for non-string inputs", () => {
    expect(parseAlias(42)).toBeNull();
    expect(parseAlias(null)).toBeNull();
    expect(parseAlias({})).toBeNull();
  });

  it("returns null for empty alias braces", () => {
    expect(parseAlias("{}")).toBeNull();
  });

  it("round-trips createAlias → parseAlias", () => {
    const path = ["typography", "fontSize", "size-1"];
    const alias = createAlias(path);
    expect(parseAlias(alias)).toEqual(path);
  });
});

// ── emitDtcg ──────────────────────────────────────────────────────────────

describe("emitDtcg — structure", () => {
  it("produces all five canonical groups + extras even for an empty system", () => {
    const bundle = emitDtcg(emptySystem());
    expect(bundle).toHaveProperty("colors");
    expect(bundle).toHaveProperty("spacing");
    expect(bundle).toHaveProperty("typography");
    expect(bundle).toHaveProperty("borderRadius");
    expect(bundle).toHaveProperty("shadows");
    expect(bundle).toHaveProperty("extras");
  });

  it("palette-1 centroid is the `base` token in its group", () => {
    const bundle = emitDtcg(sampleSystem());
    const palette1 = bundle.colors["palette-1"] as DtcgGroup;
    const base = pickToken(palette1, "base");
    expect(base?.$type).toBe("color");
    expect(base?.$value).toBe("#06b6d4");
  });

  it("secondary colors in a palette get shade-N keys starting at 2", () => {
    const bundle = emitDtcg(sampleSystem());
    const palette1 = bundle.colors["palette-1"] as DtcgGroup;
    const shade2 = pickToken(palette1, "shade-2");
    expect(shade2?.$type).toBe("color");
    expect(shade2?.$value).toBe("#0891b2");
  });

  it("spacing is indexed space-N in extractor order", () => {
    const bundle = emitDtcg(sampleSystem());
    const first = pickToken(bundle.spacing, "space-1");
    const second = pickToken(bundle.spacing, "space-2");
    expect(first?.$type).toBe("dimension");
    expect(first?.$value).toBe("16px");
    expect(second?.$value).toBe("8px");
  });

  it("typography has three sub-groups: fontFamily, fontSize, fontWeight", () => {
    const bundle = emitDtcg(sampleSystem());
    const t = bundle.typography;
    expect(t.fontFamily).toBeDefined();
    expect(t.fontSize).toBeDefined();
    expect(t.fontWeight).toBeDefined();
  });

  it("font families emit with $type=fontFamily", () => {
    const bundle = emitDtcg(sampleSystem());
    const ff = bundle.typography.fontFamily as DtcgGroup;
    const first = pickToken(ff, "family-1");
    expect(first?.$type).toBe("fontFamily");
    expect(first?.$value).toBe("Inter, sans-serif");
  });

  it("font weights emit with numeric $value", () => {
    const bundle = emitDtcg(sampleSystem());
    const fw = bundle.typography.fontWeight as DtcgGroup;
    const first = pickToken(fw, "weight-1");
    expect(first?.$type).toBe("fontWeight");
    expect(first?.$value).toBe(500);
  });

  it("frequency metadata is omitted by default", () => {
    const bundle = emitDtcg(sampleSystem());
    const first = pickToken(bundle.spacing, "space-1");
    expect(first?.$description).toBeUndefined();
  });

  it("frequency metadata is emitted when includeFrequencyMeta=true", () => {
    const bundle = emitDtcg(sampleSystem(), { includeFrequencyMeta: true });
    const first = pickToken(bundle.spacing, "space-1");
    expect(first?.$description).toContain("42");
  });
});

// ── serializeDtcg ─────────────────────────────────────────────────────────

describe("serializeDtcg", () => {
  it("produces valid JSON that round-trips through JSON.parse", () => {
    const bundle = emitDtcg(sampleSystem());
    const str = serializeDtcg(bundle);
    expect(() => JSON.parse(str)).not.toThrow();
  });

  it("is deterministic — same bundle emits byte-identical output", () => {
    const a = serializeDtcg(emitDtcg(sampleSystem()));
    const b = serializeDtcg(emitDtcg(sampleSystem()));
    expect(a).toBe(b);
  });

  it("sorts $-prefixed meta keys before normal keys for tool-friendly layout", () => {
    const token = {
      $type: "color" as const,
      $value: "#000",
    };
    const bundle: DtcgBundle = {
      colors: { sample: { ...token, extra: "x" } as unknown as DtcgToken },
      spacing: {},
      typography: {},
      borderRadius: {},
      shadows: {},
      extras: {},
    };
    const str = serializeDtcg(bundle);
    const typeIdx = str.indexOf("\"$type\"");
    const valueIdx = str.indexOf("\"$value\"");
    const extraIdx = str.indexOf("\"extra\"");
    expect(typeIdx).toBeGreaterThan(-1);
    expect(valueIdx).toBeGreaterThan(typeIdx);
    expect(extraIdx).toBeGreaterThan(valueIdx);
  });

  it("honors a custom indent", () => {
    const bundle = emitDtcg(emptySystem());
    const two = serializeDtcg(bundle, 2);
    const four = serializeDtcg(bundle, 4);
    expect(four.length).toBeGreaterThan(two.length);
  });
});
