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
import type { BrowsePlan, BrowsePlanStep } from "./agentic-browser.js";
import type { TabRegistry, TabOwner } from "./tab-registry.js";

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
  "browser.plan",
  "browser.spawn_tab",
  "browser.approve_action",
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
    {
      name: "browser.plan",
      description:
        "Return the agentic-browser orchestrator's current plan for `task` as an ordered list " +
        "of step rationales. Inspection-only — execution stays with browser.goto/click/type.",
      inputSchema: {
        type: "object",
        properties: { task: stringProp("Natural-language task the agent should plan for") },
        required: ["task"],
      },
    },
    {
      name: "browser.spawn_tab",
      description:
        'Spawn a new browser tab and register it in the tab-registry. `ownership` is "user" ' +
        '(user-driven) or "agent" (agent-driven, counted against maxAgentTabs). Returns the ' +
        "new tabId, or `{rejected}` with a reason when the agent cap is exceeded.",
      inputSchema: {
        type: "object",
        properties: {
          ownership: { type: "string", description: '"user" or "agent"' },
          url: stringProp("Optional initial URL for the new tab"),
          taskId: stringProp("Optional taskId when ownership=agent (groups tabs by task)"),
        },
        required: ["ownership"],
      },
    },
    {
      name: "browser.approve_action",
      description:
        "Dispatch an allow/deny decision for a pending approval raised by the agentic browser. " +
        "Returns `{ok:false}` when the approvalId is unknown or already decided (honest failure).",
      inputSchema: {
        type: "object",
        properties: {
          actionId: stringProp("The approvalId (or queued actionId) returned at request time"),
          decision: { type: "string", description: '"allow" or "deny"' },
        },
        required: ["actionId", "decision"],
      },
    },
  ];
}

// ── Deps ────────────────────────────────────────────────────

/**
 * Injected orchestrator hooks for the agentic trio
 * (browser.plan / browser.spawn_tab / browser.approve_action).
 *
 * All three fields are optional: when an orchestrator callback is
 * absent the corresponding tool returns an honest empty/failed
 * envelope rather than silently succeeding (QB #6).
 */
export interface BrowserAgenticDep {
  /**
   * Returns the current plan for `task`. When missing or throwing,
   * browser.plan responds with `{plan:[]}` so callers can distinguish
   * "no planner available" from "planner produced 0 steps".
   */
  readonly plan?: (task: string) => Promise<BrowsePlan> | BrowsePlan;
  /** Per-session tab registry (see src/browser/tab-registry.ts). */
  readonly tabRegistry?: TabRegistry;
  /**
   * Factory for new CDP target IDs. Tests inject a deterministic
   * counter; prod wires this to the CDP `Target.createTarget` result.
   */
  readonly spawnTabId?: (url?: string) => string;
  /**
   * Delegate the allow/deny decision to the approval queue. Returns
   * `true` iff the queue accepted the decision. A throw or a `false`
   * return collapses to `{ok:false}` on the tool result.
   */
  readonly decideApproval?: (
    actionId: string,
    decision: "allow" | "deny",
  ) => Promise<boolean> | boolean;
}

export interface BrowserDep {
  chrome?: ChromeBridge | null;
  camoufox?: CamoufoxBrowser | null;
  agentic?: BrowserAgenticDep;
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
  // Agentic trio — these don't need a page-bound backend; they
  // delegate to the orchestrator / tab-registry / approval queue.
  if (
    toolName === "browser.plan" ||
    toolName === "browser.spawn_tab" ||
    toolName === "browser.approve_action"
  ) {
    return dispatchAgenticTool(toolName, input, dep.agentic);
  }

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

// ── Agentic dispatcher ──────────────────────────────────────

/**
 * Plan-step summary returned by browser.plan. Slimmed vs. the full
 * `BrowsePlanStep` so the LLM sees only what it needs to reason about
 * next actions (id / kind / rationale / optional target).
 */
export interface BrowserPlanStepSummary {
  readonly id: string;
  readonly kind: BrowsePlanStep["kind"];
  readonly rationale: string;
  readonly target?: string;
}

export type BrowserSpawnTabResult =
  | { readonly tabId: string; readonly ownership: "user" | "agent" }
  | { readonly rejected: string };

async function dispatchAgenticTool(
  toolName: "browser.plan" | "browser.spawn_tab" | "browser.approve_action",
  input: Record<string, unknown>,
  agentic: BrowserAgenticDep | undefined,
): Promise<BrowserToolResult<unknown>> {
  switch (toolName) {
    case "browser.plan": {
      const task = input["task"];
      if (typeof task !== "string" || task.trim().length === 0)
        return errEnv("bad_input", "task required");
      // Honest failure: with no planner we return an empty plan rather
      // than fabricate steps (QB #6).
      if (!agentic || !agentic.plan) {
        return { ok: true, data: { plan: [] as readonly BrowserPlanStepSummary[] } };
      }
      try {
        const plan = await agentic.plan(task);
        const summary: readonly BrowserPlanStepSummary[] = plan.steps.map((s) => ({
          id: s.id,
          kind: s.kind,
          rationale: s.rationale,
          ...(s.target !== undefined ? { target: s.target } : {}),
        }));
        return { ok: true, data: { plan: summary } };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return errEnv("upstream_error", `planner: ${detail.slice(0, 200)}`);
      }
    }
    case "browser.spawn_tab": {
      const ownership = input["ownership"];
      if (ownership !== "user" && ownership !== "agent")
        return errEnv("bad_input", 'ownership must be "user" or "agent"');
      const urlRaw = input["url"];
      const url = typeof urlRaw === "string" && urlRaw.length > 0 ? urlRaw : undefined;
      if (url !== undefined && !isSafeUrl(url)) return errEnv("ssrf_blocked", url);
      const taskIdRaw = input["taskId"];
      const taskId = typeof taskIdRaw === "string" && taskIdRaw.length > 0 ? taskIdRaw : "default";
      if (!agentic || !agentic.tabRegistry)
        return errEnv("not_configured", "tab-registry not wired");
      const tabId =
        agentic.spawnTabId?.(url) ?? `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const owner: TabOwner = ownership === "user" ? { kind: "user" } : { kind: "agent", taskId };
      const result = agentic.tabRegistry.register(
        url !== undefined ? { tabId, owner, url } : { tabId, owner },
      );
      if (!result.ok) {
        const data: BrowserSpawnTabResult = {
          rejected:
            result.error === "max-agent-tabs-exceeded" ? "max agent tabs exceeded" : result.error,
        };
        return { ok: true, data };
      }
      const data: BrowserSpawnTabResult = { tabId: result.tab.tabId, ownership };
      return { ok: true, data };
    }
    case "browser.approve_action": {
      const actionId = input["actionId"];
      const decision = input["decision"];
      if (typeof actionId !== "string" || actionId.trim().length === 0)
        return errEnv("bad_input", "actionId required");
      if (decision !== "allow" && decision !== "deny")
        return errEnv("bad_input", 'decision must be "allow" or "deny"');
      if (!agentic || !agentic.decideApproval) {
        return { ok: true, data: { ok: false, detail: "approval-queue not wired" } };
      }
      try {
        const accepted = await agentic.decideApproval(actionId, decision);
        return { ok: true, data: { ok: accepted === true } };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { ok: true, data: { ok: false, detail: detail.slice(0, 200) } };
      }
    }
    default: {
      const _exhaustive: never = toolName;
      return errEnv("bad_input", `unknown agentic tool: ${String(_exhaustive)}`);
    }
  }
}
