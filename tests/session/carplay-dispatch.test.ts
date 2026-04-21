/**
 * Phase 3 P1-F13 — CarPlay voice task-dispatch tests.
 *
 * Per docs/internal/CROSS_SURFACE_SYNERGY_DESIGN.md §Flow 4, CarPlay is
 * hands-free-only by regulation: every dispatch originates as speech, the
 * daemon parses the transcript into a template + slots, and a fresh
 * ComputerSession is created and auto-claimed. F13 adds the server-side
 * primitives; these tests exercise the registry + parser + RPC surface:
 *
 *   Registry / parser-level:
 *     1. templates.list returns carplay templates in deterministic order
 *     2. built-in default templates are registered
 *     3. parseVoice: pattern match → correct template + slots
 *     4. parseVoice: no match → matched=null + needsConfirmation + topCandidates
 *     5. parseVoice: ambiguous → topCandidates ordered by confidence
 *     6. dispatch: freeform transcript falls through to freeform template
 *     7. dispatch: matched → template session with slots
 *     8. slot extraction from transcript ("remind me to buy milk at 6pm")
 *     9. rate limit: N+1 in window → ErrorRateLimit
 *    10. dispatch forceTemplateId with unknown id → ErrorUnknownTemplate
 *    11. auto-claim on dispatch
 *    12. per-device rate limit isolation
 *    13. allowFreeform=false + low confidence → needsConfirmation (no session)
 *    14. dispatch from unregistered device → ErrorDeviceNotRegistered
 *    15. wake-word normalization ("Hey WOTANN, navigate to...")
 *
 *   RPC-level (via KairosRPCHandler):
 *    16. carplay.templates returns the registered set
 *    17. carplay.parseVoice returns parse result WITHOUT dispatch
 *    18. carplay.dispatch creates + auto-claims a session
 *    19. carplay.dispatch with forceTemplateId surfaces ErrorUnknownTemplate
 *    20. carplay.dispatch rate-limit surfaces as RPC error
 *
 * Uses a deterministic FakeClock (QB #12) so rate-limit windows are
 * reliable on clean CI. Voice patterns are regex-based and entirely
 * synchronous (QB #13 — no wall-clock dependence in parsing either).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { ComputerSessionStore } from "../../src/session/computer-session-store.js";
import {
  CarPlayDispatchRegistry,
  DEFAULT_CARPLAY_TEMPLATES,
  FREEFORM_TEMPLATE_ID,
  ErrorUnknownTemplate,
  ErrorRateLimit,
  ErrorDeviceNotRegisteredForDispatch,
  type CarPlayTemplate,
} from "../../src/session/carplay-dispatch.js";
import { KairosRPCHandler, type RPCResponse } from "../../src/daemon/kairos-rpc.js";

// ── Deterministic clock (QB #12) ───────────────────────────

class FakeClock {
  t = 0;
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

// ── Registry-level tests ───────────────────────────────────

describe("CarPlayDispatchRegistry — F13 voice dispatch primitive", () => {
  let store: ComputerSessionStore;
  let clock: FakeClock;
  let registry: CarPlayDispatchRegistry;

  beforeEach(() => {
    store = new ComputerSessionStore();
    clock = new FakeClock();
    registry = new CarPlayDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      // default templates so navigation/remind/call match work
    });
  });

  // 1. list() returns templates in deterministic (id-sorted) order
  it("list() returns registered templates in deterministic order", () => {
    const ids = registry.list().map((t) => t.id);
    const expectedIds = DEFAULT_CARPLAY_TEMPLATES.map((t) => t.id).sort();
    expect(ids).toEqual(expectedIds);
  });

  // 2. default templates are registered when `templates` is omitted
  it("instantiating without explicit templates seeds DEFAULT_CARPLAY_TEMPLATES", () => {
    const reg = new CarPlayDispatchRegistry({ store, now: clock.now.bind(clock) });
    const ids = reg.list().map((t) => t.id);
    expect(ids).toContain("navigate.address");
    expect(ids).toContain("remind.later");
    expect(ids).toContain("call.contact");
    expect(ids).toContain("summarize.last-email");
    expect(ids).toContain(FREEFORM_TEMPLATE_ID);
  });

  // 3. parseVoice: pattern match → right template
  it("parseVoice matches navigate template from voice transcript", () => {
    const result = registry.parseVoice({
      transcript: "Hey WOTANN, navigate to 123 Main Street",
    });
    expect(result.match).not.toBeNull();
    expect(result.match?.templateId).toBe("navigate.address");
    expect(result.match?.slots["destination"]).toBe("123 main street");
    expect(result.needsConfirmation).toBe(false);
  });

  // 4. parseVoice: no pattern match → matched=null + needsConfirmation
  it("parseVoice returns needsConfirmation when no template matches", () => {
    const result = registry.parseVoice({
      transcript: "qwerty zxcvbn asdfgh hjkl",
    });
    expect(result.match).toBeNull();
    expect(result.needsConfirmation).toBe(true);
  });

  // 5. parseVoice: ambiguous returns topCandidates sorted by confidence
  it("parseVoice populates topCandidates sorted by confidence", () => {
    // "call" alone hits only the low-priority keyword rule for call.contact
    const result = registry.parseVoice({ transcript: "call" });
    // Below threshold → matched=null, but topCandidates should be non-empty
    expect(result.match).toBeNull();
    expect(result.needsConfirmation).toBe(true);
    expect(result.topCandidates.length).toBeGreaterThanOrEqual(1);
    // Confidence values are descending
    for (let i = 1; i < result.topCandidates.length; i++) {
      const prev = result.topCandidates[i - 1];
      const curr = result.topCandidates[i];
      if (prev && curr) {
        expect(prev.confidence).toBeGreaterThanOrEqual(curr.confidence);
      }
    }
  });

  // 6. dispatch: freeform transcript falls through to freeform template
  it("dispatch: unmatched transcript falls through to freeform template", () => {
    const result = registry.dispatch({
      transcript: "asdfjkl mumblespeak fallback test",
      deviceId: "carplay-1",
    });
    expect(result.session).not.toBeNull();
    expect(result.usedFreeform).toBe(true);
    expect(result.session?.taskSpec.task).toContain("asdfjkl mumblespeak fallback test");
  });

  // 7. dispatch: matched → template-expanded task
  it("dispatch: matched transcript produces template-expanded task", () => {
    const result = registry.dispatch({
      transcript: "navigate to the airport",
      deviceId: "carplay-2",
    });
    expect(result.session).not.toBeNull();
    expect(result.usedFreeform).toBe(false);
    expect(result.match?.templateId).toBe("navigate.address");
    expect(result.session?.taskSpec.task).toContain("the airport");
  });

  // 8. slot extraction via regex named captures
  it("extracts multi-slot values from transcripts (remind me to X at Y)", () => {
    const result = registry.parseVoice({
      transcript: "remind me to buy milk at 6pm",
    });
    expect(result.match).not.toBeNull();
    expect(result.match?.templateId).toBe("remind.later");
    expect(result.match?.slots["what"]).toBe("buy milk");
    expect(result.match?.slots["when"]).toBe("6pm");
  });

  // 9. rate limit: N+1 dispatches in window throws
  it("rate-limit: N+1 dispatches in one window throws ErrorRateLimit", () => {
    const strict = new CarPlayDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      rateLimit: { maxPerWindow: 3, windowMs: 60_000 },
    });
    for (let i = 0; i < 3; i++) {
      strict.dispatch({
        transcript: `navigate to place${i}`,
        deviceId: "carplay-RL",
      });
    }
    expect(() =>
      strict.dispatch({
        transcript: "navigate to overflow",
        deviceId: "carplay-RL",
      }),
    ).toThrow(ErrorRateLimit);
  });

  // 10. forceTemplateId with unknown id → ErrorUnknownTemplate
  it("dispatch with unknown forceTemplateId throws ErrorUnknownTemplate", () => {
    expect(() =>
      registry.dispatch({
        transcript: "whatever",
        deviceId: "carplay-1",
        forceTemplateId: "does.not.exist",
      }),
    ).toThrow(ErrorUnknownTemplate);
  });

  // 11. auto-claim: session is claimed by creating device on dispatch
  it("auto-claim attaches claimedByDeviceId on dispatch", () => {
    const result = registry.dispatch({
      transcript: "navigate to the bakery",
      deviceId: "carplay-X",
    });
    expect(result.session).not.toBeNull();
    expect(result.session?.creatorDeviceId).toBe("carplay-X");
    expect(result.session?.claimedByDeviceId).toBe("carplay-X");
    expect(result.session?.status).toBe("claimed");
  });

  // 12. per-device isolation of rate limits
  it("rate-limit ledger is isolated per-device", () => {
    const strict = new CarPlayDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      rateLimit: { maxPerWindow: 2, windowMs: 60_000 },
    });
    strict.dispatch({ transcript: "navigate to A", deviceId: "car-A" });
    strict.dispatch({ transcript: "navigate to A2", deviceId: "car-A" });
    expect(() =>
      strict.dispatch({ transcript: "navigate to A3", deviceId: "car-A" }),
    ).toThrow(ErrorRateLimit);
    // Device B still has quota
    const result = strict.dispatch({ transcript: "navigate to B1", deviceId: "car-B" });
    expect(result.session).not.toBeNull();
    expect(result.session?.creatorDeviceId).toBe("car-B");
  });

  // 13. allowFreeform=false + low confidence → session=null, needsConfirmation
  it("dispatch with allowFreeform=false and low confidence returns needsConfirmation", () => {
    const result = registry.dispatch({
      transcript: "asdfjkl mumblespeak fallback test",
      deviceId: "carplay-1",
      allowFreeform: false,
    });
    expect(result.session).toBeNull();
    expect(result.needsConfirmation).toBe(true);
    expect(result.usedFreeform).toBe(false);
  });

  // 14. dispatch from unregistered device → ErrorDeviceNotRegistered
  it("dispatch from unregistered device throws ErrorDeviceNotRegisteredForDispatch", () => {
    const strict = new CarPlayDispatchRegistry({
      store,
      now: clock.now.bind(clock),
      isDeviceRegistered: (id) => id === "car-known",
    });
    expect(() =>
      strict.dispatch({ transcript: "navigate to home", deviceId: "car-stranger" }),
    ).toThrow(ErrorDeviceNotRegisteredForDispatch);
    const ok = strict.dispatch({ transcript: "navigate to home", deviceId: "car-known" });
    expect(ok.session?.creatorDeviceId).toBe("car-known");
  });

  // 15. wake-word normalization
  it("normalizes wake-word prefixes in transcripts", () => {
    const result = registry.parseVoice({
      transcript: "Hey WOTANN, call Alice now",
    });
    expect(result.match).not.toBeNull();
    expect(result.match?.templateId).toBe("call.contact");
    expect(result.match?.slots["contact"]).toBe("alice");
  });

  // Extra: forceTemplateId path bypasses parser and uses supplied slots
  it("dispatch with forceTemplateId + slots builds task from overrides", () => {
    const customTemplate: CarPlayTemplate = {
      id: "custom.echo",
      title: "Echo",
      description: "test-only template",
      voicePatterns: [{ kind: "keywords", keywords: ["echo"], priority: 1 }],
      defaults: { mode: "focused", maxSteps: 2 },
      expandTask: ({ slots }) => `Echoing: ${slots["msg"] ?? ""}`,
    };
    registry.register(customTemplate);
    const result = registry.dispatch({
      transcript: "",
      deviceId: "car-Z",
      forceTemplateId: "custom.echo",
      slots: { msg: "forced-slot-value" },
    });
    expect(result.session?.taskSpec.task).toBe("Echoing: forced-slot-value");
  });
});

// ── RPC-level tests (end-to-end via KairosRPCHandler) ──────

describe("carplay.* RPC family (F13)", () => {
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

  // 16. carplay.templates returns registered templates
  it("carplay.templates returns the registered template set", async () => {
    const res = await call("carplay.templates", {});
    expect(res.error).toBeUndefined();
    const out = res.result as {
      templates: Array<{ id: string; title: string }>;
    };
    const ids = out.templates.map((t) => t.id);
    expect(ids).toContain("navigate.address");
    expect(ids).toContain("remind.later");
    expect(ids).toContain(FREEFORM_TEMPLATE_ID);
    expect(out.templates.length).toBeGreaterThanOrEqual(DEFAULT_CARPLAY_TEMPLATES.length);
  });

  // 17. carplay.parseVoice preview without dispatch
  it("carplay.parseVoice returns a parse preview without creating a session", async () => {
    const storeBefore = await call("computer.session.list", {});
    const countBefore = (storeBefore.result as Array<unknown>).length;
    const res = await call("carplay.parseVoice", {
      transcript: "navigate to the grocery store",
    });
    expect(res.error).toBeUndefined();
    const out = res.result as {
      match: { templateId: string; confidence: number } | null;
      needsConfirmation: boolean;
    };
    expect(out.match?.templateId).toBe("navigate.address");
    expect(out.needsConfirmation).toBe(false);
    // No session was created
    const storeAfter = await call("computer.session.list", {});
    const countAfter = (storeAfter.result as Array<unknown>).length;
    expect(countAfter).toBe(countBefore);
  });

  // 18. carplay.dispatch creates + auto-claims
  it("carplay.dispatch creates and auto-claims a session", async () => {
    const res = await call("carplay.dispatch", {
      transcript: "navigate to the airport",
      deviceId: "carplay-ios-1",
    });
    expect(res.error).toBeUndefined();
    const out = res.result as {
      session: {
        id: string;
        creatorDeviceId: string;
        claimedByDeviceId: string;
        status: string;
        taskSpec: { task: string };
      } | null;
      match: { templateId: string } | null;
      usedFreeform: boolean;
    };
    expect(out.session).not.toBeNull();
    expect(out.session?.creatorDeviceId).toBe("carplay-ios-1");
    expect(out.session?.claimedByDeviceId).toBe("carplay-ios-1");
    expect(out.session?.status).toBe("claimed");
    expect(out.match?.templateId).toBe("navigate.address");
    expect(out.usedFreeform).toBe(false);

    // Session is visible in computer.session.list
    const listRes = await call("computer.session.list", {});
    const list = listRes.result as Array<{ id: string }>;
    expect(list.some((s) => s.id === out.session?.id)).toBe(true);
  });

  // 19. carplay.dispatch with unknown forceTemplateId surfaces as RPC error
  it("carplay.dispatch surfaces unknown forceTemplateId as an RPC error", async () => {
    const res = await call("carplay.dispatch", {
      transcript: "anything",
      deviceId: "car-1",
      forceTemplateId: "nonexistent.template",
    });
    expect(res.error).toBeDefined();
    expect(res.error?.message).toMatch(/unknown/i);
  });

  // 20. rate-limit path surfaces as RPC error
  it("carplay.dispatch surfaces rate-limit as an RPC error", async () => {
    // Default limit 20/hour. Exhaust the window for one device.
    const ok: RPCResponse[] = [];
    for (let i = 0; i < 20; i++) {
      ok.push(
        await call("carplay.dispatch", {
          transcript: `navigate to spot ${i}`,
          deviceId: "carplay-RL",
        }),
      );
    }
    for (const r of ok) {
      expect(r.error).toBeUndefined();
    }
    const over = await call("carplay.dispatch", {
      transcript: "navigate to overflow",
      deviceId: "carplay-RL",
    });
    expect(over.error).toBeDefined();
    expect(over.error?.message).toMatch(/rate[-\s]?limit/i);
  });
});
