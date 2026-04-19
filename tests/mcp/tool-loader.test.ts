import { describe, it, expect } from "vitest";
import {
  loadTools,
  loadToolsWithOptions,
  resolveTier,
  filterByTier,
  listToolNamesForTier,
  estimateTokenCost,
  DEFAULT_TIERED_TOOLS,
  WOTANN_MCP_TIER_ENV,
  type TieredTool,
  type McpTier,
} from "../../src/mcp/tool-loader.js";

// ── Tier resolution ──────────────────────────────────

describe("resolveTier", () => {
  it("defaults to core when nothing is provided", () => {
    // Build an empty env object so the real process env cannot leak in.
    expect(resolveTier({ env: {} })).toBe("core");
  });

  it("explicit option wins over env", () => {
    expect(resolveTier({ tier: "all", env: { [WOTANN_MCP_TIER_ENV]: "core" } })).toBe("all");
  });

  it("reads env when no explicit option", () => {
    expect(resolveTier({ env: { [WOTANN_MCP_TIER_ENV]: "standard" } })).toBe("standard");
  });

  it("falls back to core on an invalid env value", () => {
    expect(resolveTier({ env: { [WOTANN_MCP_TIER_ENV]: "ultra" } })).toBe("core");
  });

  it("falls back to core on an invalid explicit option", () => {
    // @ts-expect-error — proving the runtime guard
    expect(resolveTier({ tier: "ultra", env: {} })).toBe("core");
  });
});

// ── filterByTier ─────────────────────────────────────

describe("filterByTier", () => {
  const testRegistry: readonly TieredTool[] = [
    {
      tier: "core",
      tool: { name: "c1", description: "", inputSchema: { type: "object", properties: {} } },
    },
    {
      tier: "standard",
      tool: { name: "s1", description: "", inputSchema: { type: "object", properties: {} } },
    },
    {
      tier: "all",
      tool: { name: "a1", description: "", inputSchema: { type: "object", properties: {} } },
    },
  ];

  it("core tier includes only core tools", () => {
    const out = filterByTier(testRegistry, "core");
    expect(out.map((t) => t.tool.name)).toEqual(["c1"]);
  });

  it("standard tier includes core + standard tools", () => {
    const out = filterByTier(testRegistry, "standard");
    expect(out.map((t) => t.tool.name).sort()).toEqual(["c1", "s1"]);
  });

  it("all tier includes every tool", () => {
    const out = filterByTier(testRegistry, "all");
    expect(out.map((t) => t.tool.name).sort()).toEqual(["a1", "c1", "s1"]);
  });
});

// ── Default registry cardinality ─────────────────────

describe("DEFAULT_TIERED_TOOLS — tier cardinality (task-master parity)", () => {
  it("core tier has exactly 7 tools", () => {
    const core = filterByTier(DEFAULT_TIERED_TOOLS, "core");
    expect(core).toHaveLength(7);
  });

  it("standard tier has exactly 14 tools (core + 7)", () => {
    const std = filterByTier(DEFAULT_TIERED_TOOLS, "standard");
    expect(std).toHaveLength(14);
  });

  it("all tier has 42 or more tools", () => {
    const all = filterByTier(DEFAULT_TIERED_TOOLS, "all");
    expect(all.length).toBeGreaterThanOrEqual(42);
  });

  it("every tool in the default registry has a non-empty name + description", () => {
    for (const { tool } of DEFAULT_TIERED_TOOLS) {
      expect(tool.name).not.toBe("");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("tool names are unique across the registry", () => {
    const names = DEFAULT_TIERED_TOOLS.map((t) => t.tool.name);
    const set = new Set(names);
    expect(set.size).toBe(names.length);
  });

  it("every tool ships an object inputSchema", () => {
    for (const { tool } of DEFAULT_TIERED_TOOLS) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });
});

// ── loadTools public API ─────────────────────────────

describe("loadTools", () => {
  it("returns exactly 7 tools for core (task-master parity)", () => {
    const result = loadToolsWithOptions({ tier: "core" });
    expect(result.tier).toBe("core");
    expect(result.tools).toHaveLength(7);
  });

  it("returns 14 tools for standard", () => {
    const result = loadToolsWithOptions({ tier: "standard" });
    expect(result.tools).toHaveLength(14);
  });

  it("returns 42+ tools for all", () => {
    const result = loadToolsWithOptions({ tier: "all" });
    expect(result.tools.length).toBeGreaterThanOrEqual(42);
  });

  it("reads WOTANN_MCP_TIER env var when no explicit tier", () => {
    const result = loadToolsWithOptions({
      env: { [WOTANN_MCP_TIER_ENV]: "standard" },
    });
    expect(result.tier).toBe("standard");
    expect(result.tools).toHaveLength(14);
  });

  it("default tier (no opts) is core", () => {
    // Use loadToolsWithOptions with empty env to avoid inheriting the
    // test runner's process.env.WOTANN_MCP_TIER if it happens to be set.
    const result = loadToolsWithOptions({ env: {} });
    expect(result.tier).toBe("core");
  });

  it("legacy loadTools(tier, env) signature still works", () => {
    const result = loadTools("core", {});
    expect(result.tools).toHaveLength(7);
  });

  it("token cost monotonic: core < standard < all", () => {
    const core = loadToolsWithOptions({ tier: "core" });
    const std = loadToolsWithOptions({ tier: "standard" });
    const all = loadToolsWithOptions({ tier: "all" });
    expect(core.approxTokens).toBeLessThan(std.approxTokens);
    expect(std.approxTokens).toBeLessThan(all.approxTokens);
  });

  it("all tier costs meaningfully more than core — justifies tiering", () => {
    const core = loadToolsWithOptions({ tier: "core" });
    const all = loadToolsWithOptions({ tier: "all" });
    // Roughly factor 4x more tokens — not flaky because both numbers
    // come from deterministic JSON.stringify.
    expect(all.approxTokens).toBeGreaterThan(core.approxTokens * 2);
  });

  it("accepts a custom registry", () => {
    const custom: readonly TieredTool[] = [
      {
        tier: "core",
        tool: { name: "custom", description: "x", inputSchema: { type: "object", properties: {} } },
      },
    ];
    const result = loadToolsWithOptions({ tier: "core", registry: custom });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.name).toBe("custom");
  });
});

// ── listToolNamesForTier ─────────────────────────────

describe("listToolNamesForTier", () => {
  it("returns name-only array for the given tier", () => {
    const names = listToolNamesForTier("core");
    expect(names).toHaveLength(7);
    for (const n of names) {
      expect(typeof n).toBe("string");
    }
  });

  it("core must include the 7 most-used workflow tools", () => {
    const names = listToolNamesForTier("core");
    // Critical daily-workflow tools — must be in core per task-master's model.
    expect(names).toContain("memory_search");
    expect(names).toContain("unified_exec");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
  });

  it("standard adds authoring tools like edit_file + plan_create", () => {
    const names = listToolNamesForTier("standard");
    expect(names).toContain("edit_file");
    expect(names).toContain("plan_create");
    expect(names).toContain("plan_next");
  });

  it("only 'all' includes the heavy surfaces like browser + computer-use", () => {
    const coreNames = listToolNamesForTier("core");
    const allNames = listToolNamesForTier("all");
    expect(coreNames).not.toContain("browser_navigate");
    expect(allNames).toContain("browser_navigate");
    expect(allNames).toContain("computer_use_screenshot");
  });
});

// ── estimateTokenCost ────────────────────────────────

describe("estimateTokenCost", () => {
  it("returns 0 for an empty list", () => {
    expect(estimateTokenCost([])).toBe(0);
  });

  it("grows monotonically with more tools", () => {
    const one = estimateTokenCost([DEFAULT_TIERED_TOOLS[0]!.tool]);
    const two = estimateTokenCost(DEFAULT_TIERED_TOOLS.slice(0, 2).map((t) => t.tool));
    expect(two).toBeGreaterThan(one);
  });
});

// ── Behaviour invariants across tier transitions ─────

describe("Tier inheritance invariants", () => {
  it("every core tool is also present in standard and all", () => {
    const core = new Set(listToolNamesForTier("core"));
    const std = new Set(listToolNamesForTier("standard"));
    const all = new Set(listToolNamesForTier("all"));
    for (const name of core) {
      expect(std.has(name)).toBe(true);
      expect(all.has(name)).toBe(true);
    }
  });

  it("every standard tool is also present in all", () => {
    const std = new Set(listToolNamesForTier("standard"));
    const all = new Set(listToolNamesForTier("all"));
    for (const name of std) {
      expect(all.has(name)).toBe(true);
    }
  });

  const allTiers: McpTier[] = ["core", "standard", "all"];
  for (const t of allTiers) {
    it(`tier "${t}" — loadTools returns no duplicate names`, () => {
      const result = loadToolsWithOptions({ tier: t });
      const names = result.tools.map((x) => x.name);
      expect(new Set(names).size).toBe(names.length);
    });
  }
});
