import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WotannRuntime } from "../../src/core/runtime.js";
import { addMessage, createSession } from "../../src/core/session.js";
import { getTierModel } from "../_helpers/model-tier.js";

const STRONG = getTierModel("strong");

describe("Runtime live intelligence wiring", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("injects memory recall, skills, and context budget into the live system prompt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-live-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "example.ts"), "export const example = 1;\n");

    const runtime = new WotannRuntime({ workingDir: tempDir });
    (runtime as unknown as {
      memoryStore: {
        skepticalSearch: () => Array<{
          entry: { id: string; key: string; value: string };
          needsVerification: boolean;
        }>;
        getProactiveContext: () => Array<{ id: string; key: string; value: string }>;
        getWorkingMemory: () => Array<{ key: string; value: string }>;
        captureEvent: () => void;
      };
    }).memoryStore = {
      skepticalSearch: () => [{
        entry: { id: "m-1", key: "validation", value: "Validation logic must stay immutable." },
        needsVerification: false,
      }],
      getProactiveContext: () => [{ id: "m-2", key: "example.ts", value: "This file is part of the validation flow." }],
      getWorkingMemory: () => [{ key: "current-focus", value: "Use explicit validation boundaries." }],
      captureEvent: () => {},
    };

    let capturedSystemPrompt = "";
    (runtime as unknown as {
      infra: {
        bridge: {
          query: (options: { systemPrompt?: string }) => AsyncGenerator<
            { type: "text"; content: string; provider: "anthropic" } |
            { type: "done"; content: string; provider: "anthropic" }
          >;
        };
      };
    }).infra = {
      bridge: {
        async *query(options: { systemPrompt?: string }) {
          capturedSystemPrompt = options.systemPrompt ?? "";
          yield { type: "text", content: "done", provider: "anthropic" as const };
          yield { type: "done", content: "", provider: "anthropic" as const };
        },
      },
    };

    for await (const _ of runtime.query({ prompt: "Review @src/example.ts and improve validation logic." })) {
      // drain
    }

    expect(capturedSystemPrompt).toContain("## Context Budget");
    expect(capturedSystemPrompt).toContain("<budget:token_budget>");
    expect(capturedSystemPrompt).toContain("## Active Skill Guidance");
    expect(capturedSystemPrompt).toContain("typescript-pro");
    expect(capturedSystemPrompt).toMatch(/Working Memory|Relevant Memory Recall|Proactive Context/);
  });

  it("compacts oversized session history before querying the provider", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-compact-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });
    mkdirSync(join(tempDir, "src"), { recursive: true });
    writeFileSync(join(tempDir, "src", "example.ts"), "export const example = 1;\n");

    const runtime = new WotannRuntime({ workingDir: tempDir });

    // PROVIDER-AGNOSTIC: model id is unused by the compaction logic
    // under test; pull from the helper to avoid a stale literal.
    let session = createSession(STRONG.provider, STRONG.model);
    for (let index = 0; index < 16; index++) {
      session = addMessage(session, {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message-${index} ${"x".repeat(800)}`,
      });
    }
    runtime.restoreSession(session);
    runtime.setMaxContextTokens(1_200);

    let capturedContext = [] as Array<{ role: string; content: string }>;
    (runtime as unknown as {
      infra: {
        bridge: {
          query: (options: { context?: readonly { role: string; content: string }[] }) => AsyncGenerator<
            { type: "text"; content: string; provider: "anthropic" } |
            { type: "done"; content: string; provider: "anthropic" }
          >;
        };
      };
    }).infra = {
      bridge: {
        async *query(options: { context?: readonly { role: string; content: string }[] }) {
          capturedContext = [...(options.context ?? [])];
          yield { type: "text", content: "trimmed", provider: "anthropic" as const };
          yield { type: "done", content: "", provider: "anthropic" as const };
        },
      },
    };

    for await (const _ of runtime.query({ prompt: "Continue work on @src/example.ts." })) {
      // drain
    }

    expect(capturedContext.length).toBeLessThan(session.messages.length + 1);
    expect(capturedContext.some((message) =>
      message.role === "system" && message.content.includes("Conversation summary"),
    )).toBe(true);
  });

  it("injects authorized security research framing and prefers open providers in guardrails-off mode", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-guardrails-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    const runtime = new WotannRuntime({ workingDir: tempDir });
    runtime.setMode("guardrails-off");

    let capturedSystemPrompt = "";
    let capturedProvider = "";
    (runtime as unknown as {
      infra: {
        bridge: {
          getAvailableProviders: () => readonly string[];
          query: (options: { provider?: string; systemPrompt?: string }) => AsyncGenerator<
            { type: "text"; content: string; provider: "ollama" } |
            { type: "done"; content: string; provider: "ollama" }
          >;
        };
      };
    }).infra = {
      bridge: {
        getAvailableProviders: () => ["anthropic", "ollama", "openai"],
        async *query(options: { provider?: string; systemPrompt?: string }) {
          capturedProvider = options.provider ?? "";
          capturedSystemPrompt = options.systemPrompt ?? "";
          yield { type: "text", content: "done", provider: "ollama" as const };
          yield { type: "done", content: "", provider: "ollama" as const };
        },
      },
    };

    for await (const _ of runtime.query({ prompt: "Develop a proof of concept for a local test target." })) {
      // drain
    }

    expect(capturedProvider).toBe("ollama");
    expect(capturedSystemPrompt).toContain("Authorized Security Research Context");
    expect(capturedSystemPrompt).toContain("security research assistant");
  });
});
