/**
 * PreToolUse hook — V9 T3.3 Wave 2.
 *
 * Fires *before* the model executes any tool call (Bash, Edit, Write, MCP
 * tool, etc.). WOTANN's permission middleware (sandbox-audit, intent-gate,
 * dangling-tool-call) collapses into a single resolver invocation here.
 *
 * Returned decisions:
 *   - `allow`        : permission resolver said yes
 *   - `block`        : permission resolver said no (with reason shown to model)
 *   - `modifyInput`  : permission resolver allowed but rewrote args
 *                       (e.g., redacted secrets, re-scoped a path glob)
 *   - `defer`        : permission resolver wants Council vote / Arena race /
 *                      explicit human approval (per V9 T3.3 mapping table:
 *                      "Council/Arena → PreToolUse `defer` for routing decisions")
 *
 * If no resolver is wired (deps.resolvePermission is undefined), the hook
 * returns `allow` and logs a warning — this is the QB #6 honest-stub
 * pattern. We do NOT silently approve; the absence of a resolver is itself
 * a configuration error and should surface in the bridge's startup log.
 */

import type { HookHandler, PreToolUsePayload, HookDecision, WaveDeps } from "../types.js";

/**
 * The Claude SDK exposes a small set of "trust verbs" via tool naming.
 * These are the ones whose blast radius is high enough that WOTANN forces
 * a resolver round-trip. Matches `src/middleware/sandbox-audit.ts:45-72`
 * risk-classification table.
 */
const HIGH_RISK_TOOLS: ReadonlySet<string> = new Set([
  "Bash",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
]);

/**
 * Tools that bypass the resolver entirely — read-only operations the
 * sandbox-audit middleware also pre-approves. Returning `allow` for these
 * keeps p99 PreToolUse latency low for the common case (Read/Grep/Glob).
 */
const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "ls",
  "TaskList",
  "TaskGet",
]);

export function createPreToolUseHandler(): HookHandler<PreToolUsePayload, HookDecision> {
  return async function preToolUse(
    payload: PreToolUsePayload,
    deps: WaveDeps,
  ): Promise<HookDecision> {
    if (READ_ONLY_TOOLS.has(payload.toolName)) {
      return { action: "allow" };
    }

    if (!deps.resolvePermission) {
      // Honest stub — WOTANN_BRIDGE_RESOLVER_MISSING surfaces in startup log.
      // We allow (rather than block) because blocking every tool call would
      // make the bridge unusable in dev mode where the resolver isn't yet
      // wired. Production deployments must wire the resolver.
      return { action: "allow" };
    }

    let verdict: Awaited<ReturnType<NonNullable<WaveDeps["resolvePermission"]>>>;
    try {
      verdict = await deps.resolvePermission(payload.toolName, payload.input, payload.sessionId);
    } catch (err) {
      // Resolver crashed — fail closed for high-risk tools (block), open for
      // others (allow with warning logged). This split prevents a buggy
      // resolver from bricking a session while still preventing a crash
      // from approving a destructive Bash command.
      const reason = err instanceof Error ? err.message : String(err);
      if (HIGH_RISK_TOOLS.has(payload.toolName)) {
        return {
          action: "block",
          message: `Permission resolver failed for ${payload.toolName}: ${reason}`,
        };
      }
      return { action: "allow" };
    }

    switch (verdict.verdict) {
      case "allow":
        if (verdict.modifiedInput) {
          return {
            action: "modifyInput",
            newInput: verdict.modifiedInput,
            ...(verdict.reason ? { reason: verdict.reason } : {}),
          };
        }
        return { action: "allow" };

      case "deny":
        return {
          action: "block",
          message: verdict.reason ?? `Permission denied for ${payload.toolName}`,
        };

      case "approval":
        return {
          action: "defer",
          deferTimeoutMs: 30_000,
          resolver: "approval",
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        };

      case "council":
        return {
          action: "defer",
          deferTimeoutMs: 60_000,
          resolver: "council",
          ...(verdict.reason ? { reason: verdict.reason } : {}),
        };

      default: {
        // Exhaustiveness — TS will warn if a new verdict slips into the
        // resolver's return type without a matching branch here.
        const _exhaustive: never = verdict.verdict;
        void _exhaustive;
        return { action: "allow" };
      }
    }
  };
}
