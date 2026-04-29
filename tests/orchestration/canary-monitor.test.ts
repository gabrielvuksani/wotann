/**
 * Tests for canary post-deploy monitor (gstack port).
 *
 * Strategy: use injected clock + sleep so the test doesn't actually
 * wait between checks. The monitor's loop semantics are then
 * deterministic and unit-testable.
 */

import { describe, expect, it } from "vitest";

import {
  captureBaseline,
  DEFAULT_THRESHOLDS,
  runCanary,
} from "../../src/orchestration/canary-monitor.js";

function fakeClock(initialMs: number): { now: () => number; advance: (ms: number) => void } {
  let t = initialMs;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("runCanary", () => {
  it("reports healthy when all snapshots match baseline", async () => {
    const baseline = { errorRate: 0.01, p50LatencyMs: 100, p95LatencyMs: 200 };
    const clock = fakeClock(1000);
    const snaps = [baseline, baseline, baseline];
    let i = 0;
    const report = await runCanary({
      probe: async () => snaps[i++ % snaps.length]!,
      baseline,
      intervalMs: 50,
      maxDurationMs: 200,
      clock: clock.now,
      sleep: async (ms) => clock.advance(ms),
    });
    expect(report.status).toBe("healthy");
    expect(report.alerts.length).toBe(0);
    expect(report.checksRun).toBeGreaterThanOrEqual(2);
  });

  it("alerts when error rate climbs beyond threshold persistently", async () => {
    const baseline = { errorRate: 0.01, p50LatencyMs: 100, p95LatencyMs: 200 };
    // Spike error rate to 10% on every check
    const clock = fakeClock(1000);
    const report = await runCanary({
      probe: async () => ({ ...baseline, errorRate: 0.1 }),
      baseline,
      intervalMs: 50,
      maxDurationMs: 200,
      clock: clock.now,
      sleep: async (ms) => clock.advance(ms),
    });
    expect(report.status).not.toBe("healthy");
    expect(report.alerts.some((a) => a.metric === "errorRate")).toBe(true);
  });

  it("does NOT alert on a single transient blip (persist=2)", async () => {
    const baseline = { errorRate: 0.01, p50LatencyMs: 100, p95LatencyMs: 200 };
    const clock = fakeClock(1000);
    const sequence = [
      baseline,
      { ...baseline, errorRate: 0.1 }, // single spike
      baseline,
      baseline,
    ];
    let i = 0;
    const report = await runCanary({
      probe: async () => sequence[i++ % sequence.length]!,
      baseline,
      intervalMs: 50,
      maxDurationMs: 200,
      clock: clock.now,
      sleep: async (ms) => clock.advance(ms),
    });
    expect(report.alerts.some((a) => a.metric === "errorRate")).toBe(false);
  });

  it("flags critical when probe itself fails", async () => {
    const baseline = { errorRate: 0, p50LatencyMs: 100, p95LatencyMs: 200 };
    const clock = fakeClock(1000);
    const report = await runCanary({
      probe: async () => {
        throw new Error("connection refused");
      },
      baseline,
      intervalMs: 50,
      maxDurationMs: 100,
      clock: clock.now,
      sleep: async (ms) => clock.advance(ms),
    });
    expect(report.status).toBe("broken");
    expect(report.alerts[0]?.severity).toBe("critical");
    expect(report.alerts[0]?.message).toContain("Probe failed");
  });

  it("respects custom thresholds", async () => {
    const baseline = { errorRate: 0.01, p50LatencyMs: 100, p95LatencyMs: 200 };
    const clock = fakeClock(1000);
    // p95 doubles -> with default 2x threshold this would alert
    // but with stricter 5x threshold it should NOT
    const report = await runCanary({
      probe: async () => ({ ...baseline, p95LatencyMs: 400 }),
      baseline,
      intervalMs: 50,
      maxDurationMs: 200,
      thresholds: { ...DEFAULT_THRESHOLDS, latencyMultiplier: 5 },
      clock: clock.now,
      sleep: async (ms) => clock.advance(ms),
    });
    expect(report.alerts.some((a) => a.metric === "p95LatencyMs")).toBe(false);
  });
});

describe("captureBaseline", () => {
  it("averages N samples", async () => {
    let i = 0;
    const samples = [
      { errorRate: 0.01, p50LatencyMs: 100, p95LatencyMs: 200 },
      { errorRate: 0.03, p50LatencyMs: 200, p95LatencyMs: 400 },
    ];
    const baseline = await captureBaseline(async () => samples[i++ % samples.length]!, 2);
    expect(baseline.errorRate).toBeCloseTo(0.02);
    expect(baseline.p50LatencyMs).toBeCloseTo(150);
    expect(baseline.p95LatencyMs).toBeCloseTo(300);
  });
});
