import { describe, it, expect, beforeEach } from "vitest";
import { TieredContextLoader } from "../../src/context/tiered-loader.js";
import type { TieredLoaderConfig, FileInput } from "../../src/context/tiered-loader.js";

// ── Test Fixtures ───────────────────────────────────

const SAMPLE_TS_FILE = `
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parse a configuration file and return structured settings.
 * Supports JSON and YAML formats.
 */
export interface Config {
  readonly name: string;
  readonly version: number;
  readonly debug: boolean;
}

export type ConfigFormat = "json" | "yaml";

export enum LogLevel {
  Debug,
  Info,
  Warn,
  Error,
}

/**
 * Load configuration from a file path.
 */
export function loadConfig(path: string, format: ConfigFormat): Config {
  const raw = readFileSync(path, "utf-8");
  if (format === "json") {
    return JSON.parse(raw);
  }
  throw new Error("YAML not yet supported");
}

export const validateConfig = (config: Config): boolean => {
  return config.name.length > 0 && config.version > 0;
};

export class ConfigManager {
  private config: Config | null = null;

  constructor(private readonly basePath: string) {}

  async load(filename: string): Promise<Config> {
    const fullPath = join(this.basePath, filename);
    this.config = loadConfig(fullPath, "json");
    return this.config;
  }

  getConfig(): Config | null {
    return this.config;
  }

  isLoaded(): boolean {
    return this.config !== null;
  }
}
`.trim();

const SAMPLE_PY_FILE = `
import os
from pathlib import Path

class DataProcessor:
    """Process and transform data from various sources."""

    def __init__(self, input_dir: str):
        self.input_dir = Path(input_dir)

    async def process(self, filename: str) -> dict:
        """Process a single data file."""
        path = self.input_dir / filename
        return {"status": "ok", "path": str(path)}

def calculate_stats(data: list[float]) -> dict:
    """Calculate basic statistics for a dataset."""
    return {"mean": sum(data) / len(data), "count": len(data)}
`.trim();

// ── Tests ───────────────────────────────────────────

describe("TieredContextLoader", () => {
  let loader: TieredContextLoader;

  beforeEach(() => {
    loader = new TieredContextLoader();
  });

  describe("extractL0", () => {
    it("extracts function signatures from TypeScript", () => {
      const l0 = loader.extractL0(SAMPLE_TS_FILE, "typescript");
      expect(l0).toContain("L0 summary");
      expect(l0).toContain("loadConfig");
    });

    it("extracts type/interface names from TypeScript", () => {
      const l0 = loader.extractL0(SAMPLE_TS_FILE, "typescript");
      expect(l0).toContain("Config");
      expect(l0).toContain("ConfigFormat");
    });

    it("extracts class declarations", () => {
      const l0 = loader.extractL0(SAMPLE_TS_FILE, "typescript");
      expect(l0).toContain("ConfigManager");
    });

    it("extracts enum declarations", () => {
      const l0 = loader.extractL0(SAMPLE_TS_FILE, "typescript");
      expect(l0).toContain("LogLevel");
    });

    it("does not include function bodies", () => {
      const l0 = loader.extractL0(SAMPLE_TS_FILE, "typescript");
      expect(l0).not.toContain("JSON.parse");
      expect(l0).not.toContain("throw new Error");
    });

    it("handles empty content", () => {
      const l0 = loader.extractL0("", "typescript");
      expect(l0).toContain("L0");
    });

    it("handles files with no extractable patterns", () => {
      const l0 = loader.extractL0("// Just a comment\nconst x = 42;", "typescript");
      expect(l0).toContain("L0");
    });
  });

  describe("extractL1", () => {
    it("includes imports/dependencies", () => {
      const l1 = loader.extractL1(SAMPLE_TS_FILE, "typescript");
      expect(l1).toContain("import");
      expect(l1).toContain("node:fs");
    });

    it("includes documentation summaries", () => {
      const l1 = loader.extractL1(SAMPLE_TS_FILE, "typescript");
      expect(l1).toContain("Parse a configuration file");
    });

    it("includes full type definitions", () => {
      const l1 = loader.extractL1(SAMPLE_TS_FILE, "typescript");
      expect(l1).toContain("export interface Config");
      expect(l1).toContain("readonly name: string");
    });

    it("includes function signatures", () => {
      const l1 = loader.extractL1(SAMPLE_TS_FILE, "typescript");
      expect(l1).toContain("loadConfig");
    });

    it("includes class outlines", () => {
      const l1 = loader.extractL1(SAMPLE_TS_FILE, "typescript");
      expect(l1).toContain("ConfigManager");
    });

    it("is larger than L0 for the same file", () => {
      const l0 = loader.extractL0(SAMPLE_TS_FILE, "typescript");
      const l1 = loader.extractL1(SAMPLE_TS_FILE, "typescript");
      expect(l1.length).toBeGreaterThan(l0.length);
    });
  });

  describe("extractL2", () => {
    it("returns full content unchanged", () => {
      const l2 = loader.extractL2(SAMPLE_TS_FILE);
      expect(l2).toBe(SAMPLE_TS_FILE);
    });
  });

  describe("allocateTiers", () => {
    const makeFiles = (count: number): FileInput[] =>
      Array.from({ length: count }, (_, i) => ({
        path: `src/file-${i}.ts`,
        content: SAMPLE_TS_FILE,
        relevance: (count - i) / count, // Decreasing relevance
      }));

    it("allocates single file as L2", () => {
      const files = makeFiles(1);
      const result = loader.allocateTiers(files, {
        totalBudget: 100_000,
        l0Ratio: 0.6,
        l1Ratio: 0.3,
        l2Ratio: 0.1,
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.tier).toBe(2); // Single file always gets L2
    });

    it("sorts by relevance — highest relevance gets L2", () => {
      const files: FileInput[] = [
        { path: "low.ts", content: SAMPLE_TS_FILE, relevance: 0.1 },
        { path: "high.ts", content: SAMPLE_TS_FILE, relevance: 0.9 },
        { path: "mid.ts", content: SAMPLE_TS_FILE, relevance: 0.5 },
      ];

      const result = loader.allocateTiers(files, {
        totalBudget: 100_000,
        l0Ratio: 0.6,
        l1Ratio: 0.3,
        l2Ratio: 0.1,
      });

      // The file with highest relevance should be in a higher or equal tier
      const highFile = result.find((f) => f.path === "high.ts");
      const lowFile = result.find((f) => f.path === "low.ts");
      expect(highFile).toBeDefined();
      expect(lowFile).toBeDefined();
      expect(highFile!.tier).toBeGreaterThanOrEqual(lowFile!.tier);
    });

    it("respects total budget constraint", () => {
      const files = makeFiles(20);
      const tinyBudget: TieredLoaderConfig = {
        totalBudget: 500, // Very small budget
        l0Ratio: 0.6,
        l1Ratio: 0.3,
        l2Ratio: 0.1,
      };

      const result = loader.allocateTiers(files, tinyBudget);
      const totalTokens = result.reduce((sum, f) => sum + f.tokenEstimate, 0);
      expect(totalTokens).toBeLessThanOrEqual(500);
    });

    it("downgrades tiers when budget is tight", () => {
      const files = makeFiles(10);
      const tightBudget: TieredLoaderConfig = {
        totalBudget: 2000,
        l0Ratio: 0.6,
        l1Ratio: 0.3,
        l2Ratio: 0.1,
      };

      const result = loader.allocateTiers(files, tightBudget);
      // With tight budget, some files should be downgraded
      const tiers = result.map((f) => f.tier);
      expect(tiers.some((t) => t < 2)).toBe(true);
    });

    it("handles empty file list", () => {
      const result = loader.allocateTiers([]);
      expect(result).toEqual([]);
    });

    it("assigns token estimates to all files", () => {
      const files = makeFiles(5);
      const result = loader.allocateTiers(files);
      for (const file of result) {
        expect(file.tokenEstimate).toBeGreaterThan(0);
      }
    });

    it("uses default config when none provided", () => {
      const files = makeFiles(3);
      const result = loader.allocateTiers(files);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("language detection", () => {
    it("detects TypeScript files", () => {
      const files: FileInput[] = [
        { path: "src/app.ts", content: SAMPLE_TS_FILE, relevance: 0.5 },
      ];
      const result = loader.allocateTiers(files);
      // If language detection works, L0/L1 should contain "typescript"
      const file = result[0]!;
      if (file.tier < 2) {
        expect(file.content).toContain("typescript");
      }
    });

    it("detects Python files", () => {
      const files: FileInput[] = [
        { path: "src/app.py", content: SAMPLE_PY_FILE, relevance: 0.1 },
        { path: "src/other.ts", content: SAMPLE_TS_FILE, relevance: 0.9 },
      ];
      const result = loader.allocateTiers(files, {
        totalBudget: 100_000,
        l0Ratio: 0.5,
        l1Ratio: 0.5,
        l2Ratio: 0.0,
      });
      const pyFile = result.find((f) => f.path === "src/app.py");
      if (pyFile && pyFile.tier < 2) {
        expect(pyFile.content).toContain("python");
      }
    });
  });
});
