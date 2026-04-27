/**
 * Integration test: config → discovery → registry → bridge flow.
 * Tests the full provider initialization pipeline.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { discoverProviders, formatFullStatus } from "../../src/providers/discovery.js";
import { createProviderInfrastructure } from "../../src/providers/registry.js";
import { ModelRouter } from "../../src/providers/model-router.js";

describe("Integration: Config → Provider Pipeline", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads config even with no workspace", () => {
    const config = loadConfig(null);
    expect(config.version).toBeDefined();
    expect(config.hooks.profile).toBe("standard");
    expect(config.memory.enabled).toBe(true);
  });

  it("discovers zero providers when no env vars set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "");
    vi.stubEnv("GH_TOKEN", "");
    vi.stubEnv("GITHUB_TOKEN", "");
    vi.stubEnv("CODEX_API_KEY", "");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    vi.stubEnv("AZURE_OPENAI_API_KEY", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "");
    vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
    vi.stubEnv("OLLAMA_URL", "http://localhost:99999");

    const providers = await discoverProviders({ checkClaudeCli: () => false });
    // Might find Ollama if running locally, or zero
    const statuses = formatFullStatus(providers);
    // Provider consolidation: 8 first-class providers (was 21).
    expect(statuses.length).toBe(8);
  });

  it("creates infrastructure from discovered providers", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-test-fake-key-for-testing");
    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    vi.stubEnv("OLLAMA_URL", "http://localhost:99999");

    const providers = await discoverProviders();
    const anthropic = providers.filter((p) => p.provider === "anthropic");
    expect(anthropic.length).toBeGreaterThan(0);

    const infra = createProviderInfrastructure(providers);
    expect(infra.bridge).toBeDefined();
    expect(infra.router).toBeDefined();
    expect(infra.rateLimiter).toBeDefined();
    expect(infra.adapters.size).toBeGreaterThan(0);
  });

  it("model router routes code tasks to fast frontier", () => {
    const router = new ModelRouter({
      availableProviders: new Set(["anthropic", "openai"]) as ReadonlySet<any>,
      ollamaModels: [],
    });

    const decision = router.route({
      category: "code",
      requiresComputerUse: false,
      requiresVision: false,
      estimatedTokens: 500,
      priority: "latency",
    });

    expect(decision.tier).toBeLessThanOrEqual(2);
    expect(["anthropic", "openai"]).toContain(decision.provider);
  });
});
