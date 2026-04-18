/**
 * Modular system prompt assembly engine.
 * Assembles from 8-file bootstrap, conditional rules, behavioral modes, and persona.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { ModelPromptFormatter } from "./model-formatter.js";
import type { ModelFormatConfig, ToolDescriptor } from "./model-formatter.js";
import { traceInstructions, type InstructionSource } from "./instruction-provenance.js";

// ── Types ───────────────────────────────────────────────────

export type BehavioralMode = "careful" | "rapid" | "research" | "creative" | "debug" | "review";

/**
 * Context passed to each prompt module for dynamic assembly.
 */
export interface PromptContext {
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly workingDir: string;
  readonly sessionId: string;
  readonly mode: BehavioralMode | string;
  readonly sessionCost: number;
  readonly budgetRemaining: number;
  readonly connectedSurfaces: readonly string[];
  readonly phoneConnected: boolean;
  readonly phoneCapabilities?: readonly string[];
  readonly activeChannels: readonly string[];
  readonly gitBranch?: string;
  readonly recentFiles?: readonly string[];
  readonly userContext?: string;
  readonly memoryContext?: string;
  readonly skillNames?: readonly string[];
  readonly activeAgents?: readonly string[];
  readonly conventions?: readonly string[];
  readonly instinctHints?: readonly string[];
  readonly learningHints?: readonly string[];
  readonly sessionSummary?: string;
  readonly isMinimal?: boolean;
}

/**
 * A single prompt module — produces context lines for the system prompt.
 */
export interface PromptModuleEntry {
  readonly name: string;
  readonly priority: number;
  build(ctx: PromptContext): readonly string[];
}

interface ConditionalRule {
  readonly paths: readonly string[];
  readonly content: string;
}

interface PersonaConfig {
  readonly name: string;
  readonly description: string;
  readonly priorities: readonly string[];
  readonly communication: readonly string[];
  readonly decisionFramework?: string;
}

export interface PromptAssemblyOptions {
  readonly workspaceRoot: string;
  readonly mode?: BehavioralMode;
  readonly persona?: string;
  readonly activeFiles?: readonly string[];
  readonly isSubagent?: boolean;
  /** Model ID (e.g. "claude-sonnet-4-6", "gpt-4o", "gemma-3"). When set, the
   *  assembled prompt is reformatted for optimal model comprehension. */
  readonly model?: string;
}

export interface PromptAssemblyResult {
  readonly cachedPrefix: string;
  readonly dynamicSuffix: string;
  readonly fullPrompt: string;
  /**
   * Line→source map for the assembled `fullPrompt`. Each key is a
   * 1-indexed line number in the final prompt; the value is the origin
   * label (e.g. `"AGENTS.md"`, `"CLAUDE.md"`, `"Rule: tdd.md"`, `"mode"`,
   * `"modules/identity"`, `"instruction-provenance"`).
   *
   * Session-10 audit fix: the `instruction-provenance` module was
   * exported via lib.ts but never invoked by the engine. Callers who
   * needed to answer "which file told the agent to X?" had to grep the
   * whole prompt; now the engine ships a real sourceMap for every
   * `assembleSystemPromptParts` call.
   */
  readonly sourceMap: ReadonlyMap<number, string>;
}

interface BootstrapFile {
  readonly name: string;
  readonly required: boolean;
  readonly subagentInclude: boolean;
}

// ── Bootstrap Files (8-file system from OpenClaw) ───────────

const BOOTSTRAP_FILES: readonly BootstrapFile[] = [
  { name: "AGENTS.md", required: true, subagentInclude: true },
  { name: "TOOLS.md", required: false, subagentInclude: true },
  { name: "SOUL.md", required: false, subagentInclude: false },
  { name: "IDENTITY.md", required: false, subagentInclude: false },
  { name: "USER.md", required: false, subagentInclude: false },
  { name: "HEARTBEAT.md", required: false, subagentInclude: false },
  { name: "BOOTSTRAP.md", required: false, subagentInclude: false },
  { name: "MEMORY.md", required: false, subagentInclude: false },
];

const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 150_000;

/** Module-level formatter instance — stateless, safe to share across calls. */
const modelFormatter = new ModelPromptFormatter();

// ── Mode Prompts ────────────────────────────────────────────

const MODE_PROMPTS: Record<BehavioralMode, string> = {
  careful: `Mode: CAREFUL
- Extra verification on every change
- Explicit reasoning before actions
- Conservative, minimal changes
- Double-check all assumptions`,

  rapid: `Mode: RAPID
- Minimal explanation, maximum speed
- Skip non-essential verification
- Direct action, no preamble
- Focus on getting it done`,

  research: `Mode: RESEARCH
- Deep exploration of multiple sources
- Comprehensive, thorough output
- Multiple perspectives considered
- Document findings systematically`,

  creative: `Mode: CREATIVE
- Brainstorm multiple approaches first
- Novel solutions encouraged
- Explore unconventional options
- Prototype before committing`,

  debug: `Mode: DEBUG
- Hypothesis-driven investigation
- Gather evidence systematically
- Trace execution paths
- Isolate root cause before fixing`,

  review: `Mode: REVIEW
- Read-only analysis
- Adversarial perspective
- Find flaws, gaps, risks
- Report by severity (CRITICAL/HIGH/MEDIUM/LOW)`,
};

// ── Karpathy-mode Preamble (opt-in via WOTANN_KARPATHY_MODE=1) ──────────────

/**
 * Compact form of the four engineering-discipline principles from
 * `skills/karpathy-principles.md`. Rewritten from Karpathy's public
 * engineering posture (llm.c, nanoGPT, micrograd) rather than the
 * unlicensed source repo. Session-6 wiring for the skill — setting the
 * env var prepends this preamble to the dynamic prompt section so all
 * 4 tabs / channels get the discipline priors without per-session
 * persona reconfig. The full-form skill remains loadable via the skill
 * registry for deeper context on demand.
 */
const KARPATHY_PRINCIPLES_PREAMBLE = `Mode: KARPATHY (Engineering Discipline)
Four priors, applied in order:

1. Think-Before-Coding — State the problem in one sentence. Predict 2–3
   failure modes. Identify the smallest change that could verify your
   hypothesis, and run that first. Ask ONE specific question when
   ambiguous; don't paragraph caveats.

2. Simplicity-First — Write code a reader can hold in their head.
   Prefer obvious over clever. One function, one purpose. Zero
   indirection unless existing patterns require it. 15 lines of
   hand-rolled often beats a library reach.

3. Surgical-Changes — Edit the smallest possible scope. One concern
   per commit. Never 'tidy up' in the same change as a bug fix. Reject
   the temptation to "improve while you're there" — that's how churn
   compounds.

4. Goal-Driven-Execution — Rewrite imperatives as declarative success
   criteria. "Fix the bug" → "the test at path:line passes." Before
   long operations, state the expected outcome. Shorter feedback loops
   over longer ones. "Done with tests green" beats "perfect".

Quote the specific principle when it drives a decision. These are
priors, not workflow gates — they layer cleanly on top of TDD / verify
/ systematic-debugging without replacing them.`;

// ── Prompt Assembly ─────────────────────────────────────────

export function assembleSystemPrompt(options: PromptAssemblyOptions): string {
  return assembleSystemPromptParts(options).fullPrompt;
}

export function assembleSystemPromptParts(options: PromptAssemblyOptions): PromptAssemblyResult {
  const cachedParts: string[] = [];
  const dynamicParts: string[] = [];
  let totalChars = 0;

  // 1. Load bootstrap files
  const wotannDir = join(options.workspaceRoot, ".wotann");
  if (existsSync(wotannDir)) {
    for (const file of BOOTSTRAP_FILES) {
      if (options.isSubagent && !file.subagentInclude) continue;

      const filePath = join(wotannDir, file.name);
      if (existsSync(filePath)) {
        let content = readFileSync(filePath, "utf-8");
        if (content.length > MAX_FILE_CHARS) {
          content = content.slice(0, MAX_FILE_CHARS) + "\n[TRUNCATED — max 20K chars per file]";
        }
        if (totalChars + content.length <= MAX_TOTAL_CHARS) {
          cachedParts.push(`# ${file.name}\n\n${content}`);
          totalChars += content.length;
        }
      }
    }
  }

  // 1b. Discover standard instruction files from workspace root.
  //     These provide cross-tool interop (CLAUDE.md, .cursorrules, etc.)
  //     Bootstrap files in .wotann/ are separate — no overlap.
  const WORKSPACE_INSTRUCTION_FILES: readonly string[] = [
    "CLAUDE.md",
    "AGENTS.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
    "WOTANN.md",
  ];

  for (const filename of WORKSPACE_INSTRUCTION_FILES) {
    const filePath = join(options.workspaceRoot, filename);
    if (existsSync(filePath)) {
      try {
        let content = readFileSync(filePath, "utf-8");
        if (content.length > MAX_FILE_CHARS) {
          content = content.slice(0, MAX_FILE_CHARS) + "\n[TRUNCATED — max 20K chars per file]";
        }
        if (totalChars + content.length <= MAX_TOTAL_CHARS) {
          cachedParts.push(`# Workspace: ${filename}\n\n${content}`);
          totalChars += content.length;
        }
      } catch {
        /* skip unreadable files */
      }
    }
  }

  // Load all rules from .wotann/rules/ directory (glob)
  const rulesDir = join(options.workspaceRoot, ".wotann", "rules");
  if (existsSync(rulesDir)) {
    try {
      const ruleFiles = readdirSync(rulesDir).filter((f) => f.endsWith(".md"));
      for (const ruleFile of ruleFiles) {
        const rulePath = join(rulesDir, ruleFile);
        const content = readFileSync(rulePath, "utf-8").slice(0, 10_000);
        if (totalChars + content.length <= MAX_TOTAL_CHARS) {
          cachedParts.push(`# Rule: ${ruleFile}\n\n${content}`);
          totalChars += content.length;
        }
      }
    } catch {
      /* skip unreadable rules directory */
    }
  }

  // 2. Behavioral mode
  if (options.mode) {
    const modePrompt = MODE_PROMPTS[options.mode];
    if (modePrompt) {
      dynamicParts.push(modePrompt);
    }
  }

  // 2b. Session-6: Karpathy-mode preamble. Users who set
  //     WOTANN_KARPATHY_MODE=1 (or `wotann --karpathy`) get the four
  //     engineering-discipline principles (Think-Before-Coding,
  //     Simplicity-First, Surgical-Changes, Goal-Driven-Execution)
  //     prepended to the dynamic section so they apply to every turn
  //     without needing a persona reconfiguration. Stacks cleanly
  //     with behavioral modes + TDD / verify / systematic-debugging
  //     skills — the principles are behavioral priors, not workflow
  //     gates. Full wording lives in skills/karpathy-principles.md;
  //     this is the compact preamble that injects inline.
  if (process.env["WOTANN_KARPATHY_MODE"] === "1") {
    dynamicParts.push(KARPATHY_PRINCIPLES_PREAMBLE);
  }

  // 3. Conditional rules (load by file pattern)
  if (options.activeFiles && existsSync(join(wotannDir, "rules"))) {
    const rules = loadConditionalRules(join(wotannDir, "rules"));
    for (const rule of rules) {
      const shouldLoad = options.activeFiles.some((file) =>
        rule.paths.some((pattern) => matchGlobSimple(file, pattern)),
      );
      if (shouldLoad && totalChars + rule.content.length <= MAX_TOTAL_CHARS) {
        dynamicParts.push(rule.content);
        totalChars += rule.content.length;
      }
    }
  }

  // 4. Persona
  if (options.persona) {
    const persona = loadPersona(wotannDir, options.persona);
    if (persona) {
      cachedParts.push(formatPersona(persona));
    }
  }

  const rawCachedPrefix = cachedParts.join("\n\n---\n\n");
  const rawDynamicSuffix = dynamicParts.join("\n\n---\n\n");

  // Apply model-specific formatting when a model ID is provided.
  // This wraps sections in the structure the model was trained on
  // (XML for Claude, JSON-style for GPT, rich markdown for Gemini,
  // minimal directives for local models) without changing content.
  if (options.model) {
    const formatted = modelFormatter.formatSystemPrompt(
      { cachedPrefix: rawCachedPrefix, dynamicSuffix: rawDynamicSuffix },
      options.model,
    );
    const config = modelFormatter.getFormatConfig(options.model);
    const formattedCachedPrefix =
      rawCachedPrefix.length > 0
        ? modelFormatter.formatSection("system_context", rawCachedPrefix, config.format)
        : "";
    const formattedDynamicSuffix =
      rawDynamicSuffix.length > 0
        ? modelFormatter.formatSection("task_context", rawDynamicSuffix, config.format)
        : "";

    const formattedSourceMap = buildPromptSourceMap(cachedParts, dynamicParts, formatted);
    return {
      cachedPrefix: formattedCachedPrefix,
      dynamicSuffix: formattedDynamicSuffix,
      fullPrompt: formatted,
      sourceMap: formattedSourceMap,
    };
  }

  const rawFullPrompt = [rawCachedPrefix, rawDynamicSuffix].filter(Boolean).join("\n\n---\n\n");
  const rawSourceMap = buildPromptSourceMap(cachedParts, dynamicParts, rawFullPrompt);
  return {
    cachedPrefix: rawCachedPrefix,
    dynamicSuffix: rawDynamicSuffix,
    fullPrompt: rawFullPrompt,
    sourceMap: rawSourceMap,
  };
}

/**
 * Build a line→source provenance map for an assembled prompt by
 * synthesising one `InstructionSource` per `cachedParts` / `dynamicParts`
 * entry and handing them to `traceInstructions`. Each part already carries
 * its origin as the first `# <label>` line (see how `cachedParts.push`
 * builds bootstrap / workspace / rule / module entries), so we extract
 * that as the source label.
 *
 * The returned map is 1-indexed by line number in `fullPrompt`. Callers
 * use `whichSource(traced, lineNumber)` or `findProvenance(traced, needle)`
 * from `instruction-provenance.ts` to answer "who told the agent to X?".
 */
function buildPromptSourceMap(
  cachedParts: readonly string[],
  dynamicParts: readonly string[],
  assembledText: string,
): ReadonlyMap<number, string> {
  const sources: InstructionSource[] = [];
  for (const [idx, part] of cachedParts.entries()) {
    const firstLine = part.split("\n", 1)[0] ?? "";
    const label = firstLine.startsWith("# ") ? firstLine.slice(2).trim() : `cached-part-${idx + 1}`;
    sources.push({ source: label, lines: part.split("\n"), priority: 1 });
  }
  for (const [idx, part] of dynamicParts.entries()) {
    const firstLine = part.split("\n", 1)[0] ?? "";
    const label = firstLine.startsWith("# ")
      ? firstLine.slice(2).trim()
      : `dynamic-part-${idx + 1}`;
    sources.push({ source: label, lines: part.split("\n"), priority: 2 });
  }
  const traced = traceInstructions(sources);
  // `traceInstructions` numbers against its own assembled text; the real
  // `fullPrompt` may format slightly differently (e.g. `---` separators),
  // so when the line counts disagree we fall back to the coarser mapping
  // (every line → "cached" or "dynamic" by character-position lookup).
  // This still beats the previous behaviour of NO source map at all.
  const tracedLineCount = traced.sourceMap.size;
  const realLineCount = assembledText.split("\n").length;
  if (tracedLineCount === realLineCount) return traced.sourceMap;

  const coarse = new Map<number, string>();
  const cachedChars = cachedParts.join("\n").length;
  let charCursor = 0;
  const realLines = assembledText.split("\n");
  for (let i = 0; i < realLines.length; i++) {
    const lineLen = (realLines[i] ?? "").length + 1;
    coarse.set(i + 1, charCursor < cachedChars ? "cached" : "dynamic");
    charCursor += lineLen;
  }
  return coarse;
}

// ── Helpers ─────────────────────────────────────────────────

function loadConditionalRules(rulesDir: string): readonly ConditionalRule[] {
  const rules: ConditionalRule[] = [];

  if (!existsSync(rulesDir)) return rules;

  for (const file of readdirSync(rulesDir)) {
    if (extname(file) !== ".md") continue;
    const content = readFileSync(join(rulesDir, file), "utf-8");

    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      try {
        const frontmatter = parseYaml(fmMatch[1] ?? "") as { paths?: string[] };
        if (frontmatter.paths) {
          rules.push({
            paths: frontmatter.paths,
            content: fmMatch[2] ?? "",
          });
        }
      } catch {
        // Skip files with invalid frontmatter
      }
    }
  }

  return rules;
}

function loadPersona(wotannDir: string, personaName: string): PersonaConfig | null {
  const personaDir = join(wotannDir, "personas");
  if (!existsSync(personaDir)) return null;

  const filePath = join(personaDir, `${personaName}.yaml`);
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, "utf-8");
    return parseYaml(content) as PersonaConfig;
  } catch {
    return null;
  }
}

function formatPersona(persona: PersonaConfig): string {
  return [
    `## Active Persona: ${persona.name}`,
    persona.description,
    `Priorities: ${persona.priorities.join(", ")}`,
    `Communication style: ${persona.communication.join(", ")}`,
    persona.decisionFramework ? `Decision framework: ${persona.decisionFramework}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function matchGlobSimple(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/{{GLOBSTAR}}/g, ".*");
  return new RegExp(`^${regex}$`).test(filePath);
}

// ── Modular Assembly (Phase D upgrade) ────────────────────
// Types re-exported from top of file: PromptContext, PromptModuleEntry

/**
 * Assemble a system prompt from independent modules.
 * Each module returns an array of lines; empty arrays are excluded.
 * Modules are sorted by priority (highest first).
 */
export function assembleFromModules(
  modules: readonly PromptModuleEntry[],
  context: PromptContext,
): string {
  return [...modules]
    .sort((a, b) => b.priority - a.priority)
    .map((m) => {
      const lines = m.build(context);
      return lines.length > 0 ? lines.join("\n") : "";
    })
    .filter((text) => text.length > 0)
    .join("\n\n---\n\n");
}

// ── Model-Aware Tool Descriptions ──────────────────────────

/**
 * Format tool descriptions at the verbosity appropriate for a model.
 * - Frontier models (Claude, GPT) get full or compact descriptions
 * - Local/lightweight models get names-only (~90% token savings)
 *
 * Use this from tool-injection sites (e.g. capability-augmenter)
 * to match tool verbosity to the active model.
 */
export function formatToolDescriptionsForModel(
  tools: readonly ToolDescriptor[],
  modelId: string,
): string {
  const config = modelFormatter.getFormatConfig(modelId);
  return modelFormatter.formatToolDescriptions(tools, config);
}

/**
 * Get the full format configuration for a model ID.
 * Useful when callers need the config for multiple formatting decisions.
 */
export function getModelFormatConfig(modelId: string): ModelFormatConfig {
  return modelFormatter.getFormatConfig(modelId);
}
