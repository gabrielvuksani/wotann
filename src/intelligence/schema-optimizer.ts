/**
 * Schema Optimizer — flatten and simplify tool schemas for better model accuracy.
 *
 * FROM TERMINALBENCH RESEARCH (ForgeCode, rank #1 at 81.8%):
 * "Reordered JSON schema fields (placing `required` before `properties`)
 *  to reduce tool-call errors; flattened nested schemas to eliminate
 *  confusing multiple `required` arrays."
 *
 * Models make fewer tool-call errors when schemas are:
 * 1. FLAT — no nested objects with their own required fields
 * 2. ORDERED — required fields listed before optional ones
 * 3. DESCRIBED — every field has a clear description
 * 4. TYPED — explicit types, no ambiguous unions
 *
 * This optimizer rewrites tool schemas at registration time,
 * BEFORE the model ever sees them. The original schema is preserved
 * for validation; the optimized schema is what the model reads.
 */

export interface ToolSchemaField {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
  readonly default?: unknown;
}

/**
 * Flatten a JSON Schema by hoisting nested object properties to the top level
 * with dot-notation names. This eliminates nested `required` arrays that
 * confuse models.
 *
 * Example:
 *   { file_path: string, options: { encoding: string, limit: number } }
 *   becomes:
 *   { file_path: string, options_encoding: string, options_limit: number }
 */
export function flattenSchema(
  schema: Record<string, unknown>,
  prefix: string = "",
): readonly ToolSchemaField[] {
  const fields: ToolSchemaField[] = [];
  const properties = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema["required"] ?? []) as string[]);

  for (const [name, prop] of Object.entries(properties)) {
    const fullName = prefix ? `${prefix}_${name}` : name;
    const type = String(prop["type"] ?? "string");

    if (type === "object" && prop["properties"]) {
      // Recurse into nested objects — flatten them
      const nested = flattenSchema(prop as Record<string, unknown>, fullName);
      fields.push(...nested);
    } else {
      fields.push({
        name: fullName,
        type,
        description: String(prop["description"] ?? ""),
        required: required.has(name),
        default: prop["default"],
      });
    }
  }

  return fields;
}

/**
 * Rebuild a flat JSON Schema from flattened fields.
 * Places required fields first (models read top-to-bottom).
 */
export function rebuildSchema(fields: readonly ToolSchemaField[]): Record<string, unknown> {
  // Sort: required first, then alphabetical
  const sorted = [...fields].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const properties: Record<string, Record<string, unknown>> = {};
  const requiredList: string[] = [];

  for (const field of sorted) {
    const prop: Record<string, unknown> = { type: field.type };
    if (field.description) prop["description"] = field.description;
    if (field.default !== undefined) prop["default"] = field.default;
    properties[field.name] = prop;
    if (field.required) requiredList.push(field.name);
  }

  return {
    type: "object",
    required: requiredList,
    properties,
  };
}

/**
 * Full optimization pipeline: flatten → sort → rebuild.
 * Call this on every tool schema before passing to the model.
 */
export function optimizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const fields = flattenSchema(schema);
  return rebuildSchema(fields);
}

/**
 * Add missing descriptions to schema fields by inferring from field names.
 * Models perform better when every field has a description.
 */
export function addMissingDescriptions(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = { ...((schema["properties"] ?? {}) as Record<string, Record<string, unknown>>) };

  for (const [name, prop] of Object.entries(properties)) {
    if (!prop["description"]) {
      properties[name] = {
        ...prop,
        description: inferDescription(name),
      };
    }
  }

  return { ...schema, properties };
}

function inferDescription(fieldName: string): string {
  const nameMap: Record<string, string> = {
    file_path: "Absolute path to the file",
    content: "The content to write or replace with",
    command: "Shell command to execute",
    old_string: "The exact text to find and replace",
    new_string: "The replacement text",
    pattern: "Search pattern (regex supported)",
    path: "Directory or file path to search in",
    query: "Search query string",
    url: "URL to fetch or navigate to",
    description: "Human-readable description of the action",
    timeout: "Maximum time to wait in milliseconds",
  };

  return nameMap[fieldName] ?? fieldName.replace(/_/g, " ");
}

/**
 * Validate a tool call's arguments against the original schema.
 * Returns corrected arguments with type coercions applied.
 */
export function validateAndCoerce(
  args: Record<string, unknown>,
  schema: Record<string, unknown>,
): { valid: boolean; corrected: Record<string, unknown>; errors: readonly string[] } {
  const properties = (schema["properties"] ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set((schema["required"] ?? []) as string[]);
  const corrected = { ...args };
  const errors: string[] = [];

  // Check required fields
  for (const name of required) {
    if (corrected[name] === undefined || corrected[name] === null) {
      errors.push(`Missing required field: ${name}`);
    }
  }

  // Type coercion
  for (const [name, value] of Object.entries(corrected)) {
    const prop = properties[name];
    if (!prop) continue;

    const expectedType = String(prop["type"] ?? "string");

    if (expectedType === "string" && typeof value !== "string") {
      corrected[name] = String(value);
    } else if (expectedType === "number" && typeof value === "string") {
      const parsed = Number(value);
      if (!isNaN(parsed)) corrected[name] = parsed;
    } else if (expectedType === "boolean" && typeof value === "string") {
      corrected[name] = value === "true" || value === "1";
    } else if (expectedType === "integer" && typeof value === "string") {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) corrected[name] = parsed;
    }
  }

  return { valid: errors.length === 0, corrected, errors };
}
