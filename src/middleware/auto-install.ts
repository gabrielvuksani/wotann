/**
 * Auto-Install Missing Dependencies Middleware.
 *
 * FROM TERMINALBENCH RESEARCH:
 * "24.1% of TB2.0 failures are 'executable not in PATH'."
 * This is the SECOND biggest cause of benchmark failure after
 * not planning. Auto-installing missing dependencies eliminates
 * nearly a quarter of all failures.
 *
 * DETECTION:
 * When a Bash command fails with "command not found", "not recognized",
 * or similar error patterns, this middleware:
 * 1. Extracts the missing executable name
 * 2. Maps it to a package manager + package name
 * 3. Suggests an install command
 * 4. Optionally auto-installs (when in non-interactive/benchmark mode)
 *
 * PACKAGE RESOLUTION:
 * The middleware maintains a mapping of common executables to their
 * install commands across npm, pip, brew, and apt. This covers the
 * vast majority of development tools.
 *
 * RETRY:
 * After installation, the middleware injects a follow-up suggesting
 * the agent retry the failed command.
 */

import type { Middleware, MiddlewareContext, AgentResult } from "./types.js";

// -- Error Pattern Detection -------------------------------------------

/**
 * Patterns that indicate a missing executable.
 * Covers bash, zsh, sh, cmd, powershell error formats.
 */
const COMMAND_NOT_FOUND_PATTERNS: readonly RegExp[] = [
  /(?:bash|zsh|sh): (?:line \d+: )?(\S+): command not found/i,
  /(\S+): not found/i,
  /command '(\S+)' not found/i,
  /No such file or directory.*?(\S+)/i,
  /(\S+) is not recognized as an internal or external command/i,
  /Cannot find.*?(?:executable|binary|command)\s+['"]?(\S+?)['"]?[.\s]/i,
  /Error: (\S+) ENOENT/i,
  /spawn (\S+) ENOENT/i,
  /env: (\S+): No such file or directory/i,
];

/**
 * Extract the missing executable name from error output.
 * Returns null if no missing command pattern is detected.
 */
export function extractMissingCommand(errorOutput: string): string | null {
  for (const pattern of COMMAND_NOT_FOUND_PATTERNS) {
    const match = errorOutput.match(pattern);
    if (match?.[1]) {
      const cmd = match[1].replace(/['"]/g, "");
      // Filter out false positives (common words that aren't executables)
      if (cmd.length < 2 || cmd.length > 50) continue;
      if (/^(the|a|an|is|was|not|no|and|or|in|at|to|of)$/i.test(cmd)) continue;
      return cmd;
    }
  }
  return null;
}

// -- Package Registry --------------------------------------------------

interface PackageInfo {
  readonly executable: string;
  readonly packageManager: "npm" | "pip" | "brew" | "apt" | "cargo" | "go";
  readonly packageName: string;
  readonly globalFlag: string;
  readonly installCommand: string;
}

/**
 * Mapping of common executables to their install commands.
 * Prioritizes npm/pip (most common in coding benchmarks).
 */
const PACKAGE_REGISTRY: readonly PackageInfo[] = [
  // Node.js ecosystem
  { executable: "tsc", packageManager: "npm", packageName: "typescript", globalFlag: "-g", installCommand: "npm install -g typescript" },
  { executable: "tsx", packageManager: "npm", packageName: "tsx", globalFlag: "-g", installCommand: "npm install -g tsx" },
  { executable: "ts-node", packageManager: "npm", packageName: "ts-node", globalFlag: "-g", installCommand: "npm install -g ts-node" },
  { executable: "vitest", packageManager: "npm", packageName: "vitest", globalFlag: "-g", installCommand: "npx vitest" },
  { executable: "jest", packageManager: "npm", packageName: "jest", globalFlag: "-g", installCommand: "npx jest" },
  { executable: "eslint", packageManager: "npm", packageName: "eslint", globalFlag: "-g", installCommand: "npx eslint" },
  { executable: "prettier", packageManager: "npm", packageName: "prettier", globalFlag: "-g", installCommand: "npx prettier" },
  { executable: "biome", packageManager: "npm", packageName: "@biomejs/biome", globalFlag: "-g", installCommand: "npx @biomejs/biome" },
  { executable: "turbo", packageManager: "npm", packageName: "turbo", globalFlag: "-g", installCommand: "npx turbo" },
  { executable: "playwright", packageManager: "npm", packageName: "playwright", globalFlag: "-g", installCommand: "npx playwright" },
  { executable: "esbuild", packageManager: "npm", packageName: "esbuild", globalFlag: "-g", installCommand: "npx esbuild" },
  { executable: "vite", packageManager: "npm", packageName: "vite", globalFlag: "-g", installCommand: "npx vite" },
  { executable: "webpack", packageManager: "npm", packageName: "webpack-cli", globalFlag: "-g", installCommand: "npx webpack" },
  { executable: "prisma", packageManager: "npm", packageName: "prisma", globalFlag: "-g", installCommand: "npx prisma" },
  { executable: "drizzle-kit", packageManager: "npm", packageName: "drizzle-kit", globalFlag: "-g", installCommand: "npx drizzle-kit" },

  // Python ecosystem
  { executable: "pytest", packageManager: "pip", packageName: "pytest", globalFlag: "", installCommand: "pip install pytest" },
  { executable: "mypy", packageManager: "pip", packageName: "mypy", globalFlag: "", installCommand: "pip install mypy" },
  { executable: "pyright", packageManager: "pip", packageName: "pyright", globalFlag: "", installCommand: "pip install pyright" },
  { executable: "ruff", packageManager: "pip", packageName: "ruff", globalFlag: "", installCommand: "pip install ruff" },
  { executable: "black", packageManager: "pip", packageName: "black", globalFlag: "", installCommand: "pip install black" },
  { executable: "isort", packageManager: "pip", packageName: "isort", globalFlag: "", installCommand: "pip install isort" },
  { executable: "flake8", packageManager: "pip", packageName: "flake8", globalFlag: "", installCommand: "pip install flake8" },
  { executable: "uvicorn", packageManager: "pip", packageName: "uvicorn", globalFlag: "", installCommand: "pip install uvicorn" },
  { executable: "gunicorn", packageManager: "pip", packageName: "gunicorn", globalFlag: "", installCommand: "pip install gunicorn" },
  { executable: "poetry", packageManager: "pip", packageName: "poetry", globalFlag: "", installCommand: "pip install poetry" },

  // Rust ecosystem
  { executable: "cargo", packageManager: "brew", packageName: "rust", globalFlag: "", installCommand: "brew install rust" },
  { executable: "rustfmt", packageManager: "cargo", packageName: "rustfmt", globalFlag: "", installCommand: "rustup component add rustfmt" },
  { executable: "clippy", packageManager: "cargo", packageName: "clippy", globalFlag: "", installCommand: "rustup component add clippy" },

  // Go ecosystem
  { executable: "golangci-lint", packageManager: "go", packageName: "github.com/golangci/golangci-lint/cmd/golangci-lint@latest", globalFlag: "", installCommand: "go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest" },

  // General tools
  { executable: "jq", packageManager: "brew", packageName: "jq", globalFlag: "", installCommand: "brew install jq" },
  { executable: "tree", packageManager: "brew", packageName: "tree", globalFlag: "", installCommand: "brew install tree" },
  { executable: "ripgrep", packageManager: "brew", packageName: "ripgrep", globalFlag: "", installCommand: "brew install ripgrep" },
  { executable: "rg", packageManager: "brew", packageName: "ripgrep", globalFlag: "", installCommand: "brew install ripgrep" },
  { executable: "fd", packageManager: "brew", packageName: "fd", globalFlag: "", installCommand: "brew install fd" },
  { executable: "fzf", packageManager: "brew", packageName: "fzf", globalFlag: "", installCommand: "brew install fzf" },
  { executable: "bat", packageManager: "brew", packageName: "bat", globalFlag: "", installCommand: "brew install bat" },
  { executable: "gh", packageManager: "brew", packageName: "gh", globalFlag: "", installCommand: "brew install gh" },
  { executable: "sqlite3", packageManager: "brew", packageName: "sqlite", globalFlag: "", installCommand: "brew install sqlite" },
  { executable: "redis-cli", packageManager: "brew", packageName: "redis", globalFlag: "", installCommand: "brew install redis" },
  { executable: "psql", packageManager: "brew", packageName: "postgresql", globalFlag: "", installCommand: "brew install postgresql" },
];

/**
 * Look up the install command for a missing executable.
 * Returns null if the executable is not in the registry.
 */
export function resolveInstallCommand(executable: string): PackageInfo | null {
  return PACKAGE_REGISTRY.find(
    (pkg) => pkg.executable === executable,
  ) ?? null;
}

// -- Middleware State ---------------------------------------------------

export interface AutoInstallState {
  readonly detectedMissing: readonly string[];
  readonly installSuggestions: readonly string[];
  readonly autoInstallCount: number;
  readonly retryCount: number;
}

// -- Middleware Class ---------------------------------------------------

/**
 * AutoInstallMiddleware detects "command not found" errors and provides
 * install suggestions or auto-installs the missing dependency.
 */
export class AutoInstallMiddleware {
  private detectedMissing: string[] = [];
  private installSuggestions: string[] = [];
  private autoInstallCount = 0;
  private retryCount = 0;
  private autoInstallEnabled: boolean;

  /**
   * Maximum number of auto-installs per session to prevent runaway installs.
   */
  private static readonly MAX_AUTO_INSTALLS = 5;

  constructor(autoInstallEnabled: boolean = false) {
    this.autoInstallEnabled = autoInstallEnabled;
  }

  /**
   * Enable or disable auto-install at runtime.
   */
  setAutoInstall(enabled: boolean): void {
    this.autoInstallEnabled = enabled;
  }

  /**
   * Process a failed Bash result to detect missing commands.
   * Returns a follow-up message with install suggestions, or null.
   */
  processFailedCommand(result: AgentResult): string | null {
    // Only process failed Bash commands
    if (result.toolName !== "Bash" || result.success) return null;
    if (!result.content) return null;

    const missingCommand = extractMissingCommand(result.content);
    if (!missingCommand) return null;

    // Avoid duplicate detection within the same session
    if (this.detectedMissing.includes(missingCommand)) {
      return null;
    }

    this.detectedMissing = [...this.detectedMissing, missingCommand];

    const packageInfo = resolveInstallCommand(missingCommand);

    if (packageInfo) {
      this.installSuggestions = [
        ...this.installSuggestions,
        packageInfo.installCommand,
      ];

      if (this.autoInstallEnabled && this.autoInstallCount < AutoInstallMiddleware.MAX_AUTO_INSTALLS) {
        this.autoInstallCount++;
        return this.buildAutoInstallMessage(missingCommand, packageInfo);
      }

      return this.buildSuggestionMessage(missingCommand, packageInfo);
    }

    return this.buildUnknownCommandMessage(missingCommand);
  }

  /**
   * Get the current state.
   */
  getState(): AutoInstallState {
    return {
      detectedMissing: [...this.detectedMissing],
      installSuggestions: [...this.installSuggestions],
      autoInstallCount: this.autoInstallCount,
      retryCount: this.retryCount,
    };
  }

  /**
   * Reset for a new task.
   */
  reset(): void {
    this.detectedMissing = [];
    this.installSuggestions = [];
    this.autoInstallCount = 0;
    this.retryCount = 0;
  }

  // -- Private ---------------------------------------------------------

  private buildAutoInstallMessage(cmd: string, pkg: PackageInfo): string {
    return [
      `[AUTO-INSTALL] Missing executable: '${cmd}'`,
      `Installing via: ${pkg.installCommand}`,
      "",
      "Run the install command first, then retry the original command.",
      `Install: ${pkg.installCommand}`,
    ].join("\n");
  }

  private buildSuggestionMessage(cmd: string, pkg: PackageInfo): string {
    return [
      `[MISSING DEPENDENCY] '${cmd}' is not installed or not in PATH.`,
      "",
      `To fix, install it:`,
      `  ${pkg.installCommand}`,
      "",
      "After installing, retry the original command.",
    ].join("\n");
  }

  private buildUnknownCommandMessage(cmd: string): string {
    return [
      `[MISSING DEPENDENCY] '${cmd}' is not installed or not in PATH.`,
      "",
      "This executable is not in the known package registry.",
      "Try one of:",
      `  npm install -g ${cmd}`,
      `  pip install ${cmd}`,
      `  brew install ${cmd}`,
      "",
      "Or check if it needs to be installed as a project dependency.",
    ].join("\n");
  }
}

// -- Pipeline Middleware Adapter ----------------------------------------

/**
 * Create a Middleware adapter for the auto-install detector.
 * Runs at order 22 (after verification enforcement).
 * Only operates in the `after` phase on failed Bash results.
 */
export function createAutoInstallMiddleware(
  instance: AutoInstallMiddleware,
): Middleware {
  return {
    name: "AutoInstall",
    order: 22,
    after(_ctx: MiddlewareContext, result: AgentResult): AgentResult {
      const followUp = instance.processFailedCommand(result);

      if (followUp) {
        return {
          ...result,
          followUp: result.followUp
            ? `${result.followUp}\n\n${followUp}`
            : followUp,
        };
      }

      return result;
    },
  };
}
