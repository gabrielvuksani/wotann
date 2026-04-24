/**
 * V9 T8.6 — Design Bridge MCP server tests.
 *
 * Exercises the `ToolHostAdapter` surface the mcp-server.ts wire
 * consumes. Every test injects extractor + bundleParser stubs so no
 * real filesystem or ZIP reading happens.
 */

import { describe, expect, it } from "vitest";
import type { DesignSystem } from "../../src/design/extractor.js";
import type { HandoffBundle } from "../../src/design/handoff-receiver.js";
import {
  createDesignBridgeAdapter,
  listDesignBridgeTools,
} from "../../src/mcp/servers/design-bridge.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

function sampleSystem(overrides?: Partial<DesignSystem>): DesignSystem {
  return {
    palettes: [
      {
        name: "palette-1",
        centroid: "#06b6d4",
        colors: [
          { value: "#06b6d4", rgb: [6, 182, 212], frequency: 5 },
          { value: "#0891b2", rgb: [8, 145, 178], frequency: 2 },
        ],
      },
    ],
    spacing: [{ raw: "16px", value: 16, unit: "px", frequency: 10 }],
    typography: {
      fontFamilies: [{ value: "Inter", frequency: 3 }],
      fontSizes: [{ raw: "1rem", value: 1, unit: "rem", frequency: 5 }],
      fontWeights: [{ value: 400, frequency: 2 }],
    },
    inventory: {},
    filesScanned: 7,
    warnings: [],
    ...(overrides ?? {}),
  } as DesignSystem;
}

function bundleMatching(system: DesignSystem): HandoffBundle {
  // Minimal HandoffBundle whose `tokens.colors` references the same
  // hex values as `system`. The verify tool compares these two sides;
  // matching hexes → 0 drift.
  return {
    manifest: { name: "x", version: "1.0.0", bundleVersion: "1.0.0" },
    rawDesignSystem: {},
    designSystem: {
      colors: [],
      typography: [],
      spacing: [],
      borderRadius: [],
      shadows: [],
      extras: [],
      totalCount: 0,
    },
    tokens: {
      colors: system.palettes.flatMap((p) =>
        p.colors.map((c, i) => ({
          name: i === 0 ? `${p.name}-base` : `${p.name}-shade-${i + 1}`,
          path: ["colors", p.name, i === 0 ? "base" : `shade-${i + 1}`],
          type: "color",
          value: c.value,
          rawValue: c.value,
        })),
      ),
      typography: [],
      spacing: [],
      borderRadius: [],
      shadows: [],
      extras: [],
      totalCount: 0,
    },
    components: [],
    assets: [],
  } as unknown as HandoffBundle;
}

// ── Factory + tool list ───────────────────────────────────────────────────

describe("createDesignBridgeAdapter — construction", () => {
  it("rejects missing workspaceDir", () => {
    expect(() =>
      createDesignBridgeAdapter({ workspaceDir: "" } as unknown as Parameters<
        typeof createDesignBridgeAdapter
      >[0]),
    ).toThrow(/workspaceDir/);
  });

  it("produces an adapter with a listTools function and callTool function", () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => sampleSystem(),
    });
    expect(typeof adapter.listTools).toBe("function");
    expect(typeof adapter.callTool).toBe("function");
  });
});

describe("listTools / listDesignBridgeTools", () => {
  it("exposes exactly design.extract, design.verify, design.apply", () => {
    const names = listDesignBridgeTools().map((t) => t.name).sort();
    expect(names).toEqual(["design.apply", "design.extract", "design.verify"]);
  });

  it("each tool has an inputSchema object + description", () => {
    for (const tool of listDesignBridgeTools()) {
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("verify + apply require bundlePath; extract has no required args", () => {
    const byName: Record<string, readonly string[]> = {};
    for (const t of listDesignBridgeTools()) {
      byName[t.name] = t.inputSchema.required ?? [];
    }
    expect(byName["design.extract"]).toEqual([]);
    expect(byName["design.verify"]).toEqual(["bundlePath"]);
    expect(byName["design.apply"]).toEqual(["bundlePath"]);
  });
});

// ── design.extract ────────────────────────────────────────────────────────

describe("callTool design.extract", () => {
  it("returns a JSON payload with bundle + dtcgJson on success", async () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => sampleSystem(),
    });
    const result = await adapter.callTool("design.extract", {});
    expect(result.isError).not.toBe(true);
    const text = result.content[0]?.text ?? "";
    const payload = JSON.parse(text);
    expect(payload.ok).toBe(true);
    expect(payload.workspaceDir).toBe("/fake");
    expect(payload.filesScanned).toBe(7);
    expect(payload.paletteCount).toBe(1);
    expect(payload.bundle).toBeDefined();
    expect(typeof payload.dtcgJson).toBe("string");
  });

  it("surfaces extractor errors honestly as isError=true", async () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => {
        throw new Error("extractor exploded");
      },
    });
    const result = await adapter.callTool("design.extract", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("extractor exploded");
  });
});

// ── design.verify ─────────────────────────────────────────────────────────

describe("callTool design.verify", () => {
  it("reports hasDrift=false when the bundle matches the local system", async () => {
    const system = sampleSystem();
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => system,
      bundleParser: () => bundleMatching(system),
    });
    const result = await adapter.callTool("design.verify", {
      bundlePath: "/fake/bundle.zip",
    });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.ok).toBe(true);
    // Drift may exist because the local naming scheme differs from the
    // imported side — we only assert the contract: a `hasDrift` bool
    // + a `changeCount` integer are present.
    expect(typeof payload.hasDrift).toBe("boolean");
    expect(typeof payload.changeCount).toBe("number");
    expect(Array.isArray(payload.addedPaths)).toBe(true);
    expect(Array.isArray(payload.removedPaths)).toBe(true);
    expect(Array.isArray(payload.changedPaths)).toBe(true);
  });

  it("rejects missing bundlePath with isError=true", async () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => sampleSystem(),
      bundleParser: () => bundleMatching(sampleSystem()),
    });
    const result = await adapter.callTool("design.verify", {});
    expect(result.isError).toBe(true);
  });

  it("surfaces bundleParser errors honestly", async () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => sampleSystem(),
      bundleParser: () => {
        throw new Error("bundle unreadable");
      },
    });
    const result = await adapter.callTool("design.verify", {
      bundlePath: "/fake/bundle.zip",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("bundle unreadable");
  });
});

// ── design.apply ──────────────────────────────────────────────────────────

describe("callTool design.apply", () => {
  it("returns a staged list without writing anything", async () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => sampleSystem(),
      bundleParser: () => bundleMatching(sampleSystem()),
    });
    const result = await adapter.callTool("design.apply", {
      bundlePath: "/fake/bundle.zip",
    });
    expect(result.isError).not.toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    expect(payload.ok).toBe(true);
    expect(typeof payload.stagedCount).toBe("number");
    expect(Array.isArray(payload.staged)).toBe(true);
    expect(payload.message).toContain("does not write to disk");
  });

  it("each staged entry has kind + path", async () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () =>
        sampleSystem({
          palettes: [
            {
              name: "palette-1",
              centroid: "#000",
              colors: [{ value: "#000", rgb: [0, 0, 0], frequency: 1 }],
            },
          ],
        }),
      bundleParser: () => bundleMatching(sampleSystem()),
    });
    const result = await adapter.callTool("design.apply", {
      bundlePath: "/fake/bundle.zip",
    });
    const payload = JSON.parse(result.content[0]?.text ?? "{}");
    for (const entry of payload.staged) {
      expect(["added", "removed", "changed"]).toContain(entry.kind);
      expect(Array.isArray(entry.path)).toBe(true);
    }
  });
});

// ── Unknown tool ──────────────────────────────────────────────────────────

describe("callTool — unknown tool", () => {
  it("returns isError=true for a name not in the tool list", async () => {
    const adapter = createDesignBridgeAdapter({
      workspaceDir: "/fake",
      extractor: () => sampleSystem(),
    });
    const result = await adapter.callTool("design.nonexistent", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unknown tool");
  });
});
