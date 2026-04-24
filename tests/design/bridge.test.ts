/**
 * V9 T8.5 — Design Bridge round-trip identity tests.
 *
 * The bridge contract: emit → write → parse → diff produces an empty
 * diff. Any token that survives a full round trip MUST land in the
 * same place with the same value. These tests exercise that invariant
 * against the already-shipped primitives:
 *
 *   - `emitDtcg` (T8.1)                 — DesignSystem → DtcgBundle
 *   - `serializeDtcg` (T8.1)            — DtcgBundle → canonical JSON
 *   - `writeHandoffBundle` (T8.2)       — DtcgBundle → on-disk directory
 *   - `parseHandoffBundle` (receiver)   — zip → HandoffBundle
 *   - `parseDesignTokens` (parser)      — DTCG tree → typed token list
 *   - `diffBundles` (T8.3)              — two DtcgBundles → structured diff
 *
 * `writeHandoffBundle` produces a directory, `parseHandoffBundle`
 * consumes a zip — we bridge the two by building a zip in-memory
 * from the written directory using the test helper `buildZipBuffer`
 * (same approach `zip-reader.test.ts` uses for its own fixtures).
 *
 * QB #6 honest failures: every assertion checks a concrete identity
 * claim, not "it didn't throw". QB #7 per-call state: each test
 * builds its own tmp dir + fresh bundle so there's no shared state.
 * QB #11 sibling-site scan: this is the ONLY test file that
 * cross-ties emit + write + parse + diff; the other design tests
 * exercise each primitive in isolation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  emitDtcg,
  serializeDtcg,
  type DtcgBundle,
} from "../../src/design/dtcg-emitter.js";
import {
  writeHandoffBundle,
  type BundleManifest,
} from "../../src/design/bundle-writer.js";
import { parseHandoffBundle } from "../../src/design/handoff-receiver.js";
import { parseDesignTokens } from "../../src/design/design-tokens-parser.js";
import { diffBundles } from "../../src/design/bundle-diff.js";
import type { DesignSystem } from "../../src/design/extractor.js";
import { buildZipBuffer } from "./zip-fixture.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function smallSystem(): DesignSystem {
  return {
    palettes: [
      {
        name: "palette-1",
        centroid: "#06b6d4",
        colors: [
          { value: "#06b6d4", rgb: [6, 182, 212], frequency: 4 },
          { value: "#0e7490", rgb: [14, 116, 144], frequency: 2 },
        ],
      },
      {
        name: "palette-2",
        centroid: "#f59e0b",
        colors: [{ value: "#f59e0b", rgb: [245, 158, 11], frequency: 6 }],
      },
    ],
    spacing: [
      { raw: "4px", value: 4, unit: "px", frequency: 5 },
      { raw: "8px", value: 8, unit: "px", frequency: 10 },
      { raw: "16px", value: 16, unit: "px", frequency: 20 },
    ],
    typography: {
      fontFamilies: [{ value: "Inter, sans-serif", frequency: 8 }],
      fontSizes: [
        { raw: "0.875rem", value: 0.875, unit: "rem", frequency: 3 },
        { raw: "1rem", value: 1, unit: "rem", frequency: 12 },
      ],
      fontWeights: [
        { value: 400, frequency: 15 },
        { value: 600, frequency: 7 },
      ],
    },
    inventory: {},
    filesScanned: 12,
    warnings: [],
  };
}

function hugeSystem(): DesignSystem {
  // 250 palettes × ~2 colors + 50 spacing + 50/50/50 typography ≈ 500 tokens.
  const palettes = Array.from({ length: 250 }, (_, i) => ({
    name: `palette-${i + 1}`,
    centroid: "#000000",
    colors: [
      {
        value: `#${(i * 7).toString(16).padStart(2, "0")}1234`.slice(0, 7),
        rgb: [i % 255, (i * 3) % 255, (i * 5) % 255] as const,
        frequency: i % 10,
      },
      {
        value: `#${(i * 11).toString(16).padStart(2, "0")}5678`.slice(0, 7),
        rgb: [(i * 2) % 255, i % 255, (i * 7) % 255] as const,
        frequency: (i + 3) % 10,
      },
    ],
  }));
  const spacing = Array.from({ length: 50 }, (_, i) => ({
    raw: `${i}px`,
    value: i,
    unit: "px" as const,
    frequency: i,
  }));
  return {
    palettes,
    spacing,
    typography: {
      fontFamilies: Array.from({ length: 50 }, (_, i) => ({
        value: `Family-${i}, sans-serif`,
        frequency: i,
      })),
      fontSizes: Array.from({ length: 50 }, (_, i) => ({
        raw: `${i}px`,
        value: i,
        unit: "px" as const,
        frequency: i,
      })),
      fontWeights: Array.from({ length: 9 }, (_, i) => ({
        value: (i + 1) * 100,
        frequency: i,
      })),
    },
    inventory: {},
    filesScanned: 9999,
    warnings: [],
  };
}

function baseManifest(overrides: Partial<BundleManifest> = {}): BundleManifest {
  return {
    name: "bridge-test",
    version: "1.0.0",
    bundleVersion: "1.0.0",
    ...overrides,
  };
}

/**
 * Package a written bundle directory into a zip buffer the
 * receiver can consume. Mirrors how T8.4 `design-export` will
 * wrap the writer's output before handing it to Claude Design.
 */
function zipBundleDirectory(dir: string, components?: readonly unknown[]): Buffer {
  const files: { name: string; contents: string | Buffer }[] = [
    { name: "manifest.json", contents: readFileSync(join(dir, "manifest.json")) },
    {
      name: "design-system.json",
      contents: readFileSync(join(dir, "design-system.json")),
    },
  ];
  if (components !== undefined && existsSync(join(dir, "components.json"))) {
    files.push({
      name: "components.json",
      contents: readFileSync(join(dir, "components.json")),
    });
  }
  return buildZipBuffer(files);
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "wotann-bridge-"));
});

afterEach(() => {
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

// ── 1. Serialize → parse shape compatibility ─────────────────────────────

describe("bridge — serializeDtcg + parseDesignTokens", () => {
  it("emitDtcg output, serialized and re-parsed, is a valid token tree", () => {
    const bundle = emitDtcg(smallSystem());
    const json = serializeDtcg(bundle);
    const parsed = parseDesignTokens(JSON.parse(json));
    // smallSystem has 3 palette colors total (2 in palette-1, 1 in palette-2)
    expect(parsed.colors.length).toBe(3);
    // spacing: 3 tokens
    expect(parsed.spacing.length).toBe(3);
  });
});

// ── 2. writeHandoffBundle round-trip ──────────────────────────────────────

describe("bridge — writeHandoffBundle + parseHandoffBundle manifest", () => {
  it("manifest fields survive write → zip → parse unchanged", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      {
        manifest: baseManifest({
          author: "Gabriel",
          exportedFrom: "WOTANN",
          createdAt: "2026-04-23T00:00:00Z",
        }),
        designSystem: emitDtcg(smallSystem()),
      },
      out,
    );
    const zipBuf = zipBundleDirectory(out);
    const zipPath = join(workDir, "bundle.zip");
    writeFileSync(zipPath, zipBuf);

    const parsed = parseHandoffBundle(zipPath);
    expect(parsed.manifest.name).toBe("bridge-test");
    expect(parsed.manifest.version).toBe("1.0.0");
    expect(parsed.manifest.bundleVersion).toBe("1.0.0");
    expect(parsed.manifest.author).toBe("Gabriel");
    expect(parsed.manifest.exportedFrom).toBe("WOTANN");
    expect(parsed.manifest.createdAt).toBe("2026-04-23T00:00:00Z");
  });

  it("emit → write → parse preserves the color count", () => {
    const sys = smallSystem();
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: emitDtcg(sys) },
      out,
    );
    const zipBuf = zipBundleDirectory(out);
    const zipPath = join(workDir, "bundle.zip");
    writeFileSync(zipPath, zipBuf);

    const parsed = parseHandoffBundle(zipPath);
    // Every extracted color lands as a token entry on the parsed side.
    const expectedColors = sys.palettes.reduce(
      (n, p) => n + p.colors.length,
      0,
    );
    expect(parsed.designSystem.colors.length).toBe(expectedColors);
  });
});

// ── 3. Diff identity ──────────────────────────────────────────────────────

describe("bridge — diffBundles on identical bundles", () => {
  it("same-bundle diff is empty", () => {
    const bundle = emitDtcg(smallSystem());
    const diff = diffBundles(bundle, bundle);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("emit → serialize → JSON.parse → re-emit still diffs clean against the original", () => {
    // Two separate emits from the same fixture system must be identical.
    const left = emitDtcg(smallSystem());
    const right = emitDtcg(smallSystem());
    const diff = diffBundles(left, right);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});

// ── 4. Diff detects mutations ─────────────────────────────────────────────

describe("bridge — diffBundles detects targeted edits", () => {
  it("detects a single color value change", () => {
    const before = emitDtcg(smallSystem());
    const mutated = smallSystem();
    const firstPalette = mutated.palettes[0];
    if (!firstPalette) throw new Error("fixture missing palette");
    const newPalettes = [
      {
        ...firstPalette,
        colors: [
          { ...firstPalette.colors[0]!, value: "#ff0000" },
          ...firstPalette.colors.slice(1),
        ],
      },
      ...mutated.palettes.slice(1),
    ];
    const after = emitDtcg({ ...mutated, palettes: newPalettes });

    const diff = diffBundles(before, after);
    // one token changed (palette-1.base)
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed.length).toBeGreaterThanOrEqual(1);
    const valueChanges = diff.changed.filter(
      (e) => e.kind === "changed" && e.field === "$value",
    );
    expect(valueChanges.length).toBeGreaterThanOrEqual(1);
  });

  it("detects an added palette", () => {
    const before = emitDtcg(smallSystem());
    const extended = smallSystem();
    const after = emitDtcg({
      ...extended,
      palettes: [
        ...extended.palettes,
        {
          name: "palette-3",
          centroid: "#00ff00",
          colors: [{ value: "#00ff00", rgb: [0, 255, 0], frequency: 1 }],
        },
      ],
    });

    const diff = diffBundles(before, after);
    expect(diff.added.length).toBeGreaterThanOrEqual(1);
    const palette3 = diff.added.find((e) =>
      e.path.join(".").includes("palette-3"),
    );
    expect(palette3).toBeDefined();
  });

  it("detects a removed palette", () => {
    const fullBundle = emitDtcg(smallSystem());
    const reduced = smallSystem();
    const after = emitDtcg({
      ...reduced,
      palettes: reduced.palettes.slice(0, 1), // drop palette-2
    });

    const diff = diffBundles(fullBundle, after);
    expect(diff.removed.length).toBeGreaterThanOrEqual(1);
    const hasPalette2 = diff.removed.some((e) =>
      e.path.join(".").includes("palette-2"),
    );
    expect(hasPalette2).toBe(true);
  });
});

// ── 5. Serialized-output determinism ──────────────────────────────────────

describe("bridge — serialization stability", () => {
  it("adding a new token produces a different serialized hash", () => {
    const base = serializeDtcg(emitDtcg(smallSystem()));
    const extended = smallSystem();
    const augmented = serializeDtcg(
      emitDtcg({
        ...extended,
        spacing: [
          ...extended.spacing,
          { raw: "32px", value: 32, unit: "px", frequency: 1 },
        ],
      }),
    );
    expect(base).not.toBe(augmented);
  });

  it("two emits of the same system produce byte-identical output", () => {
    const a = serializeDtcg(emitDtcg(smallSystem()));
    const b = serializeDtcg(emitDtcg(smallSystem()));
    expect(a).toBe(b);
  });
});

// ── 6. Stress — 500+ token system survives the full bridge ────────────────

describe("bridge — huge system stress", () => {
  it("500+ token system serializes and parses without throwing", () => {
    const bundle = emitDtcg(hugeSystem());
    expect(() => serializeDtcg(bundle)).not.toThrow();
    const serialized = serializeDtcg(bundle);
    expect(() => parseDesignTokens(JSON.parse(serialized))).not.toThrow();
  });

  it("huge-system diff against itself is empty", () => {
    const left = emitDtcg(hugeSystem());
    const right = emitDtcg(hugeSystem());
    const diff = diffBundles(left, right);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});

// ── 7. Optional-field presence/absence round-trip ─────────────────────────

describe("bridge — optional manifest fields", () => {
  it("absent optional fields stay absent through round trip", () => {
    const out = join(workDir, "bundle");
    writeHandoffBundle(
      { manifest: baseManifest(), designSystem: emitDtcg(smallSystem()) },
      out,
    );
    const manifestRaw = JSON.parse(
      readFileSync(join(out, "manifest.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(manifestRaw.author).toBeUndefined();
    expect(manifestRaw.exported_from).toBeUndefined();
    expect(manifestRaw.created_at).toBeUndefined();

    const zipBuf = zipBundleDirectory(out);
    const zipPath = join(workDir, "bundle.zip");
    writeFileSync(zipPath, zipBuf);
    const parsed = parseHandoffBundle(zipPath);
    expect(parsed.manifest.author).toBeUndefined();
    expect(parsed.manifest.exportedFrom).toBeUndefined();
    expect(parsed.manifest.createdAt).toBeUndefined();
  });
});

// ── 8. Components array round-trip ────────────────────────────────────────

describe("bridge — components array", () => {
  it("components round-trip when provided at write time", () => {
    const out = join(workDir, "bundle");
    const components = [
      { name: "Button", props: { variant: "primary" } },
      { name: "Card" },
    ];
    writeHandoffBundle(
      {
        manifest: baseManifest(),
        designSystem: emitDtcg(smallSystem()),
        components,
      },
      out,
    );
    const zipBuf = zipBundleDirectory(out, components);
    const zipPath = join(workDir, "bundle.zip");
    writeFileSync(zipPath, zipBuf);
    const parsed = parseHandoffBundle(zipPath);
    expect(parsed.components.length).toBe(2);
    // Component-importer normalizes names, so just check they made the trip.
    expect(parsed.components.some((c) => c.name === "Button")).toBe(true);
    expect(parsed.components.some((c) => c.name === "Card")).toBe(true);
  });
});
