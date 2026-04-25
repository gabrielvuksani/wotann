/**
 * Magic-command resolver — V9 Tier 12 T12.17.
 *
 * Parses a raw user input. Returns either:
 *   - `{ kind: "magic", id, prompt, systemAugment? }` when the input
 *     starts with a known dot-shortcut. The runtime dispatches
 *     `prompt` instead of the raw input.
 *   - `{ kind: "passthrough", prompt }` when the input doesn't
 *     start with any known shortcut. The runtime dispatches the
 *     input verbatim.
 *
 * Pure function. Trivial to test.
 */

import { MAGIC_COMMANDS, getHandler } from "./magic-commands.js";

export type ResolveResult =
  | {
      readonly kind: "magic";
      readonly id: string;
      readonly prompt: string;
      readonly systemAugment?: string;
    }
  | { readonly kind: "passthrough"; readonly prompt: string }
  | { readonly kind: "error"; readonly error: string };

export function resolveMagicInput(rawInput: string): ResolveResult {
  if (typeof rawInput !== "string") {
    return { kind: "error", error: "input must be a string" };
  }
  const trimmed = rawInput.trimStart();
  // Find the longest matching trigger so `.fix` doesn't shadow a
  // hypothetical `.fixup` (defensive even though no such shortcut
  // exists today).
  let matched: { trigger: string; id: string } | null = null;
  for (const cmd of MAGIC_COMMANDS) {
    if (
      trimmed === cmd.trigger ||
      trimmed.startsWith(cmd.trigger + " ") ||
      trimmed.startsWith(cmd.trigger + "\n")
    ) {
      if (!matched || cmd.trigger.length > matched.trigger.length) {
        matched = { trigger: cmd.trigger, id: cmd.id };
      }
    }
  }
  if (!matched) {
    return { kind: "passthrough", prompt: rawInput };
  }
  const remainder = trimmed.slice(matched.trigger.length).trim();
  const handler = getHandler(matched.id as Parameters<typeof getHandler>[0]);
  const result = handler(remainder);
  if (!result.ok) {
    return { kind: "error", error: result.error };
  }
  const out: { kind: "magic"; id: string; prompt: string; systemAugment?: string } = {
    kind: "magic",
    id: matched.id,
    prompt: result.prompt,
  };
  if (result.systemAugment !== undefined) {
    return { ...out, systemAugment: result.systemAugment };
  }
  return out;
}
