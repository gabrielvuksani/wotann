/**
 * Meta-Harness — compute-strategy selector for WOTANN tasks.
 *
 * PORT OF: Stanford IRIS Meta-Harness (960+ stars). IRIS introduces
 * "meta-harness" as the layer that decides HOW a task should run
 * before any worker is spawned: local execution, cloud offload, or a
 * hybrid pipeline where the discovery phase runs locally and the
 * heavy-lift phase runs remotely. WOTANN gains this as a pure policy
 * function that keys off (complexity estimate, budget, availability).
 *
 * RELATIONSHIP TO EXISTING MODULES:
 *   - coordinator.ts            — owns DAG-based phase execution. Meta-Harness
 *     decides which SIDE of the wire the coordinator runs on.
 *   - providers/cloud-offload/* — concrete remote backends (Fly / Anthropic
 *     Managed / Cloudflare Agents). Meta-Harness never reaches into them;
 *     it returns a `strategy` tag and the caller picks.
 *   - providers/budget-downgrader.ts — spend-aware model tier policy.
 *     Meta-Harness pairs with it: downgrader picks the model, meta-harness
 *     picks the topology.
 *
 * QUALITY BARS HONORED:
 *   - QB #6 (honest stubs): every input is validated; illegal or missing
 *     fields produce a `{ok: false, reason: "..."}` result, never a silent
 *     fallback to "local".
 *   - QB #7 (per-caller state): createMetaHarness() returns a fresh
 *     policy closure per call. No module-global state.
 *   - QB #13 (env guard): this module NEVER reads process.env. Every knob
 *     (provider availability, budget snapshot, quotas) is injected via
 *     MetaHarnessInputs.
 *   - QB #11 (sibling-site scan): callers in orchestration/autonomous.ts
 *     and daemon/* are the touch-points; meta-harness stays pure.
 */

// ── Strategy enum ────────────────────────────────────────────

/**
 * The three compute strategies WOTANN supports.
 *
 * - `local`          : run every phase on the caller's machine. Cheapest,
 *                      lowest latency, bounded by local CPU/RAM.
 * - `cloud-offload`  : push the full task to a cloud adapter (Fly Sprites,
 *                      Anthropic Managed, Cloudflare Agents). No local work
 *                      after the snapshot is uploaded.
 * - `hybrid`         : discovery / planning / quick edits stay local; the
 *                      heavy implementation phase executes via cloud offload
 *                      and streams back. Best trade-off for long tasks with
 *                      tight interactive budgets.
 */
export type MetaHarnessStrategy = "local" | "cloud-offload" | "hybrid";

/**
 * Canonical complexity buckets. These are deliberately coarse — sub-tier
 * tuning lives in the scoring function, not in the enum. Callers that
 * want a numeric score for telemetry can read `MetaHarnessDecision.score`.
 */
export type TaskComplexity = "trivial" | "small" | "medium" | "large" | "xlarge";

// ── Input shapes ─────────────────────────────────────────────

/**
 * A complexity signal the caller already has. We consume whichever is
 * available — all are optional — and fold them into a single numeric
 * score on a 0.0 – 1.0 scale.
 */
export interface ComplexitySignals {
  /** Estimated prompt + expected output tokens. */
  readonly estimatedTokens?: number;
  /** Number of files the task is expected to modify. */
  readonly expectedFilesTouched?: number;
  /** Number of discrete phases / subtasks (research + spec + implement + ...). */
  readonly phaseCount?: number;
  /** Wall-clock budget the user signalled (minutes). */
  readonly expectedDurationMinutes?: number;
  /** Explicit hint from an upstream analyst — overrides everything else. */
  readonly explicitBucket?: TaskComplexity;
}

/**
 * Budget snapshot. Meta-harness needs the remaining fraction (not the
 * absolute spend) so thresholds stay stable whatever the user's cap is.
 */
export interface BudgetSnapshot {
  /** USD spent so far. */
  readonly spentUsd: number;
  /** USD cap, or Infinity if no cap. */
  readonly capUsd: number;
  /** Hard floor on remaining budget (USD) below which we refuse cloud. */
  readonly cloudFloorUsd?: number;
}

/**
 * Provider availability. Keys must match CloudOffloadProvider tokens so
 * downstream routing stays consistent — but we use a plain string here so
 * this module has zero cross-package imports (keeping the complexity
 * surface tight).
 */
export interface ProviderAvailability {
  /** Is any cloud-offload adapter registered? */
  readonly cloudOffloadAvailable: boolean;
  /** Concrete adapter ids that are live (e.g. "fly-sprites"). */
  readonly liveAdapters: readonly string[];
  /** Local execution available? (false in extreme sandbox tests only). */
  readonly localAvailable: boolean;
}

/**
 * Preferences the caller can pin. Every field is optional — the policy
 * works without any of them. When two fields conflict (e.g. "prefer
 * local" + "force cloud"), the latter wins.
 */
export interface MetaHarnessPreferences {
  /** If true, only local will be chosen unless local is unavailable. */
  readonly preferLocal?: boolean;
  /** If true, force cloud-offload even when local is cheaper. */
  readonly forceCloud?: boolean;
  /** If true, allow the hybrid path (default true). */
  readonly allowHybrid?: boolean;
  /** Max USD for this decision — overrides budget snapshot when set. */
  readonly maxUsdForThisTask?: number;
}

/**
 * Full input envelope for `decide()`. Every field is injected — the
 * module cannot observe the host environment.
 */
export interface MetaHarnessInputs {
  readonly complexity: ComplexitySignals;
  readonly budget: BudgetSnapshot;
  readonly availability: ProviderAvailability;
  readonly preferences?: MetaHarnessPreferences;
}

// ── Output shapes ────────────────────────────────────────────

/** Successful decision envelope. Always immutable. */
export interface MetaHarnessSuccess {
  readonly ok: true;
  readonly strategy: MetaHarnessStrategy;
  readonly complexity: TaskComplexity;
  /** Complexity score on 0..1. Useful for telemetry + downstream routing. */
  readonly score: number;
  /** Which adapter to route to when strategy !== "local". */
  readonly suggestedAdapter?: string;
  /** Human-readable explanation — surfaced in logs, UI, and audit trails. */
  readonly reason: string;
  /** Estimated USD cost under the chosen strategy. */
  readonly estimatedCostUsd: number;
  /** Decisions that were evaluated and rejected, with reasons. */
  readonly rejectedAlternatives: readonly {
    readonly strategy: MetaHarnessStrategy;
    readonly reason: string;
  }[];
}

/**
 * Failure envelope. Emitted only when the INPUTS are unusable (bad
 * shape, contradictory prefs, no adapter available under forceCloud).
 * Normal task policy always produces ok:true.
 */
export interface MetaHarnessFailure {
  readonly ok: false;
  readonly reason: string;
}

export type MetaHarnessDecision = MetaHarnessSuccess | MetaHarnessFailure;

// ── Constants ────────────────────────────────────────────────

// Bucket boundaries on the [0, 1] complexity score. Calibrated against
// the V9 §1577 integration test matrix:
//   trivial : 500 tok · 1 file · 1 phase           → score ≈ 0.02
//   small   : 15 K tok · 3 files · 2 phases        → score ≈ 0.08
//   medium  : 60 K tok · 12 files · 4 phases       → score ≈ 0.25
//   large   : 140 K tok · 30 files · 6 phases · 90 min → score ≈ 0.67
//   xlarge  : explicitBucket override or score ≥ 0.70
/** Upper bound of "trivial" — tiny scripted edits. */
const THRESHOLD_TRIVIAL = 0.05;
/** Upper bound of "small" — single-file edits, <5 files. */
const THRESHOLD_SMALL = 0.2;
/** Upper bound of "medium" — multi-file feature, <20 files. */
const THRESHOLD_MEDIUM = 0.45;
/** Upper bound of "large" — cross-module refactor, >20 files. */
const THRESHOLD_LARGE = 0.7;
/** Above this: xlarge (multi-hour runs, 1000+ files). */

/**
 * Weight map for signal aggregation. Values sum to 1.0 so the resulting
 * score is naturally in [0, 1]. Re-tunable without API changes.
 */
const SIGNAL_WEIGHTS = {
  tokens: 0.35,
  files: 0.25,
  phases: 0.15,
  duration: 0.25,
} as const;

/**
 * Normalization caps for each signal. Input above these saturates at 1.0
 * for that axis. Deliberately conservative — WOTANN real-world tasks rarely
 * exceed these, and callers with legitimate outliers can pass
 * `explicitBucket: "xlarge"` to bypass the heuristic.
 */
// Calibrated against the V9 §1577 integration test inputs. Higher caps
// than the per-task "fits in cache" feel — these define when a SIGNAL
// saturates at its weight, not when a task is "big". Picked together
// with THRESHOLD_* so the small/medium/large fixture inputs land in the
// expected buckets without explicit overrides.
const NORM_TOKENS = 180_000;
const NORM_FILES = 40;
const NORM_PHASES = 10;
const NORM_DURATION_MIN = 180;

/**
 * Default per-strategy cost model (USD per unit of estimated work).
 * Values are deliberately approximate — the caller is expected to pass
 * its own via MetaHarnessPreferences when precision matters.
 */
const LOCAL_COST_PER_TOKEN = 0;
/** Cloud offload includes compute + egress. Tuned to match cheap Fly VMs. */
const CLOUD_COST_PER_TOKEN = 0.00002;
/** Hybrid: ~60% of work happens locally (free), 40% remote. */
const HYBRID_CLOUD_FRACTION = 0.4;

// ── Public factory ────────────────────────────────────────────

/**
 * Create a MetaHarness policy instance. Callers that want a stateless
 * one-off decision should use the free `decide()` function instead;
 * this factory exists for scenarios where the caller wants to inject a
 * custom clock or override thresholds per-session without a module
 * mutation.
 */
export interface MetaHarnessOverrides {
  /** Replace the default tokens-per-USD cost model. */
  readonly cloudCostPerToken?: number;
  /** Fraction of tokens that go remote under hybrid strategy. */
  readonly hybridCloudFraction?: number;
  /**
   * Override the complexity-bucket thresholds. Must be strictly ascending
   * within (0, 1). Invalid shapes cause decide() to return ok:false.
   */
  readonly complexityThresholds?: {
    readonly trivial: number;
    readonly small: number;
    readonly medium: number;
    readonly large: number;
  };
}

export interface MetaHarness {
  readonly decide: (inputs: MetaHarnessInputs) => MetaHarnessDecision;
}

export function createMetaHarness(overrides: MetaHarnessOverrides = {}): MetaHarness {
  return {
    decide: (inputs) => decide(inputs, overrides),
  };
}

// ── Pure decision function ───────────────────────────────────

/**
 * Evaluate inputs and produce a decision. Pure — no I/O, no clock, no
 * env reads. Safe to call from test harnesses and planner agents.
 */
export function decide(
  inputs: MetaHarnessInputs,
  overrides: MetaHarnessOverrides = {},
): MetaHarnessDecision {
  const validation = validateInputs(inputs, overrides);
  if (!validation.ok) return validation;

  const score = computeComplexityScore(inputs.complexity);
  const thresholds = overrides.complexityThresholds ?? {
    trivial: THRESHOLD_TRIVIAL,
    small: THRESHOLD_SMALL,
    medium: THRESHOLD_MEDIUM,
    large: THRESHOLD_LARGE,
  };
  const bucket = inputs.complexity.explicitBucket ?? scoreToBucket(score, thresholds);

  // Enforce hard preference overrides first.
  const prefs = inputs.preferences ?? {};
  if (prefs.preferLocal === true && prefs.forceCloud === true) {
    return {
      ok: false,
      reason: "preferences contradict: preferLocal AND forceCloud both set",
    };
  }

  const availability = inputs.availability;
  if (!availability.localAvailable && !availability.cloudOffloadAvailable) {
    return {
      ok: false,
      reason: "no execution backend available: local=false, cloudOffload=false",
    };
  }

  if (prefs.forceCloud === true && !availability.cloudOffloadAvailable) {
    return {
      ok: false,
      reason: "forceCloud=true but no cloud-offload adapter is registered",
    };
  }

  const estimatedTokens = normalizeTokens(inputs.complexity);
  const cloudCostPerToken = overrides.cloudCostPerToken ?? CLOUD_COST_PER_TOKEN;
  const hybridFraction = clampFraction(overrides.hybridCloudFraction ?? HYBRID_CLOUD_FRACTION);

  const localCost = estimatedTokens * LOCAL_COST_PER_TOKEN;
  const cloudCost = estimatedTokens * cloudCostPerToken;
  const hybridCost = estimatedTokens * hybridFraction * cloudCostPerToken;

  const remainingBudget = computeRemainingBudget(inputs.budget, prefs);
  const cloudFloor = inputs.budget.cloudFloorUsd ?? 0;

  // Candidate evaluation — we build a list, then pick the best.
  const rejected: { strategy: MetaHarnessStrategy; reason: string }[] = [];

  // Evaluate cloud-offload first — if forced, it short-circuits.
  if (prefs.forceCloud === true) {
    return buildSuccess({
      strategy: "cloud-offload",
      bucket,
      score,
      adapter: pickAdapter(availability.liveAdapters),
      reason: "forceCloud preference active",
      cost: cloudCost,
      rejected: [
        { strategy: "local", reason: "forceCloud preference excluded local" },
        { strategy: "hybrid", reason: "forceCloud preference excluded hybrid" },
      ],
    });
  }

  // Evaluate local. Local is "ok" for routing purposes whenever the host
  // has a local backend. We note a soft preference against local for
  // xlarge tasks but don't hard-disable it — the xlarge branch below
  // still falls through to local as a last-resort when both remote
  // strategies are rejected.
  const localOk = availability.localAvailable;
  if (!availability.localAvailable) {
    rejected.push({ strategy: "local", reason: "local unavailable" });
  }

  // Evaluate cloud-offload (non-forced path). The cloudFloorUsd hard
  // floor is checked FIRST so callers that configure an explicit floor
  // see that specific reason surface, even when the task's cloudCost
  // would also exceed the remainingBudget.
  let cloudOk = true;
  let cloudReason = "";
  if (!availability.cloudOffloadAvailable) {
    cloudOk = false;
    cloudReason = "no cloud-offload adapter registered";
    rejected.push({ strategy: "cloud-offload", reason: cloudReason });
  } else if (remainingBudget !== null && cloudFloor > 0 && remainingBudget < cloudFloor) {
    cloudOk = false;
    cloudReason = `remaining budget ${remainingBudget.toFixed(4)} below cloudFloorUsd ${cloudFloor.toFixed(4)}`;
    rejected.push({ strategy: "cloud-offload", reason: cloudReason });
  } else if (remainingBudget !== null && remainingBudget < cloudCost) {
    cloudOk = false;
    cloudReason = `cloud cost ${cloudCost.toFixed(4)} exceeds remaining budget ${remainingBudget.toFixed(4)}`;
    rejected.push({ strategy: "cloud-offload", reason: cloudReason });
  }

  // Evaluate hybrid (requires both sides alive).
  let hybridOk = prefs.allowHybrid !== false;
  let hybridReason = "";
  if (!hybridOk) {
    hybridReason = "allowHybrid=false";
    rejected.push({ strategy: "hybrid", reason: hybridReason });
  } else if (!availability.localAvailable || !availability.cloudOffloadAvailable) {
    hybridOk = false;
    hybridReason = "hybrid requires BOTH local + cloud; one missing";
    rejected.push({ strategy: "hybrid", reason: hybridReason });
  } else if (remainingBudget !== null && remainingBudget < hybridCost) {
    hybridOk = false;
    hybridReason = `hybrid cost ${hybridCost.toFixed(4)} exceeds remaining budget ${remainingBudget.toFixed(4)}`;
    rejected.push({ strategy: "hybrid", reason: hybridReason });
  }

  // Picking: bucket drives the primary choice, availability trims it.
  //
  // Rules:
  //   trivial, small          → local preferred
  //   medium                  → local preferred; hybrid if preferLocal=false + both ok
  //   large                   → hybrid preferred; local if no cloud; cloud if no local
  //   xlarge                  → cloud-offload preferred; hybrid fallback; local only if no cloud
  //
  // Preferences override priority ordering (preferLocal flips the
  // medium/large tie-breakers back to local when viable).

  const preferLocal = prefs.preferLocal === true;

  if (bucket === "trivial" || bucket === "small") {
    if (localOk) {
      return buildSuccess({
        strategy: "local",
        bucket,
        score,
        reason: `${bucket} task runs locally — no remote overhead worth paying`,
        cost: localCost,
        rejected,
      });
    }
    if (hybridOk) {
      return buildSuccess({
        strategy: "hybrid",
        bucket,
        score,
        adapter: pickAdapter(availability.liveAdapters),
        reason: `${bucket} task would prefer local, but local unavailable — hybrid fallback`,
        cost: hybridCost,
        rejected,
      });
    }
    if (cloudOk) {
      return buildSuccess({
        strategy: "cloud-offload",
        bucket,
        score,
        adapter: pickAdapter(availability.liveAdapters),
        reason: `${bucket} task forced to cloud — local unavailable`,
        cost: cloudCost,
        rejected,
      });
    }
  }

  if (bucket === "medium") {
    if (preferLocal && localOk) {
      return buildSuccess({
        strategy: "local",
        bucket,
        score,
        reason: "medium task + preferLocal=true — running locally",
        cost: localCost,
        rejected,
      });
    }
    if (hybridOk) {
      return buildSuccess({
        strategy: "hybrid",
        bucket,
        score,
        adapter: pickAdapter(availability.liveAdapters),
        reason: "medium task — hybrid keeps discovery local, heavy-lift remote",
        cost: hybridCost,
        rejected,
      });
    }
    if (localOk) {
      return buildSuccess({
        strategy: "local",
        bucket,
        score,
        reason: "medium task — hybrid unavailable, falling back to local",
        cost: localCost,
        rejected,
      });
    }
    if (cloudOk) {
      return buildSuccess({
        strategy: "cloud-offload",
        bucket,
        score,
        adapter: pickAdapter(availability.liveAdapters),
        reason: "medium task — only cloud available",
        cost: cloudCost,
        rejected,
      });
    }
  }

  if (bucket === "large") {
    if (preferLocal && localOk) {
      return buildSuccess({
        strategy: "local",
        bucket,
        score,
        reason: "large task + preferLocal=true — accepting slower run on local",
        cost: localCost,
        rejected,
      });
    }
    if (hybridOk) {
      return buildSuccess({
        strategy: "hybrid",
        bucket,
        score,
        adapter: pickAdapter(availability.liveAdapters),
        reason: "large task — hybrid shifts heavy implementation to cloud",
        cost: hybridCost,
        rejected,
      });
    }
    if (cloudOk) {
      return buildSuccess({
        strategy: "cloud-offload",
        bucket,
        score,
        adapter: pickAdapter(availability.liveAdapters),
        reason: "large task — no hybrid, full cloud-offload",
        cost: cloudCost,
        rejected,
      });
    }
    if (localOk) {
      return buildSuccess({
        strategy: "local",
        bucket,
        score,
        reason: "large task — no cloud/hybrid; accepting slower local run",
        cost: localCost,
        rejected,
      });
    }
  }

  // bucket === "xlarge"
  if (cloudOk) {
    return buildSuccess({
      strategy: "cloud-offload",
      bucket,
      score,
      adapter: pickAdapter(availability.liveAdapters),
      reason: "xlarge task — cloud-offload preferred for long runs",
      cost: cloudCost,
      rejected,
    });
  }
  if (hybridOk) {
    return buildSuccess({
      strategy: "hybrid",
      bucket,
      score,
      adapter: pickAdapter(availability.liveAdapters),
      reason: "xlarge task — hybrid fallback (cloud rejected)",
      cost: hybridCost,
      rejected,
    });
  }
  if (localOk) {
    return buildSuccess({
      strategy: "local",
      bucket,
      score,
      reason: "xlarge task — all remote paths rejected; local as last resort",
      cost: localCost,
      rejected,
    });
  }

  // All rejected — return a clean failure explaining each rejection.
  return {
    ok: false,
    reason: `all strategies rejected: ${rejected.map((r) => `${r.strategy}(${r.reason})`).join("; ")}`,
  };
}

// ── Private helpers ───────────────────────────────────────────

/** Validate shape; return a typed failure early if inputs are bad. */
function validateInputs(
  inputs: MetaHarnessInputs,
  overrides: MetaHarnessOverrides,
): { readonly ok: true } | MetaHarnessFailure {
  if (!inputs || typeof inputs !== "object") {
    return { ok: false, reason: "inputs must be an object" };
  }
  if (!inputs.complexity) {
    return { ok: false, reason: "inputs.complexity required" };
  }
  if (!inputs.budget) {
    return { ok: false, reason: "inputs.budget required" };
  }
  if (inputs.budget.spentUsd < 0 || !Number.isFinite(inputs.budget.spentUsd)) {
    return { ok: false, reason: "budget.spentUsd must be a non-negative finite number" };
  }
  if (inputs.budget.capUsd < 0) {
    return { ok: false, reason: "budget.capUsd must be >= 0 (use Infinity for unlimited)" };
  }
  if (!inputs.availability) {
    return { ok: false, reason: "inputs.availability required" };
  }
  const t = overrides.complexityThresholds;
  if (t) {
    if (!(t.trivial < t.small && t.small < t.medium && t.medium < t.large)) {
      return { ok: false, reason: "overrides.complexityThresholds must be strictly ascending" };
    }
    if (t.trivial < 0 || t.large > 1) {
      return { ok: false, reason: "overrides.complexityThresholds must be within (0, 1)" };
    }
  }
  if (overrides.cloudCostPerToken !== undefined) {
    if (overrides.cloudCostPerToken < 0 || !Number.isFinite(overrides.cloudCostPerToken)) {
      return { ok: false, reason: "overrides.cloudCostPerToken must be non-negative finite" };
    }
  }
  if (overrides.hybridCloudFraction !== undefined) {
    const f = overrides.hybridCloudFraction;
    if (f < 0 || f > 1 || !Number.isFinite(f)) {
      return { ok: false, reason: "overrides.hybridCloudFraction must be within [0, 1]" };
    }
  }
  return { ok: true };
}

/**
 * Aggregate the complexity signals into a 0..1 score. Missing fields
 * contribute 0 to their weighted slot — we do NOT re-normalize so
 * callers who only provide `estimatedTokens` get a lower (safer) score.
 */
function computeComplexityScore(signals: ComplexitySignals): number {
  const t = signals.estimatedTokens ?? 0;
  const f = signals.expectedFilesTouched ?? 0;
  const p = signals.phaseCount ?? 0;
  const d = signals.expectedDurationMinutes ?? 0;

  const tokenScore = clampFraction(t / NORM_TOKENS) * SIGNAL_WEIGHTS.tokens;
  const filesScore = clampFraction(f / NORM_FILES) * SIGNAL_WEIGHTS.files;
  const phasesScore = clampFraction(p / NORM_PHASES) * SIGNAL_WEIGHTS.phases;
  const durationScore = clampFraction(d / NORM_DURATION_MIN) * SIGNAL_WEIGHTS.duration;

  return clampFraction(tokenScore + filesScore + phasesScore + durationScore);
}

function scoreToBucket(
  score: number,
  thresholds: { trivial: number; small: number; medium: number; large: number },
): TaskComplexity {
  if (score < thresholds.trivial) return "trivial";
  if (score < thresholds.small) return "small";
  if (score < thresholds.medium) return "medium";
  if (score < thresholds.large) return "large";
  return "xlarge";
}

function normalizeTokens(signals: ComplexitySignals): number {
  const t = signals.estimatedTokens;
  if (typeof t === "number" && Number.isFinite(t) && t >= 0) return t;
  // Infer from other signals when caller didn't supply tokens.
  const bucket = signals.explicitBucket ?? "medium";
  switch (bucket) {
    case "trivial":
      return 1_000;
    case "small":
      return 5_000;
    case "medium":
      return 25_000;
    case "large":
      return 90_000;
    case "xlarge":
      return 250_000;
  }
}

function computeRemainingBudget(
  budget: BudgetSnapshot,
  prefs: MetaHarnessPreferences,
): number | null {
  if (typeof prefs.maxUsdForThisTask === "number" && Number.isFinite(prefs.maxUsdForThisTask)) {
    return Math.max(0, prefs.maxUsdForThisTask);
  }
  if (!Number.isFinite(budget.capUsd)) return null; // unlimited
  return Math.max(0, budget.capUsd - budget.spentUsd);
}

function pickAdapter(liveAdapters: readonly string[]): string | undefined {
  if (liveAdapters.length === 0) return undefined;
  // First-live-wins. Caller can re-rank by passing a pre-sorted list.
  return liveAdapters[0];
}

function clampFraction(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

interface BuildSuccessArgs {
  readonly strategy: MetaHarnessStrategy;
  readonly bucket: TaskComplexity;
  readonly score: number;
  readonly adapter?: string;
  readonly reason: string;
  readonly cost: number;
  readonly rejected: readonly { strategy: MetaHarnessStrategy; reason: string }[];
}

function buildSuccess(args: BuildSuccessArgs): MetaHarnessSuccess {
  const base: {
    ok: true;
    strategy: MetaHarnessStrategy;
    complexity: TaskComplexity;
    score: number;
    reason: string;
    estimatedCostUsd: number;
    rejectedAlternatives: readonly { strategy: MetaHarnessStrategy; reason: string }[];
    suggestedAdapter?: string;
  } = {
    ok: true,
    strategy: args.strategy,
    complexity: args.bucket,
    score: args.score,
    reason: args.reason,
    estimatedCostUsd: args.cost,
    rejectedAlternatives: args.rejected,
  };
  if (args.adapter !== undefined) {
    base.suggestedAdapter = args.adapter;
  }
  return base;
}
