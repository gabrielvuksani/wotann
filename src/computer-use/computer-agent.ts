/**
 * Computer use agent: 4-layer hybrid strategy.
 * Layer 1: API/CLI first → Layer 2: a11y tree → Layer 3: vision-native → Layer 4: text-mediated
 */

import { PerceptionEngine } from "./perception-engine.js";
import type { CUAction, APIRoute, CUGuardrails } from "./types.js";
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
  private readonly apiRoutes: readonly APIRoute[];
  private readonly guardrails: CUGuardrails;
  private actionCount: number = 0;
  private lastMinuteReset: number = Date.now();

  constructor(options?: {
    perception?: PerceptionEngine;
    apiRoutes?: readonly APIRoute[];
    guardrails?: Partial<CUGuardrails>;
  }) {
    this.perception = options?.perception ?? new PerceptionEngine();
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
   */
  browseUrl(url: string): { page: PageResult; text: TextResult | null; stealth: boolean } {
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

    const useStealth = isCamoufoxAvailable();
    const browser = new CamoufoxBrowser({ headless: true, humanize: useStealth });

    const launched = browser.launch();
    if (!launched) {
      return {
        page: { url, title: "", success: false, error: "Failed to launch browser" },
        text: null,
        stealth: useStealth,
      };
    }

    const page = browser.newPage(url);
    let text: TextResult | null = null;
    if (page.success) {
      text = browser.getText();
    }

    browser.close();

    return { page, text, stealth: useStealth };
  }
}
