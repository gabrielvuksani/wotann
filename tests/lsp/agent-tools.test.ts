/**
 * Tests for src/lsp/agent-tools.ts — Phase D LSP Serena-parity port.
 *
 * Verifies the six-tool factory (`find_symbol`, `find_references`,
 * `rename_symbol`, `hover`, `definition`, `document_symbols`) returns
 * typed results, validates inputs, and honours the `lsp_not_installed`
 * contract for non-TypeScript files when the registry reports a missing
 * binary.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildLspTools,
  AGENT_LSP_TOOL_NAMES,
} from "../../src/lsp/agent-tools.js";
import type {
  LspToolResult,
  LspToolFailure,
  LspToolSuccess,
} from "../../src/lsp/agent-tools.js";
import { LanguageServerRegistry } from "../../src/lsp/server-registry.js";
import type {
  SymbolOperations,
  SymbolInfo,
  LSPLocation,
  RenameResult,
} from "../../src/lsp/symbol-operations.js";

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
    findSymbol: vi.fn(async () => [] as readonly SymbolInfo[]),
    findReferences: vi.fn(async () => [] as readonly LSPLocation[]),
    getDocumentSymbols: vi.fn(async () => [] as readonly SymbolInfo[]),
    getTypeInfo: vi.fn(async () => ""),
    rename: vi.fn(
      async (): Promise<RenameResult> => ({
        changes: new Map(),
        filesAffected: 0,
        editsApplied: 0,
      }),
    ),
    ...partial,
  } as unknown as SymbolOperations;
}

function assertSuccess(result: LspToolResult): LspToolSuccess {
  if (!result.success) {
    throw new Error(`Expected success, got failure: ${result.error}`);
  }
  return result;
}

function assertFailure(result: LspToolResult): LspToolFailure {
  if (result.success) {
    throw new Error(`Expected failure, got success`);
  }
  return result;
}

describe("buildLspTools — catalog", () => {
  it("exposes exactly six tools", () => {
    const { tools } = buildLspTools({ ops: makeMockOps() });
    expect(tools.map((t) => t.name).sort()).toEqual(
      [...AGENT_LSP_TOOL_NAMES].sort(),
    );
    expect(tools).toHaveLength(6);
  });

  it("AGENT_LSP_TOOL_NAMES matches Serena's canonical surface", () => {
    expect([...AGENT_LSP_TOOL_NAMES].sort()).toEqual(
      [
        "find_symbol",
        "find_references",
        "rename_symbol",
        "hover",
        "definition",
        "document_symbols",
      ].sort(),
    );
  });

  it("every tool has additionalProperties: false (strict mode)", () => {
    const { tools } = buildLspTools({ ops: makeMockOps() });
    for (const tool of tools) {
      expect(tool.parameters.additionalProperties).toBe(false);
    }
  });

  it("every tool has a required list", () => {
    const { tools } = buildLspTools({ ops: makeMockOps() });
    for (const tool of tools) {
      expect(tool.parameters.required.length).toBeGreaterThan(0);
    }
  });

  it("find_symbol requires name", () => {
    const { tools } = buildLspTools({ ops: makeMockOps() });
    const tool = tools.find((t) => t.name === "find_symbol");
    expect(tool?.parameters.required).toContain("name");
  });

  it("rename_symbol requires path+line+col+newName", () => {
    const { tools } = buildLspTools({ ops: makeMockOps() });
    const tool = tools.find((t) => t.name === "rename_symbol");
    expect([...(tool?.parameters.required ?? [])].sort()).toEqual(
      ["path", "line", "col", "newName"].sort(),
    );
  });

  it("hover requires path+line+col", () => {
    const { tools } = buildLspTools({ ops: makeMockOps() });
    const tool = tools.find((t) => t.name === "hover");
    expect([...(tool?.parameters.required ?? [])].sort()).toEqual(
      ["path", "line", "col"].sort(),
    );
  });
});

describe("dispatch — find_symbol", () => {
  it("returns success with symbols", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () => [makeFakeSymbol({ name: "myFunc" })]),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("find_symbol", { name: "myFunc" });
    const success = assertSuccess(result);
    const data = success.data as { symbols: Array<{ name: string }> };
    expect(data.symbols[0]?.name).toBe("myFunc");
  });

  it("applies kind filter (substring)", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () => [
        makeFakeSymbol({ name: "foo", kind: "function" }),
        makeFakeSymbol({ name: "Bar", kind: "class" }),
      ]),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("find_symbol", { name: "anything", kind: "class" });
    const success = assertSuccess(result);
    const data = success.data as { symbols: Array<{ kind: string }>; count: number };
    expect(data.count).toBe(1);
    expect(data.symbols[0]?.kind).toBe("class");
  });

  it("rejects empty name with a validation error", async () => {
    const ops = makeMockOps();
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("find_symbol", { name: "" });
    const failure = assertFailure(result);
    expect(failure.error).toContain("non-empty string");
  });

  it("respects limit parameter", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () =>
        Array.from({ length: 50 }, (_, i) => makeFakeSymbol({ name: `s${i}` })),
      ),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("find_symbol", { name: "s", limit: 5 });
    const success = assertSuccess(result);
    const data = success.data as { count: number; totalMatches: number };
    expect(data.count).toBe(5);
    expect(data.totalMatches).toBe(50);
  });

  it("uses default limit when none provided", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () =>
        Array.from({ length: 200 }, (_, i) => makeFakeSymbol({ name: `s${i}` })),
      ),
    });
    const { dispatch } = buildLspTools({ ops, defaultLimit: 100 });
    const result = await dispatch("find_symbol", { name: "s" });
    const success = assertSuccess(result);
    const data = success.data as { count: number };
    expect(data.count).toBe(100);
  });

  it("catches exceptions thrown by SymbolOperations", async () => {
    const ops = makeMockOps({
      findSymbol: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("find_symbol", { name: "x" });
    const failure = assertFailure(result);
    expect(failure.error).toContain("boom");
  });
});

describe("dispatch — find_references", () => {
  it("returns success with references", async () => {
    const ops = makeMockOps({
      findReferences: vi.fn(async () => [makeFakeLocation()]),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("find_references", {
      path: "file:///x.ts",
      line: 0,
      col: 0,
    });
    const success = assertSuccess(result);
    const data = success.data as { references: Array<{ uri: string }> };
    expect(data.references[0]?.uri).toBe("file:///src/bar.ts");
  });

  it("rejects negative line", async () => {
    const { dispatch } = buildLspTools({ ops: makeMockOps() });
    const result = await dispatch("find_references", {
      path: "x.ts",
      line: -1,
      col: 0,
    });
    const failure = assertFailure(result);
    expect(failure.error).toContain("non-negative integer");
  });

  it("rejects missing col", async () => {
    const { dispatch } = buildLspTools({ ops: makeMockOps() });
    const result = await dispatch("find_references", { path: "x.ts", line: 0 });
    assertFailure(result);
  });
});

describe("dispatch — rename_symbol", () => {
  it("returns success with edits", async () => {
    const ops = makeMockOps({
      rename: vi.fn(async () => {
        const changes = new Map<string, Array<{ range: LSPLocation["range"]; newText: string }>>();
        changes.set("/abs/src/foo.ts", [
          {
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
            newText: "newName",
          },
        ]);
        return {
          changes,
          filesAffected: 1,
          editsApplied: 1,
        };
      }),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("rename_symbol", {
      path: "file:///abs/src/foo.ts",
      line: 1,
      col: 2,
      newName: "newName",
    });
    const success = assertSuccess(result);
    const data = success.data as { filesAffected: number; editsApplied: number };
    expect(data.filesAffected).toBe(1);
    expect(data.editsApplied).toBe(1);
  });

  it("rejects invalid identifier as newName", async () => {
    const { dispatch } = buildLspTools({ ops: makeMockOps() });
    const result = await dispatch("rename_symbol", {
      path: "file:///x.ts",
      line: 0,
      col: 0,
      newName: "123abc",
    });
    const failure = assertFailure(result);
    expect(failure.error).toMatch(/valid identifier/);
  });

  it("rejects newName with spaces", async () => {
    const { dispatch } = buildLspTools({ ops: makeMockOps() });
    const result = await dispatch("rename_symbol", {
      path: "file:///x.ts",
      line: 0,
      col: 0,
      newName: "bad name",
    });
    assertFailure(result);
  });

  it("accepts newName starting with underscore", async () => {
    const { dispatch } = buildLspTools({ ops: makeMockOps() });
    const result = await dispatch("rename_symbol", {
      path: "file:///x.ts",
      line: 0,
      col: 0,
      newName: "_good",
    });
    assertSuccess(result);
  });
});

describe("dispatch — hover (honest errors)", () => {
  it("returns hover text for a TypeScript file without needing a registry", async () => {
    const ops = makeMockOps({
      getTypeInfo: vi.fn(async () => "function myFunc(x: number): string"),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("hover", {
      path: "file:///src/foo.ts",
      line: 10,
      col: 5,
    });
    const success = assertSuccess(result);
    expect((success.data as { hover: string }).hover).toContain("myFunc");
  });

  it("returns lsp_not_installed for .rs when registry says rust-analyzer is missing", async () => {
    const registry = new LanguageServerRegistry({ whichChecker: async () => false });
    const ops = makeMockOps();
    const { dispatch } = buildLspTools({ ops, registry });
    const result = await dispatch("hover", {
      path: "file:///src/main.rs",
      line: 1,
      col: 1,
    });
    const failure = assertFailure(result);
    expect(failure.lspNotInstalled?.error).toBe("lsp_not_installed");
    expect(failure.lspNotInstalled?.language).toBe("rust");
    expect(failure.error).toMatch(/rust-analyzer/);
    expect(failure.lspNotInstalled?.fix).toMatch(/rust-analyzer/);
  });

  it("returns lsp_not_installed for .py when pyright is missing", async () => {
    const registry = new LanguageServerRegistry({ whichChecker: async () => false });
    const { dispatch } = buildLspTools({ ops: makeMockOps(), registry });
    const result = await dispatch("hover", {
      path: "/abs/script.py",
      line: 0,
      col: 0,
    });
    const failure = assertFailure(result);
    expect(failure.lspNotInstalled?.language).toBe("python");
  });

  it("falls through to ops.getTypeInfo when no registry is provided (TypeScript-only mode)", async () => {
    const ops = makeMockOps({
      getTypeInfo: vi.fn(async () => "something"),
    });
    const { dispatch } = buildLspTools({ ops });
    // No registry -> even .rs files fall through to ops (which handles
    // them with a regex fallback). This preserves the legacy behaviour.
    const result = await dispatch("hover", {
      path: "file:///main.rs",
      line: 0,
      col: 0,
    });
    assertSuccess(result);
  });
});

describe("dispatch — definition (honest errors)", () => {
  it("returns the first reference as the definition location", async () => {
    const ops = makeMockOps({
      findReferences: vi.fn(async () => [makeFakeLocation({ uri: "file:///def.ts" })]),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("definition", {
      path: "file:///use.ts",
      line: 3,
      col: 5,
    });
    const success = assertSuccess(result);
    const data = success.data as { location: { uri: string } | null };
    expect(data.location?.uri).toBe("file:///def.ts");
  });

  it("returns null location when nothing matches", async () => {
    const ops = makeMockOps({
      findReferences: vi.fn(async () => []),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("definition", {
      path: "file:///use.ts",
      line: 3,
      col: 5,
    });
    const success = assertSuccess(result);
    expect((success.data as { location: unknown }).location).toBe(null);
  });

  it("returns lsp_not_installed for .go when gopls is missing", async () => {
    const registry = new LanguageServerRegistry({ whichChecker: async () => false });
    const { dispatch } = buildLspTools({ ops: makeMockOps(), registry });
    const result = await dispatch("definition", {
      path: "/abs/main.go",
      line: 0,
      col: 0,
    });
    const failure = assertFailure(result);
    expect(failure.lspNotInstalled?.language).toBe("go");
    expect(failure.lspNotInstalled?.fix).toMatch(/gopls/);
  });
});

describe("dispatch — document_symbols", () => {
  it("returns the symbol outline", async () => {
    const ops = makeMockOps({
      getDocumentSymbols: vi.fn(async () => [
        makeFakeSymbol({ name: "a" }),
        makeFakeSymbol({ name: "b" }),
      ]),
    });
    const { dispatch } = buildLspTools({ ops });
    const result = await dispatch("document_symbols", {
      path: "file:///foo.ts",
    });
    const success = assertSuccess(result);
    const data = success.data as { count: number; symbols: Array<{ name: string }> };
    expect(data.count).toBe(2);
    expect(data.symbols.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("rejects missing path", async () => {
    const { dispatch } = buildLspTools({ ops: makeMockOps() });
    const result = await dispatch("document_symbols", {});
    assertFailure(result);
  });
});

describe("dispatch — unknown tool", () => {
  it("returns error for unknown tool", async () => {
    const { dispatch } = buildLspTools({ ops: makeMockOps() });
    const result = await dispatch("nonexistent_tool", {});
    const failure = assertFailure(result);
    expect(failure.error).toContain("Unknown LSP tool");
  });
});

describe("timeout behaviour", () => {
  it("honours handlerTimeoutMs when an op hangs", async () => {
    const hangingOps = makeMockOps({
      findSymbol: () => new Promise(() => {
        /* never resolves */
      }),
    });
    const { dispatch } = buildLspTools({
      ops: hangingOps,
      handlerTimeoutMs: 25,
    });
    const result = await dispatch("find_symbol", { name: "hang" });
    const failure = assertFailure(result);
    expect(failure.error.toLowerCase()).toMatch(/timed out/);
  });
});

describe("re-exports via lsp-tools.ts (backwards compat)", () => {
  it("lsp-tools exports both the legacy 4-tool catalog and the new factory", async () => {
    const legacy = await import("../../src/lsp/lsp-tools.js");
    // Legacy exports remain intact.
    expect(legacy.LSP_TOOLS).toBeDefined();
    expect(legacy.dispatchLspTool).toBeDefined();
    expect(legacy.LSP_TOOL_NAMES).toBeDefined();
    // New factory re-exported from the same module.
    expect(legacy.buildLspTools).toBeDefined();
    expect(legacy.AGENT_LSP_TOOL_NAMES).toBeDefined();
    expect(legacy.LanguageServerRegistry).toBeDefined();
    expect(legacy.LSP_SERVER_CATALOG).toBeDefined();
  });
});
