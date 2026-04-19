/**
 * Phase-C wire-up coverage for the Monitor tool. Validates:
 *   1. Schema registration (buildEffectiveTools advertises `monitor`)
 *   2. Input parsing / validation in the dispatcher
 *   3. Streaming event dispatch (dispatchMonitorStream yields per-event)
 *   4. Collected dispatch (dispatchMonitor joins into one envelope)
 *   5. End-to-end behaviour with a fake MonitorSession factory so the
 *      tests stay hermetic — no child processes spawned here. The real
 *      spawn-path is covered by tests/unit/monitor-tool.test.ts.
 */

import { describe, it, expect } from "vitest";
import { buildEffectiveTools, RUNTIME_TOOL_NAMES, isRuntimeTool } from "../../src/core/runtime-tools.js";
import {
  dispatchMonitor,
  dispatchMonitorStream,
  dispatchRuntimeTool,
  formatMonitorEvent,
  MONITOR_MAX_DURATION_MS,
  MONITOR_MAX_EVENTS_PER_RESULT,
  type MonitorDep,
  type ToolDispatchContext,
} from "../../src/core/runtime-tool-dispatch.js";
import type { MonitorEvent, MonitorOptions, MonitorSession } from "../../src/tools/monitor.js";
import type { ProviderName } from "../../src/core/types.js";

// ── Test helpers ────────────────────────────────────────────

const ctx: ToolDispatchContext = {
  responseProvider: "anthropic" as ProviderName,
  responseModel: "claude-opus-4-7",
};

function makeFakeSession(events: readonly MonitorEvent[], opts: { id?: string } = {}): MonitorSession {
  let stopped = false;
  let finished = false;
  async function* iterator(): AsyncGenerator<MonitorEvent> {
    for (const event of events) {
      if (stopped) return;
      yield event;
      if (event.type === "exit") {
        finished = true;
        return;
      }
    }
    finished = true;
  }
  return {
    id: opts.id ?? "mon-fake-test",
    events: iterator(),
    async stop() {
      stopped = true;
      finished = true;
    },
    isFinished: () => finished,
  };
}

function fakeMonitor(session: MonitorSession): MonitorDep {
  return {
    spawn() {
      return session;
    },
  };
}

// ── Schema registration ─────────────────────────────────────

describe("Monitor tool — schema registration", () => {
  it("registers `monitor` in RUNTIME_TOOL_NAMES", () => {
    expect(RUNTIME_TOOL_NAMES).toContain("monitor");
  });

  it("isRuntimeTool recognises `monitor`", () => {
    expect(isRuntimeTool("monitor")).toBe(true);
  });

  it("buildEffectiveTools emits a `monitor` tool definition with the documented schema", () => {
    const tools = buildEffectiveTools([], {
      computerUseEnabled: false,
      planStoreAvailable: false,
      lspEnabled: false,
    });
    const monitor = tools.find((t) => t.name === "monitor");
    expect(monitor).toBeDefined();
    expect(monitor?.description).toMatch(/sleep/i);
    const schema = monitor?.inputSchema as {
      type: string;
      properties: Record<string, { type: string }>;
      required: string[];
    };
    expect(schema.type).toBe("object");
    expect(schema.properties["command"]?.type).toBe("string");
    expect(schema.properties["args"]?.type).toBe("array");
    expect(schema.properties["cwd"]?.type).toBe("string");
    expect(schema.properties["maxDurationMs"]?.type).toBe("number");
    expect(schema.required).toEqual(["command"]);
    // Must NOT leak `env` or `bufferBytes` to the LLM — those are
    // internal-only and security-sensitive.
    expect(schema.properties["env"]).toBeUndefined();
    expect(schema.properties["bufferBytes"]).toBeUndefined();
  });
});

// ── Input validation ────────────────────────────────────────

describe("dispatchMonitor — input validation", () => {
  it("returns an error envelope when `command` is missing", async () => {
    const session = makeFakeSession([]);
    const result = await dispatchMonitor({}, fakeMonitor(session), ctx);
    expect(result.content).toContain("[monitor] Error: missing or empty `command`");
  });

  it("returns an error envelope when `command` is empty string", async () => {
    const session = makeFakeSession([]);
    const result = await dispatchMonitor({ command: "   " }, fakeMonitor(session), ctx);
    expect(result.content).toContain("Error: missing or empty `command`");
  });

  it("rejects non-array `args`", async () => {
    const session = makeFakeSession([]);
    const result = await dispatchMonitor(
      { command: "ls", args: "not-an-array" as unknown },
      fakeMonitor(session),
      ctx,
    );
    expect(result.content).toContain("`args` must be an array of strings");
  });

  it("rejects `args` with non-string elements", async () => {
    const session = makeFakeSession([]);
    const result = await dispatchMonitor(
      { command: "ls", args: ["-l", 42 as unknown] },
      fakeMonitor(session),
      ctx,
    );
    expect(result.content).toContain("`args` must be an array of strings");
  });

  it("rejects negative `maxDurationMs`", async () => {
    const session = makeFakeSession([]);
    const result = await dispatchMonitor(
      { command: "ls", maxDurationMs: -5 },
      fakeMonitor(session),
      ctx,
    );
    expect(result.content).toContain("non-negative finite number");
  });

  it("rejects non-finite `maxDurationMs`", async () => {
    const session = makeFakeSession([]);
    const result = await dispatchMonitor(
      { command: "ls", maxDurationMs: Number.POSITIVE_INFINITY },
      fakeMonitor(session),
      ctx,
    );
    expect(result.content).toContain("non-negative finite number");
  });

  it("clamps oversized `maxDurationMs` to the runtime ceiling", async () => {
    let received: MonitorOptions | null = null;
    const dep: MonitorDep = {
      spawn(options) {
        received = options;
        return makeFakeSession([
          { type: "exit", elapsedMs: 1, line: "", exitCode: 0, signal: null },
        ]);
      },
    };
    await dispatchMonitor(
      { command: "ls", maxDurationMs: MONITOR_MAX_DURATION_MS * 10 },
      dep,
      ctx,
    );
    expect(received).not.toBeNull();
    expect(received!.maxDurationMs).toBe(MONITOR_MAX_DURATION_MS);
  });

  it("treats `maxDurationMs: 0` as `run up to the runtime ceiling`", async () => {
    let received: MonitorOptions | null = null;
    const dep: MonitorDep = {
      spawn(options) {
        received = options;
        return makeFakeSession([
          { type: "exit", elapsedMs: 1, line: "", exitCode: 0, signal: null },
        ]);
      },
    };
    await dispatchMonitor({ command: "ls", maxDurationMs: 0 }, dep, ctx);
    expect(received!.maxDurationMs).toBe(MONITOR_MAX_DURATION_MS);
  });
});

// ── Streaming dispatch ──────────────────────────────────────

describe("dispatchMonitorStream — per-event yielding", () => {
  it("yields a header, one envelope per event, and a final summary", async () => {
    const events: readonly MonitorEvent[] = [
      { type: "stdout", elapsedMs: 10, line: "starting" },
      { type: "stdout", elapsedMs: 20, line: "working" },
      { type: "exit", elapsedMs: 30, line: "", exitCode: 0, signal: null },
    ];
    const session = makeFakeSession(events, { id: "mon-abc" });
    const chunks: string[] = [];
    for await (const chunk of dispatchMonitorStream({ command: "sleep", args: ["1"] }, fakeMonitor(session), ctx)) {
      chunks.push(chunk.content);
    }
    // Header + 3 events + exit summary = 5 chunks
    expect(chunks.length).toBe(5);
    expect(chunks[0]).toContain("[monitor mon-abc] streaming sleep 1");
    expect(chunks[1]).toContain("[out 10ms] starting");
    expect(chunks[2]).toContain("[out 20ms] working");
    expect(chunks[3]).toContain("[exit 30ms] code=0");
    expect(chunks[4]).toContain("exitCode=0");
    expect(chunks[4]).toContain("totalDurationMs=30");
  });

  it("surfaces stderr under a distinct [err ...] prefix", async () => {
    const session = makeFakeSession([
      { type: "stderr", elapsedMs: 5, line: "warning: slow" },
      { type: "exit", elapsedMs: 10, line: "", exitCode: 0, signal: null },
    ]);
    const chunks: string[] = [];
    for await (const chunk of dispatchMonitorStream({ command: "noisy" }, fakeMonitor(session), ctx)) {
      chunks.push(chunk.content);
    }
    expect(chunks.join("")).toContain("[err 5ms] warning: slow");
  });

  it("propagates a non-zero exit code into the summary", async () => {
    const session = makeFakeSession([
      { type: "stdout", elapsedMs: 1, line: "boom" },
      { type: "exit", elapsedMs: 2, line: "", exitCode: 7, signal: null },
    ]);
    const chunks: string[] = [];
    for await (const chunk of dispatchMonitorStream({ command: "fail" }, fakeMonitor(session), ctx)) {
      chunks.push(chunk.content);
    }
    const joined = chunks.join("");
    expect(joined).toContain("exitCode=7");
  });

  it("propagates a signal into the summary when the process was killed", async () => {
    const session = makeFakeSession([
      { type: "exit", elapsedMs: 100, line: "", exitCode: null, signal: "SIGTERM" as NodeJS.Signals },
    ]);
    const chunks: string[] = [];
    for await (const chunk of dispatchMonitorStream({ command: "sleep", args: ["999"] }, fakeMonitor(session), ctx)) {
      chunks.push(chunk.content);
    }
    const joined = chunks.join("");
    expect(joined).toContain("signal=SIGTERM");
    expect(joined).toContain("exitCode=null");
  });

  it("emits a spawn-failure envelope and returns cleanly when spawn throws", async () => {
    const dep: MonitorDep = {
      spawn() {
        throw new Error("EACCES: permission denied");
      },
    };
    const chunks: string[] = [];
    for await (const chunk of dispatchMonitorStream({ command: "/root/secret" }, dep, ctx)) {
      chunks.push(chunk.content);
    }
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain("[monitor] Spawn failed: EACCES: permission denied");
  });

  it("each chunk carries the provider + model from the dispatch context", async () => {
    const customCtx: ToolDispatchContext = {
      responseProvider: "ollama" as ProviderName,
      responseModel: "gemma-4-12b",
    };
    const session = makeFakeSession([
      { type: "exit", elapsedMs: 1, line: "", exitCode: 0, signal: null },
    ]);
    for await (const chunk of dispatchMonitorStream({ command: "ls" }, fakeMonitor(session), customCtx)) {
      expect(chunk.provider).toBe("ollama");
      expect(chunk.model).toBe("gemma-4-12b");
      expect(chunk.type).toBe("text");
    }
  });
});

// ── Collected dispatch ──────────────────────────────────────

describe("dispatchMonitor — collected envelope", () => {
  it("joins every streamed chunk into a single content string", async () => {
    const session = makeFakeSession([
      { type: "stdout", elapsedMs: 1, line: "hello" },
      { type: "stdout", elapsedMs: 2, line: "world" },
      { type: "exit", elapsedMs: 3, line: "", exitCode: 0, signal: null },
    ]);
    const result = await dispatchMonitor({ command: "echo" }, fakeMonitor(session), ctx);
    expect(result.type).toBe("text");
    expect(result.content).toContain("streaming echo");
    expect(result.content).toContain("[out 1ms] hello");
    expect(result.content).toContain("[out 2ms] world");
    expect(result.content).toContain("exitCode=0");
  });

  it("includes a `truncated` marker when the monitor emits one", async () => {
    const session = makeFakeSession([
      { type: "truncated", elapsedMs: 5, line: "" },
      { type: "exit", elapsedMs: 6, line: "", exitCode: 0, signal: null },
    ]);
    const result = await dispatchMonitor({ command: "chatty" }, fakeMonitor(session), ctx);
    expect(result.content).toContain("[truncated");
  });
});

// ── Per-result event cap ────────────────────────────────────

describe("dispatchMonitor — runaway cap", () => {
  it("stops the session and announces the cap when event count exceeds MONITOR_MAX_EVENTS_PER_RESULT", async () => {
    // Build a stream with one more stdout event than the cap, followed by
    // an exit that should never be reached because the cap fires first.
    const noisy: MonitorEvent[] = [];
    for (let i = 0; i < MONITOR_MAX_EVENTS_PER_RESULT + 5; i += 1) {
      noisy.push({ type: "stdout", elapsedMs: i, line: `line-${i}` });
    }
    noisy.push({ type: "exit", elapsedMs: 9999, line: "", exitCode: 0, signal: null });
    const session = makeFakeSession(noisy);
    const result = await dispatchMonitor({ command: "yes" }, fakeMonitor(session), ctx);
    expect(result.content).toContain("hit per-result cap");
    expect(result.content).toContain(String(MONITOR_MAX_EVENTS_PER_RESULT));
  });
});

// ── formatMonitorEvent pure helper ──────────────────────────

describe("formatMonitorEvent", () => {
  it("formats stdout with an [out ...] prefix", () => {
    expect(
      formatMonitorEvent({ type: "stdout", elapsedMs: 42, line: "hello" }),
    ).toContain("[out 42ms] hello");
  });

  it("formats stderr with an [err ...] prefix", () => {
    expect(
      formatMonitorEvent({ type: "stderr", elapsedMs: 100, line: "oops" }),
    ).toContain("[err 100ms] oops");
  });

  it("formats error events with an [error ...] prefix", () => {
    expect(
      formatMonitorEvent({ type: "error", elapsedMs: 1, line: "spawn failed" }),
    ).toContain("[error 1ms] spawn failed");
  });

  it("formats exit with both exitCode and signal", () => {
    expect(
      formatMonitorEvent({
        type: "exit",
        elapsedMs: 500,
        line: "",
        exitCode: 137,
        signal: "SIGKILL" as NodeJS.Signals,
      }),
    ).toContain("code=137 signal=SIGKILL");
  });

  it("formats truncated as a single marker line", () => {
    expect(
      formatMonitorEvent({ type: "truncated", elapsedMs: 0, line: "" }),
    ).toContain("[truncated");
  });
});

// ── Unified dispatcher ──────────────────────────────────────

describe("dispatchRuntimeTool — `monitor` handler wiring", () => {
  it("returns null when the monitor dep is absent (honours null-over-silent-success)", async () => {
    const result = await dispatchRuntimeTool(
      "monitor",
      { command: "ls" },
      { webFetch: { fetch: async () => ({
          url: "",
          status: 0,
          contentType: "",
          content: "",
          markdown: "",
          title: null,
          byteLength: 0,
          fetchDurationMs: 0,
          truncated: false,
        }) }, planStore: null },
      ctx,
    );
    expect(result).toBeNull();
  });

  it("delegates to dispatchMonitor when the dep is provided", async () => {
    const session = makeFakeSession([
      { type: "stdout", elapsedMs: 1, line: "ok" },
      { type: "exit", elapsedMs: 2, line: "", exitCode: 0, signal: null },
    ]);
    const result = await dispatchRuntimeTool(
      "monitor",
      { command: "echo", args: ["ok"] },
      {
        webFetch: { fetch: async () => ({
          url: "",
          status: 0,
          contentType: "",
          content: "",
          markdown: "",
          title: null,
          byteLength: 0,
          fetchDurationMs: 0,
          truncated: false,
        }) },
        planStore: null,
        monitor: fakeMonitor(session),
      },
      ctx,
    );
    expect(result).not.toBeNull();
    expect(result!.content).toContain("[out 1ms] ok");
    expect(result!.content).toContain("exitCode=0");
  });

  it("returns null for unknown tool names (does not collide with `monitor`)", async () => {
    const result = await dispatchRuntimeTool(
      "does_not_exist",
      {},
      { webFetch: { fetch: async () => ({
          url: "",
          status: 0,
          contentType: "",
          content: "",
          markdown: "",
          title: null,
          byteLength: 0,
          fetchDurationMs: 0,
          truncated: false,
        }) }, planStore: null },
      ctx,
    );
    expect(result).toBeNull();
  });
});
