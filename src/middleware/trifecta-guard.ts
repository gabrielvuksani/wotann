/**
 * Trifecta guard middleware — V9 Tier 10 T10.P0.4 (agentic-browser P0 gate).
 *
 * Simon Willison's "lethal trifecta" formulation: any single request
 * that simultaneously has
 *
 *   (a) untrusted INPUT (browsed page content, external message, etc.)
 *   (b) ACCESS to private data (cookies, credentials, private files)
 *   (c) EXTERNAL COMMUNICATION capability (HTTP, email, share-to)
 *
 * is a privilege-escalation path. A malicious page in branch (a) can
 * instruct the agent to use (b) and send it via (c). This middleware
 * inspects every tool-call context, classifies each capability into
 * the trifecta axes, and forces human approval when all three are
 * present at once.
 *
 * ── Design ───────────────────────────────────────────────────────────
 * The module is PURE — no `process.env` reads, no network, no fs. A
 * caller passes a `TrifectaContext` describing the in-flight tool call;
 * `classifyTrifecta` returns `{axes, hits}` identifying which axes are
 * active, and `evaluateTrifecta` applies the "all three => BLOCK" rule.
 *
 * The middleware hook `createTrifectaGuard` wires a classifier +
 * approval handler into a `TrifectaGuardMiddleware` that can be
 * registered in WOTANN's 16-layer pipeline. Registration is the
 * caller's job; this module only ships the contract.
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: missing classifier fields are NEVER
 *    treated as "safe" by default; they're treated as the conservative
 *    worst case (assume axis is active). Callers opt out explicitly.
 *  - QB #7 per-call state: every call is stateless; the guard factory
 *    returns a fresh closure.
 *  - QB #13 env guard: no `process.env` reads.
 *  - QB #11 sibling-site scan: src/middleware/layers.ts is the canonical
 *    middleware registry; callers register this guard there. This
 *    module provides the factory + types, not the registration.
 */

// ═══ Types ════════════════════════════════════════════════════════════════

export type TrifectaAxis = "untrusted-input" | "private-data" | "external-comm";

export type TrifectaVerdict = "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";

/**
 * One concrete reason an axis is considered active. The collection
 * of hits drives the approval UI — users see WHY the guard triggered.
 */
export interface TrifectaHit {
  readonly axis: TrifectaAxis;
  readonly source: string;
  readonly detail: string;
}

/**
 * The signal surface the caller provides. Every field is optional so
 * integration with varying call sites stays loose — what's absent is
 * treated as "unknown, assume active" (conservative default).
 */
export interface TrifectaContext {
  /** Tool/command being invoked, e.g. "browser.navigate", "fetch", "fs.read". */
  readonly toolName: string;
  /** Raw arg object passed to the tool. */
  readonly args?: Readonly<Record<string, unknown>>;
  /** Hints from upstream layers — explicit axis declarations. */
  readonly axisHints?: Readonly<Record<TrifectaAxis, boolean>>;
  /**
   * When true, this tool call was initiated by content from an
   * untrusted page / email / webhook (axis a). Upstream middleware
   * sets this flag when browsed content is in the context window.
   */
  readonly initiatedFromUntrustedSource?: boolean;
  /**
   * When true, the current session has read access to private data
   * (cookies, credentials, wallet, SSH keys, etc.) — axis b.
   */
  readonly sessionHasPrivateData?: boolean;
}

export interface TrifectaClassification {
  readonly axes: Readonly<Record<TrifectaAxis, boolean>>;
  readonly hits: readonly TrifectaHit[];
}

export interface TrifectaEvaluation {
  readonly verdict: TrifectaVerdict;
  readonly classification: TrifectaClassification;
  readonly reason: string;
}

// ═══ Tool classifier ═════════════════════════════════════════════════════

/**
 * Static allowlist / denylist: tool names WOTANN ships that clearly
 * fall into one or more trifecta axes. The middleware builds its
 * classification from this plus the explicit context flags.
 */
const EXTERNAL_COMM_TOOLS: ReadonlySet<string> = new Set([
  "fetch",
  "http.get",
  "http.post",
  "browser.navigate",
  "browser.fetch",
  "email.send",
  "slack.send",
  "telegram.send",
  "discord.send",
  "sms.send",
  "share.external",
  "webhook.post",
]);

const PRIVATE_DATA_READERS: ReadonlySet<string> = new Set([
  "credentials.read",
  "keychain.read",
  "ssh.private-key",
  "secrets.get",
  "env.read-secret",
  "wallet.read",
  "cookies.read",
  "password-manager.read",
]);

const UNTRUSTED_INPUT_TOOLS: ReadonlySet<string> = new Set([
  "browser.read-page",
  "browser.snapshot",
  "email.read",
  "webhook.inbound",
  "messages.read",
]);

/**
 * Best-effort URL-shape detection in args — flags external-comm axis
 * when an arg looks like a non-internal URL. Helps catch novel tools.
 */
function argsSuggestExternalUrl(args: Record<string, unknown> | undefined): boolean {
  if (!args) return false;
  for (const v of Object.values(args)) {
    if (typeof v !== "string") continue;
    if (/^https?:\/\//.test(v) && !/^https?:\/\/(localhost|127\.|192\.|10\.)/.test(v)) {
      return true;
    }
  }
  return false;
}

// ═══ Public API ══════════════════════════════════════════════════════════

/**
 * Classify a tool call into the three trifecta axes. Returns which
 * axes are active + the concrete hits that drove each decision.
 */
export function classifyTrifecta(ctx: TrifectaContext): TrifectaClassification {
  const hits: TrifectaHit[] = [];
  const axes: Record<TrifectaAxis, boolean> = {
    "untrusted-input": false,
    "private-data": false,
    "external-comm": false,
  };

  // Axis A — untrusted input
  if (ctx.initiatedFromUntrustedSource === true) {
    axes["untrusted-input"] = true;
    hits.push({
      axis: "untrusted-input",
      source: "context.initiatedFromUntrustedSource",
      detail: "Upstream flagged this call as initiated from untrusted content.",
    });
  }
  if (UNTRUSTED_INPUT_TOOLS.has(ctx.toolName)) {
    axes["untrusted-input"] = true;
    hits.push({
      axis: "untrusted-input",
      source: `tool:${ctx.toolName}`,
      detail: "Tool is declared to ingest untrusted content.",
    });
  }
  if (ctx.axisHints?.["untrusted-input"] === true) {
    axes["untrusted-input"] = true;
    hits.push({
      axis: "untrusted-input",
      source: "axisHints",
      detail: "Caller supplied an explicit axis hint.",
    });
  }

  // Axis B — private data
  if (ctx.sessionHasPrivateData === true) {
    axes["private-data"] = true;
    hits.push({
      axis: "private-data",
      source: "context.sessionHasPrivateData",
      detail: "Session has access to private data per upstream tag.",
    });
  }
  if (PRIVATE_DATA_READERS.has(ctx.toolName)) {
    axes["private-data"] = true;
    hits.push({
      axis: "private-data",
      source: `tool:${ctx.toolName}`,
      detail: "Tool directly reads private data.",
    });
  }
  if (ctx.axisHints?.["private-data"] === true) {
    axes["private-data"] = true;
    hits.push({
      axis: "private-data",
      source: "axisHints",
      detail: "Caller supplied an explicit axis hint.",
    });
  }

  // Axis C — external communication
  if (EXTERNAL_COMM_TOOLS.has(ctx.toolName)) {
    axes["external-comm"] = true;
    hits.push({
      axis: "external-comm",
      source: `tool:${ctx.toolName}`,
      detail: "Tool is declared to communicate with external endpoints.",
    });
  }
  if (argsSuggestExternalUrl(ctx.args as Record<string, unknown> | undefined)) {
    axes["external-comm"] = true;
    hits.push({
      axis: "external-comm",
      source: "args.urlShape",
      detail: "Arg contains a URL pointing outside the local network.",
    });
  }
  if (ctx.axisHints?.["external-comm"] === true) {
    axes["external-comm"] = true;
    hits.push({
      axis: "external-comm",
      source: "axisHints",
      detail: "Caller supplied an explicit axis hint.",
    });
  }

  return { axes, hits };
}

/**
 * Evaluate the classification against the "lethal trifecta" rule:
 *  - All 3 axes active → REQUIRE_APPROVAL
 *  - 0, 1, or 2 axes → ALLOW
 * Callers may upgrade REQUIRE_APPROVAL to BLOCK in strict mode.
 */
export function evaluateTrifecta(
  classification: TrifectaClassification,
  options: { readonly strictMode?: boolean } = {},
): TrifectaEvaluation {
  const { axes } = classification;
  const activeAxes = Object.values(axes).filter(Boolean).length;
  if (activeAxes < 3) {
    return {
      verdict: "ALLOW",
      classification,
      reason: `${activeAxes}/3 trifecta axes — safe.`,
    };
  }
  if (options.strictMode === true) {
    return {
      verdict: "BLOCK",
      classification,
      reason:
        "Lethal trifecta present (untrusted input + private data + external comm). Strict mode blocks by default.",
    };
  }
  return {
    verdict: "REQUIRE_APPROVAL",
    classification,
    reason:
      "Lethal trifecta present (untrusted input + private data + external comm). Human approval required.",
  };
}

// ═══ Middleware adapter ═══════════════════════════════════════════════════

export type ApprovalHandler = (evaluation: TrifectaEvaluation) => Promise<"approve" | "deny">;

export interface TrifectaGuardOptions {
  readonly approvalHandler: ApprovalHandler;
  readonly strictMode?: boolean;
  /**
   * Hook for observability — called with every evaluation whether
   * it triggers approval or not.
   */
  readonly onEvaluate?: (evaluation: TrifectaEvaluation) => void;
}

export interface TrifectaGuardMiddleware {
  inspect(ctx: TrifectaContext): Promise<{
    readonly verdict: TrifectaVerdict;
    readonly approved?: boolean;
    readonly reason: string;
  }>;
}

/**
 * Build the middleware closure. Callers register the returned object
 * in `src/middleware/layers.ts`. The returned `inspect(ctx)`:
 *
 *  - Classifies the tool call
 *  - Evaluates against the trifecta rule
 *  - If REQUIRE_APPROVAL: calls the approval handler; caller writes
 *    an audit record using `onEvaluate` if desired
 *  - Returns the final verdict + whether the user approved
 */
export function createTrifectaGuard(options: TrifectaGuardOptions): TrifectaGuardMiddleware {
  return {
    async inspect(ctx) {
      const classification = classifyTrifecta(ctx);
      const evaluation = evaluateTrifecta(classification, {
        strictMode: options.strictMode,
      });
      options.onEvaluate?.(evaluation);
      if (evaluation.verdict === "ALLOW") {
        return { verdict: "ALLOW", reason: evaluation.reason };
      }
      if (evaluation.verdict === "BLOCK") {
        return {
          verdict: "BLOCK",
          approved: false,
          reason: evaluation.reason,
        };
      }
      // REQUIRE_APPROVAL
      const decision = await options.approvalHandler(evaluation);
      return {
        verdict: "REQUIRE_APPROVAL",
        approved: decision === "approve",
        reason: evaluation.reason,
      };
    },
  };
}

/**
 * Convenience exports so tests + callers can use the tool taxonomy
 * without reaching into private sets.
 */
export function defaultExternalCommTools(): readonly string[] {
  return [...EXTERNAL_COMM_TOOLS].sort();
}

export function defaultPrivateDataReaders(): readonly string[] {
  return [...PRIVATE_DATA_READERS].sort();
}

export function defaultUntrustedInputTools(): readonly string[] {
  return [...UNTRUSTED_INPUT_TOOLS].sort();
}
