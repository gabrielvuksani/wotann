/**
 * .mcpb (Claude Desktop Plugin Bundle) format reader / writer.
 *
 * Source: claude-task-master's manifest.json
 *   (research/claude-task-master/manifest.json) — root MCP server bundle
 *   declared with manifest_version="0.3", typed user_config schema, and
 *   server.mcp_config (command/args/env). The .mcpb format is the Claude
 *   Desktop standard for distributing MCP servers; teammates double-click
 *   a .mcpb to install.
 *
 * v1 scope: this module supports the SINGLE-FILE form — a bare
 * `manifest.json` (or .mcpb file containing just JSON content). The full
 * .mcpb spec is a zip bundle, but no zip dependency exists in
 * package.json today and the prompt forbids adding one. We support the
 * JSON form natively and document the zip limitation in `parseMcpb`.
 *
 * Round-trip contract:
 *   - serializeMcpb(server)  → JSON string matching .mcpb manifest_version 0.3
 *   - parseMcpb(jsonString)  → McpbManifest (after structural validation)
 *
 * Wiring: `wotann mcp export-mcpb` (in src/index.ts) calls serializeMcpb,
 * `wotann mcp import-mcpb` calls parseMcpb and re-uses the existing
 * `mcp add` write logic to persist into ~/.wotann/wotann.yaml.
 */

import { existsSync, readFileSync } from "node:fs";
import type { MCPServerConfig } from "./registry.js";

// ── Public Types ────────────────────────────────────────

/**
 * .mcpb manifest_version 0.3 shape. Field names match
 * claude-task-master/manifest.json verbatim. Optional fields are marked
 * accordingly so we accept the minimum viable form (server.mcp_config
 * only) while still emitting the richer fields when WOTANN has them.
 */
export interface McpbManifest {
  readonly manifest_version: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly author?: McpbAuthor;
  readonly repository?: McpbRepository;
  readonly icon?: string;
  readonly server: McpbServerSection;
  readonly user_config?: Record<string, McpbUserConfigField>;
  readonly tools?: readonly McpbTool[];
}

export interface McpbAuthor {
  readonly name: string;
  readonly url?: string;
  readonly email?: string;
}

export interface McpbRepository {
  readonly type: string;
  readonly url: string;
}

export interface McpbServerSection {
  /** "node" | "python" | "binary" — matches the Claude Desktop spec. */
  readonly type: string;
  readonly entry_point?: string;
  readonly mcp_config: McpbMcpConfig;
}

export interface McpbMcpConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
}

export interface McpbUserConfigField {
  readonly type: "string" | "number" | "boolean";
  readonly title?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly sensitive?: boolean;
  readonly default?: string | number | boolean;
}

export interface McpbTool {
  readonly name: string;
  readonly description?: string;
}

// ── Reader ──────────────────────────────────────────────

export interface ParseMcpbResult {
  readonly ok: boolean;
  readonly manifest?: McpbManifest;
  readonly error?: string;
}

/**
 * Parse a .mcpb manifest from a file path.
 *
 * Supports the SINGLE-FILE form (a JSON file ending in either `.mcpb` or
 * `.json`). The full .mcpb zip-bundle form is not supported in v1 because
 * package.json carries no zip dependency. We detect the zip magic number
 * (PK\x03\x04) and return a structured error so users get a clear message
 * instead of a JSON-parse explosion deep in the stack.
 *
 * Validation: structural only — manifest_version, name, version, and
 * server.mcp_config.command must all be present and non-empty. We do NOT
 * validate user_config or tools further; those are advisory metadata.
 */
export function parseMcpb(filePath: string): ParseMcpbResult {
  if (!existsSync(filePath)) {
    return { ok: false, error: `file not found: ${filePath}` };
  }

  let raw: Buffer;
  try {
    raw = readFileSync(filePath);
  } catch (err) {
    return {
      ok: false,
      error: `read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Detect zip magic number (PK\x03\x04). The full .mcpb spec is a zip,
  // but we'd need a zip dep to extract it — refuse honestly rather than
  // silently misparse.
  if (raw.length >= 4 && raw[0] === 0x50 && raw[1] === 0x4b && raw[2] === 0x03 && raw[3] === 0x04) {
    return {
      ok: false,
      error:
        "zip-form .mcpb not supported in v1 (no zip dep in package.json). " +
        "Unzip externally and pass the inner manifest.json: " +
        "`unzip -p file.mcpb manifest.json | wotann mcp import-mcpb /dev/stdin`",
    };
  }

  return parseMcpbJson(raw.toString("utf-8"));
}

/**
 * Parse a .mcpb manifest from a raw JSON string. Exposed for callers that
 * already hold the JSON in memory (stdin pipes, test fixtures).
 */
export function parseMcpbJson(json: string): ParseMcpbResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      error: `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "manifest is not a JSON object" };
  }

  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj["manifest_version"] !== "string" ||
    typeof obj["name"] !== "string" ||
    typeof obj["version"] !== "string"
  ) {
    return {
      ok: false,
      error: "missing required fields: manifest_version, name, version",
    };
  }

  const server = obj["server"];
  if (typeof server !== "object" || server === null) {
    return { ok: false, error: "missing required field: server" };
  }
  const serverObj = server as Record<string, unknown>;
  const mcpConfig = serverObj["mcp_config"];
  if (typeof mcpConfig !== "object" || mcpConfig === null) {
    return { ok: false, error: "missing required field: server.mcp_config" };
  }
  const mcpConfigObj = mcpConfig as Record<string, unknown>;
  if (typeof mcpConfigObj["command"] !== "string" || mcpConfigObj["command"].length === 0) {
    return {
      ok: false,
      error: "missing required field: server.mcp_config.command",
    };
  }

  // Coerce args to string[] — Claude Desktop sometimes emits a single
  // string in the `args` slot (not an array); we accept both forms.
  const argsRaw = mcpConfigObj["args"];
  let args: string[];
  if (Array.isArray(argsRaw)) {
    args = argsRaw.map((a) => String(a));
  } else if (typeof argsRaw === "string") {
    args = [argsRaw];
  } else {
    args = [];
  }

  const envRaw = mcpConfigObj["env"];
  let env: Record<string, string> | undefined;
  if (typeof envRaw === "object" && envRaw !== null) {
    env = {};
    for (const [k, v] of Object.entries(envRaw as Record<string, unknown>)) {
      env[k] = String(v);
    }
  }

  // Build a normalized manifest. Optional fields are passed through only
  // when the source had them, to keep round-trips clean.
  const manifest: McpbManifest = {
    manifest_version: obj["manifest_version"] as string,
    name: obj["name"] as string,
    version: obj["version"] as string,
    ...(typeof obj["description"] === "string" && {
      description: obj["description"] as string,
    }),
    ...(typeof obj["icon"] === "string" && { icon: obj["icon"] as string }),
    server: {
      type: typeof serverObj["type"] === "string" ? (serverObj["type"] as string) : "node",
      ...(typeof serverObj["entry_point"] === "string" && {
        entry_point: serverObj["entry_point"] as string,
      }),
      mcp_config: {
        command: mcpConfigObj["command"] as string,
        args,
        ...(env && { env }),
      },
    },
  };

  return { ok: true, manifest };
}

// ── Writer ──────────────────────────────────────────────

export interface SerializeMcpbOptions {
  /** Manifest version to emit. Defaults to claude-task-master's "0.3". */
  readonly manifestVersion?: string;
  /** Display name override. Defaults to server.name. */
  readonly name?: string;
  /** Bundle version. Defaults to "0.0.0" (caller should set explicitly). */
  readonly version?: string;
  readonly description?: string;
  readonly author?: McpbAuthor;
}

/**
 * Serialize a single MCPServerConfig to a .mcpb manifest JSON string.
 *
 * Output is the SINGLE-FILE form — drop the result into a `.mcpb` file
 * and Claude Desktop should accept it. (For full zip-bundle distribution,
 * users will need to wrap the manifest.json plus any binaries; that's
 * out of scope here.)
 *
 * Pretty-printed with 2-space indent for human readability — matches
 * the style claude-task-master uses in its committed manifest.json.
 */
export function serializeMcpb(server: MCPServerConfig, options: SerializeMcpbOptions = {}): string {
  const manifest: McpbManifest = {
    manifest_version: options.manifestVersion ?? "0.3",
    name: options.name ?? server.name,
    version: options.version ?? "0.0.0",
    ...(options.description && { description: options.description }),
    ...(options.author && { author: options.author }),
    server: {
      // Best-effort type inference: if the command points at python, mark
      // python; if it has a trailing .js / .mjs / npx, mark node; else
      // "binary". This is just metadata — Claude Desktop primarily uses
      // the mcp_config.command field.
      type: inferServerType(server.command),
      mcp_config: {
        command: server.command,
        args: [...server.args],
        ...(server.env && Object.keys(server.env).length > 0 && { env: { ...server.env } }),
      },
    },
  };

  return JSON.stringify(manifest, null, 2);
}

/**
 * Convert a parsed manifest back into an MCPServerConfig (the WOTANN
 * registry's native shape). Used by the import flow in src/index.ts to
 * turn the .mcpb into a row in ~/.wotann/wotann.yaml.
 */
export function manifestToServerConfig(
  manifest: McpbManifest,
  override?: { transport?: "stdio" | "http"; enabled?: boolean },
): MCPServerConfig {
  return {
    name: manifest.name,
    command: manifest.server.mcp_config.command,
    args: manifest.server.mcp_config.args,
    transport: override?.transport ?? "stdio",
    ...(manifest.server.mcp_config.env && {
      env: manifest.server.mcp_config.env,
    }),
    enabled: override?.enabled ?? true,
  };
}

// ── Internals ───────────────────────────────────────────

function inferServerType(command: string): string {
  const lower = command.toLowerCase();
  if (
    lower === "python" ||
    lower === "python3" ||
    lower.endsWith("/python") ||
    lower.endsWith("/python3")
  ) {
    return "python";
  }
  if (lower === "node" || lower === "npx" || lower.endsWith("/node") || lower.endsWith("/npx")) {
    return "node";
  }
  return "binary";
}
