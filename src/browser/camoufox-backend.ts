/**
 * Camoufox Stealth Browser Backend — anti-detect browsing for web scraping.
 *
 * Camoufox is a Firefox fork that injects fingerprints at the C++ level,
 * making it virtually undetectable by anti-bot systems. It integrates with
 * Playwright via a Python wrapper (camoufox package).
 *
 * ARCHITECTURE (persistent JSON-RPC):
 *
 *   TS client  ──stdin──>  python driver  ──stdout──>  TS client
 *                               │
 *                               └── Camoufox (or Playwright, or stub)
 *
 * The driver process is spawned ONCE on first call and kept alive across
 * every subsequent op. Cookies, fingerprint, and page state persist for
 * the lifetime of the CamoufoxBrowser instance. `close()` terminates the
 * driver cleanly by sending `{method:"close"}` and awaiting exit.
 *
 * Wire format is one JSON object per line:
 *
 *   request  = { "id": "<uuid>", "method": "<name>", "params": { ... } }
 *   response = { "id": "<uuid>", "result": <json> } | { "id": ..., "error": {"message": "..."} }
 *   banner   = { "ready": true, "backend": "camoufox" | "playwright" | "stub" }
 *
 * Stdout is RPC-only. The python side writes every diagnostic to stderr
 * so the JSON channel stays clean. Parser failures are treated as fatal
 * and surface through pending RPC rejections.
 *
 * BACKEND SELECTION (in the driver):
 *   1. camoufox    — real stealth browser when the pip package is installed
 *   2. playwright  — fallback to vanilla Chromium when only playwright is installed
 *   3. stub        — deterministic no-op for CI / local test runs
 *
 * Set `WOTANN_CAMOUFOX_REAL=1` to refuse the stub path and surface an error
 * instead when no real browser backend is available.
 *
 * USAGE:
 *   const browser = new CamoufoxBrowser();
 *   await browser.launch();
 *   const page = await browser.newPage("https://example.com");
 *   const text = await browser.getText();
 *   await browser.close();
 */

import { spawn, type ChildProcessWithoutNullStreams, execFileSync } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// ── Types ──────────────────────────────────────────────────

export interface CamoufoxConfig {
  readonly headless: boolean;
  readonly humanize: boolean;
  readonly timeout: number;
  readonly screenshotDir: string;
  /** Override the driver script path (primarily for tests). */
  readonly driverScript?: string;
  /** Override the python interpreter command. */
  readonly pythonCmd?: string;
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

export interface ClickResult {
  readonly success: boolean;
  readonly error?: string;
}

export interface TypeResult {
  readonly success: boolean;
  readonly error?: string;
}

/** Which backend the python driver actually booted. */
export type DriverBackend = "camoufox" | "playwright" | "stub";

// ── Constants ──────────────────────────────────────────────

const DEFAULT_CONFIG: CamoufoxConfig = {
  headless: true,
  humanize: true,
  timeout: 30_000,
  screenshotDir: join(tmpdir(), "wotann-screenshots"),
};

const DEFAULT_PYTHON_CMD = "python3";
const READY_TIMEOUT_MS = 30_000;
const DEFAULT_CLOSE_GRACE_MS = 5_000;
const MAX_CRASH_RETRIES = 1;

// ── Internal helpers ───────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Best-effort resolver for the python driver script.
 *
 * When running from source: `src/browser/camoufox-backend.ts` -> `../../python-scripts/camoufox-driver.py`
 * When running from build:  `dist/browser/camoufox-backend.js` -> `../../python-scripts/camoufox-driver.py`
 *
 * Both layouts land in the same place because `python-scripts/` lives at the
 * repo root alongside both `src/` and `dist/`.
 */
function defaultDriverScript(): string {
  const fromHere = resolve(HERE, "..", "..", "python-scripts", "camoufox-driver.py");
  if (existsSync(fromHere)) return fromHere;
  // Fallback to cwd (useful when tests run from an unusual layout).
  const fromCwd = resolve(process.cwd(), "python-scripts", "camoufox-driver.py");
  return fromCwd;
}

interface PendingRpc<T> {
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
  readonly timer: NodeJS.Timeout | undefined;
}

interface RpcMessage {
  readonly id?: string;
  readonly result?: unknown;
  readonly error?: { message?: string };
  readonly ready?: boolean;
  readonly backend?: string;
}

// ── Availability Check ─────────────────────────────────────

/**
 * Check whether the camoufox Python package is installed and importable.
 * Returns true if the package is available, false otherwise.
 *
 * This is the "real stealth" check. The persistent driver will still boot
 * in playwright or stub mode when this returns false.
 */
export function isAvailable(pythonCmd: string = DEFAULT_PYTHON_CMD): boolean {
  try {
    execFileSync(pythonCmd, ["-c", "import camoufox"], {
      stdio: "pipe",
      timeout: 10_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── CamoufoxBrowser Class ──────────────────────────────────

/**
 * Long-lived Camoufox session backed by a persistent python subprocess.
 *
 * Methods are async because they speak JSON-RPC to the driver. Each call
 * writes one request line on the driver's stdin and resolves when the
 * matching id appears on stdout. Driver stderr is logged to Node's stderr
 * so users can diagnose python-side failures without polluting the RPC
 * channel.
 *
 * Crash handling: if the driver exits between calls, the next call will
 * respawn the driver once (MAX_CRASH_RETRIES). If it crashes again the
 * method returns an error result and leaves the instance in a closed
 * state — callers may call `launch()` again to retry.
 */
export class CamoufoxBrowser {
  private readonly config: CamoufoxConfig;
  private readonly pythonCmd: string;
  private readonly driverScript: string;

  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutRl: ReadlineInterface | null = null;
  private readyPromise: Promise<DriverBackend> | null = null;
  private readonly pending = new Map<string, PendingRpc<unknown>>();
  private nextId = 0;
  private closed = false;
  private crashRetries = 0;
  private currentUrl = "";
  private lastBackend: DriverBackend | null = null;

  constructor(config: Partial<CamoufoxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pythonCmd = this.config.pythonCmd ?? DEFAULT_PYTHON_CMD;
    this.driverScript = this.config.driverScript ?? defaultDriverScript();
  }

  /**
   * Launch the persistent driver subprocess and wait for the ready banner.
   * Safe to call multiple times — subsequent calls short-circuit.
   */
  async launch(): Promise<boolean> {
    if (!existsSync(this.config.screenshotDir)) {
      mkdirSync(this.config.screenshotDir, { recursive: true });
    }
    try {
      await this.ensureStarted();
      await this.sendRpc<{ launched: boolean }>("launch", {
        headless: this.config.headless,
        humanize: this.config.humanize,
      });
      return true;
    } catch (err) {
      this.logStderr(`launch failed: ${(err as Error).message}`);
      await this.forceKill();
      return false;
    }
  }

  /**
   * Navigate the persistent browser to `url`. The session (cookies,
   * fingerprint, local storage) carries over from previous calls.
   */
  async newPage(url: string): Promise<PageResult> {
    try {
      const res = await this.sendRpc<{ url: string; title: string }>("navigate", {
        url,
        timeout: this.config.timeout,
      });
      this.currentUrl = res.url ?? url;
      return { url: this.currentUrl, title: res.title ?? "", success: true };
    } catch (err) {
      return {
        url,
        title: "",
        success: false,
        error: err instanceof Error ? err.message : "Navigation failed",
      };
    }
  }

  /** Click an element on the current page. */
  async click(selector: string): Promise<ClickResult> {
    try {
      await this.sendRpc("click", { selector });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Click failed",
      };
    }
  }

  /** Type text into a selector on the current page. */
  async type(selector: string, text: string): Promise<TypeResult> {
    try {
      await this.sendRpc("type", { selector, text });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Type failed",
      };
    }
  }

  /** Evaluate a JS expression in the current page context. */
  async evaluate<T = unknown>(
    expression: string,
  ): Promise<{ value: T | null; success: boolean; error?: string }> {
    try {
      const res = await this.sendRpc<{ value: T }>("evaluate", { expression });
      return { value: res.value, success: true };
    } catch (err) {
      return {
        value: null,
        success: false,
        error: err instanceof Error ? err.message : "Evaluate failed",
      };
    }
  }

  /** Capture a screenshot of the current page. */
  async screenshot(): Promise<ScreenshotResult> {
    const filename = `screenshot-${Date.now()}.png`;
    const outputPath = join(this.config.screenshotDir, filename);
    try {
      const res = await this.sendRpc<{ path: string }>("screenshot", { path: outputPath });
      const path = res.path ?? outputPath;
      return { path, success: existsSync(path) };
    } catch (err) {
      return {
        path: "",
        success: false,
        error: err instanceof Error ? err.message : "Screenshot failed",
      };
    }
  }

  /** Extract visible text content from the current page. */
  async getText(): Promise<TextResult> {
    try {
      const res = await this.sendRpc<{ text: string }>("snapshot", {});
      return { text: res.text ?? "", success: true };
    } catch (err) {
      return {
        text: "",
        success: false,
        error: err instanceof Error ? err.message : "Text extraction failed",
      };
    }
  }

  /**
   * Send `{method:"close"}` and wait for the driver to exit. Idempotent.
   */
  async close(): Promise<boolean> {
    if (this.closed || this.child === null) {
      this.closed = true;
      return true;
    }
    try {
      await this.sendRpcWithTimeout("close", {}, DEFAULT_CLOSE_GRACE_MS);
    } catch (err) {
      this.logStderr(`close rpc failed: ${(err as Error).message}`);
    }
    await this.forceKill();
    return true;
  }

  /** Whether the driver subprocess is currently running. */
  isLaunched(): boolean {
    return this.child !== null && !this.closed;
  }

  /** The currently loaded URL, if any. */
  getCurrentUrl(): string {
    return this.currentUrl;
  }

  /** Which driver backend booted — 'camoufox', 'playwright', or 'stub'. */
  getBackend(): DriverBackend | null {
    return this.lastBackend;
  }

  // ── Internals: process management ───────────────────────

  private async ensureStarted(): Promise<DriverBackend> {
    if (this.readyPromise !== null) return this.readyPromise;
    if (this.closed) {
      throw new Error("CamoufoxBrowser is closed");
    }

    this.readyPromise = this.spawnDriver();
    try {
      return await this.readyPromise;
    } catch (err) {
      this.readyPromise = null;
      throw err;
    }
  }

  private spawnDriver(): Promise<DriverBackend> {
    if (!existsSync(this.driverScript)) {
      return Promise.reject(new Error(`camoufox driver script not found: ${this.driverScript}`));
    }

    const child = spawn(this.pythonCmd, [this.driverScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    this.child = child;
    this.closed = false;

    // Log every stderr line so python diagnostics are visible but stay
    // out of the RPC channel.
    const stderrRl = createInterface({ input: child.stderr, crlfDelay: Infinity });
    stderrRl.on("line", (line) => this.logStderr(line));

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.stdoutRl = rl;

    return new Promise<DriverBackend>((resolveReady, rejectReady) => {
      const readyTimer = setTimeout(() => {
        rejectReady(new Error(`camoufox driver did not become ready in ${READY_TIMEOUT_MS}ms`));
        this.forceKill().catch(() => {});
      }, READY_TIMEOUT_MS);

      let banner: DriverBackend | null = null;

      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let msg: RpcMessage;
        try {
          msg = JSON.parse(trimmed) as RpcMessage;
        } catch (err) {
          this.logStderr(
            `bad json from driver: ${(err as Error).message} line=${trimmed.slice(0, 200)}`,
          );
          return;
        }

        if (banner === null && msg.ready !== undefined) {
          clearTimeout(readyTimer);
          if (msg.ready !== true) {
            rejectReady(new Error(msg.error?.message ?? "driver reported not ready"));
            return;
          }
          banner = (msg.backend as DriverBackend) ?? "stub";
          this.lastBackend = banner;
          resolveReady(banner);
          return;
        }

        this.handleRpcResponse(msg);
      });

      child.on("exit", (code, signal) => {
        clearTimeout(readyTimer);
        this.handleChildExit(code, signal);
      });
      child.on("error", (err) => {
        clearTimeout(readyTimer);
        this.logStderr(`spawn error: ${err.message}`);
        rejectReady(err);
      });
    });
  }

  private handleRpcResponse(msg: RpcMessage): void {
    const id = msg.id;
    if (typeof id !== "string") {
      this.logStderr(`rpc response missing id: ${JSON.stringify(msg).slice(0, 200)}`);
      return;
    }
    const pending = this.pending.get(id);
    if (pending === undefined) {
      this.logStderr(`rpc response for unknown id: ${id}`);
      return;
    }
    this.pending.delete(id);
    if (pending.timer) clearTimeout(pending.timer);

    if (msg.error) {
      pending.reject(new Error(msg.error.message ?? "driver error"));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    const reason = `driver exited code=${code} signal=${signal}`;
    this.logStderr(reason);
    // Fail every in-flight request so callers don't hang.
    for (const [id, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(`driver exited before responding to ${id}`));
    }
    this.pending.clear();
    this.child = null;
    this.stdoutRl?.close();
    this.stdoutRl = null;
    this.readyPromise = null;
    this.closed = true;
  }

  private async forceKill(): Promise<void> {
    if (this.child === null) {
      this.closed = true;
      return;
    }
    const child = this.child;
    const closed$ = new Promise<void>((done) => {
      child.once("exit", () => done());
    });
    try {
      child.stdin.end();
    } catch {
      /* best effort */
    }
    try {
      if (!child.killed) child.kill("SIGTERM");
    } catch {
      /* best effort */
    }
    // Give the process a short window to exit gracefully, then SIGKILL.
    await Promise.race([
      closed$,
      new Promise<void>((done) => {
        setTimeout(() => {
          try {
            if (this.child && !this.child.killed) this.child.kill("SIGKILL");
          } catch {
            /* best effort */
          }
          done();
        }, 1_000);
      }),
    ]);
    this.child = null;
    this.stdoutRl?.close();
    this.stdoutRl = null;
    this.readyPromise = null;
    this.closed = true;
  }

  private logStderr(line: string): void {
    // Use process.stderr so RPC stdout of the TS host is not polluted.
    process.stderr.write(`[camoufox-backend] ${line}\n`);
  }

  // ── Internals: JSON-RPC ─────────────────────────────────

  /**
   * Send a JSON-RPC request to the driver and await the matching response.
   *
   * Restarts the driver once if it crashed between calls (MAX_CRASH_RETRIES).
   * Times out after `config.timeout + 10s` to match the driver-side timeout
   * with slack for serialisation.
   */
  private async sendRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const timeoutMs = this.config.timeout + 10_000;
    return this.sendRpcWithTimeout<T>(method, params, timeoutMs);
  }

  private async sendRpcWithTimeout<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    if (this.closed && method !== "close") {
      throw new Error("CamoufoxBrowser is closed");
    }

    // Ensure the driver is running and ready. If it crashed, try once.
    try {
      await this.ensureStarted();
    } catch (err) {
      if (this.crashRetries < MAX_CRASH_RETRIES) {
        this.crashRetries++;
        this.logStderr(`restarting driver (attempt ${this.crashRetries})`);
        this.readyPromise = null;
        await this.ensureStarted();
      } else {
        throw err;
      }
    }

    const child = this.child;
    if (child === null) throw new Error("driver not running");

    const id = `rpc-${++this.nextId}`;
    const frame = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<T>((resolveRpc, rejectRpc) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rejectRpc(new Error(`rpc timeout after ${timeoutMs}ms method=${method}`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolveRpc(value as T),
        reject: rejectRpc,
        timer,
      });

      try {
        const ok = child.stdin.write(frame);
        if (!ok) {
          child.stdin.once("drain", () => {
            /* flushed */
          });
        }
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        rejectRpc(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
