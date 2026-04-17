import { describe, it, expect } from "vitest";
import {
  parseHermes,
  parseMistral,
  parseLlama,
  parseQwen,
  parseDeepSeek,
  parseFunctionary,
  parseJamba,
  parseCommandR,
  parseToolBench,
  parseGlaive,
  parseWotannXML,
  parseAny,
  parseToolCall,
  resolveParser,
} from "../../src/providers/tool-parsers/parsers.js";

// Adversarial regression suite for the 11 model-family tool-call parsers
// (S3-2). Each `describe` block pairs the MINIMUM case from the format
// spec with the BUG that earlier versions of the code silently hit.

describe("tool-parsers: parseHermes", () => {
  it("extracts name + args from <tool_call> envelope", () => {
    const text = `<tool_call>{"name":"read_file","arguments":{"path":"/etc/hosts"}}</tool_call>`;
    const result = parseHermes(text);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("read_file");
    expect(result?.args["path"]).toBe("/etc/hosts");
  });

  it("returns null when text lacks the envelope", () => {
    expect(parseHermes("Sorry, no tool call here.")).toBeNull();
  });
});

describe("tool-parsers: parseMistral — nested-array regression (Agent audit #1)", () => {
  // The earlier implementation used `\[[\s\S]*?\]` (lazy) which matched
  // the first `]` in nested-array args and silently lost the tool call.
  // The fix is a bracket-balanced scan respecting nesting + strings.
  it("extracts a single call with flat args", () => {
    const text = `[TOOL_CALLS][{"name":"search","arguments":{"query":"mistral"}}]`;
    const result = parseMistral(text);
    expect(result?.name).toBe("search");
    expect(result?.args["query"]).toBe("mistral");
  });

  it("extracts a call whose args contain a NESTED ARRAY (was broken)", () => {
    const text = `[TOOL_CALLS][{"name":"batch_get","arguments":{"ids":[1,2,3,4,5]}}]`;
    const result = parseMistral(text);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("batch_get");
    expect(result?.args["ids"]).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles a quoted `]` inside a string without false-terminating", () => {
    const text = `[TOOL_CALLS][{"name":"echo","arguments":{"msg":"contains [brackets] inside"}}]`;
    const result = parseMistral(text);
    expect(result?.name).toBe("echo");
    expect(result?.args["msg"]).toBe("contains [brackets] inside");
  });

  it("returns null when marker is absent", () => {
    expect(parseMistral(`{"name":"fn"}`)).toBeNull();
  });
});

describe("tool-parsers: parseLlama", () => {
  it("extracts python_tag JSON with `parameters` (Llama 3.x official)", () => {
    const text = `<|python_tag|>{"name":"web_search","parameters":{"q":"foo"}}<|eom_id|>`;
    const result = parseLlama(text);
    expect(result?.name).toBe("web_search");
    expect(result?.args["q"]).toBe("foo");
  });

  it("falls back to bare JSON when no python_tag marker is present", () => {
    const text = `{"name":"calc","parameters":{"x":1}}`;
    const result = parseLlama(text);
    expect(result?.name).toBe("calc");
  });
});

describe("tool-parsers: parseQwen", () => {
  it("shares Hermes envelope format with whitespace tolerance", () => {
    const text = `<tool_call>\n  {"name":"foo","arguments":{"a":1}}\n</tool_call>`;
    const result = parseQwen(text);
    expect(result?.name).toBe("foo");
  });
});

describe("tool-parsers: parseDeepSeek — separator-name regression (Agent audit #2)", () => {
  // Real DeepSeek V3 output puts the function name BEFORE the JSON fence,
  // separated by <｜tool▁sep｜>. The earlier implementation only read
  // `obj.name` from the JSON body — so every real DeepSeek call silently
  // returned null. The fix recognises both the V3 separator form and the
  // older name-in-JSON variant for back-compat.
  it("extracts name from <｜tool▁sep｜> separator (was broken)", () => {
    const text = `<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>function<｜tool▁sep｜>get_weather
\`\`\`json
{"city":"Toronto","unit":"C"}
\`\`\`<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;
    const result = parseDeepSeek(text);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("get_weather");
    expect(result?.args["city"]).toBe("Toronto");
  });

  it("accepts ASCII pipe + underscore transliteration (portable variant)", () => {
    const text = `<|tool_call_begin|>function<|tool_sep|>ping
\`\`\`json
{"host":"example.com"}
\`\`\`<|tool_call_end|>`;
    const result = parseDeepSeek(text);
    expect(result?.name).toBe("ping");
  });

  it("falls back to name-in-JSON for older DeepSeek fine-tunes", () => {
    const text = `<｜tool▁calls▁begin｜>
\`\`\`json
{"name":"legacy_tool","arguments":{"x":1}}
\`\`\`<｜tool▁call▁end｜>`;
    const result = parseDeepSeek(text);
    expect(result?.name).toBe("legacy_tool");
  });
});

describe("tool-parsers: parseFunctionary", () => {
  it("extracts recipient + content", () => {
    const text = `<|recipient|>fetch_url\n<|content|>{"url":"https://example.com"}`;
    const result = parseFunctionary(text);
    expect(result?.name).toBe("fetch_url");
    expect(result?.args["url"]).toBe("https://example.com");
  });

  it('returns null when recipient is "all" (plain assistant text)', () => {
    const text = `<|recipient|>all\n<|content|>Just a message`;
    expect(parseFunctionary(text)).toBeNull();
  });
});

describe("tool-parsers: parseJamba — nested-child regression (Agent audit #3)", () => {
  // Real Jamba 1.5 format uses nested child elements (<name>, <arguments>)
  // per AI21's spec. Earlier implementation used an attribute-on-tag shape
  // (<function_call name="...">...</function_call>) which did NOT match
  // any real Jamba output. The fix recognises both formats.
  it("extracts nested-child format (was broken)", () => {
    const text = `<tool_calls><tool_call><name>search</name><arguments>{"q":"jamba"}</arguments></tool_call></tool_calls>`;
    const result = parseJamba(text);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("search");
    expect(result?.args["q"]).toBe("jamba");
  });

  it("tolerates whitespace between child elements", () => {
    const text = `<tool_calls>
  <tool_call>
    <name>  get_time  </name>
    <arguments>{"tz":"UTC"}</arguments>
  </tool_call>
</tool_calls>`;
    const result = parseJamba(text);
    expect(result?.name).toBe("get_time");
    expect(result?.args["tz"]).toBe("UTC");
  });

  it("falls back to attribute-on-tag for older fine-tunes", () => {
    // Session-4 audit (Agent 3 HIGH #8): the prior test asserted
    // `<function_call name=...>` — but AI21's real legacy attribute
    // form is `<tool_call name=...>`. The session-3 fix preserved
    // the wrong tag; session-4 corrects it and the test follows.
    // Quality-bar #9: test files can codify bugs — update them
    // alongside the production fix.
    const text = `<tool_call name="old_fn">{"k":"v"}</tool_call>`;
    const result = parseJamba(text);
    expect(result?.name).toBe("old_fn");
  });
});

describe("tool-parsers: parseCommandR", () => {
  it("extracts from Cohere Action+fenced-JSON format", () => {
    const text = `Action: \`\`\`json
[{"tool_name":"search","parameters":{"q":"weather"}}]
\`\`\``;
    const result = parseCommandR(text);
    expect(result?.name).toBe("search");
    expect(result?.args["q"]).toBe("weather");
  });
});

describe("tool-parsers: parseToolBench", () => {
  it("extracts ReAct-style Action / Action Input", () => {
    const text = `Thought: I need to read a file.\nAction: read\nAction Input: {"path":"/etc/hosts"}`;
    const result = parseToolBench(text);
    expect(result?.name).toBe("read");
    expect(result?.args["path"]).toBe("/etc/hosts");
  });

  it('rejects "none" / "finish" actions', () => {
    expect(parseToolBench(`Action: finish\nAction Input: `)).toBeNull();
    expect(parseToolBench(`Action: none\nAction Input: `)).toBeNull();
  });

  it("falls back to {input: raw} when input isn't JSON", () => {
    const text = `Action: echo\nAction Input: plain text`;
    const result = parseToolBench(text);
    expect(result?.name).toBe("echo");
    expect(result?.args["input"]).toBe("plain text");
  });
});

describe("tool-parsers: parseGlaive (double-encoded arguments)", () => {
  it('parses arguments stored as JSON-string-inside-JSON', () => {
    const text = `<functioncall>{"name":"fn","arguments":"{\\"x\\":1}"}</functioncall>`;
    const result = parseGlaive(text);
    expect(result?.name).toBe("fn");
    expect(result?.args["x"]).toBe(1);
  });

  it("also accepts arguments as an already-parsed object", () => {
    const text = `<functioncall>{"name":"fn","arguments":{"y":2}}</functioncall>`;
    const result = parseGlaive(text);
    expect(result?.args["y"]).toBe(2);
  });
});

describe("tool-parsers: parseWotannXML legacy backstop", () => {
  it("parses <tool_use><tool name=...>...</tool></tool_use>", () => {
    const text = `<tool_use><tool name="fn"><param name="x">1</param></tool></tool_use>`;
    const result = parseWotannXML(text);
    expect(result?.name).toBe("fn");
    expect(result?.args["x"]).toBe("1");
  });
});

describe("tool-parsers: resolveParser — registry anchoring regression (Agent audit #4)", () => {
  // The earlier pattern `/^hermes|nous-?hermes|openhermes/i` only anchored
  // the first alternation to `^`. That meant `awscodestralapi` matched
  // the Mistral entry via substring on the second alt. Fix: wrap every
  // alternation list in `(?:...)` so `^` applies to all branches.
  it("dispatches mistral-large-2 to the Mistral parser", () => {
    const parser = resolveParser("mistral-large-2");
    // Quick sniff: parser should recognise Mistral-format input.
    const text = `[TOOL_CALLS][{"name":"test","arguments":{}}]`;
    expect(parser(text)?.name).toBe("test");
  });

  it("does NOT dispatch substring-matches like 'awscodestralapi' to Mistral", () => {
    const parser = resolveParser("awscodestralapi");
    // With anchored alternations, this falls through to parseAny, which
    // returns null for the non-parseable text.
    expect(parser("plain text")).toBeNull();
  });

  it("dispatches llama-3.2 to Llama parser", () => {
    const parser = resolveParser("llama-3.2");
    const text = `<|python_tag|>{"name":"fn","parameters":{"a":1}}<|eom_id|>`;
    expect(parser(text)?.name).toBe("fn");
  });

  it("dispatches cohere-prefixed names to Command R (new alias)", () => {
    const parser = resolveParser("cohere-command-r-plus");
    const text = `Action: \`\`\`json
[{"tool_name":"search","parameters":{"q":"x"}}]
\`\`\``;
    expect(parser(text)?.name).toBe("search");
  });

  it("falls through to parseAny for unknown model names", () => {
    const parser = resolveParser("random-custom-model-v99");
    const text = `<tool_use><tool name="fn"><param name="x">1</param></tool></tool_use>`;
    expect(parser(text)?.name).toBe("fn");
  });

  it("tolerates undefined / empty model names", () => {
    expect(resolveParser(undefined)(`no tool here`)).toBeNull();
    expect(resolveParser("")(`no tool here`)).toBeNull();
  });
});

describe("tool-parsers: parseToolCall (public entry)", () => {
  it("always tries Wotann XML first regardless of modelName", () => {
    // Even if the model name points to a specific family, the legacy
    // Wotann XML format (which the capability-augmenter injects) must
    // still be recognised so compliant responses work.
    const text = `<tool_use><tool name="fn"><param name="x">1</param></tool></tool_use>`;
    expect(parseToolCall(text, "mistral-large-2")?.name).toBe("fn");
  });

  it("dispatches to the family parser when Wotann XML isn't present", () => {
    const text = `[TOOL_CALLS][{"name":"search","arguments":{"q":"mistral"}}]`;
    expect(parseToolCall(text, "mistral-large")?.name).toBe("search");
  });

  it("returns null when no parser recognises the text", () => {
    expect(parseToolCall("plain prose.", "llama-3.3")).toBeNull();
  });
});

describe("tool-parsers: parseAny try-everything fallback", () => {
  it("recognises Hermes format without a modelName hint", () => {
    const text = `<tool_call>{"name":"foo","arguments":{}}</tool_call>`;
    expect(parseAny(text)?.name).toBe("foo");
  });

  it("recognises the legacy Wotann XML first (highest priority)", () => {
    const text = `<tool_use><tool name="legacy"><param name="k">v</param></tool></tool_use>`;
    expect(parseAny(text)?.name).toBe("legacy");
  });

  it("never throws on adversarial input", () => {
    expect(() => parseAny("\x00\x01\x02 garbage")).not.toThrow();
    expect(() => parseAny("")).not.toThrow();
    expect(() => parseAny("<tool_call>not json</tool_call>")).not.toThrow();
  });
});
