/**
 * V9 T10.P0.4 — trifecta-guard middleware tests.
 */

import { describe, expect, it, vi } from "vitest";
import {
  classifyTrifecta,
  createTrifectaGuard,
  defaultExternalCommTools,
  defaultPrivateDataReaders,
  defaultUntrustedInputTools,
  evaluateTrifecta,
  type TrifectaContext,
  type TrifectaEvaluation,
} from "../../src/middleware/trifecta-guard.js";

// ── classifyTrifecta ─────────────────────────────────────────────────────

describe("classifyTrifecta — individual axes", () => {
  it("untrusted-input: initiatedFromUntrustedSource flag", () => {
    const c = classifyTrifecta({
      toolName: "no-op",
      initiatedFromUntrustedSource: true,
    });
    expect(c.axes["untrusted-input"]).toBe(true);
    expect(c.hits.find((h) => h.source === "context.initiatedFromUntrustedSource")).toBeDefined();
  });

  it("untrusted-input: tool in UNTRUSTED_INPUT_TOOLS", () => {
    const c = classifyTrifecta({ toolName: "browser.read-page" });
    expect(c.axes["untrusted-input"]).toBe(true);
  });

  it("private-data: sessionHasPrivateData flag", () => {
    const c = classifyTrifecta({
      toolName: "no-op",
      sessionHasPrivateData: true,
    });
    expect(c.axes["private-data"]).toBe(true);
  });

  it("private-data: tool in PRIVATE_DATA_READERS", () => {
    const c = classifyTrifecta({ toolName: "credentials.read" });
    expect(c.axes["private-data"]).toBe(true);
  });

  it("external-comm: tool in EXTERNAL_COMM_TOOLS", () => {
    const c = classifyTrifecta({ toolName: "fetch" });
    expect(c.axes["external-comm"]).toBe(true);
  });

  it("external-comm: args contain external URL", () => {
    const c = classifyTrifecta({
      toolName: "anything",
      args: { endpoint: "https://attacker.example.com/exfil" },
    });
    expect(c.axes["external-comm"]).toBe(true);
    expect(c.hits.find((h) => h.source === "args.urlShape")).toBeDefined();
  });

  it("external-comm: localhost URLs do NOT trip the rule", () => {
    const c = classifyTrifecta({
      toolName: "anything",
      args: { endpoint: "https://localhost:3000/ok" },
    });
    expect(c.axes["external-comm"]).toBe(false);
  });

  it("axisHints override — caller explicit", () => {
    const c = classifyTrifecta({
      toolName: "unknown-tool",
      axisHints: {
        "untrusted-input": true,
        "private-data": true,
        "external-comm": true,
      },
    });
    expect(c.axes["untrusted-input"]).toBe(true);
    expect(c.axes["private-data"]).toBe(true);
    expect(c.axes["external-comm"]).toBe(true);
  });

  it("no axes triggered for an innocuous local tool", () => {
    const c = classifyTrifecta({ toolName: "fs.ls", args: { path: "." } });
    expect(c.axes["untrusted-input"]).toBe(false);
    expect(c.axes["private-data"]).toBe(false);
    expect(c.axes["external-comm"]).toBe(false);
  });
});

// ── evaluateTrifecta ─────────────────────────────────────────────────────

describe("evaluateTrifecta", () => {
  function ctxWithAxes(a: boolean, b: boolean, c: boolean): TrifectaContext {
    return {
      toolName: "test",
      axisHints: {
        "untrusted-input": a,
        "private-data": b,
        "external-comm": c,
      },
    };
  }

  it("ALLOW when zero axes active", () => {
    const e = evaluateTrifecta(classifyTrifecta(ctxWithAxes(false, false, false)));
    expect(e.verdict).toBe("ALLOW");
  });

  it("ALLOW when one axis active", () => {
    expect(evaluateTrifecta(classifyTrifecta(ctxWithAxes(true, false, false))).verdict).toBe("ALLOW");
    expect(evaluateTrifecta(classifyTrifecta(ctxWithAxes(false, true, false))).verdict).toBe("ALLOW");
    expect(evaluateTrifecta(classifyTrifecta(ctxWithAxes(false, false, true))).verdict).toBe("ALLOW");
  });

  it("ALLOW when two axes active (not lethal on its own)", () => {
    expect(evaluateTrifecta(classifyTrifecta(ctxWithAxes(true, true, false))).verdict).toBe("ALLOW");
    expect(evaluateTrifecta(classifyTrifecta(ctxWithAxes(true, false, true))).verdict).toBe("ALLOW");
    expect(evaluateTrifecta(classifyTrifecta(ctxWithAxes(false, true, true))).verdict).toBe("ALLOW");
  });

  it("REQUIRE_APPROVAL when all three axes active (default mode)", () => {
    const e = evaluateTrifecta(classifyTrifecta(ctxWithAxes(true, true, true)));
    expect(e.verdict).toBe("REQUIRE_APPROVAL");
  });

  it("BLOCK in strict mode when lethal trifecta present", () => {
    const e = evaluateTrifecta(
      classifyTrifecta(ctxWithAxes(true, true, true)),
      { strictMode: true },
    );
    expect(e.verdict).toBe("BLOCK");
  });

  it("reason string mentions the axes", () => {
    const e = evaluateTrifecta(classifyTrifecta(ctxWithAxes(true, true, true)));
    expect(e.reason).toMatch(/trifecta/i);
  });
});

// ── createTrifectaGuard ──────────────────────────────────────────────────

describe("createTrifectaGuard — middleware", () => {
  it("ALLOW path: approval handler NOT called", async () => {
    const approvalHandler = vi.fn(async () => "approve" as const);
    const guard = createTrifectaGuard({ approvalHandler });
    const result = await guard.inspect({ toolName: "fs.ls" });
    expect(result.verdict).toBe("ALLOW");
    expect(approvalHandler).not.toHaveBeenCalled();
  });

  it("REQUIRE_APPROVAL path: handler called once", async () => {
    const approvalHandler = vi.fn(async () => "approve" as const);
    const guard = createTrifectaGuard({ approvalHandler });
    const result = await guard.inspect({
      toolName: "fetch",
      initiatedFromUntrustedSource: true,
      sessionHasPrivateData: true,
    });
    expect(result.verdict).toBe("REQUIRE_APPROVAL");
    expect(result.approved).toBe(true);
    expect(approvalHandler).toHaveBeenCalledTimes(1);
  });

  it("REQUIRE_APPROVAL path: approved=false when user denies", async () => {
    const approvalHandler = vi.fn(async () => "deny" as const);
    const guard = createTrifectaGuard({ approvalHandler });
    const result = await guard.inspect({
      toolName: "email.send",
      initiatedFromUntrustedSource: true,
      sessionHasPrivateData: true,
    });
    expect(result.verdict).toBe("REQUIRE_APPROVAL");
    expect(result.approved).toBe(false);
  });

  it("BLOCK path in strict mode: handler NOT called", async () => {
    const approvalHandler = vi.fn(async () => "approve" as const);
    const guard = createTrifectaGuard({ approvalHandler, strictMode: true });
    const result = await guard.inspect({
      toolName: "fetch",
      initiatedFromUntrustedSource: true,
      sessionHasPrivateData: true,
    });
    expect(result.verdict).toBe("BLOCK");
    expect(result.approved).toBe(false);
    expect(approvalHandler).not.toHaveBeenCalled();
  });

  it("onEvaluate fires for every inspection (ALLOW + REQUIRE_APPROVAL)", async () => {
    const events: TrifectaEvaluation[] = [];
    const guard = createTrifectaGuard({
      approvalHandler: async () => "approve",
      onEvaluate: (e) => events.push(e),
    });
    await guard.inspect({ toolName: "fs.ls" });
    await guard.inspect({
      toolName: "fetch",
      initiatedFromUntrustedSource: true,
      sessionHasPrivateData: true,
    });
    expect(events).toHaveLength(2);
    expect(events[0]?.verdict).toBe("ALLOW");
    expect(events[1]?.verdict).toBe("REQUIRE_APPROVAL");
  });
});

// ── Default exports ──────────────────────────────────────────────────────

describe("default tool taxonomies", () => {
  it("external-comm list is non-empty + sorted + includes `fetch`", () => {
    const list = defaultExternalCommTools();
    expect(list.length).toBeGreaterThan(0);
    expect([...list].sort()).toEqual(list);
    expect(list).toContain("fetch");
  });

  it("private-data list includes credential readers", () => {
    const list = defaultPrivateDataReaders();
    expect(list).toContain("credentials.read");
    expect(list).toContain("keychain.read");
  });

  it("untrusted-input list includes browser.read-page", () => {
    const list = defaultUntrustedInputTools();
    expect(list).toContain("browser.read-page");
  });
});
