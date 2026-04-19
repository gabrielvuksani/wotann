/**
 * Wave 4E: Tests for AgentRegistry.withAgent (external ACP agent lift).
 *
 * Verifies immutable-update semantics: adding a new agent returns a
 * NEW registry without mutating the original. Also exercises the
 * end-to-end flow where an InstalledAcpAgent is converted via
 * installedAcpAgentToDefinition and then registered.
 */

import { describe, it, expect } from "vitest";
import { agentRegistry, AgentRegistry } from "../../src/orchestration/agent-registry.js";
import {
  installedAcpAgentToDefinition,
  type InstalledAcpAgent,
} from "../../src/marketplace/acp-agent-registry.js";

describe("AgentRegistry.withAgent (Wave 4E)", () => {
  it("adds a new agent and returns a new registry", () => {
    const extra = {
      id: "external:demo",
      name: "Demo External",
      model: "local" as const,
      systemPrompt: "demo",
      allowedTools: ["Read"],
      deniedTools: [],
      availableSkills: [],
      maxTurns: 5,
      timeout: 1000,
    };
    const next = agentRegistry.withAgent(extra);
    expect(next.has("external:demo")).toBe(true);
    // Original untouched
    expect(agentRegistry.has("external:demo")).toBe(false);
    // Size grows by exactly one
    expect(next.size).toBe(agentRegistry.size + 1);
  });

  it("replaces an agent with same id (last-write-wins)", () => {
    const original = {
      id: "replaceable",
      name: "Original",
      model: "local" as const,
      systemPrompt: "original prompt",
      allowedTools: ["Read"],
      deniedTools: [],
      availableSkills: [],
      maxTurns: 5,
      timeout: 1000,
    };
    const replacement = { ...original, systemPrompt: "new prompt" };
    const first = agentRegistry.withAgent(original);
    const second = first.withAgent(replacement);
    expect(second.get("replaceable")?.systemPrompt).toBe("new prompt");
    expect(second.size).toBe(first.size);
  });

  it("can lift an InstalledAcpAgent into the registry", () => {
    const installed: InstalledAcpAgent = {
      name: "codex-cli",
      title: "Codex CLI",
      description: "OpenAI's Codex",
      version: "1.0.0",
      command: "codex",
      args: ["acp"],
      installedAt: new Date().toISOString(),
      status: "INSTALLED",
      verified: false,
      source: "registry",
    };
    const def = installedAcpAgentToDefinition(installed);
    const next = agentRegistry.withAgent(def);
    expect(next.has("acp:codex-cli")).toBe(true);
    const stored = next.get("acp:codex-cli");
    expect(stored?.name).toBe("Codex CLI");
    expect(stored?.model).toBe("local");
  });

  it("is an instance of AgentRegistry", () => {
    const extra = {
      id: "type-check",
      name: "TypeCheck",
      model: "local" as const,
      systemPrompt: "",
      allowedTools: [],
      deniedTools: [],
      availableSkills: [],
      maxTurns: 1,
      timeout: 100,
    };
    const next = agentRegistry.withAgent(extra);
    expect(next).toBeInstanceOf(AgentRegistry);
  });
});
