/**
 * KG-First-Stage Builder — Blitzy port (Phase 2 P1-C3).
 *
 * Blitzy (66.5% SWE-bench Pro) front-loads a knowledge-graph build
 * before any codebase-modification task. The agent queries the KG as a
 * retrieval source alongside normal grep. This module ports that
 * first-stage approach: walk a workspace, extract symbols, build a
 * call/type graph, persist into MemoryStore's knowledge_nodes /
 * knowledge_edges tables, support incremental per-file updates, and
 * expose query helpers (findCallers, findUsages, findDefinition).
 *
 * Design:
 *
 * 1. Symbol extraction is pluggable. We try to dynamic-import the
 *    TypeScript compiler API (if available — it's a devDep of this
 *    repo). If the import fails in a published distribution that strips
 *    devDeps, we fall back to a conservative regex extractor. This is
 *    "honest failures" (Session 2 bar #6): the fallback is declared,
 *    not silent.
 *
 * 2. Builder state is per-workspace (Session 3 bar #11). Each
 *    `new KGBuilder(store, workspaceRoot, opts)` carries its own
 *    include/exclude/parser settings. Two builders over two roots do
 *    not share mutable state.
 *
 * 3. Persistence is delegated to MemoryStore. We populate
 *    knowledge_nodes with entity_type in {"code_symbol", "code_module"}
 *    and a properties JSON payload { kind, filePath, line, exported }.
 *    Edges use relation in {"calls", "uses_type", "imports",
 *    "defined_in"}. Those are additional to P1-M7's
 *    updates/extends/derives human-memory edges; the kinds namespace
 *    does not clash because code relations live alongside in the same
 *    knowledge_edges table and are filtered by relation-string.
 *
 * 4. Incremental update (`updateFile`) re-parses a single file and
 *    rewrites only that file's nodes + edges, so watcher-based
 *    pipelines stay linear-time in changed-file count.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative, extname, resolve } from "node:path";

import type { MemoryStore } from "../memory/store.js";

// ── Types ──────────────────────────────────────────────

/** High-level kind of a code symbol we persist. */
export type CodeSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "method"
  | "unknown";

export interface ExtractedSymbol {
  /** Display name ("MyClass", "renderPrompt"). Unique within a file+kind. */
  readonly name: string;
  readonly kind: CodeSymbolKind;
  /** 1-based line number in the source file where the symbol is defined. */
  readonly line?: number;
  /** True when the symbol is `export`ed. */
  readonly exported: boolean;
}

export interface ExtractedImport {
  /** Source specifier verbatim ("./foo", "node:path"). */
  readonly specifier: string;
  /** Named imports (empty when it's a side-effect-only import). */
  readonly named: readonly string[];
}

export interface ExtractedCall {
  /** Callee name (identifier text at the call site). */
  readonly callee: string;
  /** Name of the enclosing function/method when resolvable; "module" at top level. */
  readonly enclosing: string;
  readonly line?: number;
}

export interface ExtractedTypeRef {
  /** Referenced type name (e.g. "SessionConfig", "Foo"). */
  readonly typeName: string;
  /** Name of the enclosing declaration using the type. */
  readonly enclosing: string;
  readonly line?: number;
}

export interface FileExtraction {
  readonly filePath: string;
  readonly symbols: readonly ExtractedSymbol[];
  readonly imports: readonly ExtractedImport[];
  readonly calls: readonly ExtractedCall[];
  readonly typeRefs: readonly ExtractedTypeRef[];
  /** Set when parsing failed. Other fields are still present but may be empty. */
  readonly parseError?: string;
  /** Which extractor produced this result. */
  readonly source: "ts-compiler" | "regex";
}

export interface BuildOptions {
  /** Glob-style includes. Default: common TS/JS sources. */
  readonly includePatterns?: readonly string[];
  /** Glob-style excludes. Default: node_modules/dist/build. */
  readonly excludePatterns?: readonly string[];
  /** Max files to process. Hard stop to avoid runaway walks. */
  readonly maxFiles?: number;
  /** Called for each file after extraction (useful for progress UIs). */
  readonly onFile?: (relPath: string, extraction: FileExtraction) => void;
  /** When set, forces the regex fallback (useful for tests). */
  readonly forceRegex?: boolean;
}

export interface BuildSummary {
  readonly filesVisited: number;
  readonly filesProcessed: number;
  readonly symbolsInserted: number;
  readonly edgesInserted: number;
  readonly parseErrors: readonly { path: string; error: string }[];
  readonly extractorUsed: "ts-compiler" | "regex" | "mixed";
}

/** Relation strings emitted by this builder into knowledge_edges.relation. */
export const KG_EDGE_RELATIONS = {
  calls: "code:calls",
  usesType: "code:uses_type",
  imports: "code:imports",
  definedIn: "code:defined_in",
} as const;

export const KG_NODE_TYPES = {
  symbol: "code_symbol",
  module: "code_module",
} as const;

// ── Patterns ───────────────────────────────────────────

const DEFAULT_INCLUDES: readonly string[] = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"];

const DEFAULT_EXCLUDES: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.git/**",
  "**/coverage/**",
  "**/.wotann/**",
  "**/*.d.ts",
];

const DEFAULT_MAX_FILES = 5000;

// ── Glob helpers ──────────────────────────────────────
// Tiny, predictable glob→regex. Not a full-blown micromatch; enough for
// the patterns above.

function globToRegex(pattern: string): RegExp {
  let out = "";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 2;
        if (pattern[i] === "/") i++;
      } else {
        out += "[^/]*";
        i++;
      }
    } else if (ch === "?") {
      out += "[^/]";
      i++;
    } else if (ch === ".") {
      out += "\\.";
      i++;
    } else if ("+^$(){}|\\".includes(ch)) {
      out += "\\" + ch;
      i++;
    } else {
      out += ch;
      i++;
    }
  }
  return new RegExp("^" + out + "$");
}

function matchesAny(relPath: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (globToRegex(p).test(relPath)) return true;
  }
  return false;
}

// ── Walker ────────────────────────────────────────────

async function walkWorkspace(
  rootDir: string,
  includePatterns: readonly string[],
  excludePatterns: readonly string[],
  maxFiles: number,
): Promise<readonly string[]> {
  const root = resolve(rootDir);
  const result: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    if (result.length >= maxFiles) break;
    const dir = queue.shift()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split("\\").join("/");
      if (matchesAny(rel, excludePatterns)) continue;
      if (entry.isDirectory()) {
        queue.push(abs);
      } else if (entry.isFile()) {
        if (matchesAny(rel, includePatterns)) {
          result.push(abs);
          if (result.length >= maxFiles) break;
        }
      }
    }
  }
  return result;
}

// ── Extractor: regex fallback ─────────────────────────

// JavaScript reserved words + common built-ins we should not treat as callees.
const RESERVED_WORDS = new Set<string>([
  "if",
  "else",
  "for",
  "while",
  "do",
  "switch",
  "case",
  "break",
  "continue",
  "return",
  "throw",
  "try",
  "catch",
  "finally",
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "const",
  "let",
  "var",
  "import",
  "export",
  "from",
  "as",
  "default",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "in",
  "of",
  "void",
  "true",
  "false",
  "null",
  "undefined",
  "this",
  "super",
  "async",
  "await",
  "yield",
  "static",
  "public",
  "private",
  "protected",
  "readonly",
  "declare",
  "module",
  "namespace",
  "with",
]);

/**
 * Conservative regex symbol/call/import extractor. Purposely narrower
 * than the TS compiler API — only picks up obvious patterns. Accepts
 * some false negatives to avoid false positives.
 */
export function extractFromSourceRegex(filePath: string, source: string): FileExtraction {
  const symbols: ExtractedSymbol[] = [];
  const imports: ExtractedImport[] = [];
  const calls: ExtractedCall[] = [];
  const typeRefs: ExtractedTypeRef[] = [];

  const lines = source.split(/\r?\n/);

  // Imports — handles `import { A, B as C } from "..."`, `import * as ns from "..."`,
  // `import D from "..."`, `import "..."`.
  const importRe =
    /^\s*import\s+(?:(?:(?<def>[A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{(?<named>[^}]*)\}|\*\s+as\s+(?<ns>[A-Za-z_$][\w$]*))?)?\s*(?:from\s*)?["'](?<spec>[^"']+)["']/;
  for (const line of lines) {
    const m = importRe.exec(line);
    if (!m || !m.groups) continue;
    const named: string[] = [];
    if (m.groups["def"]) named.push(m.groups["def"]);
    if (m.groups["ns"]) named.push(m.groups["ns"]);
    if (m.groups["named"]) {
      for (const chunk of m.groups["named"].split(",")) {
        const nm = chunk.replace(/\s+as\s+[A-Za-z_$][\w$]*/, "").trim();
        if (nm.length > 0) named.push(nm);
      }
    }
    imports.push({ specifier: m.groups["spec"]!, named });
  }

  // Symbols
  const symRe =
    /^(?<indent>\s*)(?<exp>export\s+(?:default\s+)?)?(?<async>async\s+)?(?<kind>function|class|interface|type|enum|const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)/;
  const methodRe = /^(?<indent>\s+)(?<async>async\s+)?(?<name>[A-Za-z_$][\w$]*)\s*\(/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(?:\*|\/\/|\*\/)/.test(line)) continue;
    const m = symRe.exec(line);
    if (m && m.groups) {
      const kindRaw = m.groups["kind"]!;
      const kind: CodeSymbolKind =
        kindRaw === "function"
          ? "function"
          : kindRaw === "class"
            ? "class"
            : kindRaw === "interface"
              ? "interface"
              : kindRaw === "type"
                ? "type"
                : kindRaw === "enum"
                  ? "enum"
                  : "variable";
      symbols.push({
        name: m.groups["name"]!,
        kind,
        line: i + 1,
        exported: Boolean(m.groups["exp"]),
      });
      continue;
    }
    const mm = methodRe.exec(line);
    if (mm && mm.groups && mm.groups["indent"]!.length > 0) {
      const name = mm.groups["name"]!;
      if (RESERVED_WORDS.has(name)) continue;
      symbols.push({ name, kind: "method", line: i + 1, exported: false });
    }
  }

  // Calls — `foo(` where foo is not a keyword. Attribute calls to the
  // nearest preceding symbol as "enclosing".
  const callRe = /(?<![\w$.])(?<callee>[A-Za-z_$][\w$]*)\s*\(/g;
  let currentEnclosing = "module";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sym = symRe.exec(line);
    if (sym && sym.groups) {
      currentEnclosing = sym.groups["name"]!;
    }
    if (/^\s*(?:\*|\/\/|\*\/)/.test(line)) continue;
    let m: RegExpExecArray | null;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(line)) !== null) {
      const callee = m.groups?.["callee"] ?? "";
      if (!callee) continue;
      if (RESERVED_WORDS.has(callee)) continue;
      calls.push({ callee, enclosing: currentEnclosing, line: i + 1 });
    }
  }

  // Type references — `: TypeName` and `<TypeName>` after identifiers.
  const typeAnnRe = /(?<![\w$]):\s*(?<t>[A-Z][A-Za-z_$0-9]*)/g;
  const typeArgRe = /<(?<t>[A-Z][A-Za-z_$0-9]*)(?:[<>,\s][^>]*)?>/g;
  let enclosing = "module";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const sym = symRe.exec(line);
    if (sym && sym.groups) enclosing = sym.groups["name"]!;
    let m: RegExpExecArray | null;
    typeAnnRe.lastIndex = 0;
    while ((m = typeAnnRe.exec(line)) !== null) {
      const t = m.groups?.["t"];
      if (!t) continue;
      typeRefs.push({ typeName: t, enclosing, line: i + 1 });
    }
    typeArgRe.lastIndex = 0;
    while ((m = typeArgRe.exec(line)) !== null) {
      const t = m.groups?.["t"];
      if (!t) continue;
      typeRefs.push({ typeName: t, enclosing, line: i + 1 });
    }
  }

  return { filePath, symbols, imports, calls, typeRefs, source: "regex" };
}

// ── Extractor: TypeScript compiler API ────────────────

interface TsApi {
  readonly createSourceFile: (
    fileName: string,
    sourceText: string,
    target: number,
    setParentNodes: boolean,
    scriptKind: number,
  ) => TsSourceFile;
  readonly ScriptTarget: { readonly Latest: number };
  readonly ScriptKind: {
    readonly TS: number;
    readonly TSX: number;
    readonly JS: number;
    readonly JSX: number;
  };
  readonly SyntaxKind: Record<string, number>;
  readonly forEachChild: (node: TsNode, cb: (n: TsNode) => void) => void;
  readonly isClassDeclaration: (n: TsNode) => boolean;
  readonly isFunctionDeclaration: (n: TsNode) => boolean;
  readonly isInterfaceDeclaration: (n: TsNode) => boolean;
  readonly isTypeAliasDeclaration: (n: TsNode) => boolean;
  readonly isEnumDeclaration: (n: TsNode) => boolean;
  readonly isVariableStatement: (n: TsNode) => boolean;
  readonly isMethodDeclaration: (n: TsNode) => boolean;
  readonly isCallExpression: (n: TsNode) => boolean;
  readonly isImportDeclaration: (n: TsNode) => boolean;
  readonly isTypeReferenceNode: (n: TsNode) => boolean;
  readonly isIdentifier: (n: TsNode) => boolean;
  readonly isStringLiteral: (n: TsNode) => boolean;
  readonly isPropertyAccessExpression: (n: TsNode) => boolean;
}

interface TsNode {
  readonly kind: number;
  readonly pos: number;
  readonly end: number;
  readonly parent?: TsNode;
  readonly [k: string]: unknown;
}

interface TsSourceFile extends TsNode {
  readonly fileName: string;
  readonly text: string;
  getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
}

let cachedTsApi: TsApi | null | undefined;

async function loadTsApi(): Promise<TsApi | null> {
  if (cachedTsApi !== undefined) return cachedTsApi;
  try {
    const mod = (await import("typescript")) as unknown as { default?: TsApi } & TsApi;
    const api: TsApi = mod.default ?? mod;
    if (typeof api.createSourceFile !== "function") {
      cachedTsApi = null;
      return null;
    }
    cachedTsApi = api;
    return api;
  } catch {
    cachedTsApi = null;
    return null;
  }
}

/** Visible for tests — lets a test force a "no TS api" state. */
export function _resetTsApiCacheForTests(): void {
  cachedTsApi = undefined;
}

function getScriptKindFor(ts: TsApi, filePath: string): number {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if (ext === ".js") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function extractFromSourceTs(ts: TsApi, filePath: string, source: string): FileExtraction {
  const symbols: ExtractedSymbol[] = [];
  const imports: ExtractedImport[] = [];
  const calls: ExtractedCall[] = [];
  const typeRefs: ExtractedTypeRef[] = [];

  const sf = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKindFor(ts, filePath),
  );

  const lineOf = (n: TsNode): number => {
    try {
      return sf.getLineAndCharacterOfPosition(n.pos).line + 1;
    } catch {
      return 1;
    }
  };

  const visitTop = (node: TsNode): void => {
    if (ts.isImportDeclaration(node)) {
      const mod = node["moduleSpecifier"] as TsNode | undefined;
      const spec = mod && ts.isStringLiteral(mod) ? ((mod["text"] as string) ?? "") : "";
      const clause = node["importClause"] as TsNode | undefined;
      const named: string[] = [];
      if (clause) {
        const defName = clause["name"] as TsNode | undefined;
        if (defName && ts.isIdentifier(defName)) {
          named.push((defName["escapedText"] as string) ?? (defName["text"] as string) ?? "");
        }
        const nb = clause["namedBindings"] as TsNode | undefined;
        if (nb) {
          const elements = nb["elements"] as TsNode[] | undefined;
          if (Array.isArray(elements)) {
            for (const el of elements) {
              const nameNode = el["name"] as TsNode | undefined;
              if (nameNode && ts.isIdentifier(nameNode)) {
                const n = (nameNode["escapedText"] as string) ?? (nameNode["text"] as string) ?? "";
                if (n) named.push(n);
              }
            }
          }
          const ns = nb["name"] as TsNode | undefined;
          if (ns && ts.isIdentifier(ns)) {
            const n = (ns["escapedText"] as string) ?? (ns["text"] as string) ?? "";
            if (n) named.push(n);
          }
        }
      }
      imports.push({ specifier: spec, named });
    }
    ts.forEachChild(node, visitTop);
  };
  ts.forEachChild(sf, visitTop);

  const isExported = (node: TsNode): boolean => {
    const mods = node["modifiers"] as TsNode[] | undefined;
    if (!Array.isArray(mods)) return false;
    for (const m of mods) {
      const name = Object.keys(ts.SyntaxKind).find((k) => ts.SyntaxKind[k] === m.kind);
      if (name === "ExportKeyword") return true;
    }
    return false;
  };

  const nameOf = (node: TsNode): string | undefined => {
    const n = node["name"] as TsNode | undefined;
    if (!n) return undefined;
    if (ts.isIdentifier(n)) {
      return ((n["escapedText"] as string) ?? (n["text"] as string)) as string;
    }
    return undefined;
  };

  const visitDecl = (node: TsNode): void => {
    if (ts.isClassDeclaration(node)) {
      const nm = nameOf(node);
      if (nm)
        symbols.push({ name: nm, kind: "class", line: lineOf(node), exported: isExported(node) });
    } else if (ts.isFunctionDeclaration(node)) {
      const nm = nameOf(node);
      if (nm)
        symbols.push({
          name: nm,
          kind: "function",
          line: lineOf(node),
          exported: isExported(node),
        });
    } else if (ts.isInterfaceDeclaration(node)) {
      const nm = nameOf(node);
      if (nm)
        symbols.push({
          name: nm,
          kind: "interface",
          line: lineOf(node),
          exported: isExported(node),
        });
    } else if (ts.isTypeAliasDeclaration(node)) {
      const nm = nameOf(node);
      if (nm)
        symbols.push({ name: nm, kind: "type", line: lineOf(node), exported: isExported(node) });
    } else if (ts.isEnumDeclaration(node)) {
      const nm = nameOf(node);
      if (nm)
        symbols.push({ name: nm, kind: "enum", line: lineOf(node), exported: isExported(node) });
    } else if (ts.isVariableStatement(node)) {
      const decList = node["declarationList"] as TsNode | undefined;
      const decls = (decList?.["declarations"] as TsNode[] | undefined) ?? [];
      const exp = isExported(node);
      for (const d of decls) {
        const n = d["name"] as TsNode | undefined;
        if (n && ts.isIdentifier(n)) {
          const nm = ((n["escapedText"] as string) ?? (n["text"] as string)) || "";
          if (nm) symbols.push({ name: nm, kind: "variable", line: lineOf(d), exported: exp });
        }
      }
    } else if (ts.isMethodDeclaration(node)) {
      const n = node["name"] as TsNode | undefined;
      if (n && ts.isIdentifier(n)) {
        const nm = ((n["escapedText"] as string) ?? (n["text"] as string)) || "";
        if (nm) symbols.push({ name: nm, kind: "method", line: lineOf(node), exported: false });
      }
    }
    ts.forEachChild(node, visitDecl);
  };
  ts.forEachChild(sf, visitDecl);

  const walk = (node: TsNode, enclosing: string): void => {
    let nextEnclosing = enclosing;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) {
      const nm = nameOf(node);
      if (nm) nextEnclosing = nm;
    }
    if (ts.isCallExpression(node)) {
      const expr = node["expression"] as TsNode | undefined;
      let callee = "";
      if (expr) {
        if (ts.isIdentifier(expr)) {
          callee = ((expr["escapedText"] as string) ?? (expr["text"] as string)) || "";
        } else if (ts.isPropertyAccessExpression(expr)) {
          const nm = expr["name"] as TsNode | undefined;
          if (nm && ts.isIdentifier(nm)) {
            callee = ((nm["escapedText"] as string) ?? (nm["text"] as string)) || "";
          }
        }
      }
      if (callee && !RESERVED_WORDS.has(callee)) {
        calls.push({ callee, enclosing: nextEnclosing, line: lineOf(node) });
      }
    }
    if (ts.isTypeReferenceNode(node)) {
      const tn = node["typeName"] as TsNode | undefined;
      if (tn && ts.isIdentifier(tn)) {
        const t = ((tn["escapedText"] as string) ?? (tn["text"] as string)) || "";
        if (t) typeRefs.push({ typeName: t, enclosing: nextEnclosing, line: lineOf(node) });
      }
    }
    ts.forEachChild(node, (child) => walk(child, nextEnclosing));
  };
  ts.forEachChild(sf, (child) => walk(child, "module"));

  return { filePath, symbols, imports, calls, typeRefs, source: "ts-compiler" };
}

// ── Persistence ───────────────────────────────────────

interface PerFileInventory {
  readonly symbolIdsByName: ReadonlyMap<string, string>;
  /** Full symbol records, keyed by name — for query APIs that want line/kind. */
  readonly symbolsByName: ReadonlyMap<string, ExtractedSymbol>;
  /** Call sites observed in this file (callee may resolve to another file). */
  readonly callSites: readonly ExtractedCall[];
  /** Type references observed in this file. */
  readonly typeReferences: readonly ExtractedTypeRef[];
  readonly moduleNodeId: string;
  readonly edgeIds: readonly string[];
}

/**
 * Light wrapper over MemoryStore that lets the builder track which
 * nodes/edges it created, so incremental `updateFile` can deterministically
 * wipe + repopulate file-scoped state.
 */
class KgPersistence {
  private readonly fileState: Map<string, PerFileInventory> = new Map();

  constructor(private readonly store: MemoryStore) {}

  persistFile(
    workspaceRoot: string,
    extraction: FileExtraction,
  ): {
    readonly inserted: number;
    readonly edges: number;
    readonly moduleNodeId: string;
  } {
    const relPath = relative(workspaceRoot, extraction.filePath).split("\\").join("/");

    const prior = this.fileState.get(relPath);
    if (prior) {
      for (const eid of prior.edgeIds) {
        this.store.invalidateKnowledgeEdge(eid);
      }
    }

    const moduleName = relPath;
    const existingModuleId = prior?.moduleNodeId;
    const moduleNodeId =
      existingModuleId ??
      this.store.addKnowledgeNode(moduleName, KG_NODE_TYPES.module, {
        path: relPath,
      });

    const symbolIdsByName = new Map<string, string>();
    const symbolsByName = new Map<string, ExtractedSymbol>();
    let inserted = 0;
    let edges = 0;
    const edgeIdsCollector: string[] = [];

    for (const sym of extraction.symbols) {
      const nodeName = `${relPath}#${sym.name}`;
      const nodeId = this.store.addKnowledgeNode(nodeName, KG_NODE_TYPES.symbol, {
        kind: sym.kind,
        filePath: relPath,
        line: sym.line !== undefined ? String(sym.line) : "",
        exported: sym.exported ? "true" : "false",
        displayName: sym.name,
      });
      symbolIdsByName.set(sym.name, nodeId);
      symbolsByName.set(sym.name, sym);
      inserted++;
      const defEdgeId = this.store.addKnowledgeEdge(
        nodeId,
        moduleNodeId,
        KG_EDGE_RELATIONS.definedIn,
      );
      edges++;
      edgeIdsCollector.push(defEdgeId);
    }

    for (const imp of extraction.imports) {
      const edgeId = this.store.addKnowledgeEdge(
        moduleNodeId,
        moduleNodeId,
        KG_EDGE_RELATIONS.imports,
      );
      edgeIdsCollector.push(edgeId);
      edges++;
      void imp;
    }

    for (const call of extraction.calls) {
      const callerId = symbolIdsByName.get(call.enclosing) ?? moduleNodeId;
      const calleeId = symbolIdsByName.get(call.callee);
      if (calleeId) {
        const edgeId = this.store.addKnowledgeEdge(callerId, calleeId, KG_EDGE_RELATIONS.calls);
        edgeIdsCollector.push(edgeId);
        edges++;
      }
    }

    for (const tr of extraction.typeRefs) {
      const userId = symbolIdsByName.get(tr.enclosing) ?? moduleNodeId;
      const typeId = symbolIdsByName.get(tr.typeName);
      if (typeId) {
        const edgeId = this.store.addKnowledgeEdge(userId, typeId, KG_EDGE_RELATIONS.usesType);
        edgeIdsCollector.push(edgeId);
        edges++;
      }
    }

    this.fileState.set(relPath, {
      symbolIdsByName,
      symbolsByName,
      callSites: extraction.calls,
      typeReferences: extraction.typeRefs,
      moduleNodeId,
      edgeIds: edgeIdsCollector,
    });

    return { inserted, edges, moduleNodeId };
  }

  getFileInventory(relPath: string): PerFileInventory | undefined {
    return this.fileState.get(relPath);
  }

  getAllFilePaths(): readonly string[] {
    return Array.from(this.fileState.keys());
  }
}

// ── Builder ───────────────────────────────────────────

export class KGBuilder {
  private readonly persistence: KgPersistence;
  private readonly workspaceRoot: string;
  private readonly includePatterns: readonly string[];
  private readonly excludePatterns: readonly string[];
  private readonly maxFiles: number;
  private readonly forceRegex: boolean;

  constructor(
    private readonly store: MemoryStore,
    workspaceRoot: string,
    options: Pick<
      BuildOptions,
      "includePatterns" | "excludePatterns" | "maxFiles" | "forceRegex"
    > = {},
  ) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.includePatterns = options.includePatterns ?? DEFAULT_INCLUDES;
    this.excludePatterns = options.excludePatterns ?? DEFAULT_EXCLUDES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
    this.forceRegex = options.forceRegex ?? false;
    this.persistence = new KgPersistence(store);
  }

  /**
   * Walk the workspace, extract symbols from each matched file, and
   * persist into the knowledge graph. Returns a BuildSummary.
   */
  async buildForWorkspace(options: Pick<BuildOptions, "onFile"> = {}): Promise<BuildSummary> {
    const files = await walkWorkspace(
      this.workspaceRoot,
      this.includePatterns,
      this.excludePatterns,
      this.maxFiles,
    );
    const ts = this.forceRegex ? null : await loadTsApi();
    let filesProcessed = 0;
    let symbolsInserted = 0;
    let edgesInserted = 0;
    const parseErrors: { path: string; error: string }[] = [];
    const sources = new Set<FileExtraction["source"]>();

    for (const filePath of files) {
      let extraction: FileExtraction;
      let source: string;
      try {
        source = await readFile(filePath, "utf-8");
      } catch (err) {
        parseErrors.push({ path: filePath, error: `read failed: ${String(err)}` });
        continue;
      }
      try {
        if (ts) {
          extraction = extractFromSourceTs(ts, filePath, source);
        } else {
          extraction = extractFromSourceRegex(filePath, source);
        }
      } catch (err) {
        const fallback = extractFromSourceRegex(filePath, source);
        extraction = {
          ...fallback,
          parseError: err instanceof Error ? err.message : String(err),
        };
        parseErrors.push({
          path: filePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      sources.add(extraction.source);
      const { inserted, edges } = this.persistence.persistFile(this.workspaceRoot, extraction);
      symbolsInserted += inserted;
      edgesInserted += edges;
      filesProcessed++;
      if (options.onFile) {
        const rel = relative(this.workspaceRoot, filePath).split("\\").join("/");
        try {
          options.onFile(rel, extraction);
        } catch {
          /* ignore onFile errors */
        }
      }
    }

    const extractorUsed: BuildSummary["extractorUsed"] =
      sources.size === 0 ? "regex" : sources.size === 1 ? Array.from(sources)[0]! : "mixed";

    return {
      filesVisited: files.length,
      filesProcessed,
      symbolsInserted,
      edgesInserted,
      parseErrors,
      extractorUsed,
    };
  }

  /**
   * Re-parse a single file and replace its contribution to the graph.
   * Accepts either an absolute path or a workspace-relative path.
   */
  async updateFile(filePath: string): Promise<{
    readonly inserted: number;
    readonly edges: number;
    readonly parseError?: string;
  }> {
    const abs = filePath.startsWith("/") ? filePath : join(this.workspaceRoot, filePath);
    let source: string;
    try {
      source = await readFile(abs, "utf-8");
    } catch (err) {
      return { inserted: 0, edges: 0, parseError: `read failed: ${String(err)}` };
    }
    const ts = this.forceRegex ? null : await loadTsApi();
    let extraction: FileExtraction;
    try {
      extraction = ts ? extractFromSourceTs(ts, abs, source) : extractFromSourceRegex(abs, source);
    } catch (err) {
      const fb = extractFromSourceRegex(abs, source);
      extraction = { ...fb, parseError: err instanceof Error ? err.message : String(err) };
    }
    const { inserted, edges } = this.persistence.persistFile(this.workspaceRoot, extraction);
    const base: { inserted: number; edges: number; parseError?: string } = { inserted, edges };
    if (extraction.parseError !== undefined) base.parseError = extraction.parseError;
    return base;
  }

  /**
   * Return the set of symbols (by enclosing name + file) that call
   * `symbolName` across the workspace. Uses the per-file inventory +
   * extraction records kept on each buildForWorkspace / updateFile call.
   */
  findCallers(symbolName: string): readonly {
    file: string;
    enclosing: string;
    line?: number;
  }[] {
    const out: { file: string; enclosing: string; line?: number }[] = [];
    for (const filePath of this.persistence.getAllFilePaths()) {
      const inv = this.persistence.getFileInventory(filePath);
      if (!inv) continue;
      for (const call of inv.callSites) {
        if (call.callee !== symbolName) continue;
        const row: { file: string; enclosing: string; line?: number } = {
          file: filePath,
          enclosing: call.enclosing,
        };
        if (call.line !== undefined) row.line = call.line;
        out.push(row);
      }
    }
    return out;
  }

  /**
   * Return the set of symbols that reference type `typeName` as a type
   * argument / annotation.
   */
  findUsages(typeName: string): readonly {
    file: string;
    enclosing: string;
    line?: number;
  }[] {
    const out: { file: string; enclosing: string; line?: number }[] = [];
    for (const filePath of this.persistence.getAllFilePaths()) {
      const inv = this.persistence.getFileInventory(filePath);
      if (!inv) continue;
      for (const tr of inv.typeReferences) {
        if (tr.typeName !== typeName) continue;
        if (tr.enclosing === typeName) continue; // skip the definition site
        const row: { file: string; enclosing: string; line?: number } = {
          file: filePath,
          enclosing: tr.enclosing,
        };
        if (tr.line !== undefined) row.line = tr.line;
        out.push(row);
      }
    }
    return out;
  }

  /**
   * Locate where a symbol is defined. Returns `{ file, kind, line }` for
   * each definition (there may be more than one when the same name is
   * used across files).
   */
  findDefinition(symbolName: string): readonly {
    file: string;
    kind: string;
    line?: number;
  }[] {
    const out: { file: string; kind: string; line?: number }[] = [];
    for (const filePath of this.persistence.getAllFilePaths()) {
      const inv = this.persistence.getFileInventory(filePath);
      if (!inv) continue;
      const sym = inv.symbolsByName.get(symbolName);
      if (!sym) continue;
      const row: { file: string; kind: string; line?: number } = {
        file: filePath,
        kind: sym.kind,
      };
      if (sym.line !== undefined) row.line = sym.line;
      out.push(row);
    }
    return out;
  }

  /** File-paths that have been indexed (workspace-relative). */
  indexedFiles(): readonly string[] {
    return this.persistence.getAllFilePaths();
  }

  /** Current workspace root (absolute). */
  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }
}
