/**
 * Open-model tool-call parsers (S3-2).
 *
 * Ports the 11 model-family-specific tool-call format parsers from
 * hermes-agent. Each parser knows how a particular open-model family
 * emits structured tool calls in raw text — Hermes uses one XML tag,
 * Mistral uses [TOOL_CALLS] with bracketed JSON, Llama uses pipe-tag
 * markers, etc. The capability-augmenter's emulated tool-calling path
 * dispatches to the right parser based on the active model name.
 *
 * Each parser returns `null` when the text doesn't contain a tool call
 * in the expected format, and a structured `{name, args}` when it does.
 * Args are normalized to `Record<string, unknown>` so downstream tool
 * dispatch sees a uniform shape regardless of source format.
 *
 * The intent is correctness on real model output, not strict format
 * validation — we tolerate trailing whitespace, partial XML tags, and
 * minor JSON-format drift (single-quoted strings for some families) so
 * the harness still recovers a tool call even when the model's output
 * is slightly malformed.
 */

export interface ParsedToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * Best-effort JSON parse that tolerates single-quoted strings and
 * trailing commas — common slip-ups in raw model output. Returns
 * undefined on unrecoverable malformed input rather than throwing.
 */
function tolerantJSONParse(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try common transformations.
    try {
      // Convert single quotes to double quotes (lossy but often correct).
      const doubleQuoted = trimmed.replace(/'/g, '"');
      return JSON.parse(doubleQuoted);
    } catch {
      // Strip trailing commas.
      try {
        const stripped = trimmed.replace(/,(\s*[}\]])/g, "$1");
        return JSON.parse(stripped);
      } catch {
        return undefined;
      }
    }
  }
}

function asArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// ── 1. Hermes / NousResearch ────────────────────────────────
//
// <tool_call>{"name": "fn", "arguments": {...}}</tool_call>
// Used by: hermes-3, hermes-2-pro, openhermes-2.5
export function parseHermes(text: string): ParsedToolCall | null {
  const match = text.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/);
  if (!match) return null;
  const json = tolerantJSONParse(match[1] ?? "");
  if (!json || typeof json !== "object") return null;
  const obj = json as { name?: unknown; arguments?: unknown };
  if (typeof obj.name !== "string") return null;
  return { name: obj.name, args: asArgs(obj.arguments) };
}

// ── 2. Mistral ──────────────────────────────────────────────
//
// [TOOL_CALLS][{"name": "fn", "arguments": {...}}, {"name": "fn2", ...}]
// Used by: mistral-large, mistral-small, codestral
//
// Bracket-balanced extraction (the original lazy `\]` regex broke the
// moment an argument contained a nested array like `{"items":[1,2,3]}` —
// common in real Mistral output).
//
// Real Mistral-large routinely emits multiple tool calls in one
// `[TOOL_CALLS]` array; prior versions silently dropped everything
// after `arr[0]`. parseMistralAll walks the entire array so the runtime
// can dispatch each call.
export function parseMistralAll(text: string): ReadonlyArray<ParsedToolCall> {
  const markerIdx = text.indexOf("[TOOL_CALLS]");
  if (markerIdx < 0) return [];
  const afterMarker = markerIdx + "[TOOL_CALLS]".length;
  // Skip whitespace to find the opening '[' of the JSON array.
  let start = -1;
  for (let i = afterMarker; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "[") {
      start = i;
      break;
    }
    if (!/\s/.test(ch)) return [];
  }
  if (start < 0) return [];
  // Walk forward with a bracket/string-aware counter so arrays/objects
  // nested inside argument values don't terminate the match early.
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return [];
  const arr = tolerantJSONParse(text.slice(start, end + 1));
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const results: ParsedToolCall[] = [];
  for (const entry of arr) {
    const obj = entry as { name?: unknown; arguments?: unknown };
    if (typeof obj?.name === "string") {
      results.push({ name: obj.name, args: asArgs(obj.arguments) });
    }
  }
  return results;
}

/** Back-compat single-return. Returns first call or null. */
export function parseMistral(text: string): ParsedToolCall | null {
  return parseMistralAll(text)[0] ?? null;
}

// ── 3. Llama 3.x ────────────────────────────────────────────
//
// <|python_tag|>{"name": "fn", "parameters": {...}}<|eom_id|>
// Or just JSON when used in ipython mode.
// Used by: llama-3.2, llama-3.3, llama-4
export function parseLlama(text: string): ParsedToolCall | null {
  const tagMatch = text.match(/<\|python_tag\|>([\s\S]*?)(?:<\|eom_id\|>|<\|eot_id\|>|$)/);
  const candidate = tagMatch ? tagMatch[1] : text;
  const json = tolerantJSONParse(candidate ?? "");
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const obj = json as { name?: unknown; parameters?: unknown; arguments?: unknown };
  if (typeof obj.name !== "string") return null;
  // Llama uses `parameters` officially but `arguments` shows up in some training data.
  return { name: obj.name, args: asArgs(obj.parameters ?? obj.arguments) };
}

// ── 4. Qwen ─────────────────────────────────────────────────
//
// <tool_call>\n{"name": "fn", "arguments": {...}}\n</tool_call>
// Same outer markers as Hermes but Qwen sometimes adds whitespace
// inside the tags and uses `arguments` consistently.
// Used by: qwen2.5-coder, qwen3-coder, qwen3.5
export function parseQwen(text: string): ParsedToolCall | null {
  return parseHermes(text); // identical wire format
}

// ── 5. DeepSeek ─────────────────────────────────────────────
//
// Real DeepSeek V3 format (the name lives BEFORE the JSON fence, separated
// by <｜tool▁sep｜>, NOT as a `name` key inside the JSON object):
//   <｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>NAME
//   ```json
//   {args...}
//   ```<｜tool▁call▁end｜><｜tool▁calls▁end｜>
//
// Fine-tuned / distilled V3 variants sometimes emit the inline-JSON form
// WITHOUT the code fence — the session-3 regex hard-required a fence and
// silently returned null for such variants. parseDeepSeekAll makes the
// fence optional (matches inline JSON directly when no ```) and uses
// matchAll so multi-call responses don't drop everything after the first.
// Used by: deepseek-v3, deepseek-v4, deepseek-r1
export function parseDeepSeekAll(text: string): ReadonlyArray<ParsedToolCall> {
  const results: ParsedToolCall[] = [];
  // Format (a): V3 sep-form — name outside JSON, fence optional.
  // The body is either ```json...``` OR a bare JSON object `{...}`.
  const sepPattern =
    /<[｜|]tool[▁_]call[▁_]begin[｜|]>\s*function\s*<[｜|]tool[▁_]sep[｜|]>\s*([^\n`]+?)\s*\n+\s*(?:```(?:json)?\s*([\s\S]*?)\s*```|(\{[\s\S]*?\}))\s*<[｜|]tool[▁_]call[▁_]end[｜|]>/g;
  for (const match of text.matchAll(sepPattern)) {
    const name = (match[1] ?? "").trim();
    if (!name) continue;
    const body = match[2] ?? match[3] ?? "";
    const json = tolerantJSONParse(body);
    results.push({ name, args: asArgs(json) });
  }
  if (results.length > 0) return results;

  // Format (a'): older variant — name inside JSON. Uses matchAll on the
  // per-call wrapper so multi-call arrays don't silently drop after first.
  // Accepts both singular (`tool_call_begin`) and plural
  // (`tool_calls_begin`) on each side for back-compat with fine-tunes
  // that mix the outer-wrapper and per-call tags.
  const blockPattern =
    /<[｜|]tool[▁_]calls?[▁_]begin[｜|]>([\s\S]*?)<[｜|]tool[▁_]calls?[▁_]end[｜|]>/g;
  for (const match of text.matchAll(blockPattern)) {
    const inner = match[1] ?? "";
    const fenced = inner.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : inner;
    const json = tolerantJSONParse(candidate ?? "");
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const obj = json as { name?: unknown; arguments?: unknown };
      if (typeof obj.name === "string") {
        results.push({ name: obj.name, args: asArgs(obj.arguments) });
      }
    }
  }
  if (results.length > 0) return results;

  // Format (b): no marker at all — bare `{"name":"...","arguments":{...}}`
  // JSON as produced by some distilled / Instruct variants.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const json = tolerantJSONParse(trimmed);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const obj = json as { name?: unknown; arguments?: unknown };
      if (typeof obj.name === "string") {
        results.push({ name: obj.name, args: asArgs(obj.arguments) });
      }
    }
  }
  if (results.length > 0) return results;

  // Format (c): fall through to functionary-style (single result only —
  // functionary wire format is single-recipient).
  const fallback = parseFunctionary(text);
  return fallback ? [fallback] : [];
}

/** Back-compat single-return. Returns first call or null. */
export function parseDeepSeek(text: string): ParsedToolCall | null {
  return parseDeepSeekAll(text)[0] ?? null;
}

// ── 6. Functionary ──────────────────────────────────────────
//
// <|from|>assistant
// <|recipient|>tool_name
// <|content|>{json}
// Used by: functionary-medium-v3.1, functionary-small-v3.2
export function parseFunctionary(text: string): ParsedToolCall | null {
  const recipientMatch = text.match(/<\|recipient\|>\s*([^\n<]+)/);
  const contentMatch = text.match(/<\|content\|>\s*([\s\S]*?)(?:<\||$)/);
  if (!recipientMatch || !contentMatch) return null;
  const name = recipientMatch[1]?.trim() ?? "";
  if (!name || name === "all") return null; // "all" means plain assistant text
  const json = tolerantJSONParse(contentMatch[1] ?? "");
  return { name, args: asArgs(json) };
}

// ── 7. Jamba (AI21) ─────────────────────────────────────────
//
// Real Jamba 1.5 format per AI21's chat template:
//   <tool_calls>
//     <tool_call>
//       <name>fn</name>
//       <arguments>{json}</arguments>
//     </tool_call>
//   </tool_calls>
//
// Per AI21's spec the outer `<tool_calls>` wrapper is OPTIONAL — a
// single call in the chat template is frequently emitted bare, and
// multi-call responses wrap. XML entities inside <arguments> are
// XML-1.0-escaped JSON that must be decoded before JSON.parse.
// Used by: jamba-1.5-large, jamba-1.5-mini
function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseJambaAll(text: string): ReadonlyArray<ParsedToolCall> {
  // Primary: nested-child format per AI21 spec. `matchAll` so multiple
  // calls in one wrapper don't silently drop after the first.
  const pattern =
    /<tool_call>\s*<name>\s*([^<]+?)\s*<\/name>\s*<arguments>\s*([\s\S]*?)\s*<\/arguments>\s*<\/tool_call>/g;
  const results: ParsedToolCall[] = [];
  for (const match of text.matchAll(pattern)) {
    const name = (match[1] ?? "").trim();
    if (!name) continue;
    const rawJson = decodeXmlEntities(match[2] ?? "");
    const json = tolerantJSONParse(rawJson);
    results.push({ name, args: asArgs(json) });
  }
  if (results.length > 0) return results;
  // Fallback: older attribute-on-tag format observed in some fine-tunes.
  // Prior session-3 code looked for `<function_call name=...>` by mistake;
  // real legacy form is `<tool_call name=...>` per AI21's old spec.
  const attrPattern = /<tool_call\s+name="([^"]+)"\s*(?:\/|>\s*([\s\S]*?)<\/tool_call)>/g;
  for (const match of text.matchAll(attrPattern)) {
    const name = match[1] ?? "";
    if (!name) continue;
    const body = match[2] ? decodeXmlEntities(match[2]) : "";
    const json = body ? tolerantJSONParse(body) : {};
    results.push({ name, args: asArgs(json) });
  }
  return results;
}

/** Back-compat single-return. Returns first call or null. */
export function parseJamba(text: string): ParsedToolCall | null {
  return parseJambaAll(text)[0] ?? null;
}

// ── 8. Command R / R+ (Cohere) ──────────────────────────────
//
// Action: ```json
// [{"tool_name": "fn", "parameters": {...}}, {"tool_name": "fn2", ...}]
// ```
// Used by: command-r, command-r-plus, command-r7b
//
// Cohere's Command R+ routinely emits arrays with 2+ tool calls —
// parseCommandRAll iterates so the runtime can dispatch each.
export function parseCommandRAll(text: string): ReadonlyArray<ParsedToolCall> {
  const match = text.match(/Action:\s*```(?:json)?\s*([\s\S]*?)```/);
  if (!match) return [];
  const arr = tolerantJSONParse(match[1] ?? "");
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const results: ParsedToolCall[] = [];
  for (const entry of arr) {
    const obj = entry as { tool_name?: unknown; name?: unknown; parameters?: unknown };
    const name =
      typeof obj?.tool_name === "string"
        ? obj.tool_name
        : typeof obj?.name === "string"
          ? obj.name
          : "";
    if (name) results.push({ name, args: asArgs(obj.parameters) });
  }
  return results;
}

/** Back-compat single-return. Returns first call or null. */
export function parseCommandR(text: string): ParsedToolCall | null {
  return parseCommandRAll(text)[0] ?? null;
}

// ── 9. ToolBench / ChatGLM ──────────────────────────────────
//
// Action: function_name
// Action Input: {json}
// (Plain key-value markers — also used by some Chinese models)
export function parseToolBench(text: string): ParsedToolCall | null {
  const actionMatch = text.match(
    /Action:\s*([^\n]+)\s*\n\s*Action Input:\s*([\s\S]+?)(?:\n\s*(?:Observation|Thought|Action):|$)/,
  );
  if (!actionMatch) return null;
  const name = (actionMatch[1] ?? "").trim();
  if (!name || name.toLowerCase().includes("none") || name.toLowerCase().includes("finish")) {
    return null;
  }
  const inputRaw = (actionMatch[2] ?? "").trim();
  // Try JSON first, then fall back to a string arg.
  const json = tolerantJSONParse(inputRaw);
  return { name, args: json !== undefined ? asArgs(json) : { input: inputRaw } };
}

// ── 10. Glaive ──────────────────────────────────────────────
//
// <functioncall>{"name": "fn", "arguments": "{...inner json string...}"}</functioncall>
// Note: Glaive's `arguments` is a STRING containing JSON (double-encoded).
// Used by: glaive-function-calling-v1, glaive-coder
export function parseGlaive(text: string): ParsedToolCall | null {
  const match = text.match(/<functioncall>\s*([\s\S]*?)\s*<\/functioncall>/);
  if (!match) return null;
  const outer = tolerantJSONParse(match[1] ?? "");
  if (!outer || typeof outer !== "object") return null;
  const obj = outer as { name?: unknown; arguments?: unknown };
  if (typeof obj.name !== "string") return null;
  // Glaive double-encodes the arguments as a JSON-string-of-JSON.
  let args: Record<string, unknown> = {};
  if (typeof obj.arguments === "string") {
    const inner = tolerantJSONParse(obj.arguments);
    args = asArgs(inner);
  } else {
    args = asArgs(obj.arguments);
  }
  return { name: obj.name, args };
}

// ── 11. Generic ReAct ───────────────────────────────────────
//
// Thought: ...
// Action: function_name
// Action Input: ... (free text or json)
// (No model-specific markers — common in fine-tuned agents)
export function parseReact(text: string): ParsedToolCall | null {
  // Same shape as ToolBench but no requirement on Action Input format.
  return parseToolBench(text);
}

// ── 12. Wotann legacy XML ───────────────────────────────────
//
// <tool_use>
//   <tool name="fn"><param name="x">1</param></tool>
// </tool_use>
// This is the format the old parseToolCallFromText used. Kept as a
// fallback for any legacy emulated path that already uses it.
export function parseWotannXML(text: string): ParsedToolCall | null {
  const match = text.match(/<tool_use>\s*<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>\s*<\/tool_use>/);
  if (!match) return null;
  const name = match[1] ?? "";
  const args: Record<string, string> = {};
  const params = (match[2] ?? "").matchAll(/<param\s+name="([^"]+)">([^<]*)<\/param>/g);
  for (const p of params) {
    const k = p[1];
    if (k !== undefined) args[k] = p[2] ?? "";
  }
  return { name, args };
}

// ── Parser registry + dispatcher ────────────────────────────

export type ParserFn = (text: string) => ParsedToolCall | null;

/**
 * Map model-name patterns to specific parsers. The first regex match
 * wins. The order is meaningful — more-specific patterns first.
 */
//
// Note on the `^` anchor: without the non-capturing group wrapper, the
// anchor only applies to the first alternation branch (`/^a|b|c/` parses
// as `/(^a)|b|c/`), so substrings in the middle of the model name could
// accidentally match unrelated patterns. Each entry is therefore wrapped
// in `(?:...)` so every alternation is properly start-anchored.
//
// The session-4 audit added two pattern improvements: Qwen now matches
// the `qwen3-coder` family (Alibaba's flagship coder model); and the
// resolveParser step strips cross-provider routing prefixes
// (`openrouter/`, `litellm/`, `together_ai/`, etc.) before matching
// so `openrouter/meta-llama/llama-3.3` actually reaches parseLlama.
const PARSER_REGISTRY: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly parser: ParserFn;
  readonly family: string;
}> = [
  { pattern: /^(?:hermes|nous-?hermes|openhermes)/i, parser: parseHermes, family: "hermes" },
  { pattern: /^(?:mistral|codestral|mixtral)/i, parser: parseMistral, family: "mistral" },
  {
    pattern: /^(?:llama-?[34]|llama-?\d{1,2}\.\d|meta-llama|llama-?3-?\d)/i,
    parser: parseLlama,
    family: "llama",
  },
  {
    pattern: /^(?:qwen(?:[23]?(?:[-.]?\d+)?(?:-coder)?|-?coder|3-?coder))/i,
    parser: parseQwen,
    family: "qwen",
  },
  { pattern: /^(?:deepseek)/i, parser: parseDeepSeek, family: "deepseek" },
  { pattern: /^(?:functionary)/i, parser: parseFunctionary, family: "functionary" },
  { pattern: /^(?:jamba)/i, parser: parseJamba, family: "jamba" },
  { pattern: /^(?:command-?r|cohere|c4ai)/i, parser: parseCommandR, family: "command-r" },
  { pattern: /^(?:toolbench|chatglm)/i, parser: parseToolBench, family: "toolbench" },
  { pattern: /^(?:glaive)/i, parser: parseGlaive, family: "glaive" },
];

/**
 * Strip cross-provider routing prefixes so `openrouter/deepseek-v3` and
 * similar names reach the correct family parser. Session-4 audit found
 * provider-prefixed names were silently falling through to parseAny's
 * try-everything path — the per-family dispatch was dead code for
 * anyone routing through OpenRouter, LiteLLM, Portkey, Together, etc.
 *
 * Handled prefixes (empirically observed): `openrouter/`, `litellm/`,
 * `portkey/`, `together_ai/`, `together/`, `fireworks/`, `anthropic/`,
 * `google/`, `groq/`. Plus the nested `vendor/family/` shape OpenRouter
 * uses (e.g. `openrouter/meta-llama/llama-3.3-70b` → strip
 * `openrouter/meta-llama/`).
 */
function stripProviderPrefix(modelName: string): string {
  const KNOWN_PREFIXES = [
    "openrouter/",
    "litellm/",
    "portkey/",
    "together_ai/",
    "together/",
    "fireworks/",
    "anthropic/",
    "google/",
    "groq/",
  ];
  for (const prefix of KNOWN_PREFIXES) {
    if (modelName.toLowerCase().startsWith(prefix)) {
      const rest = modelName.slice(prefix.length);
      // OpenRouter nests a second vendor segment like `meta-llama/`; if
      // rest looks like `vendor/model` AND vendor is a known family name,
      // strip that too so `meta-llama/llama-3.3` arrives as `llama-3.3`.
      const slashIdx = rest.indexOf("/");
      if (slashIdx > 0) {
        const vendor = rest.slice(0, slashIdx).toLowerCase();
        if (
          /^(meta-llama|mistralai|qwen|deepseek-ai|cohere|ai21|nousresearch|google|anthropic)$/.test(
            vendor,
          )
        ) {
          return rest.slice(slashIdx + 1);
        }
      }
      return rest;
    }
  }
  return modelName;
}

/**
 * Resolve the parser for a given model name. Strips provider routing
 * prefixes (openrouter/ etc.) before matching so cross-provider routing
 * names don't bypass the per-family dispatch. Falls through to a
 * try-everything dispatcher when no specific match.
 */
export function resolveParser(modelName: string | undefined): ParserFn {
  if (modelName) {
    const stripped = stripProviderPrefix(modelName);
    for (const entry of PARSER_REGISTRY) {
      if (entry.pattern.test(stripped)) return entry.parser;
    }
  }
  return parseAny;
}

/**
 * Try every known parser in priority order, return the first hit.
 * Used when the model name is unknown or generic.
 */
export function parseAny(text: string): ParsedToolCall | null {
  return (
    parseWotannXML(text) ??
    parseHermes(text) ??
    parseMistral(text) ??
    parseLlama(text) ??
    parseFunctionary(text) ??
    parseDeepSeek(text) ??
    parseJamba(text) ??
    parseCommandR(text) ??
    parseGlaive(text) ??
    parseToolBench(text) ??
    parseReact(text) ??
    null
  );
}

/**
 * Convenience: parse a tool call from text using model-aware dispatch.
 * The Wotann legacy XML format is always tried first as a backstop.
 */
export function parseToolCall(text: string, modelName?: string): ParsedToolCall | null {
  return parseToolCalls(text, modelName)[0] ?? null;
}

/**
 * Array-returning variant that surfaces EVERY tool call in the text,
 * not just the first. Real Mistral-large, Command-R+, Jamba, and
 * DeepSeek V3 routinely emit 2-3 tool calls per turn; callers that
 * only look at [0] silently drop the rest, causing user-visible gaps
 * ("I asked for weather in NY and SF — why only NY?").
 *
 * Dispatch order: Wotann XML backstop → family-specific parser by
 * model name. Family parsers that return arrays (Mistral, Command-R,
 * Jamba, DeepSeek) surface multi-call directly; single-return parsers
 * (Hermes, Llama, Qwen, Functionary, Glaive, ToolBench, ReAct) are
 * wrapped in 0-or-1-element arrays.
 */
export function parseToolCalls(text: string, modelName?: string): ReadonlyArray<ParsedToolCall> {
  const wotann = parseWotannXML(text);
  if (wotann) return [wotann];
  const resolved = resolveParser(modelName);
  if (resolved === parseMistral) return parseMistralAll(text);
  if (resolved === parseCommandR) return parseCommandRAll(text);
  if (resolved === parseJamba) return parseJambaAll(text);
  if (resolved === parseDeepSeek) return parseDeepSeekAll(text);
  const single = resolved(text);
  return single ? [single] : [];
}
