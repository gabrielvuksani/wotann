/**
 * T10.4 — Trifecta-guard layer registration tests.
 *
 * Covers:
 *  1. `createTrifectaGuardMiddleware` returns a Middleware adapter
 *  2. The adapter carries the canonical `TRIFECTA_GUARD_NAME` (so the
 *     pipeline can look it up by name)
 *  3. The adapter's `order` sits at 5.7 — after the approval-queue /
 *     guardrail-provider layer (5.5) so the trifecta check runs BEFORE
 *     tool execution but AFTER the provider-level allowlist screen.
 *  4. A tool call that hits all three trifecta axes → REQUIRE_APPROVAL,
 *     invoking the injected approval handler exactly once.
 *  5. A tool call that hits only two axes → ALLOW, approval handler
 *     untouched.
 *  6. `contextProvider` returning null is a no-op (no verdict attached).
 *  7. `strictMode: true` upgrades REQUIRE_APPROVAL → BLOCK and bypasses
 *     the approval handler entirely.
 *  8. `approved: false` flows through the context when user denies.
 *  9. The returned middleware integrates with MiddlewarePipeline: passing
 *     an array containing the adapter yields a pipeline with the layer
 *     name queryable via getLayerNames().
 * 10. Layer ordering: when positioned alongside the approval-queue-adjacent
 *     layer, the trifecta adapter runs at 5.7 (after 5.5) — verified via
 *     the exposed `order` field.
 * 11. The adapter supports optional `onEvaluate` via the underlying
 *     createTrifectaGuard plumbing (we assert the guard factory is
 *     wired correctly by checking the ctx carries the verdict).
 */

import { describe, it, expect, vi } from "vitest";
import {
  createTrifectaGuardMiddleware,
  TRIFECTA_GUARD_NAME,
  guardrailMiddleware,
} from "../../src/middleware/layers.js";
import { MiddlewarePipeline } from "../../src/middleware/pipeline.js";
import type { MiddlewareContext } from "../../src/middleware/types.js";
import type { TrifectaContext } from "../../src/middleware/trifecta-guard.js";

// ── Helpers ───────────────────────────────────────────────────────────

function baseCtx(overrides: Partial<MiddlewareContext> = {}): MiddlewareContext {
  return {
    sessionId: "s-test",
    userMessage: "hi",
    recentHistory: [],
    workingDir: "/tmp",
    ...overrides,
  };
}

function allAxes(): TrifectaContext {
  return {
    toolName: "fetch",
    initiatedFromUntrustedSource: true,
    sessionHasPrivateData: true,
  };
}

function twoAxes(): TrifectaContext {
  return {
    toolName: "fetch",
    initiatedFromUntrustedSource: true,
  };
}

// ── 1. Registration + canonical name ──────────────────────────────────

describe("createTrifectaGuardMiddleware — registration", () => {
  it("returns a Middleware with the canonical name", () => {
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: async () => "approve",
    });
    expect(mw.name).toBe(TRIFECTA_GUARD_NAME);
    expect(TRIFECTA_GUARD_NAME).toBe("TrifectaGuard");
  });

  it("order=5.7 positions after approval-queue/guardrail (5.5)", () => {
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: async () => "approve",
    });
    expect(mw.order).toBe(5.7);
    expect(mw.order).toBeGreaterThan(guardrailMiddleware.order);
  });

  it("exposes a before hook and no after hook", () => {
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: async () => "approve",
    });
    expect(typeof mw.before).toBe("function");
    expect(mw.after).toBeUndefined();
  });
});

// ── 2. Classification semantics via before() ──────────────────────────

describe("createTrifectaGuardMiddleware — classification semantics", () => {
  it("REQUIRE_APPROVAL when all three axes active; approval handler fires once", async () => {
    const handler = vi.fn(async () => "approve" as const);
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: handler,
      contextProvider: () => allAxes(),
    });
    const result = await mw.before!(baseCtx());
    const verdict = (result as MiddlewareContext).trifectaVerdict;
    expect(verdict?.verdict).toBe("REQUIRE_APPROVAL");
    expect(verdict?.approved).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ALLOW when only two axes active; approval handler NOT called", async () => {
    const handler = vi.fn(async () => "approve" as const);
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: handler,
      contextProvider: () => twoAxes(),
    });
    const result = await mw.before!(baseCtx());
    const verdict = (result as MiddlewareContext).trifectaVerdict;
    expect(verdict?.verdict).toBe("ALLOW");
    expect(handler).not.toHaveBeenCalled();
  });

  it("no-op when contextProvider returns null (no verdict attached)", async () => {
    const handler = vi.fn(async () => "approve" as const);
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: handler,
      contextProvider: () => null,
    });
    const result = await mw.before!(baseCtx());
    expect((result as MiddlewareContext).trifectaVerdict).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("no-op when contextProvider is omitted", async () => {
    const handler = vi.fn(async () => "approve" as const);
    const mw = createTrifectaGuardMiddleware({ approvalHandler: handler });
    const result = await mw.before!(baseCtx());
    expect((result as MiddlewareContext).trifectaVerdict).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it("strictMode upgrades REQUIRE_APPROVAL → BLOCK; handler bypassed", async () => {
    const handler = vi.fn(async () => "approve" as const);
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: handler,
      strictMode: true,
      contextProvider: () => allAxes(),
    });
    const result = await mw.before!(baseCtx());
    const verdict = (result as MiddlewareContext).trifectaVerdict;
    expect(verdict?.verdict).toBe("BLOCK");
    expect(verdict?.approved).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("approved=false flows through when the user denies", async () => {
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: async () => "deny",
      contextProvider: () => allAxes(),
    });
    const result = await mw.before!(baseCtx());
    const verdict = (result as MiddlewareContext).trifectaVerdict;
    expect(verdict?.verdict).toBe("REQUIRE_APPROVAL");
    expect(verdict?.approved).toBe(false);
  });

  it("reason string is surfaced on REQUIRE_APPROVAL", async () => {
    const mw = createTrifectaGuardMiddleware({
      approvalHandler: async () => "approve",
      contextProvider: () => allAxes(),
    });
    const result = await mw.before!(baseCtx());
    expect((result as MiddlewareContext).trifectaVerdict?.reason).toMatch(/trifecta/i);
  });
});

// ── 3. Pipeline integration ───────────────────────────────────────────

describe("createTrifectaGuardMiddleware — pipeline integration", () => {
  it("is queryable by name when wired into a MiddlewarePipeline", () => {
    const trifecta = createTrifectaGuardMiddleware({
      approvalHandler: async () => "approve",
      contextProvider: () => allAxes(),
    });
    const pipeline = new MiddlewarePipeline([guardrailMiddleware, trifecta]);
    expect(pipeline.getLayerNames()).toContain(TRIFECTA_GUARD_NAME);
    expect(pipeline.getLayer(TRIFECTA_GUARD_NAME)).toBeDefined();
  });

  it("fires before() as part of pipeline.processBefore, attaching verdict", async () => {
    const trifecta = createTrifectaGuardMiddleware({
      approvalHandler: async () => "approve",
      contextProvider: () => allAxes(),
    });
    const pipeline = new MiddlewarePipeline([trifecta]);
    const out = await pipeline.processBefore(baseCtx());
    expect(out.trifectaVerdict?.verdict).toBe("REQUIRE_APPROVAL");
    expect(out.trifectaVerdict?.approved).toBe(true);
  });

  it("positioned AFTER guardrail (order 5 < 5.7) in a mixed pipeline", () => {
    const trifecta = createTrifectaGuardMiddleware({
      approvalHandler: async () => "approve",
    });
    // The guardrail layer has order=5; trifecta has order=5.7. When pipelines
    // sort by order, trifecta must come after.
    expect(guardrailMiddleware.order).toBe(5);
    expect(trifecta.order).toBeGreaterThan(guardrailMiddleware.order);
  });
});
