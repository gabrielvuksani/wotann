/**
 * Component importer — writes typed React TSX stubs from Claude Design's
 * `components.json` entries.
 *
 * Each entry is expected to match the format Anthropic Labs shipped on
 * 2026-04-17:
 *   { name, type, props: {name, type, required?, default?}[], variants, html, css }
 *
 * Output: one `{PascalName}.tsx` per component under
 * `<outputDir>/components/`. We keep the generator small and deterministic
 * (no template engine, no reflection) so failures are loud and the diffs are
 * reviewable.
 *
 * Security: we intentionally do NOT emit `dangerouslySetInnerHTML`. The raw
 * HTML and CSS from a handoff bundle are treated as untrusted — they're
 * exported as string constants so the caller can feed them through DOMPurify
 * or an equivalent sanitizer before rendering. The default render path
 * surfaces metadata only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PropType = "string" | "number" | "boolean" | "node" | "function" | string;

export interface ImportedPropDef {
  readonly name: string;
  readonly type: PropType;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly description?: string;
}

export interface ImportedVariant {
  readonly name: string;
  readonly props: Readonly<Record<string, string | number | boolean>>;
}

export interface ImportedComponent {
  readonly name: string;
  readonly type: string;
  readonly props: readonly ImportedPropDef[];
  readonly variants: readonly ImportedVariant[];
  readonly html: string;
  readonly css: string;
}

interface RawProp {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly required?: unknown;
  readonly default?: unknown;
  readonly description?: unknown;
}

interface RawVariant {
  readonly name?: unknown;
  readonly props?: unknown;
}

interface RawComponent {
  readonly name?: unknown;
  readonly type?: unknown;
  readonly props?: unknown;
  readonly variants?: unknown;
  readonly html?: unknown;
  readonly css?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePropType(raw: unknown): PropType {
  const s = asString(raw, "string").toLowerCase().trim();
  if (s === "string" || s === "text") return "string";
  if (s === "number" || s === "int" || s === "float") return "number";
  if (s === "boolean" || s === "bool") return "boolean";
  if (s === "node" || s === "children" || s === "reactnode") return "node";
  if (s === "function" || s === "fn" || s === "callback") return "function";
  return s || "string";
}

export function normalizeComponents(raw: unknown): readonly ImportedComponent[] {
  if (!Array.isArray(raw)) {
    throw new Error("components.json must contain a JSON array of components");
  }
  const out: ImportedComponent[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!isObject(item)) {
      throw new Error(`components[${i}] is not an object`);
    }
    const rc = item as RawComponent;
    const name = asString(rc.name).trim();
    if (!name) {
      throw new Error(`components[${i}] is missing required field "name"`);
    }
    const propsRaw = Array.isArray(rc.props) ? rc.props : [];
    const props: ImportedPropDef[] = [];
    for (let j = 0; j < propsRaw.length; j++) {
      const pr = propsRaw[j];
      if (!isObject(pr)) {
        throw new Error(`components[${i}].props[${j}] is not an object`);
      }
      const raw = pr as RawProp;
      const propName = asString(raw.name).trim();
      if (!propName) {
        throw new Error(`components[${i}].props[${j}] is missing "name"`);
      }
      const propDef: ImportedPropDef = {
        name: propName,
        type: normalizePropType(raw.type),
        required: asBool(raw.required, false),
        ...(typeof raw.default !== "undefined" ? { defaultValue: String(raw.default) } : {}),
        ...(typeof raw.description === "string" ? { description: raw.description } : {}),
      };
      props.push(propDef);
    }
    const variantsRaw = Array.isArray(rc.variants) ? rc.variants : [];
    const variants: ImportedVariant[] = [];
    for (const v of variantsRaw) {
      if (!isObject(v)) continue;
      const rv = v as RawVariant;
      const variantName = asString(rv.name);
      const variantProps: Record<string, string | number | boolean> = {};
      if (isObject(rv.props)) {
        for (const key of Object.keys(rv.props)) {
          const val = (rv.props as Record<string, unknown>)[key];
          if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
            variantProps[key] = val;
          }
        }
      }
      variants.push({ name: variantName, props: variantProps });
    }
    out.push({
      name,
      type: asString(rc.type, "component"),
      props,
      variants,
      html: asString(rc.html, ""),
      css: asString(rc.css, ""),
    });
  }
  return out;
}

function pascalCase(value: string): string {
  return (
    value
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("") || "UnnamedComponent"
  );
}

function propTypeToTs(type: PropType): string {
  switch (type) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "node":
      return "React.ReactNode";
    case "function":
      return "() => void";
    default:
      return "string";
  }
}

function escapeForTemplate(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * Render a single component as a typed React stub.
 *
 * The default render is metadata-only — it surfaces the component name and
 * variant list so Workshop can preview the import without executing raw
 * HTML. Raw HTML and CSS are exported as string constants (`RAW_HTML`,
 * `RAW_CSS`) so downstream consumers can feed them through a sanitizer
 * (e.g. DOMPurify) before rendering.
 */
export function renderComponentTsx(component: ImportedComponent): string {
  const name = pascalCase(component.name);
  const propsInterface =
    component.props.length > 0
      ? [
          `export interface ${name}Props {`,
          ...component.props.map((p) => {
            const optional = p.required ? "" : "?";
            const desc = p.description ? `  /** ${p.description.replace(/\*\//g, "* /")} */\n` : "";
            return `${desc}  readonly ${p.name}${optional}: ${propTypeToTs(p.type)};`;
          }),
          `}`,
          "",
        ].join("\n")
      : `export interface ${name}Props { readonly __unused?: never }\n`;

  const html = escapeForTemplate(component.html || "");
  const css = escapeForTemplate(component.css || "");
  const variantNames = component.variants
    .map((v) => v.name)
    .filter(Boolean)
    .map((n) => JSON.stringify(n))
    .join(", ");

  const lines: string[] = [
    `/**`,
    ` * ${name} — imported from Claude Design handoff bundle.`,
    ` * Source type: ${component.type}`,
    ` * Variants: ${
      component.variants
        .map((v) => v.name)
        .filter(Boolean)
        .join(", ") || "(none)"
    }`,
    ` *`,
    ` * Raw HTML and CSS are exported as RAW_HTML / RAW_CSS so consumers can`,
    ` * sanitize them (e.g. with DOMPurify) before rendering. The default`,
    ` * render path is metadata-only.`,
    ` *`,
    ` * Regenerated on re-import — edits outside this file are preserved.`,
    ` */`,
    `import * as React from "react";`,
    ``,
    propsInterface,
    `export const RAW_HTML: string = \`${html}\`;`,
    `export const RAW_CSS: string = \`${css}\`;`,
    `export const VARIANT_NAMES: readonly string[] = [${variantNames}];`,
    ``,
    `export function ${name}(props: ${name}Props): React.ReactElement {`,
    `  void props;`,
    `  return (`,
    `    <div className="wotann-imported-component" data-component-name="${name}">`,
    `      <strong>${name}</strong>`,
    `      <span style={{ opacity: 0.6, marginLeft: 8 }}>`,
    `        imported — see RAW_HTML / RAW_CSS to render`,
    `      </span>`,
    `    </div>`,
    `  );`,
    `}`,
    ``,
    `export default ${name};`,
    ``,
  ];
  return lines.join("\n");
}

export interface ImportResult {
  readonly written: readonly string[];
  readonly componentCount: number;
}

/**
 * Write each component as a TSX file under `targetDir`. The directory is
 * created if missing; each file is overwritten deterministically on
 * re-import.
 */
export function writeComponents(
  components: readonly ImportedComponent[],
  targetDir: string,
): ImportResult {
  mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];
  const seen = new Set<string>();
  for (const component of components) {
    let fileName = `${pascalCase(component.name)}.tsx`;
    if (seen.has(fileName)) {
      let suffix = 2;
      while (seen.has(`${pascalCase(component.name)}-${suffix}.tsx`)) suffix += 1;
      fileName = `${pascalCase(component.name)}-${suffix}.tsx`;
    }
    const path = join(targetDir, fileName);
    writeFileSync(path, renderComponentTsx(component));
    written.push(path);
    seen.add(fileName);
  }
  return { written, componentCount: written.length };
}
