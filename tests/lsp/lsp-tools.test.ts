import { describe, it, expect, vi } from "vitest";
import {
  LSP_TOOLS,
  LSP_TOOL_NAMES,
  dispatchLspTool,
} from "../../src/lsp/lsp-tools.js";
import type { SymbolOperations, SymbolInfo, LSPLocation } from "../../src/lsp/symbol-operations.js";

function makeFakeSymbol(overrides: Partial<SymbolInfo> = {}): SymbolInfo {
  return {
    name: "myFunc",
    kind: "function",
    uri: "file:///src/foo.ts",
    range: {
      start: { line: 10, character: 0 },
      end: { line: 10, character: 6 },
    },
    ...overrides,
  };
}

function makeFakeLocation(overrides: Partial<LSPLocation> = {}): LSPLocation {
  return {
    uri: "file:///src/bar.ts",
    range: {
      start: { line: 5, character: 2 },
      end: { line: 5, character: 8 },
    },
    ...overrides,
  };
}

function makeMockOps(partial: Partial<SymbolOperations> = {}): SymbolOperations {
  return {
    findSymbol: vi.fn(async () => []),
    findReferences: vi.fn(async () => []),
    getDocumentSymbols: vi.fn(async () => []),
    getTypeInfo: vi.fn(async () => ""),
    rename: vi.fn(async () => ({ changes: new Map(), filesAffected: 0, editsApplied: 0 })),
    ...partial,
  } as unknown as SymbolOperations;
}

describe("LSP_TOOLS catalog", () => {
  it("exports exactly 4 tools", () => {
    expect(LSP_TOOLS).toHaveLength(4);
  });

  it("names match LSP_TOOL_NAMES", () => {
    expect(LSP_TOOL_NAMES.sort()).toEqual(
      ["find_symbol", "find_references", "get_document_symbols", "get_type_info"].sort(),
    );
  });

  it("every tool has additionalProperties: false (strict mode compatible)", () => {
    for (const tool of LSP_TOOLS) {
      expect(tool.parameters.additionalProperties).toBe(false);
    }
  });

  it("every tool has a required list", () => {
    for (const tool of LSP_TOOLS) {
      expect(tool.parameters.required).toBeDefined();
      expect(tool.parameters.required.length).toBeGreaterThan(0);
    }
  });

  it("find_symbol requires name", () => {
    const tool = LSP_TOOLS.find((t) => t.name === "find_symbol");
    expect(tool?.parameters.required).toContain("name");
  });

  it("find_references requires uri/line/character", () => {
    const tool = LSP_TOOLS.find((t) => t.name === "find_references");
    expect(tool?.parameters.required.sort()).toEqual(
      ["character", "line", "uri"].sort(),
    );
  });
});

describe("dispatchLspTool — find_symbol", () => {
  it("returns success with symbols", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () => [makeFakeSymbol({ name: "myFunc" })]),
    });
    const result = await dispatchLspTool("find_symbol", { name: "myFunc" }, ops);
    expect(result.success).toBe(true);
    const data = result.data as { symbols: Array<{ name: string }> };
    expect(data.symbols[0]?.name).toBe("myFunc");
  });

  it("rejects empty name", async () => {
    const ops = makeMockOps();
    const result = await dispatchLspTool("find_symbol", { name: "" }, ops);
    expect(result.success).toBe(false);
    expect(result.error).toContain("must be a non-empty string");
  });

  it("rejects missing name", async () => {
    const ops = makeMockOps();
    const result = await dispatchLspTool("find_symbol", {}, ops);
    expect(result.success).toBe(false);
  });

  it("respects limit parameter", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () =>
        Array.from({ length: 50 }, (_, i) => makeFakeSymbol({ name: `sym${i}` })),
      ),
    });
    const result = await dispatchLspTool("find_symbol", { name: "s", limit: 5 }, ops);
    const data = result.data as { count: number; totalMatches: number };
    expect(data.count).toBe(5);
    expect(data.totalMatches).toBe(50);
  });

  it("catches exceptions from ops", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () => {
        throw new Error("LSP server died");
      }),
    });
    const result = await dispatchLspTool("find_symbol", { name: "x" }, ops);
    expect(result.success).toBe(false);
    expect(result.error).toContain("LSP server died");
  });
});

describe("dispatchLspTool — find_references", () => {
  it("returns success with references", async () => {
    const ops = makeMockOps({
      findReferences: vi.fn(async () => [makeFakeLocation()]),
    });
    const result = await dispatchLspTool(
      "find_references",
      { uri: "file:///x.ts", line: 0, character: 0 },
      ops,
    );
    expect(result.success).toBe(true);
    const data = result.data as { references: Array<{ uri: string }> };
    expect(data.references[0]?.uri).toBe("file:///src/bar.ts");
  });

  it("rejects negative line", async () => {
    const ops = makeMockOps();
    const result = await dispatchLspTool(
      "find_references",
      { uri: "x", line: -1, character: 0 },
      ops,
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("non-negative integer");
  });

  it("rejects missing character", async () => {
    const ops = makeMockOps();
    const result = await dispatchLspTool(
      "find_references",
      { uri: "x", line: 0 },
      ops,
    );
    expect(result.success).toBe(false);
  });
});

describe("dispatchLspTool — get_document_symbols", () => {
  it("returns symbols for a file", async () => {
    const ops = makeMockOps({
      getDocumentSymbols: vi.fn(async () => [makeFakeSymbol(), makeFakeSymbol({ name: "other" })]),
    });
    const result = await dispatchLspTool(
      "get_document_symbols",
      { uri: "file:///foo.ts" },
      ops,
    );
    expect(result.success).toBe(true);
    const data = result.data as { count: number };
    expect(data.count).toBe(2);
  });
});

describe("dispatchLspTool — get_type_info", () => {
  it("returns type info string", async () => {
    const ops = makeMockOps({
      getTypeInfo: vi.fn(async () => "function myFunc(x: number): string"),
    });
    const result = await dispatchLspTool(
      "get_type_info",
      { uri: "file:///foo.ts", line: 5, character: 10 },
      ops,
    );
    expect(result.success).toBe(true);
    const data = result.data as { typeInfo: string };
    expect(data.typeInfo).toContain("function myFunc");
  });
});

describe("dispatchLspTool — unknown tool", () => {
  it("returns error for unrecognised tool name", async () => {
    const ops = makeMockOps();
    const result = await dispatchLspTool("invalid_tool", {}, ops);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown LSP tool");
  });
});
