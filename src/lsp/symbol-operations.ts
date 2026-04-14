/**
 * LSP symbol operations: rename, find references, type info, insert/replace by symbol.
 * Uses TypeScript's language service when available and falls back to workspace scans
 * for other languages or environments without the TypeScript runtime.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface LSPPosition {
  readonly line: number;
  readonly character: number;
}

export interface LSPLocation {
  readonly uri: string;
  readonly range: {
    readonly start: LSPPosition;
    readonly end: LSPPosition;
  };
}

export interface SymbolInfo {
  readonly name: string;
  readonly kind: string;
  readonly uri: string;
  readonly range: LSPLocation["range"];
  readonly containerName?: string;
}

export interface RenameResult {
  readonly changes: ReadonlyMap<string, readonly TextEdit[]>;
  readonly filesAffected: number;
  readonly editsApplied: number;
}

export interface TextEdit {
  readonly range: LSPLocation["range"];
  readonly newText: string;
}

interface SymbolOperationsOptions {
  readonly workspaceRoot?: string;
}

type TypeScriptModule = typeof import("typescript");
type TSLanguageService = import("typescript").LanguageService;
type TSSourceFile = import("typescript").SourceFile;

const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);
const SUPPORTED_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cs",
]);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".wotann",
]);

const DEFINITION_PATTERNS: ReadonlyMap<string, readonly RegExp[]> = new Map([
  [".ts", [
    /^\s*export\s+(?:async\s+)?function\s+([A-Za-z_]\w*)/m,
    /^\s*(?:async\s+)?function\s+([A-Za-z_]\w*)/m,
    /^\s*export\s+class\s+([A-Za-z_]\w*)/m,
    /^\s*class\s+([A-Za-z_]\w*)/m,
    /^\s*export\s+interface\s+([A-Za-z_]\w*)/m,
    /^\s*interface\s+([A-Za-z_]\w*)/m,
    /^\s*export\s+type\s+([A-Za-z_]\w*)/m,
    /^\s*type\s+([A-Za-z_]\w*)/m,
    /^\s*export\s+(?:const|let|var)\s+([A-Za-z_]\w*)/m,
    /^\s*(?:const|let|var)\s+([A-Za-z_]\w*)/m,
    /^\s*export\s+enum\s+([A-Za-z_]\w*)/m,
    /^\s*enum\s+([A-Za-z_]\w*)/m,
  ]],
  [".tsx", []],
  [".js", [
    /^\s*(?:async\s+)?function\s+([A-Za-z_]\w*)/m,
    /^\s*class\s+([A-Za-z_]\w*)/m,
    /^\s*(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(/m,
  ]],
  [".jsx", []],
  [".py", [
    /^\s*def\s+([A-Za-z_]\w*)\s*\(/m,
    /^\s*class\s+([A-Za-z_]\w*)\s*[:(]/m,
  ]],
  [".go", [
    /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/m,
    /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/m,
    /^\s*var\s+([A-Za-z_]\w*)\b/m,
    /^\s*const\s+([A-Za-z_]\w*)\b/m,
  ]],
  [".rs", [
    /^\s*fn\s+([A-Za-z_]\w*)\s*\(/m,
    /^\s*struct\s+([A-Za-z_]\w*)\b/m,
    /^\s*enum\s+([A-Za-z_]\w*)\b/m,
    /^\s*trait\s+([A-Za-z_]\w*)\b/m,
  ]],
  [".java", [
    /^\s*(?:public\s+|private\s+|protected\s+)?(?:abstract\s+|final\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)\b/m,
    /^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?[\w<>\[\]]+\s+([A-Za-z_]\w*)\s*\(/m,
  ]],
  [".cs", [
    /^\s*(?:public|private|protected|internal)?\s*(?:sealed\s+|abstract\s+|static\s+)?(?:class|interface|enum|struct|record)\s+([A-Za-z_]\w*)\b/m,
    /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?[\w<>\[\],]+\s+([A-Za-z_]\w*)\s*\(/m,
  ]],
]);

function regexesForExtension(ext: string): readonly RegExp[] {
  if (ext === ".tsx") return DEFINITION_PATTERNS.get(".ts") ?? [];
  if (ext === ".jsx") return DEFINITION_PATTERNS.get(".js") ?? [];
  return DEFINITION_PATTERNS.get(ext) ?? [];
}

// ── LSP Server Manager ──────────────────────────────────────

interface LSPServerConfig {
  readonly language: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly extensions: readonly string[];
}

const KNOWN_SERVERS: readonly LSPServerConfig[] = [
  { language: "typescript", command: "typescript-language-server", args: ["--stdio"], extensions: [".ts", ".tsx", ".js", ".jsx"] },
  { language: "python", command: "pyright-langserver", args: ["--stdio"], extensions: [".py"] },
  { language: "go", command: "gopls", args: ["serve"], extensions: [".go"] },
  { language: "rust", command: "rust-analyzer", args: [], extensions: [".rs"] },
  { language: "java", command: "jdtls", args: [], extensions: [".java"] },
  { language: "csharp", command: "OmniSharp", args: ["-lsp"], extensions: [".cs"] },
];

export class LSPManager {
  private readonly servers: Map<string, ChildProcess> = new Map();
  private readonly configs: Map<string, LSPServerConfig> = new Map();

  constructor() {
    for (const config of KNOWN_SERVERS) {
      this.configs.set(config.language, config);
    }
  }

  /**
   * Detect which LSP servers are available on the system.
   */
  async detectAvailable(): Promise<readonly string[]> {
    const available: string[] = [];
    for (const [lang, config] of this.configs) {
      try {
        const proc = spawn("which", [config.command], { stdio: "pipe" });
        const exitCode = await new Promise<number>((resolvePromise) => {
          proc.on("close", (code) => resolvePromise(code ?? 1));
          proc.on("error", () => resolvePromise(1));
        });
        if (exitCode === 0) available.push(lang);
      } catch {
        // Server not available
      }
    }
    return available;
  }

  /**
   * Get the language for a file extension.
   */
  getLanguageForFile(filePath: string): string | null {
    for (const config of this.configs.values()) {
      if (config.extensions.some((ext) => filePath.endsWith(ext))) {
        return config.language;
      }
    }
    return null;
  }

  /**
   * Start an LSP server for a language.
   */
  async startServer(language: string): Promise<boolean> {
    if (this.servers.has(language)) return true;

    const config = this.configs.get(language);
    if (!config) return false;

    try {
      const proc = spawn(config.command, [...config.args], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.servers.set(language, proc);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stop an LSP server.
   */
  stopServer(language: string): void {
    const server = this.servers.get(language);
    if (server) {
      server.kill();
      this.servers.delete(language);
    }
  }

  /**
   * Stop all servers.
   */
  stopAll(): void {
    for (const [lang] of this.servers) {
      this.stopServer(lang);
    }
  }

  isRunning(language: string): boolean {
    return this.servers.has(language);
  }

  getRunningServers(): readonly string[] {
    return [...this.servers.keys()];
  }

  getSupportedLanguages(): readonly string[] {
    return [...this.configs.keys()];
  }
}

// ── Symbol Operations (TypeScript-backed with fallback scans) ────────────────

export class SymbolOperations {
  private readonly workspaceRoot: string;

  constructor(options: SymbolOperationsOptions = {}) {
    this.workspaceRoot = resolve(options.workspaceRoot ?? process.cwd());
  }

  /**
   * Find a symbol by name across the workspace.
   */
  async findSymbol(name: string): Promise<readonly SymbolInfo[]> {
    const viaTypeScript = await this.withTypeScriptLanguageService((ts, service) => {
      const items = service.getNavigateToItems(name, undefined, undefined, false) ?? [];
      const program = service.getProgram();
      if (!program) return [];

      const symbols: SymbolInfo[] = [];
      for (const item of items) {
        if (!item.fileName.startsWith(this.workspaceRoot) || item.name !== name) continue;
        const sourceFile = program.getSourceFile(item.fileName);
        if (!sourceFile) continue;

        symbols.push({
          name: item.name,
          kind: String(item.kind),
          uri: pathToFileURL(item.fileName).toString(),
          range: textSpanToRangeTs(sourceFile, item.textSpan),
          containerName: item.containerName || undefined,
        });
      }

      return symbols;
    });

    if (viaTypeScript && viaTypeScript.length > 0) {
      return dedupeSymbols(viaTypeScript);
    }

    return dedupeSymbols(this.findSymbolFallback(name));
  }

  /**
   * Find ALL references to a symbol.
   */
  async findReferences(uri: string, position: LSPPosition): Promise<readonly LSPLocation[]> {
    const filePath = this.normalizePath(uri);

    const viaTypeScript = await this.withTypeScriptLanguageService((ts, service) => {
      if (!TYPESCRIPT_EXTENSIONS.has(extname(filePath))) return [];
      const content = safeRead(filePath);
      if (content === null) return [];
      const offset = positionToOffset(content, position);
      const references = service.getReferencesAtPosition(filePath, offset) ?? [];
      const program = service.getProgram();
      if (!program) return [];

      return references.map((reference) => {
        const sourceFile = program.getSourceFile(reference.fileName);
        if (!sourceFile) return null;
        return {
          uri: pathToFileURL(reference.fileName).toString(),
          range: textSpanToRangeTs(sourceFile, reference.textSpan),
        } satisfies LSPLocation;
      }).filter((reference): reference is LSPLocation => reference !== null);
    });

    if (viaTypeScript && viaTypeScript.length > 0) {
      return dedupeLocations(viaTypeScript);
    }

    const symbolName = this.extractSymbolAtPosition(filePath, position);
    if (!symbolName) return [];
    return dedupeLocations(this.findWordOccurrences(symbolName));
  }

  /**
   * Rename a symbol across the entire codebase.
   */
  async rename(uri: string, position: LSPPosition, newName: string): Promise<RenameResult> {
    const filePath = this.normalizePath(uri);

    const viaTypeScript = await this.withTypeScriptLanguageService((ts, service) => {
      if (!TYPESCRIPT_EXTENSIONS.has(extname(filePath))) return null;
      const content = safeRead(filePath);
      if (content === null) return null;
      const offset = positionToOffset(content, position);
      const renameInfo = service.getRenameInfo(filePath, offset, { allowRenameOfImportPath: false });
      if (!renameInfo.canRename) return null;

      const locations = service.findRenameLocations(filePath, offset, false, false, true) ?? [];
      const program = service.getProgram();
      if (!program) return null;

      const changes = new Map<string, TextEdit[]>();
      for (const location of locations) {
        const sourceFile = program.getSourceFile(location.fileName);
        if (!sourceFile) continue;
        const edits = changes.get(location.fileName) ?? [];
        edits.push({
          range: textSpanToRangeTs(sourceFile, location.textSpan),
          newText: newName,
        });
        changes.set(location.fileName, edits);
      }

      return finalizeRenameResult(changes);
    });

    if (viaTypeScript) return viaTypeScript;

    const symbolName = this.extractSymbolAtPosition(filePath, position);
    if (!symbolName) return emptyRenameResult();

    const locations = this.findWordOccurrences(symbolName);
    const changes = new Map<string, TextEdit[]>();
    for (const location of locations) {
      const edits = changes.get(this.normalizePath(location.uri)) ?? [];
      edits.push({
        range: location.range,
        newText: newName,
      });
      changes.set(this.normalizePath(location.uri), edits);
    }

    return finalizeRenameResult(changes);
  }

  /**
   * Get hover/type information for a position.
   */
  async getTypeInfo(uri: string, position: LSPPosition): Promise<string> {
    const filePath = this.normalizePath(uri);

    const viaTypeScript = await this.withTypeScriptLanguageService(async (ts, service) => {
      if (!TYPESCRIPT_EXTENSIONS.has(extname(filePath))) return "";
      const content = safeRead(filePath);
      if (content === null) return "";
      const offset = positionToOffset(content, position);
      const quickInfo = service.getQuickInfoAtPosition(filePath, offset);
      if (!quickInfo) return "";

      const signature = ts.displayPartsToString(quickInfo.displayParts);
      const documentation = ts.displayPartsToString(quickInfo.documentation).trim();
      return documentation.length > 0
        ? `${signature}\n\n${documentation}`
        : signature;
    });

    if (viaTypeScript && viaTypeScript.trim().length > 0) {
      return viaTypeScript;
    }

    return this.getTypeInfoFallback(filePath, position);
  }

  /**
   * Get document symbols (overview of a file's structure).
   */
  async getDocumentSymbols(uri: string): Promise<readonly SymbolInfo[]> {
    const filePath = this.normalizePath(uri);

    const viaTypeScript = await this.withTypeScriptLanguageService((ts, service) => {
      if (!TYPESCRIPT_EXTENSIONS.has(extname(filePath))) return [];
      const program = service.getProgram();
      const sourceFile = program?.getSourceFile(filePath);
      if (!sourceFile) return [];

      const symbols: SymbolInfo[] = [];
      const visit = (node: import("typescript").Node, containerName?: string) => {
        const name = getTsNodeName(node, ts);
        if (name) {
          const range = textSpanToRangeTs(sourceFile, { start: node.getStart(sourceFile), length: node.getWidth(sourceFile) });
          symbols.push({
            name,
            kind: ts.SyntaxKind[node.kind] ?? "Unknown",
            uri: pathToFileURL(filePath).toString(),
            range,
            containerName,
          });
        }

        const nextContainer = name ?? containerName;
        ts.forEachChild(node, (child) => visit(child, nextContainer));
      };

      visit(sourceFile);
      return symbols;
    });

    if (viaTypeScript && viaTypeScript.length > 0) {
      return dedupeSymbols(viaTypeScript);
    }

    return dedupeSymbols(this.scanDocumentSymbolsFallback(filePath));
  }

  private async withTypeScriptLanguageService<T>(
    callback: (ts: TypeScriptModule, service: TSLanguageService) => T | Promise<T>,
  ): Promise<T | null> {
    let ts: TypeScriptModule;
    try {
      ts = await import("typescript");
    } catch {
      return null;
    }

    const files = walkWorkspaceFiles(this.workspaceRoot).filter((file) => TYPESCRIPT_EXTENSIONS.has(extname(file)));
    if (files.length === 0) return null;

    const compilerOptions: import("typescript").CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      skipLibCheck: true,
      resolveJsonModule: true,
    };

    const host: import("typescript").LanguageServiceHost = {
      getCompilationSettings: () => compilerOptions,
      getCurrentDirectory: () => this.workspaceRoot,
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      getScriptFileNames: () => files,
      getScriptVersion: () => "0",
      getScriptSnapshot: (fileName) => {
        if (!existsSync(fileName)) return undefined;
        return ts.ScriptSnapshot.fromString(readFileSync(fileName, "utf-8"));
      },
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists?.bind(ts.sys),
      getDirectories: ts.sys.getDirectories?.bind(ts.sys),
      useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    };

    const service = ts.createLanguageService(host, ts.createDocumentRegistry());
    try {
      return await callback(ts, service);
    } finally {
      service.dispose();
    }
  }

  private normalizePath(uriOrPath: string): string {
    if (uriOrPath.startsWith("file://")) {
      return fileURLToPath(uriOrPath);
    }
    return resolve(this.workspaceRoot, uriOrPath);
  }

  private extractSymbolAtPosition(filePath: string, position: LSPPosition): string | null {
    const content = safeRead(filePath);
    if (content === null) return null;
    const line = content.split("\n")[position.line];
    if (typeof line !== "string") return null;

    const left = line.slice(0, position.character);
    const right = line.slice(position.character);
    const leftMatch = left.match(/[A-Za-z_]\w*$/);
    const rightMatch = right.match(/^[A-Za-z_]\w*/);
    const symbol = `${leftMatch?.[0] ?? ""}${rightMatch?.[0] ?? ""}`;
    return symbol.length > 0 ? symbol : null;
  }

  private findSymbolFallback(name: string): readonly SymbolInfo[] {
    const results: SymbolInfo[] = [];
    for (const filePath of walkWorkspaceFiles(this.workspaceRoot)) {
      const ext = extname(filePath);
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const content = safeRead(filePath);
      if (content === null) continue;

      for (const pattern of regexesForExtension(ext)) {
        const matches = [...content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
        for (const match of matches) {
          if ((match[1] ?? "") !== name || typeof match.index !== "number") continue;
          results.push({
            name,
            kind: inferFallbackKind(pattern.source),
            uri: pathToFileURL(filePath).toString(),
            range: rangeFromOffsetLength(content, match.index, match[0].length),
          });
        }
      }
    }
    return results;
  }

  private findWordOccurrences(symbolName: string): readonly LSPLocation[] {
    const escaped = escapeRegex(symbolName);
    const pattern = new RegExp(`\\b${escaped}\\b`, "g");
    const locations: LSPLocation[] = [];

    for (const filePath of walkWorkspaceFiles(this.workspaceRoot)) {
      const ext = extname(filePath);
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const content = safeRead(filePath);
      if (content === null) continue;

      for (const match of content.matchAll(pattern)) {
        if (typeof match.index !== "number") continue;
        locations.push({
          uri: pathToFileURL(filePath).toString(),
          range: rangeFromOffsetLength(content, match.index, symbolName.length),
        });
      }
    }

    return locations;
  }

  private getTypeInfoFallback(filePath: string, position: LSPPosition): string {
    const content = safeRead(filePath);
    if (content === null) return "";
    const line = content.split("\n")[position.line] ?? "";

    const typed = line.match(/:\s*([A-Za-z_][\w<>\[\]\|, ]*)/);
    if (typed?.[1]) return typed[1].trim();

    const returnType = line.match(/->\s*([A-Za-z_][\w<>\[\]\|, ]*)/);
    if (returnType?.[1]) return returnType[1].trim();

    if (/=\s*["'`]/.test(line)) return "string";
    if (/=\s*\d+/.test(line)) return "number";
    if (/=\s*(true|false)\b/.test(line)) return "boolean";
    if (/=\s*\[/.test(line)) return "array";
    if (/=\s*\{/.test(line)) return "object";

    const symbol = this.extractSymbolAtPosition(filePath, position);
    return symbol ? `symbol ${symbol}` : "";
  }

  private scanDocumentSymbolsFallback(filePath: string): readonly SymbolInfo[] {
    const content = safeRead(filePath);
    if (content === null) return [];

    const ext = extname(filePath);
    const symbols: SymbolInfo[] = [];

    for (const pattern of regexesForExtension(ext)) {
      for (const match of content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
        const name = match[1];
        if (typeof name !== "string" || typeof match.index !== "number") continue;
        symbols.push({
          name,
          kind: inferFallbackKind(pattern.source),
          uri: pathToFileURL(filePath).toString(),
          range: rangeFromOffsetLength(content, match.index, match[0].length),
        });
      }
    }

    return symbols;
  }
}

export function applyRenameResult(result: RenameResult): number {
  let modifiedFiles = 0;

  for (const [filePath, edits] of result.changes) {
    const content = safeRead(filePath);
    if (content === null) continue;

    const sorted = [...edits].sort((left, right) => {
      const leftStart = positionToOffset(content, left.range.start);
      const rightStart = positionToOffset(content, right.range.start);
      return rightStart - leftStart;
    });

    let updated = content;
    for (const edit of sorted) {
      const start = positionToOffset(content, edit.range.start);
      const end = positionToOffset(content, edit.range.end);
      updated = `${updated.slice(0, start)}${edit.newText}${updated.slice(end)}`;
    }

    if (updated !== content) {
      writeFileSync(filePath, updated);
      modifiedFiles++;
    }
  }

  return modifiedFiles;
}

function walkWorkspaceFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];

  const files: string[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || !existsSync(current)) continue;
    const stats = statSync(current);
    if (!stats.isDirectory()) {
      files.push(current);
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      queue.push(join(current, entry.name));
    }
  }

  return files;
}

function safeRead(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function positionToOffset(content: string, position: LSPPosition): number {
  if (position.line <= 0) {
    return Math.max(0, Math.min(position.character, content.length));
  }

  let currentLine = 0;
  let offset = 0;
  while (currentLine < position.line && offset < content.length) {
    const nextNewline = content.indexOf("\n", offset);
    if (nextNewline === -1) return content.length;
    offset = nextNewline + 1;
    currentLine++;
  }

  return Math.max(0, Math.min(offset + position.character, content.length));
}

function offsetToPosition(content: string, offset: number): LSPPosition {
  const safeOffset = Math.max(0, Math.min(offset, content.length));
  const preceding = content.slice(0, safeOffset);
  const lines = preceding.split("\n");
  const line = lines.length - 1;
  const character = lines[lines.length - 1]?.length ?? 0;
  return { line, character };
}

function rangeFromOffsetLength(content: string, start: number, length: number): LSPLocation["range"] {
  return {
    start: offsetToPosition(content, start),
    end: offsetToPosition(content, start + length),
  };
}

function textSpanToRangeTs(sourceFile: TSSourceFile, textSpan: { start: number; length: number }): LSPLocation["range"] {
  const start = sourceFile.getLineAndCharacterOfPosition(textSpan.start);
  const end = sourceFile.getLineAndCharacterOfPosition(textSpan.start + textSpan.length);

  return {
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
  };
}

function getTsNodeName(node: import("typescript").Node, ts: TypeScriptModule): string | null {
  const maybeNamed = node as import("typescript").Node & { name?: import("typescript").Node };
  const nameNode = maybeNamed.name;
  if (nameNode && ts.isIdentifier(nameNode)) {
    return nameNode.text;
  }

  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }

  return null;
}

function finalizeRenameResult(changes: ReadonlyMap<string, readonly TextEdit[]>): RenameResult {
  const normalized = new Map<string, readonly TextEdit[]>();
  let editsApplied = 0;

  for (const [filePath, edits] of changes) {
    const deduped = dedupeTextEdits(edits);
    normalized.set(filePath, deduped);
    editsApplied += deduped.length;
  }

  return {
    changes: normalized,
    filesAffected: normalized.size,
    editsApplied,
  };
}

function emptyRenameResult(): RenameResult {
  return {
    changes: new Map(),
    filesAffected: 0,
    editsApplied: 0,
  };
}

function dedupeLocations(locations: readonly LSPLocation[]): readonly LSPLocation[] {
  const seen = new Set<string>();
  const deduped: LSPLocation[] = [];

  for (const location of locations) {
    const key = [
      location.uri,
      location.range.start.line,
      location.range.start.character,
      location.range.end.line,
      location.range.end.character,
    ].join(":");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(location);
  }

  return deduped;
}

function dedupeSymbols(symbols: readonly SymbolInfo[]): readonly SymbolInfo[] {
  const seen = new Set<string>();
  const deduped: SymbolInfo[] = [];

  for (const symbol of symbols) {
    const key = [
      symbol.name,
      symbol.kind,
      symbol.uri,
      symbol.range.start.line,
      symbol.range.start.character,
    ].join(":");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(symbol);
  }

  return deduped;
}

function dedupeTextEdits(edits: readonly TextEdit[]): readonly TextEdit[] {
  const seen = new Set<string>();
  const deduped: TextEdit[] = [];

  for (const edit of edits) {
    const key = [
      edit.range.start.line,
      edit.range.start.character,
      edit.range.end.line,
      edit.range.end.character,
      edit.newText,
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(edit);
  }

  return deduped;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferFallbackKind(patternSource: string): string {
  if (patternSource.includes("class")) return "class";
  if (patternSource.includes("interface")) return "interface";
  if (patternSource.includes("enum")) return "enum";
  if (patternSource.includes("type")) return "type";
  if (patternSource.includes("func") || patternSource.includes("def") || patternSource.includes("function")) return "function";
  return "symbol";
}
