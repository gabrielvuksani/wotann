/**
 * Coverage for src/tools/monitor.ts — the background-process event
 * streamer ported from Claude Code v2.1.98. These tests drive real
 * `node -e` subprocesses so we verify the pipe + exit wiring, not a
 * mock stand-in.
 */

import { describe, it, expect } from "vitest";
import { spawnMonitor, collectMonitorEvents } from "../../src/tools/monitor.js";

describe("spawnMonitor — session lifecycle", () => {
  it("emits stdout lines as discrete events and terminates with exit", async () => {
    const session = spawnMonitor({
      command: "node",
      args: ["-e", "console.log('one'); console.log('two'); console.log('three');"],
    });
    const events = await collectMonitorEvents(session, 10);
    const stdout = events.filter((e) => e.type === "stdout").map((e) => e.line);
    expect(stdout).toEqual(["one", "two", "three"]);
    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit?.exitCode).toBe(0);
    expect(session.isFinished()).toBe(true);
  });

  it("separates stdout and stderr into distinct event types", async () => {
    const session = spawnMonitor({
      command: "node",
      args: [
        "-e",
        "process.stdout.write('out\\n'); process.stderr.write('err\\n');",
      ],
    });
    const events = await collectMonitorEvents(session, 10);
    const byType = events.reduce<Record<string, string[]>>((acc, e) => {
      if (e.type === "stdout" || e.type === "stderr") {
        acc[e.type] = acc[e.type] ?? [];
        acc[e.type]!.push(e.line);
      }
      return acc;
    }, {});
    expect(byType.stdout).toEqual(["out"]);
    expect(byType.stderr).toEqual(["err"]);
  });

  it("propagates a non-zero exit code in the exit event", async () => {
    const session = spawnMonitor({
      command: "node",
      args: ["-e", "process.exit(7);"],
    });
    const events = await collectMonitorEvents(session, 5);
    const exit = events.find((e) => e.type === "exit");
    expect(exit?.exitCode).toBe(7);
  });

  it("stop() terminates a still-running process cleanly", async () => {
    // Node exits fast; a long setTimeout keeps the process alive until
    // stop() kills it so we can observe the signal path.
    const session = spawnMonitor({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 60_000);"],
    });
    // Give it a moment to start, then stop.
    await new Promise((r) => setTimeout(r, 50));
    await session.stop();
    expect(session.isFinished()).toBe(true);
  });

  it("assigns a unique session id per spawn", () => {
    const a = spawnMonitor({ command: "node", args: ["-e", ""] });
    const b = spawnMonitor({ command: "node", args: ["-e", ""] });
    expect(a.id).not.toEqual(b.id);
    return Promise.all([a.stop(), b.stop()]);
  });

  it("maxDurationMs enforces a wall-clock cap", async () => {
    const start = Date.now();
    const session = spawnMonitor({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 60_000);"],
      maxDurationMs: 200,
    });
    const events = await collectMonitorEvents(session, 5);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
  });
});
