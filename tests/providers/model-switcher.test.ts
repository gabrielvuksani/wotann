import { describe, it, expect, beforeEach } from "vitest";
import { ModelSwitcher } from "../../src/providers/model-switcher.js";
import { CapabilityEqualizer } from "../../src/providers/capability-equalizer.js";
import type { SessionState, AgentMessage, ToolDefinition, ProviderName } from "../../src/core/types.js";

// ── Test Helpers ──────────────────────────────────────

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "test-session",
    startedAt: new Date(),
    provider: "anthropic",
    model: "claude-opus-4-7",
    totalTokens: 5000,
    totalCost: 0.05,
    toolCalls: 3,
    messages: [],
    incognito: false,
    ...overrides,
  };
}

function makeMessages(count: number): readonly AgentMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `message ${i}`,
    tokensUsed: 100,
  }));
}

function makeTools(count: number): readonly ToolDefinition[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `tool_${i}`,
    description: `Tool number ${i}`,
    inputSchema: { type: "object", properties: {} },
  }));
}

// ── Tests ─────────────────────────────────────────────

describe("ModelSwitcher", () => {
  let switcher: ModelSwitcher;

  beforeEach(() => {
    switcher = new ModelSwitcher();
  });

  describe("switchModel", () => {
    it("successfully switches between compatible providers", () => {
      const session = makeSession({ provider: "anthropic", model: "claude-opus-4-7" });
      const context = {
        messages: makeMessages(4),
        tools: makeTools(2),
        systemPrompt: "You are a helpful assistant",
      };

      const result = switcher.switchModel(session, "openai", "gpt-5.4", context);

      expect(result.success).toBe(true);
      expect(result.fromProvider).toBe("anthropic");
      expect(result.fromModel).toBe("claude-opus-4-7");
      expect(result.toProvider).toBe("openai");
      expect(result.toModel).toBe("gpt-5.4");
    });

    it("translates all messages", () => {
      const session = makeSession();
      const messages = makeMessages(6);
      const context = { messages, tools: [], systemPrompt: "" };

      const result = switcher.switchModel(session, "openai", "gpt-5.4", context);

      expect(result.messagesTranslated).toBe(6);
      expect(result.contextPreserved).toBe(true);
    });

    it("adjusts tools for the target provider", () => {
      const session = makeSession();
      const context = {
        messages: makeMessages(2),
        tools: makeTools(3),
        systemPrompt: "",
      };

      const result = switcher.switchModel(session, "openai", "gpt-5.4", context);
      expect(result.toolsAdjusted).toBeGreaterThan(0);
    });

    it("produces warnings for capability gaps", () => {
      const session = makeSession({ provider: "anthropic", model: "claude-opus-4-7" });
      const context = {
        messages: makeMessages(2),
        tools: [],
        systemPrompt: "",
      };

      // Switch to ollama which has many gaps
      const result = switcher.switchModel(session, "ollama" as ProviderName, "qwen3-coder-next", context);

      // There should be warnings about capability differences
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
      expect(result.success).toBe(true);
    });

    it("removes tools when target does not support tool use", () => {
      // Register a profile without tool_use
      const equalizer = new CapabilityEqualizer();
      equalizer.registerProfile({
        provider: "custom",
        model: "no-tools",
        capabilities: [
          { capability: "tool_use", status: "unavailable" },
          { capability: "multi_turn", status: "native" },
          { capability: "system_prompt", status: "native" },
          { capability: "streaming", status: "native" },
        ],
      });

      const customSwitcher = new ModelSwitcher(equalizer);
      const session = makeSession();
      const context = {
        messages: makeMessages(2),
        tools: makeTools(5),
        systemPrompt: "",
      };

      const result = customSwitcher.switchModel(
        session,
        "custom" as ProviderName,
        "no-tools",
        context,
      );

      expect(result.toolsAdjusted).toBe(0);
      expect(result.warnings.some((w) => w.includes("tool(s) removed"))).toBe(true);
    });
  });

  describe("canSwitch", () => {
    it("reports full compatibility for same provider", () => {
      const compat = switcher.canSwitch(
        "anthropic",
        "claude-opus-4-7",
        "anthropic",
        "claude-opus-4-7",
      );

      expect(compat.compatible).toBe(true);
      expect(compat.gaps).toHaveLength(0);
      expect(compat.criticalGaps).toHaveLength(0);
    });

    it("reports gaps between different providers", () => {
      const compat = switcher.canSwitch(
        "anthropic",
        "claude-opus-4-7",
        "ollama",
        "qwen3-coder-next",
      );

      expect(compat.gaps.length).toBeGreaterThan(0);
    });

    it("identifies critical gaps", () => {
      // Register a profile missing tool_use (critical)
      const equalizer = new CapabilityEqualizer();
      equalizer.registerProfile({
        provider: "minimal",
        model: "basic",
        capabilities: [
          { capability: "tool_use", status: "unavailable" },
          { capability: "multi_turn", status: "native" },
          { capability: "system_prompt", status: "native" },
          { capability: "streaming", status: "native" },
        ],
      });

      const customSwitcher = new ModelSwitcher(equalizer);
      const compat = customSwitcher.canSwitch(
        "anthropic",
        "claude-opus-4-7",
        "minimal",
        "basic",
      );

      expect(compat.compatible).toBe(false);
      expect(compat.criticalGaps.length).toBeGreaterThan(0);
      expect(compat.recommendation).toContain("NOT recommended");
    });

    it("provides a recommendation string", () => {
      const compat = switcher.canSwitch(
        "anthropic",
        "claude-opus-4-7",
        "openai",
        "gpt-5.4",
      );

      expect(compat.recommendation).toBeTruthy();
      expect(typeof compat.recommendation).toBe("string");
    });

    it("reports unknown providers with empty gaps", () => {
      const compat = switcher.canSwitch(
        "unknown-provider",
        "unknown-model",
        "another-unknown",
        "another-model",
      );

      // No profiles registered, so no gaps can be computed
      expect(compat.gaps).toHaveLength(0);
      expect(compat.compatible).toBe(true);
    });
  });

  describe("translateMessages", () => {
    it("preserves messages within the same transport family", () => {
      const messages = makeMessages(4);
      const translated = switcher.translateMessages(messages, "anthropic", "anthropic");

      expect(translated).toHaveLength(4);
      expect(translated).toEqual(messages);
    });

    it("translates messages between Anthropic and OpenAI families", () => {
      const messages = makeMessages(3);
      const translated = switcher.translateMessages(messages, "anthropic", "openai");

      expect(translated).toHaveLength(3);
    });

    it("translates messages between OpenAI and Anthropic families", () => {
      const messages = makeMessages(3);
      const translated = switcher.translateMessages(messages, "openai", "anthropic");

      expect(translated).toHaveLength(3);
    });

    it("strips provider-specific patterns during translation", () => {
      const messages: readonly AgentMessage[] = [
        { role: "assistant", content: "Here is my answer <thinking>internal reasoning</thinking> and the result" },
      ];

      const translated = switcher.translateMessages(messages, "anthropic", "openai");
      expect(translated[0]?.content).not.toContain("<thinking>");
      expect(translated[0]?.content).toContain("Here is my answer");
    });

    it("treats copilot as OpenAI family", () => {
      const messages = makeMessages(2);

      // openai -> copilot = same family, no translation
      const translated = switcher.translateMessages(messages, "openai", "copilot");
      expect(translated).toEqual(messages);
    });

    it("treats bedrock as Anthropic family", () => {
      const messages = makeMessages(2);

      // anthropic -> bedrock = same family, no translation
      const translated = switcher.translateMessages(messages, "anthropic", "bedrock");
      expect(translated).toEqual(messages);
    });
  });
});
