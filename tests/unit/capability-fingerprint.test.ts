import { describe, it, expect } from "vitest";
import {
  type CapabilityId,
  CapabilityFingerprinter,
} from "../../src/providers/capability-fingerprint.js";

describe("Capability Fingerprinter", () => {
  it("returns static capabilities for known models", () => {
    const fp = new CapabilityFingerprinter();
    const result = fp.getFingerprint("anthropic", "claude-opus-4-7");

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4-7");
    expect(result.capabilities.length).toBeGreaterThan(0);

    // Opus supports tool-calling and vision
    expect(fp.hasCapability("anthropic", "claude-opus-4-7", "tool-calling")).toBe(true);
    expect(fp.hasCapability("anthropic", "claude-opus-4-7", "vision")).toBe(true);
    expect(fp.hasCapability("anthropic", "claude-opus-4-7", "extended-thinking")).toBe(true);
    expect(fp.hasCapability("anthropic", "claude-opus-4-7", "computer-use")).toBe(true);
  });

  it("returns static capabilities for OpenAI models", () => {
    const fp = new CapabilityFingerprinter();
    expect(fp.hasCapability("openai", "gpt-5.4", "structured-output")).toBe(true);
    expect(fp.hasCapability("openai", "gpt-5.4", "code-execution")).toBe(true);
    expect(fp.hasCapability("openai", "gpt-5.4", "web-search")).toBe(true);
  });

  it("returns no capabilities for unknown models", () => {
    const fp = new CapabilityFingerprinter();
    const result = fp.getFingerprint("unknown", "unknown-model");
    expect(result.capabilities.every((c) => !c.supported || c.notes?.includes("Static"))).toBe(true);
  });

  it("bestModelForCapability finds the right model", () => {
    const fp = new CapabilityFingerprinter();
    // Prime the cache
    fp.getFingerprint("anthropic", "claude-opus-4-7");
    fp.getFingerprint("openai", "gpt-5.4");

    const best = fp.bestModelForCapability("computer-use");
    expect(best).toBeDefined();
    expect(best!.provider).toBe("anthropic"); // Anthropic has computer-use
  });

  it("probeCapability handles timeout gracefully", async () => {
    const fp = new CapabilityFingerprinter();
    const executor = async (_prompt: string): Promise<string> => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "1024";
    };

    const result = await fp.probeCapability("test", "test-model", "code-execution", executor);
    expect(result.id).toBe("code-execution");
    expect(result.supported).toBe(true); // matches /1024/
    expect(result.latencyMs).toBeGreaterThan(0);
  });

  it("probeCapability returns false for non-matching response", async () => {
    const fp = new CapabilityFingerprinter();
    const executor = async (_prompt: string): Promise<string> => "I cannot execute code";

    const result = await fp.probeCapability("test", "test-model", "code-execution", executor);
    expect(result.supported).toBe(false);
  });

  it("caches fingerprints", () => {
    const fp = new CapabilityFingerprinter();
    const first = fp.getFingerprint("anthropic", "claude-opus-4-7");
    const second = fp.getFingerprint("anthropic", "claude-opus-4-7");
    expect(first).toBe(second); // Same reference = cached
  });

  it("getProbes returns available probes", () => {
    const fp = new CapabilityFingerprinter();
    const probes = fp.getProbes();
    expect(probes.length).toBeGreaterThanOrEqual(3);
    expect(probes.some((p) => p.id === "structured-output")).toBe(true);
    expect(probes.some((p) => p.id === "extended-thinking")).toBe(true);
    expect(probes.some((p) => p.id === "code-execution")).toBe(true);
  });
});
