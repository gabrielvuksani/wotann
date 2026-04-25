/**
 * WOTANN tools exposed as MCP — V9 T3.2 (complete).
 *
 * Implements all 10 V9-spec'd MCP tools so the spawned `claude`
 * subprocess (via --mcp-config) can call into WOTANN's runtime:
 *
 *   - mcp__wotann__memory_search     — search the unified memory fabric
 *   - mcp__wotann__skill_load        — load a skill from the registry
 *   - mcp__wotann__shadow_git_status — current shadow-git delta
 *   - mcp__wotann__session_end       — end the current session cleanly
 *   - mcp__wotann__approval_request  — request approval for a sensitive action
 *   - mcp__wotann__council_vote      — multi-voter consensus on a proposal
 *   - mcp__wotann__arena_run         — N-candidate Arena race + judge ranking
 *   - mcp__wotann__exploit_lane      — adversarial probe an artifact
 *   - mcp__wotann__workshop_dispatch — dispatch a Workshop task to local agent
 *   - mcp__wotann__fleet_view        — return current fleet status
 *
 * Every tool's runtime collaborator is injected via `WotannMcpDeps`.
 * Tools whose deps are missing return an honest MCP error envelope
 * rather than crashing or silently no-op'ing.
 *
 * Quality bars
 *   - QB #6 honest stubs: every tool returns an MCP error envelope
 *     with a real reason if its dependency is unavailable.
 *   - QB #7 per-call state: `createWotannMcpAdapter` returns a fresh
 *     ToolHostAdapter each call. No module-level caches.
 *   - QB #13 env guard: every dep is injected via `WotannMcpDeps`.
 */

import type { ToolHostAdapter, McpToolDefinition, McpToolCallResult } from "../mcp-server.js";
// V9 T14.1 — Anthropic Memory tool (memory_20250818) shim. Routes
// `mcp__wotann__memory` sub-actions (view/create/str_replace/insert/
// delete) through createMemoryToolShimAdapter so any Claude agent
// that speaks the Memory tool talks to WOTANN's memory layer.
import { createMemoryToolShimAdapter, type MemoryStoreLike } from "../memory-tool-shim.js";

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

  /** council_vote dep — multi-voter consensus on a tool-call proposal. */
  readonly councilVote?: (
    proposal: string,
    context: string | undefined,
    modelCount: number | undefined,
  ) => Promise<{
    readonly verdict: "yes" | "no" | "split";
    readonly votes: ReadonlyArray<{
      readonly voter: string;
      readonly vote: "yes" | "no";
      readonly rationale?: string;
    }>;
    readonly rationale: string;
  }>;

  /** arena_run dep — N-candidate Arena race + judge ranking. */
  readonly arenaRun?: (
    prompt: string,
    candidateCount: number | undefined,
    criteria: readonly string[] | undefined,
  ) => Promise<{
    readonly winnerIndex: number;
    readonly ranked: ReadonlyArray<{ readonly index: number; readonly rationale: string }>;
  }>;

  /** exploit_lane dep — adversarial probe an artifact. */
  readonly exploitLane?: (
    artifactType: "prompt" | "code" | "doc",
    artifact: string,
  ) => Promise<{
    readonly findings: ReadonlyArray<{
      readonly severity: "low" | "medium" | "high" | "critical";
      readonly attack: string;
      readonly mitigation: string;
    }>;
  }>;

  /** workshop_dispatch dep — dispatch a Workshop task to the local agent runtime. */
  readonly workshopDispatch?: (
    task: string,
    files: readonly string[] | undefined,
    maxTurns: number | undefined,
  ) => Promise<{ readonly jobId: string }>;

  /** fleet_view dep — return current fleet status (parallel agent sessions). */
  readonly fleetView?: () => Promise<{
    readonly sessions: ReadonlyArray<{
      readonly id: string;
      readonly surface: string;
      readonly cost: number;
      readonly status: string;
      readonly progress: number;
    }>;
  }>;

  /**
   * V9 T14.1 — Anthropic Memory tool shim store. When provided, the
   * adapter exposes `mcp__wotann__memory` and routes the
   * view/create/str_replace/insert/delete actions through
   * createMemoryToolShimAdapter. Optional namespace + sessionId let
   * the host scope memories per session.
   */
  readonly memoryShim?: {
    readonly store: MemoryStoreLike;
    readonly namespaceRoot?: string;
    readonly sessionId?: string;
  };
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
  {
    name: "mcp__wotann__council_vote",
    description:
      "Submit a tool-call proposal to the WOTANN Council (multi-voter consensus). Returns a verdict (yes/no/split), per-voter votes, and a synthesized rationale.",
    inputSchema: {
      type: "object",
      properties: {
        proposal: { type: "string", description: "The proposal text to vote on" },
        context: { type: "string", description: "Optional surrounding context" },
        model_count: {
          type: "number",
          description: "Number of voting models (default = council preset)",
        },
      },
      required: ["proposal"],
    },
  },
  {
    name: "mcp__wotann__arena_run",
    description:
      "Run an Arena race — N parallel candidate generators on the same prompt, judge ranks outputs. Returns the winner index and the full ranked list with rationales.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The prompt to race candidates on" },
        candidate_count: {
          type: "number",
          description: "Number of candidates to generate (default = arena preset)",
        },
        criteria: {
          type: "array",
          description: "Optional ranking criteria (e.g. ['correctness','clarity'])",
          items: { type: "string" },
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "mcp__wotann__exploit_lane",
    description:
      "Adversarial probe an artifact (prompt, code, or doc) — find ways it breaks. Returns severity-tagged findings with attack and mitigation.",
    inputSchema: {
      type: "object",
      properties: {
        artifact_type: { type: "string", enum: ["prompt", "code", "doc"] },
        artifact: { type: "string", description: "The artifact body to probe" },
      },
      required: ["artifact_type", "artifact"],
    },
  },
  {
    name: "mcp__wotann__workshop_dispatch",
    description:
      "Dispatch a Workshop task to the local agent runtime. Returns a job id you can monitor via the Engine.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Free-text task description" },
        files: {
          type: "array",
          description: "Optional list of file paths in scope",
          items: { type: "string" },
        },
        max_turns: { type: "number", description: "Optional max-turns budget" },
      },
      required: ["task"],
    },
  },
  {
    name: "mcp__wotann__fleet_view",
    description:
      "Return current fleet status — every active parallel agent session with surface, cost, status, and progress.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "mcp__wotann__memory",
    description:
      "Anthropic Memory tool (memory_20250818) routed through WOTANN's MemoryStore. " +
      "Sub-actions: view (list under path), create (new entry), str_replace " +
      "(exact-once edit), insert (line insert), delete (by id). Paths must " +
      "start with the namespace root (default '/memories'). Returns the same " +
      "shape as Anthropic's reference Memory tool.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["view", "create", "str_replace", "insert", "delete"],
          description: "Memory sub-action.",
        },
        path: { type: "string", description: "Path under namespace root (view/create)." },
        content: { type: "string", description: "Memory content (create)." },
        id: {
          type: "string",
          description: "Memory id (str_replace/insert/delete).",
        },
        oldStr: {
          type: "string",
          description: "Exact substring to replace (str_replace).",
        },
        newStr: { type: "string", description: "Replacement text (str_replace)." },
        line: {
          type: "number",
          description: "0-indexed line position (insert).",
        },
        text: { type: "string", description: "Text to insert as a new line (insert)." },
      },
      required: ["action"],
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
 * Build a `ToolHostAdapter` exposing all 10 WOTANN MCP tools. Wire
 * this into a WotannMcpServer instance to surface WOTANN to the
 * spawned `claude` subprocess via `--mcp-config`. Tools whose runtime
 * deps are not provided in `WotannMcpDeps` return an honest error
 * envelope at call time.
 */
export function createWotannMcpAdapter(deps: WotannMcpDeps): ToolHostAdapter {
  // V9 T14.1 — Lazy-initialize the Anthropic Memory tool shim adapter
  // when a `memoryShim` dep is provided. The shim owns view/create/
  // str_replace/insert/delete tool calls; we route them through this
  // single dispatcher inside the `mcp__wotann__memory` case below.
  const memoryShimAdapter = deps.memoryShim
    ? createMemoryToolShimAdapter({
        store: deps.memoryShim.store,
        ...(deps.memoryShim.namespaceRoot !== undefined
          ? { namespaceRoot: deps.memoryShim.namespaceRoot }
          : {}),
        ...(deps.memoryShim.sessionId !== undefined
          ? { sessionId: deps.memoryShim.sessionId }
          : {}),
      })
    : null;

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

        case "mcp__wotann__council_vote": {
          if (!deps.councilVote) return honestUnavailable("council_vote", "councilVote");
          const proposal = typeof a["proposal"] === "string" ? (a["proposal"] as string) : "";
          if (proposal.length === 0) {
            return {
              content: [{ type: "text", text: "council_vote requires a non-empty proposal" }],
              isError: true,
            };
          }
          const context = typeof a["context"] === "string" ? (a["context"] as string) : undefined;
          const modelCount =
            typeof a["model_count"] === "number" ? (a["model_count"] as number) : undefined;
          const result = await deps.councilVote(proposal, context, modelCount);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "mcp__wotann__arena_run": {
          if (!deps.arenaRun) return honestUnavailable("arena_run", "arenaRun");
          const prompt = typeof a["prompt"] === "string" ? (a["prompt"] as string) : "";
          if (prompt.length === 0) {
            return {
              content: [{ type: "text", text: "arena_run requires a non-empty prompt" }],
              isError: true,
            };
          }
          const candidateCount =
            typeof a["candidate_count"] === "number" ? (a["candidate_count"] as number) : undefined;
          let criteria: readonly string[] | undefined;
          const rawCriteria = a["criteria"];
          if (Array.isArray(rawCriteria)) {
            criteria = rawCriteria.filter((c): c is string => typeof c === "string");
          }
          const result = await deps.arenaRun(prompt, candidateCount, criteria);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "mcp__wotann__exploit_lane": {
          if (!deps.exploitLane) return honestUnavailable("exploit_lane", "exploitLane");
          const typeRaw =
            typeof a["artifact_type"] === "string" ? (a["artifact_type"] as string) : "";
          const artifactType: "prompt" | "code" | "doc" | null =
            typeRaw === "prompt" || typeRaw === "code" || typeRaw === "doc" ? typeRaw : null;
          const artifact = typeof a["artifact"] === "string" ? (a["artifact"] as string) : "";
          if (artifactType === null || artifact.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "exploit_lane requires artifact_type ('prompt'|'code'|'doc') and a non-empty artifact",
                },
              ],
              isError: true,
            };
          }
          const result = await deps.exploitLane(artifactType, artifact);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "mcp__wotann__workshop_dispatch": {
          if (!deps.workshopDispatch)
            return honestUnavailable("workshop_dispatch", "workshopDispatch");
          const task = typeof a["task"] === "string" ? (a["task"] as string) : "";
          if (task.length === 0) {
            return {
              content: [{ type: "text", text: "workshop_dispatch requires a non-empty task" }],
              isError: true,
            };
          }
          let files: readonly string[] | undefined;
          const rawFiles = a["files"];
          if (Array.isArray(rawFiles)) {
            files = rawFiles.filter((f): f is string => typeof f === "string");
          }
          const maxTurns =
            typeof a["max_turns"] === "number" ? (a["max_turns"] as number) : undefined;
          const result = await deps.workshopDispatch(task, files, maxTurns);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "mcp__wotann__fleet_view": {
          if (!deps.fleetView) return honestUnavailable("fleet_view", "fleetView");
          const result = await deps.fleetView();
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        case "mcp__wotann__memory": {
          // V9 T14.1 — Route through the Anthropic Memory tool shim.
          if (!memoryShimAdapter) return honestUnavailable("memory", "memoryShim");
          const action = typeof a["action"] === "string" ? (a["action"] as string) : "";
          const allowed = new Set(["view", "create", "str_replace", "insert", "delete"]);
          if (!allowed.has(action)) {
            return {
              content: [
                {
                  type: "text",
                  text: `mcp__wotann__memory: action must be one of ${[...allowed].join(", ")}`,
                },
              ],
              isError: true,
            };
          }
          // The shim's tools are named `memory.<action>` — pass the rest
          // of the args through unchanged. Honest stub: invalid action
          // already rejected above; the shim itself handles the rest.
          return memoryShimAdapter.callTool(`memory.${action}`, a);
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
