/**
 * Identity, persona, and 8-file bootstrap system.
 * YAML profiles in .wotann/personas/ define how the agent thinks.
 *
 * 8-FILE BOOTSTRAP ORDER (loaded at session start):
 * 1. AGENTS.md → Agent roster and capabilities
 * 2. TOOLS.md → Available tools and MCP servers
 * 3. SOUL.md → Agent personality and values
 * 4. IDENTITY.md → Agent name, role, communication style
 * 5. USER.md → User preferences, knowledge level
 * 6. HEARTBEAT.md → Recurring tasks and checks
 * 7. LESSONS.md → Accumulated lessons from past sessions
 * 8. RULES.md → Behavioral constraints and coding standards
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { parse as parseYaml } from "yaml";

export interface PersonaConfig {
  readonly name: string;
  readonly description: string;
  readonly priorities: readonly string[];
  readonly communication: readonly string[];
  readonly decisionFramework?: string;
  readonly avoidPatterns?: readonly string[];
}

export interface Identity {
  readonly name: string;
  readonly role: string;
  readonly soul: string;
  readonly persona: PersonaConfig | null;
}

export class PersonaManager {
  private readonly personaDir: string;
  private readonly personas: Map<string, PersonaConfig> = new Map();

  constructor(wotannDir: string) {
    this.personaDir = join(wotannDir, "personas");
    this.loadPersonas();
  }

  private loadPersonas(): void {
    if (!existsSync(this.personaDir)) return;

    for (const file of readdirSync(this.personaDir)) {
      if (extname(file) !== ".yaml" && extname(file) !== ".yml") continue;

      try {
        const content = readFileSync(join(this.personaDir, file), "utf-8");
        const config = parseYaml(content) as PersonaConfig;
        const name = basename(file, extname(file));
        this.personas.set(name, config);
      } catch {
        // Skip invalid persona files
      }
    }
  }

  get(name: string): PersonaConfig | null {
    return this.personas.get(name) ?? null;
  }

  list(): readonly string[] {
    return [...this.personas.keys()];
  }

  formatForPrompt(persona: PersonaConfig): string {
    return [
      `## Active Persona: ${persona.name}`,
      persona.description,
      "",
      `**Priorities:** ${persona.priorities.join(", ")}`,
      `**Communication:** ${persona.communication.join(", ")}`,
      persona.decisionFramework ? `**Decision Framework:** ${persona.decisionFramework}` : "",
      persona.avoidPatterns?.length
        ? `**Avoid:** ${persona.avoidPatterns.join(", ")}`
        : "",
    ].filter(Boolean).join("\n");
  }

  getCount(): number {
    return this.personas.size;
  }
}

export function loadIdentity(wotannDir: string): Identity {
  const soulPath = join(wotannDir, "SOUL.md");
  const identityPath = join(wotannDir, "IDENTITY.md");

  const soul = existsSync(soulPath) ? readFileSync(soulPath, "utf-8") : "";
  const identityContent = existsSync(identityPath) ? readFileSync(identityPath, "utf-8") : "";

  // Extract name from IDENTITY.md
  const nameMatch = identityContent.match(/^## Name\s*\n(.+)/m);
  const roleMatch = identityContent.match(/^## Role\s*\n(.+)/m);

  return {
    name: nameMatch?.[1]?.trim() ?? "WOTANN",
    role: roleMatch?.[1]?.trim() ?? "AI Agent",
    soul,
    persona: null,
  };
}

// ── 8-File Bootstrap System ──────────────────────────────

export interface BootstrapFile {
  readonly name: string;
  readonly filename: string;
  readonly description: string;
  readonly required: boolean;
  readonly order: number;
  readonly content: string;
  readonly loaded: boolean;
}

export interface BootstrapResult {
  readonly files: readonly BootstrapFile[];
  readonly systemPromptSection: string;
  readonly totalTokenEstimate: number;
  readonly loadedCount: number;
  readonly missingRequired: readonly string[];
}

/** 8-file bootstrap order — loaded at session start into system prompt */
const BOOTSTRAP_FILES: readonly { name: string; filename: string; description: string; required: boolean }[] = [
  { name: "agents", filename: "AGENTS.md", description: "Agent roster and capabilities", required: false },
  { name: "tools", filename: "TOOLS.md", description: "Available tools and MCP servers", required: false },
  { name: "soul", filename: "SOUL.md", description: "Agent personality and values", required: false },
  { name: "identity", filename: "IDENTITY.md", description: "Agent name, role, communication style", required: false },
  { name: "user", filename: "USER.md", description: "User preferences, knowledge level", required: false },
  { name: "heartbeat", filename: "HEARTBEAT.md", description: "Recurring tasks and checks", required: false },
  { name: "lessons", filename: "LESSONS.md", description: "Accumulated lessons from past sessions", required: false },
  { name: "rules", filename: "RULES.md", description: "Behavioral constraints and coding standards", required: false },
];

/**
 * Load all 8 bootstrap files in fixed order.
 * Returns their content merged into a single system prompt section.
 */
export function loadBootstrapFiles(wotannDir: string): BootstrapResult {
  const files: BootstrapFile[] = [];
  const missingRequired: string[] = [];
  let totalTokens = 0;

  for (let i = 0; i < BOOTSTRAP_FILES.length; i++) {
    const spec = BOOTSTRAP_FILES[i]!;
    const filePath = join(wotannDir, spec.filename);
    const exists = existsSync(filePath);
    const content = exists ? readFileSync(filePath, "utf-8") : "";

    if (!exists && spec.required) {
      missingRequired.push(spec.filename);
    }

    // Rough token estimate: ~4 chars per token
    totalTokens += Math.ceil(content.length / 4);

    files.push({
      name: spec.name,
      filename: spec.filename,
      description: spec.description,
      required: spec.required,
      order: i + 1,
      content,
      loaded: exists && content.length > 0,
    });
  }

  // Build system prompt section in bootstrap order
  const sections = files
    .filter((f) => f.loaded)
    .map((f) => `<!-- Bootstrap: ${f.filename} -->\n${f.content}`);

  return {
    files,
    systemPromptSection: sections.join("\n\n---\n\n"),
    totalTokenEstimate: totalTokens,
    loadedCount: files.filter((f) => f.loaded).length,
    missingRequired,
  };
}

/**
 * Generate default bootstrap files for a new WOTANN installation.
 */
export function getDefaultBootstrapContent(filename: string, agentName: string = "WOTANN"): string {
  switch (filename) {
    case "IDENTITY.md":
      return [
        `# ${agentName} Identity`,
        "",
        `## Name`,
        agentName,
        "",
        `## Role`,
        "AI Agent Harness — unified coding assistant",
        "",
        "## Communication Style",
        "- Brief and direct",
        "- Technical accuracy over politeness",
        "- Show evidence before assertions",
        "- Use code blocks for technical content",
      ].join("\n");

    case "SOUL.md":
      return [
        `# ${agentName} Soul`,
        "",
        "## Core Values",
        "- Correctness: verify before claiming done",
        "- Efficiency: minimal changes, maximum impact",
        "- Honesty: state uncertainty, don't hallucinate",
        "- Safety: validate inputs, handle errors, no hardcoded secrets",
        "",
        "## Decision Framework",
        "When facing trade-offs: correctness > performance > simplicity > brevity",
      ].join("\n");

    case "USER.md":
      return [
        "# User Profile",
        "",
        "## Preferences",
        "- Immutable data patterns",
        "- Many small files over few large files",
        "- TDD: write tests first",
        "- Research before coding",
        "",
        "## Knowledge Level",
        "- Senior developer",
        "- Familiar with TypeScript, React, Node.js, Python",
      ].join("\n");

    case "HEARTBEAT.md":
      return [
        "# Heartbeat Tasks",
        "",
        "## Every Session Start",
        "- Load memory context",
        "- Check for unfinished tasks",
        "- Review recent git commits",
        "",
        "## Every 25 Tool Calls",
        "- Check context pressure",
        "- Save working state to memory",
        "",
        "## Before Session End",
        "- Save session summary",
        "- Commit any pending changes",
      ].join("\n");

    case "LESSONS.md":
      return [
        "# Accumulated Lessons",
        "",
        "<!-- Automatically updated by dream-cycle and session-end hooks -->",
        "<!-- Format: - [DATE] LESSON (source: SESSION_ID) -->",
        "",
        "No lessons recorded yet.",
      ].join("\n");

    case "RULES.md":
      return [
        "# Behavioral Rules",
        "",
        "## Coding",
        "- Always create new objects, never mutate",
        "- 200-400 lines per file, 800 max",
        "- 80% test coverage minimum",
        "- No hardcoded secrets",
        "",
        "## Process",
        "- CLARIFY → PLAN → ACT",
        "- Evidence before assertions",
        "- Verify completion with test output",
      ].join("\n");

    default:
      return `# ${filename.replace(".md", "")}\n\nAdd content here.\n`;
  }
}

// ── Persona Switching ────────────────────────────────────

export interface PersonaSwitchResult {
  readonly previousPersona: string | null;
  readonly newPersona: string;
  readonly mergedInstructions: string;
}

/**
 * Build a combined system prompt section from identity + persona + bootstrap.
 */
export function buildIdentityPrompt(
  wotannDir: string,
  personaName?: string,
): { identity: Identity; persona: PersonaConfig | null; bootstrap: BootstrapResult; systemPrompt: string } {
  const identity = loadIdentity(wotannDir);
  const personaManager = new PersonaManager(wotannDir);
  const persona = personaName ? personaManager.get(personaName) : null;
  const bootstrap = loadBootstrapFiles(wotannDir);

  const sections: string[] = [];

  // Identity section
  sections.push(`# Agent: ${identity.name} (${identity.role})`);
  if (identity.soul) sections.push(identity.soul);

  // Persona section
  if (persona) {
    sections.push(personaManager.formatForPrompt(persona));
  }

  // Bootstrap files (already ordered)
  if (bootstrap.systemPromptSection) {
    sections.push(bootstrap.systemPromptSection);
  }

  return {
    identity,
    persona,
    bootstrap,
    systemPrompt: sections.join("\n\n---\n\n"),
  };
}
