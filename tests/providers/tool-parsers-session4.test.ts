import { describe, it, expect } from "vitest";
import {
  parseMistralAll,
  parseCommandRAll,
  parseJambaAll,
  parseDeepSeekAll,
  parseToolCalls,
  resolveParser,
  parseLlama,
  parseQwen,
  parseDeepSeek,
  parseMistral,
} from "../../src/providers/tool-parsers/index.js";

// Session-4 regression guards for Opus Agent 3's 9 findings.
// Each test either (a) would have failed before the fix and passes
// after, or (b) pins a behavior the fix preserves.

describe("parser multi-call shape (Agent 3 CRITICAL #1)", () => {
  describe("parseMistralAll", () => {
    it("returns all calls when Mistral emits multi-call array", () => {
      const text =
        '[TOOL_CALLS][{"name":"get_weather","arguments":{"city":"NY"}},{"name":"get_weather","arguments":{"city":"SF"}}]';
      const calls = parseMistralAll(text);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual({ name: "get_weather", args: { city: "NY" } });
      expect(calls[1]).toEqual({ name: "get_weather", args: { city: "SF" } });
    });

    it("handles single-call array as 1-element result", () => {
      const text = '[TOOL_CALLS][{"name":"f","arguments":{"x":1}}]';
      const calls = parseMistralAll(text);
      expect(calls).toHaveLength(1);
    });

    it("preserves back-compat parseMistral single-return", () => {
      const text =
        '[TOOL_CALLS][{"name":"a","arguments":{}},{"name":"b","arguments":{}}]';
      const first = parseMistral(text);
      expect(first?.name).toBe("a");
    });
  });

  describe("parseCommandRAll", () => {
    it("returns all calls when Command-R+ emits multi-call array", () => {
      const text =
        'Action: ```json\n[{"tool_name":"search","parameters":{"q":"a"}},{"tool_name":"search","parameters":{"q":"b"}}]\n```';
      const calls = parseCommandRAll(text);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.name).toBe("search");
      expect(calls[1]?.args).toEqual({ q: "b" });
    });
  });

  describe("parseJambaAll", () => {
    it("accepts bare <tool_call> without outer <tool_calls> wrapper (Agent 3 CRITICAL #3)", () => {
      const text =
        "<tool_call><name>f</name><arguments>{\"x\":1}</arguments></tool_call>";
      const calls = parseJambaAll(text);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ name: "f", args: { x: 1 } });
    });

    it("accepts wrapped multi-call", () => {
      const text =
        "<tool_calls>" +
        "<tool_call><name>a</name><arguments>{}</arguments></tool_call>" +
        "<tool_call><name>b</name><arguments>{}</arguments></tool_call>" +
        "</tool_calls>";
      const calls = parseJambaAll(text);
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.name)).toEqual(["a", "b"]);
    });

    it("decodes XML entities inside arguments (Agent 3 CRITICAL #4)", () => {
      const text =
        "<tool_call><name>render</name><arguments>{&quot;text&quot;:&quot;&lt;tag&gt;&quot;}</arguments></tool_call>";
      const calls = parseJambaAll(text);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toEqual({ text: "<tag>" });
    });
  });

  describe("parseDeepSeekAll", () => {
    it("accepts inline JSON WITHOUT code fence (Agent 3 CRITICAL #2)", () => {
      // V3 distilled/Instruct variants emit sep-form inline, no code fence.
      const text =
        "<｜tool▁call▁begin｜>function<｜tool▁sep｜>get_time\n{\"tz\":\"UTC\"}<｜tool▁call▁end｜>";
      const calls = parseDeepSeekAll(text);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ name: "get_time", args: { tz: "UTC" } });
    });

    it("still accepts fenced JSON (back-compat)", () => {
      const text =
        "<｜tool▁call▁begin｜>function<｜tool▁sep｜>f\n```json\n{\"x\":1}\n```<｜tool▁call▁end｜>";
      const calls = parseDeepSeekAll(text);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toEqual({ x: 1 });
    });

    it("accepts multi-call sep-form", () => {
      const text =
        "<｜tool▁call▁begin｜>function<｜tool▁sep｜>a\n{}<｜tool▁call▁end｜>" +
        "<｜tool▁call▁begin｜>function<｜tool▁sep｜>b\n{}<｜tool▁call▁end｜>";
      const calls = parseDeepSeekAll(text);
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.name)).toEqual(["a", "b"]);
    });

    it("accepts bare name-in-JSON format (Agent 3 HIGH #6)", () => {
      // Distilled / Instruct variants sometimes emit raw JSON with name field.
      const text = '{"name":"my_fn","arguments":{"a":1}}';
      const parsed = parseDeepSeek(text);
      expect(parsed).toEqual({ name: "my_fn", args: { a: 1 } });
    });
  });

  describe("parseToolCalls dispatcher", () => {
    it("dispatches multi-call parsers correctly", () => {
      const text =
        '[TOOL_CALLS][{"name":"a","arguments":{}},{"name":"b","arguments":{}}]';
      const calls = parseToolCalls(text, "mistral-large");
      expect(calls).toHaveLength(2);
    });

    it("wraps single-call parsers in 0-or-1 array", () => {
      const text = '<tool_call>{"name":"f","arguments":{}}</tool_call>';
      const calls = parseToolCalls(text, "hermes-3");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.name).toBe("f");
    });

    it("empty result on no-match", () => {
      expect(parseToolCalls("just text", "mistral-large")).toEqual([]);
    });
  });
});

describe("provider prefix stripping (Agent 3 CRITICAL #5)", () => {
  it("strips openrouter/ prefix so family dispatch reaches parseLlama", () => {
    const parser = resolveParser("openrouter/meta-llama/llama-3.3-70b");
    expect(parser).toBe(parseLlama);
  });

  it("strips litellm/ prefix", () => {
    const parser = resolveParser("litellm/deepseek-v3");
    expect(parser).toBe(parseDeepSeek);
  });

  it("strips together_ai/ prefix with nested vendor", () => {
    const parser = resolveParser("together_ai/mistralai/mistral-large");
    expect(parser).toBe(parseMistral);
  });

  it("accepts bare model name (no prefix)", () => {
    const parser = resolveParser("mistral-large");
    expect(parser).toBe(parseMistral);
  });
});

describe("Qwen pattern (Agent 3 HIGH #7)", () => {
  it("matches qwen3-coder (was previously falling through to parseAny)", () => {
    const parser = resolveParser("qwen3-coder");
    expect(parser).toBe(parseQwen);
  });

  it("matches qwen3-coder-32b", () => {
    const parser = resolveParser("qwen3-coder-32b");
    expect(parser).toBe(parseQwen);
  });

  it("matches qwen2.5-coder (existing, preserved)", () => {
    const parser = resolveParser("qwen2.5-coder:7b");
    expect(parser).toBe(parseQwen);
  });
});
