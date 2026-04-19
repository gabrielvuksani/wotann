/**
 * Browser Agent Tools — tool schemas and dispatch wrappers for the Chrome
 * DevTools bridge + Camoufox stealth backend.
 *
 * Design:
 * - `browser.goto`, `browser.click`, `browser.type`, `browser.screenshot`,
 *   `browser.read_page` are the five agent-facing operations.
 * - At dispatch time the handler picks a backend (Chrome bridge when CDP
 *   is available, else Camoufox when the Python driver boots, else
 *   returns `not_configured`). The selection is honest — if neither
 *   backend is reachable we refuse rather than silently succeeding.
 * - Every URL passed to `browser.goto` is SSRF-guarded so the agent
 *   cannot be tricked into scraping cloud metadata endpoints.
 */

import type { ToolDefinition } from "../core/types.js";
import { ChromeBridge } from "./chrome-bridge.js";
import { CamoufoxBrowser } from "./camoufox-backend.js";
import { isSafeUrl } from "../security/ssrf-guard.js";

// ── Envelope ────────────────────────────────────────────────

export type BrowserToolOk<T> = { readonly ok: true; readonly data: T };
export type BrowserToolErr = {
  readonly ok: false;
  readonly error:
    | "not_configured"
    | "bad_input"
    | "ssrf_blocked"
    | "navigation_failed"
    | "upstream_error";
  readonly detail?: string;
};
export type BrowserToolResult<T> = BrowserToolOk<T> | BrowserToolErr;

// ── Tool Names ──────────────────────────────────────────────

export const BROWSER_TOOL_NAMES = [
  "browser.goto",
  "browser.click",
  "browser.type",
  "browser.screenshot",
  "browser.read_page",
] as const;

export type BrowserToolName = (typeof BROWSER_TOOL_NAMES)[number];

export function isBrowserTool(name: string): name is BrowserToolName {
  return (BROWSER_TOOL_NAMES as readonly string[]).includes(name);
}

// ── Schemas ─────────────────────────────────────────────────

function stringProp(description: string): Record<string, unknown> {
  return { type: "string", description };
}

export function buildBrowserToolDefinitions(): readonly ToolDefinition[] {
  return [
    {
      name: "browser.goto",
      description:
        "Navigate the agent-controlled browser to `url`. Uses the Chrome CDP bridge when a " +
        "Chromium browser is running with --remote-debugging-port=9222, else falls back to " +
        "Camoufox (stealth Firefox) when the python driver is installed. Blocks cloud " +
        "metadata endpoints and private IPs.",
      inputSchema: {
        type: "object",
        properties: { url: stringProp("Absolute http(s) URL to navigate to") },
        required: ["url"],
      },
    },
    {
      name: "browser.click",
      description: "Click the first element matching the CSS selector on the current page.",
      inputSchema: {
        type: "object",
        properties: { selector: stringProp("CSS selector") },
        required: ["selector"],
      },
    },
    {
      name: "browser.type",
      description: "Type text into the element matching the CSS selector.",
      inputSchema: {
        type: "object",
        properties: {
          selector: stringProp("CSS selector for the input"),
          text: stringProp("Text to type"),
        },
        required: ["selector", "text"],
      },
    },
    {
      name: "browser.screenshot",
      description: "Capture a screenshot of the current page. Returns the saved path.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "browser.read_page",
      description:
        "Read visible text content from the current page. Preferred for non-vision models " +
        "since the DOM is converted to a structured text tree.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

// ── Deps ────────────────────────────────────────────────────

export interface BrowserDep {
  chrome?: ChromeBridge | null;
  camoufox?: CamoufoxBrowser | null;
}

async function pickBackend(dep: BrowserDep): Promise<"chrome" | "camoufox" | null> {
  if (dep.chrome) {
    try {
      if (await dep.chrome.isAvailable()) return "chrome";
    } catch {
      // fall through
    }
  }
  if (dep.camoufox) {
    if (dep.camoufox.isLaunched()) return "camoufox";
    try {
      if (await dep.camoufox.launch()) return "camoufox";
    } catch {
      /* fall through */
    }
  }
  return null;
}

function errEnv(error: BrowserToolErr["error"], detail?: string): BrowserToolErr {
  return { ok: false, error, ...(detail !== undefined ? { detail } : {}) };
}

// ── Dispatcher ──────────────────────────────────────────────

export async function dispatchBrowserTool(
  toolName: BrowserToolName,
  input: Record<string, unknown>,
  dep: BrowserDep,
): Promise<BrowserToolResult<unknown>> {
  const backend = await pickBackend(dep);
  if (!backend) {
    return errEnv("not_configured", "no browser backend available (need Chromium CDP or Camoufox)");
  }

  switch (toolName) {
    case "browser.goto": {
      const url = input["url"];
      if (typeof url !== "string" || url.trim().length === 0)
        return errEnv("bad_input", "url required");
      if (!isSafeUrl(url)) return errEnv("ssrf_blocked", url);
      if (backend === "chrome" && dep.chrome) {
        const result = await dep.chrome.execute({ type: "navigate", url });
        return result.success
          ? { ok: true, data: { url, backend } }
          : errEnv("navigation_failed", result.error);
      }
      if (backend === "camoufox" && dep.camoufox) {
        const result = await dep.camoufox.newPage(url);
        return result.success
          ? { ok: true, data: { url: result.url, title: result.title, backend } }
          : errEnv("navigation_failed", result.error);
      }
      return errEnv("not_configured", "backend vanished");
    }
    case "browser.click": {
      const selector = input["selector"];
      if (typeof selector !== "string" || selector.trim().length === 0)
        return errEnv("bad_input", "selector required");
      if (backend === "chrome" && dep.chrome) {
        const result = await dep.chrome.execute({ type: "click", selector });
        return result.success
          ? { ok: true, data: { selector } }
          : errEnv("navigation_failed", result.error);
      }
      if (backend === "camoufox" && dep.camoufox) {
        const result = await dep.camoufox.click(selector);
        return result.success
          ? { ok: true, data: { selector } }
          : errEnv("navigation_failed", result.error);
      }
      return errEnv("not_configured", "backend vanished");
    }
    case "browser.type": {
      const selector = input["selector"];
      const text = input["text"];
      if (typeof selector !== "string" || typeof text !== "string")
        return errEnv("bad_input", "selector + text required");
      if (backend === "chrome" && dep.chrome) {
        const result = await dep.chrome.execute({ type: "type", selector, value: text });
        return result.success
          ? { ok: true, data: { selector, bytes: text.length } }
          : errEnv("navigation_failed", result.error);
      }
      if (backend === "camoufox" && dep.camoufox) {
        const result = await dep.camoufox.type(selector, text);
        return result.success
          ? { ok: true, data: { selector, bytes: text.length } }
          : errEnv("navigation_failed", result.error);
      }
      return errEnv("not_configured", "backend vanished");
    }
    case "browser.screenshot": {
      if (backend === "chrome" && dep.chrome) {
        const result = await dep.chrome.execute({ type: "screenshot" });
        return result.success
          ? { ok: true, data: { path: result.screenshotPath ?? "", backend } }
          : errEnv("upstream_error", result.error);
      }
      if (backend === "camoufox" && dep.camoufox) {
        const result = await dep.camoufox.screenshot();
        return result.success
          ? { ok: true, data: { path: result.path, backend } }
          : errEnv("upstream_error", result.error);
      }
      return errEnv("not_configured", "backend vanished");
    }
    case "browser.read_page": {
      if (backend === "chrome" && dep.chrome) {
        const result = await dep.chrome.execute({ type: "read_dom" });
        if (!result.success) return errEnv("upstream_error", result.error);
        const text = result.domTree ? dep.chrome.domToText(result.domTree) : (result.data ?? "");
        return { ok: true, data: { text, backend } };
      }
      if (backend === "camoufox" && dep.camoufox) {
        const result = await dep.camoufox.getText();
        return result.success
          ? { ok: true, data: { text: result.text, backend } }
          : errEnv("upstream_error", result.error);
      }
      return errEnv("not_configured", "backend vanished");
    }
    default: {
      const _exhaustive: never = toolName;
      return errEnv("bad_input", `unknown tool: ${String(_exhaustive)}`);
    }
  }
}
