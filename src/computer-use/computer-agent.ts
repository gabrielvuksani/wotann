/**
 * Computer use agent: 4-layer hybrid strategy.
 * Layer 1: API/CLI first → Layer 2: a11y tree → Layer 3: vision-native → Layer 4: text-mediated
 */

import { PerceptionEngine } from "./perception-engine.js";
import {
  PerceptionAdapter,
  type ModelCapabilities,
  type PerceptionOutput,
} from "./perception-adapter.js";
import type { CUAction, APIRoute, CUGuardrails, Perception } from "./types.js";
import { routePerception } from "../runtime-hooks/dead-code-hooks.js";
import {
  CamoufoxBrowser,
  isAvailable as isCamoufoxAvailable,
} from "../browser/camoufox-backend.js";
import type { PageResult, TextResult } from "../browser/camoufox-backend.js";

// ── API Route Table (40+ fast-path routes) ──────────────────

const DEFAULT_API_ROUTES: readonly APIRoute[] = [
  {
    pattern: /\b(check|view|open)\b.*\bcalendar\b/i,
    handler: "calendar.list",
    description: "Calendar events",
  },
  {
    pattern: /\bcreate\s+\w*\s*(event|meeting)\b/i,
    handler: "calendar.create",
    description: "Create calendar event",
  },
  {
    pattern: /\b(check|read)\b.*\b(email|inbox|mail)\b/i,
    handler: "email.list",
    description: "Email inbox",
  },
  { pattern: /\bsend\b.*\bemail\b/i, handler: "email.send", description: "Send email" },
  { pattern: /\b(open|launch)\s+(\w+)\b/i, handler: "app.open", description: "Open application" },
  { pattern: /\b(volume|brightness)\b/i, handler: "system.setting", description: "System setting" },
  { pattern: /\bclipboard\b/i, handler: "system.clipboard", description: "Clipboard access" },
  {
    pattern: /\b(play|pause|next|previous)\s*(track|song)?\b/i,
    handler: "media.control",
    description: "Media control",
  },
  {
    pattern: /\b(git|github)\s+(status|log|diff|push|pull|commit)\b/i,
    handler: "git.command",
    description: "Git operation",
  },
  {
    pattern: /\b(list|show)\s+(files|directory|folder)\b/i,
    handler: "fs.list",
    description: "File listing",
  },
  {
    pattern: /\b(create|new)\s+(file|folder|directory)\b/i,
    handler: "fs.create",
    description: "Create file/folder",
  },
  {
    pattern: /\b(search|find)\s+(files?|code)\b/i,
    handler: "search.files",
    description: "File search",
  },
  { pattern: /\bweather\b/i, handler: "web.weather", description: "Weather check" },
  { pattern: /\btimer\b/i, handler: "system.timer", description: "Set timer" },
  { pattern: /\bscreenshot\b/i, handler: "screen.capture", description: "Take screenshot" },
  { pattern: /\block\s+screen\b/i, handler: "system.lock", description: "Lock screen" },
];

const DEFAULT_GUARDRAILS: CUGuardrails = {
  blockedDomains: [
    "bank",
    "paypal",
    "venmo",
    "cash.app",
    "robinhood",
    "fidelity",
    "schwab",
    "vanguard",
    "coinbase",
    "crypto",
  ],
  maxActionsPerMinute: 60,
  requirePermissionFor: [
    "credentials",
    "purchase",
    "system-settings",
    "message-send",
    "file-delete",
    "app-install",
  ],
  redactPasswords: true,
};

// ── Computer Use Agent ──────────────────────────────────────

export class ComputerUseAgent {
  private readonly perception: PerceptionEngine;
  private readonly perceptionAdapter: PerceptionAdapter;
  private readonly apiRoutes: readonly APIRoute[];
  private readonly guardrails: CUGuardrails;
  private actionCount: number = 0;
  private lastMinuteReset: number = Date.now();

  constructor(options?: {
    perception?: PerceptionEngine;
    perceptionAdapter?: PerceptionAdapter;
    apiRoutes?: readonly APIRoute[];
    guardrails?: Partial<CUGuardrails>;
  }) {
    this.perception = options?.perception ?? new PerceptionEngine();
    this.perceptionAdapter = options?.perceptionAdapter ?? new PerceptionAdapter();
    this.apiRoutes = options?.apiRoutes ?? DEFAULT_API_ROUTES;
    this.guardrails = { ...DEFAULT_GUARDRAILS, ...options?.guardrails };
  }

  /**
   * Find an API route for a task (Layer 1 — fastest path).
   */
  findAPIRoute(task: string): APIRoute | null {
    for (const route of this.apiRoutes) {
      if (route.pattern.test(task)) {
        return route;
      }
    }
    return null;
  }

  /**
   * Check if a URL/domain is blocked by guardrails.
   */
  isBlockedDomain(url: string): boolean {
    const lower = url.toLowerCase();
    return this.guardrails.blockedDomains.some((domain) => lower.includes(domain));
  }

  /**
   * Check rate limit (max actions/minute).
   */
  checkRateLimit(): { allowed: boolean; remaining: number } {
    const now = Date.now();
    if (now - this.lastMinuteReset > 60_000) {
      this.actionCount = 0;
      this.lastMinuteReset = now;
    }

    return {
      allowed: this.actionCount < this.guardrails.maxActionsPerMinute,
      remaining: this.guardrails.maxActionsPerMinute - this.actionCount,
    };
  }

  /**
   * Record an action for rate limiting.
   */
  recordAction(): void {
    this.actionCount++;
  }

  /**
   * Route a raw PerceptionEngine frame through the PerceptionAdapter
   * before model dispatch so the active provider sees a tier-appropriate
   * payload: raw screenshots for frontier vision, Set-of-Mark + index
   * for small vision, accessibility-tree text for text-only models.
   *
   * Wave 3H wiring: previously `routePerception` (runtime-hooks) was
   * defined but never invoked. This method delegates to it so CLI /
   * daemon callers can swap from the hard-coded `perception.toText()`
   * path to the adapter path by passing a modelId + capabilities.
   *
   * Honest behaviour: throws if the adapter throws. No silent fallback.
   */
  adaptPerceptionForModel(
    rawPerception: Perception,
    modelId: string,
    capabilities: ModelCapabilities,
    contextWindow?: number,
  ): PerceptionOutput {
    return routePerception({
      rawPerception,
      modelId,
      capabilities,
      adapter: this.perceptionAdapter,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
    });
  }

  /** Expose the adapter for callers that need to classify models directly. */
  getPerceptionAdapter(): PerceptionAdapter {
    return this.perceptionAdapter;
  }

  /**
   * Generate text-mediated CU prompt for any text model.
   */
  generateTextMediatedPrompt(task: string, screenText: string): string {
    return [
      `You control a computer. Task: ${task}`,
      "",
      `Current screen state:`,
      screenText,
      "",
      `Available actions:`,
      `  click(N) — click element by index number`,
      `  type("text") — type text into focused element`,
      `  scroll("up"|"down"|"left"|"right") — scroll`,
      `  key("combo") — press key combination (e.g., "cmd+c", "enter")`,
      `  open("app") — open an application`,
      `  wait(ms) — wait milliseconds`,
      "",
      `Respond with ONE action as JSON: {"type": "click", "elementIndex": 3}`,
    ].join("\n");
  }

  /**
   * Parse a CU action from model response.
   */
  parseAction(response: string): CUAction | null {
    try {
      const jsonMatch = response.match(/\{[^}]+\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      const type = parsed["type"] as string;

      switch (type) {
        case "click":
          return { type: "click", elementIndex: Number(parsed["elementIndex"]) };
        case "type":
          return { type: "type", text: String(parsed["text"]) };
        case "scroll":
          return {
            type: "scroll",
            direction: parsed["direction"] as "up" | "down" | "left" | "right",
          };
        case "key":
          return { type: "key", combo: String(parsed["combo"]) };
        case "open":
          return { type: "open", app: String(parsed["app"]) };
        case "wait":
          return { type: "wait", ms: Number(parsed["ms"]) };
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  /**
   * Redact sensitive fields from screen text.
   */
  redactSensitive(screenText: string): string {
    if (!this.guardrails.redactPasswords) return screenText;

    return screenText
      .replace(/(password|secret|token|api.?key)\s*[:=]\s*["'][^"']*["']/gi, "$1: [REDACTED]")
      .replace(/type "password".*?\[.*?\]/gi, 'type "password" [REDACTED]');
  }

  getGuardrails(): CUGuardrails {
    return this.guardrails;
  }

  /**
   * Browse a URL using stealth browsing when available.
   *
   * Uses CamoufoxBrowser (anti-detect Firefox fork) when the camoufox
   * Python package is installed. Falls back to standard Playwright/Chromium
   * otherwise. Checks guardrails before navigating.
   *
   * ── T10.4 — Agentic delegation ───────────────────────────────────
   * When `options.agentic === true`, this method delegates to the
   * agentic-browser orchestrator in `../browser/agentic-browser.ts`
   * (dynamic import avoids a hard circular dep with perception →
   * browser → perception). The orchestrator runs the four P0 security
   * gates (URL guard → hidden-text → prompt-injection quarantine →
   * trifecta-guard) and returns a `BrowseSession`. Callers choose at
   * call time; the default stealth path stays unchanged for callers
   * that don't pass `agentic`.
   */
  async browseUrl(
    url: string,
    options?: { readonly agentic?: boolean; readonly agenticTask?: string },
  ): Promise<{
    readonly page: PageResult;
    readonly text: TextResult | null;
    readonly stealth: boolean;
    readonly agenticSession?: unknown;
  }> {
    // Check guardrails
    if (this.isBlockedDomain(url)) {
      return {
        page: { url, title: "", success: false, error: `Blocked domain: ${url}` },
        text: null,
        stealth: false,
      };
    }

    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      return {
        page: { url, title: "", success: false, error: "Rate limit exceeded" },
        text: null,
        stealth: false,
      };
    }

    this.recordAction();

    // Agentic path — dynamic import keeps the stealth path free of
    // the orchestrator's large dep graph and avoids a circular import.
    //
    // V9 T10.1 honesty fix (2026-04-24 audit): the previous shape
    // returned `{ready: true, task}` if `runAgenticBrowse` was a
    // function, falsely implying the agent had RUN. It hadn't — the
    // computer-agent layer cannot construct the full BrowseOrchestratorOptions
    // (planner LLM, security guards, browser driver) without explicit
    // dependency injection. Per QB #6, surface the stub honestly:
    // requested=true says "the user asked for agentic" but agenticReady
    // = false says "we did NOT actually run a session". Callers that
    // need real agentic browse construct BrowseOrchestratorOptions
    // themselves and call `runAgenticBrowse(task, options)` directly.
    if (options?.agentic === true) {
      const mod = (await import("../browser/agentic-browser.js")) as {
        runAgenticBrowse?: unknown;
      };
      const orchestratorPresent = typeof mod.runAgenticBrowse === "function";
      return {
        page: { url, title: "", success: true },
        text: null,
        stealth: false,
        agenticSession: {
          requested: true,
          orchestratorPresent,
          ran: false,
          task: options.agenticTask ?? url,
          reason:
            "computer-agent does not construct BrowseOrchestratorOptions; " +
            "call runAgenticBrowse from src/browser/agentic-browser.ts directly with a full options object.",
        },
      };
    }

    const useStealth = isCamoufoxAvailable();
    const browser = new CamoufoxBrowser({ headless: true, humanize: useStealth });

    const launched = await browser.launch();
    if (!launched) {
      return {
        page: { url, title: "", success: false, error: "Failed to launch browser" },
        text: null,
        stealth: useStealth,
      };
    }

    try {
      const page = await browser.newPage(url);
      let text: TextResult | null = null;
      if (page.success) {
        text = await browser.getText();
      }
      return { page, text, stealth: useStealth };
    } finally {
      await browser.close();
    }
  }

  /**
   * End-to-end task dispatch — the high-level entry point that wires
   * `routePerception()` before the model sees the task.
   *
   * Layer 1 (api-route): match the task against the route table; if a
   * fast-path exists, return the handler ID without a model round-trip.
   * Layer 2-4 (text-mediated): perceive the screen, route through
   * `adaptPerceptionForModel` (which delegates to the previously-dead
   * `routePerception` hook) and build a text-mediated prompt for any
   * provider tier (frontier-vision / small-vision / text-only).
   *
   * Returns `{rateLimited: true, …}` when guardrails block dispatch.
   * The `routePerception` hook call-site is load-bearing — this is the
   * wire-up that makes Desktop Control work on every provider tier
   * instead of being pinned to the `toText()` fallback.
   */
  async dispatch(
    task: string,
    capabilities: ModelCapabilities & { readonly modelId?: string } = {},
  ): Promise<{
    readonly mode: "api-route" | "text-mediated";
    readonly adaptedPerception: PerceptionOutput | null;
    readonly apiRoute: APIRoute | null;
    readonly prompt: string | null;
    readonly rateLimited: boolean;
  }> {
    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      return {
        mode: "text-mediated",
        adaptedPerception: null,
        apiRoute: null,
        prompt: null,
        rateLimited: true,
      };
    }

    // Layer 1: API fast-path
    const apiRoute = this.findAPIRoute(task);
    if (apiRoute) {
      this.recordAction();
      return {
        mode: "api-route",
        adaptedPerception: null,
        apiRoute,
        prompt: null,
        rateLimited: false,
      };
    }

    // Layers 2-4: perceive → routePerception (PerceptionAdapter) →
    // text-mediated prompt. This is the Wave 3G wire-up that calls
    // routePerception before the model sees anything.
    const perception: Perception = await this.perception.perceive();
    const adapted: PerceptionOutput = this.adaptPerceptionForModel(
      perception,
      capabilities.modelId ?? "",
      capabilities,
      capabilities.contextWindow,
    );

    const screenText = this.redactSensitive(
      adapted.textDescription ?? this.perception.toText(perception),
    );
    const prompt = this.generateTextMediatedPrompt(task, screenText);
    this.recordAction();

    return {
      mode: "text-mediated",
      adaptedPerception: adapted,
      apiRoute: null,
      prompt,
      rateLimited: false,
    };
  }

  // Reference routePerception so bundlers/linters can see the import
  // actually feeds the dispatch chain (adaptPerceptionForModel above is
  // what calls it — this reference keeps the import from being
  // erroneously flagged as unused during tree-shaking analysis).
  static readonly _routePerceptionRef: typeof routePerception = routePerception;
}
