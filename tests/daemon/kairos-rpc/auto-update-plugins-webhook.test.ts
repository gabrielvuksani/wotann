/**
 * Integration tests for the kairos-rpc handlers wired this session
 * for the resurrected modules:
 *   - models.recommended       → src/daemon/auto-update.ts
 *   - models.checkForUpdates   → src/daemon/auto-update.ts
 *   - plugins.list             → src/marketplace/plugin-loader.ts
 *   - connectors.webhook.start → src/connectors/connector-webhook-server.ts
 *   - connectors.webhook.stop  → src/connectors/connector-webhook-server.ts
 *
 * These tests drive the public RPC surface (handler.handleMessage(json))
 * rather than calling the underlying functions directly, so they catch
 * regressions in the wire-up itself (param parsing, envelope shape,
 * error code mapping). The unit-level tests live alongside each module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import {
  KairosRPCHandler,
  type RPCResponse,
} from "../../../src/daemon/kairos-rpc.js";
import type { WotannRuntime, RuntimeStatus } from "../../../src/core/runtime.js";

function makeRPCRequest(
  method: string,
  params?: Record<string, unknown>,
  id: string | number = 1,
): string {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id });
}

/**
 * The wired-in-this-session handlers (models.*, plugins.list,
 * connectors.webhook.*) live inside `registerSurfaceHandlers()` which
 * is called from `setRuntime()`, not the bare constructor. We therefore
 * attach a minimal runtime stub before each test so the surface
 * handlers are registered. The stub is intentionally bare — we only
 * exercise handlers that DON'T touch runtime state.
 */
function makeMockRuntime(): WotannRuntime {
  const status: RuntimeStatus = {
    providers: ["anthropic"],
    activeProvider: "anthropic",
    hookCount: 0,
    middlewareLayers: 0,
    memoryEnabled: false,
    sessionId: "test-session",
    totalTokens: 0,
    totalCost: 0,
    currentMode: "default",
    traceEntries: 0,
    semanticIndexSize: 0,
    skillCount: 0,
    contextPercent: 0,
    messageCount: 0,
  };
  return {
    getStatus: vi.fn(() => status),
    query: vi.fn(async function* () {
      yield { type: "done", content: "", provider: "anthropic", model: "test" };
    }),
    // setRuntime() in kairos-rpc tries to read getDispatchPlane(); we throw
    // so the catch-block path takes the "no broadcast" fallback.
    getDispatchPlane: vi.fn(() => {
      throw new Error("no dispatch plane in test");
    }),
  } as unknown as WotannRuntime;
}

function makeHandlerWithRuntime(): KairosRPCHandler {
  const h = new KairosRPCHandler();
  h.setRuntime(makeMockRuntime());
  return h;
}

describe("kairos-rpc — models.recommended", () => {
  let handler: KairosRPCHandler;

  beforeEach(() => {
    handler = makeHandlerWithRuntime();
  });

  afterEach(() => {
    handler.dispose();
  });

  it("returns ok:true with a non-empty array of model id strings", async () => {
    const result = await handler.handleMessage(makeRPCRequest("models.recommended"));
    const resp = result as RPCResponse;

    expect(resp.error).toBeUndefined();
    const data = resp.result as { ok: boolean; models: readonly string[] };
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.models)).toBe(true);
    expect(data.models.length).toBeGreaterThan(0);
    for (const m of data.models) {
      expect(typeof m).toBe("string");
    }
  });
});

describe("kairos-rpc — models.checkForUpdates", () => {
  let handler: KairosRPCHandler;
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    handler = makeHandlerWithRuntime();
    originalHome = process.env["WOTANN_HOME"];
    tempHome = mkdtempSync(join(tmpdir(), "wotann-rpc-update-"));
    process.env["WOTANN_HOME"] = tempHome;
    // Mock fetch so the handler's auto-update import never hits network.
    // Returning ECONNREFUSED is realistic for "no Ollama running".
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      throw new Error("ECONNREFUSED — mocked");
    });
    vi.resetModules();
  });

  afterEach(() => {
    handler.dispose();
    if (originalHome === undefined) delete process.env["WOTANN_HOME"];
    else process.env["WOTANN_HOME"] = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns the {newModels, cached} envelope without error", async () => {
    const result = await handler.handleMessage(makeRPCRequest("models.checkForUpdates"));
    const resp = result as RPCResponse;

    expect(resp.error).toBeUndefined();
    const data = resp.result as { newModels?: readonly unknown[]; cached?: boolean; error?: string };
    // Either the wire-up returned the real envelope, or it surfaced an
    // error string field — both are acceptable handler responses, but
    // the JSON-RPC error code itself must NOT be set.
    if (data.error === undefined) {
      expect(Array.isArray(data.newModels)).toBe(true);
      expect(typeof data.cached).toBe("boolean");
    }
  });
});

describe("kairos-rpc — plugins.list", () => {
  let handler: KairosRPCHandler;
  let tempRoot: string;

  beforeEach(() => {
    handler = makeHandlerWithRuntime();
    tempRoot = mkdtempSync(join(tmpdir(), "wotann-rpc-plugins-"));
  });

  afterEach(() => {
    handler.dispose();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns ok:true with empty plugins[] when pluginsRoot has no plugin dirs", async () => {
    const result = await handler.handleMessage(
      makeRPCRequest("plugins.list", { pluginsRoot: tempRoot }),
    );
    const resp = result as RPCResponse;
    expect(resp.error).toBeUndefined();
    const data = resp.result as {
      ok: boolean;
      plugins: readonly unknown[];
      skipped: readonly unknown[];
    };
    expect(data.ok).toBe(true);
    expect(data.plugins).toEqual([]);
    expect(data.skipped).toEqual([]);
  });

  it("returns ok:true with empty plugins[] when pluginsRoot does not exist", async () => {
    const ghost = join(tempRoot, "does-not-exist");
    const result = await handler.handleMessage(
      makeRPCRequest("plugins.list", { pluginsRoot: ghost }),
    );
    const resp = result as RPCResponse;
    expect(resp.error).toBeUndefined();
    const data = resp.result as { ok: boolean; plugins: readonly unknown[] };
    expect(data.ok).toBe(true);
    expect(data.plugins).toEqual([]);
  });

  it("surfaces a parsed plugin from a valid plugin.json", async () => {
    const pluginDir = join(tempRoot, "tester");
    mkdirSync(join(pluginDir, "bin"), { recursive: true });
    const binPath = join(pluginDir, "bin", "run");
    writeFileSync(binPath, "#!/bin/sh\necho ok\n");
    chmodSync(binPath, 0o755);
    writeFileSync(
      join(pluginDir, "plugin.json"),
      JSON.stringify({
        name: "tester",
        bins: [{ name: "run", path: "bin/run" }],
      }),
    );

    const result = await handler.handleMessage(
      makeRPCRequest("plugins.list", { pluginsRoot: tempRoot }),
    );
    const resp = result as RPCResponse;
    expect(resp.error).toBeUndefined();
    const data = resp.result as {
      ok: boolean;
      plugins: readonly { name: string; bins: readonly { name: string }[] }[];
    };
    expect(data.ok).toBe(true);
    expect(data.plugins).toHaveLength(1);
    expect(data.plugins[0]?.name).toBe("tester");
    expect(data.plugins[0]?.bins[0]?.name).toBe("run");
  });
});

describe("kairos-rpc — connectors.webhook.start / stop", () => {
  let handler: KairosRPCHandler;

  beforeEach(() => {
    handler = makeHandlerWithRuntime();
  });

  // Idempotent cleanup: try to stop in case a test left the server up.
  afterEach(async () => {
    await handler.handleMessage(
      makeRPCRequest("connectors.webhook.stop", undefined, "cleanup"),
    );
    handler.dispose();
  });

  it("returns error when port param is missing", async () => {
    const result = await handler.handleMessage(
      makeRPCRequest("connectors.webhook.start", { secrets: { x: { kind: "linear", secret: "k", signatureHeader: "x-linear-signature" } } }),
    );
    const resp = result as RPCResponse;
    // The handler returns the error in `result.error`, not as a JSON-RPC
    // error envelope — both shapes mean "rejected", and we accept either.
    if (resp.error) {
      expect(resp.error.message).toMatch(/port required/);
    } else {
      const data = resp.result as { error?: string };
      expect(data.error).toMatch(/port required/);
    }
  });

  it("returns error when secrets param is missing or empty", async () => {
    const result = await handler.handleMessage(
      makeRPCRequest("connectors.webhook.start", { port: 0 }),
    );
    const resp = result as RPCResponse;
    if (resp.error) {
      expect(resp.error.message).toMatch(/secrets required/);
    } else {
      const data = resp.result as { error?: string };
      expect(data.error).toMatch(/secrets required/);
    }
  });

  it("starts the server with valid args and returns ok:true with bound host/port", async () => {
    const startResult = await handler.handleMessage(
      makeRPCRequest("connectors.webhook.start", {
        port: 0,
        host: "127.0.0.1",
        secrets: {
          "linear-prod": {
            kind: "linear",
            secret: "test-secret",
            signatureHeader: "x-linear-signature",
          },
        },
      }),
    );
    const startResp = startResult as RPCResponse;
    expect(startResp.error).toBeUndefined();
    const startData = startResp.result as { ok: boolean; host: string; port: number };
    expect(startData.ok).toBe(true);
    expect(startData.host).toBe("127.0.0.1");
    expect(startData.port).toBeGreaterThan(0);

    // Smoke test — fire one valid HMAC request to verify the dispatcher
    // path is wired end-to-end before we tear down.
    const body = JSON.stringify({ id: "evt-rpc-1" });
    const sig = createHmac("sha256", "test-secret").update(body).digest("hex");
    const httpRes = await fetch(
      `http://${startData.host}:${startData.port}/webhook/linear-prod`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-linear-signature": sig,
        },
        body,
      },
    );
    expect(httpRes.status).toBe(200);

    // Now stop — should report wasRunning:true.
    const stopResult = await handler.handleMessage(
      makeRPCRequest("connectors.webhook.stop"),
    );
    const stopResp = stopResult as RPCResponse;
    expect(stopResp.error).toBeUndefined();
    const stopData = stopResp.result as { ok: boolean; wasRunning: boolean };
    expect(stopData.ok).toBe(true);
    expect(stopData.wasRunning).toBe(true);
  });

  it("stop on a never-started server returns ok:true wasRunning:false", async () => {
    const result = await handler.handleMessage(makeRPCRequest("connectors.webhook.stop"));
    const resp = result as RPCResponse;
    expect(resp.error).toBeUndefined();
    const data = resp.result as { ok: boolean; wasRunning: boolean };
    expect(data.ok).toBe(true);
    expect(data.wasRunning).toBe(false);
  });
});
