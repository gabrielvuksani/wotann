/**
 * Command Registry — TUI ⌘P palette command store.
 *
 * Feature modules register commands; the palette component searches &
 * executes. Single-instance (TUI is single-process) — the shared registry
 * lives as a module-level singleton, but consumers SHOULD hold their own
 * instance for tests to stay isolated. `getSharedRegistry()` is provided
 * for convenience.
 *
 * Design:
 *  - Map-backed by `id` — duplicate registration REPLACES.
 *  - Fuzzy score combines label / keywords / description (label weighted most).
 *  - `search("")` returns ALL commands in insertion order.
 *  - Handler errors bubble out of `execute()` as a `CommandExecutionError`
 *    so the palette can show a toast without crashing the TUI.
 */

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keywords?: readonly string[];
  readonly handler: () => void | Promise<void>;
}

export interface ScoredCommand {
  readonly command: Command;
  readonly score: number;
}

export class CommandExecutionError extends Error {
  public readonly commandId: string;
  public readonly cause: unknown;

  constructor(commandId: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Command "${commandId}" failed: ${message}`);
    this.name = "CommandExecutionError";
    this.commandId = commandId;
    this.cause = cause;
  }
}

/**
 * Fuzzy score — returns 0 for no match, higher = better.
 * - Exact substring at start: 1000
 * - Exact substring elsewhere: 500
 * - All chars in order (subsequence): 100 + consecutive bonus
 */
export function fuzzyScore(query: string, target: string): number {
  if (query.length === 0) return 1; // empty query matches everything
  if (target.length === 0) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Exact substring match — strong signal.
  const idx = t.indexOf(q);
  if (idx === 0) return 1000;
  if (idx > 0) return 500 - Math.min(idx, 100);

  // Subsequence — all query chars in order.
  let qi = 0;
  let score = 0;
  let prevMatch = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      if (ti === prevMatch + 1) score += 15; // consecutive bonus
      // Word boundary bonus (start or after separator)
      if (ti === 0 || /[\s\-_/.]/.test(t[ti - 1] ?? "")) score += 20;
      prevMatch = ti;
      qi++;
    }
  }

  if (qi < q.length) return 0; // not all chars matched
  return 100 + score;
}

export class CommandRegistry {
  private readonly commands: Map<string, Command> = new Map();

  register(cmd: Command): void {
    if (cmd.id.length === 0) {
      throw new Error("Command id must be non-empty");
    }
    if (cmd.label.length === 0) {
      throw new Error(`Command "${cmd.id}" must have a non-empty label`);
    }
    this.commands.set(cmd.id, cmd);
  }

  unregister(id: string): boolean {
    return this.commands.delete(id);
  }

  /**
   * List all commands in insertion order.
   */
  list(): readonly Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Fuzzy-search commands. Empty query returns all in insertion order.
   * Non-matching commands are omitted.
   */
  search(query: string): readonly ScoredCommand[] {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return this.list().map((command) => ({ command, score: 1 }));
    }

    const results: ScoredCommand[] = [];
    for (const command of this.commands.values()) {
      const labelScore = fuzzyScore(trimmed, command.label);
      const descScore = command.description ? fuzzyScore(trimmed, command.description) * 0.6 : 0;
      const keywordScores = command.keywords?.map((kw) => fuzzyScore(trimmed, kw) * 0.8) ?? [];
      const bestKeyword = keywordScores.length > 0 ? Math.max(...keywordScores) : 0;

      const bestScore = Math.max(labelScore, descScore, bestKeyword);
      if (bestScore > 0) {
        results.push({ command, score: bestScore });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Execute a command. Throws `CommandExecutionError` on handler failure so
   * the palette can render a toast without crashing. Returns the handler's
   * return value (may be a Promise).
   */
  async execute(id: string): Promise<void> {
    const cmd = this.commands.get(id);
    if (!cmd) {
      throw new CommandExecutionError(id, new Error("command not found"));
    }
    try {
      await cmd.handler();
    } catch (err) {
      throw new CommandExecutionError(id, err);
    }
  }

  get size(): number {
    return this.commands.size;
  }

  clear(): void {
    this.commands.clear();
  }
}

// ── Shared registry (module-global singleton) ─────────────────────────
//
// Documented singleton: safe here because the TUI is a single-process,
// single-App instance. Tests SHOULD create their own CommandRegistry to
// stay isolated — see tests/ui/command-registry.test.ts.

let sharedInstance: CommandRegistry | null = null;

export function getSharedRegistry(): CommandRegistry {
  if (!sharedInstance) {
    sharedInstance = new CommandRegistry();
  }
  return sharedInstance;
}

export function resetSharedRegistry(): void {
  sharedInstance = null;
}
