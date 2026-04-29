/**
 * Canary post-deploy monitor — port of garrytan/gstack's /canary skill.
 *
 * What it does: after a deploy, watch live metrics (error rate,
 * latency, custom counters) for a short window and either confirm the
 * deploy is healthy or fire an alert that should trigger rollback.
 *
 * Inputs: a baseline metric set + a list of probes (functions that
 * return a metric snapshot). The monitor calls each probe at a fixed
 * cadence, compares the snapshot to the baseline, and emits typed
 * events that the caller can render or pipe into a notification
 * channel.
 *
 * Why a generic API instead of HTTP probes only: WOTANN canaries
 * are model + tool stability, not just web health. A typical use is
 * "after pushing a new system prompt, watch the agent's pass rate on
 * a smoke test for 2 minutes — if it drops > 20%, alert."
 */

export interface MetricSnapshot {
  readonly errorRate: number; // 0..1
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly costPerRequestUsd?: number;
  readonly customCounters?: Readonly<Record<string, number>>;
}

export interface CanaryAlert {
  readonly severity: "critical" | "high" | "medium";
  readonly message: string;
  readonly metric: string;
  readonly baseline: number;
  readonly observed: number;
  readonly checkNumber: number;
}

export interface CanaryHealthReport {
  readonly status: "healthy" | "degraded" | "broken";
  readonly checksRun: number;
  readonly alerts: ReadonlyArray<CanaryAlert>;
  readonly durationMs: number;
}

export type Probe = () => Promise<MetricSnapshot>;

export interface CanaryThresholds {
  readonly errorRateAbsoluteIncrease: number; // e.g. 0.02 = +2pp
  readonly latencyMultiplier: number; // e.g. 2 = alert at 2x baseline
  readonly costMultiplier: number; // e.g. 1.5
  readonly persistRequiredChecks: number; // alert only if N consecutive checks fail
}

export const DEFAULT_THRESHOLDS: CanaryThresholds = {
  errorRateAbsoluteIncrease: 0.02,
  latencyMultiplier: 2,
  costMultiplier: 1.5,
  persistRequiredChecks: 2,
};

export interface CanaryConfig {
  readonly probe: Probe;
  readonly baseline: MetricSnapshot;
  readonly intervalMs: number;
  readonly maxDurationMs: number;
  readonly thresholds?: CanaryThresholds;
  readonly onAlert?: (alert: CanaryAlert) => void;
  readonly onCheck?: (snapshot: MetricSnapshot, checkNumber: number) => void;
  readonly clock?: () => number; // injectable for tests
  readonly sleep?: (ms: number) => Promise<void>; // injectable
}

export async function runCanary(config: CanaryConfig): Promise<CanaryHealthReport> {
  const thresholds = config.thresholds ?? DEFAULT_THRESHOLDS;
  const clock = config.clock ?? Date.now;
  const sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const start = clock();
  const alerts: CanaryAlert[] = [];
  let checks = 0;

  const consecutive = new Map<string, number>(); // metric -> consecutive bad checks
  const fired = new Set<string>(); // metric:checkNumber => alert already emitted

  while (clock() - start < config.maxDurationMs) {
    let snap: MetricSnapshot;
    try {
      snap = await config.probe();
    } catch (err) {
      const alert: CanaryAlert = {
        severity: "critical",
        message: `Probe failed: ${err instanceof Error ? err.message : String(err)}`,
        metric: "probe",
        baseline: 0,
        observed: 0,
        checkNumber: ++checks,
      };
      alerts.push(alert);
      config.onAlert?.(alert);
      await sleep(config.intervalMs);
      continue;
    }
    checks++;
    config.onCheck?.(snap, checks);

    const evaluations = collectEvaluations(snap, config.baseline, thresholds, checks);
    for (const ev of evaluations) {
      if (ev.fail) {
        consecutive.set(ev.metric, (consecutive.get(ev.metric) ?? 0) + 1);
      } else {
        consecutive.set(ev.metric, 0);
      }
      const cur = consecutive.get(ev.metric) ?? 0;
      if (ev.fail && cur >= thresholds.persistRequiredChecks) {
        const alertKey = `${ev.metric}:${checks}`;
        if (!fired.has(alertKey)) {
          fired.add(alertKey);
          alerts.push(ev.alert);
          config.onAlert?.(ev.alert);
        }
      }
    }
    await sleep(config.intervalMs);
  }

  const status: CanaryHealthReport["status"] = alerts.some((a) => a.severity === "critical")
    ? "broken"
    : alerts.length > 0
      ? "degraded"
      : "healthy";
  return {
    status,
    checksRun: checks,
    alerts,
    durationMs: clock() - start,
  };
}

interface MetricEvaluation {
  readonly metric: string;
  readonly fail: boolean;
  readonly alert: CanaryAlert;
}

function collectEvaluations(
  snap: MetricSnapshot,
  baseline: MetricSnapshot,
  thresholds: CanaryThresholds,
  checkNumber: number,
): ReadonlyArray<MetricEvaluation> {
  const out: MetricEvaluation[] = [];
  const errorDelta = snap.errorRate - baseline.errorRate;
  out.push({
    metric: "errorRate",
    fail: errorDelta >= thresholds.errorRateAbsoluteIncrease,
    alert: {
      severity: "high",
      message: `Error rate climbed by ${(errorDelta * 100).toFixed(1)} percentage points`,
      metric: "errorRate",
      baseline: baseline.errorRate,
      observed: snap.errorRate,
      checkNumber,
    },
  });
  const latencyMultiplier =
    baseline.p95LatencyMs > 0 ? snap.p95LatencyMs / baseline.p95LatencyMs : 0;
  out.push({
    metric: "p95LatencyMs",
    fail: latencyMultiplier >= thresholds.latencyMultiplier,
    alert: {
      severity: "medium",
      message: `p95 latency increased ${latencyMultiplier.toFixed(1)}x`,
      metric: "p95LatencyMs",
      baseline: baseline.p95LatencyMs,
      observed: snap.p95LatencyMs,
      checkNumber,
    },
  });
  if (
    typeof snap.costPerRequestUsd === "number" &&
    typeof baseline.costPerRequestUsd === "number" &&
    baseline.costPerRequestUsd > 0
  ) {
    const costMultiplier = snap.costPerRequestUsd / baseline.costPerRequestUsd;
    out.push({
      metric: "costPerRequestUsd",
      fail: costMultiplier >= thresholds.costMultiplier,
      alert: {
        severity: "medium",
        message: `Cost per request increased ${costMultiplier.toFixed(1)}x`,
        metric: "costPerRequestUsd",
        baseline: baseline.costPerRequestUsd,
        observed: snap.costPerRequestUsd,
        checkNumber,
      },
    });
  }
  return out;
}

/**
 * Convenience helper — captures the current state via N samples of
 * the probe and averages them into a baseline. Use this BEFORE the
 * deploy so the canary has something stable to compare against.
 */
export async function captureBaseline(probe: Probe, samples = 5): Promise<MetricSnapshot> {
  if (samples <= 0) throw new Error("captureBaseline samples must be > 0");
  const snaps: MetricSnapshot[] = [];
  for (let i = 0; i < samples; i++) {
    snaps.push(await probe());
  }
  const avg = (key: keyof MetricSnapshot) => {
    const vals = snaps.map((s) => s[key]).filter((v): v is number => typeof v === "number");
    return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
  };
  return {
    errorRate: avg("errorRate"),
    p50LatencyMs: avg("p50LatencyMs"),
    p95LatencyMs: avg("p95LatencyMs"),
    costPerRequestUsd: avg("costPerRequestUsd"),
  };
}
