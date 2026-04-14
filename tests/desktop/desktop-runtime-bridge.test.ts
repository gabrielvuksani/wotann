import { describe, it, expect, vi, beforeEach } from "vitest";
import { DesktopRuntimeBridge, type BridgeSyncResult, type BridgeSnapshot } from "../../src/desktop/desktop-runtime-bridge.js";
import { INITIAL_STATE, type DesktopAppState, type AppAction } from "../../src/desktop/app-state.js";
import type { WotannRuntime, RuntimeStatus } from "../../src/core/runtime.js";

// ── Mock Helpers ────────────────────────────────────────────

function makeMockRuntime(overrides?: Partial<RuntimeStatus>): WotannRuntime {
  const status: RuntimeStatus = {
    providers: ["anthropic", "openai"],
    activeProvider: "anthropic",
    hookCount: 5,
    middlewareLayers: 18,
    memoryEnabled: true,
    sessionId: "session-001",
    totalTokens: 500,
    totalCost: 0.02,
    currentMode: "default",
    traceEntries: 3,
    semanticIndexSize: 10,
    skillCount: 2,
    ...overrides,
  };

  return {
    getStatus: vi.fn(() => status),
  } as unknown as WotannRuntime;
}

// ── Tests ──────────────────────────────────────────────────

describe("DesktopRuntimeBridge", () => {
  let runtime: WotannRuntime;
  let bridge: DesktopRuntimeBridge;

  beforeEach(() => {
    runtime = makeMockRuntime();
    bridge = new DesktopRuntimeBridge(runtime);
  });

  describe("constructor", () => {
    it("initializes with INITIAL_STATE", () => {
      const state = bridge.getState();
      expect(state).toEqual(INITIAL_STATE);
    });

    it("starts with zero action count", () => {
      expect(bridge.getActionCount()).toBe(0);
    });

    it("starts with zero last sync time", () => {
      expect(bridge.getLastSyncTime()).toBe(0);
    });
  });

  describe("dispatch", () => {
    it("applies SET_STREAMING action and returns new state", () => {
      const newState = bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });

      expect(newState.isStreaming).toBe(true);
      expect(bridge.getState().isStreaming).toBe(true);
    });

    it("applies SET_PROVIDER action", () => {
      const newState = bridge.dispatch({
        type: "SET_PROVIDER",
        provider: "openai",
        model: "gpt-4",
      });

      expect(newState.activeProvider).toBe("openai");
      expect(newState.activeModel).toBe("gpt-4");
    });

    it("applies SET_MODE action", () => {
      const newState = bridge.dispatch({ type: "SET_MODE", mode: "code" });

      expect(newState.currentMode).toBe("code");
    });

    it("applies UPDATE_COST action", () => {
      const newState = bridge.dispatch({ type: "UPDATE_COST", costToday: 1.50 });

      expect(newState.costToday).toBe(1.50);
    });

    it("applies UPDATE_CONTEXT action", () => {
      const newState = bridge.dispatch({ type: "UPDATE_CONTEXT", contextPercent: 75 });

      expect(newState.contextPercent).toBe(75);
    });

    it("increments action count on each dispatch", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: false });
      bridge.dispatch({ type: "UPDATE_COST", costToday: 0.5 });

      expect(bridge.getActionCount()).toBe(3);
    });

    it("applies TOGGLE_SIDEBAR action", () => {
      const initial = bridge.getState().sidebarOpen;
      bridge.dispatch({ type: "TOGGLE_SIDEBAR" });
      expect(bridge.getState().sidebarOpen).toBe(!initial);
    });
  });

  describe("getState", () => {
    it("returns current state after mutations", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });
      bridge.dispatch({ type: "UPDATE_COST", costToday: 2.0 });

      const state = bridge.getState();
      expect(state.isStreaming).toBe(true);
      expect(state.costToday).toBe(2.0);
    });
  });

  describe("syncFromRuntime", () => {
    it("syncs provider from runtime status", () => {
      runtime = makeMockRuntime({ activeProvider: "openai" });
      bridge = new DesktopRuntimeBridge(runtime);

      const result = bridge.syncFromRuntime();

      expect(result.state.activeProvider).toBe("openai");
      expect(result.actionsDispatched).toBeGreaterThan(0);
    });

    it("syncs mode from runtime status", () => {
      runtime = makeMockRuntime({ currentMode: "code" });
      bridge = new DesktopRuntimeBridge(runtime);

      const result = bridge.syncFromRuntime();

      expect(result.state.currentMode).toBe("code");
    });

    it("syncs cost from runtime status", () => {
      runtime = makeMockRuntime({ totalCost: 3.50 });
      bridge = new DesktopRuntimeBridge(runtime);

      const result = bridge.syncFromRuntime();

      expect(result.state.costToday).toBe(3.50);
    });

    it("updates syncedAt timestamp", () => {
      const before = Date.now();
      const result = bridge.syncFromRuntime();
      const after = Date.now();

      expect(result.syncedAt).toBeGreaterThanOrEqual(before);
      expect(result.syncedAt).toBeLessThanOrEqual(after);
      expect(bridge.getLastSyncTime()).toBe(result.syncedAt);
    });

    it("dispatches no actions when runtime matches current state", () => {
      // Initial state has activeProvider "anthropic" and runtime also has "anthropic"
      // But the model won't match initially, so first sync dispatches provider
      bridge.syncFromRuntime();

      // Second sync should dispatch fewer or zero actions
      const result = bridge.syncFromRuntime();
      expect(result.actionsDispatched).toBe(0);
    });

    it("does not dispatch provider action when activeProvider is null", () => {
      runtime = makeMockRuntime({ activeProvider: null });
      bridge = new DesktopRuntimeBridge(runtime);

      const result = bridge.syncFromRuntime();

      // activeProvider null means no provider action dispatched
      expect(result.state.activeProvider).toBe(INITIAL_STATE.activeProvider);
    });
  });

  describe("syncStreamingState", () => {
    it("dispatches SET_STREAMING when state differs", () => {
      const newState = bridge.syncStreamingState(true);

      expect(newState.isStreaming).toBe(true);
    });

    it("does not dispatch when state is the same", () => {
      // Initial isStreaming is false
      bridge.syncStreamingState(false);

      expect(bridge.getActionCount()).toBe(0);
    });

    it("toggles streaming state", () => {
      bridge.syncStreamingState(true);
      expect(bridge.getState().isStreaming).toBe(true);

      bridge.syncStreamingState(false);
      expect(bridge.getState().isStreaming).toBe(false);
    });
  });

  describe("syncContextUsage", () => {
    it("dispatches UPDATE_CONTEXT when percent differs", () => {
      const newState = bridge.syncContextUsage(65);

      expect(newState.contextPercent).toBe(65);
    });

    it("does not dispatch when percent is the same", () => {
      // Initial contextPercent is 0
      bridge.syncContextUsage(0);

      expect(bridge.getActionCount()).toBe(0);
    });

    it("updates to boundary values", () => {
      bridge.syncContextUsage(0);
      expect(bridge.getState().contextPercent).toBe(0);

      bridge.syncContextUsage(100);
      expect(bridge.getState().contextPercent).toBe(100);
    });
  });

  describe("getSnapshot", () => {
    it("returns snapshot of current state", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });

      const snapshot = bridge.getSnapshot();

      expect(snapshot.state.isStreaming).toBe(true);
      expect(snapshot.snapshotAt).toBeGreaterThan(0);
    });

    it("includes runtime session ID after sync", () => {
      runtime = makeMockRuntime({ sessionId: "sess-xyz" });
      bridge = new DesktopRuntimeBridge(runtime);
      bridge.syncFromRuntime();

      const snapshot = bridge.getSnapshot();
      expect(snapshot.runtimeSessionId).toBe("sess-xyz");
    });

    it("has null session ID before any sync", () => {
      const snapshot = bridge.getSnapshot();
      expect(snapshot.runtimeSessionId).toBeNull();
    });
  });

  describe("getRecentActions", () => {
    it("returns empty array when no actions dispatched", () => {
      expect(bridge.getRecentActions(5)).toEqual([]);
    });

    it("returns all actions when count exceeds total", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });
      bridge.dispatch({ type: "UPDATE_COST", costToday: 1.0 });

      const recent = bridge.getRecentActions(10);
      expect(recent.length).toBe(2);
    });

    it("returns only last N actions", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });
      bridge.dispatch({ type: "UPDATE_COST", costToday: 1.0 });
      bridge.dispatch({ type: "SET_MODE", mode: "code" });

      const recent = bridge.getRecentActions(2);
      expect(recent.length).toBe(2);
      expect(recent[0]!.type).toBe("UPDATE_COST");
      expect(recent[1]!.type).toBe("SET_MODE");
    });

    it("returns immutable copy", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });

      const first = bridge.getRecentActions(5);
      bridge.dispatch({ type: "UPDATE_COST", costToday: 2.0 });
      const second = bridge.getRecentActions(5);

      expect(first.length).toBe(1);
      expect(second.length).toBe(2);
    });
  });

  describe("getActionCount", () => {
    it("returns 0 initially", () => {
      expect(bridge.getActionCount()).toBe(0);
    });

    it("counts all dispatches including sync-triggered ones", () => {
      runtime = makeMockRuntime({
        activeProvider: "openai",
        currentMode: "code",
        totalCost: 5.0,
      });
      bridge = new DesktopRuntimeBridge(runtime);

      bridge.syncFromRuntime();

      expect(bridge.getActionCount()).toBeGreaterThan(0);
    });
  });

  describe("reset", () => {
    it("resets state to INITIAL_STATE", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });
      bridge.dispatch({ type: "UPDATE_COST", costToday: 10.0 });

      bridge.reset();

      expect(bridge.getState()).toEqual(INITIAL_STATE);
    });

    it("clears action log", () => {
      bridge.dispatch({ type: "SET_STREAMING", isStreaming: true });
      bridge.reset();

      expect(bridge.getActionCount()).toBe(0);
      expect(bridge.getRecentActions(10)).toEqual([]);
    });

    it("resets last sync time", () => {
      bridge.syncFromRuntime();
      expect(bridge.getLastSyncTime()).toBeGreaterThan(0);

      bridge.reset();
      expect(bridge.getLastSyncTime()).toBe(0);
    });

    it("resets runtime session ID", () => {
      bridge.syncFromRuntime();
      bridge.reset();

      const snapshot = bridge.getSnapshot();
      expect(snapshot.runtimeSessionId).toBeNull();
    });
  });

  describe("getLastSyncTime", () => {
    it("returns 0 before any sync", () => {
      expect(bridge.getLastSyncTime()).toBe(0);
    });

    it("updates after sync", () => {
      const before = Date.now();
      bridge.syncFromRuntime();
      const after = Date.now();

      const syncTime = bridge.getLastSyncTime();
      expect(syncTime).toBeGreaterThanOrEqual(before);
      expect(syncTime).toBeLessThanOrEqual(after);
    });
  });
});
