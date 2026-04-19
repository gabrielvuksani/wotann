import { describe, it, expect } from "vitest";
import {
  compileTemplate,
  previewTemplate,
} from "../../src/prompt/template-compiler.js";

describe("simple variable interpolation", () => {
  it("renders {{name}}", () => {
    const t = compileTemplate<{ name: string }>("Hello {{name}}!");
    expect(t.render({ name: "World" })).toBe("Hello World!");
  });

  it("multiple variables", () => {
    const t = compileTemplate<{ a: string; b: string }>("{{a}} + {{b}}");
    expect(t.render({ a: "1", b: "2" })).toBe("1 + 2");
  });

  it("strict mode throws on missing var", () => {
    const t = compileTemplate<Record<string, string>>("Hi {{name}}", {
      strict: true,
    });
    expect(() => t.render({})).toThrow(/missing/);
  });

  it("non-strict emits empty on missing var", () => {
    const t = compileTemplate<Record<string, string>>("Hi {{name}}");
    expect(t.render({})).toBe("Hi ");
  });

  it("default value when var missing", () => {
    const t = compileTemplate<Record<string, string>>("Hi {{name | stranger}}");
    expect(t.render({})).toBe("Hi stranger");
    expect(t.render({ name: "Ada" })).toBe("Hi Ada");
  });
});

describe("conditionals", () => {
  it("{{#if cond}}...{{/if}}", () => {
    const t = compileTemplate<{ show: boolean }>("A{{#if show}}B{{/if}}C");
    expect(t.render({ show: true })).toBe("ABC");
    expect(t.render({ show: false })).toBe("AC");
  });

  it("truthy check works on strings", () => {
    const t = compileTemplate<{ name: string }>("{{#if name}}hi {{name}}{{/if}}");
    expect(t.render({ name: "" })).toBe("");
    expect(t.render({ name: "x" })).toBe("hi x");
  });

  it("nested conditionals", () => {
    const t = compileTemplate<{ a: boolean; b: boolean }>(
      "{{#if a}}X{{#if b}}Y{{/if}}Z{{/if}}",
    );
    expect(t.render({ a: true, b: true })).toBe("XYZ");
    expect(t.render({ a: true, b: false })).toBe("XZ");
    expect(t.render({ a: false, b: true })).toBe("");
  });
});

describe("loops", () => {
  it("{{#each items}}{{this}}{{/each}}", () => {
    const t = compileTemplate<{ items: string[] }>("[{{#each items}}{{this}},{{/each}}]");
    expect(t.render({ items: ["a", "b", "c"] })).toBe("[a,b,c,]");
  });

  it("empty loop produces empty", () => {
    const t = compileTemplate<{ items: string[] }>("A{{#each items}}X{{/each}}B");
    expect(t.render({ items: [] })).toBe("AB");
  });

  it("loop accesses outer scope too", () => {
    const t = compileTemplate<{ items: string[]; prefix: string }>(
      "{{#each items}}{{prefix}}:{{this}} {{/each}}",
    );
    expect(t.render({ items: ["a", "b"], prefix: "P" })).toBe("P:a P:b ");
  });
});

describe("variable analysis", () => {
  it("detects all variables", () => {
    const t = compileTemplate("{{a}} {{b | default}} {{#if c}}X{{/if}}");
    const names = t.variables.map((v) => v.name).sort();
    expect(names).toEqual(["a", "b", "c"]);
  });

  it("flags required vs optional correctly", () => {
    const t = compileTemplate("{{required}} {{optional | fallback}}");
    const req = t.variables.find((v) => v.name === "required");
    const opt = t.variables.find((v) => v.name === "optional");
    expect(req?.required).toBe(true);
    expect(opt?.required).toBe(false);
    expect(opt?.defaultValue).toBe("fallback");
  });

  it("flags variables in conditionals/loops as not required", () => {
    const t = compileTemplate("{{#if x}}{{y}}{{/if}}");
    const y = t.variables.find((v) => v.name === "y");
    expect(y?.inConditional).toBe(true);
    expect(y?.required).toBe(false);
  });
});

describe("previewTemplate", () => {
  it("renders with placeholder values", () => {
    const t = compileTemplate<{ name: string; age: number }>("Hi {{name}}, age {{age}}");
    const preview = previewTemplate(t);
    expect(preview).toContain("<name>");
    expect(preview).toContain("<age>");
  });

  it("uses defaults when present", () => {
    const t = compileTemplate("Hi {{name | friend}}");
    expect(previewTemplate(t)).toBe("Hi friend");
  });
});

describe("edge cases", () => {
  it("text without variables is pass-through", () => {
    const t = compileTemplate("just plain text");
    expect(t.render({})).toBe("just plain text");
  });

  it("empty template", () => {
    const t = compileTemplate("");
    expect(t.render({})).toBe("");
  });

  it("unclosed {{ is treated as literal text", () => {
    const t = compileTemplate("hello {{name");
    expect(t.render({ name: "x" })).toBe("hello {{name");
  });
});
