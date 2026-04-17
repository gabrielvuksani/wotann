/**
 * Platform-specific desktop automation bindings.
 *
 * 4-layer hybrid strategy (§23):
 * 1. API/CLI first — fastest, most reliable
 * 2. Accessibility tree — structured element access
 * 3. Vision-native — screenshot + coordinate detection
 * 4. Text-mediated — screenshot → OCR → text, ANY model controls
 *
 * macOS: cliclick (mouse/keyboard), screencapture, AppleScript, AXUIElement
 * Linux: xdotool (mouse/keyboard), maim (screenshots), AT-SPI2 (a11y)
 *
 * The desktop API route table maps common tasks to the fastest available method.
 */

import { execFileSync } from "node:child_process";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";

import { CamoufoxBrowser } from "../browser/camoufox-backend.js";
import type { PageResult } from "../browser/camoufox-backend.js";
import { convertToUTF8 } from "../tools/encoding-detector.js";

export type PlatformType = "darwin" | "linux" | "win32" | "unknown";

export interface ScreenshotResult {
  readonly path: string;
  readonly width: number;
  readonly height: number;
  readonly format: "png" | "jpg";
}

export interface ClickOptions {
  readonly x: number;
  readonly y: number;
  readonly button?: "left" | "right" | "middle";
  readonly clicks?: number;
}

export interface TypeOptions {
  readonly text: string;
  readonly delay?: number;
}

export interface KeyOptions {
  readonly key: string;
  readonly modifiers?: readonly ("ctrl" | "alt" | "shift" | "cmd" | "super")[];
}

export interface WindowInfo {
  readonly title: string;
  readonly pid: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ── Platform Detection ───────────────────────────────────

export function detectPlatform(): PlatformType {
  const p = platform();
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "unknown";
}

function isAvailable(cmd: string): boolean {
  try {
    execFileSync("which", [cmd], { stdio: "pipe", timeout: 3000 });
    return true;
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
}

export function detectAvailableTools(): readonly string[] {
  const tools: string[] = [];
  const os = detectPlatform();

  if (os === "darwin") {
    if (isAvailable("cliclick")) tools.push("cliclick");
    if (isAvailable("screencapture")) tools.push("screencapture");
    tools.push("osascript"); // Always available on macOS
  } else if (os === "linux") {
    if (isAvailable("xdotool")) tools.push("xdotool");
    if (isAvailable("maim")) tools.push("maim");
    if (isAvailable("xclip")) tools.push("xclip");
    if (isAvailable("xprop")) tools.push("xprop");
  }

  return tools;
}

// ── Screenshots ──────────────────────────────────────────

export function takeScreenshot(outputPath?: string): ScreenshotResult | null {
  const os = detectPlatform();
  const path = outputPath ?? join(tmpdir(), `wotann-screenshot-${Date.now()}.png`);

  try {
    if (os === "darwin") {
      execFileSync("screencapture", ["-x", "-C", path], { stdio: "pipe", timeout: 5000 });
      return { path, width: 0, height: 0, format: "png" };
    }

    if (os === "linux" && isAvailable("maim")) {
      execFileSync("maim", [path], { stdio: "pipe", timeout: 5000 });
      return { path, width: 0, height: 0, format: "png" };
    }

    if (os === "linux" && isAvailable("scrot")) {
      execFileSync("scrot", [path], { stdio: "pipe", timeout: 5000 });
      return { path, width: 0, height: 0, format: "png" };
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return null;
  }

  return null;
}

// ── Mouse Control ────────────────────────────────────────

export function click(options: ClickOptions): boolean {
  const os = detectPlatform();
  const { x, y, button, clicks } = options;

  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      const clickType = button === "right" ? "rc" : clicks === 2 ? "dc" : "c";
      execFileSync("cliclick", [`${clickType}:${x},${y}`], { stdio: "pipe", timeout: 3000 });
      return true;
    }

    if (os === "linux" && isAvailable("xdotool")) {
      const btn = button === "right" ? "3" : button === "middle" ? "2" : "1";
      execFileSync(
        "xdotool",
        ["mousemove", String(x), String(y), "click", "--repeat", String(clicks ?? 1), btn],
        { stdio: "pipe", timeout: 3000 },
      );
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }

  return false;
}

export function moveMouse(x: number, y: number): boolean {
  const os = detectPlatform();
  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      execFileSync("cliclick", [`m:${x},${y}`], { stdio: "pipe", timeout: 3000 });
      return true;
    }
    if (os === "linux" && isAvailable("xdotool")) {
      execFileSync("xdotool", ["mousemove", String(x), String(y)], {
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
  return false;
}

// ── Extended Mouse Control ───────────────────────────────

export function doubleClick(x: number, y: number): boolean {
  return click({ x, y, clicks: 2 });
}

export function tripleClick(x: number, y: number): boolean {
  return click({ x, y, clicks: 3 });
}

export function mouseDown(x: number, y: number, button: "left" | "right" = "left"): boolean {
  const os = detectPlatform();
  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      // cliclick dd = mouse-down, rd = right mouse-down
      const prefix = button === "right" ? "rd" : "dd";
      execFileSync("cliclick", [`${prefix}:${x},${y}`], { stdio: "pipe", timeout: 3000 });
      return true;
    }
    if (os === "linux" && isAvailable("xdotool")) {
      const btn = button === "right" ? "3" : "1";
      execFileSync("xdotool", ["mousemove", String(x), String(y), "mousedown", btn], {
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
  return false;
}

export function mouseUp(x?: number, y?: number, button: "left" | "right" = "left"): boolean {
  const os = detectPlatform();
  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      const prefix = button === "right" ? "ru" : "du";
      const args = x !== undefined && y !== undefined ? [`${prefix}:${x},${y}`] : [`${prefix}:.`];
      execFileSync("cliclick", args, { stdio: "pipe", timeout: 3000 });
      return true;
    }
    if (os === "linux" && isAvailable("xdotool")) {
      const btn = button === "right" ? "3" : "1";
      if (x !== undefined && y !== undefined) {
        execFileSync("xdotool", ["mousemove", String(x), String(y), "mouseup", btn], {
          stdio: "pipe",
          timeout: 3000,
        });
      } else {
        execFileSync("xdotool", ["mouseup", btn], { stdio: "pipe", timeout: 3000 });
      }
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
  return false;
}

export function drag(startX: number, startY: number, endX: number, endY: number): boolean {
  mouseDown(startX, startY);
  // Small delay to let the OS register the drag
  try {
    execFileSync("sleep", ["0.1"], { stdio: "pipe", timeout: 1000 });
  } catch {
    /* ok */
  }
  moveMouse(endX, endY);
  mouseUp(endX, endY);
  return true;
}

// ── Scroll ──────────────────────────────────────────────

export function scroll(direction: "up" | "down" | "left" | "right", amount: number = 3): boolean {
  const os = detectPlatform();
  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      // cliclick scroll: positive = up, negative = down
      // For horizontal: use AppleScript as cliclick doesn't support horizontal scroll natively
      if (direction === "up" || direction === "down") {
        const scrollAmount = direction === "up" ? amount : -amount;
        execFileSync("cliclick", [`sc:0,${scrollAmount}`], { stdio: "pipe", timeout: 3000 });
      } else {
        const scrollAmount = direction === "right" ? amount : -amount;
        execFileSync("cliclick", [`sc:${scrollAmount},0`], { stdio: "pipe", timeout: 3000 });
      }
      return true;
    }
    if (os === "linux" && isAvailable("xdotool")) {
      // xdotool button 4=up, 5=down, 6=left, 7=right
      const buttonMap: Record<string, string> = { up: "4", down: "5", left: "6", right: "7" };
      const btn = buttonMap[direction] ?? "5";
      execFileSync("xdotool", ["click", "--repeat", String(amount), btn], {
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
  return false;
}

// ── Keyboard Control ─────────────────────────────────────

export function typeText(options: TypeOptions): boolean {
  const os = detectPlatform();

  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      execFileSync("cliclick", [`t:${options.text}`], { stdio: "pipe", timeout: 5000 });
      return true;
    }

    if (os === "linux" && isAvailable("xdotool")) {
      const args = ["type"];
      if (options.delay) args.push("--delay", String(options.delay));
      args.push(options.text);
      execFileSync("xdotool", args, { stdio: "pipe", timeout: 10000 });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }

  return false;
}

export function pressKey(options: KeyOptions): boolean {
  const os = detectPlatform();

  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      const modMap: Record<string, string> = {
        ctrl: "ctrl",
        alt: "alt",
        shift: "shift",
        cmd: "cmd",
        super: "cmd",
      };
      const mods = (options.modifiers ?? []).map((m) => modMap[m] ?? m);
      const keySpec = mods.length > 0 ? `${mods.join(",")}:${options.key}` : options.key;
      execFileSync("cliclick", [`kp:${keySpec}`], { stdio: "pipe", timeout: 3000 });
      return true;
    }

    if (os === "linux" && isAvailable("xdotool")) {
      const modMap: Record<string, string> = {
        ctrl: "ctrl",
        alt: "alt",
        shift: "shift",
        cmd: "super",
        super: "super",
      };
      const mods = (options.modifiers ?? []).map((m) => modMap[m] ?? m).join("+");
      const keyCombo = mods ? `${mods}+${options.key}` : options.key;
      execFileSync("xdotool", ["key", keyCombo], { stdio: "pipe", timeout: 3000 });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }

  return false;
}

export function holdKey(key: string, durationMs: number): boolean {
  const os = detectPlatform();
  try {
    if (os === "darwin" && isAvailable("cliclick")) {
      execFileSync("cliclick", [`kd:${key}`], { stdio: "pipe", timeout: 3000 });
      const sleepSec = Math.max(0.05, durationMs / 1000);
      execFileSync("sleep", [String(sleepSec)], { stdio: "pipe", timeout: durationMs + 2000 });
      execFileSync("cliclick", [`ku:${key}`], { stdio: "pipe", timeout: 3000 });
      return true;
    }
    if (os === "linux" && isAvailable("xdotool")) {
      execFileSync("xdotool", ["keydown", key], { stdio: "pipe", timeout: 3000 });
      execFileSync("sleep", [String(durationMs / 1000)], {
        stdio: "pipe",
        timeout: durationMs + 2000,
      });
      execFileSync("xdotool", ["keyup", key], { stdio: "pipe", timeout: 3000 });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
  return false;
}

// ── AppleScript (macOS only) ─────────────────────────────

export function runAppleScript(script: string): string | null {
  if (detectPlatform() !== "darwin") return null;
  try {
    return execFileSync("osascript", ["-e", script], {
      stdio: "pipe",
      timeout: 10000,
      encoding: "utf-8",
    }).trim();
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return null;
  }
}

export function getActiveWindowTitle(): string | null {
  const os = detectPlatform();
  if (os === "darwin") {
    return runAppleScript(
      'tell application "System Events" to get name of first process whose frontmost is true',
    );
  }
  if (os === "linux" && isAvailable("xdotool")) {
    try {
      return execFileSync("xdotool", ["getactivewindow", "getwindowname"], {
        stdio: "pipe",
        timeout: 3000,
        encoding: "utf-8",
      }).trim();
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return null;
    }
  }
  return null;
}

// ── Window Management ───────────────────────────────────

export function closeWindow(): boolean {
  const os = detectPlatform();
  if (os === "darwin") {
    try {
      execFileSync(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "w" using command down'],
        { stdio: "pipe", timeout: 3000 },
      );
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  if (os === "linux" && isAvailable("xdotool")) {
    try {
      execFileSync("xdotool", ["key", "ctrl+w"], { stdio: "pipe", timeout: 3000 });
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  return false;
}

export function minimizeWindow(): boolean {
  const os = detectPlatform();
  if (os === "darwin") {
    try {
      execFileSync(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "m" using command down'],
        { stdio: "pipe", timeout: 3000 },
      );
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  if (os === "linux" && isAvailable("xdotool")) {
    try {
      execFileSync("xdotool", ["getactivewindow", "windowminimize"], {
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  return false;
}

export function maximizeWindow(): boolean {
  const os = detectPlatform();
  if (os === "darwin") {
    try {
      execFileSync(
        "osascript",
        [
          "-e",
          'tell application "System Events" to tell (first process whose frontmost is true) to set value of attribute "AXFullScreen" of window 1 to true',
        ],
        { stdio: "pipe", timeout: 3000 },
      );
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  if (os === "linux" && isAvailable("xdotool")) {
    try {
      execFileSync("xdotool", ["getactivewindow", "windowsize", "100%", "100%"], {
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  return false;
}

export function switchWindow(app?: string, title?: string): boolean {
  const os = detectPlatform();
  if (os === "darwin" && app) {
    try {
      execFileSync("osascript", ["-e", `tell application "${app}" to activate`], {
        stdio: "pipe",
        timeout: 3000,
      });
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  if (os === "linux" && isAvailable("xdotool")) {
    try {
      if (title) {
        execFileSync("xdotool", ["search", "--name", title, "windowactivate"], {
          stdio: "pipe",
          timeout: 3000,
        });
      } else if (app) {
        execFileSync("xdotool", ["search", "--class", app, "windowactivate"], {
          stdio: "pipe",
          timeout: 3000,
        });
      }
      return true;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return false;
    }
  }
  return false;
}

// ── Clipboard Actions ───────────────────────────────────

export function clipboardCopy(): boolean {
  const os = detectPlatform();
  try {
    if (os === "darwin") {
      execFileSync(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "c" using command down'],
        { stdio: "pipe", timeout: 3000 },
      );
      return true;
    }
    if (os === "linux" && isAvailable("xdotool")) {
      execFileSync("xdotool", ["key", "ctrl+c"], { stdio: "pipe", timeout: 3000 });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
  return false;
}

export function clipboardPaste(): boolean {
  const os = detectPlatform();
  try {
    if (os === "darwin") {
      execFileSync(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "v" using command down'],
        { stdio: "pipe", timeout: 3000 },
      );
      return true;
    }
    if (os === "linux" && isAvailable("xdotool")) {
      execFileSync("xdotool", ["key", "ctrl+v"], { stdio: "pipe", timeout: 3000 });
      return true;
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return false;
  }
  return false;
}

// ── Screenshot Zoom (Region Capture) ────────────────────

export function zoomRegion(region: {
  x: number;
  y: number;
  width: number;
  height: number;
}): ScreenshotResult | null {
  const os = detectPlatform();
  const path = join(tmpdir(), `wotann-zoom-${Date.now()}.png`);
  try {
    if (os === "darwin") {
      // Use screencapture with -R flag for region capture
      execFileSync(
        "screencapture",
        ["-x", "-R", `${region.x},${region.y},${region.width},${region.height}`, path],
        { stdio: "pipe", timeout: 5000 },
      );
      return { path, width: region.width, height: region.height, format: "png" };
    }
    if (os === "linux" && isAvailable("maim")) {
      execFileSync(
        "maim",
        ["-g", `${region.width}x${region.height}+${region.x}+${region.y}`, path],
        { stdio: "pipe", timeout: 5000 },
      );
      return { path, width: region.width, height: region.height, format: "png" };
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return null;
  }
  return null;
}

// ── Multi-Display ───────────────────────────────────────

export function getDisplayCount(): number {
  const os = detectPlatform();
  if (os === "darwin") {
    try {
      const result = execFileSync(
        "osascript",
        ["-e", 'tell application "System Events" to count of desktops'],
        { stdio: "pipe", timeout: 3000, encoding: "utf-8" },
      );
      return parseInt(result.trim(), 10) || 1;
    } catch {
      // Best-effort path — caller gets a safe fallback, no user-facing error.
      return 1;
    }
  }
  return 1;
}

export function takeScreenshotOfDisplay(
  displayIndex: number,
  outputPath?: string,
): ScreenshotResult | null {
  const os = detectPlatform();
  const path = outputPath ?? join(tmpdir(), `wotann-display-${displayIndex}-${Date.now()}.png`);
  try {
    if (os === "darwin") {
      execFileSync("screencapture", ["-x", "-D", String(displayIndex + 1), path], {
        stdio: "pipe",
        timeout: 5000,
      });
      return { path, width: 0, height: 0, format: "png" };
    }
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return null;
  }
  return null;
}

// ── Desktop API Route Table ──────────────────────────────
// Fast-path routes for common tasks: maps a high-level action to the
// fastest available method, avoiding screenshot+vision when possible.

export interface DesktopAction {
  readonly action: string;
  readonly params: Record<string, string>;
}

export type RouteResult = { readonly success: boolean; readonly output: string };

type RouteHandler = (params: Record<string, string>) => RouteResult;

const ROUTE_TABLE: ReadonlyMap<string, RouteHandler> = new Map<string, RouteHandler>([
  [
    "open-url",
    (p: Record<string, string>) => {
      const url = p["url"] ?? "";
      try {
        if (detectPlatform() === "darwin") {
          execFileSync("open", [url], { stdio: "pipe", timeout: 5000 });
        } else {
          execFileSync("xdg-open", [url], { stdio: "pipe", timeout: 5000 });
        }
        return { success: true, output: `Opened ${url}` };
      } catch {
        return { success: false, output: "Failed to open URL" };
      }
    },
  ],
  [
    "open-app",
    (p: Record<string, string>) => {
      const app = p["app"] ?? "";
      if (detectPlatform() === "darwin") {
        const result = runAppleScript(`tell application "${app}" to activate`);
        return { success: result !== null, output: result ?? "Failed" };
      }
      return { success: false, output: "Not supported on this platform" };
    },
  ],
  [
    "get-clipboard",
    () => {
      try {
        if (detectPlatform() === "darwin") {
          const text = execFileSync("pbpaste", [], {
            stdio: "pipe",
            timeout: 3000,
            encoding: "utf-8",
          });
          return { success: true, output: text };
        }
        if (isAvailable("xclip")) {
          const text = execFileSync("xclip", ["-selection", "clipboard", "-o"], {
            stdio: "pipe",
            timeout: 3000,
            encoding: "utf-8",
          });
          return { success: true, output: text };
        }
      } catch {
        /* fall through */
      }
      return { success: false, output: "" };
    },
  ],
  [
    "set-clipboard",
    (p: Record<string, string>) => {
      const text = p["text"] ?? "";
      try {
        if (detectPlatform() === "darwin") {
          execFileSync("pbcopy", [], {
            input: text,
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 3000,
          });
          return { success: true, output: "Copied to clipboard" };
        }
        if (isAvailable("xclip")) {
          execFileSync("xclip", ["-selection", "clipboard"], {
            input: text,
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 3000,
          });
          return { success: true, output: "Copied to clipboard" };
        }
      } catch {
        /* fall through */
      }
      return { success: false, output: "Clipboard not available" };
    },
  ],
  [
    "get-active-window",
    () => {
      const title = getActiveWindowTitle();
      return { success: title !== null, output: title ?? "Unknown" };
    },
  ],
  [
    "screenshot",
    (p: Record<string, string>) => {
      const result = takeScreenshot(p["path"]);
      return result
        ? { success: true, output: result.path }
        : { success: false, output: "Screenshot failed" };
    },
  ],
]);

/**
 * Execute a desktop action via the route table.
 * Returns the result, or null if the action is not in the table.
 */
export function executeDesktopAction(action: DesktopAction): RouteResult | null {
  const handler = ROUTE_TABLE.get(action.action);
  if (!handler) return null;
  return handler(action.params);
}

/**
 * List all available desktop actions.
 */
export function listDesktopActions(): readonly string[] {
  return [...ROUTE_TABLE.keys()];
}

// ── Encoding-Aware Web Fetch ─────────────────────────────────

/**
 * Fetch a URL and return UTF-8 text, automatically converting from
 * legacy encodings (Shift_JIS, GB2312, ISO-8859-1, etc.).
 *
 * Uses the encoding-detector module to inspect Content-Type headers
 * and HTML meta charset tags, then converts the raw buffer to UTF-8.
 */
export async function fetchWebContent(
  url: string,
): Promise<{ text: string; encoding: string; converted: boolean } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") ?? undefined;
    const buffer = Buffer.from(await res.arrayBuffer());
    const result = convertToUTF8(buffer, undefined, contentType);

    return {
      text: result.text,
      encoding: result.detectedEncoding,
      converted: result.wasConverted,
    };
  } catch {
    // Best-effort path — caller gets a safe fallback, no user-facing error.
    return null;
  }
}

// ── Stealth Browser ─────────────────────────────────────────

/**
 * Launch a stealth browser and navigate to a URL.
 *
 * Uses CamoufoxBrowser (anti-detect Firefox fork with BrowserForge fingerprints)
 * when the camoufox Python package is available. Falls back to standard
 * Playwright/Chromium otherwise.
 *
 * @param url - The URL to navigate to
 * @returns The page result with title and success status
 */
export function launchStealthBrowser(url: string): PageResult {
  const browser = new CamoufoxBrowser({ headless: true, humanize: true });

  const launched = browser.launch();
  if (!launched) {
    return {
      url,
      title: "",
      success: false,
      error: "Failed to launch stealth browser",
    };
  }

  const result = browser.newPage(url);

  // Close after navigation — each call is a one-shot subprocess
  browser.close();

  return result;
}
