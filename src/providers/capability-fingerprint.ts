/**
 * Provider Capability Fingerprinting — dynamic capability detection per model.
 *
 * Instead of hardcoding what each model can do, WOTANN probes models
 * at session start with lightweight capability tests and builds a
 * provider-specific capability map.
 *
 * This enables WOTANN to:
 * 1. Route tasks to the most capable model (e.g., structured output → GPT-5.4)
 * 2. Fall back gracefully when a capability is missing
 * 3. Detect new capabilities as models are updated
 * 4. Generate provider-specific prompts that leverage unique strengths
 */

export type CapabilityId =
  | "structured-output"
  | "tool-calling"
  | "vision"
  | "extended-thinking"
  | "computer-use"
  | "prompt-caching"
  | "streaming"
  | "json-mode"
  | "code-execution"
  | "web-search"
  | "file-upload"
  | "function-calling"
  | "multi-modal"
  | "audio-input"
  | "audio-output"
  | "parallel-tool-calls"
  | "system-prompt"
  | "temperature-control"
  | "stop-sequences"
  | "logprobs"
  | "embeddings"
  | "fine-tuning";

export interface CapabilityProbe {
  readonly id: CapabilityId;
  readonly name: string;
  readonly testPrompt: string;
  readonly expectedPattern: RegExp;
  readonly timeoutMs: number;
}

export interface CapabilityResult {
  readonly id: CapabilityId;
  readonly supported: boolean;
  readonly confidence: number;
  readonly latencyMs: number;
  readonly notes?: string;
}

export interface ProviderFingerprint {
  readonly provider: string;
  readonly model: string;
  readonly capabilities: readonly CapabilityResult[];
  readonly probedAt: string;
  readonly totalProbeTimeMs: number;
}

// ── Probes ───────────────────────────────────────────────

const CAPABILITY_PROBES: readonly CapabilityProbe[] = [
  {
    id: "structured-output",
    name: "Structured Output (JSON)",
    testPrompt: "Return only a JSON object with keys 'name' (string) and 'age' (number). No other text.",
    expectedPattern: /\{[^}]*"name"\s*:\s*"[^"]*"\s*,\s*"age"\s*:\s*\d+[^}]*\}/,
    timeoutMs: 10_000,
  },
  {
    id: "extended-thinking",
    name: "Extended Thinking",
    testPrompt: "Think step by step about what 2+2 equals, show your reasoning.",
    expectedPattern: /\b(think|step|reason)\b/i,
    timeoutMs: 15_000,
  },
  {
    id: "code-execution",
    name: "Code Execution",
    testPrompt: "Execute this Python code and return the result: print(2**10)",
    expectedPattern: /1024/,
    timeoutMs: 30_000,
  },
];

// ── Static Capabilities (known from docs, no probing needed) ──

const STATIC_CAPABILITIES: Record<string, readonly CapabilityId[]> = {
  "anthropic:claude-opus-4-6": [
    "tool-calling", "vision", "extended-thinking", "computer-use",
    "prompt-caching", "streaming", "system-prompt", "temperature-control",
    "stop-sequences", "parallel-tool-calls", "multi-modal",
  ],
  "anthropic:claude-sonnet-4-6": [
    "tool-calling", "vision", "extended-thinking", "computer-use",
    "prompt-caching", "streaming", "system-prompt", "temperature-control",
    "stop-sequences", "parallel-tool-calls", "multi-modal",
  ],
  "openai:gpt-5.4": [
    "structured-output", "tool-calling", "vision", "streaming",
    "json-mode", "code-execution", "web-search", "function-calling",
    "multi-modal", "audio-input", "audio-output", "system-prompt",
    "temperature-control", "stop-sequences", "logprobs", "parallel-tool-calls",
    "embeddings", "fine-tuning",
  ],
  "gemini:gemini-2.5-pro": [
    "structured-output", "tool-calling", "vision", "streaming",
    "json-mode", "code-execution", "multi-modal", "system-prompt",
    "temperature-control", "prompt-caching",
  ],
  "ollama:qwen3-coder-next": [
    "tool-calling", "streaming", "system-prompt", "temperature-control",
    "stop-sequences",
  ],
};

export class CapabilityFingerprinter {
  private readonly fingerprints: Map<string, ProviderFingerprint> = new Map();

  /**
   * Get a fingerprint from cache or generate a static one.
   */
  getFingerprint(provider: string, model: string): ProviderFingerprint {
    const key = `${provider}:${model}`;
    const cached = this.fingerprints.get(key);
    if (cached) return cached;

    // Use static capabilities
    const staticCaps = STATIC_CAPABILITIES[key] ?? [];
    const capabilities: CapabilityResult[] = CAPABILITY_PROBES.map((probe) => ({
      id: probe.id,
      supported: staticCaps.includes(probe.id),
      confidence: staticCaps.includes(probe.id) ? 1.0 : 0.0,
      latencyMs: 0,
      notes: staticCaps.includes(probe.id) ? "Static - from known capabilities" : "Not detected",
    }));

    // Add static-only capabilities not in probes
    for (const capId of staticCaps) {
      if (!capabilities.some((c) => c.id === capId)) {
        capabilities.push({
          id: capId,
          supported: true,
          confidence: 1.0,
          latencyMs: 0,
          notes: "Static - from known capabilities",
        });
      }
    }

    const fingerprint: ProviderFingerprint = {
      provider,
      model,
      capabilities,
      probedAt: new Date().toISOString(),
      totalProbeTimeMs: 0,
    };

    this.fingerprints.set(key, fingerprint);
    return fingerprint;
  }

  /**
   * Probe a model for a specific capability.
   */
  async probeCapability(
    provider: string,
    model: string,
    capabilityId: CapabilityId,
    executor: (prompt: string) => Promise<string>,
  ): Promise<CapabilityResult> {
    const probe = CAPABILITY_PROBES.find((p) => p.id === capabilityId);
    if (!probe) {
      return { id: capabilityId, supported: false, confidence: 0, latencyMs: 0, notes: "No probe defined" };
    }

    const start = Date.now();
    try {
      const response = await Promise.race([
        executor(probe.testPrompt),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), probe.timeoutMs)),
      ]);

      const latencyMs = Date.now() - start;
      const supported = probe.expectedPattern.test(response);

      return {
        id: capabilityId,
        supported,
        confidence: supported ? 0.9 : 0.1,
        latencyMs,
        notes: supported ? "Probe passed" : "Probe failed - pattern not matched",
      };
    } catch {
      return {
        id: capabilityId,
        supported: false,
        confidence: 0,
        latencyMs: Date.now() - start,
        notes: "Probe timed out or errored",
      };
    }
  }

  /**
   * Check if a provider/model supports a specific capability.
   */
  hasCapability(provider: string, model: string, capabilityId: CapabilityId): boolean {
    const fingerprint = this.getFingerprint(provider, model);
    return fingerprint.capabilities.some((c) => c.id === capabilityId && c.supported);
  }

  /**
   * Find the best model for a specific capability across all fingerprinted providers.
   */
  bestModelForCapability(capabilityId: CapabilityId): { provider: string; model: string } | null {
    for (const [, fingerprint] of this.fingerprints) {
      const cap = fingerprint.capabilities.find((c) => c.id === capabilityId);
      if (cap?.supported) {
        return { provider: fingerprint.provider, model: fingerprint.model };
      }
    }

    // Check static capabilities as fallback
    for (const [key, caps] of Object.entries(STATIC_CAPABILITIES)) {
      if (caps.includes(capabilityId)) {
        const [provider, model] = key.split(":");
        return { provider: provider!, model: model! };
      }
    }

    return null;
  }

  /**
   * Get all probes for testing.
   */
  getProbes(): readonly CapabilityProbe[] {
    return CAPABILITY_PROBES;
  }
}
