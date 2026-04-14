import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  FileDependencyGraph,
  type DependencyGraph,
  type FileDependency,
  type ImpactAnalysis,
} from "../../src/daemon/file-dep-graph.js";

// ── Mock fs/promises ─────────────────────────────────────────

type Dirent = {
  name: string;
  isDirectory: () => boolean;
  isFile: () => boolean;
};

const mockFiles: Map<string, string> = new Map();
const mockDirs: Map<string, Dirent[]> = new Map();

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn(async (dir: string, _opts: unknown): Promise<Dirent[]> => {
    const entries = mockDirs.get(dir);
    if (!entries) {
      throw new Error(`ENOENT: no such directory: ${dir}`);
    }
    return entries;
  }),
  readFile: vi.fn(async (path: string, _encoding: string): Promise<string> => {
    const content = mockFiles.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file: ${path}`);
    }
    return content;
  }),
}));

// ── Helpers ──────────────────────────────────────────────────

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
  };
}

function setupSimpleProject(): void {
  // /project/
  //   index.ts   → imports ./utils and ./lib/helpers
  //   utils.ts   → imports ./lib/helpers
  //   lib/
  //     helpers.ts → no imports

  mockDirs.set("/project", [
    makeDirent("index.ts", false),
    makeDirent("utils.ts", false),
    makeDirent("lib", true),
  ]);

  mockDirs.set("/project/lib", [
    makeDirent("helpers.ts", false),
  ]);

  mockFiles.set(
    "/project/index.ts",
    `import { foo } from "./utils";\nimport { bar } from "./lib/helpers";`,
  );

  mockFiles.set(
    "/project/utils.ts",
    `import { bar } from "./lib/helpers";`,
  );

  mockFiles.set("/project/lib/helpers.ts", `export const bar = 42;`);
}

function setupRequireProject(): void {
  mockDirs.set("/cjs", [
    makeDirent("main.js", false),
    makeDirent("dep.js", false),
  ]);

  mockFiles.set(
    "/cjs/main.js",
    `const dep = require("./dep");`,
  );

  mockFiles.set("/cjs/dep.js", `module.exports = {};`);
}

function setupDynamicImportProject(): void {
  mockDirs.set("/dynamic", [
    makeDirent("entry.ts", false),
    makeDirent("lazy.ts", false),
  ]);

  mockFiles.set(
    "/dynamic/entry.ts",
    `const mod = await import("./lazy");`,
  );

  mockFiles.set("/dynamic/lazy.ts", `export default 1;`);
}

function setupDiamondProject(): void {
  // Diamond: A → B, A → C, B → D, C → D
  mockDirs.set("/diamond", [
    makeDirent("a.ts", false),
    makeDirent("b.ts", false),
    makeDirent("c.ts", false),
    makeDirent("d.ts", false),
  ]);

  mockFiles.set("/diamond/a.ts", `import "./b";\nimport "./c";`);
  mockFiles.set("/diamond/b.ts", `import "./d";`);
  mockFiles.set("/diamond/c.ts", `import "./d";`);
  mockFiles.set("/diamond/d.ts", `export const x = 1;`);
}

// ── Tests ────────────────────────────────────────────────────

describe("FileDependencyGraph", () => {
  let graph: FileDependencyGraph;

  beforeEach(() => {
    graph = new FileDependencyGraph();
    mockFiles.clear();
    mockDirs.clear();
  });

  // ── buildFromDirectory ─────────────────────────────────────

  describe("buildFromDirectory", () => {
    it("builds a graph from a simple project", async () => {
      setupSimpleProject();
      const result = await graph.buildFromDirectory("/project");

      expect(result.fileCount).toBe(3);
      expect(result.edgeCount).toBe(3);
      expect(result.files).toContain("/project/index.ts");
      expect(result.files).toContain("/project/utils.ts");
      expect(result.files).toContain("/project/lib/helpers.ts");
    });

    it("detects import statements", async () => {
      setupSimpleProject();
      const result = await graph.buildFromDirectory("/project");

      const importEdges = result.edges.filter((e) => e.type === "import");
      expect(importEdges.length).toBe(3);
    });

    it("detects require statements", async () => {
      setupRequireProject();
      const result = await graph.buildFromDirectory("/cjs", [".js"]);

      expect(result.edgeCount).toBe(1);
      expect(result.edges[0]!.type).toBe("require");
      expect(result.edges[0]!.source).toBe("/cjs/main.js");
      expect(result.edges[0]!.target).toBe("/cjs/dep.js");
    });

    it("detects dynamic import statements", async () => {
      setupDynamicImportProject();
      const result = await graph.buildFromDirectory("/dynamic");

      expect(result.edgeCount).toBe(1);
      expect(result.edges[0]!.type).toBe("dynamic-import");
    });

    it("skips node_modules directories", async () => {
      mockDirs.set("/skip", [
        makeDirent("index.ts", false),
        makeDirent("node_modules", true),
      ]);
      mockFiles.set("/skip/index.ts", `export const a = 1;`);

      const result = await graph.buildFromDirectory("/skip");
      expect(result.fileCount).toBe(1);
    });

    it("ignores bare/package specifiers", async () => {
      mockDirs.set("/bare", [
        makeDirent("app.ts", false),
      ]);
      mockFiles.set("/bare/app.ts", `import React from "react";\nimport { join } from "node:path";`);

      const result = await graph.buildFromDirectory("/bare");
      expect(result.edgeCount).toBe(0);
    });
  });

  // ── getDirectDependents ────────────────────────────────────

  describe("getDirectDependents", () => {
    it("returns files that directly import a given file", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const dependents = graph.getDirectDependents("/project/lib/helpers.ts");
      expect(dependents).toContain("/project/index.ts");
      expect(dependents).toContain("/project/utils.ts");
      expect(dependents).toHaveLength(2);
    });

    it("returns empty array for a file with no dependents", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const dependents = graph.getDirectDependents("/project/index.ts");
      expect(dependents).toEqual([]);
    });

    it("returns empty array for unknown file", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const dependents = graph.getDirectDependents("/nonexistent.ts");
      expect(dependents).toEqual([]);
    });
  });

  // ── getTransitiveDependents ────────────────────────────────

  describe("getTransitiveDependents", () => {
    it("returns the full transitive closure via BFS", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      // Changing helpers.ts affects utils.ts (direct) and index.ts (transitive via utils + direct)
      const transitive = graph.getTransitiveDependents("/project/lib/helpers.ts");
      expect(transitive).toContain("/project/utils.ts");
      expect(transitive).toContain("/project/index.ts");
      expect(transitive).toHaveLength(2);
    });

    it("handles diamond dependencies without duplicates", async () => {
      setupDiamondProject();
      await graph.buildFromDirectory("/diamond");

      // Changing d.ts: direct dependents = [b, c], transitive includes a
      const transitive = graph.getTransitiveDependents("/diamond/d.ts");
      expect(transitive).toContain("/diamond/b.ts");
      expect(transitive).toContain("/diamond/c.ts");
      expect(transitive).toContain("/diamond/a.ts");
      expect(transitive).toHaveLength(3);
    });

    it("returns empty array for a leaf file (no dependents)", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const transitive = graph.getTransitiveDependents("/project/index.ts");
      expect(transitive).toEqual([]);
    });
  });

  // ── analyzeImpact ──────────────────────────────────────────

  describe("analyzeImpact", () => {
    it("returns a complete impact analysis", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const impact = graph.analyzeImpact("/project/lib/helpers.ts");
      expect(impact.changedFile).toBe("/project/lib/helpers.ts");
      expect(impact.directDependents).toHaveLength(2);
      expect(impact.transitiveDependents).toHaveLength(2);
      expect(impact.totalImpact).toBe(2);
    });

    it("returns zero impact for a file with no dependents", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const impact = graph.analyzeImpact("/project/index.ts");
      expect(impact.totalImpact).toBe(0);
      expect(impact.directDependents).toEqual([]);
      expect(impact.transitiveDependents).toEqual([]);
    });
  });

  // ── getHotspots ────────────────────────────────────────────

  describe("getHotspots", () => {
    it("returns files sorted by import count descending", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const hotspots = graph.getHotspots();
      expect(hotspots.length).toBeGreaterThan(0);
      // helpers.ts is imported by both index.ts and utils.ts (2 importers)
      expect(hotspots[0]!.file).toBe("/project/lib/helpers.ts");
      expect(hotspots[0]!.importedBy).toBe(2);
    });

    it("respects limit parameter", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");

      const hotspots = graph.getHotspots(1);
      expect(hotspots).toHaveLength(1);
    });

    it("returns empty array when nothing is imported", async () => {
      mockDirs.set("/island", [
        makeDirent("a.ts", false),
        makeDirent("b.ts", false),
      ]);
      mockFiles.set("/island/a.ts", `export const a = 1;`);
      mockFiles.set("/island/b.ts", `export const b = 2;`);

      await graph.buildFromDirectory("/island");
      expect(graph.getHotspots()).toEqual([]);
    });
  });

  // ── Rebuild (state reset) ──────────────────────────────────

  describe("rebuild", () => {
    it("clears old state when buildFromDirectory is called again", async () => {
      setupSimpleProject();
      await graph.buildFromDirectory("/project");
      expect(graph.getDirectDependents("/project/lib/helpers.ts")).toHaveLength(2);

      // Setup a different project and rebuild
      mockDirs.clear();
      mockFiles.clear();
      mockDirs.set("/other", [makeDirent("one.ts", false)]);
      mockFiles.set("/other/one.ts", `export const x = 1;`);

      const result = await graph.buildFromDirectory("/other");
      expect(result.fileCount).toBe(1);
      expect(result.edgeCount).toBe(0);
      expect(graph.getDirectDependents("/project/lib/helpers.ts")).toEqual([]);
    });
  });
});
