import { describe, it, expect } from "vitest";
import { ContextTree, type ContextNode } from "../../src/memory/context-tree.js";
import { join } from "node:path";
import { existsSync } from "node:fs";

describe("Context Tree", () => {
  const makeNode = (
    id: string,
    label: string,
    type: ContextNode["type"] = "file",
    children: readonly ContextNode[] = [],
  ): ContextNode => ({
    id,
    label,
    type,
    children,
    metadata: {},
    lastAccessed: new Date().toISOString(),
  });

  describe("construction and accessors", () => {
    it("creates a tree with a root node", () => {
      const root = makeNode("root-1", "my-project", "project");
      const tree = new ContextTree(root);
      expect(tree.getRoot().label).toBe("my-project");
      expect(tree.getRoot().type).toBe("project");
    });

    it("finds node by ID", () => {
      const child = makeNode("child-1", "src");
      const root = makeNode("root-1", "project", "project", [child]);
      const tree = new ContextTree(root);

      const found = tree.findNode("child-1");
      expect(found).toBeDefined();
      expect(found!.label).toBe("src");
    });

    it("returns undefined for non-existent node", () => {
      const root = makeNode("root-1", "project", "project");
      const tree = new ContextTree(root);

      expect(tree.findNode("missing")).toBeUndefined();
    });
  });

  describe("addNode (immutable)", () => {
    it("adds a child node, returning a new tree", () => {
      const root = makeNode("root-1", "project", "project");
      const tree = new ContextTree(root);

      const newChild = makeNode("child-1", "src", "module");
      const updated = tree.addNode("root-1", newChild);

      // Original tree is unchanged
      expect(tree.getRoot().children).toHaveLength(0);
      // New tree has the child
      expect(updated.getRoot().children).toHaveLength(1);
      expect(updated.getRoot().children[0]!.label).toBe("src");
    });

    it("adds nested children", () => {
      const root = makeNode("root-1", "project", "project");
      const tree = new ContextTree(root);

      const src = makeNode("src-1", "src", "module");
      const tree2 = tree.addNode("root-1", src);

      const file = makeNode("file-1", "index.ts", "file");
      const tree3 = tree2.addNode("src-1", file);

      const found = tree3.findNode("file-1");
      expect(found).toBeDefined();
      expect(found!.label).toBe("index.ts");
    });
  });

  describe("getSubtree", () => {
    it("returns a subtree rooted at the given node", () => {
      const file = makeNode("file-1", "store.ts", "file");
      const src = makeNode("src-1", "src", "module", [file]);
      const root = makeNode("root-1", "project", "project", [src]);
      const tree = new ContextTree(root);

      const subtree = tree.getSubtree("src-1");
      expect(subtree).toBeDefined();
      expect(subtree!.getRoot().label).toBe("src");
      expect(subtree!.getRoot().children).toHaveLength(1);
    });

    it("returns undefined for non-existent node", () => {
      const root = makeNode("root-1", "project", "project");
      const tree = new ContextTree(root);

      expect(tree.getSubtree("nope")).toBeUndefined();
    });
  });

  describe("prune", () => {
    it("removes nodes not accessed since cutoff", () => {
      const oldDate = "2020-01-01T00:00:00.000Z";
      const recentDate = "2026-01-01T00:00:00.000Z";

      const oldFile: ContextNode = {
        ...makeNode("old-1", "old.ts", "file"),
        lastAccessed: oldDate,
      };
      const recentFile: ContextNode = {
        ...makeNode("recent-1", "recent.ts", "file"),
        lastAccessed: recentDate,
      };
      const root: ContextNode = {
        ...makeNode("root-1", "project", "project", [oldFile, recentFile]),
        lastAccessed: recentDate,
      };
      const tree = new ContextTree(root);

      const pruned = tree.prune("2025-01-01T00:00:00.000Z");
      const prunedRoot = pruned.getRoot();

      expect(prunedRoot.children).toHaveLength(1);
      expect(prunedRoot.children[0]!.label).toBe("recent.ts");
    });

    it("keeps parent if any child survives", () => {
      const oldDate = "2020-01-01T00:00:00.000Z";
      const recentDate = "2026-01-01T00:00:00.000Z";

      const recentFile: ContextNode = {
        ...makeNode("recent-1", "index.ts", "file"),
        lastAccessed: recentDate,
      };
      const module: ContextNode = {
        ...makeNode("mod-1", "src", "module", [recentFile]),
        lastAccessed: oldDate,
      };
      const root: ContextNode = {
        ...makeNode("root-1", "project", "project", [module]),
        lastAccessed: recentDate,
      };
      const tree = new ContextTree(root);

      const pruned = tree.prune("2025-01-01T00:00:00.000Z");
      const mod = pruned.findNode("mod-1");
      expect(mod).toBeDefined();
      expect(mod!.children).toHaveLength(1);
    });
  });

  describe("getStats", () => {
    it("computes correct statistics", () => {
      const file1 = makeNode("f1", "a.ts", "file");
      const file2 = makeNode("f2", "b.test.ts", "test");
      const src = makeNode("m1", "src", "module", [file1, file2]);
      const root = makeNode("r1", "project", "project", [src]);
      const tree = new ContextTree(root);

      const stats = tree.getStats();
      expect(stats.totalNodes).toBe(4);
      expect(stats.nodesByType.project).toBe(1);
      expect(stats.nodesByType.module).toBe(1);
      expect(stats.nodesByType.file).toBe(1);
      expect(stats.nodesByType.test).toBe(1);
      expect(stats.maxDepth).toBe(2);
    });
  });

  describe("visualize", () => {
    it("renders an ASCII tree", () => {
      const file = makeNode("f1", "index.ts", "file");
      const src = makeNode("m1", "src", "module", [file]);
      const root = makeNode("r1", "wotann", "project", [src]);
      const tree = new ContextTree(root);

      const viz = tree.visualize();
      expect(viz).toContain("[P] wotann");
      expect(viz).toContain("[M] src");
      expect(viz).toContain("[F] index.ts");
    });

    it("respects maxDepth", () => {
      const file = makeNode("f1", "deep.ts", "file");
      const inner = makeNode("m2", "inner", "module", [file]);
      const src = makeNode("m1", "src", "module", [inner]);
      const root = makeNode("r1", "project", "project", [src]);
      const tree = new ContextTree(root);

      const viz = tree.visualize(1);
      expect(viz).toContain("[P] project");
      expect(viz).toContain("[M] src");
      expect(viz).toContain("... (1 more)");
    });
  });

  describe("JSON serialization", () => {
    it("round-trips through JSON", () => {
      const file = makeNode("f1", "app.ts", "file");
      const root = makeNode("r1", "project", "project", [file]);
      const tree = new ContextTree(root);

      const json = tree.toJSON();
      const restored = ContextTree.fromJSON(json);

      expect(restored.getRoot().label).toBe("project");
      expect(restored.getRoot().children).toHaveLength(1);
      expect(restored.getRoot().children[0]!.label).toBe("app.ts");
    });
  });

  describe("buildFromDirectory", () => {
    it("builds a tree from the wotann project root", () => {
      const projectRoot = join(process.cwd());
      if (!existsSync(join(projectRoot, "package.json"))) {
        // Skip if we're not running from the project root
        return;
      }

      const tree = ContextTree.buildFromDirectory(projectRoot, 2);
      const root = tree.getRoot();
      expect(root.type).toBe("project");
      expect(root.children.length).toBeGreaterThan(0);

      // Should have metadata from package.json
      const stats = tree.getStats();
      expect(stats.totalNodes).toBeGreaterThan(1);
    });
  });
});
