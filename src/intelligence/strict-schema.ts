/**
 * Deterministic tool-call schema enforcement — Phase 4 Sprint B2 item 18.
 *
 * OpenAI's `strict: true` mode and Anthropic's `strict` tools both
 * guarantee that the model's tool-call output conforms EXACTLY to the
 * schema — no hallucinated keys, no missing required fields, no type
 * violations. Without it, ~2-4% of benchmark tool-calls get rejected
 * downstream because the model fabricated a `reason` field that wasn't
 * in the schema, or omitted a required `path`.
 *
 * This module ships three pieces:
 *   1. makeStrict(schema) — transforms a JSON Schema into strict-safe
 *      form: `additionalProperties: false` on every object, every
 *      property listed in `required` (optional fields become union with
 *      null). Applied at tool-registration time.
 *   2. validateToolArguments(args, schema) — runtime validation. Returns
 *      {valid, errors, corrected} so callers can choose to reject the
 *      call, retry with a correction prompt, or auto-correct.
 *   3. enforceDeterministicSchema(args, schema) — convenience that runs
 *      both (strict-schema transform for the SHAPE + validation for the
 *      ARGUMENTS) and auto-corrects when possible.
 *
 * No external deps. Pure structural traversal.
 */

// ── Types ──────────────────────────────────────────────

export type JsonSchemaNode = Record<string, unknown>;

export interface ValidationError {
  /** Dot-path into the args (e.g. "options.verbose"). */
  readonly path: string;
  /** Human-readable message. */
  readonly message: string;
  /** Error category for automated correction. */
  readonly kind:
    | "missing-required"
    | "additional-property"
    | "type-mismatch"
    | "invalid-enum"
    | "shape-mismatch";
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  /**
   * Corrected args produced by dropping additional properties and
   * filling missing required fields with null. Only populated when
   * auto-correction is possible without fabricating data.
   */
  readonly corrected?: Record<string, unknown>;
}

// ── Strict transform ───────────────────────────────────

function isObjectSchema(node: JsonSchemaNode): boolean {
  return node["type"] === "object" || node["properties"] !== undefined;
}

function isArraySchema(node: JsonSchemaNode): boolean {
  return node["type"] === "array" || node["items"] !== undefined;
}

/**
 * Recursively transform a schema into OpenAI strict-mode compatible
 * form. Rules:
 *   - Every object gets additionalProperties: false
 *   - Every object's properties all appear in required
 *   - Optional fields become union [T, "null"]
 *   - anyOf/oneOf preserved (models handle these)
 *   - Arrays recurse into items
 *
 * The transform is PURE — returns a new object, leaves input untouched.
 */
export function makeStrict(schema: JsonSchemaNode): JsonSchemaNode {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;

  // Shallow clone so we never mutate caller's object
  const out: JsonSchemaNode = { ...schema };

  if (isObjectSchema(out)) {
    const props = out["properties"] as Record<string, JsonSchemaNode> | undefined;
    const existingRequired = Array.isArray(out["required"])
      ? [...(out["required"] as string[])]
      : [];

    if (props) {
      // Recurse into each property
      const newProps: Record<string, JsonSchemaNode> = {};
      const allKeys: string[] = [];
      for (const [key, child] of Object.entries(props)) {
        const transformedChild = makeStrict(child);
        // If this key wasn't required, make it nullable
        if (!existingRequired.includes(key)) {
          newProps[key] = makeOptionalNullable(transformedChild);
        } else {
          newProps[key] = transformedChild;
        }
        allKeys.push(key);
      }
      out["properties"] = newProps;
      // strict-mode requires ALL keys in required (optional kept via nullable)
      out["required"] = allKeys;
    }
    out["additionalProperties"] = false;
  }

  if (isArraySchema(out)) {
    const items = out["items"];
    if (items && typeof items === "object" && !Array.isArray(items)) {
      out["items"] = makeStrict(items as JsonSchemaNode);
    }
  }

  // anyOf / oneOf: recurse into each branch
  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = out[key];
    if (Array.isArray(branches)) {
      out[key] = branches.map((b) =>
        typeof b === "object" && b ? makeStrict(b as JsonSchemaNode) : b,
      );
    }
  }

  return out;
}

function makeOptionalNullable(node: JsonSchemaNode): JsonSchemaNode {
  if (!node || typeof node !== "object") return node;
  const type = node["type"];
  if (!type) {
    // No explicit type — leave as-is (likely a union via anyOf)
    return node;
  }
  if (Array.isArray(type)) {
    return type.includes("null") ? node : { ...node, type: [...type, "null"] };
  }
  if (typeof type === "string") {
    return type === "null" ? node : { ...node, type: [type, "null"] };
  }
  return node;
}

// ── Runtime validation ────────────────────────────────

function typeMatches(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

function validateNode(
  value: unknown,
  schema: JsonSchemaNode,
  path: string,
  errors: ValidationError[],
): void {
  if (!schema || typeof schema !== "object") return;

  // anyOf/oneOf: at least one must validate
  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf)) {
    for (const branch of anyOf) {
      const branchErrors: ValidationError[] = [];
      validateNode(value, branch as JsonSchemaNode, path, branchErrors);
      if (branchErrors.length === 0) return;
    }
    errors.push({
      path,
      message: `value did not match any variant of anyOf`,
      kind: "shape-mismatch",
    });
    return;
  }

  // Type check
  const type = schema["type"];
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    const ok = types.some((t) => typeMatches(value, String(t)));
    if (!ok) {
      errors.push({
        path,
        message: `expected ${types.join("|")}, got ${describe(value)}`,
        kind: "type-mismatch",
      });
      return;
    }
  }

  // Enum check
  const enums = schema["enum"];
  if (Array.isArray(enums) && !enums.includes(value)) {
    errors.push({
      path,
      message: `expected one of [${enums.map((e) => JSON.stringify(e)).join(", ")}], got ${JSON.stringify(value)}`,
      kind: "invalid-enum",
    });
    return;
  }

  // Object: check required + additional properties + recurse
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const required = Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [];
    const props = (schema["properties"] ?? {}) as Record<string, JsonSchemaNode>;
    const addlProp = schema["additionalProperties"];

    for (const req of required) {
      if (!(req in value)) {
        errors.push({
          path: path ? `${path}.${req}` : req,
          message: `required property is missing`,
          kind: "missing-required",
        });
      }
    }

    const seenKeys = new Set<string>();
    for (const [key, val] of Object.entries(value)) {
      seenKeys.add(key);
      const subSchema = props[key];
      if (subSchema) {
        validateNode(val, subSchema, path ? `${path}.${key}` : key, errors);
      } else if (addlProp === false) {
        errors.push({
          path: path ? `${path}.${key}` : key,
          message: `additional property not allowed`,
          kind: "additional-property",
        });
      }
    }
  }

  // Array: recurse into items
  if (Array.isArray(value)) {
    const items = schema["items"];
    if (items && typeof items === "object" && !Array.isArray(items)) {
      for (let i = 0; i < value.length; i++) {
        validateNode(value[i], items as JsonSchemaNode, `${path}[${i}]`, errors);
      }
    }
  }
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Validate tool arguments against a schema. Returns a detailed error
 * report. Optionally produces a `corrected` args object that:
 *   - Drops additional properties (strict-mode violation)
 *   - Fills missing required fields with null (if the schema type
 *     allows null — otherwise left missing so caller must retry)
 */
export function validateToolArguments(args: unknown, schema: JsonSchemaNode): ValidationResult {
  const errors: ValidationError[] = [];
  validateNode(args, schema, "", errors);
  const valid = errors.length === 0;

  if (valid || !args || typeof args !== "object" || Array.isArray(args)) {
    return { valid, errors };
  }

  // Best-effort correction: drop extra keys, fill nullable missing fields
  const corrected = tryCorrect(args as Record<string, unknown>, schema, errors);
  return { valid, errors, corrected };
}

function tryCorrect(
  args: Record<string, unknown>,
  schema: JsonSchemaNode,
  errors: readonly ValidationError[],
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...args };
  let changed = false;

  // Drop additional-property errors
  for (const e of errors) {
    if (e.kind === "additional-property") {
      const key = e.path.split(".").pop() ?? e.path;
      if (key in out) {
        delete out[key];
        changed = true;
      }
    }
  }

  // Fill missing-required fields with null IF nullable
  const props = (schema["properties"] ?? {}) as Record<string, JsonSchemaNode>;
  for (const e of errors) {
    if (e.kind === "missing-required") {
      const key = e.path.split(".").pop() ?? e.path;
      const subSchema = props[key];
      if (subSchema && allowsNull(subSchema)) {
        out[key] = null;
        changed = true;
      }
    }
  }

  return changed ? out : undefined;
}

function allowsNull(schema: JsonSchemaNode): boolean {
  const type = schema["type"];
  if (Array.isArray(type)) return type.includes("null");
  if (type === "null") return true;
  return false;
}

// ── Combined enforcement ──────────────────────────────

export interface EnforcementResult {
  readonly strictSchema: JsonSchemaNode;
  readonly validation: ValidationResult;
  /** args to pass forward — corrected when possible, original when valid. */
  readonly finalArgs: Record<string, unknown> | null;
}

/**
 * Full pipeline: make schema strict + validate args + auto-correct.
 * Returns `finalArgs: null` when the call is unrecoverable (missing
 * required non-nullable field).
 */
export function enforceDeterministicSchema(
  args: unknown,
  schema: JsonSchemaNode,
): EnforcementResult {
  const strictSchema = makeStrict(schema);
  const validation = validateToolArguments(args, strictSchema);
  let finalArgs: Record<string, unknown> | null = null;

  if (validation.valid && args && typeof args === "object" && !Array.isArray(args)) {
    finalArgs = args as Record<string, unknown>;
  } else if (validation.corrected) {
    const recheck = validateToolArguments(validation.corrected, strictSchema);
    finalArgs = recheck.valid ? validation.corrected : null;
  }

  return { strictSchema, validation, finalArgs };
}
