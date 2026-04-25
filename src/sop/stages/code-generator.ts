/**
 * SOP code generator — produces TypeScript source files from the design.
 *
 * Stage 3 of 5. Consumes PRD + design; emits a single TypeScript file
 * containing all component stubs. (Multi-file emission would require
 * writing to disk; we keep it stringy-pure so the test matrix stays deterministic.)
 *
 * Validation: the artifact must contain at least one `export` declaration
 * AND must pass a quick syntax-shape check (no obvious unterminated braces).
 */

import type { SopArtifact, StageWriter, StageWriterInput, StageWriterResult } from "../types.js";

const CODE_SYSTEM_PROMPT = [
  "You are a senior TypeScript engineer. Given a PRD and a JSON design, emit TypeScript source code.",
  "",
  "Constraints:",
  "  - One TypeScript file containing all exports referenced by the design.components[].name.",
  "  - Every component becomes an exported class or function.",
  "  - Each export has a JSDoc describing the component.role.",
  "  - Use strict types (no `any`).",
  "  - Imports only: `node:*` core modules. No third-party deps.",
  "",
  "Wrap the code in a ```typescript fenced block. Output NOTHING else.",
].join("\n");

export const codeGenerator: StageWriter = {
  stage: "code",
  writeArtifact: async (input: StageWriterInput): Promise<StageWriterResult> => {
    const prd = input.priorArtifacts.find((a) => a.stage === "prd");
    const design = input.priorArtifacts.find((a) => a.stage === "design");
    if (!prd || !design) {
      return {
        ok: false,
        error: "code stage requires PRD + design artifacts upstream",
      };
    }

    const prompt = [
      CODE_SYSTEM_PROMPT,
      "",
      `Idea: ${input.idea}`,
      "",
      "PRD:",
      prd.content.slice(0, 4000),
      "",
      "Design:",
      design.content.slice(0, 4000),
    ].join("\n");

    let resp;
    try {
      resp = await input.model.query(prompt, { maxTokens: 4000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `code model failure: ${msg}` };
    }

    const code = extractCodeBlock(resp.text);
    const validation = validateCode(code);

    const artifact: SopArtifact = {
      stage: "code",
      filename: "generated.ts",
      contentType: "typescript",
      content: code ?? resp.text.trim(),
      validation,
      tokensIn: resp.tokensIn,
      tokensOut: resp.tokensOut,
      createdAt: Date.now(),
    };
    return { ok: true, artifact };
  },
};

/**
 * Extract the first ```typescript (or ```ts) fenced block.
 */
export function extractCodeBlock(text: string): string | null {
  const match = text.match(/```(?:typescript|ts)\s*\n([\s\S]*?)\n```/);
  if (match && match[1]) return match[1].trim();
  return null;
}

/**
 * Validate generated code. Strict shape check — no full parse (which would
 * require tsc tooling inside the validator).
 */
export function validateCode(code: string | null): SopArtifact["validation"] {
  if (code === null) {
    return { valid: false, errors: ["could not extract typescript code block"] };
  }
  const errors: string[] = [];
  if (!/\bexport\b/.test(code)) {
    errors.push("code must contain at least one `export` declaration");
  }
  const openBraces = (code.match(/\{/g) ?? []).length;
  const closeBraces = (code.match(/\}/g) ?? []).length;
  if (openBraces !== closeBraces) {
    errors.push(`unbalanced braces: ${openBraces} open vs ${closeBraces} close`);
  }
  const openParens = (code.match(/\(/g) ?? []).length;
  const closeParens = (code.match(/\)/g) ?? []).length;
  if (openParens !== closeParens) {
    errors.push(`unbalanced parens: ${openParens} open vs ${closeParens} close`);
  }
  if (/\bany\b/.test(code) && !/\/\/\s*eslint-disable/.test(code)) {
    errors.push("code contains `any` type — design prompt forbids it");
  }
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}
