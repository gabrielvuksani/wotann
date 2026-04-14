/**
 * Auto-Classifier — Background security classifier for tool calls (Phase E1).
 *
 * Evaluates each tool call before execution with three-tier classification:
 * - Safe actions (small edits, standard commands) -> auto-approve
 * - Moderate actions (large edits, network access) -> log + warn + proceed
 * - Dangerous actions (deletions, untrusted scripts) -> block + ask user
 *
 * Features:
 * - Path-based allowlists and blocklist patterns
 * - Shell injection detection
 * - Credential access detection
 * - Large-scale operation gating (>100 files)
 * - Auto-pause after consecutive or total blocks
 * - Immutable state transitions
 */

// ── Public Types ─────────────────────────────────────────

export interface ClassificationResult {
  readonly action: "allow" | "warn" | "block";
  readonly reason: string;
  readonly risk: "safe" | "moderate" | "dangerous";
  readonly confidence: number;
  readonly category: "safe" | "read-only" | "write" | "destructive" | "network" | "credential" | "unknown";
}

export interface ClassifierConfig {
  readonly enabled: boolean;
  readonly maxConsecutiveBlocks: number;     // Auto-pause after N blocks (default: 3)
  readonly maxTotalBlocks: number;           // Switch to manual mode (default: 20)
  readonly allowedPaths: readonly string[];  // Paths agent can freely edit
  readonly blockedPatterns: readonly string[]; // Always block these (regex strings)
  readonly allowReadOperations: boolean;     // Auto-allow all reads
  readonly allowWriteInProject: boolean;     // Auto-allow writes within project dir
  readonly blockDestructive: boolean;        // Always block rm -rf, drop table, etc.
}

export interface AutoModeState {
  readonly enabled: boolean;
  readonly consecutiveBlocks: number;
  readonly totalBlocks: number;
  readonly totalAllowed: number;
  readonly totalWarns: number;
  readonly paused: boolean;
  readonly pauseReason?: string;
}

// ── Classification Rules ─────────────────────────────────

interface ClassificationRule {
  readonly tool: string;
  readonly risk: ClassificationResult["risk"];
  readonly category: ClassificationResult["category"];
  readonly action: ClassificationResult["action"];
  readonly condition?: (args: string) => boolean;
  readonly description: string;
}

const RULES: readonly ClassificationRule[] = [
  // Read-only tools — always safe
  { tool: "read_file", risk: "safe", category: "read-only", action: "allow", description: "Reading files" },
  { tool: "grep", risk: "safe", category: "read-only", action: "allow", description: "Searching content" },
  { tool: "glob", risk: "safe", category: "read-only", action: "allow", description: "Finding files" },
  { tool: "git_log", risk: "safe", category: "read-only", action: "allow", description: "Git history" },
  { tool: "git_diff", risk: "safe", category: "read-only", action: "allow", description: "Git changes" },
  { tool: "git_status", risk: "safe", category: "read-only", action: "allow", description: "Git status" },

  // Write tools — moderate risk, allow in project
  { tool: "write_file", risk: "moderate", category: "write", action: "allow", description: "Writing files" },
  { tool: "edit_file", risk: "moderate", category: "write", action: "allow", description: "Editing files" },

  // Destructive bash commands — dangerous, block
  {
    tool: "bash", risk: "dangerous", category: "destructive", action: "block",
    condition: (args) => /rm\s+(-rf|-fr|--recursive.*--force)/i.test(args),
    description: "Recursive forced deletion",
  },
  {
    tool: "bash", risk: "dangerous", category: "destructive", action: "block",
    condition: (args) => /DROP\s+(TABLE|DATABASE|SCHEMA)/i.test(args),
    description: "Database destruction",
  },
  {
    tool: "bash", risk: "dangerous", category: "destructive", action: "block",
    condition: (args) => /git\s+push\s+.*--force/i.test(args),
    description: "Force push",
  },
  {
    tool: "bash", risk: "dangerous", category: "destructive", action: "block",
    condition: (args) => /git\s+reset\s+--hard/i.test(args),
    description: "Hard reset",
  },

  // Shell injection patterns — dangerous, block
  {
    tool: "bash", risk: "dangerous", category: "destructive", action: "block",
    condition: (args) => /;\s*(rm|curl|wget|nc|bash|sh)\s/i.test(args),
    description: "Potential shell injection via chained command",
  },
  {
    tool: "bash", risk: "dangerous", category: "destructive", action: "block",
    condition: (args) => /\$\(.*\)|`.*`/.test(args) && /(rm|curl|wget|nc)\b/i.test(args),
    description: "Potential shell injection via command substitution",
  },

  // Credential access — dangerous, block
  {
    tool: "bash", risk: "dangerous", category: "credential", action: "block",
    condition: (args) => /(cat|less|more|head|tail)\s+.*\.(env|pem|key|crt|p12|pfx)\b/i.test(args),
    description: "Reading credential/secret file",
  },
  {
    tool: "bash", risk: "dangerous", category: "credential", action: "block",
    condition: (args) => /(curl|wget|fetch).*\$\{?(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS)/i.test(args),
    description: "Potential secret exfiltration via HTTP",
  },

  // Large-scale operations — warn
  {
    tool: "bash", risk: "moderate", category: "write", action: "warn",
    condition: (args) => /find\s+.*-exec\s+(rm|mv|chmod|chown)/i.test(args),
    description: "Large-scale file operation via find -exec",
  },
  {
    tool: "bash", risk: "moderate", category: "write", action: "warn",
    condition: (args) => /xargs\s+(rm|mv|chmod|chown)/i.test(args),
    description: "Large-scale file operation via xargs",
  },

  // System modifications — warn
  {
    tool: "bash", risk: "moderate", category: "destructive", action: "warn",
    condition: (args) => /chmod\s+777|chown\s+root|sudo\s/i.test(args),
    description: "System-level permission change",
  },

  // Network operations — warn
  {
    tool: "bash", risk: "moderate", category: "network", action: "warn",
    condition: (args) => /(curl|wget|fetch)\s+/i.test(args),
    description: "Network request",
  },

  // Network scanning — warn
  {
    tool: "bash", risk: "moderate", category: "network", action: "warn",
    condition: (args) => /nmap|netcat|nc\s+-|masscan/i.test(args),
    description: "Network scanning activity",
  },

  // Safe bash commands — allow
  {
    tool: "bash", risk: "safe", category: "safe", action: "allow",
    condition: (args) => /^(ls|pwd|echo|cat|head|tail|wc|sort|uniq|date|whoami|which|type|file)\b/.test(args.trim()),
    description: "Safe shell command",
  },

  // Build/test commands — allow
  {
    tool: "bash", risk: "safe", category: "safe", action: "allow",
    condition: (args) => /^(npm|npx|node|pnpm|yarn|bun|cargo|go|python|pip|swift)\s+(test|run|build|check|lint|typecheck|install)/i.test(args.trim()),
    description: "Build/test command",
  },
];

// ── Auto-Classifier ──────────────────────────────────────

export class AutoClassifier {
  private config: ClassifierConfig;
  private state: AutoModeState;
  private readonly compiledBlockedPatterns: readonly RegExp[];

  constructor(config?: Partial<ClassifierConfig>) {
    this.config = {
      enabled: true,
      maxConsecutiveBlocks: 3,
      maxTotalBlocks: 20,
      allowedPaths: [],
      blockedPatterns: [],
      allowReadOperations: true,
      allowWriteInProject: true,
      blockDestructive: true,
      ...config,
    };
    this.state = {
      enabled: this.config.enabled,
      consecutiveBlocks: 0,
      totalBlocks: 0,
      totalAllowed: 0,
      totalWarns: 0,
      paused: false,
    };
    this.compiledBlockedPatterns = this.config.blockedPatterns.map(
      (p) => new RegExp(p, "i"),
    );
  }

  /**
   * Classify a tool call — returns allow/warn/block with risk assessment.
   */
  classify(toolName: string, args: Record<string, unknown>): ClassificationResult {
    const argsStr = typeof args === "string" ? args : JSON.stringify(args);

    if (!this.state.enabled || this.state.paused) {
      return {
        action: "block",
        reason: "Auto mode is paused — all actions require manual approval",
        risk: "moderate",
        confidence: 1.0,
        category: "unknown",
      };
    }

    // Check blocked patterns first (user-configured)
    for (const pattern of this.compiledBlockedPatterns) {
      if (pattern.test(argsStr)) {
        return this.recordBlock({
          action: "block",
          reason: `Matches blocked pattern: ${pattern.source}`,
          risk: "dangerous",
          confidence: 1.0,
          category: "unknown",
        });
      }
    }

    // Check path-based allowlist for write tools
    if ((toolName === "write_file" || toolName === "edit_file") && this.config.allowedPaths.length > 0) {
      const targetPath = extractPath(args);
      if (targetPath && !this.isPathAllowed(targetPath)) {
        return this.recordBlock({
          action: "block",
          reason: `Path "${targetPath}" is outside the allowed paths`,
          risk: "moderate",
          confidence: 0.9,
          category: "write",
        });
      }
    }

    // Find matching rule
    for (const rule of RULES) {
      if (rule.tool !== toolName) continue;
      if (rule.condition && !rule.condition(argsStr)) continue;

      const result: ClassificationResult = {
        action: rule.action,
        reason: rule.description,
        risk: rule.risk,
        confidence: 0.95,
        category: rule.category,
      };

      return this.recordAction(result);
    }

    // Default: bash commands without matching rules -> warn
    if (toolName === "bash") {
      return this.recordAction({
        action: "warn",
        reason: "Unclassified bash command",
        risk: "moderate",
        confidence: 0.5,
        category: "unknown",
      });
    }

    // Unknown tools -> warn
    return this.recordAction({
      action: "warn",
      reason: `Unknown tool: ${toolName}`,
      risk: "moderate",
      confidence: 0.3,
      category: "unknown",
    });
  }

  /**
   * Check if classifier has auto-paused due to too many blocks.
   */
  shouldAutoPause(): boolean {
    return this.state.paused;
  }

  /**
   * Reset all counters and unpause.
   */
  reset(): void {
    this.state = {
      enabled: this.config.enabled,
      consecutiveBlocks: 0,
      totalBlocks: 0,
      totalAllowed: 0,
      totalWarns: 0,
      paused: false,
    };
  }

  /**
   * Resume auto mode after a pause.
   */
  resume(): void {
    this.state = {
      ...this.state,
      paused: false,
      pauseReason: undefined,
      consecutiveBlocks: 0,
    };
  }

  /**
   * Get current auto mode state.
   */
  getState(): AutoModeState {
    return this.state;
  }

  /**
   * Update configuration. Recompiles blocked patterns.
   */
  setConfig(config: Partial<ClassifierConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.blockedPatterns) {
      // Rebuild compiled patterns on the new instance
      const newClassifier = new AutoClassifier(this.config);
      Object.assign(this, { compiledBlockedPatterns: newClassifier.compiledBlockedPatterns });
    }
  }

  // ── Private ────────────────────────────────────────────

  private isPathAllowed(targetPath: string): boolean {
    return this.config.allowedPaths.some(
      (allowed) => targetPath.startsWith(allowed),
    );
  }

  private recordBlock(result: ClassificationResult): ClassificationResult {
    this.state = {
      ...this.state,
      consecutiveBlocks: this.state.consecutiveBlocks + 1,
      totalBlocks: this.state.totalBlocks + 1,
    };

    if (this.state.consecutiveBlocks >= this.config.maxConsecutiveBlocks) {
      this.state = {
        ...this.state,
        paused: true,
        pauseReason: `Auto-paused after ${this.state.consecutiveBlocks} consecutive blocks`,
      };
    }
    if (this.state.totalBlocks >= this.config.maxTotalBlocks) {
      this.state = {
        ...this.state,
        paused: true,
        pauseReason: `Switched to manual mode after ${this.state.totalBlocks} total blocks`,
      };
    }

    return result;
  }

  private recordAction(result: ClassificationResult): ClassificationResult {
    if (result.action === "block") {
      return this.recordBlock(result);
    }

    if (result.action === "warn") {
      this.state = {
        ...this.state,
        totalWarns: this.state.totalWarns + 1,
        consecutiveBlocks: 0,
      };
    } else {
      this.state = {
        ...this.state,
        consecutiveBlocks: 0,
        totalAllowed: this.state.totalAllowed + 1,
      };
    }

    return result;
  }
}

// ── Helpers ──────────────────────────────────────────────

function extractPath(args: Record<string, unknown>): string | null {
  if (typeof args === "object" && args !== null) {
    if (typeof args["path"] === "string") return args["path"];
    if (typeof args["file_path"] === "string") return args["file_path"];
    if (typeof args["filePath"] === "string") return args["filePath"];
  }
  return null;
}
