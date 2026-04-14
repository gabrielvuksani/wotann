import { describe, it, expect, afterEach } from "vitest";
import { createSession, addMessage, saveSession, restoreSession, formatSessionStats } from "../../src/core/session.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Session Persistence", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("saves and restores a session", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-session-test-"));
    const session = createSession("anthropic", "claude-sonnet-4-6");
    const withMessage = addMessage(session, {
      role: "user",
      content: "Hello world",
    });

    const filePath = saveSession(withMessage, tempDir);
    expect(filePath).toContain(withMessage.id);

    const restored = restoreSession(filePath);
    expect(restored).not.toBeNull();
    expect(restored?.id).toBe(withMessage.id);
    expect(restored?.provider).toBe("anthropic");
    expect(restored?.model).toBe("claude-sonnet-4-6");
    expect(restored?.messages).toHaveLength(1);
    expect(restored?.messages[0]?.content).toBe("Hello world");
  });

  it("returns null for nonexistent session file", () => {
    const result = restoreSession("/nonexistent/session.json");
    expect(result).toBeNull();
  });

  it("preserves token and cost tracking", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-session-test-"));
    const session = createSession("codex", "codexspark");
    const withTokens = addMessage(session, {
      role: "assistant",
      content: "Response",
      tokensUsed: 1500,
      cost: 0.03,
    });

    const filePath = saveSession(withTokens, tempDir);
    const restored = restoreSession(filePath);

    expect(restored?.totalTokens).toBe(1500);
    expect(restored?.totalCost).toBe(0.03);
  });

  it("formats session stats correctly", () => {
    const session = createSession("ollama", "qwen3.5");
    const stats = formatSessionStats(session);

    expect(stats).toContain("Session:");
    expect(stats).toContain("ollama");
    expect(stats).toContain("qwen3.5");
    expect(stats).toContain("Tokens:");
    expect(stats).toContain("Cost:");
  });
});
