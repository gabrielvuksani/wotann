/**
 * Typed prompt template compiler.
 *
 * Prompts are usually string-interpolated ad-hoc: `${question}...`
 * That's fine for one-off but scales badly across many skills.
 * Typed templates give:
 *   1. Type-safe variables (compiler catches typos)
 *   2. Validation (required vars, format constraints)
 *   3. Reusable fragments (DRY across prompts)
 *   4. Preview (render with dummy data before sending)
 *
 * Syntax:
 *   {{name}}           — simple variable
 *   {{name | default}} — fallback if undefined
 *   {{#if cond}}X{{/if}} — conditional block
 *   {{#each list}}{{this}}{{/each}} — iteration
 *
 * Pure function — no I/O. Produces a compiled function from a
 * template string that can be called with a variables object.
 */

// ── Types ──────────────────────────────────────────────

export interface TemplateVariable {
  readonly name: string;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly inConditional?: boolean;
  readonly inLoop?: boolean;
}

export interface CompiledTemplate<V extends Record<string, unknown>> {
  readonly source: string;
  readonly variables: readonly TemplateVariable[];
  readonly render: (vars: V) => string;
}

export interface CompileOptions {
  /** Throw on unknown variable (vs silently emitting empty). Default false. */
  readonly strict?: boolean;
}

// ── Parser ────────────────────────────────────────────

type TokenKind = "text" | "var" | "if-open" | "if-close" | "each-open" | "each-close";

interface Token {
  readonly kind: TokenKind;
  readonly value: string;
  readonly defaultValue?: string;
}

function tokenize(source: string): readonly Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let textBuf = "";

  const flushText = () => {
    if (textBuf) {
      tokens.push({ kind: "text", value: textBuf });
      textBuf = "";
    }
  };

  while (i < source.length) {
    if (source.startsWith("{{", i)) {
      const endIdx = source.indexOf("}}", i);
      if (endIdx < 0) {
        textBuf += source.slice(i);
        break;
      }
      flushText();
      const inner = source.slice(i + 2, endIdx).trim();

      if (inner.startsWith("#if ")) {
        tokens.push({ kind: "if-open", value: inner.slice(4).trim() });
      } else if (inner === "/if") {
        tokens.push({ kind: "if-close", value: "" });
      } else if (inner.startsWith("#each ")) {
        tokens.push({ kind: "each-open", value: inner.slice(6).trim() });
      } else if (inner === "/each") {
        tokens.push({ kind: "each-close", value: "" });
      } else {
        // variable, possibly with default
        const pipeIdx = inner.indexOf("|");
        if (pipeIdx >= 0) {
          const name = inner.slice(0, pipeIdx).trim();
          const def = inner.slice(pipeIdx + 1).trim();
          tokens.push({ kind: "var", value: name, defaultValue: def });
        } else {
          tokens.push({ kind: "var", value: inner });
        }
      }
      i = endIdx + 2;
    } else {
      textBuf += source[i];
      i++;
    }
  }
  flushText();
  return tokens;
}

// ── Variable analysis ─────────────────────────────────

function analyzeVariables(tokens: readonly Token[]): readonly TemplateVariable[] {
  const vars = new Map<string, TemplateVariable>();
  let depthIf = 0;
  let depthEach = 0;

  for (const token of tokens) {
    if (token.kind === "if-open") {
      depthIf++;
      // The condition itself is a variable reference
      if (!vars.has(token.value)) {
        vars.set(token.value, {
          name: token.value,
          required: depthIf === 1 && depthEach === 0,
          inConditional: depthIf > 1,
          inLoop: depthEach > 0,
        });
      }
    } else if (token.kind === "if-close") {
      depthIf = Math.max(0, depthIf - 1);
    } else if (token.kind === "each-open") {
      depthEach++;
      if (!vars.has(token.value)) {
        vars.set(token.value, {
          name: token.value,
          required: depthIf === 0 && depthEach === 1,
          inConditional: depthIf > 0,
          inLoop: depthEach > 1,
        });
      }
    } else if (token.kind === "each-close") {
      depthEach = Math.max(0, depthEach - 1);
    } else if (token.kind === "var") {
      // Skip the implicit 'this' loop variable
      if (token.value === "this") continue;
      if (!vars.has(token.value)) {
        const entry: TemplateVariable = {
          name: token.value,
          required: depthIf === 0 && depthEach === 0 && token.defaultValue === undefined,
          ...(token.defaultValue !== undefined ? { defaultValue: token.defaultValue } : {}),
          inConditional: depthIf > 0,
          inLoop: depthEach > 0,
        };
        vars.set(token.value, entry);
      }
    }
  }

  return [...vars.values()];
}

// ── Renderer ──────────────────────────────────────────

function renderTokens(
  tokens: readonly Token[],
  vars: Record<string, unknown>,
  strict: boolean,
  localScope: Record<string, unknown> = {},
): string {
  const resolve = (name: string): unknown => {
    if (name === "this" && "this" in localScope) return localScope["this"];
    if (name in localScope) return localScope[name];
    if (name in vars) return vars[name];
    return undefined;
  };

  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;
    if (token.kind === "text") {
      out.push(token.value);
      i++;
      continue;
    }

    if (token.kind === "var") {
      const value = resolve(token.value);
      if (value === undefined || value === null) {
        if (token.defaultValue !== undefined) {
          out.push(token.defaultValue);
        } else if (strict) {
          throw new Error(`template: variable "${token.value}" is missing`);
        }
      } else {
        out.push(String(value));
      }
      i++;
      continue;
    }

    if (token.kind === "if-open") {
      // Find matching /if
      const closeIdx = findMatching(tokens, i, "if-open", "if-close");
      const body = tokens.slice(i + 1, closeIdx);
      const cond = resolve(token.value);
      if (cond) {
        out.push(renderTokens(body, vars, strict, localScope));
      }
      i = closeIdx + 1;
      continue;
    }

    if (token.kind === "each-open") {
      const closeIdx = findMatching(tokens, i, "each-open", "each-close");
      const body = tokens.slice(i + 1, closeIdx);
      const iterable = resolve(token.value);
      if (Array.isArray(iterable)) {
        for (const item of iterable) {
          out.push(renderTokens(body, vars, strict, { ...localScope, this: item }));
        }
      }
      i = closeIdx + 1;
      continue;
    }

    // if-close or each-close without pair — skip
    i++;
  }

  return out.join("");
}

function findMatching(
  tokens: readonly Token[],
  openIdx: number,
  openKind: TokenKind,
  closeKind: TokenKind,
): number {
  let depth = 1;
  for (let i = openIdx + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === openKind) depth++;
    else if (t.kind === closeKind) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length; // unclosed — treat rest as body
}

// ── Public API ────────────────────────────────────────

export function compileTemplate<V extends Record<string, unknown>>(
  source: string,
  options: CompileOptions = {},
): CompiledTemplate<V> {
  const tokens = tokenize(source);
  const variables = analyzeVariables(tokens);
  const strict = options.strict ?? false;

  return {
    source,
    variables,
    render: (vars: V) => renderTokens(tokens, vars as Record<string, unknown>, strict),
  };
}

/**
 * Preview render with dummy data — useful for debugging templates
 * before actually sending them. Every variable gets a placeholder
 * derived from its name.
 */
export function previewTemplate<V extends Record<string, unknown>>(
  template: CompiledTemplate<V>,
): string {
  const dummy: Record<string, unknown> = {};
  for (const v of template.variables) {
    dummy[v.name] = v.defaultValue ?? `<${v.name}>`;
  }
  return template.render(dummy as V);
}
