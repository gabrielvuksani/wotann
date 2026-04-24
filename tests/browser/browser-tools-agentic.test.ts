/**
 * V9 T10.4 — browser-tools agentic trio tests.
 *
 * Covers the three tools added alongside the agentic-browser orchestrator:
 *   - browser.plan        → returns planner output as step summaries
 *   - browser.spawn_tab   → delegates to TabRegistry + respects maxAgentTabs
 *   - browser.approve_action → dispatches to approval-queue callback
 *
 * Quality bars under test:
 *   QB #6 — honest failures: every "no backend" / "not wired" path
 *           returns an explicit envelope (never silent success).
 *   QB #7 — per-call state: each test constructs its own deps.
 *   QB #13 — no process.env reads in the subject under test.
 */

import { describe, expect, it, vi } from "vitest";

import {
  dispatchBrowserTool,
  type BrowserAgenticDep,
  type BrowserToolName,
} from "../../src/browser/browser-tools.js";
import {
  buildPlanFromSteps,
  type BrowsePlan,
} from "../../src/browser/agentic-browser.js";
import { createTabRegistry } from "../../src/browser/tab-registry.js";

const deterministicClock = (): (() => number) => {
  let t = 1_000;
  return () => t++;
};

const makePlan = (task: string): BrowsePlan =>
  buildPlanFromSteps(
    "plan-test",
    task,
    [
      { id: "s1", kind: "navigate", target: "https://wotann.com/", rationale: "home" },
      { id: "s2", kind: "read", rationale: "read landing" },
    ],
    { now: () => 1_700_000_000_000 },
  );

const dispatch = async (
  tool: BrowserToolName,
  input: Record<string, unknown>,
  agentic?: BrowserAgenticDep,
) => dispatchBrowserTool(tool, input, agentic ? { agentic } : {});

describe("dispatchBrowserTool — browser.plan", () => {
  it("returns an array of plan step summaries when a planner is wired", async () => {
    const planner = vi.fn(async (task: string) => makePlan(task));
    const result = await dispatch("browser.plan", { task: "visit wotann" }, { plan: planner });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const data = result.data as { plan: readonly { id: string; kind: string }[] };
    expect(Array.isArray(data.plan)).toBe(true);
    expect(data.plan).toHaveLength(2);
    expect(data.plan[0]?.id).toBe("s1");
    expect(data.plan[0]?.kind).toBe("navigate");
    expect(planner).toHaveBeenCalledWith("visit wotann");
  });

  it("returns {plan:[]} when no planner is wired (honest empty, not error)", async () => {
    const result = await dispatch("browser.plan", { task: "anything" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ plan: [] });
  });

  it("rejects missing task with bad_input", async () => {
    const result = await dispatch("browser.plan", {}, { plan: async () => makePlan("x") });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error).toBe("bad_input");
  });

  it("surfaces planner throws as upstream_error (no silent masking)", async () => {
    const planner = vi.fn(async () => {
      throw new Error("llm down");
    });
    const result = await dispatch("browser.plan", { task: "x" }, { plan: planner });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error).toBe("upstream_error");
    expect(result.detail).toContain("llm down");
  });
});

describe("dispatchBrowserTool — browser.spawn_tab", () => {
  it("creates a user tab and registers it in the registry", async () => {
    const registry = createTabRegistry({ now: deterministicClock() });
    const agentic: BrowserAgenticDep = {
      tabRegistry: registry,
      spawnTabId: () => "tab-user-1",
    };
    const result = await dispatch(
      "browser.spawn_tab",
      { ownership: "user", url: "https://example.com" },
      agentic,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    const data = result.data as { tabId: string; ownership: string };
    expect(data.tabId).toBe("tab-user-1");
    expect(data.ownership).toBe("user");
    expect(registry.get("tab-user-1")?.owner.kind).toBe("user");
  });

  it("creates an agent tab under the cap", async () => {
    const registry = createTabRegistry({ maxAgentTabs: 3, now: deterministicClock() });
    let i = 0;
    const agentic: BrowserAgenticDep = {
      tabRegistry: registry,
      spawnTabId: () => `tab-agent-${++i}`,
    };
    for (let k = 0; k < 3; k++) {
      const ok = await dispatch("browser.spawn_tab", { ownership: "agent" }, agentic);
      expect(ok.ok).toBe(true);
    }
    expect(registry.countByOwner()).toEqual({ user: 0, agent: 3 });
  });

  it("rejects a 4th agent tab with 'max agent tabs exceeded'", async () => {
    const registry = createTabRegistry({ maxAgentTabs: 3, now: deterministicClock() });
    let i = 0;
    const agentic: BrowserAgenticDep = {
      tabRegistry: registry,
      spawnTabId: () => `tab-agent-${++i}`,
    };
    for (let k = 0; k < 3; k++) await dispatch("browser.spawn_tab", { ownership: "agent" }, agentic);
    const rejected = await dispatch("browser.spawn_tab", { ownership: "agent" }, agentic);
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) throw new Error("expected ok envelope with rejected field");
    expect(rejected.data).toEqual({ rejected: "max agent tabs exceeded" });
  });

  it("does NOT count user tabs against the agent cap", async () => {
    const registry = createTabRegistry({ maxAgentTabs: 1, now: deterministicClock() });
    let i = 0;
    const agentic: BrowserAgenticDep = {
      tabRegistry: registry,
      spawnTabId: () => `t-${++i}`,
    };
    // 5 user tabs — none affect the cap.
    for (let k = 0; k < 5; k++) {
      const ok = await dispatch("browser.spawn_tab", { ownership: "user" }, agentic);
      expect(ok.ok).toBe(true);
    }
    // One agent tab under the cap of 1.
    const ok = await dispatch("browser.spawn_tab", { ownership: "agent" }, agentic);
    expect(ok.ok).toBe(true);
    expect(registry.countByOwner()).toEqual({ user: 5, agent: 1 });
  });

  it("rejects invalid ownership with bad_input", async () => {
    const registry = createTabRegistry({ now: deterministicClock() });
    const agentic: BrowserAgenticDep = { tabRegistry: registry, spawnTabId: () => "t" };
    const result = await dispatch(
      "browser.spawn_tab",
      { ownership: "guest" },
      agentic,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error).toBe("bad_input");
  });

  it("blocks SSRF-unsafe URLs", async () => {
    const registry = createTabRegistry({ now: deterministicClock() });
    const agentic: BrowserAgenticDep = { tabRegistry: registry, spawnTabId: () => "t" };
    const result = await dispatch(
      "browser.spawn_tab",
      { ownership: "user", url: "http://169.254.169.254/metadata" },
      agentic,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected SSRF block");
    expect(result.error).toBe("ssrf_blocked");
  });

  it("groups agent tabs by taskId", async () => {
    const registry = createTabRegistry({ maxAgentTabs: 5, now: deterministicClock() });
    let i = 0;
    const agentic: BrowserAgenticDep = {
      tabRegistry: registry,
      spawnTabId: () => `t-${++i}`,
    };
    await dispatch("browser.spawn_tab", { ownership: "agent", taskId: "alpha" }, agentic);
    await dispatch("browser.spawn_tab", { ownership: "agent", taskId: "beta" }, agentic);
    expect(registry.list({ taskId: "alpha" })).toHaveLength(1);
    expect(registry.list({ taskId: "beta" })).toHaveLength(1);
  });

  it("returns not_configured when no tab-registry is wired", async () => {
    const result = await dispatch("browser.spawn_tab", { ownership: "agent" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not_configured");
    expect(result.error).toBe("not_configured");
  });
});

describe("dispatchBrowserTool — browser.approve_action", () => {
  it("dispatches an 'allow' decision to the approval callback", async () => {
    const decideApproval = vi.fn(async () => true);
    const result = await dispatch(
      "browser.approve_action",
      { actionId: "ap-1", decision: "allow" },
      { decideApproval },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ ok: true });
    expect(decideApproval).toHaveBeenCalledWith("ap-1", "allow");
  });

  it("dispatches a 'deny' decision to the approval callback", async () => {
    const decideApproval = vi.fn(async () => true);
    const result = await dispatch(
      "browser.approve_action",
      { actionId: "ap-2", decision: "deny" },
      { decideApproval },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.data).toEqual({ ok: true });
    expect(decideApproval).toHaveBeenCalledWith("ap-2", "deny");
  });

  it("returns {ok:false} when the approval queue rejects the id (honest failure)", async () => {
    const decideApproval = vi.fn(async () => false);
    const result = await dispatch(
      "browser.approve_action",
      { actionId: "unknown", decision: "allow" },
      { decideApproval },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok envelope carrying ok:false");
    const data = result.data as { ok: boolean };
    expect(data.ok).toBe(false);
  });

  it("captures thrown errors as {ok:false, detail}", async () => {
    const decideApproval = vi.fn(async () => {
      throw new Error("already decided");
    });
    const result = await dispatch(
      "browser.approve_action",
      { actionId: "ap-x", decision: "allow" },
      { decideApproval },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok envelope");
    const data = result.data as { ok: boolean; detail?: string };
    expect(data.ok).toBe(false);
    expect(data.detail).toContain("already decided");
  });

  it("rejects missing actionId with bad_input", async () => {
    const result = await dispatch(
      "browser.approve_action",
      { decision: "allow" },
      { decideApproval: async () => true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error).toBe("bad_input");
  });

  it("rejects invalid decision values with bad_input", async () => {
    const result = await dispatch(
      "browser.approve_action",
      { actionId: "ap-1", decision: "maybe" },
      { decideApproval: async () => true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected error");
    expect(result.error).toBe("bad_input");
  });

  it("returns honest {ok:false} when no approval queue is wired", async () => {
    const result = await dispatch("browser.approve_action", {
      actionId: "ap-1",
      decision: "allow",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected envelope");
    const data = result.data as { ok: boolean; detail?: string };
    expect(data.ok).toBe(false);
    expect(data.detail).toContain("approval-queue");
  });
});
