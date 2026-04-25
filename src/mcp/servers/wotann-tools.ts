/**
 * WOTANN tools exposed as MCP — V9 T3.2 Wave 1.
 *
 * Implements 5 of the 10 V9-spec'd MCP tools so the spawned `claude`
 * subprocess (via --mcp-config) can call into WOTANN's runtime:
 *
 *   - mcp__wotann__memory_search   — search the unified memory fabric
 *   - mcp__wotann__skill_load      — load a skill from the registry
 *   - mcp__wotann__shadow_git_status — current shadow-git delta
 *   - mcp__wotann__session_end     — end the current session cleanly
 *   - mcp__wotann__approval_request — request approval for a sensitive action
 *
 * The remaining 5 (council_vote, arena_run, exploit_lane,
 * workshop_dispatch, fleet_view) are deferred to follow-up commits
 * because each requires deeper coupling with the orchestrator
 * subsystem; this file lands the MCP contract + the 5 tools whose
 * runtime collaborators already exist as well-tested singletons
 * (MemoryStore, skill registry, shadow-git, runtime, ApprovalQueue).
 *
 * Quality bars
 *   - QB #6 honest stubs: every tool returns an MCP error envelope
 *     with a real reason if its dependency is unavailable.
 *   - QB #7 per-call state: `createWotannMcpAdapter` returns a fresh
 *     ToolHostAdapter each call. No module-level caches.
 *   - QB #13 env guard: every dep is injected via `WotannMcpDeps`.
 */

import type { ToolHostAdapter, McpToolDefinition, McpToolCallResult } from "../mcp-server.js";

// ── Dependency surface (callers inject) ──────────────────────

/**
 * Minimal dependency surface. The factory accepts a partial set —
 * tools whose dependencies are missing return an honest error
 * rather than crashing.
 */
export interface WotannMcpDeps {
  /** memory_search dep — searches FTS5 + fabric. */
  readonly searchMemory?: (
    query: string,
    opts?: { readonly maxResults?: number; readonly minConfidence?: number },
  ) => Promise<readonly { readonly key: string; readonly value: string; readonly score: number }[]>;

  /** skill_load dep — returns skill body by id. */
  readonly loadSkill?: (
    id: string,
  ) => Promise<{ readonly id: string; readonly body: string } | null>;

  /** shadow_git_status dep — returns the shadow-git delta summary. */
  readonly shadowGitStatus?: () => Promise<{
    readonly modified: readonly string[];
    readonly added: readonly string[];
    readonly deleted: readonly string[];
  }>;

  /** session_end dep — terminates the current session. */
  readonly endSession?: (sessionId: string) => Promise<{ readonly ended: boolean }>;

  /** approval_request dep — enqueue an approval and await decision. */
  readonly requestApproval?: (args: {
    readonly summary: string;
    readonly riskLevel: "low" | "medium" | "high";
    readonly toolCallId: string;
  }) => Promise<{ readonly decision: "approved" | "denied"; readonly reason?: string }>;
}

// ── Tool definitions ────────────────────────────────────────

const TOOL_DEFINITIONS: readonly McpToolDefinition[] = [
  {
    name: "mcp__wotann__memory_search",
    description:
      "Search WOTANN's unified memory fabric (FTS5 + TEMPR + fabric). Returns top-K memory entries by relevance score.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query" },
        max_results: { type: "number", description: "Max hits (default 10)" },
        min_confidence: { type: "number", description: "Score floor 0-1 (default 0.3)" },
      },
      required: ["query"],
    },
  },
  {
    name: "mcp__wotann__skill_load",
    description: "Load a WOTANN skill body by id from the skill registry.",
    inputSchema: {
      type: "object",
      properties: {
        skill_id: { type: "string", description: "Skill id (e.g. 'research-deep')" },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "mcp__wotann__shadow_git_status",
    description:
      "Return the WOTANN shadow-git delta — files modified / added / deleted since the last commit.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mcp__wotann__session_end",
    description: "End the current WOTANN session cleanly (flushes memory, emits a summary).",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "The session id to terminate" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "mcp__wotann__approval_request",
    description:
      "Enqueue an approval request and await the user's decision. Use for high-risk tool calls.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Short human-readable description" },
        risk_level: { type: "string", enum: ["low", "medium", "high"] },
        tool_call_id: { type: "string", description: "ID of the tool call this approval gates" },
      },
      required: ["summary", "risk_level", "tool_call_id"],
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────

function honestUnavailable(name: string, dep: string): McpToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: `mcp__wotann__${name}: dependency "${dep}" not wired by host. Pass it in via WotannMcpDeps.`,
      },
    ],
    isError: true,
  };
}

function asObject(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== "object" || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

// ── Adapter factory ─────────────────────────────────────────

/**
 * Build a `ToolHostAdapter` exposing the 5 WOTANN MCP tools. Wire
 * this into a WotannMcpServer instance to surface WOTANN to the
 * spawned `claude` subprocess via `--mcp-config`.
 */
export function createWotannMcpAdapter(deps: WotannMcpDeps): ToolHostAdapter {
  return {
    listTools(): readonly McpToolDefinition[] {
      return TOOL_DEFINITIONS;
    },

    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
      const a = asObject(args);

      switch (name) {
        case "mcp__wotann__memory_search": {
          if (!deps.searchMemory) return honestUnavailable("memory_search", "searchMemory");
          const query = typeof a["query"] === "string" ? (a["query"] as string) : "";
          if (query.length === 0) {
            return {
              content: [{ type: "text", text: "memory_search requires a non-empty query" }],
              isError: true,
            };
          }
          const opts: { maxResults?: number; minConfidence?: number } = {};
          if (typeof a["max_results"] === "number") opts.maxResults = a["max_results"] as number;
          if (typeof a["min_confidence"] === "number")
            opts.minConfidence = a["min_confidence"] as number;
          const hits = await deps.searchMemory(query, opts);
          return {
            content: [{ type: "text", text: JSON.stringify({ hits }, null, 2) }],
          };
        }

        case "mcp__wotann__skill_load": {
          if (!deps.loadSkill) return honestUnavailable("skill_load", "loadSkill");
          const id = typeof a["skill_id"] === "string" ? (a["skill_id"] as string) : "";
          if (id.length === 0) {
            return {
              content: [{ type: "text", text: "skill_load requires skill_id" }],
              isError: true,
            };
          }
          const skill = await deps.loadSkill(id);
          if (!skill) {
            return {
              content: [{ type: "text", text: `skill "${id}" not found in registry` }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: skill.body }],
          };
        }

        case "mcp__wotann__shadow_git_status": {
          if (!deps.shadowGitStatus)
            return honestUnavailable("shadow_git_status", "shadowGitStatus");
          const status = await deps.shadowGitStatus();
          return {
            content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
          };
        }

        case "mcp__wotann__session_end": {
          if (!deps.endSession) return honestUnavailable("session_end", "endSession");
          const sessionId = typeof a["session_id"] === "string" ? (a["session_id"] as string) : "";
          if (sessionId.length === 0) {
            return {
              content: [{ type: "text", text: "session_end requires session_id" }],
              isError: true,
            };
          }
          const result = await deps.endSession(sessionId);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "mcp__wotann__approval_request": {
          if (!deps.requestApproval)
            return honestUnavailable("approval_request", "requestApproval");
          const summary = typeof a["summary"] === "string" ? (a["summary"] as string) : "";
          const riskRaw = typeof a["risk_level"] === "string" ? (a["risk_level"] as string) : "";
          const riskLevel: "low" | "medium" | "high" =
            riskRaw === "high" || riskRaw === "medium" ? riskRaw : "low";
          const toolCallId =
            typeof a["tool_call_id"] === "string" ? (a["tool_call_id"] as string) : "";
          if (summary.length === 0 || toolCallId.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "approval_request requires summary + tool_call_id (and optional risk_level)",
                },
              ],
              isError: true,
            };
          }
          const result = await deps.requestApproval({ summary, riskLevel, toolCallId });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `unknown tool: ${name}` }],
            isError: true,
          };
      }
    },
  };
}

// Re-export the tool definition list for tests + introspection.
export { TOOL_DEFINITIONS as WOTANN_MCP_TOOL_DEFINITIONS };
