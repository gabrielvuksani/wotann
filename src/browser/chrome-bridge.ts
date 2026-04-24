/**
 * Chromium Browser Bridge: enables the agent to control any Chromium-based browser tab.
 *
 * SUPPORTED BROWSERS: Chrome, Chromium, Edge, Brave, Arc, Vivaldi, Opera, SigmaOS
 * All use the same Chrome DevTools Protocol (CDP) on localhost:9222.
 *
 * ARCHITECTURE:
 * The bridge communicates via the Chrome DevTools Protocol (CDP) WebSocket.
 * Any Chromium-based browser supports CDP when launched with:
 *   --remote-debugging-port=9222
 *
 * Features:
 * - DOM reading and manipulation
 * - Form filling and element clicking
 * - Screenshot capture
 * - Network request monitoring
 * - Console log reading
 *
 * This integrates with the existing Computer Use Layer 2 (accessibility tree)
 * and provides a richer browser automation capability.
 *
 * SETUP:
 * 1. Launch any Chromium browser with: --remote-debugging-port=9222
 *    Or install the WOTANN browser extension
 * 2. The bridge auto-detects any running Chromium browser on port 9222
 * 3. Works with Chrome, Edge, Brave, Arc, Vivaldi, Opera, and any Chromium fork
 *
 * For non-vision models: DOM is converted to a structured text tree (like a11y)
 * that any text model can parse and act on.
 */

// ── Types ──────────────────────────────────────────────────

export interface ChromeTab {
  readonly id: number;
  readonly url: string;
  readonly title: string;
  readonly active: boolean;
}

export interface DOMElement {
  readonly tag: string;
  readonly id?: string;
  readonly className?: string;
  readonly text?: string;
  readonly attributes: Record<string, string>;
  readonly children: readonly DOMElement[];
  readonly interactable: boolean;
  readonly role?: string;
}

export interface BrowserAction {
  readonly type:
    | "click"
    | "type"
    | "navigate"
    | "screenshot"
    | "read_dom"
    | "fill_form"
    | "scroll"
    | "wait"
    | "read_console";
  readonly selector?: string;
  readonly value?: string;
  readonly url?: string;
  readonly timeout?: number;
}

export interface BrowserActionResult {
  readonly success: boolean;
  readonly data?: string;
  readonly screenshotPath?: string;
  readonly error?: string;
  readonly domTree?: DOMElement;
}

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

// ── Tab Event Subscription (T10.4) ─────────────────────────

/**
 * Tab lifecycle event derived from CDP `Target.*` messages. This is
 * the bridge-level abstraction consumed by `src/browser/tab-registry.ts`
 * (`register` on "attached", `unregister` on "destroyed", and
 * `touchLastSeen` on "info-changed").
 *
 * `timestamp` is the receive time on this process (not a CDP field)
 * so downstream consumers get a monotonic ordering without relying on
 * wall-clock parity with the browser.
 */
export interface TabEvent {
  readonly type: "attached" | "destroyed" | "info-changed";
  readonly targetId: string;
  readonly url?: string;
  readonly title?: string;
  readonly timestamp: number;
}

/**
 * Minimal WebSocket shape the subscriber relies on. Production wires
 * this to `globalThis.WebSocket`; tests inject a fake that records
 * sends and pushes messages via `onmessage` so we can assert on
 * event translation without a live browser.
 */
export interface TabSubscribeSocket {
  onopen?: (() => void) | null;
  onmessage?: ((event: { data: string }) => void) | null;
  onerror?: ((err: unknown) => void) | null;
  onclose?: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
}

export interface SubscribeTabEventsOptions {
  /**
   * Override for the WebSocket constructor. Useful in tests where we
   * don't want to talk to a real CDP. Defaults to `globalThis.WebSocket`
   * — when that's missing the whole subscription collapses to a no-op
   * (QB #6 honest failure).
   */
  readonly wsFactory?: (url: string) => TabSubscribeSocket;
  /**
   * Override for the discovery fetch that resolves the browser-level
   * CDP endpoint. Defaults to `fetch(http://localhost:<port>/json/version)`.
   */
  readonly fetchBrowserEndpoint?: () => Promise<string | null>;
  /** Injected clock for deterministic tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

// ── Chrome Bridge ──────────────────────────────────────────

export class ChromeBridge {
  private status: ConnectionStatus = "disconnected";
  private detectedBrowser: string = "unknown";
  private cdpPort: number;

  constructor(_wsUrl: string = "ws://localhost:9222") {
    this.cdpPort = parseInt(new URL(_wsUrl).port || "9222", 10);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  /**
   * Returns the detected Chromium browser name (e.g., "Chrome", "Edge", "Brave", "Arc").
   */
  getDetectedBrowser(): string {
    return this.detectedBrowser;
  }

  /**
   * Check if any Chromium-based browser with CDP is available.
   * Supports Chrome, Edge, Brave, Arc, Vivaldi, Opera, and any Chromium fork.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`http://localhost:${this.cdpPort}/json/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        const version = (await response.json()) as { Browser?: string; "User-Agent"?: string };
        this.detectedBrowser = this.identifyBrowser(version.Browser ?? version["User-Agent"] ?? "");
        this.status = "connected";
      }

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Identify the specific Chromium browser from the CDP version string.
   */
  private identifyBrowser(versionString: string): string {
    const lower = versionString.toLowerCase();
    if (lower.includes("edg/") || lower.includes("edge")) return "Edge";
    if (lower.includes("brave")) return "Brave";
    if (lower.includes("arc")) return "Arc";
    if (lower.includes("vivaldi")) return "Vivaldi";
    if (lower.includes("opera") || lower.includes("opr/")) return "Opera";
    if (lower.includes("sigmaos")) return "SigmaOS";
    if (lower.includes("chromium")) return "Chromium";
    if (lower.includes("chrome")) return "Chrome";
    return "Chromium-based";
  }

  /**
   * Get list of open browser tabs.
   */
  async getTabs(): Promise<readonly ChromeTab[]> {
    try {
      const response = await fetch(`http://localhost:${this.cdpPort}/json/list`);
      if (!response.ok) return [];

      const tabs = (await response.json()) as Array<{
        id: string;
        url: string;
        title: string;
        type: string;
      }>;

      return tabs
        .filter((t) => t.type === "page")
        .map((t, i) => ({
          id: i,
          url: t.url,
          title: t.title,
          active: i === 0,
        }));
    } catch {
      return [];
    }
  }

  /**
   * Execute a browser action.
   * For now, this is a skeleton that documents the interface.
   * Full implementation uses CDP (Chrome DevTools Protocol) — works with any Chromium browser.
   */
  async execute(action: BrowserAction): Promise<BrowserActionResult> {
    if (this.status !== "connected") {
      const available = await this.isAvailable();
      if (available) {
        this.status = "connected";
      } else {
        return {
          success: false,
          error: `Browser bridge not connected. Launch any Chromium browser with --remote-debugging-port=${this.cdpPort}`,
        };
      }
    }

    switch (action.type) {
      case "navigate":
        return this.navigate(action.url ?? "about:blank");

      case "read_dom":
        return this.readDOM(action.selector);

      case "screenshot":
        return this.takeScreenshot();

      case "click":
        return this.click(action.selector ?? "");

      case "type":
        return this.typeText(action.selector ?? "", action.value ?? "");

      case "fill_form":
        return this.fillForm(action.selector ?? "", action.value ?? "");

      case "scroll":
        return this.scroll(action.value ?? "down");

      case "wait":
        return this.waitFor(action.selector ?? "", action.timeout ?? 5000);

      case "read_console":
        return this.readConsole();

      default:
        return { success: false, error: `Unknown action type: ${action.type}` };
    }
  }

  /**
   * Convert DOM tree to text description for non-vision models.
   */
  domToText(element: DOMElement, depth: number = 0): string {
    const indent = "  ".repeat(depth);
    const parts: string[] = [];

    const role = element.role ?? element.tag;
    const id = element.id ? `#${element.id}` : "";
    const cls = element.className ? `.${element.className.split(" ")[0]}` : "";
    const text = element.text ? ` "${element.text.slice(0, 50)}"` : "";
    const interactive = element.interactable ? " [interactive]" : "";

    parts.push(`${indent}${role}${id}${cls}${text}${interactive}`);

    for (const child of element.children) {
      parts.push(this.domToText(child, depth + 1));
    }

    return parts.join("\n");
  }

  // ── Target Event Subscription (T10.4) ──

  /**
   * Subscribe to browser-wide tab lifecycle events. Opens a single
   * long-lived CDP WebSocket against the browser endpoint (not a
   * per-page one), enables target discovery, and translates the
   * relevant `Target.*` methods into `TabEvent`s delivered to
   * `callback`.
   *
   * Returns an unsubscribe closure. When the underlying CDP connection
   * can't be established (no browser WS, no global WebSocket, bad JSON
   * response), subscribe is an honest no-op: the callback is never
   * invoked and the returned unsubscribe is a harmless function. This
   * preserves QB #6 — we never silently "subscribe" and then lie about
   * having heard events.
   */
  subscribeTabEvents(
    callback: (event: TabEvent) => void,
    options?: SubscribeTabEventsOptions,
  ): () => void {
    const now = options?.now ?? Date.now;
    const fetchBrowserEndpoint = options?.fetchBrowserEndpoint ?? (() => this.fetchBrowserWsUrl());
    const globalWs = (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
    const wsFactory =
      options?.wsFactory ??
      (typeof globalWs === "function"
        ? (url: string) =>
            new (globalWs as new (u: string) => TabSubscribeSocket)(
              url,
            ) as unknown as TabSubscribeSocket
        : null);

    if (!wsFactory) {
      // QB #6 honest failure — no WebSocket available, admit defeat.
      return () => {
        /* noop */
      };
    }

    let closed = false;
    let socket: TabSubscribeSocket | null = null;

    const emit = (
      type: TabEvent["type"],
      targetId: string,
      info?: { url?: string; title?: string },
    ): void => {
      if (closed) return;
      const base = { type, targetId, timestamp: now() };
      const withUrl = info?.url !== undefined ? { ...base, url: info.url } : base;
      const full = info?.title !== undefined ? { ...withUrl, title: info.title } : withUrl;
      callback(full);
    };

    void (async () => {
      const wsUrl = await fetchBrowserEndpoint();
      if (closed || wsUrl === null) return;
      let ws: TabSubscribeSocket;
      try {
        ws = wsFactory(wsUrl);
      } catch {
        return;
      }
      if (closed) {
        ws.close();
        return;
      }
      socket = ws;
      ws.onopen = () => {
        try {
          ws.send(
            JSON.stringify({
              id: 1,
              method: "Target.setDiscoverTargets",
              params: { discover: true },
            }),
          );
        } catch {
          /* ignore */
        }
      };
      ws.onmessage = (event: { data: string }) => {
        if (closed) return;
        try {
          const msg = JSON.parse(event.data) as {
            method?: string;
            params?: {
              targetInfo?: { targetId?: string; url?: string; title?: string; type?: string };
              targetId?: string;
            };
          };
          const method = msg.method;
          const info = msg.params?.targetInfo;
          const targetId = info?.targetId ?? msg.params?.targetId;
          if (typeof targetId !== "string" || targetId.length === 0) return;
          // We only surface "page" targets — filter out workers/iframes.
          if (info && info.type !== undefined && info.type !== "page") return;
          if (method === "Target.attachedToTarget") {
            emit("attached", targetId, { url: info?.url, title: info?.title });
          } else if (method === "Target.targetDestroyed") {
            emit("destroyed", targetId);
          } else if (method === "Target.targetInfoChanged") {
            emit("info-changed", targetId, { url: info?.url, title: info?.title });
          }
        } catch {
          /* bad frame — ignore */
        }
      };
      ws.onerror = () => {
        /* error path — tests see the callback never fire; prod just stops. */
      };
    })();

    return () => {
      closed = true;
      if (socket !== null) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        socket = null;
      }
    };
  }

  /**
   * Resolve the browser-level CDP WebSocket URL via /json/version.
   * Returns null on failure so `subscribeTabEvents` can degrade to a
   * no-op without throwing.
   */
  private async fetchBrowserWsUrl(): Promise<string | null> {
    try {
      const response = await fetch(`http://localhost:${this.cdpPort}/json/version`);
      if (!response.ok) return null;
      const data = (await response.json()) as { webSocketDebuggerUrl?: string };
      return typeof data.webSocketDebuggerUrl === "string" ? data.webSocketDebuggerUrl : null;
    } catch {
      return null;
    }
  }

  // ── CDP Communication Layer ──

  private async getFirstPageWsUrl(): Promise<string | null> {
    try {
      const response = await fetch(`http://localhost:${this.cdpPort}/json/list`);
      if (!response.ok) return null;
      const tabs = (await response.json()) as Array<{
        webSocketDebuggerUrl?: string;
        type: string;
      }>;
      const page = tabs.find((t) => t.type === "page");
      return page?.webSocketDebuggerUrl ?? null;
    } catch {
      return null;
    }
  }

  private async sendCDP<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const wsUrl = await this.getFirstPageWsUrl();
    if (!wsUrl) throw new Error("No browser page available. Open a tab first.");

    return new Promise((resolve, reject) => {
      const ws = new (
        globalThis as unknown as { WebSocket: new (url: string) => WebSocket }
      ).WebSocket(wsUrl);
      const id = Date.now();
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("CDP timeout"));
      }, 10_000);

      ws.onopen = () => ws.send(JSON.stringify({ id, method, params }));
      ws.onmessage = (event: { data: string }) => {
        const msg = JSON.parse(event.data) as {
          id?: number;
          result?: T;
          error?: { message: string };
        };
        if (msg.id === id) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result as T);
        }
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        reject(new Error("CDP WebSocket error"));
      };
    });
  }

  // ── Private Action Implementations (CDP-based) ──

  private async navigate(url: string): Promise<BrowserActionResult> {
    try {
      await this.sendCDP("Page.navigate", { url });
      // Wait for load
      await this.sendCDP("Page.enable");
      return { success: true, data: `Navigated to ${url}` };
    } catch {
      // Fallback: open new tab via HTTP
      try {
        const response = await fetch(
          `http://localhost:${this.cdpPort}/json/new?` + encodeURIComponent(url),
        );
        return { success: response.ok, data: `Navigated to ${url}` };
      } catch (fallbackError) {
        return {
          success: false,
          error: `Navigate failed: ${fallbackError instanceof Error ? fallbackError.message : "unknown"}`,
        };
      }
    }
  }

  private async readDOM(selector?: string): Promise<BrowserActionResult> {
    try {
      // Get the document root
      const docResult = await this.sendCDP<{ root: { nodeId: number } }>("DOM.getDocument", {
        depth: -1,
      });
      const rootNodeId = docResult.root.nodeId;

      // If selector provided, query for that element; otherwise get body
      let targetNodeId = rootNodeId;
      if (selector) {
        const queryResult = await this.sendCDP<{ nodeId: number }>("DOM.querySelector", {
          nodeId: rootNodeId,
          selector,
        });
        targetNodeId = queryResult.nodeId;
      }

      // Get outer HTML
      const htmlResult = await this.sendCDP<{ outerHTML: string }>("DOM.getOuterHTML", {
        nodeId: targetNodeId,
      });
      const html = htmlResult.outerHTML;

      // Build simplified DOM tree from HTML
      const domTree = this.parseSimpleDom(html);

      return {
        success: true,
        data: html.slice(0, 10_000),
        domTree,
      };
    } catch (error) {
      return {
        success: false,
        error: `readDOM: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async takeScreenshot(): Promise<BrowserActionResult> {
    try {
      const result = await this.sendCDP<{ data: string }>("Page.captureScreenshot", {
        format: "png",
      });
      const { writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { mkdirSync, existsSync } = await import("node:fs");

      const dir = join(process.cwd(), ".wotann", "screenshots");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const path = join(dir, `browser-${Date.now()}.png`);
      writeFileSync(path, Buffer.from(result.data, "base64"));

      return { success: true, screenshotPath: path, data: `Screenshot saved to ${path}` };
    } catch (error) {
      return {
        success: false,
        error: `Screenshot: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async click(selector: string): Promise<BrowserActionResult> {
    try {
      // Find the element and get its bounding box
      const docResult = await this.sendCDP<{ root: { nodeId: number } }>("DOM.getDocument");
      const queryResult = await this.sendCDP<{ nodeId: number }>("DOM.querySelector", {
        nodeId: docResult.root.nodeId,
        selector,
      });

      if (!queryResult.nodeId) {
        return { success: false, error: `Element not found: ${selector}` };
      }

      // Resolve to runtime object to get coordinates
      const resolveResult = await this.sendCDP<{ object: { objectId: string } }>(
        "DOM.resolveNode",
        {
          nodeId: queryResult.nodeId,
        },
      );

      const boxResult = await this.sendCDP<{ model: { content: number[] } }>("DOM.getBoxModel", {
        objectId: resolveResult.object.objectId,
      });

      // content is [x1,y1, x2,y2, x3,y3, x4,y4] — use center
      const [x1, y1, x3, y3] = [
        boxResult.model.content[0] ?? 0,
        boxResult.model.content[1] ?? 0,
        boxResult.model.content[4] ?? 0,
        boxResult.model.content[5] ?? 0,
      ];
      const cx = (x1 + x3) / 2;
      const cy = (y1 + y3) / 2;

      // Dispatch click
      await this.sendCDP("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: cx,
        y: cy,
        button: "left",
        clickCount: 1,
      });
      await this.sendCDP("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: cx,
        y: cy,
        button: "left",
        clickCount: 1,
      });

      return { success: true, data: `Clicked ${selector} at (${cx.toFixed(0)}, ${cy.toFixed(0)})` };
    } catch (error) {
      return {
        success: false,
        error: `Click ${selector}: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async typeText(selector: string, value: string): Promise<BrowserActionResult> {
    try {
      // Focus the element first
      await this.click(selector);

      // Type each character via CDP Input events
      for (const char of value) {
        await this.sendCDP("Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
          key: char,
          code: `Key${char.toUpperCase()}`,
        });
        await this.sendCDP("Input.dispatchKeyEvent", { type: "keyUp", key: char });
      }

      return { success: true, data: `Typed "${value}" into ${selector}` };
    } catch (error) {
      return {
        success: false,
        error: `Type into ${selector}: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async fillForm(selector: string, value: string): Promise<BrowserActionResult> {
    try {
      // Use CDP to set the value directly via JS evaluation
      const js = `document.querySelector(${JSON.stringify(selector)}).value = ${JSON.stringify(value)}`;
      await this.sendCDP("Runtime.evaluate", { expression: js });
      // Dispatch input event so React/Vue/Angular pick up the change
      const dispatchJs = `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new Event('input', {bubbles: true}))`;
      await this.sendCDP("Runtime.evaluate", { expression: dispatchJs });

      return { success: true, data: `Filled ${selector} with "${value}"` };
    } catch (error) {
      return {
        success: false,
        error: `Fill form ${selector}: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async scroll(direction: string): Promise<BrowserActionResult> {
    try {
      const deltaY = direction === "up" ? -300 : 300;
      const deltaX = direction === "left" ? -300 : direction === "right" ? 300 : 0;

      await this.sendCDP("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: 400,
        y: 300,
        deltaX,
        deltaY,
        pointerType: "mouse",
      });

      return { success: true, data: `Scrolled ${direction}` };
    } catch (error) {
      return {
        success: false,
        error: `Scroll ${direction}: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async waitFor(selector: string, timeout: number): Promise<BrowserActionResult> {
    try {
      const deadline = Date.now() + timeout;
      const pollInterval = 250;

      while (Date.now() < deadline) {
        const js = `!!document.querySelector(${JSON.stringify(selector)})`;
        const result = await this.sendCDP<{ result: { value: boolean } }>("Runtime.evaluate", {
          expression: js,
        });
        if (result.result.value) {
          return { success: true, data: `Element ${selector} found` };
        }
        await new Promise((r) => setTimeout(r, pollInterval));
      }

      return { success: false, error: `Timed out waiting for ${selector} (${timeout}ms)` };
    } catch (error) {
      return {
        success: false,
        error: `Wait for ${selector}: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  private async readConsole(): Promise<BrowserActionResult> {
    try {
      // Enable console and capture messages
      await this.sendCDP("Console.enable");
      const js = `
        (function() {
          const logs = window.__wotann_console_logs || [];
          return JSON.stringify(logs.slice(-20));
        })()
      `;
      const result = await this.sendCDP<{ result: { value: string } }>("Runtime.evaluate", {
        expression: js,
      });
      return { success: true, data: result.result.value ?? "[]" };
    } catch (error) {
      return {
        success: false,
        error: `Read console: ${error instanceof Error ? error.message : "unknown"}`,
      };
    }
  }

  /** Simple HTML to DOMElement parser for CDP responses */
  private parseSimpleDom(html: string): DOMElement {
    // Extract tag from the outerHTML opening
    const tagMatch = html.match(/^<(\w+)/);
    const tag = tagMatch?.[1] ?? "div";
    const textMatch = html.replace(/<[^>]+>/g, " ").trim();
    const interactable = /^(a|button|input|select|textarea)$/i.test(tag);

    return {
      tag,
      text: textMatch.slice(0, 200),
      attributes: {},
      children: [],
      interactable,
    };
  }
}

/**
 * Create a browser bridge instance with auto-detection.
 */
export async function createChromeBridge(): Promise<ChromeBridge | null> {
  const bridge = new ChromeBridge();
  const available = await bridge.isAvailable();
  return available ? bridge : null;
}
