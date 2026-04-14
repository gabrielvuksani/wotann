import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bootstrapInteractiveSession } from "../../src/ui/bootstrap.js";

describe("interactive bootstrap", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createTempWorkspace(): string {
    return mkdtempSync(join(tmpdir(), "wotann-bootstrap-"));
  }

  function stubProviderEnv(): void {
    vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("CODEX_API_KEY", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("HF_TOKEN", "");
    vi.stubEnv("HUGGINGFACE_API_KEY", "");
    vi.stubEnv("HUGGING_FACE_HUB_TOKEN", "");
    vi.stubEnv("OLLAMA_URL", "http://localhost:99999");
  }

  it("creates a full WotannRuntime for a clean workspace", async () => {
    stubProviderEnv();
    const tempDir = createTempWorkspace();

    try {
      const interactive = await bootstrapInteractiveSession(tempDir, { mode: "plan" }, {
        discoverProvidersFn: async () => [],
      });

      expect(interactive.providers.length).toBeGreaterThan(10);
      expect(interactive.providers.every((provider) => provider.available === false)).toBe(true);
      expect(interactive.initialProvider).toBe("anthropic");
      expect(interactive.runtime.getCurrentMode()).toBe("plan");
      expect(interactive.runtime.getStatus().middlewareLayers).toBeGreaterThanOrEqual(25);
      expect(interactive.runtime.getStatus().hookCount).toBeGreaterThan(10);

      const chunks: Array<{ type: string; content: string }> = [];
      for await (const chunk of interactive.runtime.query({ prompt: "hello" })) {
        chunks.push({ type: chunk.type, content: chunk.content });
      }

      expect(chunks[0]?.type).toBe("error");
      expect(chunks[0]?.content).toContain("No providers configured");
      interactive.runtime.close();
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("propagates runtime bootstrap failures instead of hiding them", async () => {
    stubProviderEnv();
    const tempDir = createTempWorkspace();

    try {
      await expect(bootstrapInteractiveSession(tempDir, {}, {
        discoverProvidersFn: async () => [],
        createRuntimeFn: async () => {
          throw new Error("runtime exploded");
        },
      })).rejects.toThrow("runtime exploded");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
