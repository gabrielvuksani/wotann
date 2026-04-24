/**
 * MCP Apps (SEP-1865) UI resource registry for WOTANN.
 *
 * Ratified Jan 26 2026 by Anthropic + OpenAI + MCP-UI community.
 * Implementation spec: tools emit a `_meta.ui.resourceUri` pointing
 * at an MCP resource whose MIME type is `text/html;profile=mcp-app`.
 * Hosts that support the protocol (Claude, ChatGPT, VS Code, Goose,
 * Postman, MCPJam) render the HTML in a sandboxed iframe alongside
 * the tool result.
 *
 * This module is the server-side (V9 T4.1) half: WOTANN-as-MCP-host
 * exposes its native UIs (memory browser, cost preview, editor diff)
 * so other hosts can render them when they call WOTANN's tools. The
 * client-side (V9 T4.2) lives in the desktop-app codebase and wraps
 * incoming `_meta.ui.resourceUri` in a Tauri iframe with CSP.
 *
 * Design:
 * - Registry = `Map<URI, ResourceHandler>` where URI is the stable
 *   `ui://wotann/<slug>` identifier and handler is a sync function
 *   returning the HTML body (plus mime + optional annotations).
 * - URIs are content-addressed semantically: same slug = same UI.
 *   Callers can hard-code `ui://wotann/memory-browser` and expect the
 *   memory-browser UI. Handlers can parameterize via query strings
 *   when needed (e.g. `ui://wotann/editor-diff?session=abc123`).
 * - HTML is STATIC + sandbox-safe: no inline JS can call privileged
 *   WOTANN APIs. All host↔app communication goes through the MCP
 *   Apps postMessage JSON-RPC bridge on the client side.
 *
 * WOTANN quality bars:
 * - QB #6 honest stubs: unknown URIs return `null`, not a blank HTML.
 * - QB #7 per-call state: no module-level caches of rendered HTML;
 *   each call re-renders (handlers may close over state but the
 *   registry doesn't). Render cost is negligible for these small UIs.
 * - QB #11 sibling-site scan: this registry is consumed by
 *   `mcp-server.ts`'s `resources/list` + `resources/read` handlers
 *   (wired in the same commit).
 */

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * One renderable MCP UI resource. `uri` is the stable identifier
 * clients pass to `resources/read`; `title` + `description` are the
 * human-facing labels used in `resources/list`. The MCP Apps MIME
 * `text/html;profile=mcp-app` is hard-coded on the read path.
 */
export interface UiResourceDescriptor {
  readonly uri: string;
  readonly title: string;
  readonly description: string;
  /**
   * MCP Apps MIME type. Always `text/html;profile=mcp-app` for
   * spec-compliant resources; exposed as a field so future profiles
   * (e.g. SVG) can be added without changing the renderer shape.
   */
  readonly mimeType: string;
}

/** Render result for a single MCP UI resource. */
export interface UiResourceContent {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

/**
 * Handler signature: takes the URI (for query-string parsing when a
 * handler is parameterized) and returns the rendered content.
 * Synchronous — these UIs are static HTML templates with minimal
 * substitution, so there's no reason for async I/O in the registry.
 */
export type UiResourceHandler = (uri: string) => UiResourceContent;

// ── Built-in WOTANN UI resources ──────────────────────────────────────────

const MEMORY_BROWSER_URI = "ui://wotann/memory-browser";
const COST_PREVIEW_URI = "ui://wotann/cost-preview";
const EDITOR_DIFF_URI = "ui://wotann/editor-diff";

const MCP_APP_MIME = "text/html;profile=mcp-app";

/**
 * Minimal HTML shell shared by all WOTANN UI resources. Adds:
 * - `<meta charset>` + `<meta viewport>` for consistent rendering.
 * - A small MCP-Apps bridge stub (`window.mcp.postMessage`) so the
 *   embedded app can call back to the host via postMessage JSON-RPC.
 *   The actual bridge wiring happens host-side; this stub just defines
 *   the contract so inline JS doesn't get ReferenceError.
 * - Spec-required `<script type="application/json" id="mcp-manifest">`
 *   block so hosts can inspect the app's declared capabilities.
 */
function wrapHtmlShell(args: {
  readonly title: string;
  readonly capabilities: readonly string[];
  readonly body: string;
}): string {
  const manifest = JSON.stringify(
    {
      mcp: { version: "1.0", profile: "mcp-app" },
      title: args.title,
      capabilities: args.capabilities,
    },
    null,
    2,
  );
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${escapeHtml(args.title)}</title>`,
    `  <script type="application/json" id="mcp-manifest">${manifest}</script>`,
    '  <script type="text/javascript">',
    "    // MCP Apps bridge stub. Host wires real postMessage handling.",
    "    window.mcp = {",
    "      postMessage: (msg) => window.parent.postMessage(",
    '        { type: "mcp-app", payload: msg }, "*"',
    "      ),",
    "    };",
    "  </script>",
    "  <style>",
    "    body { font: 14px system-ui, sans-serif; margin: 16px; color: #222; }",
    "    h1 { font-size: 16px; margin: 0 0 8px 0; }",
    "    .placeholder { color: #888; font-style: italic; }",
    "    code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }",
    "  </style>",
    "</head>",
    "<body>",
    args.body,
    "</body>",
    "</html>",
  ].join("\n");
}

/** HTML-escape untrusted substitutions. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMemoryBrowser(uri: string): UiResourceContent {
  return {
    uri,
    mimeType: MCP_APP_MIME,
    text: wrapHtmlShell({
      title: "WOTANN Memory Browser",
      capabilities: ["search", "inspect"],
      body: [
        "<h1>Memory</h1>",
        '<p class="placeholder">Embedded memory browser. Sends queries to the host via',
        "<code>window.mcp.postMessage({ type: &quot;memory.search&quot;, query })</code>",
        "and renders results inline.</p>",
        '<div id="results"></div>',
      ].join("\n"),
    }),
  };
}

function renderCostPreview(uri: string): UiResourceContent {
  return {
    uri,
    mimeType: MCP_APP_MIME,
    text: wrapHtmlShell({
      title: "WOTANN Cost Preview",
      capabilities: ["predict"],
      body: [
        "<h1>Cost preview</h1>",
        '<p class="placeholder">Shows projected token cost + provider choice before',
        "execution. Requests a prediction from the host via",
        "<code>window.mcp.postMessage({ type: &quot;cost.predict&quot; })</code>.</p>",
        '<div id="prediction"></div>',
      ].join("\n"),
    }),
  };
}

function renderEditorDiff(uri: string): UiResourceContent {
  return {
    uri,
    mimeType: MCP_APP_MIME,
    text: wrapHtmlShell({
      title: "WOTANN Editor Diff",
      capabilities: ["diff", "accept"],
      body: [
        "<h1>Agent edits</h1>",
        '<p class="placeholder">Renders the latest agent edit as a side-by-side diff.',
        "Accept / reject buttons round-trip via",
        "<code>window.mcp.postMessage({ type: &quot;diff.accept&quot; | &quot;diff.reject&quot; })</code>.</p>",
        '<div id="diff"></div>',
      ].join("\n"),
    }),
  };
}

// ── Registry ──────────────────────────────────────────────────────────────

const DESCRIPTORS: readonly UiResourceDescriptor[] = [
  {
    uri: MEMORY_BROWSER_URI,
    title: "Memory Browser",
    description: "Interactive view of WOTANN's persistent memory store.",
    mimeType: MCP_APP_MIME,
  },
  {
    uri: COST_PREVIEW_URI,
    title: "Cost Preview",
    description: "Predicts provider cost + routing before a query executes.",
    mimeType: MCP_APP_MIME,
  },
  {
    uri: EDITOR_DIFF_URI,
    title: "Editor Diff",
    description: "Side-by-side diff viewer for agent edits with accept/reject.",
    mimeType: MCP_APP_MIME,
  },
];

const HANDLERS: ReadonlyMap<string, UiResourceHandler> = new Map<string, UiResourceHandler>([
  [MEMORY_BROWSER_URI, renderMemoryBrowser],
  [COST_PREVIEW_URI, renderCostPreview],
  [EDITOR_DIFF_URI, renderEditorDiff],
]);

/** List all registered MCP UI resources for `resources/list`. */
export function listUiResources(): readonly UiResourceDescriptor[] {
  return DESCRIPTORS;
}

/**
 * Read a single MCP UI resource by URI for `resources/read`.
 * Returns `null` on unknown URI — the MCP server surfaces that as
 * a 404-equivalent JSON-RPC error per V9 T4.1's integration test
 * row "resources/read invalid → 404-equivalent error". Normalizes
 * the URI by stripping any query string before lookup so
 * parameterized handlers can still dispatch off the base identifier.
 */
export function readUiResource(uri: string): UiResourceContent | null {
  const base = uri.split("?")[0] ?? uri;
  const handler = HANDLERS.get(base);
  if (!handler) return null;
  return handler(uri);
}
