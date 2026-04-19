/**
 * W3C Design Tokens parser.
 *
 * Spec: https://www.w3.org/community/design-tokens/ (Editor's Draft, 2026-03)
 * A token is a leaf node with `$value` and optional `$type`. Groups are any
 * object that isn't a leaf. Aliases are `{group.subgroup.token}` strings.
 *
 * Claude Design bundles emit the v6.3 W3C shape (as seen in the 2026-04-17
 * handoff samples). We extract the 5 categories Workshop renders today —
 * colors, typography, spacing, borderRadius, shadows — and emit plain CSS
 * custom properties. Everything else is preserved as `extras` so callers
 * can round-trip the raw token graph later without data loss.
 */

export interface DesignTokenEntry {
  readonly name: string;
  readonly path: readonly string[];
  readonly type: string;
  readonly value: string;
  readonly rawValue: unknown;
}

export interface DesignTokens {
  readonly colors: readonly DesignTokenEntry[];
  readonly typography: readonly DesignTokenEntry[];
  readonly spacing: readonly DesignTokenEntry[];
  readonly borderRadius: readonly DesignTokenEntry[];
  readonly shadows: readonly DesignTokenEntry[];
  readonly extras: readonly DesignTokenEntry[];
  readonly totalCount: number;
}

type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

interface TokenLeaf {
  readonly $value: Json;
  readonly $type?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTokenLeaf(value: unknown): value is TokenLeaf {
  return isObject(value) && "$value" in value;
}

function slugify(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferType(path: readonly string[], explicit: string | undefined): string {
  if (explicit && explicit.trim().length > 0) return explicit;
  const head = path[0]?.toLowerCase() ?? "";
  if (head.includes("color") || head === "palette") return "color";
  if (head.includes("typography") || head === "font" || head === "fonts") return "typography";
  if (head.includes("space") || head.includes("spacing")) return "spacing";
  if (head.includes("radius") || head.includes("radii")) return "borderRadius";
  if (head.includes("shadow")) return "shadow";
  return "other";
}

function stringifyValue(value: Json): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => stringifyValue(v as Json)).join(", ");
  if (isObject(value)) {
    const obj = value as Record<string, Json>;
    // Typography shape: {fontFamily, fontSize, fontWeight, ...}
    const parts: string[] = [];
    for (const key of Object.keys(obj)) {
      parts.push(`${key}: ${stringifyValue(obj[key] as Json)}`);
    }
    return parts.join("; ");
  }
  return "";
}

function resolveAlias(raw: unknown, root: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const match = raw.match(/^\{([^}]+)\}$/);
  if (!match) return raw;
  const pathExpr = match[1];
  if (!pathExpr) return raw;
  const path = pathExpr.split(".");
  let cursor: unknown = root;
  for (const segment of path) {
    if (!isObject(cursor)) return raw;
    cursor = cursor[segment];
  }
  if (isTokenLeaf(cursor)) return cursor.$value;
  return cursor ?? raw;
}

function walk(node: Json, path: readonly string[], root: Json, out: DesignTokenEntry[]): void {
  if (!isObject(node)) return;
  if (isTokenLeaf(node)) {
    const type = inferType(path, node.$type);
    const resolvedValue = resolveAlias(node.$value, root);
    const entry: DesignTokenEntry = {
      name: slugify(path.join("-")),
      path,
      type,
      value: stringifyValue(resolvedValue as Json),
      rawValue: node.$value,
    };
    out.push(entry);
    return;
  }
  for (const key of Object.keys(node)) {
    if (key.startsWith("$")) continue;
    walk((node as Record<string, Json>)[key] as Json, [...path, key], root, out);
  }
}

/**
 * Parse a W3C Design Tokens document.
 *
 * Throws if `source` is not a plain object. Empty objects return a zero-count
 * `DesignTokens` — callers should decide whether that's an error (we keep
 * this library honest by refusing to guess).
 */
export function parseDesignTokens(source: unknown): DesignTokens {
  if (!isObject(source)) {
    throw new Error("design tokens must be a JSON object");
  }
  const all: DesignTokenEntry[] = [];
  walk(source as Json, [], source as Json, all);

  const bucket = (bucketType: string): DesignTokenEntry[] =>
    all.filter((entry) => entry.type === bucketType);

  const colors = bucket("color");
  const typography = bucket("typography");
  const spacing = bucket("spacing").concat(bucket("dimension"));
  const borderRadius = bucket("borderRadius").concat(bucket("radius"));
  const shadows = bucket("shadow");
  const known = new Set<DesignTokenEntry>([
    ...colors,
    ...typography,
    ...spacing,
    ...borderRadius,
    ...shadows,
  ]);
  const extras = all.filter((entry) => !known.has(entry));

  return {
    colors,
    typography,
    spacing,
    borderRadius,
    shadows,
    extras,
    totalCount: all.length,
  };
}

function escapeCssValue(value: string): string {
  return value.replace(/\r?\n/g, " ").trim();
}

/**
 * Emit a `:root { --token: value; }` CSS block from parsed tokens.
 *
 * Typography tokens expand to one custom property per sub-field so Monaco
 * preview and downstream components can reference `--typography-heading-font-size`
 * directly without parsing a composite string.
 */
export function emitTokensCss(tokens: DesignTokens): string {
  const lines: string[] = [":root {"];
  const emit = (entries: readonly DesignTokenEntry[]): void => {
    for (const entry of entries) {
      if (
        entry.type === "typography" &&
        typeof entry.rawValue === "object" &&
        entry.rawValue !== null
      ) {
        const obj = entry.rawValue as Record<string, unknown>;
        for (const key of Object.keys(obj)) {
          const subVal = obj[key];
          const rendered = stringifyValue(subVal as Json);
          if (rendered.length === 0) continue;
          lines.push(`  --${entry.name}-${slugify(key)}: ${escapeCssValue(rendered)};`);
        }
        continue;
      }
      if (entry.value.length === 0) continue;
      lines.push(`  --${entry.name}: ${escapeCssValue(entry.value)};`);
    }
  };
  emit(tokens.colors);
  emit(tokens.typography);
  emit(tokens.spacing);
  emit(tokens.borderRadius);
  emit(tokens.shadows);
  emit(tokens.extras);
  lines.push("}");
  return lines.join("\n") + "\n";
}
