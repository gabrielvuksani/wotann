/**
 * Design Bridge MCP server — V9 Tier 8 T8.6.
 *
 * Exposes `wotann design extract / verify / apply` as MCP tools so any
 * MCP-speaking client (Claude Code, Cursor, Zed, Claude Desktop) can
 * invoke WOTANN as a design bridge without running the CLI.
 *
 * This module ONLY ships the `ToolHostAdapter` contract the
 * `mcp-server.ts` wire consumes. It does not own the MCP protocol
 * implementation — `mcp-server.ts` does.
 *
 * ── Tools exposed ─────────────────────────────────────────────────────────
 *   design.extract   — scan workspace → emit DTCG v6.3 JSON
 *   design.verify    — parse a bundle + diff against local workspace
 *   design.apply     — parse + stage token changes for human review
 *
 * "Apply" stops at the staging step by design. The MCP client never has
 * authority to write files on the user's machine without the user's own
 * approval loop; this server's output is the list of proposed changes.
 *
 * ── WOTANN quality bars ───────────────────────────────────────────────────
 *  - QB #6 honest failures: every tool returns
 *    `{ isError: true, content: [{ type: "text", text: <error> }] }` on
 *    failure — never a silent empty result.
 *  - QB #7 per-call state: the adapter captures its config once at
 *    `createDesignBridgeAdapter(opts)`; no module-level caches or singletons.
 *    Two adapters in the same process are fully independent.
 *  - QB #13 env guard: the `workspaceDir` and every path input arrive
 *    through function arguments. No `process.env` reads.
 *  - QB #11 sibling-site scan: `src/design/extractor.ts` +
 *    `src/design/handoff-receiver.ts` + `src/design/dtcg-emitter.ts` +
 *    `src/design/bundle-diff.ts` are the authorities on their surfaces;
 *    this server only composes them.
 */

import type { McpToolCallResult, McpToolDefinition, ToolHostAdapter } from "../mcp-server.js";
import { DesignExtractor, type DesignSystem } from "../../design/extractor.js";
import { emitDtcg, serializeDtcg, type DtcgBundle } from "../../design/dtcg-emitter.js";
import { parseHandoffBundle, type HandoffBundle } from "../../design/handoff-receiver.js";
import {
  diffBundles,
  formatDiff,
  type BundleDiff,
  type DiffEntry,
} from "../../design/bundle-diff.js";
import { parseDesignTokens, type DesignTokens } from "../../design/design-tokens-parser.js";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * Injection surface for the adapter. All external I/O is passed in so
 * tests can exercise the full tool surface without touching the real
 * filesystem. Defaults cover production.
 */
export interface DesignBridgeAdapterOptions {
  /**
   * Absolute path to the workspace root the `design.extract` /
   * `design.verify` / `design.apply` tools scan. Required — no
   * fallback to cwd so there's no ambiguity about which workspace
   * was scanned.
   */
  readonly workspaceDir: string;
  /**
   * Optional extractor injection. Production uses a fresh
   * `DesignExtractor`; tests pass a stub that returns a fixture.
   */
  readonly extractor?: (workspaceDir: string) => DesignSystem;
  /**
   * Optional bundle parser injection. Production uses
   * `parseHandoffBundle` (reads a .zip path); tests inject a function
   * that returns a pre-built `HandoffBundle` so the suite stays ZIP-
   * free.
   */
  readonly bundleParser?: (bundlePath: string) => HandoffBundle;
}

// ═══ Tool definitions ═════════════════════════════════════════════════════

const DESIGN_EXTRACT_TOOL: McpToolDefinition = {
  name: "design.extract",
  description:
    "Scan the active workspace for design tokens (colors, spacing, typography) and emit a W3C DTCG v6.3 JSON bundle. Input is optional; pass includeFrequencyMeta=true to annotate tokens with how many files each appeared in.",
  inputSchema: {
    type: "object",
    properties: {
      includeFrequencyMeta: {
        type: "boolean",
        description:
          "When true, every leaf token gets a $description with its frequency/usage count (useful for debugging promotion).",
      },
    },
    required: [],
    additionalProperties: false,
  },
};

const DESIGN_VERIFY_TOOL: McpToolDefinition = {
  name: "design.verify",
  description:
    "Compare a W3C DTCG handoff bundle against the workspace's current design system. Returns the structured diff plus a plain-text summary. Use to detect drift in CI before merging.",
  inputSchema: {
    type: "object",
    properties: {
      bundlePath: {
        type: "string",
        description:
          "Absolute path to a handoff bundle .zip (or parsed bundle directory) to compare against.",
      },
    },
    required: ["bundlePath"],
    additionalProperties: false,
  },
};

const DESIGN_APPLY_TOOL: McpToolDefinition = {
  name: "design.apply",
  description:
    "Parse a handoff bundle, compute the diff against the workspace, and return the list of staged changes. The MCP server does NOT write to disk — the caller shows the staged list to the user and commits through its own approval flow.",
  inputSchema: {
    type: "object",
    properties: {
      bundlePath: {
        type: "string",
        description: "Absolute path to the handoff bundle to stage.",
      },
    },
    required: ["bundlePath"],
    additionalProperties: false,
  },
};

const TOOL_LIST: readonly McpToolDefinition[] = [
  DESIGN_EXTRACT_TOOL,
  DESIGN_VERIFY_TOOL,
  DESIGN_APPLY_TOOL,
];

// ═══ Helpers ══════════════════════════════════════════════════════════════

function okResult(text: string): McpToolCallResult {
  return { content: [{ type: "text", text }] };
}

function errResult(reason: string): McpToolCallResult {
  return {
    content: [{ type: "text", text: reason }],
    isError: true,
  };
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`argument "${name}" must be a non-empty string`);
  }
  return value;
}

/**
 * DTCG tokens produced from the extractor's output. Used internally
 * by the verify + apply tools so both sides of the diff share the
 * same shape.
 */
function dtcgFromSystem(system: DesignSystem): DtcgBundle {
  return emitDtcg(system);
}

/**
 * DTCG bundle derived from a handoff bundle's parsed tokens. We walk
 * `designSystem` and re-project its tokens into the DtcgBundle shape
 * our diff engine expects.
 */
function dtcgFromTokens(tokens: DesignTokens): DtcgBundle {
  const bundle: DtcgBundle = {
    colors: {},
    spacing: {},
    typography: {},
    borderRadius: {},
    shadows: {},
    extras: {},
  };
  const project = (
    entries: readonly DesignTokens["colors"][number][],
    bucketKey: keyof DtcgBundle,
    defaultType: string,
  ): void => {
    const bucket = bundle[bucketKey] as Record<string, unknown>;
    for (const e of entries) {
      const key = e.name;
      bucket[key] = {
        $type: defaultType,
        $value: e.value,
      };
    }
  };
  project(tokens.colors, "colors", "color");
  project(tokens.spacing, "spacing", "dimension");
  project(tokens.typography, "typography", "typography");
  project(tokens.borderRadius, "borderRadius", "dimension");
  project(tokens.shadows, "shadows", "shadow");
  project(tokens.extras, "extras", "other");
  return bundle;
}

function summarizeDiffForMcp(diff: BundleDiff): {
  readonly summary: string;
  readonly changeCount: number;
  readonly addedPaths: readonly string[];
  readonly removedPaths: readonly string[];
  readonly changedPaths: readonly string[];
} {
  const toPath = (e: DiffEntry): string => e.path.join(".");
  return {
    summary: formatDiff(diff),
    changeCount: diff.added.length + diff.removed.length + diff.changed.length,
    addedPaths: diff.added.map(toPath),
    removedPaths: diff.removed.map(toPath),
    changedPaths: diff.changed.map(toPath),
  };
}

// ═══ Adapter factory ══════════════════════════════════════════════════════

/**
 * Build a `ToolHostAdapter` the `mcp-server.ts` wire can consume.
 * Callers typically mount the returned adapter like this:
 *
 *   runMcpServer({
 *     info: { name: "wotann-design-bridge", version: "0.5.0" },
 *     adapter: createDesignBridgeAdapter({ workspaceDir: process.cwd() }),
 *   });
 *
 * The caller owns the MCP transport; this module just shapes the tool
 * surface.
 */
export function createDesignBridgeAdapter(options: DesignBridgeAdapterOptions): ToolHostAdapter {
  if (typeof options.workspaceDir !== "string" || options.workspaceDir.length === 0) {
    throw new Error("createDesignBridgeAdapter: workspaceDir is required");
  }
  const workspaceDir = options.workspaceDir;
  const extractFn = options.extractor ?? ((dir: string) => new DesignExtractor().extract(dir));
  const parseFn = options.bundleParser ?? ((path: string) => parseHandoffBundle(path));

  async function callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    try {
      if (name === "design.extract") {
        const system = extractFn(workspaceDir);
        const bundle = dtcgFromSystem(system);
        const payload = {
          ok: true,
          workspaceDir,
          filesScanned: system.filesScanned,
          paletteCount: system.palettes.length,
          spacingCount: system.spacing.length,
          bundle,
          dtcgJson: serializeDtcg(bundle),
        };
        return okResult(JSON.stringify(payload, null, 2));
      }

      if (name === "design.verify") {
        const bundlePath = assertString(args["bundlePath"], "bundlePath");
        const imported = parseFn(bundlePath);
        const localSystem = extractFn(workspaceDir);
        const localBundle = dtcgFromSystem(localSystem);
        const importedBundle = dtcgFromTokens(imported.tokens);
        const diff = diffBundles(localBundle, importedBundle);
        const summary = summarizeDiffForMcp(diff);
        return okResult(
          JSON.stringify(
            {
              ok: true,
              hasDrift: summary.changeCount > 0,
              ...summary,
            },
            null,
            2,
          ),
        );
      }

      if (name === "design.apply") {
        const bundlePath = assertString(args["bundlePath"], "bundlePath");
        const imported = parseFn(bundlePath);
        const localSystem = extractFn(workspaceDir);
        const localBundle = dtcgFromSystem(localSystem);
        const importedBundle = dtcgFromTokens(imported.tokens);
        const diff = diffBundles(localBundle, importedBundle);
        // The MCP server never writes. We return the staged list; the
        // client walks the user through approval. Per-entry payload
        // keeps the alias + shape distinction so surfaces can render
        // differently for group vs token changes.
        const staged = [
          ...diff.added.map((e) => ({ kind: "added" as const, path: e.path })),
          ...diff.removed.map((e) => ({ kind: "removed" as const, path: e.path })),
          ...diff.changed
            .filter((e) => e.kind === "changed")
            .map((e) => ({
              kind: "changed" as const,
              path: e.path,
              field: e.field,
            })),
        ];
        return okResult(
          JSON.stringify(
            {
              ok: true,
              stagedCount: staged.length,
              staged,
              message:
                "MCP server does not write to disk. Use the staged list with your own approval flow.",
            },
            null,
            2,
          ),
        );
      }

      return errResult(`unknown tool: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errResult(`tool ${name} failed: ${msg}`);
    }
  }

  return {
    listTools: () => TOOL_LIST,
    callTool,
  };
}

/**
 * Re-export the tool list so callers (tests, other servers) can
 * enumerate without building a full adapter instance.
 */
export function listDesignBridgeTools(): readonly McpToolDefinition[] {
  return TOOL_LIST;
}

/**
 * Re-export types for round-trip tests + integration test matrix.
 */
export { parseDesignTokens };
