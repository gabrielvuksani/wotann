/**
 * SOP design writer — produces an architecture spec (markdown + JSON schema).
 *
 * Stage 2 of 5. Consumes the PRD and emits a JSON design document with:
 *   - components: array of {name, role, exposes}
 *   - dataModel: array of {entity, fields, relations}
 *   - apis: array of {path, method, requestBody?, responseBody}
 *
 * Validation: artifact must be JSON-parseable with all 3 required keys.
 */

import type { SopArtifact, StageWriter, StageWriterInput, StageWriterResult } from "../types.js";

const DESIGN_SYSTEM_PROMPT = [
  "You are a senior software architect. Given a PRD, produce a design document as JSON.",
  "",
  "Output a SINGLE JSON object with these top-level keys:",
  '  "components": [{ "name": string, "role": string, "exposes": string[] }]',
  '  "dataModel":  [{ "entity": string, "fields": [{ "name": string, "type": string }], "relations": string[] }]',
  '  "apis":       [{ "path": string, "method": string, "requestBody"?: string, "responseBody": string }]',
  "",
  "Wrap the JSON in a ```json fenced code block. Output NOTHING else.",
].join("\n");

export const designWriter: StageWriter = {
  stage: "design",
  writeArtifact: async (input: StageWriterInput): Promise<StageWriterResult> => {
    const prd = input.priorArtifacts.find((a) => a.stage === "prd");
    if (!prd) {
      return { ok: false, error: "design stage requires PRD artifact upstream" };
    }

    const prompt = [DESIGN_SYSTEM_PROMPT, "", `Idea: ${input.idea}`, "", "PRD:", prd.content].join(
      "\n",
    );

    let resp;
    try {
      resp = await input.model.query(prompt, { maxTokens: 3000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `design model failure: ${msg}` };
    }

    const json = extractJsonBlock(resp.text);
    const validation = validateDesign(json);

    const artifact: SopArtifact = {
      stage: "design",
      filename: "architecture.json",
      contentType: "json",
      content: json ?? resp.text.trim(),
      validation,
      tokensIn: resp.tokensIn,
      tokensOut: resp.tokensOut,
      createdAt: Date.now(),
    };
    return { ok: true, artifact };
  },
};

/**
 * Extract first ```json fenced block. Returns null if not found.
 */
export function extractJsonBlock(text: string): string | null {
  const match = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (match && match[1]) return match[1].trim();
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  return null;
}

/**
 * Validate the design JSON. Strict — missing key or non-array → invalid.
 */
export function validateDesign(json: string | null): SopArtifact["validation"] {
  if (json === null) {
    return { valid: false, errors: ["could not extract JSON block from response"] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, errors: [`JSON parse error: ${msg}`] };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { valid: false, errors: ["root must be a JSON object"] };
  }
  const obj = parsed as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of ["components", "dataModel", "apis"] as const) {
    if (!Array.isArray(obj[key])) {
      errors.push(`'${key}' must be an array`);
    } else if ((obj[key] as readonly unknown[]).length === 0) {
      errors.push(`'${key}' must not be empty`);
    }
  }
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}
