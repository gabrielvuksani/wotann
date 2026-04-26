/**
 * wotann mcp-server — expose WOTANN as an MCP server (Phase 5C).
 *
 * The inverse of an MCP client: WOTANN is HOSTED by another tool
 * (Cursor, Claude-Code, Zed, etc.) over stdio. The host invokes
 * WOTANN's tools — memory_search, find_symbol, run_workflow, etc. —
 * as first-class tool calls in its own agent loop.
 *
 * This means a user can add WOTANN's memory + symbol index + workflow
 * runner to their existing agent without replacing it. One day you
 * use Cursor; the next day you use WOTANN standalone. Same skills,
 * same memory, same tools.
 *
 * Protocol: MCP 2025-11-25 JSON-RPC over stdio (current spec). Backward-
 * compatible with 2024-11-05 and 2025-06-18 via version negotiation in
 * the `initialize` handler — the client's `params.protocolVersion` is
 * echoed back when supported, otherwise the server falls back to its
 * latest supported version + logs a warning (QB#6 honest fallback).
 * Implements:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *   - prompts/list — NOT advertised. Capability dropped from `initialize`
 *     so spec-compliant clients won't ask. A defensive `prompts/list`
 *     handler still returns `[]` for misbehaving clients (V9 Wave 3-N
 *     audit fix per QB#6: don't advertise capabilities you can't honor).
 *   - resources/list (V9 T4.1 — returns WOTANN's MCP Apps UI resources)
 *   - resources/read (V9 T4.1 — returns rendered HTML for ui://wotann/* URIs)
 *   - shutdown
 *
 * Callers provide a ToolHostAdapter with the actual WOTANN tool
 * implementations. This module owns ONLY the MCP protocol wire.
 *
 * Security: the server trusts the calling MCP client (it's running in
 * the user's own process). No auth. Tool execution permissions are the
 * client's responsibility.
 */

import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { loadToolsWithOptions, resolveTier, type McpTier, type TieredTool } from "./tool-loader.js";
// V9 T4.1 — WOTANN MCP Apps UI resource registry (SEP-1865).
import { listUiResources, readUiResource } from "./ui-resources.js";
// V9 T14.1 — Elicitation registry: server→client structured-input requests.
// The server holds a registry per-instance (QB #7 per-call state, no
// module singleton). The registry is exposed via getElicitationRegistry()
// so wiring code can attach a UI handler at composition time.
import {
  createElicitationRegistry,
  parseElicitationRequest,
  parseElicitationResult,
  type ElicitationRegistry,
  type ElicitationRequest,
} from "./elicitation.js";

// ── Types ──────────────────────────────────────────────

/**
 * Default MCP protocol version this server speaks (V9 Wave 5-DD H-39a).
 * Bumped to current spec "2025-11-25". Older clients still get their
 * own version echoed back when they advertise one we support — see
 * `SUPPORTED_PROTOCOL_VERSIONS` and the negotiation logic in the
 * `initialize` dispatch handler.
 */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

/**
 * Versions this server can speak. Order is purely informational — the
 * negotiation uses set membership, not preference. When a client
 * requests a listed version we echo it back; when it requests anything
 * else we fall back to `MCP_PROTOCOL_VERSION` + log a warn so the
 * client sees a downgrade rather than a silent mismatch (QB#6).
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2024-11-05",
  "2025-06-18",
  "2025-11-25",
];

export interface McpServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
  };
}

export interface McpToolCallResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>;
  readonly isError?: boolean;
}

export interface ToolHostAdapter {
  readonly listTools: () => readonly McpToolDefinition[];
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
}

/**
 * V9 Wave 5-II — `mcp_tool` hook event callback.
 *
 * Fired immediately before each `tools/call` dispatch so consumers can
 * attach observability, audit logging, auto-approval, or policy
 * decisions to MCP-sourced tool calls without having to wrap every
 * adapter. Mirrors Claude Code v2.1.118 / V14.43 hook taxonomy where
 * `mcp_tool` distinguishes MCP-driven invocations from native tool
 * calls in PreToolUse/PostToolUse handlers.
 *
 * Contract (QB #6, #7):
 *   - The callback is fire-and-forget. Its return value is ignored and
 *     the MCP `tools/call` always proceeds — this is a notification
 *     surface, not a gate. Hosts that want gating should additionally
 *     wire PreToolUse on the runtime side.
 *   - Errors thrown by the callback are caught + logged to stderr and
 *     never block the underlying tool call (QB #6 — hook failure does
 *     not break the tool path).
 *   - Stateless per-call: nothing is retained between invocations on the
 *     server side beyond what the callback itself chooses to persist.
 *
 * The shape mirrors the runtime's `HookEngine.fire()` payload contract so
 * a composition root can adapt with a single arrow function. The MCP
 * module stays decoupled from `src/hooks/engine.ts` (no import) — same
 * separation pattern as the elicitation registry.
 */
export type McpToolHookCallback = (event: {
  readonly event: "mcp_tool";
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  readonly tier: McpTier | null;
  readonly timestamp: number;
}) => void | Promise<void>;

export interface McpServerOptions {
  readonly info: McpServerInfo;
  readonly adapter: ToolHostAdapter;
  readonly stdin?: Readable;
  readonly stdout?: Writable;
  readonly stderr?: Writable;
  /**
   * Optional `mcp_tool` hook callback (V9 Wave 5-II). When supplied, the
   * server fires this before each `tools/call` dispatch. See
   * `McpToolHookCallback` for the full contract.
   */
  readonly onMcpToolCall?: McpToolHookCallback;
  /**
   * Optional MCP tier scope (Lane 2 #10 — task-master parity). When
   * set, the server filters the adapter's `listTools()` output to the
   * tier-appropriate subset using `tool-loader.ts`. When omitted, the
   * server reads `WOTANN_MCP_TIER` at construction time; when that's
   * also absent the adapter's tools pass through unfiltered (legacy
   * behaviour for callers that manage their own tier selection).
   *
   * Only the NAMES are matched — the adapter still owns the authoritative
   * definition + callTool implementation. A tier filter therefore cannot
   * surface a tool the adapter doesn't expose; it only narrows the catalogue.
   */
  readonly tier?: McpTier;
  /**
   * Override the environment used for tier resolution (test hook).
   * Production callers should leave this undefined so `process.env` is used.
   */
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Optional custom registry passed to `loadToolsWithOptions` when a tier
   * is active. Defaults to `DEFAULT_TIERED_TOOLS` inside the loader.
   */
  readonly tieredRegistry?: readonly TieredTool[];
}

// ── JSON-RPC envelope ─────────────────────────────────

interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

// ── Server ─────────────────────────────────────────────

export class WotannMcpServer {
  private readonly info: McpServerInfo;
  private readonly adapter: ToolHostAdapter;
  private readonly stdin: Readable;
  private readonly stdout: Writable;
  private readonly stderr: Writable;
  private rl: Interface | null = null;
  private initialized = false;
  private closed = false;
  /**
   * Names of tools allowed to pass through `tools/list`. `null` means
   * no tier filter is active and the adapter's full catalogue is
   * exposed (legacy behaviour). Resolved once at construction so the
   * tier decision is stable for the life of the server.
   */
  private readonly tierAllowlist: ReadonlySet<string> | null;
  private readonly activeTier: McpTier | null;
  /**
   * Per-server elicitation registry (V9 T14.1). Wires server→client
   * structured-input requests so MCP clients (Claude, Cursor, etc.)
   * can drive WOTANN tools that need mid-call user input. Created per
   * server instance — QB #7 per-call state.
   */
  private readonly elicitationRegistry: ElicitationRegistry;
  /**
   * V9 Wave 5-II — Optional `mcp_tool` hook callback. Captured at
   * construction so the dispatch path can read it without a property
   * lookup against `options` after the fact. `null` when not wired.
   */
  private readonly onMcpToolCall: McpToolHookCallback | null;

  constructor(options: McpServerOptions) {
    this.info = options.info;
    this.adapter = options.adapter;
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.stderr = options.stderr ?? process.stderr;
    this.onMcpToolCall = options.onMcpToolCall ?? null;

    // Tier resolution — explicit option wins, then WOTANN_MCP_TIER env,
    // then null (legacy: expose full adapter catalogue). We only build
    // an allowlist when a tier is genuinely active so callers that
    // don't opt in pay zero cost.
    const env = options.env ?? process.env;
    const hasExplicitTier = options.tier !== undefined;
    const hasEnvTier =
      typeof env["WOTANN_MCP_TIER"] === "string" && env["WOTANN_MCP_TIER"].length > 0;
    if (hasExplicitTier || hasEnvTier) {
      const tier = resolveTier({
        ...(options.tier !== undefined ? { tier: options.tier } : {}),
        env,
      });
      const result = loadToolsWithOptions({
        tier,
        env,
        ...(options.tieredRegistry !== undefined ? { registry: options.tieredRegistry } : {}),
      });
      this.activeTier = tier;
      this.tierAllowlist = new Set(result.tools.map((t) => t.name));
    } else {
      this.activeTier = null;
      this.tierAllowlist = null;
    }

    // Per-server elicitation registry. Wiring code attaches a UI
    // handler later via `getElicitationRegistry().register(handler)`.
    // Until a handler is attached, elicitation/* requests honestly
    // surface a "no-handler" error envelope (QB #6).
    this.elicitationRegistry = createElicitationRegistry();
  }

  /**
   * Returns the elicitation registry so wiring code (composition root,
   * UI surface, etc.) can attach a handler that drives the user-input
   * UI. Honest stub by default — until a handler is registered,
   * elicitation/create requests get a "no-handler" error envelope.
   */
  getElicitationRegistry(): ElicitationRegistry {
    return this.elicitationRegistry;
  }

  /**
   * Filter the adapter's tool list through the active tier allowlist.
   * Returns the adapter list unchanged when no tier is configured.
   */
  private tierScopedTools(): readonly McpToolDefinition[] {
    const all = this.adapter.listTools();
    if (this.tierAllowlist === null) return all;
    return all.filter((t) => this.tierAllowlist!.has(t.name));
  }

  /** Currently-active MCP tier, or null when unfiltered. */
  get tier(): McpTier | null {
    return this.activeTier;
  }

  /**
   * Start the stdio loop. Returns a promise that resolves when stdin
   * closes (client disconnected).
   */
  async run(): Promise<void> {
    this.rl = createInterface({ input: this.stdin, crlfDelay: Infinity });
    return new Promise((resolvePromise) => {
      this.rl!.on("line", (line) => {
        this.handleLine(line).catch((err) => {
          this.log("handler error", err);
        });
      });
      this.rl!.on("close", () => {
        this.closed = true;
        resolvePromise();
      });
    });
  }

  /** For testing: process a single request line synchronously. */
  async handleRequest(line: string): Promise<string | null> {
    const captured: string[] = [];
    const originalStdout = this.stdout;
    // Replace stdout with a capture buffer for this call
    (this as unknown as { stdout: Writable }).stdout = {
      write: (chunk: string | Buffer) => {
        captured.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      },
    } as Writable;
    try {
      await this.handleLine(line);
    } finally {
      (this as unknown as { stdout: Writable }).stdout = originalStdout;
    }
    return captured.length > 0 ? captured.join("") : null;
  }

  private async handleLine(line: string): Promise<void> {
    if (this.closed) return;
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch (e) {
      this.sendResponse({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: `parse error: ${(e as Error).message}` },
      });
      return;
    }

    if (req.jsonrpc !== "2.0") {
      this.sendResponse({
        jsonrpc: "2.0",
        id: req.id ?? null,
        error: { code: -32600, message: "invalid request: missing jsonrpc: 2.0" },
      });
      return;
    }

    try {
      const result = await this.dispatch(req.method, req.params);
      // Notifications (no id) do not get a response
      if (req.id !== undefined && req.id !== null) {
        this.sendResponse({ jsonrpc: "2.0", id: req.id, result });
      }
    } catch (e) {
      if (req.id !== undefined && req.id !== null) {
        this.sendResponse({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32603, message: (e as Error).message },
        });
      }
    }
  }

  private async dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "initialize": {
        this.initialized = true;
        // V9 Wave 5-DD (H-39a) — version negotiation.
        // Spec: server SHOULD echo the client's protocolVersion when
        // it can speak that version; otherwise advertise its latest
        // supported version so the client can decide whether to retry
        // or abort. Previously this handler ignored params.protocolVersion
        // entirely and forced everyone onto the stale 2024-11-05.
        const initParams = (params ?? {}) as { protocolVersion?: unknown };
        const requested =
          typeof initParams.protocolVersion === "string" ? initParams.protocolVersion : null;
        const negotiated =
          requested !== null && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : MCP_PROTOCOL_VERSION;
        if (requested !== null && negotiated !== requested) {
          // QB#6 honest fallback: the client asked for something we
          // can't honor. Log to stderr (out-of-band w/ the JSON-RPC
          // stream) so the operator sees the downgrade.
          this.log(
            "version negotiation",
            `client requested unsupported protocolVersion="${requested}", falling back to "${negotiated}"`,
          );
        }
        // Elicitation capability is advertised only when a handler is
        // actually registered. Listing it unconditionally would dead-letter
        // clients into the "no-handler" cancel envelope (QB#6).
        const capabilities: Record<string, unknown> = {
          tools: {},
          resources: {},
        };
        if (this.elicitationRegistry.count() > 0) {
          capabilities["elicitation"] = {};
        }
        return {
          protocolVersion: negotiated,
          // V9 Wave 3-N audit fix (QB#6 honest behavior): only advertise
          // capabilities we actually honor. `prompts` was previously
          // advertised but the handler always returned `[]`, dead-lettering
          // any client that called `prompts/list`. Until WOTANN skills are
          // mapped to MCP prompt schemas (with arguments + templates), the
          // capability is omitted so spec-compliant clients won't ask.
          capabilities,
          serverInfo: this.info,
        };
      }
      case "initialized":
      case "notifications/initialized":
        return null;
      case "tools/list": {
        // Tier scoping — the tier allowlist (if any) narrows the
        // adapter's full catalogue to the task-master-style tier subset.
        // Legacy callers (no tier configured) see the unfiltered list.
        return { tools: this.tierScopedTools() };
      }
      case "tools/call": {
        const p = (params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!p.name) throw new Error("tools/call: name is required");
        // Enforce the tier allowlist at invocation time as well — a
        // client that cached an older (wider) tools/list response
        // should not be able to dispatch to a hidden tool. This
        // matches the "honest error envelope" bar.
        if (this.tierAllowlist !== null && !this.tierAllowlist.has(p.name)) {
          throw new Error(
            `tools/call: tool "${p.name}" not available at tier "${this.activeTier ?? "unknown"}"`,
          );
        }
        const result = await this.adapter.callTool(p.name, p.arguments ?? {});
        return result;
      }
      case "prompts/list":
        // Defensive fallback only — the `prompts` capability is NOT
        // advertised in the `initialize` response (see capabilities
        // block above). A spec-compliant client should never reach
        // this case. Returning an empty list (rather than throwing
        // `method not implemented`) keeps misbehaving clients quiet.
        return { prompts: [] };
      case "resources/list":
        // V9 T4.1 — expose WOTANN's native UI resources (memory
        // browser, cost preview, editor diff) per MCP Apps spec
        // SEP-1865. Each descriptor carries the MCP Apps MIME
        // `text/html;profile=mcp-app` so hosts that support the
        // protocol (Claude, ChatGPT, VS Code, Goose, Postman, MCPJam)
        // render the UIs inline.
        return { resources: listUiResources() };
      case "resources/read": {
        // V9 T4.1 — Return the rendered HTML for a single
        // `ui://wotann/<slug>` URI. Unknown URIs return a
        // JSON-RPC-compatible error so the host sees a 404-equivalent
        // (per the Tier 4 integration-test matrix "resources/read
        // invalid → 404-equivalent error" row).
        const p = params as { uri?: unknown };
        if (typeof p.uri !== "string") {
          throw new Error("resources/read: params.uri (string) required");
        }
        const content = readUiResource(p.uri);
        if (!content) {
          throw new Error(`resources/read: unknown uri: ${p.uri}`);
        }
        return { contents: [content] };
      }
      case "elicitation/create": {
        // V9 T14.1 — A client (or peer) is asking THIS server to elicit
        // structured input. Parse with the spec'd shape, route through
        // the elicitation registry. When no handler is registered the
        // registry returns an honest "no-handler" envelope (QB #6).
        const parsed = parseElicitationRequest({ method, params });
        if (parsed === null) {
          throw new Error("elicitation/create: malformed params (need {message, requestedSchema})");
        }
        const handled = await this.elicitationRegistry.handle(parsed as ElicitationRequest);
        if (handled.ok) return handled.result;
        // Honest failure surface — never silently fabricate a response.
        return {
          action: "cancel",
          ...(handled.error !== undefined
            ? { _wotannError: handled.error, _wotannReason: handled.reason }
            : { _wotannReason: handled.reason }),
        };
      }
      case "elicitation/result": {
        // V9 T14.1 — Inbound result from a previously-issued elicitation.
        // We round-trip through the parser to enforce the spec'd shape,
        // then echo back to the client (the registry doesn't store
        // pending requests itself; callers correlate by id at the
        // outbound layer).
        const result = parseElicitationResult(params);
        if (result === null) {
          throw new Error("elicitation/result: malformed payload");
        }
        return result;
      }
      case "shutdown":
        this.closed = true;
        this.rl?.close();
        return null;
      case "ping":
        return {};
      default:
        throw new Error(`method not implemented: ${method}`);
    }
  }

  private sendResponse(response: JsonRpcResponse): void {
    this.stdout.write(`${JSON.stringify(response)}\n`);
  }

  private log(label: string, data: unknown): void {
    // Logs go to stderr so they don't corrupt the JSON-RPC stream
    this.stderr.write(`[mcp-server] ${label}: ${String(data)}\n`);
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

// ── Default adapter wiring ────────────────────────────

/**
 * Compose a default ToolHostAdapter from a set of tool providers.
 * Each provider ships a list of tools + a callTool function scoped
 * to its own namespace.
 */
export interface ToolProvider {
  readonly tools: readonly McpToolDefinition[];
  readonly callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
}

export function composeAdapter(providers: readonly ToolProvider[]): ToolHostAdapter {
  const toolMap = new Map<string, ToolProvider>();
  const allTools: McpToolDefinition[] = [];
  for (const provider of providers) {
    for (const tool of provider.tools) {
      if (toolMap.has(tool.name)) {
        throw new Error(`composeAdapter: duplicate tool name "${tool.name}"`);
      }
      toolMap.set(tool.name, provider);
      allTools.push(tool);
    }
  }
  return {
    listTools: () => allTools,
    callTool: async (name, args) => {
      const provider = toolMap.get(name);
      if (!provider) {
        return {
          content: [{ type: "text", text: `unknown tool: ${name}` }],
          isError: true,
        };
      }
      return provider.callTool(name, args);
    },
  };
}

/**
 * Wrap any arbitrary adapter with a "text" response formatter for
 * simple scalar outputs. Turns a string/number/object into a
 * conformant McpToolCallResult.
 */
export function makeTextResult(text: string, isError?: boolean): McpToolCallResult {
  return {
    content: [{ type: "text", text }],
    ...(isError !== undefined ? { isError } : {}),
  };
}
