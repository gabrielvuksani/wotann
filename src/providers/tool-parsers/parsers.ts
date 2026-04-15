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
// [TOOL_CALLS][{"name": "fn", "arguments": {...}}]
// Used by: mistral-large, mistral-small, codestral
export function parseMistral(text: string): ParsedToolCall | null {
  const match = text.match(/\[TOOL_CALLS\]\s*(\[[\s\S]*?\])/);
  if (!match) return null;
  const arr = tolerantJSONParse(match[1] ?? "");
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0] as { name?: unknown; arguments?: unknown };
  if (typeof first?.name !== "string") return null;
  return { name: first.name, args: asArgs(first.arguments) };
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
// Two formats observed:
//  a) <｜tool▁calls▁begin｜>...<｜tool▁call▁end｜> with ```json fenced inside
//  b) Standard OpenAI-style function_call within text
// Used by: deepseek-v3, deepseek-v4, deepseek-r1
export function parseDeepSeek(text: string): ParsedToolCall | null {
  // Format (a): tool_calls fenced block (note: DeepSeek uses unicode pipe char）
  const blockMatch = text.match(
    /<[｜|]tool[▁_]calls[▁_]begin[｜|]>([\s\S]*?)<[｜|]tool[▁_]call[▁_]end[｜|]>/,
  );
  if (blockMatch) {
    const inner = blockMatch[1] ?? "";
    const fenced = inner.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : inner;
    const json = tolerantJSONParse(candidate ?? "");
    if (json && typeof json === "object" && !Array.isArray(json)) {
      const obj = json as { name?: unknown; arguments?: unknown };
      if (typeof obj.name === "string") {
        return { name: obj.name, args: asArgs(obj.arguments) };
      }
    }
  }
  // Format (b): fall through to functionary-style or standard JSON
  return parseFunctionary(text);
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
// <function_calls>
//   <function_call>name="fn">{json args}</function_call>
// </function_calls>
// Used by: jamba-1.5-large, jamba-1.5-mini
export function parseJamba(text: string): ParsedToolCall | null {
  const match = text.match(/<function_call(?:\s+name="([^"]+)")?\s*>([\s\S]*?)<\/function_call>/);
  if (!match) return null;
  const name = match[1] ?? "";
  if (!name) return null;
  const json = tolerantJSONParse(match[2] ?? "");
  return { name, args: asArgs(json) };
}

// ── 8. Command R / R+ (Cohere) ──────────────────────────────
//
// Action: ```json
// [{"tool_name": "fn", "parameters": {...}}]
// ```
// Used by: command-r, command-r-plus, command-r7b
export function parseCommandR(text: string): ParsedToolCall | null {
  const match = text.match(/Action:\s*```(?:json)?\s*([\s\S]*?)```/);
  if (!match) return null;
  const arr = tolerantJSONParse(match[1] ?? "");
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0] as { tool_name?: unknown; name?: unknown; parameters?: unknown };
  const name =
    typeof first?.tool_name === "string"
      ? first.tool_name
      : typeof first?.name === "string"
        ? first.name
        : "";
  if (!name) return null;
  return { name, args: asArgs(first.parameters) };
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
const PARSER_REGISTRY: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly parser: ParserFn;
  readonly family: string;
}> = [
  { pattern: /^hermes|nous-?hermes|openhermes/i, parser: parseHermes, family: "hermes" },
  { pattern: /^mistral|codestral|mixtral/i, parser: parseMistral, family: "mistral" },
  { pattern: /^llama-?[34]|llama-?\d{1,2}\.\d/i, parser: parseLlama, family: "llama" },
  { pattern: /^qwen[23]?\.?\d|qwen-?coder/i, parser: parseQwen, family: "qwen" },
  { pattern: /^deepseek/i, parser: parseDeepSeek, family: "deepseek" },
  { pattern: /^functionary/i, parser: parseFunctionary, family: "functionary" },
  { pattern: /^jamba/i, parser: parseJamba, family: "jamba" },
  { pattern: /^command-?r/i, parser: parseCommandR, family: "command-r" },
  { pattern: /^toolbench|chatglm/i, parser: parseToolBench, family: "toolbench" },
  { pattern: /^glaive/i, parser: parseGlaive, family: "glaive" },
];

/**
 * Resolve the parser for a given model name. Falls through to a
 * try-everything dispatcher when no specific match (best-effort
 * recovery for unknown models that emit a recognisable format).
 */
export function resolveParser(modelName: string | undefined): ParserFn {
  if (modelName) {
    for (const entry of PARSER_REGISTRY) {
      if (entry.pattern.test(modelName)) return entry.parser;
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
  // Always try the legacy XML format first — capability-augmenter still
  // injects this format for emulated tool calling, so a model that
  // followed the instructions exactly will produce this format
  // regardless of family.
  const wotann = parseWotannXML(text);
  if (wotann) return wotann;
  const parser = resolveParser(modelName);
  return parser(text);
}
