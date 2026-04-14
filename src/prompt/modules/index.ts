/**
 * Dynamic Prompt Module System — 16 independent modules assembled at runtime.
 * OpenClaw + Claude Code pattern: each module checks context, returns empty when unused.
 *
 * Total budget: ~1,540 tokens for the entire self-awareness context.
 * Modules sorted by priority (highest first), empty modules excluded at zero cost.
 */

import type { PromptContext, PromptModuleEntry } from "../engine.js";

// ── Import all 16 modules ──────────────────────────────────

import { identityPromptModule } from "./identity.js";
import { toolsPromptModule } from "./tools.js";
import { skillsPromptModule } from "./skills.js";
import { capabilitiesPromptModule } from "./capabilities.js";
import { memoryPromptModule } from "./memory.js";
import { projectPromptModule } from "./project.js";
import { userPromptModule } from "./user.js";
import { surfacesPromptModule } from "./surfaces.js";
import { phonePromptModule } from "./phone.js";
import { costPromptModule } from "./cost.js";
import { modePromptModule } from "./mode.js";
import { channelsPromptModule } from "./channels.js";
import { safetyPromptModule } from "./safety.js";
import { conventionsModule } from "./conventions.js";
import { historyPromptModule } from "./history.js";
import { securityPromptModule } from "./security.js";
import { llmsTxtPromptModule } from "./llms-txt.js";

// ── Re-export types for convenience ────────────────────────

export type { PromptContext, PromptModuleEntry };

/** Backward-compatible alias for PromptModuleEntry */
export type PromptModule = PromptModuleEntry;

// ── Module Registry ────────────────────────────────────────

const ALL_MODULES: readonly PromptModuleEntry[] = [
  identityPromptModule,      // 100 - "You are WOTANN..."
  capabilitiesPromptModule,  //  95 - native vs emulated capabilities
  toolsPromptModule,         //  92 - available tools
  projectPromptModule,       //  90 - working dir, git branch
  modePromptModule,          //  88 - current mode description
  surfacesPromptModule,      //  85 - connected devices (CLI/Desktop/iOS)
  phonePromptModule,         //  82 - iOS phone capabilities
  costPromptModule,          //  80 - session cost, budget
  userPromptModule,          //  75 - user preferences
  llmsTxtPromptModule,       //  72 - llms.txt AI-readable project docs
  memoryPromptModule,        //  70 - relevant memories
  skillsPromptModule,        //  65 - available skills
  safetyPromptModule,        //  60 - guardrails
  securityPromptModule,      //  58 - exploit mode (MITRE ATT&CK, tools)
  conventionsModule,         //  55 - project coding conventions
  channelsPromptModule,      //  50 - active messaging channels
  historyPromptModule,       //  45 - session history summary
];

// ── Module Context (simplified adapter) ────────────────────

export interface ModuleContext {
  readonly isMinimal: boolean;
  readonly provider: string;
  readonly model: string;
  readonly contextWindow: number;
  readonly workingDir: string;
  readonly sessionId: string;
  readonly mode: string;
  readonly connectedSurfaces: readonly string[];
  readonly phoneConnected: boolean;
  readonly sessionCost: number;
  readonly budgetRemaining: number;
  readonly activeChannels: readonly string[];
  readonly gitBranch?: string;
  readonly recentFiles?: readonly string[];
  readonly userContext?: string;
  readonly memoryContext?: string;
  readonly skillNames?: readonly string[];
  readonly activeAgents?: number;
}

/**
 * Convert a ModuleContext (used by AppShell) to PromptContext (used by modules).
 */
function toPromptContext(ctx: ModuleContext): PromptContext {
  return {
    provider: ctx.provider,
    model: ctx.model,
    contextWindow: ctx.contextWindow,
    workingDir: ctx.workingDir,
    sessionId: ctx.sessionId,
    mode: ctx.mode,
    sessionCost: ctx.sessionCost,
    budgetRemaining: ctx.budgetRemaining,
    connectedSurfaces: ctx.connectedSurfaces,
    phoneConnected: ctx.phoneConnected,
    activeChannels: ctx.activeChannels,
    gitBranch: ctx.gitBranch,
    recentFiles: ctx.recentFiles,
    userContext: ctx.userContext,
    memoryContext: ctx.memoryContext,
    skillNames: ctx.skillNames,
    activeAgents: ctx.activeAgents !== undefined ? [`${ctx.activeAgents} active`] : undefined,
  };
}

// ── Assembly Functions ─────────────────────────────────────

/**
 * Assemble all prompt modules into a single system prompt section.
 * Modules sorted by priority (highest first). Empty modules excluded.
 */
export function assemblePromptModules(context: ModuleContext): string {
  const promptCtx = toPromptContext(context);
  return [...ALL_MODULES]
    .sort((a, b) => b.priority - a.priority)
    .map((m) => {
      const lines = m.build(promptCtx);
      return lines.length > 0 ? lines.join("\n") : "";
    })
    .filter((text) => text.length > 0)
    .join("\n\n");
}

/**
 * Get the list of all available module names.
 */
export function getModuleNames(): readonly string[] {
  return ALL_MODULES.map((m) => m.name);
}

/**
 * Estimate token count of assembled modules.
 */
export function estimateModuleTokens(context: ModuleContext): number {
  const text = assemblePromptModules(context);
  return Math.ceil(text.length / 4);
}
