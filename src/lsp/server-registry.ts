/**
 * Multi-language LSP server registry — Phase D LSP (Serena parity port).
 *
 * Catalogs the 10 production-grade language servers Serena supports
 * (out of its 58), with install hints, auto-detection, and per-language
 * start/stop lifecycle. The registry intentionally keeps the server
 * surface narrow: it does NOT speak JSON-RPC itself — that's the job of
 * a future transport layer. For now the registry answers three questions
 * the rest of the LSP stack needs:
 *
 *   1. Is the binary on PATH? (`isInstalled`)
 *   2. What do I tell the user to type? (`installHint`)
 *   3. Which language owns this file extension? (`serverFor`)
 *
 * Plus it owns child-process lifecycle so callers don't accidentally
 * spawn the same server twice.
 *
 * Quality bars (Session-2+ rules):
 *   - Honest errors: when a server isn't installed we return
 *     `{error: "lsp_not_installed", fix: "..."}` with a concrete command.
 *   - No silent fallback: we never pretend a missing LSP was "OK".
 *   - Per-session state, not module-global: the registry instance owns
 *     the `Map<language, ChildProcess>` — tests can construct fresh
 *     instances without cross-test leaks.
 *   - Typed: no `any`, no implicit defaults, honest union types.
 *
 * This supersedes the six-server `LSPManager` in symbol-operations.ts.
 * That class remains for backwards compat; new code should prefer the
 * registry and its 10-server catalog.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { extname } from "node:path";

// ── Catalog ─────────────────────────────────────────────

/**
 * Stable identifiers for each supported language. Kept as a union so
 * callers can exhaustively switch without falling back to `string`.
 */
export type LspLanguage =
  | "typescript"
  | "rust"
  | "python"
  | "go"
  | "java"
  | "swift"
  | "kotlin"
  | "csharp"
  | "ruby"
  | "php";

/**
 * A language-server catalog entry. The shape matches what we need to
 * both probe (via `which`) and spawn (via `child_process.spawn`).
 */
export interface LspServerConfig {
  /** Human-readable language name. */
  readonly language: LspLanguage;
  /** Binary name invoked on PATH. */
  readonly command: string;
  /** CLI args appended to the spawn invocation. */
  readonly args: readonly string[];
  /** File extensions this server owns. Order matters — first match wins. */
  readonly extensions: readonly string[];
  /**
   * Install hint shown when `isInstalled` returns false. Keep this as a
   * concrete, copy-paste-ready command. Multi-platform hints separate
   * options with " OR " so the model can pick one.
   */
  readonly installHint: string;
  /** Optional homepage / docs URL so the model can route a user to install docs. */
  readonly homepage?: string;
}

/**
 * The canonical 10-server catalog. Ordering is stable and public —
 * tests and docs iterate it directly. Do not reorder without checking
 * `serverFor()` callers that may rely on first-match semantics.
 */
export const LSP_SERVER_CATALOG: readonly LspServerConfig[] = [
  {
    language: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"],
    installHint: "npm install -g typescript typescript-language-server",
    homepage: "https://github.com/typescript-language-server/typescript-language-server",
  },
  {
    language: "rust",
    command: "rust-analyzer",
    args: [],
    extensions: [".rs"],
    installHint: "rustup component add rust-analyzer OR brew install rust-analyzer",
    homepage: "https://rust-analyzer.github.io/",
  },
  {
    language: "python",
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
    installHint: "npm install -g pyright OR pipx install python-lsp-server[all]",
    homepage: "https://github.com/microsoft/pyright",
  },
  {
    language: "go",
    command: "gopls",
    args: ["serve"],
    extensions: [".go"],
    installHint: "go install golang.org/x/tools/gopls@latest",
    homepage: "https://pkg.go.dev/golang.org/x/tools/gopls",
  },
  {
    language: "java",
    command: "jdtls",
    args: [],
    extensions: [".java"],
    installHint: "brew install jdtls OR download from https://download.eclipse.org/jdtls/",
    homepage: "https://github.com/eclipse/eclipse.jdt.ls",
  },
  {
    language: "swift",
    command: "sourcekit-lsp",
    args: [],
    extensions: [".swift"],
    installHint: "Ships with Xcode: xcode-select --install (macOS) OR install Swift toolchain",
    homepage: "https://github.com/apple/sourcekit-lsp",
  },
  {
    language: "kotlin",
    command: "kotlin-language-server",
    args: [],
    extensions: [".kt", ".kts"],
    installHint: "brew install kotlin-language-server",
    homepage: "https://github.com/fwcd/kotlin-language-server",
  },
  {
    language: "csharp",
    command: "OmniSharp",
    args: ["-lsp"],
    extensions: [".cs", ".csx"],
    installHint: "brew install omnisharp OR dotnet tool install --global omnisharp",
    homepage: "https://github.com/OmniSharp/omnisharp-roslyn",
  },
  {
    language: "ruby",
    command: "solargraph",
    args: ["stdio"],
    extensions: [".rb", ".rake"],
    installHint: "gem install solargraph",
    homepage: "https://solargraph.org/",
  },
  {
    language: "php",
    command: "intelephense",
    args: ["--stdio"],
    extensions: [".php"],
    installHint: "npm install -g intelephense",
    homepage: "https://intelephense.com/",
  },
];

// ── Error payloads ──────────────────────────────────────

/**
 * Structured "LSP not installed" payload. Surfaced both by the registry
 * and by agent-tool handlers so the model receives a consistent shape
 * and can repair itself by running the install command.
 */
export interface LspNotInstalledError {
  readonly error: "lsp_not_installed";
  readonly language: LspLanguage;
  readonly command: string;
  readonly fix: string;
  readonly homepage?: string;
}

export function lspNotInstalled(config: LspServerConfig): LspNotInstalledError {
  return {
    error: "lsp_not_installed",
    language: config.language,
    command: config.command,
    fix: config.installHint,
    ...(config.homepage ? { homepage: config.homepage } : {}),
  };
}

// ── Detection options ───────────────────────────────────

/**
 * Hook for tests: a synchronous override that decides whether a binary
 * is on PATH without spawning `which`. When absent we fall back to a
 * real `which <cmd>` spawn.
 */
export type WhichChecker = (command: string) => Promise<boolean>;

/**
 * Timeout (ms) applied to the `which` probe. Low because a process that
 * takes >2s to answer `which` is already degenerate; we'd rather declare
 * the server missing than block the agent.
 */
const WHICH_TIMEOUT_MS = 2_000;

async function defaultWhichChecker(command: string): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    let settled = false;
    const proc = spawn("which", [command], { stdio: "pipe" });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {
        // swallow — the process may already be gone
      }
      resolvePromise(false);
    }, WHICH_TIMEOUT_MS);

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(code === 0);
    });
    proc.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(false);
    });
  });
}

// ── Registry ────────────────────────────────────────────

export interface LanguageServerRegistryOptions {
  /** Override the catalog (for tests). Defaults to `LSP_SERVER_CATALOG`. */
  readonly catalog?: readonly LspServerConfig[];
  /** Override the `which` probe (for tests). Defaults to real `which` spawn. */
  readonly whichChecker?: WhichChecker;
}

/**
 * Per-session, instance-owned registry of language servers. Callers get
 * auto-detection, lifecycle, and honest errors without ever reaching for
 * module-global state.
 */
export class LanguageServerRegistry {
  private readonly catalog: readonly LspServerConfig[];
  private readonly byLanguage: ReadonlyMap<LspLanguage, LspServerConfig>;
  private readonly byExtension: ReadonlyMap<string, LspServerConfig>;
  private readonly whichChecker: WhichChecker;
  private readonly running: Map<LspLanguage, ChildProcess> = new Map();
  private detectCache: Map<LspLanguage, boolean> | null = null;

  constructor(options: LanguageServerRegistryOptions = {}) {
    this.catalog = options.catalog ?? LSP_SERVER_CATALOG;
    this.whichChecker = options.whichChecker ?? defaultWhichChecker;

    const languageMap = new Map<LspLanguage, LspServerConfig>();
    const extensionMap = new Map<string, LspServerConfig>();
    for (const config of this.catalog) {
      languageMap.set(config.language, config);
      for (const ext of config.extensions) {
        // First-match-wins: we don't overwrite an extension that an
        // earlier catalog entry already claimed. This keeps ordering
        // stable and predictable.
        if (!extensionMap.has(ext)) {
          extensionMap.set(ext, config);
        }
      }
    }
    this.byLanguage = languageMap;
    this.byExtension = extensionMap;
  }

  /** Every known language in catalog order. */
  listLanguages(): readonly LspLanguage[] {
    return this.catalog.map((config) => config.language);
  }

  /** Get the server config for a language. */
  configFor(language: LspLanguage): LspServerConfig | null {
    return this.byLanguage.get(language) ?? null;
  }

  /**
   * Look up the server config that owns a file path (by extension).
   * Returns null when no server claims the extension.
   */
  serverFor(filePath: string): LspServerConfig | null {
    const ext = extname(filePath).toLowerCase();
    if (!ext) return null;
    return this.byExtension.get(ext) ?? null;
  }

  /**
   * Probe every language's binary with `which`. Results are cached per
   * instance — call `invalidateDetectCache()` to re-probe.
   */
  async detect(): Promise<ReadonlyMap<LspLanguage, boolean>> {
    if (this.detectCache) return this.detectCache;

    const results = new Map<LspLanguage, boolean>();
    // Parallelize — `which` is cheap but we're doing 10 of them.
    const probes = this.catalog.map(async (config) => {
      const installed = await this.whichChecker(config.command);
      return [config.language, installed] as const;
    });
    for (const [language, installed] of await Promise.all(probes)) {
      results.set(language, installed);
    }
    this.detectCache = results;
    return results;
  }

  /** Force a fresh `which` probe on the next `detect()` or `isInstalled()`. */
  invalidateDetectCache(): void {
    this.detectCache = null;
  }

  /** Check whether a single language's binary is on PATH. */
  async isInstalled(language: LspLanguage): Promise<boolean> {
    const detections = await this.detect();
    return detections.get(language) === true;
  }

  /**
   * Return the install hint for a language. Never throws — if the
   * language isn't catalogued we return a best-effort string pointing
   * callers back to the registry.
   */
  installHint(language: LspLanguage): string {
    const config = this.byLanguage.get(language);
    return config?.installHint ?? `No install hint available for ${language}`;
  }

  /**
   * Start a language server for the given language. Returns `true` if
   * the server is now running (either we just started it or it was
   * already running), `false` if the binary is missing.
   *
   * Spawn failures (e.g. command-not-found at exec time) are reported
   * as `false` — the caller should pair this with `isInstalled` for a
   * proper honest-error response.
   */
  async start(language: LspLanguage): Promise<boolean> {
    if (this.running.has(language)) return true;

    const config = this.byLanguage.get(language);
    if (!config) return false;

    if (!(await this.isInstalled(language))) {
      return false;
    }

    try {
      const proc = spawn(config.command, [...config.args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      // Early-exit protection: if the process dies immediately remove it
      // from the running set so a retry can re-attempt.
      proc.once("exit", () => {
        if (this.running.get(language) === proc) {
          this.running.delete(language);
        }
      });
      proc.once("error", () => {
        if (this.running.get(language) === proc) {
          this.running.delete(language);
        }
      });
      this.running.set(language, proc);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure the server for a file's language is running. Convenience for
   * agent-tool handlers that want to lazy-start based on file extension.
   * Returns the config when the server is (or was) started, an honest
   * error payload when the binary is missing, or null when no server
   * owns the extension.
   */
  async ensureForFile(filePath: string): Promise<LspServerConfig | LspNotInstalledError | null> {
    const config = this.serverFor(filePath);
    if (!config) return null;

    const ok = await this.start(config.language);
    if (!ok) {
      return lspNotInstalled(config);
    }
    return config;
  }

  /** Stop a running language server. No-op if the server isn't running. */
  stop(language: LspLanguage): void {
    const proc = this.running.get(language);
    if (!proc) return;

    this.running.delete(language);
    try {
      proc.kill();
    } catch {
      // Process may already be gone — swallow.
    }
  }

  /** Stop every running server. Safe to call at shutdown. */
  stopAll(): void {
    for (const language of [...this.running.keys()]) {
      this.stop(language);
    }
  }

  /** True when a server is in the running set. */
  isRunning(language: LspLanguage): boolean {
    return this.running.has(language);
  }

  /** Snapshot of currently-running languages. */
  runningLanguages(): readonly LspLanguage[] {
    return [...this.running.keys()];
  }
}
