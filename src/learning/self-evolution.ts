/**
 * Self-Evolution Engine — WOTANN modifies its own knowledge and behavior.
 *
 * Capabilities:
 * - Update IDENTITY.md, SOUL.md, USER.md based on accumulated learning
 * - Generate and refine skills from successful task patterns
 * - Adjust instinct weights from user corrections
 * - Update MEMORY.md index when new knowledge is captured
 * - Schedule self-improvement tasks via KAIROS heartbeat
 *
 * Safety: All self-modifications are logged to the audit trail.
 * The agent can PROPOSE changes but critical files require review.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────

export interface SelfEvolutionConfig {
  readonly wotannDir: string;
  readonly autoUpdateUser: boolean;    // Auto-update USER.md from corrections
  readonly autoUpdateMemory: boolean;  // Auto-update MEMORY.md index
  readonly autoCreateSkills: boolean;  // Auto-generate skills from patterns
  readonly requireApproval: boolean;   // Require user approval for IDENTITY/SOUL changes
}

export interface EvolutionAction {
  readonly type: "update-user" | "update-identity" | "update-soul" | "update-memory" | "create-skill" | "update-instinct";
  readonly file: string;
  readonly description: string;
  readonly content: string;
  readonly timestamp: number;
  readonly approved: boolean;
}

// ── Self-Evolution Engine ────────────────────────────────

export class SelfEvolutionEngine {
  private readonly config: SelfEvolutionConfig;
  private readonly actionLog: EvolutionAction[] = [];

  constructor(config?: Partial<SelfEvolutionConfig>) {
    const wotannDir = join(homedir(), ".wotann");
    this.config = {
      wotannDir,
      autoUpdateUser: true,
      autoUpdateMemory: true,
      autoCreateSkills: true,
      requireApproval: true, // IDENTITY and SOUL changes require approval by default
      ...config,
    };
  }

  /**
   * Update USER.md with learned preferences from the UserModel.
   * Called after sessions where corrections or preferences were recorded.
   */
  updateUserProfile(preferences: Record<string, string>, corrections: Array<{ before: string; after: string }>): void {
    if (!this.config.autoUpdateUser) return;

    const userPath = join(this.config.wotannDir, "USER.md");
    let content = "# WOTANN User Profile\n\n";
    content += "Auto-populated from session learning.\n\n";

    if (Object.keys(preferences).length > 0) {
      content += "## Preferences\n";
      for (const [key, value] of Object.entries(preferences)) {
        content += `- ${key}: ${value}\n`;
      }
      content += "\n";
    }

    if (corrections.length > 0) {
      content += "## Corrections Learned\n";
      for (const correction of corrections.slice(-20)) { // Keep last 20
        content += `- "${correction.before}" → "${correction.after}"\n`;
      }
      content += "\n";
    }

    content += `\n_Last updated: ${new Date().toISOString()}_\n`;
    writeFileSync(userPath, content);

    this.logAction({
      type: "update-user",
      file: userPath,
      description: `Updated with ${Object.keys(preferences).length} preferences, ${corrections.length} corrections`,
      content,
      timestamp: Date.now(),
      approved: true, // User profile updates are auto-approved
    });
  }

  /**
   * Update MEMORY.md index with current memory stats.
   * Called after autoDream or significant memory operations.
   */
  updateMemoryIndex(stats: { totalEntries: number; layers: Record<string, number> }): void {
    if (!this.config.autoUpdateMemory) return;

    const memPath = join(this.config.wotannDir, "MEMORY.md");
    let content = "# WOTANN Memory Index\n\n";
    content += `Total entries: ${stats.totalEntries}\n\n`;
    content += "## Layers\n";
    for (const [layer, count] of Object.entries(stats.layers)) {
      content += `- ${layer}: ${count} entries\n`;
    }
    content += `\n_Last updated: ${new Date().toISOString()}_\n`;

    writeFileSync(memPath, content);

    this.logAction({
      type: "update-memory",
      file: memPath,
      description: `Updated index: ${stats.totalEntries} total entries`,
      content,
      timestamp: Date.now(),
      approved: true,
    });
  }

  /**
   * Propose an update to IDENTITY.md or SOUL.md.
   * These are critical files — changes are logged but require approval.
   */
  proposeIdentityUpdate(section: "identity" | "soul", reason: string, proposedContent: string): EvolutionAction {
    const file = section === "identity" ? "IDENTITY.md" : "SOUL.md";
    const filePath = join(this.config.wotannDir, file);

    const action: EvolutionAction = {
      type: section === "identity" ? "update-identity" : "update-soul",
      file: filePath,
      description: reason,
      content: proposedContent,
      timestamp: Date.now(),
      approved: !this.config.requireApproval, // Auto-approve only if configured
    };

    this.logAction(action);

    // Only write if auto-approval is enabled (not default)
    if (!this.config.requireApproval) {
      writeFileSync(filePath, proposedContent);
    }

    return action;
  }

  /**
   * Auto-generate a skill file from a successful task pattern.
   * Called by SkillForge when a pattern reaches promotion threshold.
   */
  createSkillFromPattern(
    name: string,
    description: string,
    instructions: string,
    triggers: readonly string[],
  ): void {
    if (!this.config.autoCreateSkills) return;

    const skillsDir = join(this.config.wotannDir, "skills");
    if (!existsSync(skillsDir)) {
      mkdirSync(skillsDir, { recursive: true });
    }

    const skillContent = [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      `paths: [${triggers.map((t) => `"${t}"`).join(", ")}]`,
      "---",
      "",
      instructions,
    ].join("\n");

    const skillPath = join(skillsDir, `${name}.md`);
    writeFileSync(skillPath, skillContent);

    this.logAction({
      type: "create-skill",
      file: skillPath,
      description: `Auto-generated skill: ${name}`,
      content: skillContent,
      timestamp: Date.now(),
      approved: true,
    });
  }

  /**
   * Get the evolution audit log.
   */
  getActionLog(): readonly EvolutionAction[] {
    return [...this.actionLog];
  }

  /**
   * Get pending actions requiring approval.
   */
  getPendingApprovals(): readonly EvolutionAction[] {
    return this.actionLog.filter((a) => !a.approved);
  }

  /**
   * Approve a pending action and apply it.
   */
  approveAction(index: number): boolean {
    const action = this.actionLog[index];
    if (!action || action.approved) return false;

    writeFileSync(action.file, action.content);
    // Create new action with approved = true (immutable update)
    this.actionLog[index] = { ...action, approved: true };
    return true;
  }

  private logAction(action: EvolutionAction): void {
    this.actionLog.push(action);

    // Also append to evolution log file for persistence
    const logPath = join(this.config.wotannDir, "evolution-log.jsonl");
    const logLine = JSON.stringify(action) + "\n";
    try {
      const { appendFileSync } = require("node:fs") as typeof import("node:fs");
      appendFileSync(logPath, logLine);
    } catch {
      // Log file not critical
    }
  }
}
