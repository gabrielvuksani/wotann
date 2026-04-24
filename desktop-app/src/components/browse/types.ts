/**
 * BrowseTab — shared types (V9 Tier 10 T10.3).
 *
 * ── WHAT ────────────────────────────────────────────────────────────
 * View-model shapes the `BrowseTab` React component consumes. These
 * are intentionally NOT the same objects the T10.1 orchestrator
 * (src/browser/agentic-browser.ts) emits — they are a deliberately
 * narrowed, UI-friendly projection.
 *
 * ── WHY A SEPARATE BOUNDARY ─────────────────────────────────────────
 * The desktop-app is its own TypeScript package (tsconfig.app.json
 * scopes `include: ["src"]` and forbids reaching into the parent
 * monorepo's src/ tree). If this component imported
 * `../../../src/browser/agentic-browser` directly, the build would
 * either (a) pull the entire orchestrator + node:crypto into the
 * renderer bundle, or (b) fail to resolve under bundler module
 * resolution. Keeping the boundary tight here means:
 *
 *   1. The view depends on shapes, not on the security-gate impl.
 *   2. The caller (a yet-to-be-built IPC adapter) does the actual
 *      mapping from `BrowseSession` → `BrowseSessionView`.
 *   3. Tests exercise the view layer without dragging Node APIs.
 *
 * ── QUALITY BARS ────────────────────────────────────────────────────
 *  - QB #1 immutable value types: every field is `readonly`.
 *  - QB #6 honest failures: status union includes `halted` and
 *    `failed` as first-class terminal states so the UI can render
 *    them distinctly instead of collapsing both into "done".
 *  - QB #11 sibling-site scan: this file is the ONLY place where
 *    desktop-app maps browser-orchestrator shapes into view-models.
 *    Any future component that needs these views must import from
 *    here, not re-declare its own near-duplicate.
 *
 * ── V9 REFERENCE ────────────────────────────────────────────────────
 * docs/MASTER_PLAN_V9.md line 1449-1456.
 */

/**
 * The kind of atomic step the planner can emit. Mirrors
 * `BrowsePlanStepKind` in src/browser/agentic-browser.ts line 66,
 * duplicated here so desktop-app does not reach across the package
 * boundary for a type. Expanding this union is a breaking change
 * because `stepIcon` enumerates every case.
 */
export type BrowsePlanStepKindView =
  | "navigate"
  | "click"
  | "type"
  | "read"
  | "extract"
  | "approve";

/**
 * View projection of a single plan step. Drops `args` because the UI
 * only ever needs a target and a rationale — rendering raw tool args
 * in a sidebar leaks implementation details and is an attack surface
 * for homoglyph-style spoofs.
 */
export interface BrowsePlanStepView {
  readonly id: string;
  readonly kind: BrowsePlanStepKindView;
  /** URL for `navigate`, CSS selector for `click`/`type`/`extract`. */
  readonly target?: string;
  /** Human-readable "why" — shown in the plan list. */
  readonly rationale: string;
}

/**
 * View projection of one executed step. The orchestrator's
 * `BrowseTurnRecord` carries security verdicts as `unknown`; we
 * deliberately don't expose those to the renderer because the UI
 * should never inspect raw verdict payloads — it only reads the
 * halt reason string produced by the orchestrator.
 */
export interface BrowseTurnView {
  readonly stepId: string;
  readonly url?: string;
  readonly timestamp: number;
  /**
   * Populated when a step was halted by any of the P0 gates. The
   * prefix is stable (`"url-guard:"`, `"quarantine:"`, `"trifecta:"`,
   * `"driver-error:"`, `"max-steps-exceeded"`) so the UI can group
   * halt reasons by category without parsing free text.
   */
  readonly haltReason?: string;
  /** True once a REQUIRE_APPROVAL step has been approved by the user. */
  readonly approved?: boolean;
}

/**
 * Lifecycle states for a browse session. Mirrors
 * `BrowseSessionStatus` in src/browser/agentic-browser.ts line 100.
 * `isSessionActive` maps these to an active/inactive boolean.
 */
export type BrowseSessionStatusView =
  | "planning"
  | "awaiting-approval"
  | "running"
  | "halted"
  | "complete"
  | "failed";

/**
 * View of a single DOM element highlighted on the live screenshot
 * overlay. `interactive` drives the highlight color (interactive
 * elements are boxed brighter). `label` is the accessible name or a
 * short textual hint the agent will type/click against.
 */
export interface DomElementView {
  readonly id: string;
  readonly selector: string;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly interactive: boolean;
  readonly label?: string;
}

/**
 * View projection of the full browse session. The caller (IPC
 * adapter, not shipped in this task) maps a `BrowseSession` from
 * src/browser/agentic-browser.ts into this shape, substituting any
 * verdict payloads with the derived `haltReason` strings above.
 *
 * `latestScreenshot` is a data URL or empty string. We intentionally
 * do NOT expose a raw blob — the renderer never needs to decode a
 * screenshot, and a data URL is the simplest thing the browser can
 * put into an <img src>.
 */
export interface BrowseSessionView {
  readonly id: string;
  readonly task: string;
  readonly status: BrowseSessionStatusView;
  readonly steps: readonly BrowsePlanStepView[];
  readonly history: readonly BrowseTurnView[];
  readonly latestScreenshot?: string;
  readonly domElements: readonly DomElementView[];
}

/**
 * Pending approval awaiting a user decision. The orchestrator never
 * auto-approves — every REQUIRE_APPROVAL verdict becomes one of
 * these and lives in the queue until the user clicks Approve or
 * Deny. `kind` drives the label shown above the description.
 *
 * IMPORTANT — the approval UI for these items MUST be rendered inside
 * the WOTANN desktop shell (Tauri), not inside the browser window.
 * See the `BrowseTab` JSDoc for why this matters.
 */
export interface PendingApproval {
  readonly id: string;
  readonly kind: "navigation" | "tool-call" | "trifecta";
  readonly description: string;
  readonly risk: "low" | "medium" | "high";
}
