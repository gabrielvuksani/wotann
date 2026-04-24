/**
 * MCP Apps client types (V9 T4.2).
 *
 * Shared shapes for the desktop-app postMessage bridge that renders
 * SEP-1865 MCP UI resources (MIME `text/html;profile=mcp-app`) in a
 * sandboxed iframe. The server side (V9 T4.1) lives at
 * `src/mcp/ui-resources.ts` and embeds a `window.mcp.postMessage`
 * stub that speaks the `McpAppMessage` protocol below.
 *
 * Wire format:
 *   iframe (app) -> host : posts `{ type: "mcp-app", payload: McpAppMessage }`
 *   host -> iframe (app) : posts `HostMessage` directly
 *
 * The `payload`-wrapping envelope is what the server-side shell emits
 * (see `wrapHtmlShell` in ui-resources.ts) so the bridge unwraps it
 * transparently.
 *
 * WOTANN quality bars:
 * - QB #6 honest stubs: no silent success — validation failures are
 *   surfaced via `onError` rather than swallowed.
 * - Immutability: all types `readonly`, no in-place mutation.
 */

// ── Manifest ──────────────────────────────────────────────────────────────

/**
 * Declared capability manifest shipped by an MCP App on `ready`. Mirrors
 * the JSON embedded in `<script type="application/json" id="mcp-manifest">`
 * by the server-side shell (see `wrapHtmlShell` in ui-resources.ts).
 *
 * `allowedOrigins` is host-side policy: the bridge checks incoming message
 * origins against this allowlist plus its configured `targetOrigin`. The
 * field is carried on the manifest so registered apps can self-declare
 * their accepted origins (e.g. when launched from a remote host URL).
 */
export interface McpAppManifest {
  readonly uri: string;
  readonly name: string;
  readonly description?: string;
  readonly allowedOrigins: readonly string[];
  readonly bridgeVersion: string;
}

// ── App → Host messages ───────────────────────────────────────────────────

/**
 * Messages sent FROM the embedded MCP App TO the desktop host. The
 * `type` discriminator matches the SEP-1865 message vocabulary.
 *
 * - `ready`: app finished booting. Carries the manifest so the host can
 *   gate subsequent messages on the declared capabilities.
 * - `tool-call`: app invokes an MCP tool. The host round-trips the
 *   response as a `tool-result` HostMessage.
 * - `resource-read`: app requests the contents of another UI resource.
 * - `state-update`: app broadcasts an internal state change for the
 *   host to persist / render in its own chrome.
 * - `error`: app surfaces a failure. The message string is informational;
 *   structured details go through the regular channels.
 */
export type McpAppMessage =
  | { readonly type: "ready"; readonly manifest: McpAppManifest }
  | {
      readonly type: "tool-call";
      readonly toolName: string;
      readonly args: Record<string, unknown>;
    }
  | { readonly type: "resource-read"; readonly uri: string }
  | { readonly type: "state-update"; readonly data: unknown }
  | { readonly type: "error"; readonly message: string };

// ── Host → App messages ───────────────────────────────────────────────────

/**
 * Messages sent FROM the desktop host TO the embedded MCP App. Each
 * kind is a response to or initiated-by the host.
 *
 * - `tool-result`: reply to an app `tool-call`. `result` is the raw
 *   tool response; errors surface as `{ type: "error" }` instead.
 * - `resource-content`: reply to an app `resource-read` with the HTML
 *   body.
 * - `error`: host-side failure (e.g. tool threw, resource not found).
 */
export type HostMessage =
  | {
      readonly type: "tool-result";
      readonly toolName: string;
      readonly result: unknown;
    }
  | { readonly type: "resource-content"; readonly uri: string; readonly content: string }
  | { readonly type: "error"; readonly message: string };

// ── Envelope (as posted over the wire) ────────────────────────────────────

/**
 * Envelope shape the embedded app wraps its messages in. Matches the
 * server-side bridge stub from ui-resources.ts:
 *
 *   window.mcp.postMessage = (msg) => window.parent.postMessage(
 *     { type: "mcp-app", payload: msg }, "*"
 *   );
 *
 * The host's message listener unwraps this before dispatching.
 */
export interface McpAppEnvelope {
  readonly type: "mcp-app";
  readonly payload: unknown;
}
