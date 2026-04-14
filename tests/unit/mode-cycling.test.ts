import { describe, it, expect } from "vitest";
import { ModeCycler } from "../../src/core/mode-cycling.js";

describe("Mode Cycling", () => {
  it("starts in default mode", () => {
    const cycler = new ModeCycler();
    expect(cycler.getModeName()).toBe("default");
    expect(cycler.getMode().allowWrites).toBe(true);
  });

  it("cycles through modes in order", () => {
    const cycler = new ModeCycler();
    expect(cycler.getModeName()).toBe("default");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("plan");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("acceptEdits");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("auto");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("bypass");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("autonomous");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("focus");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("interview");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("teach");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("review");

    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("exploit");

    // Wraps back to default
    cycler.cycleNext();
    expect(cycler.getModeName()).toBe("default");
  });

  it("plan mode disables writes", () => {
    const cycler = new ModeCycler();
    cycler.setMode("plan");
    expect(cycler.isAllowed("write")).toBe(false);
    expect(cycler.isAllowed("command")).toBe(false);
  });

  it("bypass mode allows dangerous commands", () => {
    const cycler = new ModeCycler();
    cycler.setMode("bypass");
    expect(cycler.isAllowed("dangerous")).toBe(true);
  });

  it("guardrails-off (alias for exploit) requires confirmation", () => {
    const cycler = new ModeCycler();
    const config = cycler.getModeConfig("guardrails-off");
    expect(config?.requiresConfirmation).toBe(true);
    expect(config?.warningMessage).toContain("Exploit");
  });

  it("guardrails-off not in cycle order (must be set explicitly)", () => {
    const cycler = new ModeCycler();
    // Cycle through all modes
    for (let i = 0; i < 11; i++) {
      cycler.cycleNext();
      expect(cycler.getModeName()).not.toBe("guardrails-off");
    }
  });

  it("push/pop mode stack", () => {
    const cycler = new ModeCycler();
    cycler.setMode("plan");
    expect(cycler.getModeName()).toBe("plan");

    cycler.pushMode("autonomous");
    expect(cycler.getModeName()).toBe("autonomous");
    expect(cycler.getStackDepth()).toBe(1);

    cycler.popMode();
    expect(cycler.getModeName()).toBe("plan");
    expect(cycler.getStackDepth()).toBe(0);
  });

  it("pop on empty stack returns default", () => {
    const cycler = new ModeCycler();
    cycler.setMode("auto");
    cycler.popMode();
    expect(cycler.getModeName()).toBe("default");
  });

  it("autonomous mode activates verification skills", () => {
    const cycler = new ModeCycler();
    cycler.setMode("autonomous");
    const config = cycler.getMode();
    expect(config.activateSkills).toContain("test-engineer");
    expect(config.activateSkills).toContain("verifier");
    expect(config.autoVerify).toBe(true);
  });

  it("guardrails-off (exploit alias) deactivates safety skills", () => {
    const cycler = new ModeCycler();
    cycler.setMode("guardrails-off");
    const config = cycler.getMode();
    expect(config.deactivateSkills).toContain("careful");
    expect(config.deactivateSkills).toContain("guard");
    expect(config.allowDangerousCommands).toBe(true);
  });

  it("getAllModes returns all 12 modes", () => {
    const cycler = new ModeCycler();
    const modes = cycler.getAllModes();
    expect(modes.length).toBe(12);
    expect(modes.map((m) => m.name)).toContain("guardrails-off");
    expect(modes.map((m) => m.name)).toContain("focus");
    expect(modes.map((m) => m.name)).toContain("interview");
    expect(modes.map((m) => m.name)).toContain("teach");
    expect(modes.map((m) => m.name)).toContain("review");
  });

  it("every mode has merged instructions", () => {
    const cycler = new ModeCycler();
    for (const mode of cycler.getAllModes()) {
      expect(mode.mergedInstructions.length).toBeGreaterThan(10);
    }
  });

  it("plan mode includes planning skill instructions", () => {
    const cycler = new ModeCycler();
    cycler.setMode("plan");
    const instructions = cycler.getMergedInstructions();
    expect(instructions).toContain("PLAN");
    expect(instructions).toContain("Read-only");
  });

  it("autonomous mode includes debugging and verification instructions", () => {
    const cycler = new ModeCycler();
    cycler.setMode("autonomous");
    const instructions = cycler.getMergedInstructions();
    expect(instructions).toContain("AUTONOMOUS");
    expect(instructions).toContain("VERIFY");
    expect(instructions).toContain("DEBUGGING");
  });

  it("guardrails-off clears safety flags", () => {
    const cycler = new ModeCycler();
    cycler.setMode("guardrails-off");
    expect(cycler.shouldClearSafetyFlags()).toBe(true);
    expect(cycler.getMergedInstructions()).toContain("CYBER_RISK_INSTRUCTION");
  });

  it("non-guardrails modes do not clear safety flags", () => {
    const cycler = new ModeCycler();
    for (const mode of ["default", "plan", "auto", "bypass", "autonomous"] as const) {
      cycler.setMode(mode);
      expect(cycler.shouldClearSafetyFlags()).toBe(false);
    }
  });
});
