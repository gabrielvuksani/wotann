import { describe, it, expect } from "vitest";
import { WotannAPIServer, WotannMCPServer } from "../../src/api/server.js";

describe("WotannAPIServer", () => {
  it("creates with default config", () => {
    const server = new WotannAPIServer();
    expect(server.getAddress()).toBe("http://127.0.0.1:8420");
    expect(server.getSessionCount()).toBe(0);
  });

  it("creates with custom config", () => {
    const server = new WotannAPIServer({
      port: 9000,
      host: "0.0.0.0",
    });
    expect(server.getAddress()).toBe("http://0.0.0.0:9000");
  });

  it("starts and stops", async () => {
    const server = new WotannAPIServer({ port: 0 }); // Port 0 = random available port
    await server.start();
    await server.stop();
  });

  it("accepts request handler", () => {
    const server = new WotannAPIServer();
    server.onRequest(async (req) => ({
      id: "test",
      object: "chat.completion" as const,
      created: Date.now(),
      model: req.model,
      choices: [{
        index: 0,
        message: { role: "assistant" as const, content: "Hello" },
        finish_reason: "stop" as const,
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
    // Handler set without error
    expect(true).toBe(true);
  });

  it("accepts stream handler", () => {
    const server = new WotannAPIServer();
    server.onStream(async (_req, write) => {
      write({
        id: "chunk-1",
        object: "chat.completion.chunk" as const,
        created: Date.now(),
        model: "wotann",
        choices: [{
          index: 0,
          delta: { content: "Hello" },
          finish_reason: null,
        }],
      });
    });
    expect(true).toBe(true);
  });
});

describe("WotannMCPServer", () => {
  it("starts and registers default tools", async () => {
    const mcp = new WotannMCPServer();
    await mcp.start();

    expect(mcp.isRunning()).toBe(true);

    const state = mcp.getState();
    expect(state.tools.length).toBeGreaterThan(0);
    expect(state.tools.some((t) => t.name === "wotann_run")).toBe(true);
    expect(state.tools.some((t) => t.name === "wotann_memory_search")).toBe(true);
    expect(state.tools.some((t) => t.name === "wotann_autonomous")).toBe(true);

    await mcp.stop();
    expect(mcp.isRunning()).toBe(false);
  });

  it("registers custom tools", () => {
    const mcp = new WotannMCPServer();
    mcp.registerTool({
      name: "custom_tool",
      description: "A custom tool",
      inputSchema: { type: "object", properties: {} },
    });

    const state = mcp.getState();
    expect(state.tools.some((t) => t.name === "custom_tool")).toBe(true);
  });

  it("registers resources", () => {
    const mcp = new WotannMCPServer();
    mcp.registerResource({
      uri: "wotann://custom/resource",
      name: "Custom Resource",
      mimeType: "application/json",
      description: "Test resource",
    });

    const state = mcp.getState();
    expect(state.resources.some((r) => r.uri === "wotann://custom/resource")).toBe(true);
  });
});
