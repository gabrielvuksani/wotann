/**
 * GuardrailProviderMiddleware — pluggable pre-tool-call authorization.
 *
 * Ported from deer-flow (bytedance/deer-flow) Lane 2:
 *   packages/harness/deerflow/guardrails/{provider,middleware,builtin}.py
 *
 * Unlike the existing `guardrailMiddleware` in `layers.ts` (which is a
 * keyword heuristic on the USER message), this middleware evaluates each
 * TOOL CALL against a pluggable `GuardrailProvider` protocol. Providers
 * implement `evaluate(request) -> decision` with allow / deny + reasons.
 *
 * Built-in provider: `AllowlistProvider` (zero deps). External providers
 * can be supplied by the integrator (e.g., OAP policy evaluators).
 *
 * Fail-closed semantics: when a provider throws, the default behaviour is
 * to deny the tool call. Callers can opt in to fail-open by constructing
 * the middleware with `{ failClosed: false }`.
 *
 * Immutability: the middleware holds a readonly reference to the provider
 * and produces new messages rather than mutating context.
 */

import type { Middleware, MiddlewareContext } from "./types.js";
import type { AgentMessage } from "../core/types.js";

// -- Protocol + Types ------------------------------------------------------

export interface GuardrailRequest {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly toolCallId: string;
  readonly agentId?: string;
  readonly threadId?: string;
  readonly timestamp: string;
}

export interface GuardrailReason {
  readonly code: string;
  readonly message: string;
}

export interface GuardrailDecision {
  readonly allow: boolean;
  readonly reasons: readonly GuardrailReason[];
  readonly policyId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Contract for pluggable tool-call authorization. Implementations are passed
 * into the middleware constructor. A stub provider that always allows is
 * provided as the default so callers can opt in to real enforcement
 * incrementally.
 */
export interface GuardrailProvider {
  readonly name: string;
  evaluate(request: GuardrailRequest): Promise<GuardrailDecision> | GuardrailDecision;
}

// -- Built-in allowlist provider ------------------------------------------

export interface AllowlistOptions {
  readonly allowedTools?: readonly string[];
  readonly deniedTools?: readonly string[];
}

/**
 * AllowlistProvider — allow / deny tools by name only. Zero external deps.
 *
 * Semantics: when `allowedTools` is provided, only those tool names are
 * permitted. `deniedTools` always wins over `allowedTools` (a tool named
 * in both lists is denied).
 */
export class AllowlistProvider implements GuardrailProvider {
  readonly name = "allowlist";
  private readonly allowed: ReadonlySet<string> | null;
  private readonly denied: ReadonlySet<string>;

  constructor(options: AllowlistOptions = {}) {
    this.allowed = options.allowedTools ? new Set(options.allowedTools) : null;
    this.denied = new Set(options.deniedTools ?? []);
  }

  evaluate(request: GuardrailRequest): GuardrailDecision {
    if (this.denied.has(request.toolName)) {
      return {
        allow: false,
        reasons: [
          {
            code: "oap.tool_not_allowed",
            message: `tool '${request.toolName}' is denied`,
          },
        ],
        policyId: "allowlist",
      };
    }
    if (this.allowed !== null && !this.allowed.has(request.toolName)) {
      return {
        allow: false,
        reasons: [
          {
            code: "oap.tool_not_allowed",
            message: `tool '${request.toolName}' not in allowlist`,
          },
        ],
        policyId: "allowlist",
      };
    }
    return {
      allow: true,
      reasons: [{ code: "oap.allowed", message: "" }],
      policyId: "allowlist",
    };
  }
}

// -- Middleware instance --------------------------------------------------

export interface GuardrailMiddlewareOptions {
  /** When a provider throws, deny by default (true) or allow (false). */
  readonly failClosed?: boolean;
  /** Optional signed token passed through to the provider as `agentId`. */
  readonly passport?: string;
}

export interface GuardrailStats {
  readonly totalEvaluations: number;
  readonly totalDenied: number;
  readonly totalProviderErrors: number;
}

/**
 * GuardrailProviderMiddleware evaluates the most recent tool-use messages
 * in the conversation history against a pluggable provider. Denied calls
 * are rewritten by appending a synthetic `tool` role message — the agent
 * sees the denial on the next turn and can adapt.
 *
 * Per-session state (stats) lives on the instance so callers can construct
 * a fresh middleware per session when required — no module-global mutable
 * state.
 */
export class GuardrailProviderMiddleware {
  private readonly provider: GuardrailProvider;
  private readonly failClosed: boolean;
  private readonly passport: string | undefined;
  private totalEvaluations = 0;
  private totalDenied = 0;
  private totalProviderErrors = 0;

  constructor(provider: GuardrailProvider, options: GuardrailMiddlewareOptions = {}) {
    this.provider = provider;
    this.failClosed = options.failClosed ?? true;
    this.passport = options.passport;
  }

  /**
   * Evaluate a single tool-use entry. Returns the decision and whether
   * a provider error occurred (so the caller can distinguish a deny from
   * an error-triggered deny in fail-closed mode).
   */
  async evaluateToolCall(
    toolName: string,
    toolInput: Readonly<Record<string, unknown>>,
    toolCallId: string,
    extras: { readonly threadId?: string } = {},
  ): Promise<{ readonly decision: GuardrailDecision; readonly hadError: boolean }> {
    this.totalEvaluations++;
    const request: GuardrailRequest = {
      toolName,
      toolInput,
      toolCallId,
      agentId: this.passport,
      threadId: extras.threadId,
      timestamp: new Date().toISOString(),
    };

    try {
      const decision = await this.provider.evaluate(request);
      if (!decision.allow) this.totalDenied++;
      return { decision, hadError: false };
    } catch (err) {
      this.totalProviderErrors++;
      if (this.failClosed) {
        this.totalDenied++;
        return {
          decision: {
            allow: false,
            reasons: [
              {
                code: "oap.evaluator_error",
                message: `guardrail provider error (fail-closed): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              },
            ],
            policyId: this.provider.name,
          },
          hadError: true,
        };
      }
      return {
        decision: {
          allow: true,
          reasons: [{ code: "oap.evaluator_error_allowed", message: "" }],
          policyId: this.provider.name,
        },
        hadError: true,
      };
    }
  }

  /**
   * Build a synthetic `tool` message describing the denial so the agent
   * sees the error on its next turn.
   */
  buildDeniedMessage(
    toolName: string,
    toolCallId: string,
    decision: GuardrailDecision,
  ): AgentMessage {
    const primary = decision.reasons[0];
    const code = primary?.code ?? "oap.denied";
    const reason = primary?.message ?? "blocked by guardrail policy";
    return {
      role: "tool",
      content: `Guardrail denied: tool '${toolName}' was blocked (${code}). Reason: ${reason}. Choose an alternative approach.`,
      toolCallId,
      toolName,
    };
  }

  getStats(): GuardrailStats {
    return {
      totalEvaluations: this.totalEvaluations,
      totalDenied: this.totalDenied,
      totalProviderErrors: this.totalProviderErrors,
    };
  }

  reset(): void {
    this.totalEvaluations = 0;
    this.totalDenied = 0;
    this.totalProviderErrors = 0;
  }
}

// -- Pipeline adapter -----------------------------------------------------

/**
 * Create a Middleware adapter for the guardrail provider. Scans the last
 * assistant tool_use messages without a paired tool_result and evaluates
 * each against the provider. Denied calls append a synthetic `tool`
 * result so the agent can see and adapt on the next turn.
 */
export function createGuardrailProviderMiddleware(
  instance: GuardrailProviderMiddleware,
): Middleware {
  return {
    name: "GuardrailProvider",
    order: 5.5,
    async before(ctx: MiddlewareContext): Promise<MiddlewareContext> {
      const history = ctx.recentHistory;
      if (history.length === 0) return ctx;

      const existingResults = new Set<string>();
      for (const msg of history) {
        if (msg.role === "tool" && msg.toolCallId) {
          existingResults.add(msg.toolCallId);
        }
      }

      const pending: AgentMessage[] = [];
      for (const msg of history) {
        if (
          msg.role === "assistant" &&
          msg.toolCallId &&
          msg.toolName &&
          !existingResults.has(msg.toolCallId)
        ) {
          pending.push(msg);
        }
      }

      if (pending.length === 0) return ctx;

      const injections: AgentMessage[] = [];
      for (const msg of pending) {
        const { decision } = await instance.evaluateToolCall(
          msg.toolName ?? "unknown",
          {},
          msg.toolCallId ?? "missing_id",
          { threadId: ctx.sessionId },
        );
        if (!decision.allow) {
          injections.push(
            instance.buildDeniedMessage(
              msg.toolName ?? "unknown",
              msg.toolCallId ?? "missing_id",
              decision,
            ),
          );
        }
      }

      if (injections.length === 0) return ctx;

      return {
        ...ctx,
        recentHistory: [...history, ...injections],
      };
    },
  };
}
