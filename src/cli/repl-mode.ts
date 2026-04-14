/**
 * REPL Mode — interactive code execution with AI suggestions.
 *
 * `wotann repl --language typescript` opens an interactive loop:
 *   1. Read user input (code snippet or natural language)
 *   2. Execute the code in a sandboxed subprocess
 *   3. Show the result
 *   4. AI suggests the next step based on the execution result
 *
 * Design:
 * - Language-specific execution via child_process (no eval)
 * - Conversation history maintained for AI context
 * - Clean exit on Ctrl+C or "exit"/"quit"
 * - Immutable options and history entries
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { execFile } from "node:child_process";

// ── Types ────────────────────────────────────────────────

export type REPLLanguage = "typescript" | "python" | "javascript";

export interface REPLOptions {
  readonly language: REPLLanguage;
  readonly provider?: string;
  readonly model?: string;
}

export interface REPLHistoryEntry {
  readonly input: string;
  readonly output: string;
  readonly error: string;
  readonly exitCode: number;
  readonly timestamp: number;
}

export type REPLSuggester = (
  history: readonly REPLHistoryEntry[],
  language: REPLLanguage,
) => Promise<string>;

// ── Constants ────────────────────────────────────────────

const EXIT_COMMANDS: ReadonlySet<string> = new Set([
  "exit",
  "quit",
  ".exit",
  ".quit",
]);

const LANGUAGE_CONFIG: Readonly<Record<REPLLanguage, {
  readonly command: string;
  readonly args: readonly string[];
  readonly prompt: string;
  readonly fileExt: string;
}>> = {
  typescript: {
    command: "npx",
    args: ["tsx", "--eval"],
    prompt: "ts> ",
    fileExt: ".ts",
  },
  javascript: {
    command: "node",
    args: ["--eval"],
    prompt: "js> ",
    fileExt: ".js",
  },
  python: {
    command: "python3",
    args: ["-c"],
    prompt: "py> ",
    fileExt: ".py",
  },
};

const EXECUTION_TIMEOUT_MS = 30_000;

// ── Code Executor ────────────────────────────────────────

/**
 * Execute a code snippet in the appropriate language runtime.
 * Returns stdout, stderr, and exit code.
 */
export function executeCode(
  code: string,
  language: REPLLanguage,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const config = LANGUAGE_CONFIG[language];

  return new Promise((resolve) => {
    const args = [...config.args, code];

    execFile(
      config.command,
      args,
      { timeout: EXECUTION_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const exitCode = error && "code" in error && typeof error.code === "number"
          ? error.code
          : error ? 1 : 0;
        resolve({
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode,
        });
      },
    );
  });
}

// ── History Builder ──────────────────────────────────────

/**
 * Build a context summary from REPL history for the AI suggester.
 * Returns a condensed view of recent interactions.
 */
export function buildHistoryContext(
  history: readonly REPLHistoryEntry[],
  maxEntries: number = 10,
): string {
  const recent = history.slice(-maxEntries);
  if (recent.length === 0) return "No previous interactions.";

  return recent.map((entry, i) => {
    const parts = [`[${i + 1}] Input: ${entry.input}`];
    if (entry.output.trim()) parts.push(`    Output: ${entry.output.trim()}`);
    if (entry.error.trim()) parts.push(`    Error: ${entry.error.trim()}`);
    return parts.join("\n");
  }).join("\n\n");
}

// ── REPL Mode ────────────────────────────────────────────

export class REPLMode {
  private history: REPLHistoryEntry[] = [];
  private rl: ReadlineInterface | null = null;

  /**
   * Start the interactive REPL loop.
   *
   * @param options - Language and optional provider/model configuration
   * @param suggester - Optional AI suggestion function called after each execution
   * @param outputFn - Function to write output (defaults to console.log, injectable for testing)
   */
  async start(
    options: REPLOptions,
    suggester?: REPLSuggester,
    outputFn: (text: string) => void = console.log,
  ): Promise<void> {
    const config = LANGUAGE_CONFIG[options.language];

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    outputFn(`WOTANN REPL (${options.language}) — type "exit" to quit`);
    outputFn("");

    try {
      await this.runLoop(config.prompt, options.language, suggester, outputFn);
    } finally {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Get the current REPL history (immutable snapshot).
   */
  getHistory(): readonly REPLHistoryEntry[] {
    return [...this.history];
  }

  // ── Private ────────────────────────────────────────────

  private async runLoop(
    prompt: string,
    language: REPLLanguage,
    suggester: REPLSuggester | undefined,
    outputFn: (text: string) => void,
  ): Promise<void> {
    while (true) {
      const input = await this.readLine(prompt);

      if (input === null || EXIT_COMMANDS.has(input.trim().toLowerCase())) {
        outputFn("Goodbye.");
        break;
      }

      const trimmed = input.trim();
      if (trimmed.length === 0) continue;

      // Execute the code
      const result = await executeCode(trimmed, language);

      // Display result
      if (result.stdout.trim()) {
        outputFn(result.stdout.trimEnd());
      }
      if (result.stderr.trim()) {
        outputFn(`[stderr] ${result.stderr.trimEnd()}`);
      }

      // Record history
      const entry: REPLHistoryEntry = {
        input: trimmed,
        output: result.stdout,
        error: result.stderr,
        exitCode: result.exitCode,
        timestamp: Date.now(),
      };
      this.history = [...this.history, entry];

      // AI suggestion (if available)
      if (suggester) {
        try {
          const suggestion = await suggester(this.history, language);
          if (suggestion.trim()) {
            outputFn(`\n[suggestion] ${suggestion.trim()}\n`);
          }
        } catch {
          // Suggestion failure is non-fatal — skip silently
        }
      }
    }
  }

  private readLine(prompt: string): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);
        return;
      }
      this.rl.question(prompt, (answer) => {
        resolve(answer);
      });
      // Handle Ctrl+C / Ctrl+D
      this.rl.once("close", () => {
        resolve(null);
      });
    });
  }
}
