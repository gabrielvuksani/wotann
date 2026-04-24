/**
 * FleetDashboard.test.tsx — V9 T5.12 unit tests.
 *
 * Tests the pure reducer `applyUpdate` rather than the React tree —
 * desktop-app has no JSDOM / React Testing Library dependency. The
 * component body is exercised indirectly through the reducer.
 *
 * Coverage targets:
 *   - snapshot replaces the full list
 *   - upsert of a new id prepends
 *   - upsert of an existing id replaces in-place
 *   - remove drops the matching id
 *   - unknown frames are no-ops
 *   - missing fields are dropped
 *   - returned snapshots are frozen (immutability)
 */

import { describe, expect, it } from "vitest";
import { applyUpdate, type FleetAgent } from "./FleetDashboard";

function makeAgent(id: string, overrides: Partial<FleetAgent> = {}): FleetAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "anthropic",
    model: "claude-opus-4-7",
    status: "running",
    progress: 0.3,
    cost: 0.0123,
    startedAt: Date.now(),
    ...overrides,
  };
}

function makeStateHarness(
  initial: readonly FleetAgent[],
): {
  getState: () => readonly FleetAgent[];
  setState: (next: (prev: readonly FleetAgent[]) => readonly FleetAgent[]) => void;
} {
  let state = initial;
  return {
    getState: () => state,
    setState: (next) => {
      state = next(state);
    },
  };
}

describe("applyUpdate", () => {
  it("replaces the full list on snapshot frames", () => {
    const h = makeStateHarness([makeAgent("a")]);
    applyUpdate({ type: "snapshot", agents: [makeAgent("b"), makeAgent("c")] }, h.setState);
    const out = h.getState();
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("b");
    expect(out[1]!.id).toBe("c");
  });

  it("prepends a new agent on upsert", () => {
    const h = makeStateHarness([makeAgent("a")]);
    applyUpdate({ type: "upsert", agent: makeAgent("b") }, h.setState);
    const out = h.getState();
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("b");
    expect(out[1]!.id).toBe("a");
  });

  it("replaces in-place when upserting an existing id", () => {
    const h = makeStateHarness([makeAgent("a", { cost: 0.1 })]);
    applyUpdate(
      { type: "upsert", agent: makeAgent("a", { cost: 0.2 }) },
      h.setState,
    );
    const out = h.getState();
    expect(out).toHaveLength(1);
    expect(out[0]!.cost).toBe(0.2);
  });

  it("removes the matching id", () => {
    const h = makeStateHarness([makeAgent("a"), makeAgent("b")]);
    applyUpdate({ type: "remove", id: "a" }, h.setState);
    const out = h.getState();
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("b");
  });

  it("ignores unknown frame types", () => {
    const h = makeStateHarness([makeAgent("a")]);
    applyUpdate({ type: "unknown-kind", junk: 42 }, h.setState);
    expect(h.getState()).toHaveLength(1);
  });

  it("drops upserts without an id", () => {
    const h = makeStateHarness([makeAgent("a")]);
    applyUpdate({ type: "upsert", agent: { title: "missing id" } }, h.setState);
    expect(h.getState()).toHaveLength(1);
  });

  it("drops non-object payloads", () => {
    const h = makeStateHarness([makeAgent("a")]);
    applyUpdate(null, h.setState);
    applyUpdate("string-frame", h.setState);
    applyUpdate(42, h.setState);
    expect(h.getState()).toHaveLength(1);
  });

  it("freezes the snapshot returned by reducer", () => {
    const h = makeStateHarness([]);
    applyUpdate(
      { type: "snapshot", agents: [makeAgent("a"), makeAgent("b")] },
      h.setState,
    );
    expect(Object.isFrozen(h.getState())).toBe(true);
  });

  it("defaults to upsert when type is missing but an agent is supplied", () => {
    const h = makeStateHarness([]);
    applyUpdate({ agent: makeAgent("a") }, h.setState);
    expect(h.getState()).toHaveLength(1);
    expect(h.getState()[0]!.id).toBe("a");
  });

  it("no-ops on remove when id does not match", () => {
    const h = makeStateHarness([makeAgent("a")]);
    applyUpdate({ type: "remove", id: "does-not-exist" }, h.setState);
    expect(h.getState()).toHaveLength(1);
    expect(h.getState()[0]!.id).toBe("a");
  });
});
