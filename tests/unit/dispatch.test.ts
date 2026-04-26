/**
 * PROVIDER-AGNOSTIC TEST — exercises ChannelDispatchManager routing
 * machinery. Model id is incidental mock metadata; the test verifies
 * runtime reuse, sender isolation, and session restoration —
 * none of which depend on a specific model.
 *
 * Wave DH-3: tier helper for the mock model field.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ChannelDispatchManager } from "../../src/channels/dispatch.js";
import { createSession, saveSession } from "../../src/core/session.js";
import { getTierModel } from "../_helpers/model-tier.js";

const { provider: PROVIDER, model: MODEL } = getTierModel("balanced");

describe("ChannelDispatchManager", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses the same runtime for repeated messages from the same sender", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-dispatch-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    const createRuntime = vi.fn(async () => ({
      query: async function* () {},
      getStatus: () => ({
        providers: [],
        activeProvider: "anthropic",
        hookCount: 0,
        middlewareLayers: 18,
        memoryEnabled: false,
        sessionId: "session-1",
        totalTokens: 0,
        totalCost: 0,
        currentMode: "default",
        traceEntries: 0,
        semanticIndexSize: 0,
        skillCount: 0,
      }),
      restoreSession: vi.fn(),
      saveCurrentSession: () => null,
      close: vi.fn(),
    }));

    const runQuery = vi.fn(async () => ({
      output: "ok",
      errors: [],
      tokensUsed: 12,
      costUsd: 0,
      provider: PROVIDER,
      model: MODEL,
    }));

    const dispatch = new ChannelDispatchManager({
      workingDir: tempDir,
      createRuntime,
      runQuery,
    });

    await dispatch.handleMessage({ channelType: "telegram", senderId: "user-1", content: "hello" });
    await dispatch.handleMessage({ channelType: "telegram", senderId: "user-1", content: "hello again" });

    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledTimes(2);
    expect(dispatch.getStatus().persistedRoutes).toBe(1);
  });

  it("isolates sessions per sender", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-dispatch-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    let runtimeId = 0;
    const createRuntime = vi.fn(async () => {
      runtimeId++;
      const sessionId = `session-${runtimeId}`;
      return {
        query: async function* () {},
        getStatus: () => ({
          providers: [],
          activeProvider: "anthropic",
          hookCount: 0,
          middlewareLayers: 18,
          memoryEnabled: false,
          sessionId,
          totalTokens: 0,
          totalCost: 0,
          currentMode: "default",
          traceEntries: 0,
          semanticIndexSize: 0,
          skillCount: 0,
        }),
        restoreSession: vi.fn(),
        saveCurrentSession: () => null,
        close: vi.fn(),
      };
    });

    const runQuery = vi.fn(async () => ({
      output: "ok",
      errors: [],
      tokensUsed: 12,
      costUsd: 0,
      provider: PROVIDER,
      model: MODEL,
    }));

    const dispatch = new ChannelDispatchManager({
      workingDir: tempDir,
      createRuntime,
      runQuery,
    });

    await dispatch.handleMessage({ channelType: "telegram", senderId: "user-1", content: "hello" });
    await dispatch.handleMessage({ channelType: "telegram", senderId: "user-2", content: "hello" });

    expect(createRuntime).toHaveBeenCalledTimes(2);
    expect(dispatch.getStatus().persistedRoutes).toBe(2);
  });

  it("restores the last saved session for a persisted route", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-dispatch-"));
    mkdirSync(join(tempDir, ".wotann", "sessions"), { recursive: true });

    const sessionPath = saveSession(createSession(PROVIDER, MODEL), join(tempDir, ".wotann", "sessions"));
    const restoreSessionSpy = vi.fn();
    const createRuntime = vi.fn(async () => ({
      query: async function* () {},
      getStatus: () => ({
        providers: [],
        activeProvider: "anthropic",
        hookCount: 0,
        middlewareLayers: 18,
        memoryEnabled: false,
        sessionId: "restored-session",
        totalTokens: 0,
        totalCost: 0,
        currentMode: "default",
        traceEntries: 0,
        semanticIndexSize: 0,
        skillCount: 0,
      }),
      restoreSession: restoreSessionSpy,
      saveCurrentSession: () => sessionPath,
      close: vi.fn(),
    }));
    const runQuery = vi.fn(async () => ({
      output: "ok",
      errors: [],
      tokensUsed: 0,
      costUsd: 0,
      provider: PROVIDER,
      model: MODEL,
    }));

    const manifestPath = join(tempDir, ".wotann", "dispatch", "routes.json");
    mkdirSync(join(tempDir, ".wotann", "dispatch"), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      routes: [{
        routeKey: "telegram:user-1",
        senderId: "user-1",
        channelType: "telegram",
        sessionId: "persisted",
        sessionPath,
        provider: PROVIDER,
        model: MODEL,
        messageCount: 1,
        lastActiveAt: new Date().toISOString(),
      }],
    }, null, 2));

    const dispatch = new ChannelDispatchManager({
      workingDir: tempDir,
      createRuntime,
      runQuery,
      manifestPath,
    });

    await dispatch.handleMessage({ channelType: "telegram", senderId: "user-1", content: "resume" });

    expect(restoreSessionSpy).toHaveBeenCalledTimes(1);
  });

  it("applies dispatch policies for workspace, mode, and provider overrides", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-dispatch-"));
    mkdirSync(join(tempDir, ".wotann"), { recursive: true });

    const createRuntime = vi.fn(async () => ({
      query: async function* () {},
      getStatus: () => ({
        providers: [],
        activeProvider: "ollama",
        hookCount: 0,
        middlewareLayers: 18,
        memoryEnabled: false,
        sessionId: "session-policy",
        totalTokens: 0,
        totalCost: 0,
        currentMode: "guardrails-off",
        traceEntries: 0,
        semanticIndexSize: 0,
        skillCount: 0,
      }),
      restoreSession: vi.fn(),
      saveCurrentSession: () => null,
      close: vi.fn(),
    }));

    const runQuery = vi.fn(async () => ({
      output: "policy-ok",
      errors: [],
      tokensUsed: 10,
      costUsd: 0,
      provider: "ollama",
      model: "qwen3-coder-next",
    }));

    const dispatch = new ChannelDispatchManager({
      workingDir: tempDir,
      createRuntime,
      runQuery,
    });

    dispatch.upsertPolicy({
      id: "security-lab",
      label: "Security Lab",
      channelType: "telegram",
      senderId: "redteam",
      workspaceDir: "labs/security",
      mode: "guardrails-off",
      provider: "ollama",
      model: "qwen3-coder-next",
    });

    await dispatch.handleMessage({
      channelType: "telegram",
      senderId: "redteam",
      channelId: "chat-77",
      content: "scan the target",
    });

    expect(createRuntime).toHaveBeenCalledWith(join(tempDir, "labs/security"), "guardrails-off");
    expect(runQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      prompt: "scan the target",
      provider: "ollama",
      model: "qwen3-coder-next",
    }));

    const route = dispatch.getStatus().routes[0];
    expect(route?.policyId).toBe("security-lab");
    expect(route?.workspaceDir).toBe(join(tempDir, "labs/security"));
    expect(route?.mode).toBe("guardrails-off");
  });
});
