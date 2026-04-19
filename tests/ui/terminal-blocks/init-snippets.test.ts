/**
 * Shell init snippet tests — verify the generated scripts contain all four
 * OSC 133 markers and match each shell's idiomatic hook mechanism.
 */

import { describe, it, expect } from "vitest";
import {
  buildShellInit,
  isSupportedShell,
  SUPPORTED_SHELLS,
} from "../../../src/ui/terminal-blocks/init-snippets.js";

describe("buildShellInit — zsh", () => {
  it("emits all four OSC 133 markers", () => {
    const init = buildShellInit("zsh");
    expect(init.script).toContain("133;A");
    expect(init.script).toContain("133;B");
    expect(init.script).toContain("133;C");
    expect(init.script).toContain("133;D");
  });

  it("uses zsh's add-zsh-hook for precmd/preexec", () => {
    const init = buildShellInit("zsh");
    expect(init.script).toContain("add-zsh-hook precmd");
    expect(init.script).toContain("add-zsh-hook preexec");
  });

  it("returns the expected filename + sourceLine", () => {
    const init = buildShellInit("zsh");
    expect(init.filename).toBe("wotann.zsh");
    expect(init.sourceLine).toBe("source ~/.wotann/shell/wotann.zsh");
    expect(init.rcPath).toBe("~/.zshrc");
  });
});

describe("buildShellInit — bash", () => {
  it("emits all four OSC 133 markers", () => {
    const init = buildShellInit("bash");
    expect(init.script).toContain("133;A");
    expect(init.script).toContain("133;B");
    expect(init.script).toContain("133;C");
    expect(init.script).toContain("133;D");
  });

  it("uses DEBUG trap + PROMPT_COMMAND", () => {
    const init = buildShellInit("bash");
    expect(init.script).toContain("trap '__wotann_osc133_debug_trap' DEBUG");
    expect(init.script).toContain("PROMPT_COMMAND");
  });

  it("guards against double-install in PROMPT_COMMAND", () => {
    const init = buildShellInit("bash");
    // Should have an idempotency check so re-sourcing doesn't stack the hook.
    expect(init.script).toContain("!= *__wotann_osc133_prompt*");
  });
});

describe("buildShellInit — fish", () => {
  it("emits all four OSC 133 markers", () => {
    const init = buildShellInit("fish");
    expect(init.script).toContain("133;A");
    expect(init.script).toContain("133;B");
    expect(init.script).toContain("133;C");
    expect(init.script).toContain("133;D");
  });

  it("uses fish event hooks", () => {
    const init = buildShellInit("fish");
    expect(init.script).toContain("--on-event fish_prompt");
    expect(init.script).toContain("--on-event fish_preexec");
    expect(init.script).toContain("--on-event fish_postexec");
  });

  it("uses $status for the exit code (fish convention)", () => {
    const init = buildShellInit("fish");
    expect(init.script).toContain("$status");
  });
});

describe("buildShellInit — common guarantees", () => {
  it("all shells produce a non-empty script with a source line", () => {
    for (const shell of SUPPORTED_SHELLS) {
      const init = buildShellInit(shell);
      expect(init.script.length).toBeGreaterThan(100);
      expect(init.sourceLine).toContain(init.filename);
      expect(init.sourceLine.startsWith("source ")).toBe(true);
    }
  });

  it("does not include any dangerous eval/exec patterns in generated scripts", () => {
    // Quality bar: generated shell scripts must be purely declarative — no
    // eval, no curl|sh, no network calls. Just hooks that printf escape codes.
    for (const shell of SUPPORTED_SHELLS) {
      const init = buildShellInit(shell);
      expect(init.script).not.toMatch(/\beval\b/);
      expect(init.script).not.toMatch(/\bcurl\b/);
      expect(init.script).not.toMatch(/\bwget\b/);
    }
  });
});

describe("isSupportedShell", () => {
  it("accepts all listed shells", () => {
    for (const shell of SUPPORTED_SHELLS) {
      expect(isSupportedShell(shell)).toBe(true);
    }
  });

  it("rejects unknown shells", () => {
    expect(isSupportedShell("powershell")).toBe(false);
    expect(isSupportedShell("")).toBe(false);
    expect(isSupportedShell("ZSH")).toBe(false); // case-sensitive
  });
});
