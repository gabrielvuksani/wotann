/**
 * Agentic browser orchestrator — V9 Tier 10 T10.1 (top-level browse loop).
 *
 * ── WHAT ────────────────────────────────────────────────────────────
 * The composition root for an agentic browse session. Takes a natural-
 * language task, asks an injected planner for a structured plan, then
 * walks each step through the four P0 security gates before handing a
 * sanitized page context back up to the caller.
 *
 *   task → plan → multi-step dispatch → security → approval → cursor-stream
 *
 * This file is PURE orchestration. Every external integration (LLM
 * planner, browser driver, approval queue, classifier, cursor overlay)
 * is supplied via `BrowseOrchestratorOptions` so the module can be
 * driven deterministically in tests and swapped without code changes.
 *
 * ── WHY A SEPARATE FILE ─────────────────────────────────────────────
 * src/browser/browser-tools.ts already exposes goto/click/type/read at
 * the LLM tool level; src/browser/chrome-bridge.ts handles the CDP
 * wire. Neither ships the higher-order "plan a task then enforce the
 * four P0 gates in order" logic. Putting that in its own module keeps
 * the tool adapters small, the orchestrator declaratively auditable,
 * and the dependency boundaries crisp.
 *
 * ── V9 REFERENCE ────────────────────────────────────────────────────
 * docs/MASTER_PLAN_V9.md line 1437 — "T10.1 — Agentic browser
 * orchestrator (600 LOC). NEW FILE: src/browser/agentic-browser.ts.
 * Top-level: task → plan → multi-tab dispatch → security → approval →
 * cursor-stream."
 *
 * ── COMPANION MODULES (read-only from this orchestrator) ────────────
 *  - src/security/prompt-injection-quarantine.ts (T10.P0.1)
 *      wrapped via `options.contentQuarantine`
 *  - src/security/hidden-text-detector.ts        (T10.P0.2)
 *      wrapped via `options.hiddenTextScan`
 *  - src/security/url-instruction-guard.ts       (T10.P0.3)
 *      wrapped via `options.urlInspector`
 *  - src/middleware/trifecta-guard.ts            (T10.P0.4)
 *      wrapped via `options.trifectaGuard.inspect`
 *
 * ── WOTANN QUALITY BARS ─────────────────────────────────────────────
 *  - QB #1 immutable value types: every public shape is readonly.
 *  - QB #6 honest failures: planner throws → session `failed`; any
 *    guard BLOCK → session `halted` with a reason string; we never
 *    silently continue past a halt.
 *  - QB #7 per-call state: this module returns pure functions + a
 *    top-level async fn that closes over injected options. No module-
 *    level mutable state.
 *  - QB #11 sibling-site scan: this is the ONLY top-level browse
 *    orchestrator. Tool-level dispatch lives in browser-tools.ts;
 *    wire protocol lives in chrome-bridge.ts. Those remain untouched.
 *  - QB #13 env guard: no `process.env` reads anywhere in this file.
 *  - QB #14 claim verification: tests in tests/browser/agentic-browser
 *    .test.ts cover all halt paths + the happy-path to closure.
 */

import { randomUUID } from "node:crypto";

// ═══ Types ════════════════════════════════════════════════════════════════

/**
 * The kind of atomic step the planner can emit. Kept narrow on purpose
 * — expanding this union is a breaking change because every step kind
 * has a security-gate policy attached to it in `runAgenticBrowse`.
 */
export type BrowsePlanStepKind = "navigate" | "click" | "type" | "read" | "extract" | "approve";

/**
 * A single step in a browse plan. `target` is a URL for `navigate` and
 * a CSS selector for `click` / `type`. `args` carries freeform extras
 * (text to type, label for extract, etc.). `rationale` is the human-
 * readable "why" that appears in approval UIs and audit logs.
 */
export interface BrowsePlanStep {
  readonly id: string;
  readonly kind: BrowsePlanStepKind;
  readonly target?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly rationale: string;
}

export interface BrowsePlan {
  readonly id: string;
  readonly task: string;
  readonly steps: readonly BrowsePlanStep[];
  readonly maxSteps: number;
  readonly createdAt: number;
}

/**
 * Lifecycle states for a browse session. Terminal states are
 * `halted`, `complete`, and `failed`; all others are intermediate.
 *
 *   planning ─ awaiting-approval ─ running ─► complete
 *                     │               │         │
 *                     └──────► halted ◄─────────┤
 *                                     └────────►│
 *                                failed ◄───────┘ (planner or driver throw)
 */
export type BrowseSessionStatus =
  | "planning"
  | "awaiting-approval"
  | "running"
  | "halted"
  | "complete"
  | "failed";

/**
 * Record of one step executed in a browse session. Retains the raw
 * verdicts as `unknown` so the orchestrator stays decoupled from the
 * exact shapes the P0 modules export — callers downcast at render
 * time using the named exports from each guard module.
 */
export interface BrowseTurnRecord {
  readonly step: BrowsePlanStep;
  readonly url?: string;
  readonly pageContentPreview?: string;
  /** From src/security/prompt-injection-quarantine.ts */
  readonly injectionVerdict?: unknown;
  /** From src/security/url-instruction-guard.ts */
  readonly urlVerdict?: unknown;
  /** From src/security/hidden-text-detector.ts */
  readonly hiddenTextReport?: unknown;
  /** From src/middleware/trifecta-guard.ts */
  readonly trifectaVerdict?: unknown;
  readonly approved?: boolean;
  readonly timestamp: number;
  readonly haltReason?: string;
  /** Error message if the step itself threw. */
  readonly error?: string;
}

export interface BrowseSession {
  readonly id: string;
  readonly plan: BrowsePlan;
  readonly history: readonly BrowseTurnRecord[];
  readonly status: BrowseSessionStatus;
  readonly failedReason?: string;
}

/**
 * Shape returned by the trifecta inspector. We intentionally accept
 * `unknown` for the upstream verdict string to keep the module
 * decoupled from src/middleware/trifecta-guard.ts internals, but the
 * relevant enum values (`ALLOW` | `REQUIRE_APPROVAL` | `BLOCK`) are
 * matched on string equality.
 */
export interface TrifectaInspectResult {
  readonly verdict: string;
  readonly approved?: boolean;
  readonly reason?: string;
}

/**
 * Opaque element shape expected by the hidden-text scanner. Callers
 * that wire this module to Playwright / CDP can satisfy the contract
 * with `HiddenTextElement` from src/security/hidden-text-detector.ts.
 */
export type BrowseElement = Readonly<Record<string, unknown>>;

/**
 * Result shape returned by the browser driver's `navigate` hook.
 * The `elements` field is fed straight into `hiddenTextScan`.
 */
export interface BrowserDriverNavigateResult {
  readonly pageText: string;
  readonly elements: readonly BrowseElement[];
  readonly finalUrl?: string;
}

export interface BrowserDriver {
  readonly navigate: (url: string) => Promise<BrowserDriverNavigateResult>;
  readonly click: (selector: string) => Promise<void>;
  readonly type: (selector: string, text: string) => Promise<void>;
  /** Optional hook — when absent, extract steps pass through read. */
  readonly extract?: (selector: string) => Promise<string>;
}

/**
 * Cursor frame the orchestrator emits on every navigate step so the
 * desktop overlay (T10.3) can animate a cursor trail. The frame is
 * minimal on purpose — position + a timestamp — because the overlay
 * maintains its own interpolation state.
 */
export interface CursorFrame {
  readonly x: number;
  readonly y: number;
  readonly ts: number;
  readonly stepId: string;
  readonly url?: string;
}

/**
 * Every external integration point lives here. Tests replace each
 * field with a stub; production wires these to the real modules.
 * Keeping the surface narrow makes mocking trivial and avoids the
 * "hidden service location" anti-pattern the V9 spec rails against.
 */
export interface BrowseOrchestratorOptions {
  readonly planner: (task: string) => Promise<BrowsePlan>;

  /** Wraps inspectUrl from src/security/url-instruction-guard.ts. */
  readonly urlInspector: (url: string) => Promise<unknown>;

  /**
   * Wraps quarantineUntrustedContent from
   * src/security/prompt-injection-quarantine.ts. The wrapper resolves
   * with whatever shape the caller decides; the orchestrator only
   * inspects `halted` / `halt_reason` keys if they are present.
   */
  readonly contentQuarantine: (content: string) => Promise<unknown>;

  /**
   * Wraps detectHiddenText from src/security/hidden-text-detector.ts.
   * Orchestrator uses `hiddenText` field (when present) to subtract
   * hidden content from the page text before quarantine.
   */
  readonly hiddenTextScan: (elements: readonly BrowseElement[]) => Promise<unknown>;

  readonly trifectaGuard: {
    readonly inspect: (ctx: unknown) => Promise<TrifectaInspectResult>;
  };

  readonly browserDriver: BrowserDriver;

  /** Invoked once per `navigate` step before execution. */
  readonly cursorEmit?: (frame: CursorFrame) => void;

  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;

  /**
   * Hard cap on steps executed. Defaults to `plan.maxSteps`. Exists as
   * a separate knob so callers can clamp below a planner's exuberance.
   */
  readonly maxStepsOverride?: number;

  /**
   * Maximum length of the page-text preview retained in each turn
   * record. Default 2048 — enough to render in a UI row, short enough
   * to keep history JSON small.
   */
  readonly pageContentPreviewMax?: number;

  /**
   * Default cursor position used when the driver doesn't expose a
   * real cursor location. Useful for tests and for drivers that only
   * ship a coordinate via a screenshot pipeline.
   */
  readonly defaultCursorXY?: { readonly x: number; readonly y: number };
}

// ═══ Internal helpers ════════════════════════════════════════════════════

const DEFAULT_PREVIEW_MAX = 2048;

/**
 * Pull `hiddenText` off the hidden-text report shape without coupling
 * to the concrete type. Reports without the field are treated as
 * "nothing hidden", not as errors — that preserves QB #6 "honest
 * failures" (don't invent a halt we can't justify).
 */
function extractHiddenText(report: unknown): string {
  if (!report || typeof report !== "object") return "";
  const maybe = (report as { hiddenText?: unknown }).hiddenText;
  return typeof maybe === "string" ? maybe : "";
}

/**
 * Remove hidden-text substrings from the page text before quarantine
 * so the classifier sees only what a human would see. Exact-string
 * subtraction; an attacker who smuggles hidden text that overlaps a
 * visible substring by coincidence still gets flagged by the
 * injection classifier downstream — this is a perception-alignment
 * pre-filter, not a second security gate.
 */
export function subtractHiddenText(pageText: string, hiddenText: string): string {
  if (hiddenText.length === 0) return pageText;
  let out = pageText;
  // Split by lines so we don't rip half-line fragments out of a paragraph.
  for (const line of hiddenText.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // Replace all occurrences. Use a split-join to avoid regex-escape
    // hassles — the hidden text may contain arbitrary characters.
    out = out.split(trimmed).join("");
  }
  return out;
}

/** Extract `verdict` off any object-shaped URL inspection report. */
export function extractUrlVerdict(report: unknown): string | null {
  if (!report || typeof report !== "object") return null;
  const maybe = (report as { verdict?: unknown }).verdict;
  return typeof maybe === "string" ? maybe : null;
}

/** Read `halted` off a quarantine result. Missing = not halted. */
export function extractQuarantineHalted(report: unknown): boolean {
  if (!report || typeof report !== "object") return false;
  return (report as { halted?: unknown }).halted === true;
}

/** Read `halt_reason` off a quarantine result. Optional. */
export function extractQuarantineHaltReason(report: unknown): string | undefined {
  if (!report || typeof report !== "object") return undefined;
  const maybe = (report as { halt_reason?: unknown }).halt_reason;
  return typeof maybe === "string" ? maybe : undefined;
}

/**
 * Build a pageContentPreview from raw text. Collapses whitespace and
 * trims to `max`. A trailing ellipsis signals the UI that more text
 * exists in the history store.
 */
function buildPageContentPreview(text: string, max: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1) + "…";
}

/**
 * Freeze a plan step into a new object with an ID assigned. Used by
 * `buildPlanFromSteps` so callers can emit steps without thinking
 * about UUID plumbing.
 */
function hydrateStep(raw: BrowsePlanStep, fallbackIdx: number): BrowsePlanStep {
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `step-${fallbackIdx}`;
  return {
    id,
    kind: raw.kind,
    ...(raw.target !== undefined ? { target: raw.target } : {}),
    ...(raw.args !== undefined ? { args: raw.args } : {}),
    rationale: raw.rationale,
  };
}

// ═══ Public helpers ══════════════════════════════════════════════════════

/**
 * Construct a plan object from a caller-supplied step list. Tests
 * and the planner both use this so ID/timestamp discipline is
 * centralized. Default `maxSteps` is `steps.length` — callers clamp
 * lower when they want to budget below the natural plan length.
 */
export function buildPlanFromSteps(
  id: string,
  task: string,
  steps: readonly BrowsePlanStep[],
  options: { readonly maxSteps?: number; readonly now?: () => number } = {},
): BrowsePlan {
  const now = options.now ?? Date.now;
  const hydrated = steps.map((s, i) => hydrateStep(s, i));
  return {
    id,
    task,
    steps: hydrated,
    maxSteps: options.maxSteps ?? hydrated.length,
    createdAt: now(),
  };
}

/**
 * One-line human-readable summary of a completed (or halted, or
 * failed) session. Used by the approval UI's history column and by
 * end-of-session audit log writers. Format is stable — tests assert
 * against exact substrings.
 */
export function summarizeSession(session: BrowseSession): string {
  const stepCount = session.history.length;
  const planSteps = session.plan.steps.length;
  const parts: string[] = [];
  parts.push(`session=${session.id}`);
  parts.push(`status=${session.status}`);
  parts.push(`steps=${stepCount}/${planSteps}`);
  if (session.status === "halted") {
    const lastHalt = [...session.history].reverse().find((t) => t.haltReason !== undefined);
    if (lastHalt?.haltReason) {
      parts.push(`halt="${lastHalt.haltReason}"`);
    }
  }
  if (session.status === "failed" && session.failedReason) {
    parts.push(`error="${session.failedReason}"`);
  }
  return parts.join(" ");
}

// ═══ Per-step handlers ═══════════════════════════════════════════════════

/**
 * Policy decision after running all gates for one step. The
 * orchestrator either records a turn and continues, or records a
 * turn-with-halt and breaks out of the loop.
 */
interface StepOutcome {
  readonly record: BrowseTurnRecord;
  readonly halted: boolean;
}

/**
 * Drive one `navigate` step through URL guard → driver → hidden-text
 * scan → quarantine. Each gate that trips short-circuits the rest.
 *
 * Why short-circuit: once a URL is BLOCKed, navigating is forbidden —
 * we have no driver result to scan, and trying to proceed would
 * collapse honest-failure semantics.
 */
async function executeNavigate(
  step: BrowsePlanStep,
  options: BrowseOrchestratorOptions,
  now: () => number,
): Promise<StepOutcome> {
  const url = step.target;
  if (typeof url !== "string" || url.length === 0) {
    return {
      record: {
        step,
        timestamp: now(),
        haltReason: "navigate-missing-url",
        error: "navigate step requires target URL",
      },
      halted: true,
    };
  }

  // Gate A — URL guard
  const urlVerdict = await options.urlInspector(url);
  const verdictString = extractUrlVerdict(urlVerdict);
  if (verdictString === "BLOCK") {
    return {
      record: {
        step,
        url,
        urlVerdict,
        timestamp: now(),
        haltReason: `url-guard:BLOCK`,
      },
      halted: true,
    };
  }

  // Emit a cursor frame for the overlay BEFORE we navigate so the UI
  // animation starts in sync with the agent's action.
  if (options.cursorEmit) {
    const xy = options.defaultCursorXY ?? { x: 0, y: 0 };
    options.cursorEmit({
      x: xy.x,
      y: xy.y,
      ts: now(),
      stepId: step.id,
      url,
    });
  }

  // Gate B — the driver actually navigates (wrapped in try/catch so a
  // flaky driver doesn't fail the session, but DOES halt this step).
  let driverResult: BrowserDriverNavigateResult;
  try {
    driverResult = await options.browserDriver.navigate(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      record: {
        step,
        url,
        urlVerdict,
        timestamp: now(),
        haltReason: `driver-error: ${message.slice(0, 200)}`,
        error: message,
      },
      halted: true,
    };
  }

  // Gate C — hidden-text scan, then strip the hidden pieces out of
  // the content we hand to the classifier.
  const hiddenTextReport = await options.hiddenTextScan(driverResult.elements);
  const hiddenText = extractHiddenText(hiddenTextReport);
  const visibleText = subtractHiddenText(driverResult.pageText, hiddenText);

  // Gate D — prompt-injection quarantine on the VISIBLE page text.
  const injectionVerdict = await options.contentQuarantine(visibleText);
  if (extractQuarantineHalted(injectionVerdict)) {
    const reason = extractQuarantineHaltReason(injectionVerdict) ?? "quarantine-halted";
    return {
      record: {
        step,
        url: driverResult.finalUrl ?? url,
        urlVerdict,
        hiddenTextReport,
        injectionVerdict,
        pageContentPreview: buildPageContentPreview(
          visibleText,
          options.pageContentPreviewMax ?? DEFAULT_PREVIEW_MAX,
        ),
        timestamp: now(),
        haltReason: `quarantine:${reason}`,
      },
      halted: true,
    };
  }

  // Gate E — trifecta on the full browse intent. Because this step is
  // driven by (possibly) freshly-fetched content, we flag
  // initiatedFromUntrustedSource=true so downstream approval UIs see
  // the correct axis attribution.
  const trifectaVerdict = await options.trifectaGuard.inspect({
    toolName: "browser.navigate",
    args: { url },
    initiatedFromUntrustedSource: true,
  });

  if (trifectaVerdict.verdict === "BLOCK") {
    return {
      record: {
        step,
        url: driverResult.finalUrl ?? url,
        urlVerdict,
        hiddenTextReport,
        injectionVerdict,
        trifectaVerdict,
        pageContentPreview: buildPageContentPreview(
          visibleText,
          options.pageContentPreviewMax ?? DEFAULT_PREVIEW_MAX,
        ),
        timestamp: now(),
        haltReason: `trifecta:BLOCK`,
      },
      halted: true,
    };
  }

  if (trifectaVerdict.verdict === "REQUIRE_APPROVAL") {
    if (trifectaVerdict.approved !== true) {
      return {
        record: {
          step,
          url: driverResult.finalUrl ?? url,
          urlVerdict,
          hiddenTextReport,
          injectionVerdict,
          trifectaVerdict,
          approved: false,
          pageContentPreview: buildPageContentPreview(
            visibleText,
            options.pageContentPreviewMax ?? DEFAULT_PREVIEW_MAX,
          ),
          timestamp: now(),
          haltReason: `trifecta:approval-denied`,
        },
        halted: true,
      };
    }
  }

  // Happy path — record the turn and continue.
  return {
    record: {
      step,
      url: driverResult.finalUrl ?? url,
      urlVerdict,
      hiddenTextReport,
      injectionVerdict,
      trifectaVerdict,
      approved: trifectaVerdict.verdict === "REQUIRE_APPROVAL" ? true : undefined,
      pageContentPreview: buildPageContentPreview(
        visibleText,
        options.pageContentPreviewMax ?? DEFAULT_PREVIEW_MAX,
      ),
      timestamp: now(),
    },
    halted: false,
  };
}

/**
 * Drive a non-navigate step. These steps do NOT run the four-gate
 * pipeline because the "untrusted input" came in during the
 * preceding navigate; gating clicks on an already-approved page adds
 * noise without improving security. Trifecta still fires because the
 * tool name changes axis activations.
 */
async function executeInteraction(
  step: BrowsePlanStep,
  options: BrowseOrchestratorOptions,
  now: () => number,
): Promise<StepOutcome> {
  const toolName =
    step.kind === "click"
      ? "browser.click"
      : step.kind === "type"
        ? "browser.type"
        : step.kind === "read"
          ? "browser.read-page"
          : step.kind === "extract"
            ? "browser.read-page"
            : "browser.approve";

  const trifectaCtx: Record<string, unknown> = {
    toolName,
    args: {
      ...(step.target !== undefined ? { selector: step.target } : {}),
      ...(step.args ?? {}),
    },
    initiatedFromUntrustedSource: true,
  };

  const trifectaVerdict = await options.trifectaGuard.inspect(trifectaCtx);
  if (trifectaVerdict.verdict === "BLOCK") {
    return {
      record: {
        step,
        trifectaVerdict,
        timestamp: now(),
        haltReason: `trifecta:BLOCK`,
      },
      halted: true,
    };
  }

  if (trifectaVerdict.verdict === "REQUIRE_APPROVAL" && trifectaVerdict.approved !== true) {
    return {
      record: {
        step,
        trifectaVerdict,
        approved: false,
        timestamp: now(),
        haltReason: `trifecta:approval-denied`,
      },
      halted: true,
    };
  }

  // Dispatch to the driver.
  try {
    if (step.kind === "click") {
      if (typeof step.target !== "string" || step.target.length === 0) {
        return {
          record: {
            step,
            trifectaVerdict,
            timestamp: now(),
            haltReason: "click-missing-selector",
            error: "click step requires target selector",
          },
          halted: true,
        };
      }
      await options.browserDriver.click(step.target);
    } else if (step.kind === "type") {
      if (typeof step.target !== "string" || step.target.length === 0) {
        return {
          record: {
            step,
            trifectaVerdict,
            timestamp: now(),
            haltReason: "type-missing-selector",
            error: "type step requires target selector",
          },
          halted: true,
        };
      }
      const textRaw = step.args?.["text"];
      const text = typeof textRaw === "string" ? textRaw : "";
      await options.browserDriver.type(step.target, text);
    } else if (step.kind === "extract" && options.browserDriver.extract) {
      if (typeof step.target !== "string" || step.target.length === 0) {
        return {
          record: {
            step,
            trifectaVerdict,
            timestamp: now(),
            haltReason: "extract-missing-selector",
            error: "extract step requires target selector",
          },
          halted: true,
        };
      }
      await options.browserDriver.extract(step.target);
    }
    // `read` and `approve` have no driver-side side-effect; the record
    // is purely audit.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      record: {
        step,
        trifectaVerdict,
        timestamp: now(),
        haltReason: `driver-error: ${message.slice(0, 200)}`,
        error: message,
      },
      halted: true,
    };
  }

  return {
    record: {
      step,
      trifectaVerdict,
      approved: trifectaVerdict.verdict === "REQUIRE_APPROVAL" ? true : undefined,
      timestamp: now(),
    },
    halted: false,
  };
}

// ═══ Main API ════════════════════════════════════════════════════════════

/**
 * Run an agentic browse session from natural-language task to terminal
 * state. Returns a `BrowseSession` describing the full run.
 *
 * Flow:
 *   1. Call `options.planner(task)` to get a `BrowsePlan`. A throw
 *      here yields a `failed` session with the thrown message.
 *   2. Apply `maxStepsOverride` if provided.
 *   3. For each step up to `maxSteps`:
 *      - `navigate` → URL guard → driver → hidden-text → quarantine
 *                      → trifecta (all axes flagged untrusted=true)
 *      - `click`/`type`/`read`/`extract`/`approve` → trifecta only;
 *        skipping the URL/content gates avoids noise on an already-
 *        approved page but keeps tool-level enforcement.
 *   4. Any `halted: true` outcome terminates the loop; the session
 *      ends with `status: "halted"`.
 *   5. Loop body throws → session ends `failed`.
 *   6. Normal exhaustion → `status: "complete"`.
 *
 * MaxSteps enforcement: when `plan.steps.length > effectiveMaxSteps`
 * we halt with reason `max-steps-exceeded` after running
 * `effectiveMaxSteps` steps — same as a BLOCK verdict for user-visible
 * purposes but attributed clearly so the UI shows "plan truncated"
 * rather than a fake security halt.
 */
export async function runAgenticBrowse(
  task: string,
  options: BrowseOrchestratorOptions,
): Promise<BrowseSession> {
  const now = options.now ?? Date.now;
  const sessionId = `browse-${randomUUID()}`;

  // Phase 1 — Planning. A throw here is terminal; we cannot run a
  // session without a plan.
  let plan: BrowsePlan;
  try {
    plan = await options.planner(task);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Synthesize an empty plan so the returned session shape stays
    // valid. Callers that want to distinguish planner-throw from
    // empty-plan can key off `status` and `failedReason`.
    const emptyPlan: BrowsePlan = {
      id: `plan-${randomUUID()}`,
      task,
      steps: [],
      maxSteps: 0,
      createdAt: now(),
    };
    return {
      id: sessionId,
      plan: emptyPlan,
      history: [],
      status: "failed",
      failedReason: `planner-error: ${message.slice(0, 200)}`,
    };
  }

  const effectiveMaxSteps =
    typeof options.maxStepsOverride === "number" && options.maxStepsOverride >= 0
      ? Math.min(plan.maxSteps, options.maxStepsOverride)
      : plan.maxSteps;

  const history: BrowseTurnRecord[] = [];
  let status: BrowseSessionStatus = "running";
  let failedReason: string | undefined;

  // Phase 2 — Execute steps.
  for (let i = 0; i < plan.steps.length; i++) {
    if (i >= effectiveMaxSteps) {
      history.push({
        step: plan.steps[i] ?? {
          id: `overflow-${i}`,
          kind: "approve",
          rationale: "max-steps sentinel",
        },
        timestamp: now(),
        haltReason: `max-steps-exceeded: ran ${i} of ${plan.steps.length} (cap=${effectiveMaxSteps})`,
      });
      status = "halted";
      break;
    }

    const step = plan.steps[i];
    if (!step) {
      // Should not happen under the loop invariant, but `noUncheckedIndexedAccess`
      // makes the access type-fallible.
      continue;
    }

    let outcome: StepOutcome;
    try {
      if (step.kind === "navigate") {
        outcome = await executeNavigate(step, options, now);
      } else {
        outcome = await executeInteraction(step, options, now);
      }
    } catch (err) {
      // Any exception escaping a step handler is a session-level
      // failure, not just a step halt. This is the one place we
      // prefer the terminal `failed` status over `halted`.
      const message = err instanceof Error ? err.message : String(err);
      history.push({
        step,
        timestamp: now(),
        error: message,
        haltReason: `uncaught: ${message.slice(0, 200)}`,
      });
      status = "failed";
      failedReason = `step-${step.id}: ${message.slice(0, 200)}`;
      break;
    }

    history.push(outcome.record);
    if (outcome.halted) {
      status = "halted";
      break;
    }
  }

  if (status === "running") {
    status = "complete";
  }

  return {
    id: sessionId,
    plan,
    history,
    status,
    ...(failedReason !== undefined ? { failedReason } : {}),
  };
}

// ═══ Convenience re-exports ══════════════════════════════════════════════

/**
 * List of step kinds — handy for tests and for UI filters that want
 * to enumerate the closed set without reaching into the type alias.
 */
export function allBrowsePlanStepKinds(): readonly BrowsePlanStepKind[] {
  return ["navigate", "click", "type", "read", "extract", "approve"];
}

/**
 * Terminal statuses — when `status` is one of these, no further
 * execution can resume. UIs use this to lock the session card.
 */
export function terminalSessionStatuses(): readonly BrowseSessionStatus[] {
  return ["halted", "complete", "failed"];
}
