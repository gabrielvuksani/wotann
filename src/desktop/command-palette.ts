/**
 * Command Palette — Spotlight-like command palette for the desktop app.
 *
 * Triggered by Cmd+K. Provides fuzzy search across:
 * - All TUI slash commands (registered as palette commands)
 * - Conversations (search by title/content)
 * - Files (recently opened)
 * - Skills (available skills)
 * - Quick model/mode switching
 *
 * Architecture:
 * - Commands are registered via addCommand/addCommands
 * - Search uses a simple fuzzy matching algorithm (no external deps)
 * - Results are scored and sorted by relevance
 * - Recent commands are tracked for quick access
 */

// ── Types ──────────────────────────────────────────────

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly shortcut?: string;
  readonly icon: string;
  readonly category: PaletteCategory;
  readonly action: () => void;
  readonly keywords: readonly string[];
}

export type PaletteCategory =
  | "session"
  | "navigation"
  | "model"
  | "mode"
  | "tools"
  | "intelligence"
  | "execution"
  | "channels"
  | "diagnostics"
  | "settings";

export interface PaletteSearchResult {
  readonly command: PaletteCommand;
  readonly score: number;
  readonly matchedRanges: readonly { readonly start: number; readonly end: number }[];
}

// ── Constants ──────────────────────────────────────────

const MAX_RECENT_COMMANDS = 10;
const MAX_SEARCH_RESULTS = 20;

// ── Fuzzy Search ───────────────────────────────────────

/**
 * Compute a fuzzy match score between a query and target string.
 * Returns 0 if no match, higher scores indicate better matches.
 * Consecutive character matches and word-boundary matches score higher.
 */
export function fuzzyScore(query: string, target: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();

  if (lowerQuery.length === 0) return 1;
  if (lowerTarget.length === 0) return 0;

  // Exact substring match gets highest bonus
  if (lowerTarget.includes(lowerQuery)) {
    const index = lowerTarget.indexOf(lowerQuery);
    return 100 + (index === 0 ? 50 : 0);
  }

  let score = 0;
  let queryIdx = 0;
  let prevMatchIdx = -2;

  for (let i = 0; i < lowerTarget.length && queryIdx < lowerQuery.length; i++) {
    if (lowerTarget[i] === lowerQuery[queryIdx]) {
      score += 10;

      // Consecutive match bonus
      if (i === prevMatchIdx + 1) {
        score += 15;
      }

      // Word boundary bonus (start of string or after separator)
      if (i === 0 || /[\s\-_/.]/.test(lowerTarget[i - 1] ?? "")) {
        score += 20;
      }

      // Camel case boundary bonus
      if (i > 0 && target[i] !== undefined && target[i] === target[i]?.toUpperCase() &&
          target[i - 1] !== undefined && target[i - 1] === target[i - 1]?.toLowerCase()) {
        score += 10;
      }

      prevMatchIdx = i;
      queryIdx++;
    }
  }

  // All query characters must be matched
  if (queryIdx < lowerQuery.length) return 0;

  return score;
}

// ── Command Palette ────────────────────────────────────

export class CommandPalette {
  private readonly commands: Map<string, PaletteCommand> = new Map();
  private recentCommandIds: readonly string[] = [];

  /**
   * Register a single command.
   */
  addCommand(command: PaletteCommand): void {
    this.commands.set(command.id, command);
  }

  /**
   * Register multiple commands at once.
   */
  addCommands(commands: readonly PaletteCommand[]): void {
    for (const cmd of commands) {
      this.commands.set(cmd.id, cmd);
    }
  }

  /**
   * Remove a command by ID.
   */
  removeCommand(id: string): boolean {
    return this.commands.delete(id);
  }

  /**
   * Search commands by query string. Returns scored results sorted by relevance.
   */
  search(query: string): readonly PaletteSearchResult[] {
    if (query.trim().length === 0) {
      return this.getRecentCommands();
    }

    const results: PaletteSearchResult[] = [];

    for (const command of this.commands.values()) {
      const bestScore = computeCommandScore(query, command);
      if (bestScore > 0) {
        results.push({
          command,
          score: bestScore,
          matchedRanges: computeMatchRanges(query, command.label),
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SEARCH_RESULTS);
  }

  /**
   * Execute a command by ID and track it as recent.
   */
  executeCommand(id: string): boolean {
    const command = this.commands.get(id);
    if (command === undefined) return false;

    command.action();
    this.recentCommandIds = [
      id,
      ...this.recentCommandIds.filter((rid) => rid !== id),
    ].slice(0, MAX_RECENT_COMMANDS);

    return true;
  }

  /**
   * Get recently executed commands, ordered most-recent first.
   */
  getRecentCommands(): readonly PaletteSearchResult[] {
    return this.recentCommandIds
      .map((id) => this.commands.get(id))
      .filter((cmd): cmd is PaletteCommand => cmd !== undefined)
      .map((command) => ({ command, score: 1, matchedRanges: [] }));
  }

  /**
   * Get all registered commands.
   */
  getAllCommands(): readonly PaletteCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get commands filtered by category.
   */
  getCommandsByCategory(category: PaletteCategory): readonly PaletteCommand[] {
    return Array.from(this.commands.values()).filter((c) => c.category === category);
  }

  /**
   * Total number of registered commands.
   */
  get size(): number {
    return this.commands.size;
  }
}

// ── Helpers ────────────────────────────────────────────

function computeCommandScore(query: string, command: PaletteCommand): number {
  const labelScore = fuzzyScore(query, command.label);
  const descScore = fuzzyScore(query, command.description) * 0.6;
  const keywordScores = command.keywords.map((kw) => fuzzyScore(query, kw) * 0.8);
  const bestKeyword = keywordScores.length > 0 ? Math.max(...keywordScores) : 0;

  return Math.max(labelScore, descScore, bestKeyword);
}

function computeMatchRanges(
  query: string,
  target: string,
): readonly { readonly start: number; readonly end: number }[] {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const ranges: { readonly start: number; readonly end: number }[] = [];

  let queryIdx = 0;
  let rangeStart = -1;

  for (let i = 0; i < lowerTarget.length && queryIdx < lowerQuery.length; i++) {
    if (lowerTarget[i] === lowerQuery[queryIdx]) {
      if (rangeStart === -1) rangeStart = i;
      queryIdx++;
    } else if (rangeStart !== -1) {
      ranges.push({ start: rangeStart, end: i });
      rangeStart = -1;
    }
  }

  if (rangeStart !== -1) {
    ranges.push({ start: rangeStart, end: rangeStart + (queryIdx - ranges.reduce((s, r) => s + r.end - r.start, 0)) });
  }

  return ranges;
}

// ── Default Commands ──────────────────────────────────

/**
 * Callback interface for command palette actions that need runtime access.
 */
export interface PaletteActionCallbacks {
  readonly enhancePrompt: () => void;
  readonly newConversation: () => void;
  readonly clearHistory: () => void;
  readonly openSettings: () => void;
  readonly switchModel: () => void;
  readonly toggleMode: () => void;
  readonly showCost: () => void;
  readonly showMemory: () => void;
  readonly showProviders: () => void;
  readonly showHelp: () => void;
  readonly showHealth: () => void;
  readonly showFleet: () => void;
  readonly compactContext: () => void;
}

/**
 * Create the default set of palette commands.
 * Prompt Enhance is listed first as it is a key WOTANN differentiator.
 */
export function createDefaultPaletteCommands(callbacks: PaletteActionCallbacks): readonly PaletteCommand[] {
  return [
    // Prompt Enhance — top command, key differentiator
    {
      id: "prompt-enhance",
      label: "Enhance Prompt",
      description: "Supercharge your prompt with AI-powered rewriting for clarity and specificity",
      shortcut: "Cmd+E",
      icon: "sparkles",
      category: "intelligence",
      action: callbacks.enhancePrompt,
      keywords: ["enhance", "improve", "rewrite", "prompt", "ai", "supercharge", "magic"],
    },
    // Session commands
    {
      id: "new-conversation",
      label: "New Conversation",
      description: "Start a fresh conversation",
      shortcut: "Cmd+N",
      icon: "plus",
      category: "session",
      action: callbacks.newConversation,
      keywords: ["new", "fresh", "start", "conversation", "chat"],
    },
    {
      id: "clear-history",
      label: "Clear History",
      description: "Clear the current conversation",
      shortcut: "Cmd+L",
      icon: "trash",
      category: "session",
      action: callbacks.clearHistory,
      keywords: ["clear", "reset", "clean"],
    },
    // Intelligence commands
    {
      id: "switch-model",
      label: "Switch Model",
      description: "Change the active AI model",
      icon: "cpu",
      category: "model",
      action: callbacks.switchModel,
      keywords: ["model", "switch", "change", "provider", "claude", "gpt", "gemini"],
    },
    {
      id: "toggle-mode",
      label: "Toggle Mode",
      description: "Cycle through WOTANN modes (default, plan, auto, bypass)",
      icon: "toggle",
      category: "mode",
      action: callbacks.toggleMode,
      keywords: ["mode", "plan", "auto", "bypass", "toggle"],
    },
    {
      id: "codebase-health",
      label: "Codebase Health",
      description: "Analyze project health: file sizes, TODOs, dead code, test coverage",
      icon: "heart-pulse",
      category: "intelligence",
      action: callbacks.showHealth,
      keywords: ["health", "quality", "score", "analysis", "debt"],
    },
    {
      id: "agent-fleet",
      label: "Agent Fleet Dashboard",
      description: "Monitor parallel agents: status, tokens, cost, progress",
      icon: "users",
      category: "intelligence",
      action: callbacks.showFleet,
      keywords: ["fleet", "agents", "parallel", "monitor", "dashboard"],
    },
    // Diagnostics
    {
      id: "show-cost",
      label: "Cost Dashboard",
      description: "View token usage and cost breakdown by provider",
      icon: "dollar",
      category: "diagnostics",
      action: callbacks.showCost,
      keywords: ["cost", "tokens", "usage", "spending", "budget"],
    },
    {
      id: "show-memory",
      label: "Memory Search",
      description: "Search cross-session memory",
      icon: "brain",
      category: "tools",
      action: callbacks.showMemory,
      keywords: ["memory", "search", "recall", "history"],
    },
    {
      id: "show-providers",
      label: "Providers",
      description: "View provider status and API key configuration",
      icon: "cloud",
      category: "diagnostics",
      action: callbacks.showProviders,
      keywords: ["providers", "api", "keys", "status", "auth"],
    },
    {
      id: "compact-context",
      label: "Compact Context",
      description: "Compact the context window to free up space",
      icon: "compress",
      category: "tools",
      action: callbacks.compactContext,
      keywords: ["compact", "context", "compress", "free", "space"],
    },
    // Settings
    {
      id: "open-settings",
      label: "Settings",
      description: "Open WOTANN settings",
      shortcut: "Cmd+,",
      icon: "gear",
      category: "settings",
      action: callbacks.openSettings,
      keywords: ["settings", "preferences", "config", "options"],
    },
    {
      id: "show-help",
      label: "Help",
      description: "Show available commands and keyboard shortcuts",
      shortcut: "Cmd+?",
      icon: "question",
      category: "session",
      action: callbacks.showHelp,
      keywords: ["help", "commands", "shortcuts", "docs"],
    },
  ];
}
