/**
 * Unit tests for the pure MCP Apps postMessage bridge (V9 T4.2).
 *
 * These tests stub the `targetWindow` and `addMessageListener`
 * injections so no DOM, jsdom, or happy-dom is required. Covers:
 *   - listener lifecycle (add + remove, idempotent destroy)
 *   - origin boundary (silent drop, not onError)
 *   - envelope validation (malformed → onError)
 *   - each McpAppMessage variant (ready, tool-call, resource-read,
 *     state-update, error) — happy path and failure modes
 *   - sendToApp uses the configured targetOrigin, never "*"
 */

import { describe, it, expect, vi } from "vitest";
import { createMcpBridge } from "./mcp-bridge";
import type { HostMessage, McpAppManifest } from "./types";

// ── Helpers ──────────────────────────────────────────────────────────────

interface StubWindow {
  readonly postMessage: ReturnType<typeof vi.fn>;
}

function makeStubWindow(): StubWindow {
  return { postMessage: vi.fn() };
}

interface Harness {
  readonly handlers: ((e: MessageEvent) => void)[];
  readonly remove: ReturnType<typeof vi.fn>;
  readonly addMessageListener: (handler: (e: MessageEvent) => void) => () => void;
  readonly fire: (origin: string, data: unknown) => void;
}

function makeHarness(): Harness {
  const handlers: ((e: MessageEvent) => void)[] = [];
  const remove = vi.fn();
  return {
    handlers,
    remove,
    addMessageListener: (handler) => {
      handlers.push(handler);
      return () => {
        remove(handler);
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },
    fire(origin, data) {
      const ev = { origin, data } as MessageEvent;
      for (const h of handlers) h(ev);
    },
  };
}

const ORIGIN = "null";
const MANIFEST: McpAppManifest = {
  uri: "ui://wotann/memory-browser",
  name: "Memory Browser",
  allowedOrigins: ["null"],
  bridgeVersion: "1.0",
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe("createMcpBridge — listener lifecycle", () => {
  it("registers a message listener on construction", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      addMessageListener: h.addMessageListener,
    });
    expect(h.handlers.length).toBe(1);
  });

  it("removes the listener on destroy()", () => {
    const h = makeHarness();
    const bridge = createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      addMessageListener: h.addMessageListener,
    });
    expect(h.handlers.length).toBe(1);
    bridge.destroy();
    expect(h.handlers.length).toBe(0);
    expect(h.remove).toHaveBeenCalledTimes(1);
  });

  it("passes the same handler reference to the remover that was added", () => {
    const h = makeHarness();
    const bridge = createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      addMessageListener: h.addMessageListener,
    });
    const added = h.handlers[0];
    bridge.destroy();
    expect(h.remove).toHaveBeenCalledWith(added);
  });

  it("double destroy is idempotent", () => {
    const h = makeHarness();
    const bridge = createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      addMessageListener: h.addMessageListener,
    });
    bridge.destroy();
    bridge.destroy();
    // Remover called only once — second destroy is a no-op.
    expect(h.remove).toHaveBeenCalledTimes(1);
  });
});

describe("createMcpBridge — incoming origin boundary", () => {
  it("silently drops messages from the wrong origin (no onError)", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    const onError = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      onError,
      addMessageListener: h.addMessageListener,
    });
    h.fire("https://evil.example", {
      type: "mcp-app",
      payload: { type: "ready", manifest: MANIFEST },
    });
    expect(onAppMessage).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("accepts messages from the exact configured origin", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, {
      type: "mcp-app",
      payload: { type: "ready", manifest: MANIFEST },
    });
    expect(onAppMessage).toHaveBeenCalledTimes(1);
  });
});

describe("createMcpBridge — envelope validation", () => {
  it("reports onError for non-object data", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    const onError = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      onError,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, "not an object");
    expect(onAppMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it("reports onError for a non-mcp-app envelope", () => {
    const h = makeHarness();
    const onError = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      onError,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, { type: "other-frame", payload: {} });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports onError for an mcp-app envelope with missing payload field", () => {
    const h = makeHarness();
    const onError = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      onError,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, { type: "mcp-app" });
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports onError for unknown payload type", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    const onError = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      onError,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, { type: "mcp-app", payload: { type: "bogus" } });
    expect(onAppMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("onError missing is safe (no throw on malformed data)", () => {
    const h = makeHarness();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      addMessageListener: h.addMessageListener,
    });
    expect(() => h.fire(ORIGIN, "garbage")).not.toThrow();
  });
});

describe("createMcpBridge — incoming message routing", () => {
  it("routes a valid ready message carrying the manifest", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, { type: "mcp-app", payload: { type: "ready", manifest: MANIFEST } });
    expect(onAppMessage).toHaveBeenCalledTimes(1);
    const msg = onAppMessage.mock.calls[0]?.[0];
    expect(msg.type).toBe("ready");
    expect(msg.manifest.uri).toBe(MANIFEST.uri);
    expect(msg.manifest.bridgeVersion).toBe("1.0");
    expect(msg.manifest.allowedOrigins).toEqual(["null"]);
  });

  it("rejects a ready message missing the manifest", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    const onError = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      onError,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, { type: "mcp-app", payload: { type: "ready" } });
    expect(onAppMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("routes a tool-call message with toolName + args", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, {
      type: "mcp-app",
      payload: { type: "tool-call", toolName: "memory.search", args: { query: "foo" } },
    });
    expect(onAppMessage).toHaveBeenCalledWith({
      type: "tool-call",
      toolName: "memory.search",
      args: { query: "foo" },
    });
  });

  it("rejects a tool-call without a string toolName", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    const onError = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      onError,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, {
      type: "mcp-app",
      payload: { type: "tool-call", toolName: 42, args: {} },
    });
    expect(onAppMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("routes a resource-read message with uri", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, {
      type: "mcp-app",
      payload: { type: "resource-read", uri: "ui://wotann/cost-preview" },
    });
    expect(onAppMessage).toHaveBeenCalledWith({
      type: "resource-read",
      uri: "ui://wotann/cost-preview",
    });
  });

  it("routes a state-update message with arbitrary data", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, {
      type: "mcp-app",
      payload: { type: "state-update", data: { filter: "all", cursor: 3 } },
    });
    expect(onAppMessage).toHaveBeenCalledWith({
      type: "state-update",
      data: { filter: "all", cursor: 3 },
    });
  });

  it("routes an app error message with its string payload", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      addMessageListener: h.addMessageListener,
    });
    h.fire(ORIGIN, {
      type: "mcp-app",
      payload: { type: "error", message: "app blew up" },
    });
    expect(onAppMessage).toHaveBeenCalledWith({
      type: "error",
      message: "app blew up",
    });
  });
});

describe("createMcpBridge — sendToApp", () => {
  it("invokes postMessage with the configured targetOrigin (never '*')", () => {
    const h = makeHarness();
    const targetWindow = makeStubWindow();
    const bridge = createMcpBridge({
      targetWindow,
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      addMessageListener: h.addMessageListener,
    });
    const msg: HostMessage = { type: "tool-result", toolName: "memory.search", result: { hits: 3 } };
    bridge.sendToApp(msg);
    expect(targetWindow.postMessage).toHaveBeenCalledTimes(1);
    const [payload, origin] = targetWindow.postMessage.mock.calls[0] ?? [];
    expect(payload).toEqual(msg);
    expect(origin).toBe(ORIGIN);
    expect(origin).not.toBe("*");
  });

  it("uses the exact origin passed by the caller (e.g. a real https origin)", () => {
    const h = makeHarness();
    const targetWindow = makeStubWindow();
    const httpsOrigin = "https://app.wotann.com";
    const bridge = createMcpBridge({
      targetWindow,
      targetOrigin: httpsOrigin,
      onAppMessage: vi.fn(),
      addMessageListener: h.addMessageListener,
    });
    bridge.sendToApp({ type: "resource-content", uri: "ui://wotann/a", content: "<p/>" });
    const [, origin] = targetWindow.postMessage.mock.calls[0] ?? [];
    expect(origin).toBe(httpsOrigin);
  });

  it("does not post after destroy()", () => {
    const h = makeHarness();
    const targetWindow = makeStubWindow();
    const bridge = createMcpBridge({
      targetWindow,
      targetOrigin: ORIGIN,
      onAppMessage: vi.fn(),
      addMessageListener: h.addMessageListener,
    });
    bridge.destroy();
    bridge.sendToApp({ type: "error", message: "late reply" });
    expect(targetWindow.postMessage).not.toHaveBeenCalled();
  });

  it("swallows a throwing onError without killing the bridge", () => {
    const h = makeHarness();
    const onAppMessage = vi.fn();
    const onError = vi.fn(() => {
      throw new Error("host handler blew up");
    });
    createMcpBridge({
      targetWindow: makeStubWindow(),
      targetOrigin: ORIGIN,
      onAppMessage,
      onError,
      addMessageListener: h.addMessageListener,
    });
    // Malformed frame → onError throws. Bridge must not rethrow up
    // the listener chain, and must stay alive for the next message.
    expect(() => h.fire(ORIGIN, "garbage")).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    // Subsequent valid message still works.
    h.fire(ORIGIN, { type: "mcp-app", payload: { type: "ready", manifest: MANIFEST } });
    expect(onAppMessage).toHaveBeenCalledTimes(1);
  });
});
