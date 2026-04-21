/**
 * Phase 3 P1-F12 — Apple Watch new-task dispatch tests.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 3, the Watch
 * already has APPROVE primitives but cannot DISPATCH a new task. F12 adds
 * the server-side RPC surface so the Watch can spawn fresh ComputerSessions
 * from templates. These tests exercise the registry + dispatch primitive:
 *
 *   Registry-level:
 *     1. templates.list returns registered templates (sorted/deterministic)
 *     2. built-in templates are registered by default
 *     3. dispatch creates session via F1 store
 *     4. auto-claim: session immediately has claimedByDeviceId set
 *     5. slot validation rejects extra slots → ErrorInvalidArgs
 *     6. slot validation rejects missing required slot → ErrorInvalidArgs
 *     7. slot validation rejects wrong type → ErrorInvalidArgs
 *     8. unknown template → ErrorUnknownTemplate
 *     9. rate limit: N+1 dispatches in window → ErrorRateLimit
 *    10. rate limit resets after window
 *    11. rate-limit failures do not burn quota
 *    12. concurrent dispatches isolated per-device
 *    13. dispatch from unregistered device → ErrorDeviceNotRegisteredForDispatch
 *    14. policy filter on list()
 *    15. string slot maxLength enforced
 *
 *   RPC-level (via KairosRPCHandler):
 *    16. watch.templates returns the registered set
 *    17. watch.dispatch creates session + returns session id
 *    18. watch.dispatch surfaces ErrorUnknownTemplate as JSON-RPC error
 *    19. watch.dispatch surfaces ErrorInvalidArgs as JSON-RPC error
 *    20. watch.dispatch surfaces ErrorRateLimit as JSON-RPC error
 *
 * Uses a deterministic `now()` clock (no wall-clock dependencies per QB
 * #12) so rate-limit windows are reliable on clean CI.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ComputerSessionStore } from "../../src/session/computer-session-store.js";
import {
  WatchDispatchRegistry,
  DEFAULT_TEMPLATES,
  ErrorUnknownTemplate,
  ErrorInvalidArgs,
  ErrorRateLimit,
  ErrorDeviceNotRegisteredForDispatch,
  type DispatchTemplate,
} from "../../src/session/watch-dispatch.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";

// ── Deterministic clock (QB #12 — no wall-clock dependence) ──

class FakeClock {
  t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

// ── A simple template for isolation in unit tests ─────────

const simpleTemplate: DispatchTemplate = {
  id: "test.echo",
  title: "Echo",
  description: "Trivial echo template for tests.",
  slots: [
    { name: "msg", type: "string", required: true, maxLength: 64 },
  ],
  defaults: { mode: "focused", maxSteps: 2 },
  expandTask: (s) => `Echo: ${String(s["msg"])}`,
};

// ── Registry-level tests ────────────────────────────────

describe("WatchDispatchRegistry — F12 template & dispatch primitive", () => {
  let store: ComputerSessionStore;
  let clock: FakeClock;
  let registry: WatchDispatchRegistry;

  beforeEach(() => {
    store = new ComputerSessionStore();
    clock = new FakeClock();
    registry = new WatchDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      templates: [simpleTemplate],
    });
  });

  // 1. list returns registered templates, sorted
  it("list() returns registered templates in deterministic order", () => {
    const extra: DispatchTemplate = {
      id: "aaa.first",
      title: "First",
      description: "",
      slots: [],
      defaults: {},
      expandTask: () => "first",
    };
    registry.register(extra);
    const ids = registry.list().map((t) => t.id);
    expect(ids).toEqual(["aaa.first", "test.echo"]);
  });

  // 2. built-in default templates are registered when `templates` is omitted
  it("instantiating without explicit templates seeds DEFAULT_TEMPLATES", () => {
    const reg = new WatchDispatchRegistry({ store, now: clock.now.bind(clock) });
    const ids = reg.list().map((t) => t.id).sort();
    const defaultIds = DEFAULT_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(defaultIds);
    // Sanity: summarize.url is the canonical watch template
    expect(reg.has("summarize.url")).toBe(true);
  });

  // 3. dispatch creates a session via F1 store
  it("dispatch() creates a session via the ComputerSessionStore", () => {
    const beforeCount = store.list().length;
    const session = registry.dispatch({
      templateId: "test.echo",
      slots: { msg: "hello" },
      deviceId: "watch-1",
    });
    const afterCount = store.list().length;
    expect(afterCount).toBe(beforeCount + 1);
    expect(session.id).toBeTypeOf("string");
    expect(session.taskSpec.task).toBe("Echo: hello");
    expect(session.taskSpec.mode).toBe("focused");
    expect(session.taskSpec.maxSteps).toBe(2);
    // F1 store persisted the same row
    expect(store.get(session.id).id).toBe(session.id);
  });

  // 4. auto-claim: session is claimed by creating watch device immediately
  it("auto-claim attaches claimedByDeviceId on dispatch", () => {
    const session = registry.dispatch({
      templateId: "test.echo",
      slots: { msg: "hi" },
      deviceId: "watch-A",
    });
    expect(session.creatorDeviceId).toBe("watch-A");
    expect(session.claimedByDeviceId).toBe("watch-A");
    expect(session.status).toBe("claimed");
  });

  // 5. slot validation rejects extra slots
  it("rejects extra slots with ErrorInvalidArgs", () => {
    expect(() =>
      registry.dispatch({
        templateId: "test.echo",
        slots: { msg: "ok", extra: "boom" },
        deviceId: "watch-1",
      }),
    ).toThrow(ErrorInvalidArgs);
  });

  // 6. slot validation rejects missing required slot
  it("rejects missing required slots with ErrorInvalidArgs", () => {
    expect(() =>
      registry.dispatch({
        templateId: "test.echo",
        slots: {},
        deviceId: "watch-1",
      }),
    ).toThrow(ErrorInvalidArgs);
    try {
      registry.dispatch({
        templateId: "test.echo",
        slots: {},
        deviceId: "watch-1",
      });
    } catch (e) {
      expect((e as ErrorInvalidArgs).reason).toMatch(/missing required slot/i);
    }
  });

  // 7. slot validation rejects wrong type
  it("rejects wrong-type slots with ErrorInvalidArgs", () => {
    expect(() =>
      registry.dispatch({
        templateId: "test.echo",
        slots: { msg: 42 },
        deviceId: "watch-1",
      }),
    ).toThrow(ErrorInvalidArgs);
  });

  // 8. unknown template id
  it("rejects unknown template id with ErrorUnknownTemplate", () => {
    expect(() =>
      registry.dispatch({
        templateId: "does.not.exist",
        slots: {},
        deviceId: "watch-1",
      }),
    ).toThrow(ErrorUnknownTemplate);
  });

  // 9. rate limit — N+1 in window triggers ErrorRateLimit
  it("rate-limit: N+1 dispatches in one window throws ErrorRateLimit", () => {
    const strict = new WatchDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      templates: [simpleTemplate],
      rateLimit: { maxPerWindow: 3, windowMs: 60_000 },
    });
    for (let i = 0; i < 3; i++) {
      strict.dispatch({
        templateId: "test.echo",
        slots: { msg: `m${i}` },
        deviceId: "watch-1",
      });
    }
    expect(() =>
      strict.dispatch({
        templateId: "test.echo",
        slots: { msg: "over" },
        deviceId: "watch-1",
      }),
    ).toThrow(ErrorRateLimit);
  });

  // 10. rate limit resets after window
  it("rate-limit: resets after window elapses", () => {
    const strict = new WatchDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      templates: [simpleTemplate],
      rateLimit: { maxPerWindow: 2, windowMs: 10_000 },
    });
    strict.dispatch({ templateId: "test.echo", slots: { msg: "1" }, deviceId: "watch-X" });
    strict.dispatch({ templateId: "test.echo", slots: { msg: "2" }, deviceId: "watch-X" });
    expect(() =>
      strict.dispatch({ templateId: "test.echo", slots: { msg: "3" }, deviceId: "watch-X" }),
    ).toThrow(ErrorRateLimit);
    // Advance past the window — oldest rolls off
    clock.advance(10_001);
    const after = strict.dispatch({
      templateId: "test.echo",
      slots: { msg: "3-ok" },
      deviceId: "watch-X",
    });
    expect(after.taskSpec.task).toBe("Echo: 3-ok");
  });

  // 11. rate-limit failures do not burn quota
  it("rate-limit: invalid-arg failures do not consume quota", () => {
    const strict = new WatchDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      templates: [simpleTemplate],
      rateLimit: { maxPerWindow: 2, windowMs: 60_000 },
    });
    // Two failed dispatches
    for (let i = 0; i < 5; i++) {
      expect(() =>
        strict.dispatch({
          templateId: "test.echo",
          slots: {},
          deviceId: "watch-F",
        }),
      ).toThrow(ErrorInvalidArgs);
    }
    // Quota should still be fully available
    strict.dispatch({ templateId: "test.echo", slots: { msg: "a" }, deviceId: "watch-F" });
    strict.dispatch({ templateId: "test.echo", slots: { msg: "b" }, deviceId: "watch-F" });
    // Third successful dispatch exceeds quota
    expect(() =>
      strict.dispatch({ templateId: "test.echo", slots: { msg: "c" }, deviceId: "watch-F" }),
    ).toThrow(ErrorRateLimit);
  });

  // 12. concurrent dispatches isolated per-device (quota is per-device)
  it("rate-limit ledger is isolated per-device", () => {
    const strict = new WatchDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      templates: [simpleTemplate],
      rateLimit: { maxPerWindow: 2, windowMs: 60_000 },
    });
    strict.dispatch({ templateId: "test.echo", slots: { msg: "1" }, deviceId: "watch-A" });
    strict.dispatch({ templateId: "test.echo", slots: { msg: "2" }, deviceId: "watch-A" });
    // A is full; B still has quota
    expect(() =>
      strict.dispatch({ templateId: "test.echo", slots: { msg: "3" }, deviceId: "watch-A" }),
    ).toThrow(ErrorRateLimit);
    const sB = strict.dispatch({
      templateId: "test.echo",
      slots: { msg: "B-1" },
      deviceId: "watch-B",
    });
    expect(sB.creatorDeviceId).toBe("watch-B");
  });

  // 13. dispatch from unregistered device
  it("dispatch from unregistered device rejects with ErrorDeviceNotRegisteredForDispatch", () => {
    const strict = new WatchDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      templates: [simpleTemplate],
      isDeviceRegistered: (id) => id === "watch-known",
    });
    expect(() =>
      strict.dispatch({
        templateId: "test.echo",
        slots: { msg: "hi" },
        deviceId: "watch-stranger",
      }),
    ).toThrow(ErrorDeviceNotRegisteredForDispatch);
    const ok = strict.dispatch({
      templateId: "test.echo",
      slots: { msg: "hi" },
      deviceId: "watch-known",
    });
    expect(ok.creatorDeviceId).toBe("watch-known");
  });

  // 14. policy filter on list()
  it("list() policy filter hides templates on caller demand", () => {
    const reg = new WatchDispatchRegistry({ store, now: clock.now.bind(clock) });
    const visible = reg.list((t) => !t.id.startsWith("build."));
    expect(visible.map((t) => t.id)).not.toContain("build.project");
  });

  // 15. string maxLength enforced
  it("enforces string maxLength on slot values", () => {
    expect(() =>
      registry.dispatch({
        templateId: "test.echo",
        slots: { msg: "x".repeat(200) },
        deviceId: "watch-1",
      }),
    ).toThrow(ErrorInvalidArgs);
  });
});

// ── RPC-level tests (end-to-end via KairosRPCHandler) ───

describe("watch.* RPC family (F12)", () => {
  let handler: KairosRPCHandler;
  let nextId = 1;

  beforeEach(() => {
    handler = new KairosRPCHandler();
    nextId = 1;
  });

  async function call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<RPCResponse> {
    const raw = JSON.stringify({ jsonrpc: "2.0", method, params, id: nextId++ });
    const res = await handler.handleMessage(raw);
    return res as RPCResponse;
  }

  // 16. watch.templates lists DEFAULT_TEMPLATES
  it("watch.templates returns registered templates", async () => {
    const res = await call("watch.templates", {});
    expect(res.error).toBeUndefined();
    const out = res.result as {
      templates: Array<{ id: string; title: string; slots: Array<{ name: string; type: string }> }>;
    };
    expect(out.templates.length).toBeGreaterThanOrEqual(DEFAULT_TEMPLATES.length);
    const ids = out.templates.map((t) => t.id);
    expect(ids).toContain("summarize.url");
    expect(ids).toContain("note.capture");
  });

  // 17. watch.dispatch creates and auto-claims a session
  it("watch.dispatch creates a session and auto-claims it", async () => {
    const res = await call("watch.dispatch", {
      templateId: "summarize.url",
      slots: { url: "https://example.com" },
      deviceId: "watch-ios-1",
    });
    expect(res.error).toBeUndefined();
    const out = res.result as {
      session: {
        id: string;
        creatorDeviceId: string;
        claimedByDeviceId: string;
        status: string;
        taskSpec: { task: string; mode?: string };
      };
    };
    expect(out.session.id).toBeTypeOf("string");
    expect(out.session.creatorDeviceId).toBe("watch-ios-1");
    expect(out.session.claimedByDeviceId).toBe("watch-ios-1");
    expect(out.session.status).toBe("claimed");
    expect(out.session.taskSpec.task).toContain("https://example.com");

    // Session should also be visible via computer.session.list
    const listRes = await call("computer.session.list", {});
    const list = listRes.result as Array<{ id: string }>;
    expect(list.some((s) => s.id === out.session.id)).toBe(true);
  });

  // 18. RPC surfaces ErrorUnknownTemplate
  it("watch.dispatch surfaces unknown template as RPC error", async () => {
    const res = await call("watch.dispatch", {
      templateId: "nonexistent.template",
      slots: {},
      deviceId: "watch-1",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/unknown/i);
  });

  // 19. RPC surfaces ErrorInvalidArgs
  it("watch.dispatch surfaces slot validation failures as RPC error", async () => {
    const res = await call("watch.dispatch", {
      templateId: "summarize.url",
      slots: {}, // missing required 'url'
      deviceId: "watch-1",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/missing required|invalid/i);
  });

  // 20. RPC surfaces ErrorRateLimit
  it("watch.dispatch surfaces rate-limit as RPC error", async () => {
    // The default limit is 20/hour. Hammer to exhaustion from a single
    // device and assert the 21st call fails. No scheduler needed because
    // we exceed the cap inside a single tick.
    const okRes: RPCResponse[] = [];
    for (let i = 0; i < 20; i++) {
      okRes.push(
        await call("watch.dispatch", {
          templateId: "note.capture",
          slots: { text: `n${i}` },
          deviceId: "watch-RL",
        }),
      );
    }
    for (const r of okRes) {
      expect(r.error).toBeUndefined();
    }
    const over = await call("watch.dispatch", {
      templateId: "note.capture",
      slots: { text: "over" },
      deviceId: "watch-RL",
    });
    expect(over.error).toBeDefined();
    expect(over.error?.message).toMatch(/rate[-\s]?limit/i);
  });
});
