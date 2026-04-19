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

  it("advertises tools + prompts + resources capabilities", async () => {
    const { server } = makeServer(makeAdapter());
    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    );
    const parsed = JSON.parse(response!);
    expect(parsed.result.capabilities.tools).toBeDefined();
    expect(parsed.result.capabilities.prompts).toBeDefined();
    expect(parsed.result.capabilities.resources).toBeDefined();
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
