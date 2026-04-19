import { describe, it, expect } from "vitest";
import {
  parseAdversarialResponse,
  buildTestFileContent,
  createLlmAdversarialGenerator,
  runAdversarialTests,
  type AdversarialTestGenerator,
  type AdversarialTest,
} from "../../src/intelligence/adversarial-test-generator.js";

describe("parseAdversarialResponse", () => {
  it("extracts tests from ```json fenced block", () => {
    const raw = `Sure, here are 2 tests:

\`\`\`json
{
  "tests": [
    {
      "name": "empty_array",
      "rationale": "Missing null-check on line 5.",
      "code": "it('empty_array', () => { expect(fn([])).toBe(0); });"
    },
    {
      "name": "negative_num",
      "rationale": "Signed overflow possible.",
      "code": "it('negative_num', () => { expect(fn(-1)).toBe(1); });"
    }
  ]
}
\`\`\``;
    const tests = parseAdversarialResponse(raw);
    expect(tests).toHaveLength(2);
    expect(tests[0]?.name).toBe("empty_array");
    expect(tests[1]?.name).toBe("negative_num");
  });

  it("accepts bare JSON (no fence)", () => {
    const raw = `{"tests": [{"name": "t1", "rationale": "x", "code": "it('x', () => {});"}]}`;
    expect(parseAdversarialResponse(raw)).toHaveLength(1);
  });

  it("returns empty on garbage", () => {
    expect(parseAdversarialResponse("not json at all")).toEqual([]);
    expect(parseAdversarialResponse("")).toEqual([]);
  });

  it("skips tests missing required fields", () => {
    const raw = `{"tests": [
      {"name": "ok", "rationale": "r", "code": "c"},
      {"name": "", "rationale": "r", "code": "c"},
      {"rationale": "r", "code": "c"},
      {"name": "no_code", "rationale": "r"},
      {"name": "no_rationale", "code": "c"}
    ]}`;
    const tests = parseAdversarialResponse(raw);
    expect(tests).toHaveLength(1);
    expect(tests[0]?.name).toBe("ok");
  });

  it("dedupes by name", () => {
    const raw = `{"tests": [
      {"name": "dup", "rationale": "r", "code": "c1"},
      {"name": "dup", "rationale": "r", "code": "c2"}
    ]}`;
    const tests = parseAdversarialResponse(raw);
    expect(tests).toHaveLength(1);
    expect(tests[0]?.code).toBe("c1"); // first wins
  });

  it("brace-balanced fallback when JSON.parse fails", () => {
    // Trailing text after the last brace — JSON.parse would choke; our
    // brace-balanced fallback should recover.
    const raw = `Before the object we have stuff, {"tests":[{"name":"x","rationale":"r","code":"c"}]}and trailing junk`;
    const tests = parseAdversarialResponse(raw);
    expect(tests).toHaveLength(1);
  });
});

describe("buildTestFileContent", () => {
  const sampleTests: AdversarialTest[] = [
    { name: "a", code: "it('a', () => { expect(1).toBe(1); });", rationale: "r" },
    { name: "b", code: "it('b', () => { expect(2).toBe(2); });", rationale: "r" },
  ];

  it("wraps TypeScript tests in describe block with vitest import", () => {
    const content = buildTestFileContent(sampleTests, "typescript");
    expect(content).toContain("import { describe, it, expect }");
    expect(content).toContain('describe("adversarial"');
    expect(content).toContain("it('a'");
    expect(content).toContain("it('b'");
  });

  it("accepts custom header", () => {
    const content = buildTestFileContent(sampleTests, "typescript", "// custom header");
    expect(content).toMatch(/^\/\/ custom header/);
  });

  it("emits python bodies without describe wrapper", () => {
    const pyTests: AdversarialTest[] = [
      { name: "t1", code: "def test_t1():\n    assert 1 == 1", rationale: "r" },
    ];
    const content = buildTestFileContent(pyTests, "python");
    expect(content).toContain("def test_t1");
    expect(content).not.toContain("describe");
  });
});

describe("createLlmAdversarialGenerator", () => {
  it("invokes query, parses response, limits to count", async () => {
    let capturedPrompt = "";
    const mockQuery = async (prompt: string) => {
      capturedPrompt = prompt;
      return `\`\`\`json
{"tests": [
  {"name": "t1", "rationale": "r", "code": "c"},
  {"name": "t2", "rationale": "r", "code": "c"},
  {"name": "t3", "rationale": "r", "code": "c"},
  {"name": "t4", "rationale": "r", "code": "c"}
]}
\`\`\``;
    };
    const gen = createLlmAdversarialGenerator(mockQuery);
    const out = await gen.generate(
      {
        filePath: "src/foo.ts",
        originalCode: "const x = 1;",
        patchedCode: "const x = 2;",
      },
      3,
    );
    expect(out).toHaveLength(3);
    expect(out[0]?.name).toBe("t1");
    expect(capturedPrompt).toContain("src/foo.ts");
    expect(capturedPrompt).toContain("const x = 1");
    expect(capturedPrompt).toContain("const x = 2");
  });

  it("includes language hint in prompt", async () => {
    let capturedPrompt = "";
    const gen = createLlmAdversarialGenerator(async (p) => {
      capturedPrompt = p;
      return "{}";
    });
    await gen.generate(
      {
        filePath: "a.py",
        originalCode: "",
        patchedCode: "",
        language: "python",
      },
      1,
    );
    expect(capturedPrompt).toContain("pytest");
  });

  it("returns empty when query returns garbage", async () => {
    const gen = createLlmAdversarialGenerator(async () => "I cannot do this");
    const out = await gen.generate(
      { filePath: "a.ts", originalCode: "", patchedCode: "" },
      3,
    );
    expect(out).toEqual([]);
  });
});

describe("runAdversarialTests integration", () => {
  it("short-circuits when generator returns zero tests", async () => {
    const mockGen: AdversarialTestGenerator = {
      generate: async () => [],
    };
    const result = await runAdversarialTests(
      { filePath: "x.ts", originalCode: "", patchedCode: "" },
      {
        workDir: process.cwd(),
        testFilePath: "/tmp/does-not-matter.test.ts",
        testCommand: ["node", "-e", "process.exit(0)"],
        generator: mockGen,
      },
    );
    expect(result.tests).toHaveLength(0);
    expect(result.passed).toBe(0);
    expect(result.passRate).toBe(0);
    expect(result.stderr).toContain("zero tests");
  });
});
