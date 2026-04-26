/**
 * Capability Equalization Matrix — normalize disparate model capabilities.
 *
 * Each provider/model has different capabilities (tool use, vision, thinking,
 * extended context, function calling, JSON mode, etc.). This matrix tracks
 * every capability per model and provides fallback strategies when switching
 * between providers.
 *
 * When the fallback chain moves from Provider A to Provider B, this module
 * ensures the harness adapts prompts and tool calls to match Provider B's
 * capabilities without losing functionality.
 *
 * From spec §12.3 but goes beyond: now covers 9 providers × 25+ models.
 *
 * Wave DH-1: scoped per-provider model id consts. Each provider's namespace
 * is independent, so its current canonical model id is pinned in this single
 * block. When a provider ships a new flagship version, this is the only
 * place the literal needs to change.
 */

// Anthropic-native and Bedrock-namespaced (Bedrock proxies Claude under the
// same model id format on the routing layer below the `anthropic.` prefix).
const ANTHROPIC_OPUS = "claude-opus-4-7";
const BEDROCK_OPUS = "claude-opus-4-7";

export type CapabilityName =
  | "tool_use"
  | "vision"
  | "thinking"
  | "extended_thinking"
  | "extended_context"
  | "json_mode"
  | "function_calling"
  | "streaming"
  | "prompt_caching"
  | "computer_use"
  | "file_upload"
  | "code_execution"
  | "image_generation"
  | "embeddings"
  | "web_search"
  | "citations"
  | "multi_turn"
  | "system_prompt"
  | "stop_sequences"
  | "logprobs"
  | "seed"
  | "response_format"
  | "parallel_tool_calls"
  | "mcp"
  | "batch_api";

export type CapabilityStatus = "native" | "emulated" | "unavailable" | "degraded";

export interface ModelCapabilityEntry {
  readonly capability: CapabilityName;
  readonly status: CapabilityStatus;
  readonly maxParameter?: number;
  readonly notes?: string;
  readonly emulationStrategy?: string;
}

export interface ModelCapabilityProfile {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: readonly ModelCapabilityEntry[];
}

export interface CapabilityGap {
  readonly capability: CapabilityName;
  readonly sourceStatus: CapabilityStatus;
  readonly targetStatus: CapabilityStatus;
  readonly mitigation: string;
  readonly impactLevel: "none" | "low" | "medium" | "high";
}

// ── Known Model Capabilities ────────────────────────────────

const PROFILES: readonly ModelCapabilityProfile[] = [
  // Claude Opus 4.7
  {
    provider: "anthropic",
    model: ANTHROPIC_OPUS,
    capabilities: [
      { capability: "tool_use", status: "native" },
      { capability: "vision", status: "native" },
      { capability: "thinking", status: "native" },
      {
        capability: "extended_thinking",
        status: "native",
        maxParameter: 128_000,
        notes: "Budget tokens for thinking",
      },
      { capability: "extended_context", status: "native", maxParameter: 1_000_000 },
      {
        capability: "json_mode",
        status: "emulated",
        emulationStrategy: "JSON extraction from response",
      },
      { capability: "function_calling", status: "native", notes: "Via tool_use" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "native" },
      { capability: "computer_use", status: "native" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "unavailable" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "unavailable" },
      { capability: "web_search", status: "native", notes: "Via tool_use connector" },
      { capability: "citations", status: "native" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "unavailable" },
      { capability: "seed", status: "unavailable" },
      { capability: "response_format", status: "emulated" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "native" },
      { capability: "batch_api", status: "native" },
    ],
  },

  // GPT-5.4
  {
    provider: "openai",
    model: "gpt-5.4",
    capabilities: [
      { capability: "tool_use", status: "native", notes: "Via function calling" },
      { capability: "vision", status: "native" },
      { capability: "thinking", status: "native", notes: "o-series reasoning" },
      { capability: "extended_thinking", status: "native" },
      { capability: "extended_context", status: "native", maxParameter: 1_000_000 },
      { capability: "json_mode", status: "native" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "native" },
      { capability: "computer_use", status: "native", notes: "Via Operator" },
      { capability: "file_upload", status: "native" },
      { capability: "code_execution", status: "native", notes: "Code interpreter" },
      { capability: "image_generation", status: "native", notes: "DALL-E integration" },
      { capability: "embeddings", status: "native" },
      { capability: "web_search", status: "native" },
      { capability: "citations", status: "native" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "native" },
      { capability: "seed", status: "native" },
      { capability: "response_format", status: "native" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "native" },
    ],
  },

  // Gemini 2.5 Pro
  {
    provider: "gemini",
    model: "gemini-2.5-pro",
    capabilities: [
      { capability: "tool_use", status: "native" },
      { capability: "vision", status: "native" },
      { capability: "thinking", status: "native" },
      { capability: "extended_thinking", status: "native" },
      { capability: "extended_context", status: "native", maxParameter: 1_000_000 },
      { capability: "json_mode", status: "native" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "native" },
      { capability: "computer_use", status: "unavailable" },
      { capability: "file_upload", status: "native" },
      { capability: "code_execution", status: "native" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "native" },
      { capability: "web_search", status: "native" },
      { capability: "citations", status: "native" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "unavailable" },
      { capability: "seed", status: "unavailable" },
      { capability: "response_format", status: "native" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "unavailable" },
    ],
  },

  // Ollama local
  {
    provider: "ollama",
    model: "qwen3-coder-next",
    capabilities: [
      { capability: "tool_use", status: "native" },
      { capability: "vision", status: "unavailable" },
      { capability: "thinking", status: "native" },
      { capability: "extended_thinking", status: "unavailable" },
      { capability: "extended_context", status: "degraded", maxParameter: 131_072 },
      { capability: "json_mode", status: "emulated" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "unavailable" },
      { capability: "computer_use", status: "unavailable" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "unavailable" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "native" },
      { capability: "web_search", status: "unavailable" },
      { capability: "citations", status: "unavailable" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "unavailable" },
      { capability: "seed", status: "native" },
      { capability: "response_format", status: "emulated" },
      { capability: "parallel_tool_calls", status: "unavailable" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "unavailable" },
    ],
  },

  // Copilot (GitHub Copilot / Codex CLI — runs OpenAI models with code focus)
  {
    provider: "copilot",
    model: "codex-cli",
    capabilities: [
      { capability: "tool_use", status: "native", notes: "Native tool/function calling" },
      { capability: "vision", status: "unavailable" },
      { capability: "thinking", status: "unavailable" },
      { capability: "extended_thinking", status: "unavailable" },
      { capability: "extended_context", status: "native", maxParameter: 128_000 },
      { capability: "json_mode", status: "native" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "unavailable" },
      { capability: "computer_use", status: "unavailable" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "native", notes: "Primary use case" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "unavailable" },
      { capability: "web_search", status: "unavailable" },
      { capability: "citations", status: "unavailable" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "unavailable" },
      { capability: "seed", status: "unavailable" },
      { capability: "response_format", status: "native" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "unavailable" },
    ],
  },

  // DeepSeek R1
  {
    provider: "deepseek",
    model: "deepseek-r1",
    capabilities: [
      { capability: "tool_use", status: "native" },
      { capability: "vision", status: "native" },
      { capability: "thinking", status: "native", notes: "Native chain-of-thought reasoning" },
      { capability: "extended_thinking", status: "native" },
      { capability: "extended_context", status: "native", maxParameter: 128_000 },
      { capability: "json_mode", status: "native" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "native", notes: "Context caching supported" },
      { capability: "computer_use", status: "unavailable" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "unavailable" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "unavailable" },
      { capability: "web_search", status: "native", notes: "DeepSeek web search integration" },
      { capability: "citations", status: "native" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "native" },
      { capability: "seed", status: "native" },
      { capability: "response_format", status: "native" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "unavailable" },
    ],
  },

  // Mistral Large Latest
  {
    provider: "mistral",
    model: "mistral-large-latest",
    capabilities: [
      { capability: "tool_use", status: "native" },
      { capability: "vision", status: "native" },
      {
        capability: "thinking",
        status: "emulated",
        emulationStrategy: "Chain-of-thought prompting",
      },
      { capability: "extended_thinking", status: "unavailable" },
      { capability: "extended_context", status: "native", maxParameter: 128_000 },
      { capability: "json_mode", status: "native" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "unavailable" },
      { capability: "computer_use", status: "unavailable" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "native", notes: "Code execution via tool" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "native", notes: "Mistral embedding models" },
      { capability: "web_search", status: "unavailable" },
      { capability: "citations", status: "unavailable" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "unavailable" },
      { capability: "seed", status: "native" },
      { capability: "response_format", status: "native" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "native" },
    ],
  },

  // xAI Grok-3
  {
    provider: "xai",
    model: "grok-3",
    capabilities: [
      { capability: "tool_use", status: "native" },
      { capability: "vision", status: "native" },
      { capability: "thinking", status: "native", notes: "Grok thinking mode" },
      { capability: "extended_thinking", status: "native" },
      { capability: "extended_context", status: "native", maxParameter: 131_072 },
      { capability: "json_mode", status: "native" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "unavailable" },
      { capability: "computer_use", status: "unavailable" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "unavailable" },
      { capability: "image_generation", status: "native", notes: "Aurora image generation" },
      { capability: "embeddings", status: "unavailable" },
      { capability: "web_search", status: "native", notes: "Live web/X search" },
      { capability: "citations", status: "native" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "unavailable" },
      { capability: "seed", status: "native" },
      { capability: "response_format", status: "native" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "unavailable" },
    ],
  },

  // Azure OpenAI (runs OpenAI models — same capabilities as OpenAI)
  {
    provider: "azure",
    model: "gpt-5.4",
    capabilities: [
      { capability: "tool_use", status: "native", notes: "Via function calling" },
      { capability: "vision", status: "native" },
      { capability: "thinking", status: "native", notes: "o-series reasoning" },
      { capability: "extended_thinking", status: "native" },
      { capability: "extended_context", status: "native", maxParameter: 1_000_000 },
      { capability: "json_mode", status: "native" },
      { capability: "function_calling", status: "native" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "native" },
      { capability: "computer_use", status: "native", notes: "Via Operator" },
      { capability: "file_upload", status: "native" },
      { capability: "code_execution", status: "native", notes: "Code interpreter" },
      { capability: "image_generation", status: "native", notes: "DALL-E integration" },
      { capability: "embeddings", status: "native" },
      { capability: "web_search", status: "native" },
      { capability: "citations", status: "native" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "native" },
      { capability: "seed", status: "native" },
      { capability: "response_format", status: "native" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "native" },
    ],
  },

  // Bedrock (runs Claude models — same capabilities as Anthropic)
  {
    provider: "bedrock",
    model: BEDROCK_OPUS,
    capabilities: [
      { capability: "tool_use", status: "native" },
      { capability: "vision", status: "native" },
      { capability: "thinking", status: "native" },
      {
        capability: "extended_thinking",
        status: "native",
        maxParameter: 128_000,
        notes: "Budget tokens for thinking",
      },
      { capability: "extended_context", status: "native", maxParameter: 1_000_000 },
      {
        capability: "json_mode",
        status: "emulated",
        emulationStrategy: "JSON extraction from response",
      },
      { capability: "function_calling", status: "native", notes: "Via tool_use" },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "native" },
      { capability: "computer_use", status: "native" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "unavailable" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "unavailable" },
      { capability: "web_search", status: "native", notes: "Via tool_use connector" },
      { capability: "citations", status: "native" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "unavailable" },
      { capability: "seed", status: "unavailable" },
      { capability: "response_format", status: "emulated" },
      { capability: "parallel_tool_calls", status: "native" },
      { capability: "mcp", status: "native" },
      { capability: "batch_api", status: "native" },
    ],
  },

  // HuggingFace (open models — most capabilities emulated)
  {
    provider: "huggingface",
    model: "meta-llama-4-70b",
    capabilities: [
      {
        capability: "tool_use",
        status: "emulated",
        emulationStrategy: "Tool-call prompting with structured output parsing",
      },
      {
        capability: "vision",
        status: "emulated",
        emulationStrategy: "Multimodal model variant required",
      },
      {
        capability: "thinking",
        status: "emulated",
        emulationStrategy: "Chain-of-thought prompting",
      },
      { capability: "extended_thinking", status: "unavailable" },
      { capability: "extended_context", status: "native", maxParameter: 128_000 },
      {
        capability: "json_mode",
        status: "emulated",
        emulationStrategy: "JSON instruction in system prompt",
      },
      {
        capability: "function_calling",
        status: "emulated",
        emulationStrategy: "Structured output parsing",
      },
      { capability: "streaming", status: "native" },
      { capability: "prompt_caching", status: "unavailable" },
      { capability: "computer_use", status: "unavailable" },
      { capability: "file_upload", status: "unavailable" },
      { capability: "code_execution", status: "unavailable" },
      { capability: "image_generation", status: "unavailable" },
      { capability: "embeddings", status: "native", notes: "HuggingFace embedding models" },
      { capability: "web_search", status: "unavailable" },
      { capability: "citations", status: "unavailable" },
      { capability: "multi_turn", status: "native" },
      { capability: "system_prompt", status: "native" },
      { capability: "stop_sequences", status: "native" },
      { capability: "logprobs", status: "native" },
      { capability: "seed", status: "native" },
      {
        capability: "response_format",
        status: "emulated",
        emulationStrategy: "Grammar-constrained generation",
      },
      { capability: "parallel_tool_calls", status: "unavailable" },
      { capability: "mcp", status: "unavailable" },
      { capability: "batch_api", status: "unavailable" },
    ],
  },
];

// ── Capability Equalizer ────────────────────────────────────

export class CapabilityEqualizer {
  private readonly profiles: Map<string, ModelCapabilityProfile> = new Map();

  constructor() {
    for (const profile of PROFILES) {
      this.profiles.set(`${profile.provider}:${profile.model}`, profile);
    }
  }

  /** Register a custom capability profile */
  registerProfile(profile: ModelCapabilityProfile): void {
    this.profiles.set(`${profile.provider}:${profile.model}`, profile);
  }

  /** Get a model's capability profile */
  getProfile(provider: string, model: string): ModelCapabilityProfile | null {
    return this.profiles.get(`${provider}:${model}`) ?? null;
  }

  /** Check if a model has a specific capability */
  hasCapability(provider: string, model: string, capability: CapabilityName): CapabilityStatus {
    const profile = this.getProfile(provider, model);
    if (!profile) return "unavailable";

    const entry = profile.capabilities.find((c) => c.capability === capability);
    return entry?.status ?? "unavailable";
  }

  /**
   * Compute capability gaps when switching from source to target provider.
   * Returns mitigation strategies for each gap.
   */
  computeGaps(
    sourceProvider: string,
    sourceModel: string,
    targetProvider: string,
    targetModel: string,
  ): readonly CapabilityGap[] {
    const sourceProfile = this.getProfile(sourceProvider, sourceModel);
    const targetProfile = this.getProfile(targetProvider, targetModel);
    if (!sourceProfile || !targetProfile) return [];

    const gaps: CapabilityGap[] = [];

    for (const sourceCap of sourceProfile.capabilities) {
      if (sourceCap.status === "unavailable") continue; // Can't lose what you don't have

      const targetCap = targetProfile.capabilities.find(
        (c) => c.capability === sourceCap.capability,
      );
      const targetStatus = targetCap?.status ?? "unavailable";

      if (targetStatus !== sourceCap.status) {
        gaps.push({
          capability: sourceCap.capability,
          sourceStatus: sourceCap.status,
          targetStatus,
          mitigation: getMitigation(sourceCap.capability, targetStatus),
          impactLevel: getImpactLevel(sourceCap.capability, sourceCap.status, targetStatus),
        });
      }
    }

    return gaps;
  }

  /**
   * Build a prompt adapter that adjusts tool calls and features
   * when switching between providers.
   */
  buildAdapterPrompt(gaps: readonly CapabilityGap[]): string {
    const highImpact = gaps.filter((g) => g.impactLevel === "high");
    if (highImpact.length === 0) return "";

    const lines = [
      "[Provider Capability Adaptation]",
      "The following features are limited on this provider:",
    ];

    for (const gap of highImpact) {
      lines.push(`- ${gap.capability}: ${gap.mitigation}`);
    }

    return lines.join("\n");
  }

  /** List all tracked profiles */
  listProfiles(): readonly ModelCapabilityProfile[] {
    return [...this.profiles.values()];
  }
}

function getMitigation(capability: CapabilityName, targetStatus: CapabilityStatus): string {
  if (targetStatus === "emulated") return `Using emulation layer for ${capability}`;
  if (targetStatus === "degraded") return `${capability} available with reduced limits`;

  const mitigations: Partial<Record<CapabilityName, string>> = {
    thinking: "Thinking blocks will be simulated via chain-of-thought prompting",
    extended_thinking: "Extended thinking unavailable — using standard reasoning",
    vision: "Vision unavailable — switch to text-only mode for this turn",
    computer_use: "Computer use unavailable — falling back to text-mediated control",
    json_mode: "JSON mode simulated via prompt instruction",
    prompt_caching: "Prompt caching unavailable — no cost savings this turn",
    code_execution: "Code execution unavailable — writing to file instead",
    parallel_tool_calls: "Sequential tool calls only (no parallelism)",
    mcp: "MCP protocol not supported — using basic tool interface",
  };

  return mitigations[capability] ?? `${capability} not available on this provider`;
}

function getImpactLevel(
  capability: CapabilityName,
  sourceStatus: CapabilityStatus,
  targetStatus: CapabilityStatus,
): "none" | "low" | "medium" | "high" {
  if (sourceStatus === targetStatus) return "none";
  if (targetStatus === "emulated") return "low";
  if (targetStatus === "degraded") return "medium";

  const highImpactCaps: readonly CapabilityName[] = [
    "tool_use",
    "thinking",
    "multi_turn",
    "system_prompt",
    "streaming",
  ];

  return highImpactCaps.includes(capability) ? "high" : "medium";
}
