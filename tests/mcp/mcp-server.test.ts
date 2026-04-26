import { describe, it, expect, vi } from "vitest";
import {
  WotannMcpServer,
  composeAdapter,
  makeTextResult,
  MCP_PROTOCOL_VERSION,
  type ToolHostAdapter,
  type McpToolDefinition,
  type ToolProvider,
} from "../../src/mcp/mcp-server.js";
import { PassThrough } from "node:stream";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillRegistry } from "../../src/skills/loader.js";

function makeAdapter(overrides: Partial<ToolHostAdapter> = {}): ToolHostAdapter {
  return {
    listTools: () => [],
    callTool: async () => makeTextResult("ok"),
    ...overrides,
  };
}

function makeServer(adapter: ToolHostAdapter): { server: WotannMcpServer; out: PassThrough; err: PassThrough } {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const server = new WotannMcpServer({
    info: { name: "wotann-test", version: "0.1.0" },
    adapter,
    stdin,
    stdout,
    stderr,
  });
  return { server, out: stdout, err: stderr };
}

describe("WotannMcpServer — initialize", () => {
  it("responds with protocolVersion + serverInfo on initialize", async () => {
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    );
    expect(response).not.toBeNull();
    const parsed = JSON.parse(response!);
    expect(parsed.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(parsed.result.serverInfo.name).toBe("wotann-test");
    expect(server.isInitialized).toBe(true);
  });

  it("advertises tools + resources, prompts/elicitation conditional on wiring", async () => {
    // Wave 5-DD + Wave 6.9-AG follow-up: MCP server advertises
    // capabilities HONESTLY (QB#6).
    // - `tools` + `resources`: always advertised (server provides them).
    // - `prompts`: now advertised when a SkillRegistry is wired (this
    //   test makes a server WITHOUT a registry, so it stays absent —
    //   the wired-with-registry case is covered in the prompts/* suite).
    // - `elicitation`: conditionally advertised only when an
    //   elicitation handler is registered (Wave 5-DD's stronger QB#6).
    //   No handler here, so it stays absent.
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.capabilities.tools).toBeDefined();
    expect(parsed.result.capabilities.resources).toBeDefined();
    expect(parsed.result.capabilities.prompts).toBeUndefined();
    expect(parsed.result.capabilities.elicitation).toBeUndefined();
  });

  it("advertises prompts capability when a SkillRegistry is wired", async () => {
    // Wave 6.9-AG follow-up: with a registry the prompts surface is
    // genuine, so the capability appears in initialize. Spec-compliant
    // clients (Claude Desktop, Cursor, Cline, etc.) can now discover
    // and invoke WOTANN's skill catalogue via prompts/list + prompts/get.
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: makeAdapter(),
      stdin,
      stdout,
      stderr,
      skillRegistry: new SkillRegistry(),
    });
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.capabilities.prompts).toBeDefined();
  });
});

describe("WotannMcpServer — tools/list", () => {
  it("returns the adapter's tool list", async () => {
    const tool: McpToolDefinition = {
      name: "ping",
      description: "responds with pong",
      inputSchema: { type: "object", properties: {} },
    };
    const { server } = makeServer(makeAdapter({ listTools: () => [tool] }));
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.tools).toHaveLength(1);
    expect(parsed.result.tools[0].name).toBe("ping");
  });
});

describe("WotannMcpServer — tools/call", () => {
  it("invokes the adapter and returns the result", async () => {
    const callSpy = vi.fn(async () => makeTextResult("called"));
    const { server } = makeServer(makeAdapter({ callTool: callSpy }));
    const response = await server.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "ping", arguments: { q: "hi" } },
      }),
    );
    expect(callSpy).toHaveBeenCalledWith("ping", { q: "hi" });
    const parsed = JSON.parse(response!);
    expect(parsed.result.content[0].text).toBe("called");
  });

  it("errors when name is missing", async () => {
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: {} }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error.code).toBe(-32603);
  });
});

describe("WotannMcpServer — protocol errors", () => {
  it("parse error on invalid JSON", async () => {
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest("{not json}");
    const parsed = JSON.parse(response!);
    expect(parsed.error.code).toBe(-32700);
  });

  it("invalid request on missing jsonrpc: 2.0", async () => {
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(JSON.stringify({ id: 1, method: "x" }));
    const parsed = JSON.parse(response!);
    expect(parsed.error.code).toBe(-32600);
  });

  it("method not found for unknown methods", async () => {
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 5, method: "made-up-method" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error.message).toContain("not implemented");
  });
});

describe("WotannMcpServer — notifications (no id)", () => {
  it("does not respond to notifications", async () => {
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    );
    expect(response).toBeNull();
  });
});

describe("composeAdapter", () => {
  it("merges multiple providers", () => {
    const p1: ToolProvider = {
      tools: [
        { name: "a", description: "a", inputSchema: { type: "object", properties: {} } },
      ],
      callTool: async () => makeTextResult("from p1"),
    };
    const p2: ToolProvider = {
      tools: [
        { name: "b", description: "b", inputSchema: { type: "object", properties: {} } },
      ],
      callTool: async () => makeTextResult("from p2"),
    };
    const adapter = composeAdapter([p1, p2]);
    expect(adapter.listTools()).toHaveLength(2);
  });

  it("routes calls to the correct provider", async () => {
    const p1: ToolProvider = {
      tools: [{ name: "a", description: "", inputSchema: { type: "object", properties: {} } }],
      callTool: async () => makeTextResult("from p1"),
    };
    const p2: ToolProvider = {
      tools: [{ name: "b", description: "", inputSchema: { type: "object", properties: {} } }],
      callTool: async () => makeTextResult("from p2"),
    };
    const adapter = composeAdapter([p1, p2]);
    const r1 = await adapter.callTool("a", {});
    expect(r1.content[0]?.text).toBe("from p1");
    const r2 = await adapter.callTool("b", {});
    expect(r2.content[0]?.text).toBe("from p2");
  });

  it("returns isError: true for unknown tool names", async () => {
    const adapter = composeAdapter([]);
    const r = await adapter.callTool("nope", {});
    expect(r.isError).toBe(true);
  });

  it("throws on duplicate tool names across providers", () => {
    const p1: ToolProvider = {
      tools: [{ name: "a", description: "", inputSchema: { type: "object", properties: {} } }],
      callTool: async () => makeTextResult(""),
    };
    const p2: ToolProvider = {
      tools: [{ name: "a", description: "", inputSchema: { type: "object", properties: {} } }],
      callTool: async () => makeTextResult(""),
    };
    expect(() => composeAdapter([p1, p2])).toThrow(/duplicate tool name/);
  });
});

describe("makeTextResult", () => {
  it("wraps a plain string", () => {
    const r = makeTextResult("hello");
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe("text");
    expect(r.content[0]?.text).toBe("hello");
    expect(r.isError).toBeUndefined();
  });

  it("includes isError when provided", () => {
    const r = makeTextResult("oops", true);
    expect(r.isError).toBe(true);
  });
});

// ── Tier-scoped tool catalogue (WOTANN_MCP_TIER) ─────────────

describe("WotannMcpServer — tier-scoped tools/list (WOTANN_MCP_TIER)", () => {
  /**
   * Adapter ships every tier-default tool name so we can verify the
   * tier filter on its own. We intentionally expose all 42+ here so
   * filtering is the ONLY thing that can reduce the list.
   */
  function adapterWithDefaultTools(): ToolHostAdapter {
    const names = [
      // core (7)
      "memory_search",
      "memory_save",
      "find_symbol",
      "run_workflow",
      "unified_exec",
      "read_file",
      "write_file",
      // standard (+7)
      "plan_create",
      "plan_next",
      "plan_update",
      "search_code",
      "edit_file",
      "skill_run",
      "list_files",
      // all (+ 28)
      "lsp_rename",
      "lsp_references",
      "lsp_definition",
      "lsp_hover",
      "git_status",
      "git_diff",
      "git_commit",
      "git_log",
      "git_blame",
      "orchestrator_delegate",
      "orchestrator_status",
      "computer_use_screenshot",
      "computer_use_click",
      "computer_use_type",
      "browser_navigate",
      "browser_click",
      "telemetry_cost",
      "telemetry_audit",
      "marketplace_list",
      "marketplace_install",
      "channel_send",
      "channel_list",
      "voice_transcribe",
      "voice_speak",
      "learning_replay",
      "learning_diary",
      "identity_set",
      "desktop_control_focus",
    ];
    return {
      listTools: () =>
        names.map((name) => ({
          name,
          description: name,
          inputSchema: { type: "object", properties: {} } as const,
        })),
      callTool: async () => makeTextResult(`invoked`),
    };
  }

  it("exposes the full adapter catalogue when no tier is configured", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: adapterWithDefaultTools(),
      stdin,
      stdout,
      stderr,
      env: {},
    });
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.tools.length).toBeGreaterThanOrEqual(42);
    expect(server.tier).toBeNull();
  });

  it("filters to 7 tools when tier=core is set explicitly", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: adapterWithDefaultTools(),
      stdin,
      stdout,
      stderr,
      tier: "core",
      env: {},
    });
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.tools).toHaveLength(7);
    expect(server.tier).toBe("core");
    const names = parsed.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("memory_search");
    expect(names).not.toContain("browser_navigate");
  });

  it("filters to 14 tools when tier=standard is set", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: adapterWithDefaultTools(),
      stdin,
      stdout,
      stderr,
      tier: "standard",
      env: {},
    });
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.tools).toHaveLength(14);
  });

  it("reads WOTANN_MCP_TIER from env when no explicit tier is set", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: adapterWithDefaultTools(),
      stdin,
      stdout,
      stderr,
      env: { WOTANN_MCP_TIER: "standard" },
    });
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.tools).toHaveLength(14);
    expect(server.tier).toBe("standard");
  });

  it("blocks tools/call for tools hidden by the active tier", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: adapterWithDefaultTools(),
      stdin,
      stdout,
      stderr,
      tier: "core",
      env: {},
    });
    // browser_navigate exists in the adapter but not in core tier
    const response = await server.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "browser_navigate", arguments: { url: "https://x" } },
      }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toMatch(/not available at tier "core"/);
  });

  it("allows tools/call for tools exposed by the active tier", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: adapterWithDefaultTools(),
      stdin,
      stdout,
      stderr,
      tier: "core",
      env: {},
    });
    const response = await server.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "memory_search", arguments: { query: "x" } },
      }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error).toBeUndefined();
    expect(parsed.result.content[0].text).toBe("invoked");
  });
});

// ── prompts/* — Wave 6.9-AG follow-up (skills as MCP prompts) ─

describe("WotannMcpServer — prompts/list + prompts/get (skills as prompts)", () => {
  /**
   * Build a temp skills directory with a couple of well-formed skill
   * files so the SkillRegistry has something to surface. We avoid
   * pointing at the real `skills/` tree because the registry would
   * also pick up the SkillsGuard rejections from random fixture files
   * in the repo and turn this into an end-to-end test.
   */
  function makeRegistryWithFixtures(): SkillRegistry {
    const dir = mkdtempSync(join(tmpdir(), "wotann-prompts-"));
    writeFileSync(
      join(dir, "summarize.md"),
      [
        "---",
        "name: summarize",
        "description: Summarize the supplied text in 3 bullets",
        "context: fork",
        "paths: []",
        "---",
        "",
        "# Summarize",
        "",
        "Summarize this text in 3 bullet points: {{text}}",
        "",
        "Audience: {{audience}}",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "review-pr.md"),
      [
        "---",
        "name: review-pr",
        "description: Review the open pull request and produce findings",
        "context: fork",
        "paths: []",
        "---",
        "",
        "# Review PR",
        "",
        "Walk through every changed file and surface CRIT/HIGH/MED/LOW findings.",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "ambient-guard.md"),
      [
        "---",
        "name: ambient-guard",
        "description: Always-on safety reminder",
        "context: fork",
        "paths: []",
        "always: true",
        "---",
        "",
        "Be careful with destructive commands.",
      ].join("\n"),
    );
    return SkillRegistry.createWithDefaults(dir);
  }

  function makeServerWithRegistry(registry: SkillRegistry): {
    server: WotannMcpServer;
    err: PassThrough;
  } {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const server = new WotannMcpServer({
      info: { name: "wotann-test", version: "0.1.0" },
      adapter: makeAdapter(),
      stdin,
      stdout,
      stderr,
      skillRegistry: registry,
    });
    return { server, err: stderr };
  }

  it("prompts/list returns a non-empty array for a registry with skills", async () => {
    const registry = makeRegistryWithFixtures();
    const { server } = makeServerWithRegistry(registry);
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompts/list" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result).toBeDefined();
    expect(Array.isArray(parsed.result.prompts)).toBe(true);
    // At least the two non-`always` fixtures + several built-ins that
    // are also non-`always`. The exact count drifts as built-ins evolve;
    // we assert the contract (non-empty + contains our fixtures).
    expect(parsed.result.prompts.length).toBeGreaterThan(0);
    const names = parsed.result.prompts.map((p: { name: string }) => p.name);
    expect(names).toContain("summarize");
    expect(names).toContain("review-pr");
    // `always: true` skill must NOT appear — it's passive ambient surface.
    expect(names).not.toContain("ambient-guard");
    // Catalogue is sorted alphabetically by name (deterministic for hosts).
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
    // Skills with {{vars}} should advertise arguments inferred from the body.
    const summarizeEntry = parsed.result.prompts.find(
      (p: { name: string }) => p.name === "summarize",
    );
    expect(summarizeEntry.arguments).toBeDefined();
    const argNames = summarizeEntry.arguments.map((a: { name: string }) => a.name).sort();
    expect(argNames).toEqual(["audience", "text"]);
  });

  it("prompts/get returns the interpolated body for a known skill", async () => {
    const registry = makeRegistryWithFixtures();
    const { server } = makeServerWithRegistry(registry);
    const response = await server.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "prompts/get",
        params: {
          name: "summarize",
          arguments: { text: "The cat sat on the mat.", audience: "5-year-olds" },
        },
      }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error).toBeUndefined();
    expect(parsed.result.description).toContain("Summarize");
    expect(parsed.result.messages).toHaveLength(1);
    const message = parsed.result.messages[0];
    expect(message.role).toBe("user");
    expect(message.content.type).toBe("text");
    expect(message.content.text).toContain("The cat sat on the mat.");
    expect(message.content.text).toContain("5-year-olds");
    // The frontmatter fence must be stripped — the host shouldn't see
    // YAML metadata in the prompt body.
    expect(message.content.text).not.toContain("---");
    expect(message.content.text).not.toContain("name: summarize");
  });

  it("prompts/get throws a clear error when the skill does not exist", async () => {
    const registry = makeRegistryWithFixtures();
    const { server } = makeServerWithRegistry(registry);
    const response = await server.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "prompts/get",
        params: { name: "definitely-not-a-real-skill-xyz", arguments: {} },
      }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toContain("not found");
    // Hint to the caller about how to discover available prompts.
    expect(parsed.error.message).toContain("prompts/list");
  });

  it("prompts/get with missing arguments interpolates empty + warns to stderr", async () => {
    // QB#6 honest fallback: missing args do NOT silently fabricate
    // values — they interpolate to "" AND log a warn.
    const registry = makeRegistryWithFixtures();
    const { server, err } = makeServerWithRegistry(registry);
    const warnings: string[] = [];
    err.on("data", (chunk: Buffer) => warnings.push(chunk.toString("utf8")));
    const response = await server.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "prompts/get",
        params: {
          name: "summarize",
          // Deliberately omit `text` and `audience` — both are required
          // to fully interpolate the body.
          arguments: {},
        },
      }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error).toBeUndefined();
    const text = parsed.result.messages[0].content.text;
    // The placeholders should be substituted with empty strings, not
    // left as literal `{{text}}` (that would be silent failure).
    expect(text).not.toContain("{{text}}");
    expect(text).not.toContain("{{audience}}");
    // And we must have warned the operator about the missing args.
    const allWarnings = warnings.join("");
    expect(allWarnings).toContain("missing arguments");
    expect(allWarnings).toContain("audience");
    expect(allWarnings).toContain("text");
  });

  it("prompts/list returns [] when no SkillRegistry is wired (defensive fallback)", async () => {
    // Regression guard for QB#6 honest behavior: without a registry,
    // the capability is NOT advertised, so a spec-compliant client
    // shouldn't reach this branch — but a misbehaving one that calls
    // prompts/list anyway must get a clean empty list, not a crash.
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompts/list" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.prompts).toEqual([]);
  });

  it("prompts/get errors honestly when no SkillRegistry is wired", async () => {
    // A client that tries prompts/get without the capability gets a
    // real error envelope (QB#6) instead of a fabricated empty prompt.
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "anything", arguments: {} },
      }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toContain("not enabled");
  });

  // Avoid an unused-import warning on `mkdirSync` while leaving it
  // available for a future fixture that uses bundle-style skills.
  void mkdirSync;
});
