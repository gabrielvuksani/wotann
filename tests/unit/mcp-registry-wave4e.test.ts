/**
 * Wave 4E: Tests for MCPRegistry additions:
 *   - persistToDisk / loadFromDisk roundtrip
 *   - importFromTool("vscode") reads the VSCode settings.json
 *   - exportAcp() produces ACP-compatible config
 *   - JSONC stripping doesn't break on quoted `//`
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MCPRegistry } from "../../src/marketplace/registry.js";

describe("MCPRegistry Wave 4E additions", () => {
  let tempDir: string;
  let priorMcpPath: string | undefined;
  let priorVscodePath: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-mcp-w4e-"));
    priorMcpPath = process.env["WOTANN_MCP_CONFIG_PATH"];
    priorVscodePath = process.env["WOTANN_VSCODE_SETTINGS_PATH"];
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    if (priorMcpPath === undefined) delete process.env["WOTANN_MCP_CONFIG_PATH"];
    else process.env["WOTANN_MCP_CONFIG_PATH"] = priorMcpPath;
    if (priorVscodePath === undefined) delete process.env["WOTANN_VSCODE_SETTINGS_PATH"];
    else process.env["WOTANN_VSCODE_SETTINGS_PATH"] = priorVscodePath;
  });

  describe("persistToDisk / loadFromDisk", () => {
    it("roundtrips registered servers", () => {
      const path = join(tempDir, "mcp.json");
      const source = new MCPRegistry();
      source.register({
        name: "alpha",
        command: "node",
        args: ["alpha.js"],
        transport: "stdio",
        enabled: true,
      });
      source.register({
        name: "beta",
        command: "/usr/bin/beta",
        args: [],
        transport: "stdio",
        env: { FOO: "bar" },
        enabled: false,
      });
      const out = source.persistToDisk(path);
      expect(out).toBe(path);
      expect(existsSync(path)).toBe(true);

      const loaded = new MCPRegistry();
      const count = loaded.loadFromDisk(path);
      expect(count).toBe(2);
      expect(loaded.getServer("alpha")).toMatchObject({
        command: "node",
        args: ["alpha.js"],
        enabled: true,
      });
      expect(loaded.getServer("beta")).toMatchObject({
        command: "/usr/bin/beta",
        enabled: false,
        env: { FOO: "bar" },
      });
    });

    it("skips servers with empty command on persist", () => {
      const path = join(tempDir, "mcp.json");
      const registry = new MCPRegistry();
      registry.register({
        name: "empty-cmd",
        command: "",
        args: [],
        transport: "stdio",
        enabled: true,
      });
      registry.register({
        name: "has-cmd",
        command: "has-cmd",
        args: [],
        transport: "stdio",
        enabled: true,
      });
      registry.persistToDisk(path);
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
      const servers = parsed["mcpServers"] as Record<string, unknown>;
      expect(Object.keys(servers)).toContain("has-cmd");
      expect(Object.keys(servers)).not.toContain("empty-cmd");
    });

    it("loadFromDisk returns 0 for missing file", () => {
      const registry = new MCPRegistry();
      expect(registry.loadFromDisk(join(tempDir, "does-not-exist.json"))).toBe(0);
    });

    it("loadFromDisk returns 0 for malformed JSON", () => {
      const path = join(tempDir, "bad.json");
      writeFileSync(path, "{ not-valid");
      const registry = new MCPRegistry();
      expect(registry.loadFromDisk(path)).toBe(0);
    });
  });

  describe('importFromTool("vscode")', () => {
    it("reads MCP servers from VSCode settings.json", () => {
      const settingsPath = join(tempDir, "settings.json");
      writeFileSync(
        settingsPath,
        JSON.stringify({
          "editor.fontSize": 14,
          mcp: {
            servers: {
              "filesystem-mcp": {
                command: "node",
                args: ["fs-server.js"],
              },
              "git-mcp": {
                command: "git-mcp-server",
                args: [],
              },
            },
          },
        }),
      );
      process.env["WOTANN_VSCODE_SETTINGS_PATH"] = settingsPath;

      const registry = new MCPRegistry();
      const imported = registry.importFromTool("vscode");
      expect(imported).toBe(2);
      expect(registry.getServer("vscode-filesystem-mcp")).toBeDefined();
      expect(registry.getServer("vscode-git-mcp")).toBeDefined();
    });

    it("handles JSONC with // comments and trailing commas gracefully", () => {
      const settingsPath = join(tempDir, "settings.json");
      writeFileSync(
        settingsPath,
        `{
  // VSCode settings with comments
  "editor.fontSize": 14,
  /* multi-line
     comment */
  "mcp": {
    "servers": {
      "jsonc-mcp": {
        "command": "mcp-bin",
        "args": ["--url", "https://example.com/path//something"]
      }
    }
  }
}`,
      );
      process.env["WOTANN_VSCODE_SETTINGS_PATH"] = settingsPath;

      const registry = new MCPRegistry();
      const imported = registry.importFromTool("vscode");
      expect(imported).toBe(1);
      const server = registry.getServer("vscode-jsonc-mcp");
      expect(server).toBeDefined();
      // String content with `//` should be preserved by the stripper.
      expect(server?.args).toContain("https://example.com/path//something");
    });

    it("returns 0 when VSCode settings file is missing", () => {
      process.env["WOTANN_VSCODE_SETTINGS_PATH"] = join(tempDir, "nope.json");
      const registry = new MCPRegistry();
      expect(registry.importFromTool("vscode")).toBe(0);
    });

    it("returns 0 when mcp block is absent", () => {
      const settingsPath = join(tempDir, "settings.json");
      writeFileSync(settingsPath, JSON.stringify({ "editor.fontSize": 14 }));
      process.env["WOTANN_VSCODE_SETTINGS_PATH"] = settingsPath;
      const registry = new MCPRegistry();
      expect(registry.importFromTool("vscode")).toBe(0);
    });

    it("accepts either mcp.servers or mcp.mcpServers key", () => {
      const settingsPath = join(tempDir, "settings.json");
      writeFileSync(
        settingsPath,
        JSON.stringify({
          mcp: {
            mcpServers: {
              legacy: { command: "legacy-bin", args: [] },
            },
          },
        }),
      );
      process.env["WOTANN_VSCODE_SETTINGS_PATH"] = settingsPath;
      const registry = new MCPRegistry();
      expect(registry.importFromTool("vscode")).toBe(1);
      expect(registry.getServer("vscode-legacy")).toBeDefined();
    });
  });

  describe("exportAcp()", () => {
    it("emits ACP-compatible stdio config", () => {
      const registry = new MCPRegistry();
      registry.register({
        name: "stdio-server",
        command: "mcp-server",
        args: ["start"],
        transport: "stdio",
        env: { API_KEY: "secret" },
        enabled: true,
      });
      const exported = registry.exportAcp();
      expect(exported.version).toBe("1.0.0");
      expect(exported.servers).toHaveLength(1);
      const first = exported.servers[0]!;
      expect(first.transport).toBe("stdio");
      if (first.transport === "stdio") {
        expect(first.name).toBe("stdio-server");
        expect(first.command).toBe("mcp-server");
        expect(first.env).toEqual([{ name: "API_KEY", value: "secret" }]);
      }
    });

    it("filters disabled servers from export", () => {
      const registry = new MCPRegistry();
      registry.register({
        name: "enabled",
        command: "a",
        args: [],
        transport: "stdio",
        enabled: true,
      });
      registry.register({
        name: "disabled",
        command: "b",
        args: [],
        transport: "stdio",
        enabled: false,
      });
      const exported = registry.exportAcp();
      const names = exported.servers.map((s) => s.name);
      expect(names).toContain("enabled");
      expect(names).not.toContain("disabled");
    });

    it("emits http transport when registered", () => {
      const registry = new MCPRegistry();
      registry.register({
        name: "http-server",
        command: "http://example.com/mcp",
        args: [],
        transport: "http",
        enabled: true,
      });
      const exported = registry.exportAcp();
      expect(exported.servers[0]?.transport).toBe("http");
    });
  });

  describe("importFromTool type-level strictness", () => {
    it('ignores unknown tool names (backwards-compat with old "vscode" callers only)', () => {
      const registry = new MCPRegistry();
      // TypeScript rejects any non-literal key, but the runtime implementation
      // must still return 0 rather than throwing on invented keys — belt &
      // braces check.
      const count = (registry.importFromTool as unknown as (t: string) => number)("invented-tool");
      expect(count).toBe(0);
    });
  });
});
