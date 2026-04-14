import { describe, it, expect } from "vitest";
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
