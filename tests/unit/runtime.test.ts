import { describe, it, expect, vi, afterEach } from "vitest";
import { WotannRuntime } from "../../src/core/runtime.js";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSession, addMessage } from "../../src/core/session.js";
import { StreamCheckpointStore } from "../../src/core/stream-resume.js";
import { MemoryStore } from "../../src/memory/store.js";

describe("WotannRuntime", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("initializes with default config", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });
    const runtime = new WotannRuntime({ workingDir: tempDir });
    expect(runtime).toBeDefined();
  });

  it("reports status before initialization", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    const runtime = new WotannRuntime({ workingDir: tempDir });
    const status = runtime.getStatus();

    expect(status.providers).toHaveLength(0);
    expect(status.hookCount).toBeGreaterThan(0); // Built-in hooks are registered
    expect(status.middlewareLayers).toBeGreaterThanOrEqual(25);
    expect(typeof status.sessionId).toBe("string");
  });

  it("initializes and discovers providers", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    vi.stubEnv("OLLAMA_URL", "http://localhost:99999");
    vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");

    const runtime = new WotannRuntime({ workingDir: tempDir });
    await runtime.initialize();

    // May or may not have providers depending on env
    const status = runtime.getStatus();
    expect(status.hookCount).toBeGreaterThan(0);

    vi.unstubAllEnvs();
  });

  it("gets session state", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    const runtime = new WotannRuntime({ workingDir: tempDir });
    const session = runtime.getSession();

    expect(session.id).toBeDefined();
    expect(session.totalTokens).toBe(0);
    expect(session.totalCost).toBe(0);
    expect(session.messages).toHaveLength(0);
  });

  it("restores session state into the runtime", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    const base = createSession("openai", "gpt-5.4");
    const restored = addMessage(base, {
      role: "assistant",
      content: "Restored response",
      tokensUsed: 123,
      cost: 0.045,
    });

    const runtime = new WotannRuntime({ workingDir: tempDir });
    runtime.restoreSession(restored);

    expect(runtime.getSession().id).toBe(restored.id);
    expect(runtime.getSession().messages).toHaveLength(1);
    expect(runtime.getStatus().sessionId).toBe(restored.id);
    expect(runtime.getStatus().activeProvider).toBe("openai");
  });

  it("saves session on close", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann", "sessions"), { recursive: true });

    const runtime = new WotannRuntime({ workingDir: tempDir });
    runtime.close();

    // Session file should be created
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(join(tempDir, ".wotann", "sessions"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("captures feedback and lifecycle events into memory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    vi.stubEnv("CODEX_AUTH_JSON_PATH", "/nonexistent");
    vi.stubEnv("OLLAMA_URL", "http://localhost:99999");
    vi.stubEnv("WOTANN_SKIP_CLI_CHECK", "1");

    const runtime = new WotannRuntime({ workingDir: tempDir });
    await runtime.initialize();
    (runtime as unknown as {
      infra: {
        bridge: {
          query: () => AsyncGenerator<
            { type: "text"; content: string; provider: "anthropic" } |
            { type: "done"; content: string; provider: "anthropic" }
          >;
        };
      };
    }).infra = {
      bridge: {
        async *query() {
          yield { type: "text", content: "Captured.", provider: "anthropic" as const };
          yield { type: "done", content: "", provider: "anthropic" as const };
        },
      },
    };

    for await (const _ of runtime.query({ prompt: "No, that's wrong. Use strict types instead." })) {
      // Drain the live query path so prompt/feedback capture runs.
    }

    runtime.close();
    vi.unstubAllEnvs();

    const store = new MemoryStore(join(tempDir, ".wotann", "memory.db"));
    try {
      const feedbackEntries = store.getByBlock("feedback");
      const autoCapture = store.getAutoCaptureEntries(20);

      expect(feedbackEntries.some((entry) => entry.value.includes("No, that's wrong"))).toBe(true);
      expect(autoCapture.some((entry) => entry.eventType === "session_start")).toBe(true);
      expect(autoCapture.some((entry) => entry.eventType === "user_prompt")).toBe(true);
      expect(autoCapture.some((entry) => entry.eventType === "feedback_correction")).toBe(true);
      expect(autoCapture.some((entry) => entry.eventType === "session_end")).toBe(true);
    } finally {
      store.close();
    }
  });

  it("yields error when no providers configured", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    const runtime = new WotannRuntime({ workingDir: tempDir });
    // Don't initialize — no providers

    const chunks: Array<{ type: string; content: string }> = [];
    for await (const chunk of runtime.query({ prompt: "test" })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.type).toBe("error");
    expect(chunks[0]?.content).toContain("No providers configured");
  });

  it("persists an interrupted stream checkpoint when consumption stops early", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    const runtime = new WotannRuntime({ workingDir: tempDir });
    (runtime as unknown as {
      infra: {
        bridge: {
          query: () => AsyncGenerator<{ type: "text"; content: string; provider: "anthropic" }>;
        };
      };
    }).infra = {
      bridge: {
        async *query() {
          yield { type: "text", content: "partial ", provider: "anthropic" as const };
          yield { type: "text", content: "response", provider: "anthropic" as const };
        },
      },
    };

    for await (const chunk of runtime.query({ prompt: "interrupt me" })) {
      if (chunk.type === "text") {
        break;
      }
    }

    const store = new StreamCheckpointStore(join(tempDir, ".wotann", "streams"));
    const checkpoint = store.getLatestInterrupted();

    expect(checkpoint).not.toBeNull();
    expect(checkpoint?.partialContent).toBe("partial ");
  });

  it("aborts and retries a stream when TTSR fires", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    const runtime = new WotannRuntime({ workingDir: tempDir });
    let attempts = 0;

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
          attempts++;
          if (attempts === 1) {
            // Use a critical-severity trigger (hardcoded password) so TTSR aborts and retries
            yield { type: "text", content: "password = \"hunter2\"", provider: "anthropic" as const };
            return;
          }

          expect(options.systemPrompt).toContain("TTSR RETRY SYSTEM MESSAGE");
          yield { type: "text", content: "Clean output", provider: "anthropic" as const };
          yield { type: "done", content: "", provider: "anthropic" as const };
        },
      },
    };

    const output: string[] = [];
    for await (const chunk of runtime.query({ prompt: "Produce code" })) {
      if (chunk.type === "text") {
        output.push(chunk.content);
      }
    }

    expect(attempts).toBe(2);
    expect(output.join("")).toContain("Restarting the response");
    expect(output.join("")).toContain("Clean output");
    expect(output.join("")).not.toContain("hunter2");
  });

  it("injects live intelligence overrides into the system prompt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    const runtime = new WotannRuntime({ workingDir: tempDir });
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
          expect(options.systemPrompt).toContain("Senior Dev Quality Bar");
          expect(options.systemPrompt).toContain("Step 0 Deletion");
          expect(options.systemPrompt).toContain("AST-Level Rename Search");
          yield { type: "text", content: "safe output", provider: "anthropic" as const };
          yield { type: "done", content: "", provider: "anthropic" as const };
        },
      },
    };

    for await (const _ of runtime.query({
      prompt: "Refactor this 420 line auth service and rename authenticate to verifyUser across auth.ts, user.ts, api.ts, session.ts, login.ts, logout.ts",
    })) {
      // Drain stream
    }
  });

  it("injects QMD-style relevant context into the system prompt", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });
    writeFileSync(join(tempDir, "README.md"), [
      "# Auth Notes",
      "",
      "Authentication tokens expire after 15 minutes and refresh through /api/refresh.",
      "",
    ].join("\n"));

    const runtime = new WotannRuntime({ workingDir: tempDir });
    await runtime.initialize();
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
          expect(options.systemPrompt).toContain("QMD Precision Context");
          expect(options.systemPrompt).toContain("Authentication tokens expire");
          yield { type: "text", content: "context loaded", provider: "anthropic" as const };
          yield { type: "done", content: "", provider: "anthropic" as const };
        },
      },
    };

    for await (const _ of runtime.query({ prompt: "How do auth tokens refresh?" })) {
      // Drain stream
    }
  });

  it("emits a truncation warning when the result is suspiciously small", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-runtime-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    const runtime = new WotannRuntime({ workingDir: tempDir });
    (runtime as unknown as {
      infra: {
        bridge: {
          query: () => AsyncGenerator<
            { type: "text"; content: string; provider: "anthropic" } |
            { type: "done"; content: string; provider: "anthropic" }
          >;
        };
      };
    }).infra = {
      bridge: {
        async *query() {
          yield { type: "text", content: "short", provider: "anthropic" as const };
          yield { type: "done", content: "", provider: "anthropic" as const };
        },
      },
    };

    const errors: string[] = [];
    for await (const chunk of runtime.query({ prompt: "read the file" })) {
      if (chunk.type === "error") {
        errors.push(chunk.content);
      }
    }

    expect(errors.some((message) => message.includes("Truncation detection"))).toBe(true);
  });
});
