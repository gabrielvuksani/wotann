/**
 * Magic Commands palette — V9 Tier 12 T12.17 (Jean port).
 *
 * Quick-action shortcuts (`.fix`, `.test`, `.review`, etc.) that
 * users type at the start of a prompt to trigger pre-canned agent
 * workflows. The user types `.fix` instead of "please fix this code"
 * and gets the same result with one fewer keystroke.
 */

/**
 * The complete set of magic command IDs. Adding a new one requires:
 *   1. Add the id here.
 *   2. Add an entry to `MAGIC_COMMANDS` in magic-commands.ts.
 *   3. Create a handler in handlers/<id>.ts.
 */
export type MagicCommandId =
  | "fix"
  | "test"
  | "review"
  | "refactor"
  | "explain"
  | "docstring"
  | "format"
  | "optimize";

/**
 * Static metadata for a magic command. Handlers live in their own
 * files so a new shortcut can be added without touching this type.
 */
export interface MagicCommand {
  readonly id: MagicCommandId;
  /** The trigger token, including the leading dot. e.g. `.fix`. */
  readonly trigger: string;
  /** One-line user-facing description shown in `wotann magic list`. */
  readonly description: string;
  /** Suggested tone keywords; the handler maps these to a system prompt. */
  readonly category: "fix" | "review" | "refactor" | "explain" | "format";
}

/**
 * Result of running a magic command. The handler returns a `prompt`
 * — the canonical phrasing the runtime should send to the model —
 * plus optional system-prompt augmentation. The CLI dispatches the
 * prompt through the normal runtime path.
 */
export interface MagicCommandResult {
  readonly ok: true;
  /** The expanded user prompt the runtime sends to the model. */
  readonly prompt: string;
  /** Optional addendum to the system prompt for this turn. */
  readonly systemAugment?: string;
}

export interface MagicCommandFailure {
  readonly ok: false;
  readonly error: string;
}

/**
 * A handler turns a user-supplied input string into a prompt the
 * runtime can dispatch. The handler receives the input AFTER the
 * `.fix ` (or similar) prefix has been stripped.
 */
export type MagicCommandHandler = (input: string) => MagicCommandResult | MagicCommandFailure;
