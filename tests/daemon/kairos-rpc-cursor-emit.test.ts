/**
 * V9 GA-01 — cursor stream emit on `computer.session.step`.
 *
 * Verifies the kairos-rpc.ts cursor.record() bridge that fires after a
 * successful executeDesktopAction for pointer-affecting routes (click,
 * scroll, move-mouse, move). Without this bridge, agents dispatching
 * desktop actions through `computer.session.step` produced visible OS
 * pointer movement but no cross-surface event trail — the cursor stream
 * was reachable only via the explicit `cursor.emit` RPC.
 *
 * Test strategy:
 *  - Mock the `executeDesktopAction` import so we can deterministically
 *    return success / failure without depending on cliclick or xdotool
 *    being installed (QB #13: no environment-dependent test assertions).
 *  - Spy on `handler.getCursorStream().record` to assert the exact emit
 *    surface — the public `cursor.emit` RPC and the `step`-driven emit
 *    both go through the same `record()` entry point, so spying covers
 *    both sinks (session log + broadcast) without re-implementing them.
 *
 * Coverage:
 *  1. click action emits cursor with action="click" + x/y/button
 *  2. scroll action emits cursor with action="scroll"
 *  3. move-mouse action emits cursor with action="move"
 *  4. non-cursor action (open-url) does NOT emit cursor
 *  5. executeDesktopAction failure does NOT emit cursor
 *  6. cursorStream.record throwing does NOT roll back action result
 */
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock platform-bindings so executeDesktopAction is deterministic.
// Other exports (DesktopAction, RouteResult types) are erased at runtime
// — TypeScript types don't need to be re-mocked.
vi.mock("../../src/computer-use/platform-bindings.js", () => ({
  executeDesktopAction: vi.fn(),
}));

import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";
import { executeDesktopAction } from "../../src/computer-use/platform-bindings.js";

// ── Helpers ────────────────────────────────────────────────

let nextId = 1;
function makeRequest(method: string, params?: Record<string, unknown>): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id: nextId++ });
}

async function call(
  handler: KairosRPCHandler,
  method: string,
  params?: Record<string, unknown>,
): Promise<RPCResponse> {
  const raw = makeRequest(method, params);
  const res = await handler.handleMessage(raw);
  // computer.session handlers are non-streaming — always RPCResponse.
  return res as RPCResponse;
}

type SessionDto = {
  id: string;
  status: string;
};

/** Create + claim a session so it's ready to receive a step. */
async function makeReadySession(handler: KairosRPCHandler): Promise<{
  sessionId: string;
  deviceId: string;
}> {
  const deviceId = "desktop-test";
  const created = await call(handler, "computer.session.create", {
    creatorDeviceId: "phone-test",
    taskSpec: { task: "cursor emit test" },
  });
  const sessionId = (created.result as SessionDto).id;
  await call(handler, "computer.session.claim", { sessionId, deviceId });
  return { sessionId, deviceId };
}

const mockedExecute = executeDesktopAction as unknown as Mock;

// ── Tests ──────────────────────────────────────────────────

describe("kairos-rpc cursor emit on computer.session.step (V9 GA-01)", () => {
  let handler: KairosRPCHandler;
  let recordSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
    mockedExecute.mockReset();
    // Default: every action succeeds with a benign output. Individual
    // tests override (e.g. test 5 returns failure).
    mockedExecute.mockReturnValue({ success: true, output: "ok" });
    recordSpy = vi.spyOn(handler.getCursorStream(), "record");
  });

  // 1. click emits cursor with action="click" + x/y/button
  it("click action emits cursor sample with action=click and forwards button", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);

    const stepped = await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "click", params: { x: 100, y: 200, button: "left" } },
    });

    expect(stepped.error).toBeUndefined();
    // Action wired through to the route table
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(mockedExecute.mock.calls[0]?.[0]).toMatchObject({ action: "click" });
    // Cursor stream saw the emit
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      sessionId,
      deviceId,
      x: 100,
      y: 200,
      action: "click",
      button: "left",
    });
    // Action result flows back to caller untouched
    expect(stepped.result).toMatchObject({
      execution: { success: true, output: "ok" },
    });
  });

  // 2. scroll emits cursor with action="scroll"
  it("scroll action emits cursor sample with action=scroll", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);

    await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "scroll", params: { x: 300, y: 400, dx: 0, dy: 5 } },
    });

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      sessionId,
      deviceId,
      x: 300,
      y: 400,
      action: "scroll",
    });
    // No button on scroll — confirm the bridge omits it.
    expect(recordSpy.mock.calls[0]?.[0]).not.toHaveProperty("button");
  });

  // 3. move-mouse emits cursor with action="move"
  it("move-mouse action emits cursor sample with action=move (string mapping)", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);

    await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "move-mouse", params: { x: 50, y: 60 } },
    });

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0]?.[0]).toMatchObject({
      sessionId,
      deviceId,
      x: 50,
      y: 60,
      action: "move",
    });
  });

  // 3b. "move" alias also maps (forward-compat per kairos-rpc cursor mapping)
  it("move action (alias for move-mouse) emits cursor sample with action=move", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);

    await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "move", params: { x: 70, y: 80 } },
    });

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0]?.[0]?.action).toBe("move");
  });

  // 4. non-cursor action (open-url) does NOT emit cursor
  it("non-cursor route (open-url) does not invoke cursorStream.record", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);

    const stepped = await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "open-url", params: { url: "https://example.com" } },
    });

    expect(stepped.error).toBeUndefined();
    // Route handler ran...
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    // ...but cursor stream stayed silent.
    expect(recordSpy).not.toHaveBeenCalled();
  });

  // 4b. screenshot also does not emit cursor (paranoid coverage of the
  // mapping table — anything not in {click, scroll, move-mouse, move}
  // must skip the emit).
  it("screenshot route does not invoke cursorStream.record", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);

    await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "screenshot", params: {} },
    });

    expect(recordSpy).not.toHaveBeenCalled();
  });

  // 5. executeDesktopAction failure does NOT emit cursor
  it("executeDesktopAction returning success=false does not emit cursor", async () => {
    mockedExecute.mockReturnValue({ success: false, output: "backend missing" });
    const { sessionId, deviceId } = await makeReadySession(handler);

    const stepped = await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "click", params: { x: 10, y: 20 } },
    });

    expect(stepped.error).toBeUndefined();
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    // Failure path: gating clause `if (execution?.success)` skips emit.
    expect(recordSpy).not.toHaveBeenCalled();
    // Caller still sees the failure envelope on `execution`.
    expect(stepped.result).toMatchObject({
      execution: { success: false, output: "backend missing" },
    });
  });

  // 5b. executeDesktopAction returning null (route not in table) also
  // skips the emit. Defends against the route-table-miss path that the
  // T1.1 wire surfaces explicitly.
  it("executeDesktopAction returning null does not emit cursor", async () => {
    mockedExecute.mockReturnValue(null);
    const { sessionId, deviceId } = await makeReadySession(handler);

    const stepped = await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "click", params: { x: 10, y: 20 } },
    });

    expect(stepped.error).toBeUndefined();
    expect(recordSpy).not.toHaveBeenCalled();
    // Per kairos-rpc serialization, null execution becomes execution: null.
    expect((stepped.result as Record<string, unknown>)["execution"]).toBeNull();
  });

  // 6. cursorStream.record throwing does NOT roll back action result
  it("cursorStream.record throwing does not roll back the action result", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);
    recordSpy.mockImplementation(() => {
      throw new Error("simulated cursor sink failure");
    });

    const stepped = await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "click", params: { x: 1, y: 2, button: "left" } },
    });

    // Even though the cursor sink threw, the RPC must succeed with the
    // executeDesktopAction result intact.
    expect(stepped.error).toBeUndefined();
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(stepped.result).toMatchObject({
      execution: { success: true, output: "ok" },
    });
  });

  // Defensive: missing/non-numeric coordinates skip the emit but DO NOT
  // throw. Defends against agents passing string coordinates that fail
  // Number() coercion — better to drop the cursor mirror than to fail
  // the whole step call.
  it("non-numeric coordinates skip cursor emit without failing the step", async () => {
    const { sessionId, deviceId } = await makeReadySession(handler);

    const stepped = await call(handler, "computer.session.step", {
      sessionId,
      deviceId,
      step: { action: "click", params: { x: "not-a-number", y: "also-not" } },
    });

    expect(stepped.error).toBeUndefined();
    // Route was called (the route handler also validates and reports
    // failure — but our gating fires on `execution?.success`).
    expect(mockedExecute).toHaveBeenCalledTimes(1);
    // Cursor sink: parsed coords were non-finite, so emit was skipped.
    expect(recordSpy).not.toHaveBeenCalled();
  });
});
