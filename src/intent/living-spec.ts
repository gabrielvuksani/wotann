/**
 * Living Spec — Augment-Intent-style project spec that evolves alongside code.
 *
 * A living spec is a single source of truth for a project:
 *   - goal: the one-liner (or two) that says what we're building
 *   - scope: in-scope + out-of-scope bullets
 *   - constraints: must-haves + nice-to-haves
 *   - decisionsLog: timestamped append-only log of architectural choices
 *   - glossary: key→definition map for project jargon
 *
 * Persistence: a single `SPEC.md` in the workspace root. Round-trippable
 * to/from markdown. Unknown sections (user-authored) are preserved
 * verbatim in a footer block so users can add freeform notes without the
 * round-trip eating their content.
 *
 * This module is the **data model + file IO** layer. The agent-facing
 * API is tiny on purpose: read / write / append. Higher-level surfaces
 * (CLI, TUI) wrap these primitives.
 *
 * WOTANN quality bars:
 *  - QB #6 honest failures: missing SPEC.md raises `SpecNotFoundError`,
 *    NOT an empty-spec success.
 *  - QB #7 per-call state: no module-global caches; every read hits disk.
 *  - QB #11 scope-bounded: touches SPEC.md only, never writes elsewhere.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────

export interface DecisionEntry {
  readonly timestamp: string; // ISO-8601
  readonly decision: string;
  readonly rationale: string;
}

export interface LivingSpecDoc {
  readonly goal: string;
  readonly scope: readonly string[];
  readonly constraints: readonly string[];
  readonly decisionsLog: readonly DecisionEntry[];
  readonly glossary: Readonly<Record<string, string>>;
  /** Unknown sections captured verbatim so round-trip preserves them. */
  readonly unknownSections?: readonly UnknownSection[];
}

export interface UnknownSection {
  readonly heading: string; // e.g. "## Notes"
  readonly body: string; // raw content without the heading line
}

export interface AddDecisionOptions {
  readonly decision: string;
  readonly rationale: string;
  readonly timestamp?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────

export class SpecNotFoundError extends Error {
  readonly workspaceRoot: string;
  constructor(workspaceRoot: string) {
    super(`SPEC.md not found in ${workspaceRoot}`);
    this.name = "SpecNotFoundError";
    this.workspaceRoot = workspaceRoot;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────

const SPEC_FILENAME = "SPEC.md";
const SCAFFOLD_GOAL = "TBD — describe the one-thing this project is for";

// The canonical section order we emit when writing. Unknown sections are
// appended after these, preserving insertion order from the source file.
const KNOWN_HEADINGS = {
  goal: "## Goal",
  scope: "## Scope",
  constraints: "## Constraints",
  decisions: "## Decisions Log",
  glossary: "## Glossary",
} as const;

// ── Public API ────────────────────────────────────────────────────────────

export function specPath(workspaceRoot: string): string {
  return join(workspaceRoot, SPEC_FILENAME);
}

export function initSpec(workspaceRoot: string): LivingSpecDoc {
  const path = specPath(workspaceRoot);
  if (existsSync(path)) {
    throw new Error(`SPEC.md already exists at ${path}`);
  }
  const doc: LivingSpecDoc = emptyDoc();
  writeSpec(workspaceRoot, doc);
  return doc;
}

export function readSpec(workspaceRoot: string): LivingSpecDoc {
  const path = specPath(workspaceRoot);
  if (!existsSync(path)) {
    throw new SpecNotFoundError(workspaceRoot);
  }
  const raw = readFileSync(path, "utf-8");
  return parseSpec(raw);
}

export function writeSpec(workspaceRoot: string, doc: LivingSpecDoc): void {
  const path = specPath(workspaceRoot);
  const md = renderSpec(doc);
  writeFileSync(path, md, "utf-8");
}

export function addDecision(workspaceRoot: string, opts: AddDecisionOptions): LivingSpecDoc {
  const current = existsSync(specPath(workspaceRoot)) ? readSpec(workspaceRoot) : emptyDoc();
  const entry: DecisionEntry = {
    timestamp: opts.timestamp ?? new Date().toISOString(),
    decision: opts.decision,
    rationale: opts.rationale,
  };
  const next: LivingSpecDoc = {
    ...current,
    decisionsLog: [...current.decisionsLog, entry],
  };
  writeSpec(workspaceRoot, next);
  return next;
}

export function addConstraint(workspaceRoot: string, constraint: string): LivingSpecDoc {
  const current = existsSync(specPath(workspaceRoot)) ? readSpec(workspaceRoot) : emptyDoc();
  if (current.constraints.includes(constraint)) {
    return current;
  }
  const next: LivingSpecDoc = {
    ...current,
    constraints: [...current.constraints, constraint],
  };
  writeSpec(workspaceRoot, next);
  return next;
}

export function addGlossaryTerm(
  workspaceRoot: string,
  term: string,
  definition: string,
): LivingSpecDoc {
  const current = existsSync(specPath(workspaceRoot)) ? readSpec(workspaceRoot) : emptyDoc();
  const next: LivingSpecDoc = {
    ...current,
    glossary: { ...current.glossary, [term]: definition },
  };
  writeSpec(workspaceRoot, next);
  return next;
}

export function getGlossaryTerm(workspaceRoot: string, term: string): string | undefined {
  if (!existsSync(specPath(workspaceRoot))) return undefined;
  const doc = readSpec(workspaceRoot);
  return doc.glossary[term];
}

// ── Parser (markdown → doc) ───────────────────────────────────────────────

function parseSpec(raw: string): LivingSpecDoc {
  const lines = raw.split(/\r?\n/);
  const sections = splitSections(lines);

  const goal = extractGoal(sections);
  const scope = extractBulletList(sections, KNOWN_HEADINGS.scope);
  const constraints = extractBulletList(sections, KNOWN_HEADINGS.constraints);
  const decisionsLog = extractDecisions(sections);
  const glossary = extractGlossary(sections);
  const unknownSections = extractUnknownSections(sections);

  return {
    goal,
    scope,
    constraints,
    decisionsLog,
    glossary,
    ...(unknownSections.length > 0 ? { unknownSections } : {}),
  };
}

interface Section {
  readonly heading: string;
  readonly body: readonly string[];
}

function splitSections(lines: readonly string[]): readonly Section[] {
  const out: Section[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  for (const line of lines) {
    if (/^## /.test(line)) {
      if (currentHeading !== null) {
        out.push({ heading: currentHeading, body: currentBody });
      }
      currentHeading = line.trim();
      currentBody = [];
    } else {
      if (currentHeading !== null) {
        currentBody.push(line);
      }
    }
  }
  if (currentHeading !== null) {
    out.push({ heading: currentHeading, body: currentBody });
  }
  return out;
}

function sectionByHeading(sections: readonly Section[], heading: string): Section | undefined {
  return sections.find((s) => s.heading === heading);
}

function extractGoal(sections: readonly Section[]): string {
  const sec = sectionByHeading(sections, KNOWN_HEADINGS.goal);
  if (!sec) return SCAFFOLD_GOAL;
  const text = sec.body
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n");
  return text.length > 0 ? text : SCAFFOLD_GOAL;
}

function extractBulletList(sections: readonly Section[], heading: string): readonly string[] {
  const sec = sectionByHeading(sections, heading);
  if (!sec) return [];
  const out: string[] = [];
  for (const line of sec.body) {
    const match = line.match(/^\s*[-*]\s+(.+)$/);
    if (match?.[1]) {
      out.push(match[1].trim());
    }
  }
  return out;
}

function extractDecisions(sections: readonly Section[]): readonly DecisionEntry[] {
  const sec = sectionByHeading(sections, KNOWN_HEADINGS.decisions);
  if (!sec) return [];
  const out: DecisionEntry[] = [];
  // Each decision is a bullet of form:
  //   - [<ISO-TS>] <decision> — <rationale>
  // If rationale contains " — " we only split once (first occurrence).
  for (const line of sec.body) {
    const match = line.match(/^\s*[-*]\s+\[([^\]]+)\]\s+(.+?)\s+—\s+(.+)$/);
    if (match?.[1] && match[2] && match[3]) {
      out.push({
        timestamp: match[1],
        decision: match[2].trim(),
        rationale: match[3].trim(),
      });
    }
  }
  return out;
}

function extractGlossary(sections: readonly Section[]): Readonly<Record<string, string>> {
  const sec = sectionByHeading(sections, KNOWN_HEADINGS.glossary);
  if (!sec) return {};
  const out: Record<string, string> = {};
  for (const line of sec.body) {
    // Bullet of form: `- Term: definition`
    const match = line.match(/^\s*[-*]\s+([^:]+):\s+(.+)$/);
    if (match?.[1] && match[2]) {
      out[match[1].trim()] = match[2].trim();
    }
  }
  return out;
}

function extractUnknownSections(sections: readonly Section[]): readonly UnknownSection[] {
  const known = new Set<string>(Object.values(KNOWN_HEADINGS));
  const out: UnknownSection[] = [];
  for (const sec of sections) {
    if (!known.has(sec.heading)) {
      const body = sec.body.join("\n").replace(/\n+$/, "");
      out.push({ heading: sec.heading, body });
    }
  }
  return out;
}

// ── Renderer (doc → markdown) ─────────────────────────────────────────────

function renderSpec(doc: LivingSpecDoc): string {
  const chunks: string[] = [];
  chunks.push("# Project SPEC");
  chunks.push("");
  chunks.push(KNOWN_HEADINGS.goal);
  chunks.push("");
  chunks.push(doc.goal.length > 0 ? doc.goal : SCAFFOLD_GOAL);
  chunks.push("");

  chunks.push(KNOWN_HEADINGS.scope);
  chunks.push("");
  if (doc.scope.length === 0) {
    chunks.push("_(none yet)_");
  } else {
    for (const item of doc.scope) chunks.push(`- ${item}`);
  }
  chunks.push("");

  chunks.push(KNOWN_HEADINGS.constraints);
  chunks.push("");
  if (doc.constraints.length === 0) {
    chunks.push("_(none yet)_");
  } else {
    for (const item of doc.constraints) chunks.push(`- ${item}`);
  }
  chunks.push("");

  chunks.push(KNOWN_HEADINGS.decisions);
  chunks.push("");
  if (doc.decisionsLog.length === 0) {
    chunks.push("_(no decisions recorded)_");
  } else {
    for (const entry of doc.decisionsLog) {
      chunks.push(`- [${entry.timestamp}] ${entry.decision} — ${entry.rationale}`);
    }
  }
  chunks.push("");

  chunks.push(KNOWN_HEADINGS.glossary);
  chunks.push("");
  const terms = Object.keys(doc.glossary);
  if (terms.length === 0) {
    chunks.push("_(no terms)_");
  } else {
    for (const k of terms) {
      chunks.push(`- ${k}: ${doc.glossary[k]}`);
    }
  }
  chunks.push("");

  // Unknown sections last, verbatim
  if (doc.unknownSections && doc.unknownSections.length > 0) {
    for (const sec of doc.unknownSections) {
      chunks.push(sec.heading);
      chunks.push("");
      chunks.push(sec.body);
      chunks.push("");
    }
  }

  return chunks.join("\n");
}

function emptyDoc(): LivingSpecDoc {
  return {
    goal: SCAFFOLD_GOAL,
    scope: [],
    constraints: [],
    decisionsLog: [],
    glossary: {},
  };
}
