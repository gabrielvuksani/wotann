/**
 * McpAppHost — renders a SEP-1865 MCP UI resource in a sandboxed iframe
 * and wires the postMessage bridge (V9 T4.2).
 *
 * Contract:
 * - Fetches the HTML body for a `ui://...` URI via the injected
 *   `fetchResource` callback (the caller wires this to the MCP
 *   runtime's `resources/read`).
 * - Loads the body via `srcdoc` with `sandbox="allow-scripts"` (no
 *   `allow-same-origin`). The iframe origin is therefore the opaque
 *   `"null"` origin, which the bridge uses as its `targetOrigin`.
 * - Instantiates the postMessage bridge once the iframe emits `load`,
 *   tears it down on unmount or URI change.
 * - Routes `tool-call` messages from the app into the optional
 *   `onToolCall` callback and posts the `tool-result` back via the
 *   bridge. A rejected promise becomes an `{ type: "error" }` message.
 *
 * Lifecycle:
 *   mount / URI change → fetchResource → setSrcdoc → iframe load →
 *     createMcpBridge → onAppMessage → (maybe) onToolCall → sendToApp
 *   unmount / URI change → destroyBridge
 *
 * WOTANN quality bars:
 * - QB #6 honest stubs: fetch failures surface an error state; we do
 *   NOT render a blank iframe silently.
 * - QB #7 per-session state: React `ref` + `useEffect` keep bridge
 *   state inside this component instance — no module-level globals.
 * - QB #13 environment guards: `srcdoc` + `allow-scripts` behaviour is
 *   identical in dev, prod, and Tauri. No NODE_ENV branching.
 *
 * References:
 * - Server: src/mcp/ui-resources.ts (T4.1 — produces the HTML shell
 *   with `window.mcp.postMessage` stub)
 * - Bridge: ./mcp-bridge.ts (pure postMessage layer)
 * - Spec: SEP-1865 (MCP Apps, Jan 26 2026)
 */

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createMcpBridge, type McpBridge } from "./mcp-bridge";
import type { HostMessage, McpAppMessage } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * `srcdoc` iframes without `allow-same-origin` report their origin
 * as the literal string `"null"` (the "opaque" origin). The bridge
 * compares incoming `event.origin` against this exact string.
 */
const SRCDOC_ORIGIN = "null";

/**
 * Sandbox permissions. Intentionally minimal — `allow-scripts` only,
 * no `allow-same-origin`, `allow-top-navigation`, `allow-popups`, etc.
 * This is the T4.2 CSP contract: treat MCP Apps as fully untrusted.
 */
const IFRAME_SANDBOX = "allow-scripts";

// ── Props ─────────────────────────────────────────────────────────────────

/** Public props for `<McpAppHost />`. */
export interface McpAppHostProps {
  /**
   * The `ui://<...>` URI to render. Changing this remounts the iframe
   * and rebuilds the bridge.
   */
  readonly resourceUri: string;
  /**
   * Fetches the HTML body for `uri`. Caller wires this to the MCP
   * runtime's `resources/read` method; we don't reach into the
   * runtime directly to keep this component testable in isolation.
   *
   * Returning a rejected promise triggers the error state.
   */
  readonly fetchResource: (uri: string) => Promise<string>;
  /**
   * Optional tool-call handler. Invoked when the embedded app posts
   * a `tool-call` message. Resolved values round-trip as `tool-result`;
   * rejections round-trip as `error`.
   */
  readonly onToolCall?: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  /** Inline style passthrough for the root container. */
  readonly style?: CSSProperties;
  /** Class name passthrough for the root container. */
  readonly className?: string;
}

// ── Phase state ───────────────────────────────────────────────────────────

type Phase =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly html: string }
  | { readonly kind: "error"; readonly message: string };

// ── Component ─────────────────────────────────────────────────────────────

/**
 * Sandboxed iframe host for MCP Apps UI resources. Mount one per
 * URI — switching URIs unmounts the previous bridge.
 */
export function McpAppHost(props: McpAppHostProps): JSX.Element {
  const { resourceUri, fetchResource, onToolCall, style, className } = props;

  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<McpBridge | null>(null);

  // Keep the latest onToolCall in a ref so the bridge handler closes
  // over the live callback, not the one captured at iframe-load time.
  // Matches the WOTANN "capture latest prop" pattern used elsewhere.
  const onToolCallRef = useRef(onToolCall);
  useEffect(() => {
    onToolCallRef.current = onToolCall;
  }, [onToolCall]);

  // ── Fetch resource ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: "loading" });

    fetchResource(resourceUri)
      .then((html) => {
        if (cancelled) return;
        setPhase({ kind: "ready", html });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setPhase({ kind: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [resourceUri, fetchResource]);

  // ── Bridge tear-down on unmount / URI change ───────────────────
  useEffect(() => {
    return () => {
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
    };
  }, [resourceUri]);

  // ── Handle iframe load → build the bridge ─────────────────────
  const handleIframeLoad = useCallback((): void => {
    // Tear down any pre-existing bridge (double-load, e.g. from
    // srcdoc reassignment) before wiring a fresh one.
    bridgeRef.current?.destroy();
    bridgeRef.current = null;

    const iframe = iframeRef.current;
    if (!iframe) return;
    const win = iframe.contentWindow;
    if (!win) return;

    const sendHost = (msg: HostMessage): void => {
      bridgeRef.current?.sendToApp(msg);
    };

    const handleAppMessage = (msg: McpAppMessage): void => {
      switch (msg.type) {
        case "tool-call": {
          const handler = onToolCallRef.current;
          if (!handler) {
            sendHost({
              type: "error",
              message: `No tool handler wired for "${msg.toolName}"`,
            });
            return;
          }
          handler(msg.toolName, msg.args)
            .then((result) => {
              sendHost({ type: "tool-result", toolName: msg.toolName, result });
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : String(err);
              sendHost({ type: "error", message });
            });
          return;
        }
        case "ready":
        case "resource-read":
        case "state-update":
        case "error":
          // These are routed to onToolCall-free consumers in future
          // integrations. For now the T4.2 spec only requires tool-call
          // round-trips; other kinds are observed but not acted on here
          // (the host can tap them via props in a later revision).
          return;
      }
    };

    bridgeRef.current = createMcpBridge({
      targetWindow: win,
      targetOrigin: SRCDOC_ORIGIN,
      onAppMessage: handleAppMessage,
    });
  }, []);

  // ── Render ─────────────────────────────────────────────────────
  const rootStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    width: "100%",
    height: "100%",
    ...style,
  };

  if (phase.kind === "loading") {
    return (
      <div className={className} style={rootStyle} data-mcp-app-host="loading">
        <div style={{ padding: "12px", fontSize: "12px", color: "rgba(255,255,255,0.55)" }}>
          Loading MCP App…
        </div>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className={className} style={rootStyle} data-mcp-app-host="error">
        <div
          style={{
            padding: "12px",
            fontSize: "12px",
            color: "var(--color-error, #ff453a)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          MCP App failed to load: {phase.message}
        </div>
      </div>
    );
  }

  // phase.kind === "ready"
  return (
    <div className={className} style={rootStyle} data-mcp-app-host="ready">
      <iframe
        ref={iframeRef}
        title={`MCP App: ${resourceUri}`}
        srcDoc={phase.html}
        sandbox={IFRAME_SANDBOX}
        onLoad={handleIframeLoad}
        style={{
          flex: 1,
          width: "100%",
          height: "100%",
          border: "none",
          background: "transparent",
        }}
      />
    </div>
  );
}
