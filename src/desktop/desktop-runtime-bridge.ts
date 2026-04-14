/**
 * Desktop Runtime Bridge: connects WotannRuntime events to desktop AppAction dispatches.
 * Used by the Tauri sidecar to sync runtime state to the React WebView.
 *
 * The bridge reads status from WotannRuntime and translates it into AppAction
 * dispatches that update the DesktopAppState reducer. This keeps the React UI
 * in sync with the runtime without direct coupling.
 *
 * Data flow:
 *   WotannRuntime.getStatus() -> DesktopRuntimeBridge.syncFromRuntime()
 *     -> dispatch(SET_PROVIDER) + dispatch(SET_MODE) + dispatch(UPDATE_COST) + ...
 *       -> appReducer(state, action) -> new DesktopAppState
 */

import type { WotannRuntime } from "../core/runtime.js";
import { appReducer, type DesktopAppState, type AppAction, INITIAL_STATE } from "./app-state.js";

// ── Types ────────────────────────────────────────────────────

export interface BridgeSyncResult {
  readonly state: DesktopAppState;
  readonly actionsDispatched: number;
  readonly syncedAt: number;
}

export interface BridgeSnapshot {
  readonly state: DesktopAppState;
  readonly snapshotAt: number;
  readonly runtimeSessionId: string | null;
}

// ── Bridge ───────────────────────────────────────────────────

export class DesktopRuntimeBridge {
  private state: DesktopAppState;
  private readonly actionLog: AppAction[] = [];
  private lastSyncAt: number = 0;
  private runtimeSessionId: string | null = null;

  constructor(private readonly runtime: WotannRuntime) {
    this.state = INITIAL_STATE;
  }

  /**
   * Dispatch an action through the reducer, returning the new state.
   * Keeps an action log for debugging/replay.
   */
  dispatch(action: AppAction): DesktopAppState {
    this.state = appReducer(this.state, action);
    this.actionLog.push(action);
    return this.state;
  }

  /**
   * Get the current desktop app state (immutable snapshot).
   */
  getState(): DesktopAppState {
    return this.state;
  }

  /**
   * Sync runtime status to desktop state.
   * Reads the runtime's current status and dispatches appropriate actions.
   */
  syncFromRuntime(): BridgeSyncResult {
    const status = this.runtime.getStatus();
    let dispatched = 0;

    // Sync provider and model
    if (
      status.activeProvider !== null &&
      (status.activeProvider !== this.state.activeProvider ||
        getModelForStatus(status) !== this.state.activeModel)
    ) {
      this.dispatch({
        type: "SET_PROVIDER",
        provider: status.activeProvider,
        model: getModelForStatus(status),
      });
      dispatched++;
    }

    // Sync mode
    if (status.currentMode !== this.state.currentMode) {
      this.dispatch({
        type: "SET_MODE",
        mode: status.currentMode,
      });
      dispatched++;
    }

    // Sync cost
    if (status.totalCost !== this.state.costToday) {
      this.dispatch({
        type: "UPDATE_COST",
        costToday: status.totalCost,
      });
      dispatched++;
    }

    // Track session ID for snapshots
    this.runtimeSessionId = status.sessionId;
    this.lastSyncAt = Date.now();

    return {
      state: this.state,
      actionsDispatched: dispatched,
      syncedAt: this.lastSyncAt,
    };
  }

  /**
   * Sync streaming state (called when streaming starts/stops).
   */
  syncStreamingState(isStreaming: boolean): DesktopAppState {
    if (isStreaming !== this.state.isStreaming) {
      return this.dispatch({ type: "SET_STREAMING", isStreaming });
    }
    return this.state;
  }

  /**
   * Sync context window usage percentage.
   */
  syncContextUsage(contextPercent: number): DesktopAppState {
    if (contextPercent !== this.state.contextPercent) {
      return this.dispatch({ type: "UPDATE_CONTEXT", contextPercent });
    }
    return this.state;
  }

  /**
   * Create a snapshot of the current bridge state.
   * Useful for Tauri IPC serialization.
   */
  getSnapshot(): BridgeSnapshot {
    return {
      state: this.state,
      snapshotAt: Date.now(),
      runtimeSessionId: this.runtimeSessionId,
    };
  }

  /**
   * Get the number of actions dispatched since creation.
   */
  getActionCount(): number {
    return this.actionLog.length;
  }

  /**
   * Get the recent action log (last N actions).
   * Returns an immutable copy.
   */
  getRecentActions(count: number): readonly AppAction[] {
    const start = Math.max(0, this.actionLog.length - count);
    return this.actionLog.slice(start);
  }

  /**
   * Get the timestamp of the last sync.
   */
  getLastSyncTime(): number {
    return this.lastSyncAt;
  }

  /**
   * Reset the bridge to initial state.
   */
  reset(): void {
    this.state = INITIAL_STATE;
    this.actionLog.length = 0;
    this.lastSyncAt = 0;
    this.runtimeSessionId = null;
  }
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Extract a model string from RuntimeStatus.
 * The status has activeProvider but the model is derived from provider context.
 * We use the provider name as a fallback when model is not directly exposed.
 */
function getModelForStatus(status: {
  readonly activeProvider: string | null;
}): string {
  // RuntimeStatus exposes activeProvider; model detail comes from the provider
  // adapter. For now, use the provider as the model identifier. This will be
  // refined when RuntimeStatus exposes an activeModel field.
  return status.activeProvider ?? "unknown";
}
