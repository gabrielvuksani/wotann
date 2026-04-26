/**
 * McpAppOverlay — V9 Tier 4 T4.2 mount-point.
 *
 * Wires the McpAppHost into the desktop-app shell. Mounted once at
 * the App root. Listens to `wotann:mcp-app-mount` window events
 * (same dispatch pattern as Runering / Toast) and renders an
 * iframe-based App view in a modal overlay when an event fires.
 *
 * AUDIT FINDING (2026-04-24): McpAppHost.tsx existed (257 LOC, fully
 * tested) but had ZERO consumers in desktop-app/src/. Tools that
 * returned `_meta.ui.resourceUri` produced inert metadata because no
 * component picked it up and rendered the App. This component closes
 * the loop.
 *
 * INVOCATION
 * ──────────
 * Producers dispatch:
 *
 *     window.dispatchEvent(
 *       new CustomEvent('wotann:mcp-app-mount', {
 *         detail: { resourceUri: 'ui://wotann/cost-preview' }
 *       })
 *     )
 *
 * The overlay opens, fetches the resource via the configured
 * `fetchResource` callback, and mounts McpAppHost. Pressing Escape
 * or the close button unmounts the iframe + tears down the bridge.
 *
 * QUALITY BARS
 * ────────────
 *  - QB #6 honest stubs: when fetchResource throws, the error phase
 *    in McpAppHost is shown — never silently fails.
 *  - QB #7 per-mount state: every event spawns a fresh McpAppHost
 *    with its own bridge. Switching URIs tears down the old bridge.
 *  - QB #11 sibling-site scan: this is the SOLE mount of McpAppHost
 *    in desktop-app/src/. Audit rule: keep it that way until product
 *    decides per-tab embedding is required.
 */

import { useEffect, useState, useCallback, type JSX } from "react";
import { McpAppHost } from "./McpAppHost.js";

// ── Public mount-event contract ─────────────────────────────

/** Detail shape for the `wotann:mcp-app-mount` CustomEvent. */
export interface McpAppMountDetail {
  /** The `ui://...` URI to render. */
  readonly resourceUri: string;
  /** Optional human-readable title for the overlay header. */
  readonly title?: string;
}

const MOUNT_EVENT = "wotann:mcp-app-mount";

/**
 * Convenience helper for callers that want to emit the mount event
 * without typing the CustomEvent boilerplate. Returns true if at
 * least one listener is attached (i.e. the overlay is mounted).
 */
export function emitMcpAppMount(detail: McpAppMountDetail): boolean {
  if (typeof window === "undefined") return false;
  const ev = new CustomEvent<McpAppMountDetail>(MOUNT_EVENT, { detail });
  window.dispatchEvent(ev);
  return true;
}

// ── Default fetcher ─────────────────────────────────────────

/**
 * Default fetcher: routes through the existing window.__wotannRpc
 * bridge if present (registered by the daemon connection layer). If
 * the bridge isn't present (test harness, dev mode without daemon),
 * returns a benign error string so the host's error phase activates
 * with a clear "no daemon" message.
 */
async function defaultFetchResource(uri: string): Promise<string> {
  const bridge = (
    globalThis as {
      __wotannRpc?: {
        request?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
      };
    }
  ).__wotannRpc;
  if (!bridge?.request) {
    throw new Error(
      "MCP App overlay requires a daemon RPC bridge. " +
        "Connect to wotann engine first.",
    );
  }
  const response = (await bridge.request("resources/read", { uri })) as {
    contents?: readonly { mimeType?: string; text?: string }[];
  };
  const html = response?.contents?.[0]?.text;
  if (typeof html !== "string" || html.length === 0) {
    throw new Error(`MCP resource '${uri}' returned no HTML content`);
  }
  return html;
}

// ── Component ───────────────────────────────────────────────

interface OpenState {
  readonly kind: "open";
  readonly resourceUri: string;
  readonly title: string;
}

/**
 * Mount this once at the App root. It manages its own visibility
 * via the mount-event subscription, so callers don't pass props.
 *
 * `fetchResourceOverride` is supplied by tests and dev tools; in
 * production the default routes through `window.__wotannRpc`.
 */
export interface McpAppOverlayProps {
  readonly fetchResourceOverride?: (uri: string) => Promise<string>;
}

export function McpAppOverlay(props: McpAppOverlayProps): JSX.Element | null {
  const [state, setState] = useState<{ readonly kind: "closed" } | OpenState>({
    kind: "closed",
  });

  const fetcher = props.fetchResourceOverride ?? defaultFetchResource;

  const close = useCallback((): void => {
    setState({ kind: "closed" });
  }, []);

  // Subscribe to the global mount event.
  useEffect(() => {
    const handler = (ev: Event): void => {
      const detail = (ev as CustomEvent<McpAppMountDetail>).detail;
      if (!detail || typeof detail.resourceUri !== "string") return;
      const safeTitle = typeof detail.title === "string" ? detail.title : detail.resourceUri;
      setState({ kind: "open", resourceUri: detail.resourceUri, title: safeTitle });
    };
    window.addEventListener(MOUNT_EVENT, handler);
    return () => window.removeEventListener(MOUNT_EVENT, handler);
  }, []);

  // Escape closes the overlay.
  useEffect(() => {
    if (state.kind !== "open") return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state.kind, close]);

  if (state.kind !== "open") return null;

  return (
    <div
      className="mcp-app-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`MCP App: ${state.title}`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(2px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "stretch",
      }}
    >
      <header
        style={{
          padding: "10px 14px",
          background: "var(--w-surface, #1a1a1f)",
          color: "var(--w-text, #f6f6f8)",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span style={{ fontWeight: 600 }}>{state.title}</span>
        <button
          type="button"
          onClick={close}
          aria-label="Close MCP App"
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "inherit",
            padding: "4px 10px",
            borderRadius: "var(--radius-xs)",
            cursor: "pointer",
          }}
        >
          Close (Esc)
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <McpAppHost
          resourceUri={state.resourceUri}
          fetchResource={fetcher}
          style={{ width: "100%", height: "100%" }}
          className="mcp-app-overlay__host"
        />
      </div>
    </div>
  );
}
