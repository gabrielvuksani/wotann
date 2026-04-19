/**
 * C7 — Claude Agent SDK bridge dispatch decision tests.
 */

import { describe, it, expect } from "vitest";
import {
  shouldUseClaudeSDK,
  routeViaClaudeSDK,
} from "../../src/core/claude-sdk-bridge.js";

describe("shouldUseClaudeSDK", () => {
  it("returns useSDK=false for non-Anthropic provider", async () => {
    const decision = await shouldUseClaudeSDK("openai");
    expect(decision.useSDK).toBe(false);
    expect(decision.reason).toMatch(/not Anthropic-family/);
  });

  it("returns useSDK=false for ollama", async () => {
    const decision = await shouldUseClaudeSDK("ollama");
    expect(decision.useSDK).toBe(false);
  });

  it("returns useSDK=false for empty string", async () => {
    const decision = await shouldUseClaudeSDK("");
    expect(decision.useSDK).toBe(false);
  });

  it("recognises both anthropic and anthropic-subscription as eligible", async () => {
    // We can't assert useSDK=true here because the SDK may or may not
    // be installed in the test env — but we CAN assert the provider
    // check passes (so the reason is about SDK availability, not
    // provider family).
    const anthropic = await shouldUseClaudeSDK("anthropic");
    const subscription = await shouldUseClaudeSDK("anthropic-subscription");

    // Either both say SDK available or both say SDK not installed —
    // NEVER "not Anthropic-family".
    expect(anthropic.reason).not.toMatch(/not Anthropic-family/);
    expect(subscription.reason).not.toMatch(/not Anthropic-family/);
  });
});

describe("routeViaClaudeSDK", () => {
  it("emits a fallback signal for non-Anthropic provider", async () => {
    const gen = routeViaClaudeSDK("openai", { prompt: "hello" });
    const first = await gen.next();
    expect(first.done).toBe(false);
    const chunk = first.value!;
    expect(chunk.type).toBe("fallback");
    if (chunk.type === "fallback") {
      expect(chunk.reason).toMatch(/not Anthropic-family/);
    }
    // Generator should complete after the fallback signal.
    const second = await gen.next();
    expect(second.done).toBe(true);
  });

  it("emits a fallback signal for ollama provider", async () => {
    const gen = routeViaClaudeSDK("ollama", { prompt: "hi" });
    const first = await gen.next();
    expect(first.value?.type).toBe("fallback");
  });
});
