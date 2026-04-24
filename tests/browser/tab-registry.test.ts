/**
 * Tests for V9 Tier 10 T10.2 — Tab Registry.
 *
 * Per-registry closure state is verified via a "two independent
 * registries" test. Timestamps are supplied via an injected counter
 * clock (`makeClock()`) so purge / touch / ordering assertions are
 * deterministic regardless of wall-clock drift.
 *
 * Quality bars under test:
 *   QB #6 — `register` returns structured failure envelopes, never throws
 *   QB #7 — `createTabRegistry()` gives a fresh closure per call
 *   QB #13 — no NODE_ENV / process.env guards anywhere
 */

import { describe, it, expect } from "vitest";

import {
  createTabRegistry,
  ownersEqual,
  type TabOwner,
  type RegisteredTab,
} from "../../src/browser/tab-registry.js";

/**
 * Deterministic counter clock. Every read advances by 1 so tests that
 * rely on ordering or on "lastSeenAt moved forward" are reproducible.
 * Without an injected clock, a Date.now()-based registry would return
 * identical timestamps for calls on the same millisecond, making
 * purgeStale semantics impossible to assert precisely on fast CI.
 */
function makeClock(start = 1_000): { readonly now: () => number; readonly peek: () => number } {
  let t = start;
  return {
    now: () => t++,
    peek: () => t,
  };
}

const userOwner: TabOwner = { kind: "user" };
const agent = (taskId: string): TabOwner => ({ kind: "agent", taskId });

describe("createTabRegistry", () => {
  it("starts empty: list() returns [] and counts are zero", () => {
    const r = createTabRegistry({ now: makeClock().now });
    expect(r.list()).toEqual([]);
    expect(r.countByOwner()).toEqual({ user: 0, agent: 0 });
    expect(r.get("missing")).toBeNull();
  });

  it("registers a user tab and returns ok envelope with the created tab", () => {
    const r = createTabRegistry({ now: makeClock().now });
    const result = r.register({ tabId: "t1", owner: userOwner, url: "https://example.com" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("register failed unexpectedly");
    expect(result.tab.tabId).toBe("t1");
    expect(result.tab.owner).toEqual(userOwner);
    expect(result.tab.url).toBe("https://example.com");
    expect(typeof result.tab.registeredAt).toBe("number");
    expect(result.tab.lastSeenAt).toBe(result.tab.registeredAt);
  });

  it("registers agent tabs up to the default cap of 3", () => {
    const r = createTabRegistry({ now: makeClock().now });
    expect(r.register({ tabId: "a1", owner: agent("task-A") }).ok).toBe(true);
    expect(r.register({ tabId: "a2", owner: agent("task-A") }).ok).toBe(true);
    expect(r.register({ tabId: "a3", owner: agent("task-B") }).ok).toBe(true);
    expect(r.countByOwner()).toEqual({ user: 0, agent: 3 });
  });

  it("rejects the 4th agent tab with max-agent-tabs-exceeded", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "a1", owner: agent("task-A") });
    r.register({ tabId: "a2", owner: agent("task-A") });
    r.register({ tabId: "a3", owner: agent("task-B") });
    const fourth = r.register({ tabId: "a4", owner: agent("task-B") });
    expect(fourth.ok).toBe(false);
    if (fourth.ok) throw new Error("expected rejection");
    expect(fourth.error).toBe("max-agent-tabs-exceeded");
  });

  it("honors a custom maxAgentTabs cap", () => {
    const r = createTabRegistry({ maxAgentTabs: 1, now: makeClock().now });
    expect(r.register({ tabId: "a1", owner: agent("t") }).ok).toBe(true);
    const result = r.register({ tabId: "a2", owner: agent("t") });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toBe("max-agent-tabs-exceeded");
  });

  it("does NOT apply the agent cap to user tabs", () => {
    const r = createTabRegistry({ maxAgentTabs: 0, now: makeClock().now });
    // Even with maxAgentTabs=0, user tabs must still be accepted.
    expect(r.register({ tabId: "u1", owner: userOwner }).ok).toBe(true);
    expect(r.register({ tabId: "u2", owner: userOwner }).ok).toBe(true);
    expect(r.register({ tabId: "a1", owner: agent("t") }).ok).toBe(false);
    expect(r.countByOwner()).toEqual({ user: 2, agent: 0 });
  });

  it("rejects a duplicate tabId with duplicate-tab-id (user owner)", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "dup", owner: userOwner });
    const dup = r.register({ tabId: "dup", owner: userOwner });
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error("expected rejection");
    expect(dup.error).toBe("duplicate-tab-id");
  });

  it("rejects a duplicate tabId even when switching from user to agent owner", () => {
    // Duplicate detection runs BEFORE the cap check — a collision is a
    // collision regardless of the incoming owner kind.
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "dup", owner: userOwner });
    const dup = r.register({ tabId: "dup", owner: agent("t") });
    expect(dup.ok).toBe(false);
    if (dup.ok) throw new Error("expected rejection");
    expect(dup.error).toBe("duplicate-tab-id");
  });

  it("unregister returns true when a tab is removed, false when the id is unknown", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "t1", owner: userOwner });
    expect(r.unregister("t1")).toBe(true);
    expect(r.unregister("t1")).toBe(false);
    expect(r.unregister("never-existed")).toBe(false);
    expect(r.get("t1")).toBeNull();
  });

  it("get returns the tab when present, null when missing", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "t1", owner: agent("task-X"), url: "https://a.test" });
    const fetched = r.get("t1");
    expect(fetched).not.toBeNull();
    expect(fetched?.tabId).toBe("t1");
    expect(fetched?.owner).toEqual(agent("task-X"));
    expect(fetched?.url).toBe("https://a.test");
    expect(r.get("nope")).toBeNull();
  });

  it("list without filter returns every tab, sorted by registeredAt", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "a", owner: userOwner });
    r.register({ tabId: "b", owner: agent("t1") });
    r.register({ tabId: "c", owner: agent("t2") });
    const all = r.list();
    expect(all.map((t: RegisteredTab) => t.tabId)).toEqual(["a", "b", "c"]);
  });

  it("list filtered by owner:user excludes agent tabs", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "u1", owner: userOwner });
    r.register({ tabId: "a1", owner: agent("t") });
    const users = r.list({ owner: "user" });
    expect(users.map((t: RegisteredTab) => t.tabId)).toEqual(["u1"]);
  });

  it("list filtered by owner:agent excludes user tabs", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "u1", owner: userOwner });
    r.register({ tabId: "a1", owner: agent("t") });
    r.register({ tabId: "a2", owner: agent("t") });
    const agents = r.list({ owner: "agent" });
    expect(agents.map((t: RegisteredTab) => t.tabId)).toEqual(["a1", "a2"]);
  });

  it("list filtered by taskId excludes other agents' tabs", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "u1", owner: userOwner });
    r.register({ tabId: "a1", owner: agent("task-A") });
    r.register({ tabId: "a2", owner: agent("task-B") });
    r.register({ tabId: "a3", owner: agent("task-A") });
    const taskATabs = r.list({ taskId: "task-A" });
    expect(taskATabs.map((t: RegisteredTab) => t.tabId).sort()).toEqual(["a1", "a3"]);
    // taskId filter also excludes user tabs (they have no taskId).
    expect(taskATabs.every((t: RegisteredTab) => t.owner.kind === "agent")).toBe(true);
  });

  it("countByOwner tallies user vs agent correctly", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "u1", owner: userOwner });
    r.register({ tabId: "u2", owner: userOwner });
    r.register({ tabId: "a1", owner: agent("t") });
    expect(r.countByOwner()).toEqual({ user: 2, agent: 1 });
  });

  it("touchLastSeen updates the timestamp and returns true", () => {
    const clock = makeClock();
    const r = createTabRegistry({ now: clock.now });
    r.register({ tabId: "t1", owner: userOwner });
    const before = r.get("t1")?.lastSeenAt ?? -1;
    const ok = r.touchLastSeen("t1");
    expect(ok).toBe(true);
    const after = r.get("t1")?.lastSeenAt ?? -1;
    expect(after).toBeGreaterThan(before);
    // registeredAt must stay pinned — touch only affects lastSeenAt.
    const tab = r.get("t1");
    expect(tab?.registeredAt).toBeLessThan(after);
  });

  it("touchLastSeen returns false for an unknown tabId and creates nothing", () => {
    const r = createTabRegistry({ now: makeClock().now });
    expect(r.touchLastSeen("ghost")).toBe(false);
    expect(r.get("ghost")).toBeNull();
    expect(r.list()).toHaveLength(0);
  });

  it("purgeStale removes tabs whose lastSeenAt is older than the threshold", () => {
    const clock = makeClock(100);
    const r = createTabRegistry({ now: clock.now });
    // Registered at t=100, 101, 102 respectively (counter advances).
    r.register({ tabId: "old-a", owner: userOwner });
    r.register({ tabId: "old-b", owner: userOwner });
    r.register({ tabId: "fresh", owner: userOwner });
    // Bump `fresh`'s lastSeenAt so it beats the purge threshold.
    r.touchLastSeen("fresh");
    // Clock is now ~104. Purge anything older than 2 ticks.
    const removed = r.purgeStale(2);
    expect(removed).toBe(2);
    expect(r.get("old-a")).toBeNull();
    expect(r.get("old-b")).toBeNull();
    expect(r.get("fresh")).not.toBeNull();
  });

  it("purgeStale with a huge threshold removes nothing", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "t1", owner: userOwner });
    r.register({ tabId: "t2", owner: agent("task") });
    const removed = r.purgeStale(1_000_000);
    expect(removed).toBe(0);
    expect(r.list()).toHaveLength(2);
  });

  it("purgeStale with a negative threshold is a no-op", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "t1", owner: userOwner });
    const removed = r.purgeStale(-1);
    expect(removed).toBe(0);
    expect(r.get("t1")).not.toBeNull();
  });

  it("two independent registries do not share state (QB #7 — per-call closure)", () => {
    const r1 = createTabRegistry({ now: makeClock().now });
    const r2 = createTabRegistry({ now: makeClock().now });
    r1.register({ tabId: "shared-id", owner: userOwner });
    // Same tabId must be registrable in the other registry — they are
    // fully isolated closures.
    const ok = r2.register({ tabId: "shared-id", owner: agent("t") });
    expect(ok.ok).toBe(true);
    expect(r1.list()).toHaveLength(1);
    expect(r2.list()).toHaveLength(1);
    expect(r1.get("shared-id")?.owner.kind).toBe("user");
    expect(r2.get("shared-id")?.owner.kind).toBe("agent");
  });

  it("re-registering after unregister succeeds with the same tabId", () => {
    const r = createTabRegistry({ now: makeClock().now });
    expect(r.register({ tabId: "t1", owner: agent("task") }).ok).toBe(true);
    expect(r.unregister("t1")).toBe(true);
    // Now the id is free — should be accepted again, potentially with
    // a different owner.
    expect(r.register({ tabId: "t1", owner: userOwner }).ok).toBe(true);
    expect(r.get("t1")?.owner).toEqual(userOwner);
  });

  it("unregistering an agent tab frees a slot for a new agent tab (cap check)", () => {
    const r = createTabRegistry({ maxAgentTabs: 2, now: makeClock().now });
    r.register({ tabId: "a1", owner: agent("t") });
    r.register({ tabId: "a2", owner: agent("t") });
    expect(r.register({ tabId: "a3", owner: agent("t") }).ok).toBe(false);
    r.unregister("a1");
    expect(r.register({ tabId: "a3", owner: agent("t") }).ok).toBe(true);
    expect(r.countByOwner().agent).toBe(2);
  });

  it("list returns an array — snapshot semantics, not a live view", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "t1", owner: userOwner });
    const first = r.list();
    r.register({ tabId: "t2", owner: userOwner });
    // The previously-returned array should not reflect later mutations.
    expect(first).toHaveLength(1);
    expect(r.list()).toHaveLength(2);
  });

  it("preserves url when provided and omits it when absent", () => {
    const r = createTabRegistry({ now: makeClock().now });
    r.register({ tabId: "with-url", owner: userOwner, url: "https://w.test" });
    r.register({ tabId: "no-url", owner: userOwner });
    expect(r.get("with-url")?.url).toBe("https://w.test");
    expect(r.get("no-url")?.url).toBeUndefined();
  });
});

describe("ownersEqual", () => {
  it("treats user owners as equal", () => {
    expect(ownersEqual({ kind: "user" }, { kind: "user" })).toBe(true);
  });

  it("treats user vs agent as unequal", () => {
    expect(ownersEqual({ kind: "user" }, { kind: "agent", taskId: "t" })).toBe(false);
  });

  it("treats agent owners with the same taskId as equal", () => {
    expect(ownersEqual({ kind: "agent", taskId: "x" }, { kind: "agent", taskId: "x" })).toBe(true);
  });

  it("treats agent owners with different taskIds as unequal", () => {
    expect(ownersEqual({ kind: "agent", taskId: "x" }, { kind: "agent", taskId: "y" })).toBe(false);
  });
});
