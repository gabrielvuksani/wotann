/**
 * `wotann magic` — V9 Tier 12 T12.17 wire.
 *
 * The 15 dot-shortcut handlers in `src/magic/handlers/` (.fix, .test,
 * .review, .refactor, .explain, .docstring, .format, .optimize,
 * .investigate-issue, .investigate-pr, .investigate-workflow,
 * .ai-commit, .pr-content, .merge-conflict, .release-notes) were
 * previously unreachable from any CLI surface. This module exposes
 * `runMagicCommand` so a `wotann magic <command> [args...]` verb can
 * invoke any of them and emit the expanded prompt + optional system
 * augmentation back to the caller.
 *
 * Honest envelope: handlers that fail validation surface the error
 * verbatim. An unknown command returns a structured error rather than
 * throwing — callers may inspect `ok` to decide exit codes.
 */

import { MAGIC_COMMANDS, getHandler } from "../../magic/magic-commands.js";
import type { MagicCommandId } from "../../magic/types.js";

export interface RunMagicCommandOptions {
  readonly command: string;
  readonly args: readonly string[];
}

export interface RunMagicCommandResult {
  readonly ok: boolean;
  readonly output?: string;
  readonly error?: string;
}

/**
 * Resolve a magic command by id (e.g. "fix") OR full trigger
 * (e.g. ".fix"). Returns the matched id or null if unknown.
 */
function resolveCommandId(raw: string): MagicCommandId | null {
  const normalized = raw.trim().replace(/^\./, "");
  for (const cmd of MAGIC_COMMANDS) {
    if (cmd.id === normalized) return cmd.id;
  }
  return null;
}

/**
 * Invoke a magic handler with positional args joined as the input
 * payload. Mirrors `resolveMagicInput` semantics — args after the
 * command name become the user-supplied input the handler sees.
 *
 * Pure function: no console writes, no process.exit. The shell decides
 * how to render the envelope.
 */
export function runMagicCommand(opts: RunMagicCommandOptions): RunMagicCommandResult {
  if (typeof opts.command !== "string" || opts.command.trim().length === 0) {
    return { ok: false, error: "magic: command is required" };
  }
  const id = resolveCommandId(opts.command);
  if (id === null) {
    const known = MAGIC_COMMANDS.map((c) => c.id).join(", ");
    return { ok: false, error: `magic: unknown command "${opts.command}". Known: ${known}` };
  }
  const handler = getHandler(id);
  const input = opts.args.join(" ").trim();
  const result = handler(input);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const output =
    result.systemAugment === undefined
      ? result.prompt
      : `${result.prompt}\n\n--- system augment ---\n${result.systemAugment}`;
  return { ok: true, output };
}

/**
 * Help text body — built from MAGIC_COMMANDS so a new shortcut shows up
 * without touching this file. Returned as a string so the caller can
 * inject it into commander's `description` or print it directly.
 */
export function listMagicCommands(): string {
  const lines = MAGIC_COMMANDS.map((c) => `  ${c.id.padEnd(22)} ${c.description}`);
  return ["Available commands:", ...lines].join("\n");
}
