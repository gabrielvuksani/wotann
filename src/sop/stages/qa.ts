/**
 * SOP QA stage — runs quality checks on the generated code.
 *
 * Stage 4 of 5. Consumes prior PRD + design + code artifacts; produces
 * a QA report (markdown) describing:
 *   - Static checks: balanced braces/parens, presence of `export`
 *   - Coverage of design.components: every named component appears in code
 *   - Coverage of design.apis: each API path/method is referenced
 *   - File-diff summary: which lines/sections look incomplete
 *   - Final verdict: PASS or FAIL with bulleted issues
 *
 * The QA stage does NOT spawn child processes (no `tsc`, no test runners) —
 * it operates purely on the in-memory artifacts. This keeps the pipeline
 * deterministic and CI-safe. A real test-execution layer is a separate
 * skill the orchestrator can chain after `deploy` if the user opts in.
 *
 * Validation: the artifact must contain a `## Verdict` heading with
 * either `PASS` or `FAIL`. Empty / malformed → invalid → orchestrator
 * retries.
 *
 * QB #6 strict validation; QB #7 per-call (no module globals); QB #13
 * no env reads.
 */

import type { SopArtifact, StageWriter, StageWriterInput, StageWriterResult } from "../types.js";

const QA_SYSTEM_PROMPT = [
  "You are a senior QA engineer. Given a PRD, an architecture (JSON), and generated TypeScript code,",
  "produce a quality report.",
  "",
  "Output a markdown document with EXACTLY these top-level sections:",
  "  # QA Report",
  "  ## Static Checks",
  "  ## Coverage",
  "  ## File Diffs",
  "  ## Verdict",
  "",
  "Constraints:",
  "  - Static Checks: confirm balanced braces/parens, an `export` is present,",
  "    no obvious `any` types, JSDoc on every exported symbol.",
  "  - Coverage: list every component name from design.components and mark",
  "    PRESENT or MISSING based on whether it appears as an export in code.",
  "  - File Diffs: short bullets describing what additional files would be",
  "    needed for a real implementation (tests, fixtures, types) — describe",
  "    in PROSE only; do NOT emit any diff syntax (the orchestrator parses",
  "    this section as text).",
  "  - Verdict: a single line `PASS` or `FAIL`, followed by bulleted blocking issues.",
  "Output ONLY the markdown, no preface or commentary.",
].join("\n");

const REQUIRED_SECTIONS = [
  "# QA Report",
  "## Static Checks",
  "## Coverage",
  "## File Diffs",
  "## Verdict",
] as const;

export const qaWriter: StageWriter = {
  stage: "qa",
  writeArtifact: async (input: StageWriterInput): Promise<StageWriterResult> => {
    const prd = input.priorArtifacts.find((a) => a.stage === "prd");
    const design = input.priorArtifacts.find((a) => a.stage === "design");
    const code = input.priorArtifacts.find((a) => a.stage === "code");
    if (!prd || !design || !code) {
      return {
        ok: false,
        error: "qa stage requires PRD + design + code artifacts upstream",
      };
    }

    const localChecks = staticChecksReport(code.content, design.content);

    const prompt = [
      QA_SYSTEM_PROMPT,
      "",
      `Idea: ${input.idea}`,
      "",
      "PRD (truncated):",
      prd.content.slice(0, 3000),
      "",
      "Design (truncated):",
      design.content.slice(0, 3000),
      "",
      "Generated Code (truncated):",
      code.content.slice(0, 4000),
      "",
      "Pre-computed static checks (use as input — DO NOT re-derive numerically):",
      localChecks,
    ].join("\n");

    let resp;
    try {
      resp = await input.model.query(prompt, { maxTokens: 2500 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `qa model failure: ${msg}` };
    }

    const validation = validateQaReport(resp.text);
    const artifact: SopArtifact = {
      stage: "qa",
      filename: "qa-report.md",
      contentType: "markdown",
      content: resp.text.trim(),
      validation,
      tokensIn: resp.tokensIn,
      tokensOut: resp.tokensOut,
      createdAt: Date.now(),
    };
    return { ok: true, artifact };
  },
};

/**
 * Pure static checks on the generated code + design alignment. Used to
 * feed the QA prompt with deterministic data so the model isn't
 * forced to re-count braces. Returns a multi-line markdown string.
 *
 * Per-call, no shared state.
 */
export function staticChecksReport(code: string, designJson: string): string {
  const lines: string[] = [];
  const openBraces = (code.match(/\{/g) ?? []).length;
  const closeBraces = (code.match(/\}/g) ?? []).length;
  const openParens = (code.match(/\(/g) ?? []).length;
  const closeParens = (code.match(/\)/g) ?? []).length;
  const exportMatches = code.match(/\bexport\b/g);
  const exportCount = exportMatches ? exportMatches.length : 0;
  const anyTypeMatches = code.match(/\bany\b/g);
  const anyTypeCount = anyTypeMatches ? anyTypeMatches.length : 0;
  lines.push(
    `- braces: open=${openBraces} close=${closeBraces} balanced=${openBraces === closeBraces}`,
  );
  lines.push(
    `- parens: open=${openParens} close=${closeParens} balanced=${openParens === closeParens}`,
  );
  lines.push(`- exports: ${exportCount}`);
  lines.push(`- \`any\` occurrences: ${anyTypeCount}`);

  // Component coverage — defensive parsing per QB #6.
  const components = extractComponentNames(designJson);
  if (components === null) {
    lines.push(`- component-coverage: skipped (design JSON unparseable)`);
  } else {
    lines.push(`- declared components: ${components.length}`);
    for (const name of components) {
      const present = exportReferences(code, name);
      lines.push(`  - ${name}: ${present ? "PRESENT" : "MISSING"}`);
    }
  }
  return lines.join("\n");
}

/**
 * Defensive design.json parser. Returns null when the artifact is not
 * parseable (caller treats null as "skip coverage check"). Empty array
 * means parseable but no components declared.
 */
export function extractComponentNames(designJson: string): readonly string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(designJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const components = obj["components"];
  if (!Array.isArray(components)) return null;
  const names: string[] = [];
  for (const c of components) {
    if (typeof c !== "object" || c === null) continue;
    const name = (c as Record<string, unknown>)["name"];
    if (typeof name === "string" && name.length > 0) names.push(name);
  }
  return names;
}

/**
 * Cheap heuristic for "does the code expose a top-level export named
 * `<name>`". We search for `export class <name>`, `export function <name>`,
 * `export const <name>`, and `export { <name> }`. Word-boundary safe.
 */
export function exportReferences(code: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\bexport\\s+class\\s+${escaped}\\b`),
    new RegExp(`\\bexport\\s+function\\s+${escaped}\\b`),
    new RegExp(`\\bexport\\s+const\\s+${escaped}\\b`),
    new RegExp(`\\bexport\\s+let\\s+${escaped}\\b`),
    new RegExp(`\\bexport\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}`),
    new RegExp(`\\bexport\\s+default\\s+${escaped}\\b`),
  ];
  for (const re of patterns) {
    if (re.test(code)) return true;
  }
  return false;
}

/**
 * Strict validator. The artifact must contain every required section
 * AND a verdict of PASS or FAIL. Per QB #6 we never silently treat
 * malformed reports as success.
 */
export function validateQaReport(text: string): SopArtifact["validation"] {
  const errors: string[] = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!text.includes(section)) {
      errors.push(`missing section: ${section}`);
    }
  }

  // Verdict must contain PASS or FAIL on its own line.
  const verdictIdx = text.indexOf("## Verdict");
  if (verdictIdx >= 0) {
    const verdictBlock = text.slice(verdictIdx);
    const m = verdictBlock.match(/^\s*(PASS|FAIL)\s*$/m);
    if (!m) {
      errors.push("Verdict section must contain a line with PASS or FAIL");
    }
  }
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

/**
 * Inspect a generated QA report and tell the orchestrator whether the
 * whole pipeline should continue. Returns `pass` only when the verdict
 * is PASS AND the artifact validates. Returns `block` with a reason
 * otherwise. Per-call, no shared state.
 */
export function qaVerdictDecision(
  artifact: SopArtifact,
): { kind: "pass" } | { kind: "block"; reason: string } {
  if (artifact.stage !== "qa") {
    return { kind: "block", reason: `expected qa artifact, got ${artifact.stage}` };
  }
  if (!artifact.validation.valid) {
    return {
      kind: "block",
      reason: `qa validation failed: ${artifact.validation.errors.join(", ")}`,
    };
  }
  const m = artifact.content.match(/^\s*(PASS|FAIL)\s*$/m);
  if (!m) {
    return { kind: "block", reason: "qa report missing PASS/FAIL line" };
  }
  if (m[1] === "FAIL") {
    return { kind: "block", reason: "qa verdict was FAIL" };
  }
  return { kind: "pass" };
}
