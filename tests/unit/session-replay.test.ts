import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionRecorder, SessionPlayer } from "../../src/telemetry/session-replay.js";

describe("SessionRecorder", () => {
  it("records events when started", () => {
    const recorder = new SessionRecorder("anthropic", "claude-opus-4-6");
    recorder.start();

    recorder.recordPrompt("What is 2+2?", "You are a math tutor");
    recorder.recordResponse("4", 10, 0.001);
    recorder.recordToolCall("calculator", { expression: "2+2" });
    recorder.recordToolResult("calculator", "4", true);

    const session = recorder.getSession();
    expect(session.events.length).toBe(4);
    expect(session.provider).toBe("anthropic");
    expect(session.model).toBe("claude-opus-4-6");
  });

  it("does not record when stopped", () => {
    const recorder = new SessionRecorder("openai", "gpt-5.4");
    // Not started
    recorder.recordPrompt("Hello");
    expect(recorder.getSession().events.length).toBe(0);

    recorder.start();
    recorder.recordPrompt("Hello");
    expect(recorder.getSession().events.length).toBe(1);

    recorder.stop();
    recorder.recordPrompt("After stop");
    expect(recorder.getSession().events.length).toBe(1);
  });

  it("records provider switches", () => {
    const recorder = new SessionRecorder("anthropic", "claude-opus");
    recorder.start();

    recorder.recordProviderSwitch("anthropic", "openai", "rate_limited");
    const session = recorder.getSession();
    expect(session.events.length).toBe(1);
    expect(session.events[0]!.type).toBe("provider_switch");
    expect(session.events[0]!.data["from"]).toBe("anthropic");
    expect(session.events[0]!.data["to"]).toBe("openai");
  });

  it("records compaction events", () => {
    const recorder = new SessionRecorder("anthropic", "claude");
    recorder.start();

    recorder.recordCompaction(180_000, 50_000);

    const session = recorder.getSession();
    const compaction = session.events[0]!;
    expect(compaction.type).toBe("compaction");
    expect(compaction.data["tokensBefore"]).toBe(180_000);
    expect(compaction.data["tokensAfter"]).toBe(50_000);
  });

  // Wave 4G: structured per-turn events with full usage + cost + tool
  // breakdown. This is the data source for `wotann cost today` and
  // `wotann telemetry tail`, so the shape is load-bearing.
  it("records structured turn events with full usage + cost breakdown", () => {
    const recorder = new SessionRecorder("anthropic", "claude-sonnet-4-6");
    recorder.start();

    recorder.recordTurn({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 1200,
      completionTokens: 450,
      cacheReadTokens: 800,
      costUsd: 0.0123,
      durationMs: 4321,
      toolCalls: 3,
    });

    const session = recorder.getSession();
    expect(session.events.length).toBe(1);
    const event = session.events[0]!;
    expect(event.type).toBe("turn");
    expect(event.data["provider"]).toBe("anthropic");
    expect(event.data["promptTokens"]).toBe(1200);
    expect(event.data["completionTokens"]).toBe(450);
    expect(event.data["cacheReadTokens"]).toBe(800);
    expect(event.data["costUsd"]).toBeCloseTo(0.0123, 4);
    expect(event.data["toolCalls"]).toBe(3);
    expect(event.data["sessionId"]).toBe(recorder.getSessionId());
  });

  it("exposes getSessionId()", () => {
    const recorder = new SessionRecorder("anthropic", "claude", "fixed-id-123");
    expect(recorder.getSessionId()).toBe("fixed-id-123");
  });
});

describe("SessionRecorder events sink", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes each event to the JSONL sink when setEventsSink is configured", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-events-"));
    const path = join(tempDir, ".wotann", "events.jsonl");

    const recorder = new SessionRecorder("anthropic", "claude-sonnet-4-6", "sess-xyz");
    recorder.setEventsSink(path);
    recorder.start();

    recorder.recordPrompt("hello");
    recorder.recordTurn({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      promptTokens: 10,
      completionTokens: 5,
      costUsd: 0.001,
      durationMs: 250,
      toolCalls: 0,
    });

    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(2);

    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(second["type"]).toBe("turn");
    const data = second["data"] as Record<string, unknown>;
    expect(data["sessionId"]).toBe("sess-xyz");
    expect(data["promptTokens"]).toBe(10);
  });

  it("disables mirroring when sink is set to null", () => {
    tempDir = mkdtempSync(join(tmpdir(), "wotann-events-"));
    const path = join(tempDir, ".wotann", "events.jsonl");

    const recorder = new SessionRecorder("anthropic", "claude");
    recorder.setEventsSink(path);
    recorder.start();
    recorder.recordPrompt("one");

    recorder.setEventsSink(null);
    recorder.recordPrompt("two");

    const lines = readFileSync(path, "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
  });
});

describe("SessionPlayer", () => {
  it("loads from session object and replays", () => {
    // Record a session
    const recorder = new SessionRecorder("anthropic", "claude");
    recorder.start();
    recorder.recordPrompt("Hello");
    recorder.recordResponse("Hi there!", 15, 0.002);
    recorder.recordPrompt("What's 2+2?");
    recorder.recordResponse("4", 5, 0.001);
    recorder.stop();

    const session = recorder.getSession();

    // Play it back
    const player = new SessionPlayer();
    player.loadSession(session);

    const info = player.getSessionInfo();
    expect(info).not.toBeNull();
    expect(info!.eventCount).toBe(4);
    expect(info!.provider).toBe("anthropic");

    // Get first response
    const resp1 = player.getNextResponse();
    expect(resp1).toBe("Hi there!");

    // Get second response
    const resp2 = player.getNextResponse();
    expect(resp2).toBe("4");

    // No more
    expect(player.isComplete()).toBe(true);
  });

  it("resets to beginning", () => {
    const recorder = new SessionRecorder("openai", "gpt-5");
    recorder.start();
    recorder.recordResponse("First", 5, 0.001);
    recorder.stop();

    const player = new SessionPlayer();
    player.loadSession(recorder.getSession());

    player.getNextResponse();
    expect(player.isComplete()).toBe(true);

    player.reset();
    expect(player.isComplete()).toBe(false);
    expect(player.getNextResponse()).toBe("First");
  });

  it("filters events by type", () => {
    const recorder = new SessionRecorder("anthropic", "claude");
    recorder.start();
    recorder.recordPrompt("Q1");
    recorder.recordResponse("A1", 10, 0.001);
    recorder.recordToolCall("tool", {});
    recorder.recordToolResult("tool", "result", true);
    recorder.recordPrompt("Q2");
    recorder.recordResponse("A2", 10, 0.001);
    recorder.stop();

    const player = new SessionPlayer();
    player.loadSession(recorder.getSession());

    expect(player.getEventsByType("prompt").length).toBe(2);
    expect(player.getEventsByType("response").length).toBe(2);
    expect(player.getEventsByType("tool_call").length).toBe(1);
    expect(player.getEventsByType("tool_result").length).toBe(1);
  });

  it("returns null for empty player", () => {
    const player = new SessionPlayer();
    expect(player.getNextResponse()).toBeNull();
    expect(player.getSessionInfo()).toBeNull();
    expect(player.isComplete()).toBe(true);
  });
});
