/**
 * voice.transcribe / voice.stream.{start,poll,cancel} RPC regression tests.
 *
 * Session-5 wiring verification — session-4's commit message claimed
 * these handlers were wired to VoicePipeline, but the live handlers
 * still returned honest-error envelopes (Phase-1 adversarial audit
 * GAP-1). This test suite pins the real-wiring contract so a future
 * regression to the stub shape FAILS CI loudly rather than silently.
 *
 * We don't exercise a real STT backend (which would require audio
 * infra the CI sandbox can't provide) — instead we verify the RPC
 * surface: shape, routing, error paths, cursor semantics, idempotence.
 * The underlying VoicePipeline.transcribe() path is tested separately
 * in the voice module's own tests.
 */
import { describe, it, expect, vi } from "vitest";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";
import type { WotannRuntime, RuntimeStatus } from "../../src/core/runtime.js";

function makeRequest(method: string, params?: Record<string, unknown>, id: string | number = 1) {
  return JSON.stringify({ jsonrpc: "2.0", method, params, id });
}

// Voice handlers live in `registerSelfImprovementHandlers()` which the
// constructor does NOT call — it fires on `setRuntime()`. So every test
// here must wire a mock runtime before calling handleMessage, otherwise
// the router returns "Method not found".
function makeWiredHandler(): KairosRPCHandler {
  const status: RuntimeStatus = {
    providers: [],
    activeProvider: null,
    hookCount: 0,
    middlewareLayers: 0,
    memoryEnabled: false,
    sessionId: "t",
    totalTokens: 0,
    totalCost: 0,
    currentMode: "default",
    traceEntries: 0,
    semanticIndexSize: 0,
    skillCount: 0,
    contextPercent: 0,
    messageCount: 0,
  };
  const runtime = {
    getStatus: vi.fn(() => status),
    query: vi.fn(async function* () {
      // No-op generator; the voice handlers don't call query.
    }),
  } as unknown as WotannRuntime;
  const h = new KairosRPCHandler();
  h.setRuntime(runtime);
  return h;
}

async function call(handler: KairosRPCHandler, method: string, params?: Record<string, unknown>) {
  const raw = await handler.handleMessage(makeRequest(method, params));
  return raw as RPCResponse;
}

describe("voice RPC handlers (session-5 wiring)", () => {
  it("voice.transcribe rejects calls missing audioPath", async () => {
    const h = makeWiredHandler();
    const resp = await call(h, "voice.transcribe", {});
    const body = resp.result as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("audioPath");
  });

  it("voice.transcribe returns an honest envelope (no fabricated success)", async () => {
    const h = makeWiredHandler();
    // The exact outcome is platform-dependent — on macOS a bogus
    // audioPath causes every STT backend in the VoicePipeline cascade
    // to throw or return confidence:0, surfacing as {ok:false, error}.
    // On Linux CI the Web Speech API detector may produce a stub
    // success envelope first. Either outcome is honest; quality bar
    // #12 (env-dependent test assertions break on clean CI) says we
    // assert the CONTRACT — no mixed envelope — not the specific
    // success/failure outcome.
    const resp = await call(h, "voice.transcribe", {
      audioPath: "/nonexistent/fake-audio.wav",
    });
    const body = resp.result as {
      ok: boolean;
      text?: string;
      error?: string;
      confidence?: number;
    };
    if (body.ok === false) {
      expect(typeof body.error).toBe("string");
      expect(body.error!.length).toBeGreaterThan(0);
    } else {
      // ok:true must carry actual data, not a fabricated stub.
      expect(typeof body.text).toBe("string");
      expect(typeof body.confidence).toBe("number");
    }
  });

  it("voice.stream.start returns a streamId shape callers can poll with", async () => {
    const h = makeWiredHandler();
    const resp = await call(h, "voice.stream.start", {
      audioPath: "/nonexistent/fake-audio.wav",
    });
    const body = resp.result as { ok: boolean; streamId?: string };
    expect(body.ok).toBe(true);
    expect(typeof body.streamId).toBe("string");
    expect(body.streamId).toMatch(/^vstream-/);
  });

  it("voice.stream.poll drains chunks with cursor and reports done flag", async () => {
    const h = makeWiredHandler();
    const start = (await call(h, "voice.stream.start", { audioPath: "/nonexistent/fake.wav" }))
      .result as { streamId: string };
    // Give the background transcription a tick to settle to `done:true`.
    await new Promise((r) => setTimeout(r, 50));
    const poll = (await call(h, "voice.stream.poll", { streamId: start.streamId, cursor: 0 }))
      .result as {
      ok: boolean;
      chunks: Array<{ seq: number; text: string; isFinal: boolean }>;
      done: boolean;
    };
    expect(poll.ok).toBe(true);
    expect(Array.isArray(poll.chunks)).toBe(true);
    expect(typeof poll.done).toBe("boolean");
  });

  it("voice.stream.poll rejects unknown streamId with a clear error", async () => {
    const h = makeWiredHandler();
    const resp = await call(h, "voice.stream.poll", {
      streamId: "not-a-real-stream",
      cursor: 0,
    });
    const body = resp.result as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/not found/i);
  });

  it("voice.stream.cancel is idempotent on an unknown streamId", async () => {
    const h = makeWiredHandler();
    const resp = await call(h, "voice.stream.cancel", { streamId: "not-a-real-stream" });
    const body = resp.result as { ok: boolean; cancelled: boolean };
    expect(body.ok).toBe(true);
    expect(body.cancelled).toBe(false);
  });

  it("voice.stream (blocking alias) requires audioPath", async () => {
    const h = makeWiredHandler();
    const resp = await call(h, "voice.stream", {});
    const body = resp.result as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/audioPath|voice\.stream\.start/);
  });
});
