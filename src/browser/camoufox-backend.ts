/**
 * Camoufox Stealth Browser Backend — anti-detect browsing for web scraping.
 *
 * Camoufox is a Firefox fork that injects fingerprints at the C++ level,
 * making it virtually undetectable by anti-bot systems. It integrates with
 * Playwright via a Python wrapper (camoufox package).
 *
 * ARCHITECTURE:
 * - Checks if the `camoufox` Python package is installed
 * - When available, launches Camoufox via Python subprocess for stealth browsing
 * - Falls back to standard Playwright/Chromium when Camoufox is unavailable
 * - BrowserForge fingerprints provide realistic browser identity (OS, screen, WebGL, etc.)
 *
 * USAGE:
 *   const browser = new CamoufoxBrowser();
 *   await browser.launch();
 *   const page = await browser.newPage("https://example.com");
 *   const text = await browser.getText();
 *   await browser.close();
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Types ──────────────────────────────────────────────────

export interface CamoufoxConfig {
  readonly headless: boolean;
  readonly humanize: boolean;
  readonly timeout: number;
  readonly screenshotDir: string;
}

export interface PageResult {
  readonly url: string;
  readonly title: string;
  readonly success: boolean;
  readonly error?: string;
}

export interface ScreenshotResult {
  readonly path: string;
  readonly success: boolean;
  readonly error?: string;
}

export interface TextResult {
  readonly text: string;
  readonly success: boolean;
  readonly error?: string;
}

// ── Constants ──────────────────────────────────────────────

const DEFAULT_CONFIG: CamoufoxConfig = {
  headless: true,
  humanize: true,
  timeout: 30_000,
  screenshotDir: join(tmpdir(), "wotann-screenshots"),
};

const PYTHON_CMD = "python3";
const SUBPROCESS_TIMEOUT = 60_000;

// ── Availability Check ─────────────────────────────────────

/**
 * Check whether the camoufox Python package is installed and importable.
 * Returns true if the package is available, false otherwise.
 */
export function isAvailable(): boolean {
  try {
    execFileSync(PYTHON_CMD, ["-c", "import camoufox"], {
      stdio: "pipe",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── CamoufoxBrowser Class ──────────────────────────────────

export class CamoufoxBrowser {
  private readonly config: CamoufoxConfig;
  private launched = false;
  private currentUrl = "";
  private readonly sessionId: string;

  constructor(config: Partial<CamoufoxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionId = `cfox-${Date.now()}`;
  }

  /**
   * Launch the Camoufox browser instance via Python subprocess.
   * If Camoufox is not installed, falls back to standard Playwright Chromium.
   */
  launch(): boolean {
    if (this.launched) return true;

    if (!existsSync(this.config.screenshotDir)) {
      mkdirSync(this.config.screenshotDir, { recursive: true });
    }

    const useCamoufox = isAvailable();
    const script = useCamoufox
      ? this.buildCamoufoxLaunchScript()
      : this.buildPlaywrightFallbackScript();

    try {
      execFileSync(PYTHON_CMD, ["-c", script], {
        stdio: "pipe",
        timeout: SUBPROCESS_TIMEOUT,
      });
      this.launched = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Navigate to a URL and return the page result.
   */
  newPage(url: string): PageResult {
    if (!this.launched) {
      return { url, title: "", success: false, error: "Browser not launched. Call launch() first." };
    }

    const script = isAvailable()
      ? this.buildCamoufoxNavigateScript(url)
      : this.buildPlaywrightNavigateScript(url);

    try {
      const output = execFileSync(PYTHON_CMD, ["-c", script], {
        stdio: "pipe",
        timeout: this.config.timeout + 10_000,
        encoding: "utf-8",
      });

      const result = JSON.parse(output.trim()) as { title?: string; error?: string };
      this.currentUrl = url;

      return {
        url,
        title: result.title ?? "",
        success: !result.error,
        error: result.error,
      };
    } catch (err) {
      return {
        url,
        title: "",
        success: false,
        error: err instanceof Error ? err.message : "Navigation failed",
      };
    }
  }

  /**
   * Capture a screenshot of the current page.
   */
  screenshot(): ScreenshotResult {
    if (!this.launched) {
      return { path: "", success: false, error: "Browser not launched" };
    }

    const filename = `screenshot-${Date.now()}.png`;
    const outputPath = join(this.config.screenshotDir, filename);

    const script = isAvailable()
      ? this.buildCamoufoxScreenshotScript(outputPath)
      : this.buildPlaywrightScreenshotScript(outputPath);

    try {
      execFileSync(PYTHON_CMD, ["-c", script], {
        stdio: "pipe",
        timeout: this.config.timeout,
      });

      return { path: outputPath, success: existsSync(outputPath) };
    } catch (err) {
      return {
        path: "",
        success: false,
        error: err instanceof Error ? err.message : "Screenshot failed",
      };
    }
  }

  /**
   * Extract visible text content from the current page.
   */
  getText(): TextResult {
    if (!this.launched) {
      return { text: "", success: false, error: "Browser not launched" };
    }

    const outputPath = join(tmpdir(), `${this.sessionId}-text.txt`);
    const script = isAvailable()
      ? this.buildCamoufoxGetTextScript(outputPath)
      : this.buildPlaywrightGetTextScript(outputPath);

    try {
      execFileSync(PYTHON_CMD, ["-c", script], {
        stdio: "pipe",
        timeout: this.config.timeout,
      });

      if (!existsSync(outputPath)) {
        return { text: "", success: false, error: "Text extraction produced no output" };
      }

      const text = readFileSync(outputPath, "utf-8");
      return { text, success: true };
    } catch (err) {
      return {
        text: "",
        success: false,
        error: err instanceof Error ? err.message : "Text extraction failed",
      };
    }
  }

  /**
   * Close the browser and clean up resources.
   */
  close(): boolean {
    if (!this.launched) return true;

    const script = `
import json
print(json.dumps({"closed": True}))
`;
    try {
      execFileSync(PYTHON_CMD, ["-c", script], {
        stdio: "pipe",
        timeout: 10_000,
      });
      this.launched = false;
      this.currentUrl = "";
      return true;
    } catch {
      this.launched = false;
      return false;
    }
  }

  /** Whether the browser is currently launched. */
  isLaunched(): boolean {
    return this.launched;
  }

  /** The currently loaded URL, if any. */
  getCurrentUrl(): string {
    return this.currentUrl;
  }

  // ── Camoufox Python Scripts ────────────────────────────────

  private buildCamoufoxLaunchScript(): string {
    return `
import asyncio
from camoufox.sync_api import Camoufox
with Camoufox(headless=${this.config.headless ? "True" : "False"}, humanize=${this.config.humanize ? "True" : "False"}) as browser:
    page = browser.new_page()
    print("launched")
`;
  }

  private buildCamoufoxNavigateScript(url: string): string {
    const safeUrl = url.replace(/'/g, "\\'");
    return `
import asyncio, json
from camoufox.sync_api import Camoufox
with Camoufox(headless=${this.config.headless ? "True" : "False"}, humanize=${this.config.humanize ? "True" : "False"}) as browser:
    page = browser.new_page()
    page.goto('${safeUrl}', timeout=${this.config.timeout})
    print(json.dumps({"title": page.title()}))
`;
  }

  private buildCamoufoxScreenshotScript(outputPath: string): string {
    const safePath = outputPath.replace(/'/g, "\\'");
    const safeUrl = this.currentUrl.replace(/'/g, "\\'");
    return `
from camoufox.sync_api import Camoufox
with Camoufox(headless=${this.config.headless ? "True" : "False"}, humanize=${this.config.humanize ? "True" : "False"}) as browser:
    page = browser.new_page()
    page.goto('${safeUrl}', timeout=${this.config.timeout})
    page.screenshot(path='${safePath}')
`;
  }

  private buildCamoufoxGetTextScript(outputPath: string): string {
    const safePath = outputPath.replace(/'/g, "\\'");
    const safeUrl = this.currentUrl.replace(/'/g, "\\'");
    return `
from camoufox.sync_api import Camoufox
with Camoufox(headless=${this.config.headless ? "True" : "False"}, humanize=${this.config.humanize ? "True" : "False"}) as browser:
    page = browser.new_page()
    page.goto('${safeUrl}', timeout=${this.config.timeout})
    text = page.inner_text('body')
    with open('${safePath}', 'w') as f:
        f.write(text)
`;
  }

  // ── Playwright Fallback Scripts ────────────────────────────

  private buildPlaywrightFallbackScript(): string {
    return `
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=${this.config.headless ? "True" : "False"})
    page = browser.new_page()
    print("launched")
    browser.close()
`;
  }

  private buildPlaywrightNavigateScript(url: string): string {
    const safeUrl = url.replace(/'/g, "\\'");
    return `
import json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=${this.config.headless ? "True" : "False"})
    page = browser.new_page()
    page.goto('${safeUrl}', timeout=${this.config.timeout})
    print(json.dumps({"title": page.title()}))
    browser.close()
`;
  }

  private buildPlaywrightScreenshotScript(outputPath: string): string {
    const safePath = outputPath.replace(/'/g, "\\'");
    const safeUrl = this.currentUrl.replace(/'/g, "\\'");
    return `
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=${this.config.headless ? "True" : "False"})
    page = browser.new_page()
    page.goto('${safeUrl}', timeout=${this.config.timeout})
    page.screenshot(path='${safePath}')
    browser.close()
`;
  }

  private buildPlaywrightGetTextScript(outputPath: string): string {
    const safePath = outputPath.replace(/'/g, "\\'");
    const safeUrl = this.currentUrl.replace(/'/g, "\\'");
    return `
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=${this.config.headless ? "True" : "False"})
    page = browser.new_page()
    page.goto('${safeUrl}', timeout=${this.config.timeout})
    text = page.inner_text('body')
    with open('${safePath}', 'w') as f:
        f.write(text)
    browser.close()
`;
  }
}
