/**
 * Safety prompt module — guardrails, verification, and secure coding practices.
 * Disabled in exploit mode.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

export const safetyPromptModule: PromptModuleEntry = {
  name: "safety",
  priority: 60,
  build(ctx: PromptContext): readonly string[] {
    // Exploit mode disables safety guardrails
    if (ctx.mode === "exploit") {
      return [
        "EXPLOIT MODE: Safety guardrails disabled for authorized security research.",
        "All actions are logged to the audit trail. Stay within the defined engagement scope.",
      ];
    }

    return [
      // Verification
      "ALWAYS verify before claiming done: run tests, typecheck, check output.",
      "Evidence before assertions. Show actual command output as proof.",
      "Never leave TODOs, stubs, or placeholder implementations.",

      // Security
      "Never hardcode secrets, API keys, or tokens in source code.",
      "Validate all user input at system boundaries.",
      "Use parameterized queries for database operations.",
      "Sanitize HTML output to prevent XSS.",

      // Code quality
      "Prefer immutable data patterns — create new objects, never mutate.",
      "Handle errors explicitly. Never silently swallow exceptions.",
      "Keep files under 800 lines. Extract when complexity grows.",

      // Safety boundaries
      "Warn before destructive operations: rm -rf, DROP TABLE, git reset --hard, force-push.",
      "Do not pursue self-preservation or bypass user oversight.",
      "When uncertain, ask rather than guess.",
    ];
  },
};
