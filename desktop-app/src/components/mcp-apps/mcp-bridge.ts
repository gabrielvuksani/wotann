/**
 * MCP Apps postMessage bridge (V9 T4.2).
 *
 * Pure, DOM-light adapter between the desktop host and an embedded
 * MCP App iframe. No React: this module is a plain factory that can
 * be driven by `McpAppHost.tsx` at runtime or by unit tests with stub
 * `targetWindow` + `addMessageListener` injections.
 *
 * Validation contract (strict):
 *   1. Origin check: messages whose `event.origin` !== `targetOrigin`
 *      are dropped silently. This is a security boundary — surfacing
 *      those events via `onError` would leak cross-origin probe info.
 *   2. Envelope shape: `{ type: "mcp-app", payload: ... }`. Anything
 *      else is surfaced via `onError` (malformed wire frame).
 *   3. Payload shape: must be a plain object with a known `type`
 *      discriminator from `McpAppMessage`. Unknown types go to
 *      `onError`; missing fields go to `onError`.
 *
 * `sendToApp` always posts with the configured `targetOrigin` and
 * NEVER with "*", preventing host replies from leaking to unexpected
 * frames.
 *
 * WOTANN quality bars:
 * - QB #6 honest stubs: validation failures call `onError`, not
 *   `onAppMessage`. No silent success.
 * - QB #7 per-session state: the bridge instance owns its state;
 *   no module-level singletons, so multiple `McpAppHost` mounts
 *   can coexist without cross-talk.
 * - QB #11 sibling-site scan: the iframe shell in
 *   `src/mcp/ui-resources.ts` is the only known postMessage
 *   producer targeting this bridge. Envelope shape is kept in sync
 *   with that stub.
 * - Security: `allow-scripts` only (never `allow-same-origin`) is
 *   enforced at the React host layer (`McpAppHost.tsx`).
 */

import type { HostMessage, McpAppEnvelope, McpAppMessage } from "./types";

// ── Options & handle ──────────────────────────────────────────────────────

/** Bridge construction options. */
export interface McpBridgeOptions {
  /**
   * Target window to post to (the iframe's contentWindow). We only
   * need `postMessage`, so the interface is intentionally narrowed —
   * tests can pass a plain stub instead of a real `Window`.
   */
  readonly targetWindow: Pick<Window, "postMessage">;
  /**
   * Allowed iframe origin. Incoming messages are dropped unless their
   * `event.origin` matches exactly. Outgoing `sendToApp` uses this
   * value as `postMessage`'s second argument.
   *
   * For `srcdoc` iframes without `allow-same-origin` the browser
   * reports the origin as `"null"` — callers using srcdoc should
   * pass `"null"` here rather than a placeholder like "*".
   */
  readonly targetOrigin: string;
  /** Called once per validated incoming app message. */
  readonly onAppMessage: (msg: McpAppMessage) => void;
  /**
   * Called for malformed frames or unknown payload types. The Error
   * object is informational — the bridge never throws.
   */
  readonly onError?: (err: Error) => void;
  /**
   * Register a `message` event listener. Injected for tests so we
   * don't need a real DOM. Must return a function that removes the
   * listener.
   *
   * Default: uses `globalThis.addEventListener("message", ...)` with
   * a matching `removeEventListener` as the returned disposer.
   */
  readonly addMessageListener?: (handler: (e: MessageEvent) => void) => () => void;
}

/** Handle returned by `createMcpBridge`. */
export interface McpBridge {
  /** Send a host-authored message to the app. */
  readonly sendToApp: (msg: HostMessage) => void;
  /** Remove the message listener. Safe to call more than once. */
  readonly destroy: () => void;
}

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * Production default for `addMessageListener`: attaches to
 * `globalThis` (which is `window` in the renderer). Split out so
 * tests can replace it without monkey-patching globals.
 */
function defaultAddMessageListener(handler: (e: MessageEvent) => void): () => void {
  // Guard: in non-browser contexts (e.g. ssr, jsdom-less tests) fall
  // back to a no-op rather than crash. Matches "honest stub" QB.
  const root = globalThis as unknown as {
    addEventListener?: (type: string, h: (e: MessageEvent) => void) => void;
    removeEventListener?: (type: string, h: (e: MessageEvent) => void) => void;
  };
  if (typeof root.addEventListener !== "function" || typeof root.removeEventListener !== "function") {
    return () => {};
  }
  root.addEventListener("message", handler);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    root.removeEventListener?.("message", handler);
  };
}

// ── Validation ────────────────────────────────────────────────────────────

/** Type guard: value is a plain non-null object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse the `{ type: "mcp-app", payload }` wrapper. */
function parseEnvelope(data: unknown): McpAppEnvelope | null {
  if (!isObject(data)) return null;
  if (data["type"] !== "mcp-app") return null;
  if (!("payload" in data)) return null;
  return { type: "mcp-app", payload: data["payload"] };
}

/**
 * Validate a raw payload and narrow it to `McpAppMessage`. Returns
 * `null` on any failure — the caller decides whether to surface via
 * `onError`.
 *
 * Rules per variant:
 *   - `ready`: requires a manifest object with at minimum `uri`,
 *     `name`, `allowedOrigins[]`, `bridgeVersion`.
 *   - `tool-call`: requires string `toolName` + object `args`.
 *   - `resource-read`: requires string `uri`.
 *   - `state-update`: requires the `data` field to exist (value can
 *     be any — the host is responsible for schema checks).
 *   - `error`: requires string `message`.
 */
function parseAppMessage(payload: unknown): McpAppMessage | null {
  if (!isObject(payload)) return null;
  const type = payload["type"];
  if (typeof type !== "string") return null;

  switch (type) {
    case "ready": {
      const m = payload["manifest"];
      if (!isObject(m)) return null;
      const { uri, name, allowedOrigins, bridgeVersion } = m;
      if (typeof uri !== "string") return null;
      if (typeof name !== "string") return null;
      if (!Array.isArray(allowedOrigins) || !allowedOrigins.every((o) => typeof o === "string")) {
        return null;
      }
      if (typeof bridgeVersion !== "string") return null;
      const description = m["description"];
      const manifest = {
        uri,
        name,
        allowedOrigins: allowedOrigins as readonly string[],
        bridgeVersion,
        ...(typeof description === "string" ? { description } : {}),
      };
      return { type: "ready", manifest };
    }
    case "tool-call": {
      const toolName = payload["toolName"];
      const args = payload["args"];
      if (typeof toolName !== "string") return null;
      if (!isObject(args)) return null;
      return { type: "tool-call", toolName, args };
    }
    case "resource-read": {
      const uri = payload["uri"];
      if (typeof uri !== "string") return null;
      return { type: "resource-read", uri };
    }
    case "state-update": {
      if (!("data" in payload)) return null;
      return { type: "state-update", data: payload["data"] };
    }
    case "error": {
      const message = payload["message"];
      if (typeof message !== "string") return null;
      return { type: "error", message };
    }
    default:
      return null;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * Create a new MCP Apps bridge. Immediately registers a message
 * listener; call `destroy()` to clean up.
 *
 * Design decisions:
 * - No shared state between bridges. Each call returns a fresh
 *   handle with its own listener registration.
 * - No auto-unregister on first error: listener stays alive so
 *   benign malformed frames don't kill the channel.
 * - `destroy` is idempotent — after the first call the listener is
 *   already removed; subsequent calls are no-ops.
 */
export function createMcpBridge(options: McpBridgeOptions): McpBridge {
  const {
    targetWindow,
    targetOrigin,
    onAppMessage,
    onError,
    addMessageListener = defaultAddMessageListener,
  } = options;

  function reportError(err: Error): void {
    if (onError) {
      try {
        onError(err);
      } catch {
        // Host error handler threw — swallow so the bridge stays
        // alive. The original error is lost; honest-stub policy
        // says we do not re-surface via onAppMessage.
      }
    }
  }

  const handleMessage = (event: MessageEvent): void => {
    // 1. Origin boundary — silent drop, not an error. A wrong-origin
    //    message is expected in multi-iframe environments and isn't
    //    a bug on our side.
    if (event.origin !== targetOrigin) {
      return;
    }

    // 2. Envelope shape.
    const envelope = parseEnvelope(event.data);
    if (!envelope) {
      reportError(new Error("mcp-bridge: malformed envelope (expected { type: 'mcp-app', payload })"));
      return;
    }

    // 3. Payload validation.
    const appMessage = parseAppMessage(envelope.payload);
    if (!appMessage) {
      reportError(new Error("mcp-bridge: invalid or unknown app message payload"));
      return;
    }

    onAppMessage(appMessage);
  };

  const removeListener = addMessageListener(handleMessage);

  let destroyed = false;

  return {
    sendToApp(msg: HostMessage): void {
      if (destroyed) return;
      // Always use the configured origin — never "*". This is a
      // hard security boundary: sending with "*" would leak host
      // responses to any frame that happens to be loaded.
      targetWindow.postMessage(msg, targetOrigin);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      try {
        removeListener();
      } catch (err) {
        // Swallow remover failures — the bridge is going away.
        reportError(err instanceof Error ? err : new Error(String(err)));
      }
    },
  };
}

// ── Re-exports (convenience) ──────────────────────────────────────────────

export type { HostMessage, McpAppEnvelope, McpAppMessage, McpAppManifest } from "./types";
