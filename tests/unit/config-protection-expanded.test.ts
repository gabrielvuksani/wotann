import { describe, it, expect, beforeEach } from "vitest";
import { HookEngine } from "../../src/hooks/engine.js";
import { registerBuiltinHooks } from "../../src/hooks/built-in.js";

// Session-4 regression guards for the expanded ConfigProtection pattern
// list. Agent 1 caught that the prior pattern `/\.eslintrc/` did not
// match `eslint.config.js` (ESLint 9 flat config) or modern
// `prettier.config.{js,mjs,cjs,ts}` — so this repo's own
// `eslint.config.js` from commit 81700d2 was silently unprotected by
// ConfigProtection. The autoLint hook already listed these correctly;
// the two hook pattern lists were drifting. These tests pin the fix.

describe("ConfigProtection (expanded)", () => {
  let engine: HookEngine;

  beforeEach(() => {
    engine = new HookEngine("standard");
    registerBuiltinHooks(engine);
  });

  // Each case below would have silently returned "allow" on the prior
  // pattern list. With the expanded patterns they now emit a warn.

  it.each<{ label: string; filePath: string }>([
    { label: "ESLint 9 flat config (this repo's)", filePath: "/proj/eslint.config.js" },
    { label: "ESLint flat config (mjs)", filePath: "/proj/eslint.config.mjs" },
    { label: "ESLint flat config (ts)", filePath: "/proj/eslint.config.ts" },
    { label: "Prettier modern config (js)", filePath: "/proj/prettier.config.js" },
    { label: "Prettier modern config (mjs)", filePath: "/proj/prettier.config.mjs" },
    { label: "vitest.config.ts", filePath: "/proj/vitest.config.ts" },
    { label: "vitest.config.mjs", filePath: "/proj/vitest.config.mjs" },
    { label: "tsconfig variant (base.json)", filePath: "/proj/tsconfig.base.json" },
    { label: "package.json", filePath: "/proj/package.json" },
  ])("warns when modifying $label", async ({ filePath }) => {
    // Read first so the upgraded-to-block ReadBeforeEdit (S2-14) doesn't
    // short-circuit the chain; ConfigProtection itself is a PreToolUse
    // hook so we need the Read marker first.
    await engine.fire({ event: "PreToolUse", toolName: "Read", filePath });

    const result = await engine.fire({
      event: "PreToolUse",
      toolName: "Edit",
      filePath,
    });
    // The enhanced engine surfaces warns alongside the final allow;
    // prior behavior would have returned the default "allow" because
    // no pattern matched. warnings include ConfigProtection's message.
    expect(["allow", "warn"]).toContain(result.action);
    const warningMessages = (result.warnings ?? []).slice();
    const resultMessage = result.message ?? "";
    const matched = warningMessages.some((m) => m.includes(filePath)) ||
      resultMessage.includes(filePath);
    expect(matched).toBe(true);
  });

  it("does NOT warn for an unrelated file (negative control)", async () => {
    await engine.fire({
      event: "PreToolUse",
      toolName: "Read",
      filePath: "/proj/src/unrelated.ts",
    });
    const result = await engine.fire({
      event: "PreToolUse",
      toolName: "Edit",
      filePath: "/proj/src/unrelated.ts",
    });
    const warningMessages = (result.warnings ?? []).slice();
    // ConfigProtection should NOT fire — no warning mentions this file path.
    const triggered = warningMessages.some(
      (m) => m.includes("unrelated.ts") && m.toLowerCase().includes("config"),
    );
    expect(triggered).toBe(false);
  });
});
