/**
 * V9 Tier 8 T8.4 — CLI commands for the design bridge.
 *
 * Tests the four CLI command entry points:
 *   - runDesignExport   (workspace -> DTCG bundle dir)
 *   - runDesignVerify   (workspace x bundle -> drift report)
 *   - runDesignApply    (workspace x bundle x approval -> staged lists)
 *   - runDesignPreview  (workspace OR bundle -> pure preview data)
 *
 * Exercises the happy path and an error path for each command, plus
 * the approval-handler contract (design-apply) and the no-React
 * purity invariant (design-preview).
 *
 * Fixture strategy:
 *   - Real tmpdirs (mkdtempSync/rmSync) so the bundle writer and
 *     the handoff-receiver do their actual filesystem work.
 *   - `buildZipBuffer` from tests/design/zip-fixture.ts produces a
 *     valid Claude-Design-shaped ZIP without external deps.
 *   - The `extractor` injector returns a hand-built DesignSystem so
 *     tests never wait on a recursive directory scan.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runDesignExport } from "../../src/cli/commands/design-export.js";
import { runDesignVerify } from "../../src/cli/commands/design-verify.js";
import {
  runDesignApply,
  type TokenChange,
} from "../../src/cli/commands/design-apply.js";
import { runDesignPreview } from "../../src/cli/commands/design-preview.js";
import type { DesignSystem } from "../../src/design/extractor.js";
import type { DtcgBundle } from "../../src/design/dtcg-emitter.js";
import { buildZipBuffer } from "../design/zip-fixture.js";

// ── Fixtures ────────────────────────────────────────────────────────────

function makeDesignSystem(overrides: Partial<DesignSystem> = {}): DesignSystem {
  const base: DesignSystem = {
    palettes: [
      {
        name: "palette-1",
        centroid: "#06b6d4",
        colors: [
          { value: "#06b6d4", rgb: [6, 182, 212], frequency: 3 },
          { value: "#0ea5e9", rgb: [14, 165, 233], frequency: 2 },
        ],
      },
    ],
    spacing: [{ raw: "16px", value: 16, unit: "px", frequency: 4 }],
    typography: {
      fontFamilies: [{ value: "Inter", frequency: 2 }],
      fontSizes: [{ raw: "14px", value: 14, unit: "px", frequency: 5 }],
      fontWeights: [{ value: 500, frequency: 1 }],
    },
    inventory: {},
    filesScanned: 7,
    warnings: [],
  };
  return { ...base, ...overrides };
}

function emptyDesignSystem(): DesignSystem {
  return {
    palettes: [],
    spacing: [],
    typography: { fontFamilies: [], fontSizes: [], fontWeights: [] },
    inventory: {},
    filesScanned: 0,
    warnings: [],
  };
}

/**
 * Bundle JSON that round-trips with `emitDtcg(makeDesignSystem())`.
 * Keep this in lockstep with the emitter — the verify happy-path
 * relies on byte-identical diff.
 */
function bundleJson(overrides: Partial<DtcgBundle> = {}): DtcgBundle {
  const base: DtcgBundle = {
    colors: {
      "palette-1": {
        $description: "2 colors (centroid #06b6d4)",
        base: { $type: "color", $value: "#06b6d4" },
        "shade-2": { $type: "color", $value: "#0ea5e9" },
      },
    },
    spacing: {
      "space-1": { $type: "dimension", $value: "16px" },
    },
    typography: {
      fontFamily: {
        "family-1": { $type: "fontFamily", $value: "Inter" },
      },
      fontSize: {
        "size-1": { $type: "fontSize", $value: "14px" },
      },
      fontWeight: {
        "weight-1": { $type: "fontWeight", $value: 500 },
      },
    },
    borderRadius: {},
    shadows: {},
    extras: {},
  };
  return { ...base, ...overrides };
}

/**
 * Build a valid handoff bundle ZIP at `path`. Contains manifest,
 * design-system, components. Caller owns cleanup of the enclosing dir.
 */
function writeBundleZip(path: string, designSystem: DtcgBundle): void {
  const buf = buildZipBuffer([
    {
      name: "manifest.json",
      contents: JSON.stringify({
        name: "fixture",
        version: "0.1.0",
        bundle_version: "1.0.0",
      }),
    },
    {
      name: "design-system.json",
      contents: JSON.stringify(designSystem),
    },
    {
      name: "components.json",
      contents: JSON.stringify([]),
    },
  ]);
  writeFileSync(path, buf);
}

let workRoot: string;

beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), "wotann-design-cli-"));
});

afterEach(() => {
  if (existsSync(workRoot)) rmSync(workRoot, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// runDesignExport
// ─────────────────────────────────────────────────────────────────────────

describe("runDesignExport", () => {
  it("writes a handoff bundle directory when given a valid workspace", async () => {
    const workspace = join(workRoot, "ws");
    const outDir = join(workRoot, "out");
    // Workspace must exist for the default extractor, but the injector
    // here short-circuits the scan — just making sure the path is real.
    writeFileSync(join(workRoot, "marker"), "x");

    const result = await runDesignExport({
      workspaceDir: workspace || workRoot,
      outDir,
      extractor: async () => makeDesignSystem(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return; // type narrowing for the following assertions
    expect(result.bundleDir).toBe(outDir);
    expect(result.fileCount).toBe(2); // manifest + design-system
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(outDir, "design-system.json"))).toBe(true);

    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf-8"));
    expect(manifest.bundle_version).toBe("1.0.0");
    expect(manifest.exported_from).toBe("WOTANN");
  });

  it("returns { ok: false } when extraction throws", async () => {
    const result = await runDesignExport({
      workspaceDir: workRoot,
      outDir: join(workRoot, "out"),
      extractor: async () => {
        throw new Error("simulated extractor failure");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("simulated extractor failure");
  });

  it("refuses unsupported formats instead of silently defaulting", async () => {
    // Use a cast to test honest-refusal on an illegal format input —
    // the type system would normally prevent this, but real-world
    // callers (MCP server, HTTP) can pass anything as string.
    const result = await runDesignExport({
      workspaceDir: workRoot,
      outDir: join(workRoot, "out"),
      format: "xml" as unknown as "dtcg",
      extractor: async () => makeDesignSystem(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("unsupported export format");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// runDesignVerify
// ─────────────────────────────────────────────────────────────────────────

describe("runDesignVerify", () => {
  it("reports no drift when local matches imported bundle", async () => {
    const bundlePath = join(workRoot, "bundle.zip");
    writeBundleZip(bundlePath, bundleJson());

    const result = await runDesignVerify({
      bundlePath,
      workspaceDir: workRoot,
      extractor: async () => makeDesignSystem(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hasDrift).toBe(false);
    expect(result.diff.added).toHaveLength(0);
    expect(result.diff.removed).toHaveLength(0);
    expect(result.diff.changed).toHaveLength(0);
  });

  it("reports drift when workspace design system diverges", async () => {
    const bundlePath = join(workRoot, "bundle.zip");
    // Imported has palette-1 #06b6d4; local will have a different color.
    writeBundleZip(bundlePath, bundleJson());

    const result = await runDesignVerify({
      bundlePath,
      workspaceDir: workRoot,
      extractor: async () =>
        makeDesignSystem({
          palettes: [
            {
              name: "palette-1",
              centroid: "#ff0000",
              colors: [{ value: "#ff0000", rgb: [255, 0, 0], frequency: 1 }],
            },
          ],
        }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hasDrift).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("returns { ok: false } when the bundle path is invalid", async () => {
    const result = await runDesignVerify({
      bundlePath: join(workRoot, "does-not-exist.zip"),
      workspaceDir: workRoot,
      extractor: async () => makeDesignSystem(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("failed to parse handoff bundle");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// runDesignApply
// ─────────────────────────────────────────────────────────────────────────

describe("runDesignApply", () => {
  it("routes every diff entry through the approval handler", async () => {
    const bundlePath = join(workRoot, "bundle.zip");
    // Bundle has an extra color (tertiary); local workspace is empty.
    writeBundleZip(
      bundlePath,
      bundleJson({
        colors: {
          "palette-1": {
            base: { $type: "color", $value: "#06b6d4" },
            tertiary: { $type: "color", $value: "#7c3aed" },
          },
        },
      }),
    );

    const seen: TokenChange[] = [];
    const result = await runDesignApply({
      bundlePath,
      workspaceDir: workRoot,
      extractor: async () => emptyDesignSystem(),
      approvalHandler: async (change) => {
        seen.push(change);
        return true; // approve everything
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Empty local + non-trivial bundle => every bundle token is "added".
    expect(seen.length).toBeGreaterThan(0);
    // Since we approved everything, applied === seen.length.
    expect(result.applied).toHaveLength(seen.length);
    expect(result.skipped).toHaveLength(0);
    // Verify a known added path surfaces.
    const paths = seen.map((c) => c.path);
    expect(paths).toContain("colors.palette-1.tertiary");
  });

  it("places rejected changes in skipped, approved in applied", async () => {
    const bundlePath = join(workRoot, "bundle.zip");
    writeBundleZip(
      bundlePath,
      bundleJson({
        colors: {
          "palette-1": {
            base: { $type: "color", $value: "#06b6d4" },
            tertiary: { $type: "color", $value: "#7c3aed" },
          },
        },
      }),
    );

    const result = await runDesignApply({
      bundlePath,
      workspaceDir: workRoot,
      extractor: async () => emptyDesignSystem(),
      // Approve only paths containing "base"; reject the rest.
      approvalHandler: async (change) => change.path.endsWith(".base"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.skipped.length).toBeGreaterThan(0);
    for (const p of result.applied) expect(p.endsWith(".base")).toBe(true);
    for (const p of result.skipped) expect(p.endsWith(".base")).toBe(false);
  });

  it("returns { ok: false } when the approval handler throws", async () => {
    const bundlePath = join(workRoot, "bundle.zip");
    writeBundleZip(bundlePath, bundleJson());

    const result = await runDesignApply({
      bundlePath,
      workspaceDir: workRoot,
      extractor: async () => emptyDesignSystem(),
      approvalHandler: async () => {
        throw new Error("handler blew up");
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("handler blew up");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// runDesignPreview
// ─────────────────────────────────────────────────────────────────────────

describe("runDesignPreview", () => {
  it("produces preview data from a workspace", async () => {
    const result = await runDesignPreview({
      workspaceDir: workRoot,
      extractor: async () => makeDesignSystem(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.palettes).toHaveLength(1);
    expect(result.palettes[0]?.colors).toHaveLength(2);
    expect(result.palettes[0]?.colors[0]).toEqual({ name: "base", hex: "#06b6d4" });
    expect(result.spacing).toHaveLength(1);
    expect(result.typography.fontFamilies).toContain("Inter");
    expect(result.typography.fontWeights).toContain(500);
  });

  it("produces preview data from a bundle path", async () => {
    const bundlePath = join(workRoot, "bundle.zip");
    writeBundleZip(bundlePath, bundleJson());

    const result = await runDesignPreview({ bundlePath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.palettes).toHaveLength(1);
    expect(result.palettes[0]?.name).toBe("palette-1");
    expect(result.typography.fontFamilies).toContain("Inter");
  });

  it("refuses when neither workspaceDir nor bundlePath is provided", async () => {
    // Empty-object call — both fields undefined. Cast through unknown
    // so we can exercise the runtime guard without fighting the types.
    const result = await runDesignPreview({ bundlePath: "" } as unknown as Parameters<
      typeof runDesignPreview
    >[0]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("exactly one");
  });

  it("data layer never imports React or Ink", () => {
    // QB: design-preview.ts MUST stay a pure data layer. Another agent
    // owns the TSX renderer; this grep enforces the separation.
    const source = readFileSync(
      join(__dirname, "..", "..", "src", "cli", "commands", "design-preview.ts"),
      "utf-8",
    );
    const lower = source.toLowerCase();
    // Match import/require statements referencing react or ink packages.
    expect(lower).not.toMatch(/from\s+["']react["']/);
    expect(lower).not.toMatch(/from\s+["']ink["']/);
    expect(lower).not.toMatch(/from\s+["']ink-[a-z]+["']/);
    expect(lower).not.toMatch(/require\(["']react["']\)/);
    expect(lower).not.toMatch(/require\(["']ink["']\)/);
  });
});
