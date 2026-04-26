import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPrimaryAgentStatuses,
  cycleModel,
  cyclePanel,
  cycleThinkingEffort,
  resolveFileAttachments,
} from "../../src/ui/helpers.js";

describe("ui helpers", () => {
  it("cycles panels in a stable order", () => {
    expect(cyclePanel("diff")).toBe("agents");
    expect(cyclePanel("agents")).toBe("tasks");
    expect(cyclePanel("tasks")).toBe("diff");
  });

  it("cycles thinking effort in a stable order", () => {
    // V9 T14.1a — xhigh sits between `high` and `max` (Opus 4.7 tier,
    // matches Claude Code v2.1.111 parity).
    expect(cycleThinkingEffort("low")).toBe("medium");
    expect(cycleThinkingEffort("medium")).toBe("high");
    expect(cycleThinkingEffort("high")).toBe("xhigh");
    expect(cycleThinkingEffort("xhigh")).toBe("max");
    expect(cycleThinkingEffort("max")).toBe("low");
  });

  it("cycles through available models", () => {
    const next = cycleModel("claude-sonnet-4-7", [
      {
        provider: "anthropic",
        available: true,
        authMethod: "api-key",
        billing: "api-key",
        models: ["claude-sonnet-4-7", "claude-opus-4-7"],
        label: "Anthropic",
      },
      {
        provider: "openai",
        available: true,
        authMethod: "api-key",
        billing: "api-key",
        models: ["gpt-5.4"],
        label: "OpenAI",
      },
    ]);

    expect(next).toBe("claude-opus-4-7");
  });

  it("resolves @file attachments into prompt context", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wotann-attachments-"));

    try {
      mkdirSync(join(tempDir, "src"), { recursive: true });
      writeFileSync(join(tempDir, "src", "demo.ts"), "export const demo = 1;\n");

      const resolved = resolveFileAttachments("review @src/demo.ts", tempDir);
      expect(resolved.attachments).toHaveLength(1);
      expect(resolved.prompt).toContain("Attached file:");
      expect(resolved.prompt).toContain("export const demo = 1;");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("builds a primary agent row for the status panel", () => {
    const agents = buildPrimaryAgentStatuses({
      model: "gpt-5.4",
      isStreaming: true,
      panelMode: "auto",
      turnCount: 3,
    });

    expect(agents[0]?.status).toBe("running");
    expect(agents[0]?.model).toBe("gpt-5.4");
  });
});
