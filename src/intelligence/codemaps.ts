/**
 * Codemaps Visualization — build dependency graphs from source directories
 * and render them as Mermaid diagrams or SVG.
 *
 * Walks a directory tree, extracts TypeScript/JavaScript imports, exports,
 * class inheritance, and interface implementations to build a graph of
 * CodeNodes and CodeEdges. Supports Mermaid and inline SVG output.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, extname, relative, basename, dirname } from "node:path";

// ── Public Types ──────────────────────────────────────

export type NodeType = "file" | "class" | "function" | "interface";
export type EdgeType = "imports" | "extends" | "implements" | "calls";

export interface CodeNode {
  readonly id: string;
  readonly name: string;
  readonly type: NodeType;
  readonly path: string;
  readonly lineCount: number;
}

export interface CodeEdge {
  readonly from: string;
  readonly to: string;
  readonly type: EdgeType;
}

export interface CodemapResult {
  readonly nodes: readonly CodeNode[];
  readonly edges: readonly CodeEdge[];
}

// ── Constants ─────────────────────────────────────────

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", ".next", "coverage"]);
const MAX_DEPTH = 8;

// ── SVG Constants ─────────────────────────────────────

const SVG_NODE_WIDTH = 180;
const SVG_NODE_HEIGHT = 40;
const SVG_PADDING = 30;
const SVG_ROW_GAP = 80;
const SVG_COL_GAP = 40;
const NODES_PER_ROW = 5;

const NODE_COLORS: Record<NodeType, string> = {
  file: "#4a90d9",
  class: "#d94a4a",
  function: "#4ad97a",
  interface: "#d9a84a",
};

// ── CodemapBuilder ────────────────────────────────────

export class CodemapBuilder {
  private readonly maxDepth: number;

  constructor(maxDepth: number = MAX_DEPTH) {
    this.maxDepth = maxDepth;
  }

  /**
   * Scan a directory and build a full dependency graph.
   */
  async buildFromDirectory(dir: string): Promise<CodemapResult> {
    const files = collectFiles(dir, this.maxDepth);
    const nodes: CodeNode[] = [];
    const edges: CodeEdge[] = [];
    const nodeIds = new Set<string>();

    for (const filePath of files) {
      const relPath = relative(dir, filePath);
      const content = safeReadFile(filePath);
      if (content === null) continue;

      const lineCount = content.split("\n").length;
      const fileId = pathToId(relPath);

      // File node
      nodes.push({
        id: fileId,
        name: basename(relPath),
        type: "file",
        path: relPath,
        lineCount,
      });
      nodeIds.add(fileId);

      // Extract symbols
      const symbols = extractSymbols(content, relPath);
      for (const sym of symbols) {
        nodes.push(sym);
        nodeIds.add(sym.id);
      }

      // Extract edges
      const fileEdges = extractEdges(content, relPath);
      edges.push(...fileEdges);
    }

    // Filter edges to only reference known nodes
    const validEdges = edges.filter(
      (e) => nodeIds.has(e.from) && nodeIds.has(e.to),
    );

    return { nodes, edges: validEdges };
  }

  /**
   * Render the graph as a Mermaid flowchart definition.
   */
  toMermaid(nodes: readonly CodeNode[], edges: readonly CodeEdge[]): string {
    const lines: string[] = ["graph TD"];

    // Node definitions with styling
    for (const node of nodes) {
      const shape = mermaidShape(node.type);
      const label = `${node.name} (${node.lineCount}L)`;
      lines.push(`  ${sanitizeId(node.id)}${shape.open}"${escapeLabel(label)}"${shape.close}`);
    }

    lines.push("");

    // Edge definitions
    for (const edge of edges) {
      const arrow = mermaidArrow(edge.type);
      lines.push(`  ${sanitizeId(edge.from)} ${arrow} ${sanitizeId(edge.to)}`);
    }

    lines.push("");

    // Style classes
    lines.push("  classDef fileNode fill:#4a90d9,stroke:#333,color:#fff");
    lines.push("  classDef classNode fill:#d94a4a,stroke:#333,color:#fff");
    lines.push("  classDef funcNode fill:#4ad97a,stroke:#333,color:#000");
    lines.push("  classDef ifaceNode fill:#d9a84a,stroke:#333,color:#000");

    // Apply classes
    const groups = groupByType(nodes);
    for (const [type, ids] of groups) {
      const className = `${type}Node`;
      lines.push(`  class ${ids.map(sanitizeId).join(",")} ${className}`);
    }

    return lines.join("\n");
  }

  /**
   * Render the graph as an inline SVG string.
   * Uses a simple grid layout — suitable for embedding in HTML or Markdown.
   */
  toSVG(nodes: readonly CodeNode[], edges: readonly CodeEdge[]): string {
    if (nodes.length === 0) {
      return '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="50"><text x="10" y="30">Empty graph</text></svg>';
    }

    // Position nodes in a grid
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, i) => {
      const col = i % NODES_PER_ROW;
      const row = Math.floor(i / NODES_PER_ROW);
      positions.set(node.id, {
        x: SVG_PADDING + col * (SVG_NODE_WIDTH + SVG_COL_GAP),
        y: SVG_PADDING + row * (SVG_NODE_HEIGHT + SVG_ROW_GAP),
      });
    });

    const totalCols = Math.min(nodes.length, NODES_PER_ROW);
    const totalRows = Math.ceil(nodes.length / NODES_PER_ROW);
    const svgWidth = SVG_PADDING * 2 + totalCols * (SVG_NODE_WIDTH + SVG_COL_GAP);
    const svgHeight = SVG_PADDING * 2 + totalRows * (SVG_NODE_HEIGHT + SVG_ROW_GAP);

    const parts: string[] = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`,
      '<defs>',
      '  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">',
      '    <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>',
      '  </marker>',
      '</defs>',
    ];

    // Draw edges first (behind nodes)
    for (const edge of edges) {
      const fromPos = positions.get(edge.from);
      const toPos = positions.get(edge.to);
      if (!fromPos || !toPos) continue;

      const x1 = fromPos.x + SVG_NODE_WIDTH / 2;
      const y1 = fromPos.y + SVG_NODE_HEIGHT;
      const x2 = toPos.x + SVG_NODE_WIDTH / 2;
      const y2 = toPos.y;

      const color = edgeColor(edge.type);
      parts.push(
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5" marker-end="url(#arrowhead)" opacity="0.6"/>`,
      );
    }

    // Draw nodes
    for (const node of nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;

      const fill = NODE_COLORS[node.type];
      const textColor = node.type === "function" || node.type === "interface" ? "#000" : "#fff";
      const displayName = truncateLabel(node.name, 22);

      parts.push(`<g>`);
      parts.push(`  <rect x="${pos.x}" y="${pos.y}" width="${SVG_NODE_WIDTH}" height="${SVG_NODE_HEIGHT}" rx="6" fill="${fill}" stroke="#333" stroke-width="1"/>`);
      parts.push(`  <text x="${pos.x + SVG_NODE_WIDTH / 2}" y="${pos.y + SVG_NODE_HEIGHT / 2 + 4}" text-anchor="middle" fill="${textColor}" font-size="11" font-family="sans-serif">${escapeXml(displayName)}</text>`);
      parts.push(`</g>`);
    }

    parts.push("</svg>");
    return parts.join("\n");
  }
}

// ── File Collection ───────────────────────────────────

function collectFiles(
  dir: string,
  maxDepth: number,
  depth: number = 0,
): string[] {
  if (depth > maxDepth) return [];

  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        results.push(fullPath);
      } else if (entry.isDirectory()) {
        results.push(...collectFiles(fullPath, maxDepth, depth + 1));
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return results;
}

// ── Symbol Extraction ─────────────────────────────────

function extractSymbols(content: string, relPath: string): CodeNode[] {
  const nodes: CodeNode[] = [];
  const fileId = pathToId(relPath);

  // Classes
  const classRe = /(?:export\s+)?class\s+(\w+)/g;
  let match = classRe.exec(content);
  while (match !== null) {
    if (match[1]) {
      nodes.push({
        id: `${fileId}::${match[1]}`,
        name: match[1],
        type: "class",
        path: relPath,
        lineCount: estimateBlockSize(content, match.index),
      });
    }
    match = classRe.exec(content);
  }

  // Interfaces
  const ifaceRe = /(?:export\s+)?interface\s+(\w+)/g;
  match = ifaceRe.exec(content);
  while (match !== null) {
    if (match[1]) {
      nodes.push({
        id: `${fileId}::${match[1]}`,
        name: match[1],
        type: "interface",
        path: relPath,
        lineCount: estimateBlockSize(content, match.index),
      });
    }
    match = ifaceRe.exec(content);
  }

  // Exported functions
  const funcRe = /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g;
  match = funcRe.exec(content);
  while (match !== null) {
    if (match[1]) {
      nodes.push({
        id: `${fileId}::${match[1]}`,
        name: match[1],
        type: "function",
        path: relPath,
        lineCount: estimateBlockSize(content, match.index),
      });
    }
    match = funcRe.exec(content);
  }

  return nodes;
}

// ── Edge Extraction ───────────────────────────────────

function extractEdges(
  content: string,
  relPath: string,
): CodeEdge[] {
  const edges: CodeEdge[] = [];
  const fileId = pathToId(relPath);

  // Import edges
  const importRe = /import\s+(?:\{[^}]*\}\s+from\s+|.*\s+from\s+)['"](\.[^'"]+)['"]/g;
  let match = importRe.exec(content);
  while (match !== null) {
    if (match[1]) {
      const importPath = resolveImportPath(relPath, match[1]);
      const targetId = pathToId(importPath);
      edges.push({ from: fileId, to: targetId, type: "imports" });
    }
    match = importRe.exec(content);
  }

  // Extends edges
  const extendsRe = /class\s+(\w+)\s+extends\s+(\w+)/g;
  match = extendsRe.exec(content);
  while (match !== null) {
    if (match[1] && match[2]) {
      edges.push({
        from: `${fileId}::${match[1]}`,
        to: findSymbolId(match[2], fileId),
        type: "extends",
      });
    }
    match = extendsRe.exec(content);
  }

  // Implements edges
  const implRe = /class\s+(\w+)[^{]*implements\s+([\w,\s]+)/g;
  match = implRe.exec(content);
  while (match !== null) {
    if (match[1] && match[2]) {
      const interfaces = match[2].split(",").map((s) => s.trim());
      for (const iface of interfaces) {
        if (iface) {
          edges.push({
            from: `${fileId}::${match[1]}`,
            to: findSymbolId(iface, fileId),
            type: "implements",
          });
        }
      }
    }
    match = implRe.exec(content);
  }

  return edges;
}

// ── Helpers ───────────────────────────────────────────

function pathToId(relPath: string): string {
  return relPath
    .replace(/\.[tj]sx?$/, "")
    .replace(/\//g, "__")
    .replace(/[^a-zA-Z0-9_]/g, "_");
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "_");
}

function resolveImportPath(fromPath: string, importSpecifier: string): string {
  const dir = dirname(fromPath);
  const resolved = join(dir, importSpecifier).replace(/\.js$/, ".ts");
  // Normalize: strip .ts/.tsx if missing
  if (!resolved.match(/\.[tj]sx?$/)) {
    return `${resolved}.ts`;
  }
  return resolved;
}

function findSymbolId(symbolName: string, currentFileId: string): string {
  // Best-effort: assume same file unless we find it elsewhere
  return `${currentFileId}::${symbolName}`;
}

function estimateBlockSize(content: string, startIndex: number): number {
  let braces = 0;
  let started = false;
  let lines = 0;

  for (let i = startIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") {
      braces++;
      started = true;
    } else if (ch === "}") {
      braces--;
      if (started && braces === 0) break;
    } else if (ch === "\n") {
      lines++;
    }
  }

  return Math.max(1, lines);
}

function safeReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

// ── Mermaid Helpers ───────────────────────────────────

function mermaidShape(type: NodeType): { open: string; close: string } {
  switch (type) {
    case "file": return { open: "[", close: "]" };
    case "class": return { open: "([", close: "])" };
    case "function": return { open: "{{", close: "}}" };
    case "interface": return { open: ">", close: "]" };
  }
}

function mermaidArrow(type: EdgeType): string {
  switch (type) {
    case "imports": return "-->";
    case "extends": return "==>";
    case "implements": return "-.->|impl|";
    case "calls": return "-->|calls|";
  }
}

function escapeLabel(label: string): string {
  return label.replace(/"/g, "'").replace(/[<>]/g, "");
}

function groupByType(
  nodes: readonly CodeNode[],
): ReadonlyMap<NodeType, readonly string[]> {
  const map = new Map<NodeType, string[]>();
  for (const node of nodes) {
    const existing = map.get(node.type) ?? [];
    map.set(node.type, [...existing, node.id]);
  }
  return map;
}

// ── SVG Helpers ───────────────────────────────────────

function edgeColor(type: EdgeType): string {
  switch (type) {
    case "imports": return "#666";
    case "extends": return "#d94a4a";
    case "implements": return "#d9a84a";
    case "calls": return "#4ad97a";
  }
}

function truncateLabel(name: string, maxLen: number): string {
  return name.length > maxLen ? `${name.slice(0, maxLen - 1)}...` : name;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
