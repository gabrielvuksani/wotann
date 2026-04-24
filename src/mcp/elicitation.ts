/**
 * MCP Elicitation protocol helpers — V9 Tier 14.1.
 *
 * MCP specifies a server-to-client request that lets a server ask
 * the USER (via the MCP client) for structured input mid-session.
 * Example: a "deploy" tool needs to know which environment to
 * target, so it emits an elicitation request and waits for the
 * client to collect the answer through its own UI.
 *
 * This module ships the headless protocol layer — request/result
 * shapes + serializer/deserializer + a pure handler-registry. The
 * MCP server (`src/mcp/mcp-server.ts`) consumes these types; hook
 * wiring that exposes elicitation to the WOTANN runtime belongs
 * in a separate follow-up (`src/hooks/engine.ts` modifications),
 * not here.
 *
 * ── Wire format (per MCP spec) ───────────────────────────────────────
 * Request (server → client):
 *   {
 *     "method": "elicitation/create",
 *     "params": {
 *       "message": "human-readable prompt",
 *       "requestedSchema": { ...JSONSchema describing the expected response }
 *     }
 *   }
 *
 * Response (client → server):
 *   { "action": "accept" | "decline" | "cancel", "content"?: Record<string, unknown> }
 *
 * ── WOTANN quality bars ──────────────────────────────────────────────
 *  - QB #6 honest failures: parsers return `null` on malformed input.
 *    `handle(request)` returns `{ok: false, reason}` when a handler
 *    can't serve a given request.
 *  - QB #7 per-call state: `createElicitationRegistry()` returns an
 *    isolated registry; multiple callers coexist without cross-talk.
 *  - QB #13 env guard: no `process.env` reads.
 *  - QB #11 sibling-site scan: `mcp-server.ts` owns the JSON-RPC
 *    wire; this module is a consumer contract.
 */

// ═══ Spec types ═══════════════════════════════════════════════════════════

/**
 * JSON-Schema subset MCP elicitation uses. The spec allows the full
 * JSONSchema vocabulary but typical servers use a tight subset, so
 * we accept `unknown` for the schema body and expose a helper to
 * check basic shape.
 */
export interface ElicitationSchema {
  readonly type?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly [key: string]: unknown;
}

export interface ElicitationRequest {
  readonly method: "elicitation/create";
  readonly params: {
    readonly message: string;
    readonly requestedSchema: ElicitationSchema;
  };
}

export type ElicitationAction = "accept" | "decline" | "cancel";

export interface ElicitationResult {
  readonly action: ElicitationAction;
  /**
   * Present only when `action === "accept"`. Shape matches the
   * requestedSchema. Absent on decline/cancel.
   */
  readonly content?: Readonly<Record<string, unknown>>;
}

// ═══ Builders ═════════════════════════════════════════════════════════════

/**
 * Build a well-formed ElicitationRequest. Throws on invalid input —
 * this is a programmer-error surface, not an end-user one.
 */
export function buildElicitationRequest(args: {
  readonly message: string;
  readonly requestedSchema: ElicitationSchema;
}): ElicitationRequest {
  if (typeof args.message !== "string" || args.message.trim().length === 0) {
    throw new Error("buildElicitationRequest: message is required");
  }
  if (typeof args.requestedSchema !== "object" || args.requestedSchema === null) {
    throw new Error("buildElicitationRequest: requestedSchema must be an object");
  }
  return {
    method: "elicitation/create",
    params: {
      message: args.message,
      requestedSchema: args.requestedSchema,
    },
  };
}

export function buildAcceptResult(content: Readonly<Record<string, unknown>>): ElicitationResult {
  return { action: "accept", content };
}

export function buildDeclineResult(): ElicitationResult {
  return { action: "decline" };
}

export function buildCancelResult(): ElicitationResult {
  return { action: "cancel" };
}

// ═══ Parsers ══════════════════════════════════════════════════════════════

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse an unknown JSON-RPC payload into an ElicitationRequest.
 * Returns `null` when the shape doesn't match — callers fall back
 * to their "unknown method" handler.
 */
export function parseElicitationRequest(raw: unknown): ElicitationRequest | null {
  if (!isPlainObject(raw)) return null;
  if (raw["method"] !== "elicitation/create") return null;
  const params = raw["params"];
  if (!isPlainObject(params)) return null;
  const message = params["message"];
  const schema = params["requestedSchema"];
  if (typeof message !== "string" || message.length === 0) return null;
  if (!isPlainObject(schema)) return null;
  return {
    method: "elicitation/create",
    params: {
      message,
      requestedSchema: schema as ElicitationSchema,
    },
  };
}

/**
 * Parse an unknown JSON-RPC response into an ElicitationResult.
 * Returns `null` on malformed input.
 */
export function parseElicitationResult(raw: unknown): ElicitationResult | null {
  if (!isPlainObject(raw)) return null;
  const action = raw["action"];
  if (action !== "accept" && action !== "decline" && action !== "cancel") return null;
  if (action === "accept") {
    const content = raw["content"];
    if (content !== undefined && !isPlainObject(content)) return null;
    return content !== undefined
      ? { action, content: content as Record<string, unknown> }
      : { action };
  }
  return { action };
}

// ═══ Schema validation ════════════════════════════════════════════════════

/**
 * Lightweight check: does `content` satisfy the `required` list and
 * at least every `type`-tagged property match the expected primitive
 * type. Not a full JSONSchema validator — consumers that need more
 * should plug in ajv or similar.
 *
 * Returns `{ok: true}` when content is compatible, `{ok: false, errors}`
 * otherwise. Empty errors[] can never land on ok=false (invariant).
 */
export interface SchemaValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export function validateContentAgainstSchema(
  schema: ElicitationSchema,
  content: Readonly<Record<string, unknown>>,
): SchemaValidationResult {
  const errors: string[] = [];

  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!(key in content)) {
        errors.push(`missing required property "${key}"`);
      }
    }
  }

  if (isPlainObject(schema.properties)) {
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (!(key in content)) continue;
      if (!isPlainObject(propSchema)) continue;
      const expectedType = (propSchema as { type?: string }).type;
      if (typeof expectedType !== "string") continue;
      const actualValue = content[key];
      if (!matchesType(actualValue, expectedType)) {
        errors.push(`property "${key}" expected ${expectedType}, got ${typeof actualValue}`);
      }
    }
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

// ═══ Registry ═════════════════════════════════════════════════════════════

/**
 * Handler signature. Given a request, return a result (possibly
 * async). The caller owns the UI — how the user is asked is up to
 * the handler. Throwing a handler surfaces as a cancel with the
 * thrown message as a decline reason.
 */
export type ElicitationHandler = (request: ElicitationRequest) => Promise<ElicitationResult>;

export interface ElicitationRegistry {
  register: (handler: ElicitationHandler) => () => void;
  handle: (
    request: ElicitationRequest,
  ) => Promise<
    | { ok: true; result: ElicitationResult }
    | { ok: false; reason: "no-handler" | "handler-threw"; error?: string }
  >;
  count: () => number;
}

/**
 * Create a per-caller registry. Multiple registries coexist without
 * cross-talk. Tests create a fresh registry per suite.
 */
export function createElicitationRegistry(): ElicitationRegistry {
  let handler: ElicitationHandler | null = null;

  const register: ElicitationRegistry["register"] = (fn) => {
    handler = fn;
    return () => {
      if (handler === fn) handler = null;
    };
  };

  const handle: ElicitationRegistry["handle"] = async (request) => {
    if (handler === null) {
      return { ok: false, reason: "no-handler" };
    }
    try {
      const result = await handler(request);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        reason: "handler-threw",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  const count: ElicitationRegistry["count"] = () => (handler === null ? 0 : 1);

  return { register, handle, count };
}
