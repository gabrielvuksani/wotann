import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { SymbolOperations, applyRenameResult } from "../../src/lsp/symbol-operations.js";

describe("SymbolOperations", () => {
  let workspaceRoot: string;
  let operations: SymbolOperations;
  let sourceFile: string;
  let consumerFile: string;

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), "wotann-lsp-"));
    sourceFile = join(workspaceRoot, "a.ts");
    consumerFile = join(workspaceRoot, "b.ts");

    writeFileSync(sourceFile, [
      "export function fetchData(input: string): string {",
      "  return transformValue(input);",
      "}",
      "",
      "export const count: number = 1;",
      "",
      "export function transformValue(value: string): string {",
      "  return value.toUpperCase();",
      "}",
      "",
    ].join("\n"));

    writeFileSync(consumerFile, [
      'import { fetchData } from "./a";',
      "",
      'export const result = fetchData("hi");',
      "",
    ].join("\n"));

    operations = new SymbolOperations({ workspaceRoot });
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("finds workspace symbols", async () => {
    const symbols = await operations.findSymbol("fetchData");
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.some((symbol) => symbol.name === "fetchData")).toBe(true);
  });

  it("finds references across files", async () => {
    const refs = await operations.findReferences(pathToFileURL(sourceFile).toString(), {
      line: 0,
      character: 16,
    });

    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((ref) => ref.uri.endsWith("/a.ts"))).toBe(true);
    expect(refs.some((ref) => ref.uri.endsWith("/b.ts"))).toBe(true);
  });

  it("gets type information", async () => {
    const info = await operations.getTypeInfo(pathToFileURL(sourceFile).toString(), {
      line: 4,
      character: 13,
    });

    expect(info.toLowerCase()).toContain("number");
  });

  it("returns document symbols", async () => {
    const symbols = await operations.getDocumentSymbols(pathToFileURL(sourceFile).toString());
    expect(symbols.some((symbol) => symbol.name === "fetchData")).toBe(true);
    expect(symbols.some((symbol) => symbol.name === "transformValue")).toBe(true);
  });

  it("produces and applies rename edits", async () => {
    const rename = await operations.rename(pathToFileURL(sourceFile).toString(), {
      line: 0,
      character: 16,
    }, "loadData");

    expect(rename.filesAffected).toBeGreaterThanOrEqual(2);
    expect(rename.editsApplied).toBeGreaterThanOrEqual(2);

    const modifiedFiles = applyRenameResult(rename);
    expect(modifiedFiles).toBeGreaterThanOrEqual(2);
    expect(readFileSync(sourceFile, "utf-8")).toContain("loadData");
    expect(readFileSync(consumerFile, "utf-8")).toContain("loadData");
  });

  it("falls back for non-TypeScript files", async () => {
    const pythonFile = join(workspaceRoot, "tool.py");
    writeFileSync(pythonFile, [
      "def format_name(value: str) -> str:",
      "    return value.strip()",
      "",
    ].join("\n"));

    const pythonOps = new SymbolOperations({ workspaceRoot });
    const symbols = await pythonOps.findSymbol("format_name");

    expect(symbols.some((symbol) => symbol.name === "format_name")).toBe(true);
  });
});
