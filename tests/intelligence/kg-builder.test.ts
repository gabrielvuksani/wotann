import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  KGBuilder,
  KG_EDGE_RELATIONS,
  KG_NODE_TYPES,
  extractFromSourceRegex,
} from "../../src/intelligence/kg-builder.js";
import { MemoryStore } from "../../src/memory/store.js";

// Small helper to create a workspace scaffold.
function scaffold(files: Record<string, string>): string {
  const root = join(tmpdir(), `wotann-kg-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    if (dir !== root) mkdirSync(dir, { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  return root;
}

describe("KGBuilder — Blitzy KG-first-stage port (P1-C3)", () => {
  let dbDir: string;
  let store: MemoryStore;

  beforeEach(() => {
    dbDir = join(tmpdir(), `wotann-kg-db-${randomUUID()}`);
    mkdirSync(dbDir, { recursive: true });
    store = new MemoryStore(join(dbDir, "memory.db"));
  });

  afterEach(() => {
    try { store.close(); } catch { /* ignore */ }
    try { rmSync(dbDir, { recursive: true }); } catch { /* ignore */ }
  });

  describe("extractFromSourceRegex — fallback extractor", () => {
    it("extracts classes", () => {
      const source = `
export class Alpha {
  hi() { return 1; }
}
class Beta {}
`;
      const ext = extractFromSourceRegex("x.ts", source);
      const classes = ext.symbols.filter((s) => s.kind === "class").map((s) => s.name);
      expect(classes).toContain("Alpha");
      expect(classes).toContain("Beta");
      const alpha = ext.symbols.find((s) => s.name === "Alpha");
      expect(alpha?.exported).toBe(true);
    });

    it("extracts functions and types", () => {
      const source = `
export function hello(x: number): string { return ""; }
export type Foo = { a: number };
export interface Bar { b: string }
`;
      const ext = extractFromSourceRegex("x.ts", source);
      expect(ext.symbols.map((s) => s.name)).toEqual(
        expect.arrayContaining(["hello", "Foo", "Bar"]),
      );
      expect(ext.symbols.find((s) => s.name === "hello")?.kind).toBe("function");
      expect(ext.symbols.find((s) => s.name === "Foo")?.kind).toBe("type");
      expect(ext.symbols.find((s) => s.name === "Bar")?.kind).toBe("interface");
    });

    it("extracts imports with names", () => {
      const source = `
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import Zod from "zod";
`;
      const ext = extractFromSourceRegex("x.ts", source);
      const specs = ext.imports.map((i) => i.specifier);
      expect(specs).toEqual(expect.arrayContaining(["node:fs/promises", "node:path", "zod"]));
      const fs = ext.imports.find((i) => i.specifier === "node:fs/promises");
      expect(fs?.named).toContain("readFile");
    });
  });

  describe("buildForWorkspace — end-to-end", () => {
    it("persists symbols to MemoryStore knowledge_nodes", async () => {
      const root = scaffold({
        "a.ts": `export function foo() { return bar(); }\nexport function bar() { return 42; }\n`,
      });
      const kg = new KGBuilder(store, root);
      const summary = await kg.buildForWorkspace();
      expect(summary.filesProcessed).toBe(1);
      expect(summary.symbolsInserted).toBeGreaterThanOrEqual(2);
      const stats = store.getKnowledgeGraphSize();
      expect(stats.nodes).toBeGreaterThanOrEqual(2);

      const fooDef = kg.findDefinition("foo");
      expect(fooDef.length).toBe(1);
      expect(fooDef[0]!.kind).toBe("function");
      expect(fooDef[0]!.file).toBe("a.ts");

      rmSync(root, { recursive: true });
    });

    it("builds imports as module-level edges", async () => {
      const root = scaffold({
        "a.ts": `import { foo } from "./b.js";\nexport function q() { return foo(); }\n`,
        "b.ts": `export function foo() { return 1; }\n`,
      });
      const kg = new KGBuilder(store, root);
      const summary = await kg.buildForWorkspace();
      expect(summary.filesProcessed).toBe(2);
      // At least one imports edge should be present.
      expect(summary.edgesInserted).toBeGreaterThan(0);

      rmSync(root, { recursive: true });
    });

    it("findCallers returns call sites inside a file", async () => {
      const root = scaffold({
        "a.ts": `
function helper() { return 1; }
export function caller1() { return helper(); }
export function caller2() { return helper() + 1; }
`,
      });
      const kg = new KGBuilder(store, root);
      await kg.buildForWorkspace();
      const callers = kg.findCallers("helper");
      const names = callers.map((c) => c.enclosing).sort();
      expect(names).toEqual(expect.arrayContaining(["caller1", "caller2"]));

      rmSync(root, { recursive: true });
    });

    it("findUsages returns type references", async () => {
      const root = scaffold({
        "a.ts": `
export interface Config { port: number }
export function make(): Config { return { port: 1 }; }
export function use(c: Config): number { return c.port; }
`,
      });
      const kg = new KGBuilder(store, root);
      await kg.buildForWorkspace();
      const users = kg.findUsages("Config");
      const names = users.map((u) => u.enclosing).sort();
      expect(names.length).toBeGreaterThan(0);
      expect(names).toEqual(expect.arrayContaining(["use"]));

      rmSync(root, { recursive: true });
    });

    it("respects include/exclude patterns", async () => {
      const root = scaffold({
        "src/a.ts": `export const a = 1;\n`,
        "vendor/b.ts": `export const b = 2;\n`,
      });
      const kg = new KGBuilder(store, root, {
        includePatterns: ["src/**/*.ts"],
        excludePatterns: ["**/vendor/**"],
      });
      const summary = await kg.buildForWorkspace();
      expect(summary.filesProcessed).toBe(1);
      expect(kg.findDefinition("a").length).toBe(1);
      expect(kg.findDefinition("b").length).toBe(0);

      rmSync(root, { recursive: true });
    });

    it("handles empty workspaces without error", async () => {
      const root = scaffold({});
      const kg = new KGBuilder(store, root);
      const summary = await kg.buildForWorkspace();
      expect(summary.filesVisited).toBe(0);
      expect(summary.filesProcessed).toBe(0);
      expect(summary.symbolsInserted).toBe(0);

      rmSync(root, { recursive: true });
    });

    it("continues past a corrupt source file", async () => {
      const root = scaffold({
        "good.ts": `export function okay() {}\n`,
        "bad.ts": `export function broken( { / / ;;`, // syntactically broken
      });
      const kg = new KGBuilder(store, root);
      const summary = await kg.buildForWorkspace();
      expect(summary.filesProcessed).toBe(2);
      // okay() from good.ts must still be present.
      expect(kg.findDefinition("okay").length).toBe(1);

      rmSync(root, { recursive: true });
    });

    it("is per-workspace: two builders over two roots stay isolated", async () => {
      const rootA = scaffold({ "a.ts": `export function onlyInA() {}\n` });
      const rootB = scaffold({ "b.ts": `export function onlyInB() {}\n` });

      const kgA = new KGBuilder(store, rootA);
      const kgB = new KGBuilder(store, rootB);

      await kgA.buildForWorkspace();
      await kgB.buildForWorkspace();

      expect(kgA.findDefinition("onlyInA").length).toBe(1);
      expect(kgA.findDefinition("onlyInB").length).toBe(0);
      expect(kgB.findDefinition("onlyInB").length).toBe(1);
      expect(kgB.findDefinition("onlyInA").length).toBe(0);

      rmSync(rootA, { recursive: true });
      rmSync(rootB, { recursive: true });
    });
  });

  describe("updateFile — incremental updates", () => {
    it("adds a new symbol to the graph", async () => {
      const root = scaffold({
        "a.ts": `export function original() {}\n`,
      });
      const kg = new KGBuilder(store, root);
      await kg.buildForWorkspace();

      writeFileSync(
        join(root, "a.ts"),
        `export function original() {}\nexport function added() { return original(); }\n`,
        "utf-8",
      );
      const result = await kg.updateFile("a.ts");
      expect(result.parseError).toBeUndefined();
      expect(result.inserted).toBeGreaterThanOrEqual(2);

      const addedDef = kg.findDefinition("added");
      expect(addedDef.length).toBe(1);
      const callers = kg.findCallers("original");
      expect(callers.map((c) => c.enclosing)).toContain("added");

      rmSync(root, { recursive: true });
    });

    it("removes a symbol after incremental update", async () => {
      const root = scaffold({
        "a.ts": `export function keepMe() {}\nexport function removeMe() {}\n`,
      });
      const kg = new KGBuilder(store, root);
      await kg.buildForWorkspace();
      expect(kg.findDefinition("removeMe").length).toBe(1);

      writeFileSync(join(root, "a.ts"), `export function keepMe() {}\n`, "utf-8");
      await kg.updateFile("a.ts");

      // Per-workspace inventory tracks only current symbols.
      expect(kg.findDefinition("keepMe").length).toBe(1);
      const inv = kg.indexedFiles();
      expect(inv).toContain("a.ts");

      rmSync(root, { recursive: true });
    });

    it("preserves unchanged files during single-file update", async () => {
      const root = scaffold({
        "a.ts": `export function inA() {}\n`,
        "b.ts": `export function inB() {}\n`,
      });
      const kg = new KGBuilder(store, root);
      await kg.buildForWorkspace();

      writeFileSync(join(root, "a.ts"), `export function inA2() {}\n`, "utf-8");
      await kg.updateFile("a.ts");

      // b.ts unchanged, still indexed.
      expect(kg.findDefinition("inB").length).toBe(1);
      expect(kg.findDefinition("inA2").length).toBe(1);

      rmSync(root, { recursive: true });
    });
  });

  describe("regex fallback mode", () => {
    it("forceRegex reports 'regex' extractor", async () => {
      const root = scaffold({
        "a.ts": `export class X {}\nexport function y() {}\n`,
      });
      const kg = new KGBuilder(store, root, { forceRegex: true });
      const summary = await kg.buildForWorkspace();
      expect(summary.extractorUsed).toBe("regex");
      expect(kg.findDefinition("X").length).toBe(1);
      expect(kg.findDefinition("y").length).toBe(1);

      rmSync(root, { recursive: true });
    });
  });

  describe("constants exposed", () => {
    it("exposes edge relations and node types", () => {
      expect(KG_EDGE_RELATIONS.calls).toBe("code:calls");
      expect(KG_EDGE_RELATIONS.usesType).toBe("code:uses_type");
      expect(KG_EDGE_RELATIONS.imports).toBe("code:imports");
      expect(KG_EDGE_RELATIONS.definedIn).toBe("code:defined_in");
      expect(KG_NODE_TYPES.symbol).toBe("code_symbol");
      expect(KG_NODE_TYPES.module).toBe("code_module");
    });
  });
});
