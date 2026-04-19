import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MeetingRuntime, createMeetingRuntime } from "../../src/meet/meeting-runtime.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("MeetingRuntime", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "wotann-meet-"));
    dbPath = join(tempDir, "meetings.db");
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("can be constructed without llmQuery (coaching disabled)", () => {
    const runtime = new MeetingRuntime({ dbPath });
    expect(runtime.getCurrent()).toBeNull();
    runtime.close();
  });

  it("startMeeting returns a MeetingState with an id", () => {
    const runtime = new MeetingRuntime({ dbPath });
    const state = runtime.startMeeting("zoom");
    expect(state.id).toBeTruthy();
    expect(state.platform).toBe("zoom");
    runtime.close();
  });

  it("addSegment requires an active meeting", () => {
    const runtime = new MeetingRuntime({ dbPath });
    expect(() => runtime.addSegment({ speaker: "user", text: "hi" })).toThrow(
      /no active meeting/,
    );
    runtime.close();
  });

  it("addSegment works when meeting is active", () => {
    const runtime = new MeetingRuntime({ dbPath });
    runtime.startMeeting();
    const segment = runtime.addSegment({ speaker: "user", text: "hello" });
    expect(segment.text).toBe("hello");
    expect(segment.id).toBeTruthy();
    runtime.close();
  });

  it("endMeeting returns final state and clears current", () => {
    const runtime = new MeetingRuntime({ dbPath });
    runtime.startMeeting();
    const final = runtime.endMeeting();
    expect(final).toBeTruthy();
    expect(runtime.getCurrent()).toBeNull();
    runtime.close();
  });

  it("endMeeting returns null when no active meeting", () => {
    const runtime = new MeetingRuntime({ dbPath });
    expect(runtime.endMeeting()).toBeNull();
    runtime.close();
  });

  it("addActionItem persists + requires active meeting", () => {
    const runtime = new MeetingRuntime({ dbPath });
    expect(() => runtime.addActionItem("do X")).toThrow(/no active meeting/);
    runtime.startMeeting();
    runtime.addActionItem("do X", "alice", "2026-04-25");
    // No throw means the insert succeeded
    runtime.close();
  });

  it("getTranscript reads aggregated text", () => {
    const runtime = new MeetingRuntime({ dbPath });
    runtime.startMeeting();
    runtime.addSegment({ speaker: "user", text: "one" });
    runtime.addSegment({ speaker: "other", text: "two" });
    expect(runtime.getTranscript()).toContain("one");
    expect(runtime.getTranscript()).toContain("two");
    runtime.close();
  });

  it("getStore returns the underlying MeetingStore for RPC bridging", () => {
    const runtime = new MeetingRuntime({ dbPath });
    const store = runtime.getStore();
    expect(store).toBeTruthy();
    expect(typeof store.listMeetings).toBe("function");
    runtime.close();
  });

  it("coaching disabled when llmQuery is undefined", () => {
    const runtime = new MeetingRuntime({ dbPath });
    runtime.startMeeting();
    // No coaching timer should be set; no side effects from addSegment
    runtime.addSegment({ speaker: "user", text: "hi" });
    runtime.close();
  });

  it("createMeetingRuntime factory returns a usable runtime", () => {
    const runtime = createMeetingRuntime({ dbPath });
    expect(runtime).toBeInstanceOf(MeetingRuntime);
    runtime.close();
  });

  it("close is idempotent", () => {
    const runtime = new MeetingRuntime({ dbPath });
    runtime.close();
    expect(() => runtime.close()).not.toThrow();
  });
});
