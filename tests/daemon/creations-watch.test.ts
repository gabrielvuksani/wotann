/**
 * V9 GA-15 (T5.4) — `creations.watch` daemon RPC tests.
 *
 * Background: iOS `CreationsView.swift:280` calls `creations.watch` to
 * register a subscription before listening for `creations.updated` push
 * notifications. Before this fix the handler was unregistered and
 * `try? await rpcClient.send("creations.watch")` silently swallowed
 * the "method not found" error — the iOS UI never failed loud, but
 * it also never received the events the user expected.
 *
 * The handler now confirms the subscription and returns the canonical
 * push topic name. Push delivery itself flows through:
 *
 *     CreationsStore.save/delete
 *       -> UnifiedDispatchPlane.broadcastUnifiedEvent
 *       -> CompanionBridge maps `creation-saved`/`-deleted`/`file-write`
 *          -> "creations.updated"
 *       -> CompanionServer.broadcastNotification (WS push)
 *       -> iOS RPCClient.subscribe("creations.updated") -> handler
 *
 * Each test pins down ONE invariant per QB #14.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";
import { UNIFIED_EVENT_TO_TOPIC } from "../../src/session/dispatch/companion-bridge.js";

function makeRPCRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number = 1,
): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id });
}

function isRPCResponse(val: unknown): val is RPCResponse {
  return typeof val === "object" && val !== null && "jsonrpc" in val && "id" in val;
}

describe("KairosRPCHandler — creations.watch (V9 GA-15)", () => {
  let handler: KairosRPCHandler;

  beforeEach(() => {
    handler = new KairosRPCHandler();
  });

  it("returns ok:true and the canonical topic name when called without params", async () => {
    const raw = await handler.handleMessage(makeRPCRequest("creations.watch"));
    expect(isRPCResponse(raw)).toBe(true);
    const resp = raw as RPCResponse;
    expect(resp.error).toBeUndefined();
    const result = resp.result as Record<string, unknown>;
    expect(result["ok"]).toBe(true);
    expect(result["topic"]).toBe("creations.updated");
  });

  it("echoes back sessionId when one is provided (filter hint)", async () => {
    const raw = await handler.handleMessage(
      makeRPCRequest("creations.watch", { sessionId: "session-abc" }),
    );
    const resp = raw as RPCResponse;
    expect(resp.error).toBeUndefined();
    const result = resp.result as Record<string, unknown>;
    expect(result["sessionId"]).toBe("session-abc");
    expect(result["topic"]).toBe("creations.updated");
  });

  it("rejects non-string sessionId with a clear error (honest validation)", async () => {
    const raw = await handler.handleMessage(
      makeRPCRequest("creations.watch", { sessionId: 42 }),
    );
    const resp = raw as RPCResponse;
    expect(resp.error).toBeDefined();
    expect(resp.error?.message).toContain("sessionId");
  });

  it("reports bridged:true so iOS surfaces can detect push availability", async () => {
    const raw = await handler.handleMessage(makeRPCRequest("creations.watch"));
    const resp = raw as RPCResponse;
    const result = resp.result as Record<string, unknown>;
    expect(result["bridged"]).toBe(true);
  });

  it("alias is wired in companion-bridge UNIFIED_EVENT_TO_TOPIC mapping", () => {
    // creation-saved / creation-deleted / file-write all flow to
    // `creations.updated`. The watch handler returns this topic name
    // so iOS knows what to subscribe to. Verifying the mapping here
    // means the cross-surface contract is upheld in one assert site
    // (QB #11 — sibling-site safety).
    expect(UNIFIED_EVENT_TO_TOPIC["creation-saved"]).toBe("creations.updated");
    expect(UNIFIED_EVENT_TO_TOPIC["creation-deleted"]).toBe("creations.updated");
    expect(UNIFIED_EVENT_TO_TOPIC["file-write"]).toBe("creations.updated");
  });

  it("multiple watch calls each return ok:true (idempotent subscription seeding)", async () => {
    const r1 = (await handler.handleMessage(makeRPCRequest("creations.watch", {}, 1))) as RPCResponse;
    const r2 = (await handler.handleMessage(makeRPCRequest("creations.watch", {}, 2))) as RPCResponse;
    expect((r1.result as Record<string, unknown>)["ok"]).toBe(true);
    expect((r2.result as Record<string, unknown>)["ok"]).toBe(true);
  });

  it("emit -> receive: saving a creation fans out as a creations.updated WS push", async () => {
    // Wire a fake CompanionServer sink so we can assert the bridge
    // translates the CreationsStore emit into the topic-named RPC
    // notification iOS will receive. This pins down the full chain:
    // store.save -> UnifiedEvent -> bridge -> notification topic.
    const bridge = await import("../../src/session/dispatch/companion-bridge.js");
    const planeMod = await import("../../src/channels/unified-dispatch.js");
    const plane = new planeMod.UnifiedDispatchPlane();

    const received: Array<{ method: string; params: unknown }> = [];
    const sink = {
      broadcastNotification: (n: { method: string; params: Record<string, unknown> }) => {
        received.push({ method: n.method, params: n.params });
      },
    };
    const handle = bridge.createCompanionBridge(plane, sink);

    // Get the creations store via the handler accessor and wire its
    // broadcast into the plane (mirrors the composition root in
    // kairos-rpc.ts:1189).
    const store = handler.getCreationsStore();
    store.setBroadcast((ev) => plane.broadcastUnifiedEvent(ev));

    // Save a creation — should fan out as `creations.updated`.
    // The store's broadcast hook is async (fire-and-forget within emit()),
    // so we yield the event loop to let the bridge listener run before
    // asserting. One tick is enough — the surface fan-out is in-process.
    store.save({
      sessionId: "test-session",
      filename: "hello.txt",
      content: Buffer.from("hi"),
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(received.some((n) => n.method === "creations.updated")).toBe(true);

    handle.dispose();
  });
});
