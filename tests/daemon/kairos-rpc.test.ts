import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  KairosRPCHandler,
  type RPCResponse,
  type RPCStreamEvent,
} from "../../src/daemon/kairos-rpc.js";
import type { WotannRuntime, RuntimeStatus } from "../../src/core/runtime.js";

// ── Mock Helpers ────────────────────────────────────────────

function makeRPCRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number = 1,
): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id });
}

function makeMockRuntime(overrides?: Partial<RuntimeStatus>): WotannRuntime {
  const status: RuntimeStatus = {
    providers: ["anthropic", "openai"],
    activeProvider: "anthropic",
    hookCount: 5,
    middlewareLayers: 25,
    memoryEnabled: true,
    sessionId: "session-123",
    totalTokens: 1000,
    totalCost: 0.05,
    currentMode: "default",
    traceEntries: 10,
    semanticIndexSize: 50,
    skillCount: 3,
    ...overrides,
  };

  return {
    getStatus: vi.fn(() => status),
    query: vi.fn(async function* (_opts: unknown) {
      yield { type: "text", content: "hello", provider: "anthropic", model: "claude-sonnet" };
      yield { type: "done", content: "", provider: "anthropic", model: "claude-sonnet" };
    }),
  } as unknown as WotannRuntime;
}

function isRPCResponse(val: unknown): val is RPCResponse {
  return typeof val === "object" && val !== null && "jsonrpc" in val && "id" in val;
}

// ── Tests ──────────────────────────────────────────────────

describe("KairosRPCHandler", () => {
  let handler: KairosRPCHandler;

  beforeEach(() => {
    handler = new KairosRPCHandler();
  });

  describe("handleMessage — parsing", () => {
    it("returns parse error for invalid JSON", async () => {
      const result = await handler.handleMessage("not valid json{{{");

      expect(isRPCResponse(result)).toBe(true);
      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32700);
      expect(resp.error?.message).toBe("Parse error");
    });

    it("returns invalid request when method is missing", async () => {
      const result = await handler.handleMessage(
        JSON.stringify({ jsonrpc: "2.0", id: 1 }),
      );

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32600);
      expect(resp.error?.message).toBe("Invalid request");
    });

    it("returns invalid request when id is missing", async () => {
      const result = await handler.handleMessage(
        JSON.stringify({ jsonrpc: "2.0", method: "ping" }),
      );

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32600);
    });

    it("returns method not found for unknown methods", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("nonexistent.method"),
      );

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32601);
      expect(resp.error?.message).toContain("Method not found");
      expect(resp.error?.message).toContain("nonexistent.method");
    });
  });

  describe("handleMessage — builtin methods", () => {
    it("handles ping and returns pong", async () => {
      const result = await handler.handleMessage(makeRPCRequest("ping"));

      const resp = result as RPCResponse;
      expect(resp.error).toBeUndefined();
      const data = resp.result as { pong: boolean; timestamp: number };
      expect(data.pong).toBe(true);
      expect(data.timestamp).toBeGreaterThan(0);
    });

    it("handles status without runtime returning stopped", async () => {
      const result = await handler.handleMessage(makeRPCRequest("status"));

      const resp = result as RPCResponse;
      expect(resp.error).toBeUndefined();
      expect(resp.result).toEqual({ status: "stopped" });
    });

    it("handles status with runtime returning full status", async () => {
      handler.setRuntime(makeMockRuntime());

      const result = await handler.handleMessage(makeRPCRequest("status"));

      const resp = result as RPCResponse;
      expect(resp.error).toBeUndefined();
      const status = resp.result as RuntimeStatus;
      expect(status.activeProvider).toBe("anthropic");
      expect(status.sessionId).toBe("session-123");
    });

    it("handles session.list returning empty array", async () => {
      const result = await handler.handleMessage(makeRPCRequest("session.list"));

      const resp = result as RPCResponse;
      expect(resp.result).toEqual([]);
    });

    it("handles session.create with default name", async () => {
      const result = await handler.handleMessage(makeRPCRequest("session.create", {}));

      const resp = result as RPCResponse;
      const session = resp.result as { id: string; name: string; createdAt: number };
      expect(session.id).toBeTruthy();
      expect(session.createdAt).toBeGreaterThan(0);
    });

    it("handles session.create with custom name", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("session.create", { name: "my-session" }),
      );

      const resp = result as RPCResponse;
      const session = resp.result as { id: string; name: string };
      expect(session.name).toBe("my-session");
    });

    it("handles providers.list without runtime", async () => {
      const result = await handler.handleMessage(makeRPCRequest("providers.list"));

      const resp = result as RPCResponse;
      // Without runtime, handler still probes available providers (Ollama, env vars)
      const providers = resp.result as Array<{ id: string; name: string }>;
      expect(Array.isArray(providers)).toBe(true);
    });

    it("handles providers.list with runtime", async () => {
      handler.setRuntime(makeMockRuntime());

      const result = await handler.handleMessage(makeRPCRequest("providers.list"));

      const resp = result as RPCResponse;
      // CI may have no API keys, no Ollama, no Codex CLI — the probe legitimately
      // returns an empty array. Locally the same test sees ≥1 provider. What we
      // care about is that the handler returns a real array (no error response).
      if (resp.error) {
        // No-runtime fallback path threw — that's a real bug; surface it.
        throw new Error(`providers.list returned error: ${JSON.stringify(resp.error)}`);
      }
      const providers = resp.result as Array<{ id: string; name: string; available: boolean }>;
      expect(Array.isArray(providers)).toBe(true);
    });

    it("handles providers.switch with valid params", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("providers.switch", { provider: "openai", model: "gpt-4" }),
      );

      const resp = result as RPCResponse;
      // Test environment may not have OPENAI_API_KEY set, in which case
      // setActive throws "openai is not configured". Either outcome is
      // acceptable — what we're verifying is that the params reached the
      // handler (didn't get rejected as missing).
      if (resp.error) {
        expect(resp.error.message).toMatch(/(not configured|Unknown provider|Model .* not available)/);
      } else {
        const data = resp.result as { success: boolean; provider: string; model: string };
        expect(data.success).toBe(true);
        expect(data.provider).toBe("openai");
      }
    });

    it("handles providers.switch with missing params", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("providers.switch", {}),
      );

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32603);
      expect(resp.error?.message).toContain("provider and model required");
    });

    it("handles cost.current returning default zeros", async () => {
      const result = await handler.handleMessage(makeRPCRequest("cost.current"));

      const resp = result as RPCResponse;
      const cost = resp.result as { sessionCost: number; budget: number };
      expect(cost.sessionCost).toBe(0);
      expect(cost.budget).toBe(0);
    });

    it("handles memory.search with empty query returning empty", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("memory.search", { query: "" }),
      );

      const resp = result as RPCResponse;
      expect(resp.result).toEqual([]);
    });

    it("handles enhance with valid prompt", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("enhance", { prompt: "help me write code" }),
      );

      const resp = result as RPCResponse;
      const data = resp.result as { original: string; enhanced: string; style: string };
      expect(data.original).toBe("help me write code");
      expect(data.style).toBe("detailed");
    });

    it("handles enhance with missing prompt", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("enhance", {}),
      );

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32603);
    });

    it("handles agents.spawn with task", async () => {
      // Wire a mock runtime with TaskDelegationManager
      const mockDelegation = {
        create: vi.fn(() => ({ id: "agent-123", task: "Write tests", status: "pending" })),
        getPending: vi.fn(() => []),
        complete: vi.fn(() => true),
      };
      const runtimeWithDelegation = {
        ...makeMockRuntime(),
        getTaskDelegationManager: vi.fn(() => mockDelegation),
      } as unknown as WotannRuntime;
      handler.setRuntime(runtimeWithDelegation);

      const result = await handler.handleMessage(
        makeRPCRequest("agents.spawn", { task: "Write tests" }),
      );

      const resp = result as RPCResponse;
      const agent = resp.result as { id: string; task: string; status: string };
      expect(agent.task).toBe("Write tests");
      expect(agent.status).toBe("pending");
    });

    it("handles agents.spawn without task", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("agents.spawn", {}),
      );

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32603);
    });

    it("handles agents.kill with valid id", async () => {
      // Wire a mock runtime with TaskDelegationManager
      const mockDelegation = {
        create: vi.fn(() => ({ id: "agent-1", task: "test", status: "pending" })),
        getPending: vi.fn(() => []),
        complete: vi.fn(() => true),
      };
      const runtimeWithDelegation = {
        ...makeMockRuntime(),
        getTaskDelegationManager: vi.fn(() => mockDelegation),
      } as unknown as WotannRuntime;
      handler.setRuntime(runtimeWithDelegation);

      const result = await handler.handleMessage(
        makeRPCRequest("agents.kill", { id: "agent-1" }),
      );

      const resp = result as RPCResponse;
      const data = resp.result as { success: boolean; id: string };
      expect(data.success).toBe(true);
      expect(data.id).toBe("agent-1");
    });

    it("handles agents.kill without id", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("agents.kill", {}),
      );

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32603);
    });

    it("handles config.get", async () => {
      const result = await handler.handleMessage(makeRPCRequest("config.get"));

      const resp = result as RPCResponse;
      // config.get now reads real config from ~/.wotann/wotann.yaml
      expect(resp.result).toBeDefined();
      expect(typeof resp.result).toBe("object");
    });

    it("handles config.set", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("config.set", { key: "theme", value: "dark" }),
      );

      const resp = result as RPCResponse;
      expect((resp.result as { success: boolean }).success).toBe(true);
    });

    it("handles channels.status", async () => {
      const result = await handler.handleMessage(makeRPCRequest("channels.status"));

      const resp = result as RPCResponse;
      expect(resp.result).toEqual([]);
    });

    it("handles agents.list", async () => {
      const result = await handler.handleMessage(makeRPCRequest("agents.list"));

      const resp = result as RPCResponse;
      expect(resp.result).toEqual([]);
    });
  });

  describe("handleMessage — streaming (query)", () => {
    it("returns error stream when runtime not set", async () => {
      const result = await handler.handleMessage(
        makeRPCRequest("query", { prompt: "hello" }),
      );

      // Should be an async generator
      const generator = result as AsyncGenerator<RPCStreamEvent>;
      const events: RPCStreamEvent[] = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(events.length).toBe(1);
      expect(events[0]!.params.type).toBe("error");
      expect(events[0]!.params.content).toContain("Runtime not initialized");
    });

    it("streams events from runtime query", async () => {
      handler.setRuntime(makeMockRuntime());

      const result = await handler.handleMessage(
        makeRPCRequest("query", { prompt: "hello", sessionId: "sess-1" }),
      );

      const generator = result as AsyncGenerator<RPCStreamEvent>;
      const events: RPCStreamEvent[] = [];
      for await (const event of generator) {
        events.push(event);
      }

      expect(events.length).toBe(2);
      expect(events[0]!.params.type).toBe("text");
      expect(events[0]!.params.content).toBe("hello");
      expect(events[0]!.params.sessionId).toBe("sess-1");
      expect(events[1]!.params.type).toBe("done");
    });
  });

  describe("register / getMethods", () => {
    it("lists all builtin methods", () => {
      const methods = handler.getMethods();

      expect(methods).toContain("ping");
      expect(methods).toContain("status");
      expect(methods).toContain("session.list");
      expect(methods).toContain("providers.list");
      expect(methods).toContain("cost.current");
      expect(methods).toContain("agents.list");
    });

    it("registers a custom method", async () => {
      handler.register("custom.hello", async (params) => {
        return { greeting: `Hello, ${params.name}` };
      });

      expect(handler.getMethods()).toContain("custom.hello");

      const result = await handler.handleMessage(
        makeRPCRequest("custom.hello", { name: "World" }),
      );

      const resp = result as RPCResponse;
      expect((resp.result as { greeting: string }).greeting).toBe("Hello, World");
    });

    it("custom handler errors produce internal error response", async () => {
      handler.register("custom.fail", async () => {
        throw new Error("custom failure");
      });

      const result = await handler.handleMessage(makeRPCRequest("custom.fail"));

      const resp = result as RPCResponse;
      expect(resp.error?.code).toBe(-32603);
      expect(resp.error?.message).toBe("custom failure");
    });
  });

  describe("response format", () => {
    it("always includes jsonrpc 2.0 in responses", async () => {
      const result = await handler.handleMessage(makeRPCRequest("ping"));

      const resp = result as RPCResponse;
      expect(resp.jsonrpc).toBe("2.0");
    });

    it("preserves request id in response", async () => {
      const result = await handler.handleMessage(makeRPCRequest("ping", {}, 42));

      const resp = result as RPCResponse;
      expect(resp.id).toBe(42);
    });

    it("preserves string request id", async () => {
      const result = await handler.handleMessage(makeRPCRequest("ping", {}, "req-abc"));

      const resp = result as RPCResponse;
      expect(resp.id).toBe("req-abc");
    });

    it("uses id 0 for parse errors where id is unknown", async () => {
      const result = await handler.handleMessage("garbage");

      const resp = result as RPCResponse;
      expect(resp.id).toBe(0);
    });
  });
});
