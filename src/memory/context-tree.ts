/**
 * Hierarchical context tree for project understanding.
 * Inspired by ByteRover (96% accuracy) — tree-structured knowledge
 * representation that auto-builds from file system.
 *
 * Tree types: project (root), module, file, function, class, test
 *
 * Provides:
 * - Hierarchical navigation of project structure
 * - ASCII visualization for TUI display
 * - Serialization for persistence
 * - Pruning for context window management
 */

import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, basename, extname, relative } from "node:path";

// ── Types ──────────────────────────────────────────────

export type ContextNodeType =
  | "project"
  | "module"
  | "file"
  | "function"
  | "class"
  | "test";

export interface ContextNode {
  readonly id: string;
  readonly label: string;
  readonly type: ContextNodeType;
  readonly children: readonly ContextNode[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly lastAccessed: string;
}

export interface ContextTreeStats {
  readonly totalNodes: number;
  readonly maxDepth: number;
  readonly nodesByType: Readonly<Record<ContextNodeType, number>>;
}

// ── Helpers ────────────────────────────────────────────

let nodeCounter = 0;

function generateNodeId(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}-${nodeCounter}`;
}

function inferNodeType(name: string, isDir: boolean): ContextNodeType {
  if (isDir) {
    if (name === "node_modules" || name === ".git" || name === "dist") {
      return "module";
    }
    return "module";
  }

  const ext = extname(name).toLowerCase();
  if (name.includes(".test.") || name.includes(".spec.") || name.startsWith("test")) {
    return "test";
  }

  const codeExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".rb", ".php",
  ]);
  if (codeExtensions.has(ext)) {
    return "file";
  }

  return "file";
}

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "coverage", ".turbo", ".cache", "__pycache__",
  ".svelte-kit", ".nuxt", ".output",
]);

const SKIP_FILES = new Set([
  ".DS_Store", "thumbs.db", ".gitkeep",
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
]);

// ── Context Tree ──────────────────────────────────────

export class ContextTree {
  private root: ContextNode;

  constructor(root: ContextNode) {
    this.root = root;
  }

  /**
   * Get the root node of the tree.
   */
  getRoot(): ContextNode {
    return this.root;
  }

  /**
   * Add a node as a child of the node with the given parentId.
   * Returns a new ContextTree (immutable).
   */
  addNode(parentId: string, node: ContextNode): ContextTree {
    const updatedRoot = addNodeToSubtree(this.root, parentId, node);
    return new ContextTree(updatedRoot);
  }

  /**
   * Find a node by ID in the tree.
   */
  findNode(nodeId: string): ContextNode | undefined {
    return findNodeInSubtree(this.root, nodeId);
  }

  /**
   * Get a subtree rooted at the node with the given ID.
   */
  getSubtree(nodeId: string): ContextTree | undefined {
    const node = this.findNode(nodeId);
    return node ? new ContextTree(node) : undefined;
  }

  /**
   * Prune the tree: remove nodes not accessed since the given cutoff date.
   * Returns a new ContextTree.
   */
  prune(cutoffDate: string): ContextTree {
    const pruned = pruneSubtree(this.root, cutoffDate);
    return pruned ? new ContextTree(pruned) : new ContextTree({
      ...this.root,
      children: [],
    });
  }

  /**
   * Compute statistics about the tree.
   */
  getStats(): ContextTreeStats {
    const counts: Record<ContextNodeType, number> = {
      project: 0,
      module: 0,
      file: 0,
      function: 0,
      class: 0,
      test: 0,
    };
    let maxDepth = 0;

    function walk(node: ContextNode, depth: number): number {
      counts[node.type] = (counts[node.type] ?? 0) + 1;
      let totalNodes = 1;
      for (const child of node.children) {
        totalNodes += walk(child, depth + 1);
      }
      if (depth > maxDepth) {
        maxDepth = depth;
      }
      return totalNodes;
    }

    const totalNodes = walk(this.root, 0);
    return { totalNodes, maxDepth, nodesByType: counts };
  }

  /**
   * Render an ASCII tree string for TUI display.
   */
  visualize(maxDepth: number = Infinity): string {
    const lines: string[] = [];
    renderNode(this.root, "", true, lines, 0, maxDepth);
    return lines.join("\n");
  }

  /**
   * Serialize the tree to a JSON string.
   */
  toJSON(): string {
    return JSON.stringify(this.root);
  }

  /**
   * Deserialize a tree from a JSON string.
   */
  static fromJSON(json: string): ContextTree {
    const root = JSON.parse(json) as ContextNode;
    return new ContextTree(root);
  }

  /**
   * Build a context tree from a directory on disk.
   * Reads file system structure + package.json + tsconfig.json for metadata.
   */
  static buildFromDirectory(rootDir: string, maxDepth: number = 6): ContextTree {
    nodeCounter = 0;
    const projectName = basename(rootDir);
    const metadata: Record<string, string> = {};

    // Read package.json if present
    const pkgPath = join(rootDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
        if (typeof pkg["name"] === "string") metadata["packageName"] = pkg["name"];
        if (typeof pkg["version"] === "string") metadata["version"] = pkg["version"];
        if (typeof pkg["description"] === "string") metadata["description"] = pkg["description"];
      } catch {
        // Non-critical — skip
      }
    }

    // Read tsconfig.json if present
    const tsconfigPath = join(rootDir, "tsconfig.json");
    if (existsSync(tsconfigPath)) {
      metadata["typescript"] = "true";
      try {
        const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf-8")) as Record<string, unknown>;
        const opts = tsconfig["compilerOptions"] as Record<string, unknown> | undefined;
        if (opts && typeof opts["strict"] === "boolean") {
          metadata["strictMode"] = String(opts["strict"]);
        }
      } catch {
        // Non-critical — skip
      }
    }

    const rootNode: ContextNode = {
      id: generateNodeId("project"),
      label: projectName,
      type: "project",
      children: scanDirectory(rootDir, rootDir, 1, maxDepth),
      metadata,
      lastAccessed: new Date().toISOString(),
    };

    return new ContextTree(rootNode);
  }
}

// ── Tree Manipulation Helpers ─────────────────────────

function addNodeToSubtree(
  node: ContextNode,
  parentId: string,
  newChild: ContextNode,
): ContextNode {
  if (node.id === parentId) {
    return { ...node, children: [...node.children, newChild] };
  }

  const updatedChildren = node.children.map((child) =>
    addNodeToSubtree(child, parentId, newChild),
  );

  return { ...node, children: updatedChildren };
}

function findNodeInSubtree(node: ContextNode, nodeId: string): ContextNode | undefined {
  if (node.id === nodeId) return node;
  for (const child of node.children) {
    const found = findNodeInSubtree(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

function pruneSubtree(node: ContextNode, cutoffDate: string): ContextNode | null {
  // Keep the node if it was accessed after the cutoff
  const keep = node.lastAccessed >= cutoffDate;

  const keptChildren: ContextNode[] = [];
  for (const child of node.children) {
    const pruned = pruneSubtree(child, cutoffDate);
    if (pruned) keptChildren.push(pruned);
  }

  // Keep the node if it or any of its children survive
  if (keep || keptChildren.length > 0) {
    return { ...node, children: keptChildren };
  }

  return null;
}

// ── Visualization ─────────────────────────────────────

const TYPE_ICONS: Readonly<Record<ContextNodeType, string>> = {
  project: "[P]",
  module: "[M]",
  file: "[F]",
  function: "[f]",
  class: "[C]",
  test: "[T]",
};

function renderNode(
  node: ContextNode,
  prefix: string,
  isLast: boolean,
  lines: string[],
  depth: number,
  maxDepth: number,
): void {
  const connector = depth === 0 ? "" : isLast ? "└── " : "├── ";
  const icon = TYPE_ICONS[node.type] ?? "[?]";
  lines.push(`${prefix}${connector}${icon} ${node.label}`);

  if (depth >= maxDepth) {
    if (node.children.length > 0) {
      const childPrefix = depth === 0 ? "" : prefix + (isLast ? "    " : "│   ");
      lines.push(`${childPrefix}    ... (${node.children.length} more)`);
    }
    return;
  }

  const childPrefix = depth === 0 ? "" : prefix + (isLast ? "    " : "│   ");
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i]!;
    const childIsLast = i === node.children.length - 1;
    renderNode(child, childPrefix, childIsLast, lines, depth + 1, maxDepth);
  }
}

// ── Directory Scanner ─────────────────────────────────

function scanDirectory(
  dirPath: string,
  rootDir: string,
  depth: number,
  maxDepth: number,
): readonly ContextNode[] {
  if (depth > maxDepth) return [];

  let entries: readonly string[];
  try {
    entries = readdirSync(dirPath);
  } catch {
    return [];
  }

  const nodes: ContextNode[] = [];
  const now = new Date().toISOString();

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry) || entry.startsWith(".")) {
      continue;
    }

    const fullPath = join(dirPath, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    const isDir = stat.isDirectory();
    const nodeType = inferNodeType(entry, isDir);
    const relPath = relative(rootDir, fullPath);

    const metadata: Record<string, string> = {
      path: relPath,
    };

    if (!isDir) {
      metadata["size"] = String(stat.size);
      metadata["ext"] = extname(entry);
    }

    const children = isDir
      ? scanDirectory(fullPath, rootDir, depth + 1, maxDepth)
      : [];

    nodes.push({
      id: generateNodeId(nodeType),
      label: entry,
      type: nodeType,
      children,
      metadata,
      lastAccessed: now,
    });
  }

  return nodes;
}
